#!/usr/bin/env python3
"""HTTP regression tests for authenticated offline video downloads."""

import asyncio
import importlib.util
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, call, patch

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))


class IsolatedApiMixin:
    @classmethod
    def setUpClass(cls):
        cls.runtime = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.runtime.cleanup)
        runtime_dir = Path(cls.runtime.name)

        # The API creates token/static files and a worker on import. Load the
        # actual source in a disposable runtime, with no real database or worker.
        api_source = runtime_dir / "api.py"
        shutil.copyfile(BACKEND_DIR / "api.py", api_source)
        (runtime_dir / "token.txt").write_text("TEST1234", encoding="utf-8")
        module_name = "_superbrain_media_endpoint_test_api"
        spec = importlib.util.spec_from_file_location(module_name, api_source)
        cls.api = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = cls.api
        cls.addClassCleanup(sys.modules.pop, module_name, None)
        database = Mock()
        database.db_path = runtime_dir / "test.db"
        database.is_connected.return_value = False
        with (
            patch("core.database.get_db", return_value=database),
            patch("core.media_store.get_media_dir", return_value=runtime_dir / "media"),
            patch("threading.Thread.start"),
        ):
            spec.loader.exec_module(cls.api)


class MediaEndpointTests(IsolatedApiMixin, unittest.TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory(dir=self.runtime.name)
        self.addCleanup(self.media.cleanup)
        self.media_dir = Path(self.media.name)
        patcher = patch.object(self.api, "_MEDIA_DIR", self.media_dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        # Omitting the context manager avoids starting background lifespan jobs.
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)
        self.headers = {"X-API-Key": self.api.API_TOKEN}
        self.filename = "instagram_ABC123.mp4"
        self.video_bytes = b"\x00\x00\x00\x18ftypmp42test-video-bytes"
        (self.media_dir / self.filename).write_bytes(self.video_bytes)
        self.url = f"/api/v1/media/{self.filename}"

    def test_missing_token_returns_401(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 401)

    def test_incorrect_tokens_return_401(self):
        for kwargs in (
            {"headers": {"X-API-Key": "WRONG123"}},
            {"params": {"token": "WRONG123"}},
        ):
            with self.subTest(kwargs=kwargs):
                response = self.client.get(self.url, **kwargs)
                self.assertEqual(response.status_code, 401)

    def test_missing_file_returns_404(self):
        response = self.client.get(
            "/api/v1/media/missing.mp4", headers=self.headers
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Media file not found")

    def test_valid_file_returns_mp4_and_original_bytes(self):
        response = self.client.get(self.url, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "video/mp4")
        self.assertEqual(response.headers["content-length"], str(len(self.video_bytes)))
        self.assertEqual(response.headers["cache-control"], "private, max-age=3600")
        self.assertEqual(response.content, self.video_bytes)

    def test_query_token_allows_video_player_downloads(self):
        response = self.client.get(self.url, params={"token": self.api.API_TOKEN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, self.video_bytes)

    def test_invalid_filenames_and_traversal_return_400(self):
        # Percent encoding prevents the HTTP client from normalizing dot segments
        # before the ASGI router sees the attack path.
        invalid_paths = (
            "%2E%2E%2F%2E%2E%2F%2E%2E%2Fetc%2Fpasswd",
            "%2E%2E%2Foutside.mp4",
            "%2Ftmp%2Foutside.mp4",
            "nested%2Fvideo.mp4",
            "%2E%2E%5Coutside.mp4",
            "nested%5Cvideo.mp4",
            "video%00.mp4",
            "video.txt",
        )
        for filename in invalid_paths:
            with self.subTest(filename=filename):
                response = self.client.get(
                    f"/api/v1/media/{filename}", headers=self.headers
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], "Invalid media filename")

    def test_symlink_outside_media_directory_returns_400(self):
        outside = Path(self.runtime.name) / "outside.mp4"
        outside.write_bytes(b"private data outside media")
        (self.media_dir / "escape.mp4").symlink_to(outside)
        response = self.client.get(
            "/api/v1/media/escape.mp4", headers=self.headers
        )
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(outside.read_bytes(), response.content)

    def test_directory_named_mp4_returns_404(self):
        (self.media_dir / "directory.mp4").mkdir()
        response = self.client.get(
            "/api/v1/media/directory.mp4", headers=self.headers
        )
        self.assertEqual(response.status_code, 404)


class MediaCleanupLifespanTests(IsolatedApiMixin, unittest.IsolatedAsyncioTestCase):
    async def test_cleanup_runs_off_event_loop_with_configured_paths(self):
        with patch.object(self.api.asyncio, "to_thread", new_callable=AsyncMock) as offload:
            await self.api.run_media_cleanup()
        offload.assert_awaited_once_with(
            self.api.sweep_media, self.api.get_media_dir(), self.api.db.db_path
        )

    async def test_periodic_cleanup_logs_failure_and_retries_next_interval(self):
        with (
            patch.object(
                self.api.asyncio, "sleep", new_callable=AsyncMock,
                side_effect=[None, None, asyncio.CancelledError()],
            ) as sleep,
            patch.object(
                self.api.asyncio, "to_thread", new_callable=AsyncMock,
                side_effect=[OSError("disk unavailable"), {}],
            ) as offload,
            patch.object(self.api.logger, "exception") as log_failure,
        ):
            with self.assertRaises(asyncio.CancelledError):
                await self.api.media_cleanup_loop(17)

        self.assertEqual(sleep.await_args_list, [call(17), call(17), call(17)])
        self.assertEqual(offload.await_count, 2)
        log_failure.assert_called_once_with(
            "Media cache cleanup failed; retrying at the next interval"
        )

    async def test_lifespan_sweeps_at_startup_and_cancels_worker_on_shutdown(self):
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def background_worker(interval):
            self.assertEqual(interval, 17)
            started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        with (
            patch.object(self.api, "run_media_cleanup", new_callable=AsyncMock) as cleanup,
            patch.object(
                self.api, "media_cleanup_loop", new_callable=AsyncMock,
                side_effect=background_worker,
            ) as worker,
            patch.dict(os.environ, {"MEDIA_CLEANUP_INTERVAL_SECONDS": "17"}),
        ):
            async with self.api.app.router.lifespan_context(self.api.app):
                cleanup.assert_awaited_once()
                await asyncio.wait_for(started.wait(), timeout=1)
                self.assertFalse(cancelled.is_set())
            self.assertTrue(cancelled.is_set())
            worker.assert_awaited_once_with(17)


if __name__ == "__main__":
    unittest.main()
