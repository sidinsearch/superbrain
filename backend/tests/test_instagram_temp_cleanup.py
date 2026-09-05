#!/usr/bin/env python3
"""Ensure processed Instagram downloads do not remain as duplicate media."""

import ast
import shutil
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import core.media_store as media_store  # noqa: E402


class InstagramTempCleanupTests(unittest.TestCase):
    def setUp(self):
        self.runtime = tempfile.TemporaryDirectory()
        self.addCleanup(self.runtime.cleanup)
        self.root = Path(self.runtime.name)
        self.download = self.root / "instagram-download"
        self.download.mkdir()
        self.video = self.download / "video.mp4"
        self.video.write_bytes(b"downloaded Instagram video")
        (self.download / "thumbnail.jpg").write_bytes(b"downloaded thumbnail")
        self.media_dir = self.root / "media"
        media_patch = patch.object(media_store, "MEDIA_DIR", self.media_dir)
        media_patch.start()
        self.addCleanup(media_patch.stop)

        self.database = Mock()
        self.database.is_connected.return_value = True
        self.database.check_cache.return_value = None
        self.url = "https://www.instagram.com/reel/ABC123/"
        self.namespace = {
            "Path": Path,
            "shutil": shutil,
            "sys": sys,
            "time": time,
            "print": Mock(),
            "print_header": Mock(),
            "print_section": Mock(),
            "validate_link": Mock(return_value={
                "valid": True, "content_type": "instagram",
                "shortcode": "ABC123", "url": self.url,
            }),
            "get_db": Mock(return_value=self.database),
            "run_analysis_task": Mock(return_value={"success": False}),
            "generate_final_summary": Mock(return_value="Test report"),
            "parse_summary": Mock(return_value=("Title", "Summary", [], "", "other")),
            "_jpg_to_thumbnail": Mock(return_value="data:image/jpeg;base64,test"),
            "persist_media_file": media_store.persist_media_file,
        }
        # Execute the complete production functions unchanged, excluding the
        # module's optional AI-provider imports and command-line entry point.
        source = BACKEND_DIR / "main.py"
        tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
        functions = [
            node for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name in {"main", "cleanup_temp_folder"}
        ]
        self.assertEqual(len(functions), 2)
        module = ast.Module(body=functions, type_ignores=[])
        exec(compile(module, str(source), "exec"), self.namespace)

        downloader = types.ModuleType("instagram.instagram_downloader")
        downloader.download_instagram_content = Mock(return_value=str(self.download))
        downloader.RetryableDownloadError = type("RetryableDownloadError", (Exception,), {})
        downloader_patch = patch.dict(sys.modules, {downloader.__name__: downloader})
        downloader_patch.start()
        self.addCleanup(downloader_patch.stop)
        argv_patch = patch.object(sys, "argv", ["main.py", self.url])
        argv_patch.start()
        self.addCleanup(argv_patch.stop)

    def test_successful_save_removes_download_but_preserves_published_mp4(self):
        self.database.save_analysis.return_value = True
        video_bytes = self.video.read_bytes()

        self.namespace["main"]()

        self.database.save_analysis.assert_called_once()
        saved = self.database.save_analysis.call_args.kwargs
        self.assertEqual(saved["local_filename"], "instagram_ABC123.mp4")
        self.assertEqual(saved["media_file_size"], len(video_bytes))
        self.assertEqual((self.media_dir / saved["local_filename"]).read_bytes(), video_bytes)
        self.assertFalse(self.download.exists())

    def test_failed_database_save_preserves_original_download(self):
        self.database.save_analysis.return_value = False
        video_bytes = self.video.read_bytes()

        with self.assertRaises(SystemExit) as failure:
            self.namespace["main"]()

        self.assertEqual(failure.exception.code, 1)
        self.database.save_analysis.assert_called_once()
        self.assertEqual(self.video.read_bytes(), video_bytes)
        self.assertTrue((self.download / "thumbnail.jpg").exists())

    def test_cleanup_reports_missing_directory(self):
        self.assertFalse(self.namespace["cleanup_temp_folder"](self.root / "missing"))

    def test_cleanup_failure_keeps_files_and_reports_failure(self):
        with patch.object(shutil, "rmtree", side_effect=PermissionError("in use")):
            self.assertFalse(self.namespace["cleanup_temp_folder"](self.download))
        self.assertTrue(self.video.exists())


if __name__ == "__main__":
    unittest.main()
