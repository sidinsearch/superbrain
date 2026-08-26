#!/usr/bin/env python3
"""Regression tests for offline media metadata and file persistence."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import core.database as database_module  # noqa: E402
import core.media_store as media_store  # noqa: E402


class MediaMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)

        self.original_db_path = database_module.DB_PATH
        database_module.DB_PATH = self.temp_path / "superbrain.db"
        self.db = database_module.Database()

        self.original_media_dir = media_store.MEDIA_DIR
        media_store.MEDIA_DIR = self.temp_path / "media"

    def tearDown(self):
        self.db.close()
        database_module.DB_PATH = self.original_db_path
        media_store.MEDIA_DIR = self.original_media_dir
        self.temp_dir.cleanup()

    def test_save_analysis_persists_media_metadata(self):
        ok = self.db.save_analysis(
            shortcode="ABC123",
            url="https://www.instagram.com/reel/ABC123/",
            username="tester",
            title="Title",
            summary="Summary",
            tags=["offline", "media"],
            music="",
            category="other",
            local_filename="instagram_ABC123.mp4",
            media_file_size=4096,
        )

        self.assertTrue(ok)
        cached = self.db.check_cache("ABC123")
        self.assertEqual(cached["local_filename"], "instagram_ABC123.mp4")
        self.assertEqual(cached["media_file_size"], 4096)

        light = self.db.get_recent_light(limit=1)
        self.assertEqual(light[0]["local_filename"], "instagram_ABC123.mp4")
        self.assertEqual(light[0]["media_file_size"], 4096)

    def test_persist_media_file_copies_mp4_to_media_dir(self):
        source_dir = self.temp_path / "temp-download"
        source_dir.mkdir()
        source = source_dir / "source.mp4"
        source.write_bytes(b"fake mp4 bytes")

        filename, size = media_store.persist_media_file(
            source,
            "instagram",
            "ABC123",
        )

        self.assertEqual(filename, "instagram_ABC123.mp4")
        self.assertEqual(size, len(b"fake mp4 bytes"))
        self.assertEqual((media_store.MEDIA_DIR / filename).read_bytes(), b"fake mp4 bytes")


if __name__ == "__main__":
    unittest.main()
