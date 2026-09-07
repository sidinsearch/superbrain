"""Disk-backed regressions for media retention and atomic publication."""

import contextlib
import io
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import core.database as database_module  # noqa: E402
import core.media_store as media_store  # noqa: E402
from core.media_retention import (  # noqa: E402
    DAY_SECONDS,
    ORPHAN_GRACE_SECONDS,
    media_lock,
    positive_env_int,
    sweep_media,
)


class MediaRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.media_dir = self.root / "media"
        self.media_dir.mkdir()
        self.database_path = self.root / "superbrain.db"
        self.now = time.time()
        self.store_patch = patch.object(media_store, "MEDIA_DIR", self.media_dir)
        self.store_patch.start()
        self.addCleanup(self.store_patch.stop)
        with patch.object(database_module, "DB_PATH", self.database_path):
            with contextlib.redirect_stdout(io.StringIO()):
                self.db = database_module.Database()
        self.addCleanup(self.db.close)

    def create_file(self, name, age=0, data=b"cached video"):
        path = self.media_dir / name
        path.write_bytes(data)
        os.utime(path, (self.now - age, self.now - age))
        return path

    def save_post(self, shortcode, filename, *, hidden=False):
        with contextlib.redirect_stdout(io.StringIO()):
            saved = self.db.save_analysis(
                shortcode=shortcode,
                url=f"https://www.instagram.com/reel/{shortcode}/",
                username="tester",
                title="Test post",
                summary="Summary",
                tags=[],
                music="",
                category="other",
                local_filename=filename,
                media_file_size=12,
            )
        self.assertTrue(saved)
        self.db._conn.execute(
            "UPDATE analyses SET is_hidden = ?, updated_at = ? WHERE shortcode = ?",
            (int(hidden), "2020-01-01T00:00:00", shortcode),
        )
        self.db._conn.commit()

    def sweep(self, **kwargs):
        return sweep_media(
            self.media_dir, self.database_path, now=self.now, **kwargs,
        )

    def test_active_media_retained_until_retention_boundary(self):
        fresh = self.create_file("instagram_fresh.mp4", age=30 * DAY_SECONDS - 1)
        expired = self.create_file("instagram_expired.mp4", age=30 * DAY_SECONDS)
        self.save_post("fresh", fresh.name)
        self.save_post("expired", expired.name)

        result = self.sweep(retention_days=30)

        self.assertTrue(fresh.exists())
        self.assertFalse(expired.exists())
        self.assertEqual(result["deleted_files"], 1)
        self.assertEqual(result["bytes_freed"], len(b"cached video"))
        self.assertEqual(result["cleared_rows"], 1)
        self.assertEqual(self.db.check_cache("fresh")["local_filename"], fresh.name)
        row = self.db.check_cache("expired")
        self.assertEqual(row["local_filename"], "")
        self.assertEqual(row["media_file_size"], 0)
        self.assertEqual(row["title"], "Test post")
        self.assertEqual(self.db.get_posts_since("2020-01-01T00:00:00")[0]["shortcode"], "expired")

    def test_orphan_and_hidden_media_keep_publication_grace(self):
        paths = {}
        for kind in ("orphan", "hidden"):
            for age_label, age in (("fresh", ORPHAN_GRACE_SECONDS - 1),
                                   ("old", ORPHAN_GRACE_SECONDS)):
                name = f"{kind}_{age_label}.mp4"
                paths[name] = self.create_file(name, age=age)
                if kind == "hidden":
                    self.save_post(name, name, hidden=True)

        result = self.sweep()

        self.assertTrue(paths["orphan_fresh.mp4"].exists())
        self.assertTrue(paths["hidden_fresh.mp4"].exists())
        self.assertFalse(paths["orphan_old.mp4"].exists())
        self.assertFalse(paths["hidden_old.mp4"].exists())
        self.assertEqual(result["deleted_files"], 2)
        self.assertEqual(result["cleared_rows"], 1)

    def test_missing_file_metadata_is_repaired_and_delta_synced(self):
        self.save_post("missing", "instagram_missing.mp4")

        result = self.sweep()

        self.assertEqual(result["deleted_files"], 0)
        self.assertEqual(result["cleared_rows"], 1)
        row = self.db.check_cache("missing")
        self.assertEqual(row["local_filename"], "")
        self.assertEqual(row["media_file_size"], 0)
        self.assertGreater(row["updated_at"], "2020-01-01T00:00:00")
        self.assertEqual(len(self.db.get_posts_since("2020-01-01T00:00:00")), 1)
        self.assertEqual(self.sweep()["cleared_rows"], 0)

    def test_missing_database_fails_closed_without_creating_database(self):
        orphan = self.create_file("orphan.mp4", age=40 * DAY_SECONDS)
        missing_database = self.root / "missing.db"

        with self.assertRaises(sqlite3.OperationalError):
            sweep_media(self.media_dir, missing_database, now=self.now)

        self.assertTrue(orphan.exists())
        self.assertFalse(missing_database.exists())

    def test_database_with_missing_schema_fails_closed(self):
        orphan = self.create_file("orphan.mp4", age=40 * DAY_SECONDS)
        invalid_database = self.root / "invalid.db"
        sqlite3.connect(invalid_database).close()

        with self.assertRaises(sqlite3.OperationalError):
            sweep_media(self.media_dir, invalid_database, now=self.now)

        self.assertTrue(orphan.exists())

    def test_failed_unlink_keeps_metadata_for_retry(self):
        expired = self.create_file("instagram_locked.mp4", age=40 * DAY_SECONDS)
        self.save_post("locked", expired.name)
        original_unlink = Path.unlink

        def fail_one_unlink(path, *args, **kwargs):
            if path == expired:
                raise PermissionError("File deletion denied")
            return original_unlink(path, *args, **kwargs)

        with patch.object(Path, "unlink", fail_one_unlink):
            with self.assertLogs("core.media_retention", level="ERROR"):
                result = self.sweep()

        self.assertTrue(expired.exists())
        self.assertEqual(result["failed_files"], 1)
        self.assertEqual(result["cleared_rows"], 0)
        row = self.db.check_cache("locked")
        self.assertEqual(row["local_filename"], expired.name)
        self.assertEqual(row["media_file_size"], 12)
        self.assertEqual(row["updated_at"], "2020-01-01T00:00:00")
        self.assertEqual(self.sweep()["cleared_rows"], 1)

    def test_symlinks_nonmedia_and_unmanaged_directories_are_ignored(self):
        outside = self.root / "outside.mp4"
        outside.write_bytes(b"keep outside")
        symlink = self.media_dir / "linked.mp4"
        symlink.symlink_to(outside)
        outside_dir = self.root / "outside-directory"
        outside_dir.mkdir()
        (outside_dir / "video.mp4").write_bytes(b"keep directory")
        directory_link = self.media_dir / ".download-linked"
        directory_link.symlink_to(outside_dir, target_is_directory=True)
        notes = self.create_file("notes.txt", age=40 * DAY_SECONDS)
        ordinary_directory = self.media_dir / "uploads"
        ordinary_directory.mkdir()
        (ordinary_directory / "video.mp4").write_bytes(b"keep nested")
        os.utime(ordinary_directory, (0, 0))

        result = self.sweep()

        self.assertEqual(result["deleted_files"], 0)
        self.assertEqual(result["deleted_downloads"], 0)
        self.assertTrue(symlink.is_symlink())
        self.assertTrue(directory_link.is_symlink())
        self.assertEqual(outside.read_bytes(), b"keep outside")
        self.assertTrue(notes.exists())
        self.assertTrue((ordinary_directory / "video.mp4").exists())
        self.assertTrue((outside_dir / "video.mp4").exists())

    def test_unsafe_database_filenames_are_not_resolved_outside_media(self):
        for index, name in enumerate(("../outside.mp4", "foo/bar.mp4", "foo\\bar.mp4")):
            self.save_post(f"invalid-{index}", name)

        result = self.sweep()

        self.assertEqual(result["cleared_rows"], 0)
        self.assertEqual(self.db.check_cache("invalid-0")["local_filename"], "../outside.mp4")

    def test_active_download_lease_protects_old_workspace(self):
        with media_store.media_download_workspace() as workspace:
            partial = workspace / "video.mp4.part"
            partial.write_bytes(b"download in progress")
            old_time = self.now - 2 * ORPHAN_GRACE_SECONDS
            os.utime(workspace, (old_time, old_time))

            result = self.sweep()

            self.assertTrue(partial.exists())
            self.assertEqual(result["deleted_downloads"], 0)
        self.assertFalse(workspace.exists())

    def test_abandoned_download_and_legacy_fragments_are_cleaned_after_grace(self):
        abandoned = self.media_dir / ".download-abandoned"
        abandoned.mkdir()
        (abandoned / "video.mp4.part").write_bytes(b"abandoned")
        with media_lock(abandoned / ".active.sqlite3"):
            pass
        old_time = self.now - ORPHAN_GRACE_SECONDS
        os.utime(abandoned, (old_time, old_time))
        fresh_workspace = self.media_dir / ".download-new"
        fresh_workspace.mkdir()
        os.utime(fresh_workspace, (self.now, self.now))
        for suffix in (".part", ".ytdl", ".m4a", ".webm"):
            self.create_file("old" + suffix, age=ORPHAN_GRACE_SECONDS)
            self.create_file("fresh" + suffix, age=ORPHAN_GRACE_SECONDS - 1)

        result = self.sweep()

        self.assertFalse(abandoned.exists())
        self.assertTrue(fresh_workspace.exists())
        self.assertEqual(result["deleted_downloads"], 1)
        self.assertEqual(result["deleted_files"], 4)
        for suffix in (".part", ".ytdl", ".m4a", ".webm"):
            self.assertFalse((self.media_dir / ("old" + suffix)).exists())
            self.assertTrue((self.media_dir / ("fresh" + suffix)).exists())

    def test_publication_refreshes_old_source_age_and_replaces_atomically(self):
        source = self.root / "download.mp4"
        source.write_bytes(b"complete new video")
        os.utime(source, (0, 0))
        destination = self.create_file("instagram_replace.mp4", data=b"old video")
        original_copyfile = media_store.shutil.copyfile
        before_publication = time.time()

        def inspect_copy(source_path, staged_path):
            self.assertNotEqual(staged_path, destination)
            self.assertEqual(destination.read_bytes(), b"old video")
            original_copyfile(source_path, staged_path)
            self.assertEqual(destination.read_bytes(), b"old video")

        with patch.object(media_store.shutil, "copyfile", inspect_copy):
            filename, size = media_store.persist_media_file(source, "instagram", "replace")

        self.assertEqual(filename, destination.name)
        self.assertEqual(size, len(b"complete new video"))
        self.assertEqual(destination.read_bytes(), b"complete new video")
        self.assertGreaterEqual(destination.stat().st_mtime, before_publication - 0.01)
        self.assertEqual(source.stat().st_mtime, 0)
        self.assertEqual(list(self.media_dir.glob(".download-*")), [])

    def test_interrupted_copy_keeps_previous_published_video_and_cleans_staging(self):
        source = self.root / "download.mp4"
        source.write_bytes(b"replacement")
        destination = self.create_file("instagram_replace.mp4", data=b"previous")

        def incomplete_copy(source_path, staged_path):
            Path(staged_path).write_bytes(b"incomplete")
            raise OSError("Disk full")

        with patch.object(media_store.shutil, "copyfile", incomplete_copy):
            result = media_store.persist_media_file(source, "instagram", "replace")

        self.assertEqual(result, ("", 0))
        self.assertEqual(destination.read_bytes(), b"previous")
        self.assertEqual(list(self.media_dir.glob(".download-*")), [])

    def test_empty_source_is_not_published(self):
        source = self.root / "empty.mp4"
        source.touch()

        self.assertEqual(media_store.persist_media_file(source, "instagram", "empty"), ("", 0))
        self.assertFalse((self.media_dir / "instagram_empty.mp4").exists())
        self.assertEqual(list(self.media_dir.glob(".download-*")), [])

    def test_empty_existing_destination_is_not_reported_as_published(self):
        destination = self.media_dir / "instagram_empty.mp4"
        destination.touch()

        self.assertEqual(
            media_store.persist_media_file(destination, "instagram", "empty"),
            ("", 0),
        )
        self.assertTrue(destination.exists())

    def test_youtube_failure_cleans_partial_download_workspace(self):
        captured_options = {}

        class FailingYoutubeDL:
            def __init__(self, options):
                captured_options.update(options)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def extract_info(self, url, download):
                partial = Path(captured_options["outtmpl"].replace("%(ext)s", "mp4.part"))
                partial.write_bytes(b"partial video")
                raise RuntimeError("Download interrupted")

        fake_module = types.SimpleNamespace(YoutubeDL=FailingYoutubeDL)
        with patch.dict(sys.modules, {"yt_dlp": fake_module}):
            result = media_store.download_youtube_media("https://youtube.com/watch?v=test", "test")

        self.assertEqual(result, ("", 0))
        self.assertEqual(list(self.media_dir.glob(".download-*")), [])
        self.assertEqual(list(self.media_dir.glob("*.mp4")), [])
        self.assertTrue(Path(captured_options["outtmpl"]).parent.name.startswith(".download-"))

    def test_video_only_youtube_fragment_is_not_published(self):
        class FragmentOnlyYoutubeDL:
            def __init__(self, options):
                self.options = options

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def extract_info(self, url, download):
                Path(self.options["outtmpl"].replace("%(ext)s", "f137.mp4")).write_bytes(b"no audio")

        with patch.dict(sys.modules, {"yt_dlp": types.SimpleNamespace(YoutubeDL=FragmentOnlyYoutubeDL)}):
            result = media_store.download_youtube_media("https://youtube.com/watch?v=test", "test")

        self.assertEqual(result, ("", 0))
        self.assertEqual(list(self.media_dir.glob(".download-*")), [])
        self.assertEqual(list(self.media_dir.glob("*.mp4")), [])

    def test_publication_and_sweep_obey_cross_process_maintenance_lock(self):
        source = self.root / "download.mp4"
        source.write_bytes(b"new video")
        source_path = str(source)
        commands = {
            "publish": (
                "from core import media_store; "
                "media_store.MEDIA_DIR = Path(sys.argv[2]); "
                "media_store.persist_media_file(Path(sys.argv[4]), 'instagram', 'crossprocess')"
            ),
            "sweep": (
                "from core.media_retention import sweep_media; "
                "sweep_media(Path(sys.argv[2]), Path(sys.argv[3]))"
            ),
        }
        for action, command in commands.items():
            with self.subTest(action=action):
                target = self.create_file("instagram_crossprocess.mp4", age=40 * DAY_SECONDS, data=b"old video")
                script = (
                    "import sys; from pathlib import Path; "
                    "sys.path.insert(0, sys.argv[1]); "
                    "Path(sys.argv[5]).write_text('started'); " + command
                )
                ready = self.root / (action + ".ready")
                process = None
                try:
                    with media_lock(self.media_dir / ".maintenance.sqlite3"):
                        process = subprocess.Popen(
                            [sys.executable, "-c", script, str(BACKEND_DIR),
                             str(self.media_dir), str(self.database_path), source_path, str(ready)],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                        )
                        deadline = time.monotonic() + 5
                        while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                            time.sleep(0.01)
                        self.assertTrue(ready.exists(), "Child process did not start")
                        with self.assertRaises(subprocess.TimeoutExpired):
                            process.wait(timeout=0.2)
                        self.assertEqual(target.read_bytes(), b"old video")

                    stdout, stderr = process.communicate(timeout=10)
                    self.assertEqual(process.returncode, 0, stdout + stderr)
                    if action == "publish":
                        self.assertEqual(target.read_bytes(), b"new video")
                    else:
                        self.assertFalse(target.exists())
                finally:
                    if process is not None:
                        if process.poll() is None:
                            process.kill()
                        process.communicate()

    def test_invalid_environment_values_keep_safe_retention_default(self):
        for value in ("0", "-1", "invalid", "1.5"):
            with self.subTest(value=value), patch.dict(os.environ, {"MEDIA_RETENTION_DAYS": value}):
                with self.assertLogs("core.media_retention", level="WARNING"):
                    self.assertEqual(positive_env_int("MEDIA_RETENTION_DAYS", 30), 30)
        with self.assertRaises(ValueError):
            self.sweep(retention_days=0)


if __name__ == "__main__":
    unittest.main()
