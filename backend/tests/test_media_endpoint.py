#!/usr/bin/env python3
"""HTTP regression tests for authenticated offline video downloads."""

import asyncio
import importlib.util
import os
import shutil
import sqlite3
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
            patch("core.media_store.MEDIA_DIR", runtime_dir / "media"),
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


class MediaCacheAdminTests(IsolatedApiMixin, unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=self.runtime.name)
        self.addCleanup(self.temp.cleanup)
        self.media_dir = Path(self.temp.name) / "configured-media"
        self.media_dir.mkdir()
        self.database_path = Path(self.temp.name) / "analyses.sqlite3"
        with sqlite3.connect(self.database_path) as connection:
            connection.execute("""
                CREATE TABLE analyses (
                    shortcode TEXT PRIMARY KEY, local_filename TEXT,
                    media_file_size INTEGER, is_hidden INTEGER DEFAULT 0,
                    updated_at TEXT DEFAULT '2020-01-01T00:00:00',
                    title TEXT DEFAULT 'Saved analysis'
                )
            """)
        for patcher in (
            patch.object(self.api, "_MEDIA_DIR", self.media_dir),
            patch.object(self.api.db, "db_path", self.database_path),
            patch.dict(os.environ, {"MEDIA_MAX_BYTES": "10", "MEDIA_RETENTION_DAYS": "30"}),
            patch("core.media_retention.time.time", return_value=1_800_000_000),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)
        self.headers = {"X-API-Key": self.api.API_TOKEN}

    def create_video(self, name, age):
        path = self.media_dir / name
        path.write_bytes(b"0123456789")
        timestamp = 1_800_000_000 - age
        os.utime(path, (timestamp, timestamp))
        with sqlite3.connect(self.database_path) as connection:
            connection.execute(
                "INSERT INTO analyses (shortcode, local_filename, media_file_size) VALUES (?, ?, ?)",
                (path.stem, name, path.stat().st_size),
            )
        return path

    def test_admin_routes_require_valid_token_before_accessing_cache(self):
        with (
            patch.object(self.api, "get_media_cache_stats") as stats,
            patch.object(self.api, "sweep_media") as sweep,
        ):
            for method, url in (
                ("GET", "/admin/media-cache/stats"),
                ("POST", "/admin/media-cache/sweep"),
            ):
                for headers in ({}, {"X-API-Key": "WRONG123"}):
                    with self.subTest(method=method, headers=headers):
                        response = self.client.request(method, url, headers=headers)
                        self.assertEqual(response.status_code, 401)
            stats.assert_not_called()
            sweep.assert_not_called()

    def test_stats_reports_usage_and_ages_without_evicting(self):
        oldest = self.create_video("oldest.mp4", age=2 * 86400)
        newest = self.create_video("newest.mp4", age=86400)

        response = self.client.get("/admin/media-cache/stats", headers=self.headers)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), {
            "file_count": 2, "total_bytes": 20,
            "oldest_age_days": 2.0, "newest_age_days": 1.0,
            "last_sweep_at": None, "last_sweep_result": None,
            "max_bytes": 10, "over_budget_bytes": 10,
        })
        self.assertTrue(oldest.exists())
        self.assertTrue(newest.exists())

    def test_manual_sweep_updates_stats_database_and_served_files(self):
        oldest = self.create_video("oldest.mp4", age=2 * 86400)
        newest = self.create_video("newest.mp4", age=86400)

        response = self.client.post("/admin/media-cache/sweep", headers=self.headers)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        result = response.json()
        self.assertEqual(result["quota_deleted_files"], 1)
        self.assertEqual(result["total_bytes"], 10)
        self.assertEqual(result["max_bytes"], 10)
        self.assertEqual(result["over_budget_bytes"], 0)
        self.assertEqual(result["cleared_rows"], 1)
        self.assertFalse(oldest.exists())
        self.assertTrue(newest.exists())
        stats = self.client.get("/admin/media-cache/stats", headers=self.headers).json()
        self.assertEqual(stats["file_count"], 1)
        self.assertEqual(stats["total_bytes"], 10)
        self.assertEqual(stats["last_sweep_result"], result)
        self.assertIsNotNone(stats["last_sweep_at"])
        with sqlite3.connect(self.database_path) as connection:
            row = connection.execute(
                "SELECT local_filename, media_file_size, updated_at, title FROM analyses WHERE shortcode = 'oldest'"
            ).fetchone()
        self.assertEqual(row[:2], ("", 0))
        self.assertGreater(row[2], "2020-01-01T00:00:00")
        self.assertEqual(row[3], "Saved analysis")
        self.assertEqual(self.client.get(
            "/api/v1/media/oldest.mp4", headers=self.headers,
        ).status_code, 404)
        self.assertEqual(self.client.get(
            "/api/v1/media/newest.mp4", headers=self.headers,
        ).content, newest.read_bytes())

    def test_stats_for_empty_cache_uses_null_ages_and_no_previous_sweep(self):
        response = self.client.get("/admin/media-cache/stats", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        stats = response.json()
        self.assertEqual(stats["file_count"], 0)
        self.assertEqual(stats["total_bytes"], 0)
        self.assertIsNone(stats["oldest_age_days"])
        self.assertIsNone(stats["newest_age_days"])
        self.assertIsNone(stats["last_sweep_at"])

    def test_unavailable_cache_returns_503_without_internal_paths(self):
        for method, route, function, detail in (
            ("GET", "stats", "get_media_cache_stats", "Media cache statistics unavailable"),
            ("POST", "sweep", "sweep_media", "Media cache sweep failed"),
        ):
            with (
                self.subTest(route=route),
                patch.object(self.api, function, side_effect=OSError("/private/internal/path")),
                patch.object(self.api.logger, "exception") as log_failure,
            ):
                response = self.client.request(
                    method, f"/admin/media-cache/{route}", headers=self.headers,
                )
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {"detail": detail})
                log_failure.assert_called_once()


class MediaCleanupLifespanTests(IsolatedApiMixin, unittest.IsolatedAsyncioTestCase):
    async def test_cleanup_runs_off_event_loop_with_configured_paths(self):
        with patch.object(self.api.asyncio, "to_thread", new_callable=AsyncMock) as offload:
            await self.api.run_media_cleanup()
        offload.assert_awaited_once_with(
            self.api.sweep_media, self.api._MEDIA_DIR, self.api.db.db_path
        )
        self.assertEqual(self.api._MEDIA_DIR, Path(self.runtime.name) / "media")

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
