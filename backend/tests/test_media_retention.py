"""Disk-backed regressions for media retention and atomic publication."""

import contextlib
import io
import json
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
    get_media_cache_stats,
    media_lock,
    non_negative_env_int,
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
        self.budget_patch = patch.dict(os.environ, {"MEDIA_MAX_BYTES": "0"})
        self.budget_patch.start()
        self.addCleanup(self.budget_patch.stop)
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
            "stats": (
                "from core.media_retention import get_media_cache_stats; "
                "get_media_cache_stats(Path(sys.argv[2]))"
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
                    elif action == "sweep":
                        self.assertFalse(target.exists())
                    else:
                        self.assertEqual(target.read_bytes(), b"old video")
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

    def test_byte_budget_environment_accepts_zero_and_positive_without_warning(self):
        for value, expected in (("0", 0), ("1024", 1024)):
            with self.subTest(value=value), patch.dict(os.environ, {"MEDIA_MAX_BYTES": value}):
                with patch("core.media_retention.logger.warning") as warning:
                    self.assertEqual(non_negative_env_int("MEDIA_MAX_BYTES", 0), expected)
                warning.assert_not_called()
        with patch.dict(os.environ):
            os.environ.pop("MEDIA_MAX_BYTES", None)
            with patch("core.media_retention.logger.warning") as warning:
                self.assertEqual(non_negative_env_int("MEDIA_MAX_BYTES", 0), 0)
            warning.assert_not_called()

    def test_invalid_byte_budget_environment_disables_with_warning(self):
        for value in ("-1", "invalid", "1.5", ""):
            with self.subTest(value=value), patch.dict(os.environ, {"MEDIA_MAX_BYTES": value}):
                with self.assertLogs("core.media_retention", level="WARNING"):
                    self.assertEqual(non_negative_env_int("MEDIA_MAX_BYTES", 0), 0)

    def test_explicit_byte_budget_requires_a_nonnegative_integer(self):
        for value in (-1, 1.5, "10", True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.sweep(max_bytes=value)

    def test_zero_budget_disables_quota_and_explicit_zero_overrides_environment(self):
        video = self.create_file("active.mp4", age=2 * DAY_SECONDS, data=b"1234567890")
        self.save_post("active", video.name)
        with patch.dict(os.environ, {"MEDIA_MAX_BYTES": "1"}):
            result = self.sweep(max_bytes=0)
        self.assertTrue(video.exists())
        self.assertEqual(result["max_bytes"], 0)
        self.assertEqual(result["quota_deleted_files"], 0)
        self.assertEqual(result["total_bytes"], 10)
        self.assertEqual(result["over_budget_bytes"], 0)
        result = self.sweep()
        self.assertTrue(video.exists())
        self.assertEqual(result["over_budget_bytes"], 0)

    def test_environment_budget_evicts_registered_fresh_media_and_clears_metadata(self):
        video = self.create_file("active.mp4", age=0, data=b"1234567890")
        self.save_post("active", video.name)
        with patch.dict(os.environ, {"MEDIA_MAX_BYTES": "5"}):
            result = self.sweep()
        self.assertFalse(video.exists())
        self.assertEqual(result["max_bytes"], 5)
        self.assertEqual(result["quota_deleted_files"], 1)
        self.assertEqual(result["deleted_files"], 1)
        self.assertEqual(result["bytes_freed"], 10)
        self.assertEqual(result["cleared_rows"], 1)
        self.assertEqual(result["total_bytes"], 0)
        self.assertEqual(result["over_budget_bytes"], 0)
        row = self.db.check_cache("active")
        self.assertEqual(row["local_filename"], "")
        self.assertEqual(row["media_file_size"], 0)
        self.assertGreater(row["updated_at"], "2020-01-01T00:00:00")

    def test_quota_evicts_oldest_first_with_filename_tiebreaker_and_stops_at_budget(self):
        paths = {}
        for name, age in (("newest.mp4", DAY_SECONDS), ("b.mp4", 2 * DAY_SECONDS),
                          ("a.mp4", 2 * DAY_SECONDS), ("oldest.mp4", 3 * DAY_SECONDS)):
            paths[name] = self.create_file(name, age=age, data=b"12345")
            self.save_post(name, name)
        result = self.sweep(max_bytes=10)
        self.assertFalse(paths["oldest.mp4"].exists())
        self.assertFalse(paths["a.mp4"].exists())
        self.assertTrue(paths["b.mp4"].exists())
        self.assertTrue(paths["newest.mp4"].exists())
        self.assertEqual(result["quota_deleted_files"], 2)
        self.assertEqual(result["total_bytes"], 10)
        self.assertEqual(result["over_budget_bytes"], 0)

    def test_expired_and_orphan_cleanup_runs_before_quota_eviction(self):
        active = self.create_file("active.mp4", age=DAY_SECONDS, data=b"12345")
        expired = self.create_file("expired.mp4", age=30 * DAY_SECONDS, data=b"12345")
        orphan = self.create_file("orphan.mp4", age=DAY_SECONDS, data=b"12345")
        self.save_post("active", active.name)
        self.save_post("expired", expired.name)
        result = self.sweep(max_bytes=5)
        self.assertTrue(active.exists())
        self.assertFalse(expired.exists())
        self.assertFalse(orphan.exists())
        self.assertEqual(result["deleted_files"], 2)
        self.assertEqual(result["quota_deleted_files"], 0)
        self.assertEqual(result["total_bytes"], 5)

    def test_quota_counts_files_once_when_multiple_database_rows_reference_them(self):
        video = self.create_file("shared.mp4", data=b"12345")
        self.save_post("one", video.name)
        self.save_post("two", video.name)
        result = self.sweep(max_bytes=5)
        self.assertTrue(video.exists())
        self.assertEqual(result["total_bytes"], 5)
        self.assertEqual(result["quota_deleted_files"], 0)
        result = self.sweep(max_bytes=4)
        self.assertFalse(video.exists())
        self.assertEqual(result["cleared_rows"], 2)
        self.assertEqual(result["bytes_freed"], 5)
        for shortcode in ("one", "two"):
            self.assertEqual(self.db.check_cache(shortcode)["local_filename"], "")

    def test_unreferenced_and_hidden_fresh_media_keep_grace_and_report_over_budget(self):
        orphan = self.create_file("orphan.mp4", age=ORPHAN_GRACE_SECONDS - 1, data=b"12345")
        hidden = self.create_file("hidden.mp4", age=ORPHAN_GRACE_SECONDS - 1, data=b"12345")
        self.save_post("hidden", hidden.name, hidden=True)
        with self.assertLogs("core.media_retention", level="WARNING") as logs:
            result = self.sweep(max_bytes=3)
        self.assertTrue(orphan.exists())
        self.assertTrue(hidden.exists())
        self.assertEqual(result["total_bytes"], 10)
        self.assertEqual(result["over_budget_bytes"], 7)
        self.assertEqual(result["quota_deleted_files"], 0)
        self.assertIn("7 bytes over", " ".join(logs.output))
        result = sweep_media(self.media_dir, self.database_path, now=self.now + 1, max_bytes=3)
        self.assertFalse(orphan.exists())
        self.assertFalse(hidden.exists())
        self.assertEqual(result["over_budget_bytes"], 0)

    def test_quota_skips_failed_file_and_continues_to_younger_files(self):
        locked = self.create_file("locked.mp4", age=2 * DAY_SECONDS, data=b"12345")
        younger = self.create_file("younger.mp4", age=DAY_SECONDS, data=b"12345")
        self.save_post("locked", locked.name)
        self.save_post("younger", younger.name)
        original_unlink = Path.unlink
        attempts = []

        def fail_locked(path, *args, **kwargs):
            attempts.append(path.name)
            if path == locked:
                raise PermissionError("File deletion denied")
            return original_unlink(path, *args, **kwargs)

        with patch.object(Path, "unlink", fail_locked), self.assertLogs("core.media_retention", level="ERROR"):
            result = self.sweep(max_bytes=5)
        self.assertEqual(attempts.count(locked.name), 1)
        self.assertTrue(locked.exists())
        self.assertFalse(younger.exists())
        self.assertEqual(result["failed_files"], 1)
        self.assertEqual(result["quota_deleted_files"], 1)
        self.assertEqual(result["total_bytes"], 5)
        self.assertEqual(self.db.check_cache("locked")["updated_at"], "2020-01-01T00:00:00")
        self.assertEqual(self.db.check_cache("younger")["local_filename"], "")

    def test_expiry_deletion_failure_is_not_retried_by_quota_in_same_sweep(self):
        locked = self.create_file("locked.mp4", age=40 * DAY_SECONDS, data=b"12345")
        self.save_post("locked", locked.name)
        with patch.object(Path, "unlink", side_effect=PermissionError("denied")) as unlink:
            with self.assertLogs("core.media_retention", level="WARNING"):
                result = self.sweep(max_bytes=1)
        self.assertEqual(unlink.call_count, 1)
        self.assertEqual(result["failed_files"], 1)
        self.assertEqual(result["total_bytes"], 5)
        self.assertEqual(result["over_budget_bytes"], 4)
        self.assertEqual(result["cleared_rows"], 0)

    def test_quota_all_deletions_fail_reports_remaining_bytes_without_looping(self):
        for name in ("one.mp4", "two.mp4"):
            self.create_file(name, age=DAY_SECONDS, data=b"12345")
            self.save_post(name, name)
        with patch.object(Path, "unlink", side_effect=PermissionError("denied")) as unlink:
            with self.assertLogs("core.media_retention", level="WARNING"):
                result = self.sweep(max_bytes=1)
        self.assertEqual(unlink.call_count, 2)
        self.assertEqual(result["failed_files"], 2)
        self.assertEqual(result["over_budget_bytes"], 9)
        self.assertEqual(result["quota_deleted_files"], 0)

    def test_quota_and_stats_count_only_regular_finalized_top_level_mp4s(self):
        video = self.create_file("active.MP4", age=DAY_SECONDS, data=b"12345")
        self.save_post("active", video.name)
        outside = self.root / "outside.mp4"
        outside.write_bytes(b"not in cache")
        (self.media_dir / "link.mp4").symlink_to(outside)
        (self.media_dir / "directory.mp4").mkdir()
        staging = self.media_dir / ".download-current"
        staging.mkdir()
        (staging / "video.mp4").write_bytes(b"not finalized")
        self.create_file("fragment.mp4.part", data=b"partial data")
        self.create_file("notes.txt", data=b"not video")
        result = self.sweep(max_bytes=5)
        self.assertEqual(result["total_bytes"], 5)
        self.assertEqual(result["quota_deleted_files"], 0)
        stats = get_media_cache_stats(self.media_dir, now=self.now)
        self.assertEqual(stats["file_count"], 1)
        self.assertEqual(stats["total_bytes"], 5)
        self.assertEqual(stats["oldest_age_days"], 1)
        self.assertEqual(stats["newest_age_days"], 1)

    def test_empty_cache_stats_have_null_ages_and_no_sweep_history(self):
        stats = get_media_cache_stats(self.media_dir, now=self.now)
        self.assertEqual(stats["file_count"], 0)
        self.assertEqual(stats["total_bytes"], 0)
        self.assertIsNone(stats["oldest_age_days"])
        self.assertIsNone(stats["newest_age_days"])
        self.assertIsNone(stats["last_sweep_at"])
        self.assertIsNone(stats["last_sweep_result"])

    def test_media_path_is_consistent_across_api_and_analysis_working_directories(self):
        script = (
            "import sys; sys.path.insert(0, sys.argv[1]); "
            "from core.media_store import get_media_dir; "
            "print(get_media_dir())"
        )
        for configured, expected in (
            ("cache-relative", BACKEND_DIR / "cache-relative"),
            (str(self.root / "absolute-media"), self.root / "absolute-media"),
            (None, BACKEND_DIR / "media"),
        ):
            environment = os.environ.copy()
            if configured is None:
                environment.pop("MEDIA_PATH", None)
            else:
                environment["MEDIA_PATH"] = configured
            for cwd in (BACKEND_DIR.parent, BACKEND_DIR):
                with self.subTest(configured=configured, cwd=cwd):
                    process = subprocess.run(
                        [sys.executable, "-c", script, str(BACKEND_DIR)],
                        cwd=cwd, env=environment, capture_output=True, text=True,
                        timeout=10, check=True,
                    )
                    self.assertEqual(process.stdout.strip(), str(expected))

    def test_stats_propagate_permission_errors_inspecting_media_directory(self):
        with patch.object(Path, "stat", side_effect=PermissionError("denied")):
            with self.assertRaises(PermissionError):
                get_media_cache_stats(self.media_dir)

    def test_sweep_root_permission_error_preserves_files_metadata_and_history(self):
        self.sweep()
        previous_stats = get_media_cache_stats(self.media_dir, now=self.now)
        video = self.create_file("expired.mp4", age=40 * DAY_SECONDS)
        self.save_post("expired", video.name)
        with patch.object(Path, "stat", side_effect=PermissionError("denied")):
            with self.assertRaises(PermissionError):
                self.sweep()
        self.assertTrue(video.exists())
        self.assertEqual(self.db.check_cache("expired")["local_filename"], video.name)
        self.assertEqual(self.db.check_cache("expired")["updated_at"], "2020-01-01T00:00:00")
        stats = get_media_cache_stats(self.media_dir, now=self.now)
        self.assertEqual(stats["last_sweep_result"], previous_stats["last_sweep_result"])
        self.assertEqual(stats["last_sweep_at"], previous_stats["last_sweep_at"])

    def test_metadata_stat_permission_error_preserves_failed_unlink_metadata_and_history(self):
        self.sweep()
        previous_stats = get_media_cache_stats(self.media_dir, now=self.now)
        video = self.create_file("expired.mp4", age=40 * DAY_SECONDS)
        self.save_post("expired", video.name)
        original_stat = Path.stat

        def fail_video_metadata_stat(path, *args, **kwargs):
            # Inventory uses lstat; fail only the later existence inspection.
            if path == video and kwargs.get("follow_symlinks", True):
                raise PermissionError("File metadata inspection denied")
            return original_stat(path, *args, **kwargs)

        with patch.object(Path, "stat", fail_video_metadata_stat):
            with patch.object(Path, "unlink", side_effect=PermissionError("File deletion denied")):
                with self.assertLogs("core.media_retention", level="ERROR"):
                    with self.assertRaises(PermissionError):
                        self.sweep()
        self.assertTrue(video.exists())
        row = self.db.check_cache("expired")
        self.assertEqual(row["local_filename"], video.name)
        self.assertEqual(row["media_file_size"], 12)
        self.assertEqual(row["updated_at"], "2020-01-01T00:00:00")
        stats = get_media_cache_stats(self.media_dir, now=self.now)
        self.assertEqual(stats["last_sweep_result"], previous_stats["last_sweep_result"])
        self.assertEqual(stats["last_sweep_at"], previous_stats["last_sweep_at"])

    def test_missing_directory_is_reported_empty_without_creation(self):
        missing = self.root / "missing-media"
        stats = get_media_cache_stats(missing, now=self.now)
        self.assertEqual(stats["file_count"], 0)
        self.assertIsNone(stats["last_sweep_at"])
        result = sweep_media(missing, self.database_path, now=self.now, max_bytes=10)
        self.assertEqual(result["total_bytes"], 0)
        self.assertEqual(result["max_bytes"], 10)
        self.assertFalse(missing.exists())

    def test_stats_report_current_budget_and_clamp_future_file_age_to_zero(self):
        self.create_file("old.mp4", age=2 * DAY_SECONDS, data=b"12345")
        self.create_file("future.mp4", age=-DAY_SECONDS, data=b"12345")
        with patch.dict(os.environ, {"MEDIA_MAX_BYTES": "6"}):
            stats = get_media_cache_stats(self.media_dir, now=self.now)
        self.assertEqual(stats["file_count"], 2)
        self.assertEqual(stats["total_bytes"], 10)
        self.assertEqual(stats["oldest_age_days"], 2)
        self.assertEqual(stats["newest_age_days"], 0)
        self.assertEqual(stats["max_bytes"], 6)
        self.assertEqual(stats["over_budget_bytes"], 4)
        self.assertEqual(get_media_cache_stats(self.media_dir)["over_budget_bytes"], 0)

    def test_successful_sweep_state_is_shared_with_another_process(self):
        result = self.sweep(max_bytes=5)
        script = (
            "import json, sys; from pathlib import Path; "
            "sys.path.insert(0, sys.argv[1]); "
            "from core.media_retention import get_media_cache_stats; "
            "print(json.dumps(get_media_cache_stats(Path(sys.argv[2]))))"
        )
        process = subprocess.run(
            [sys.executable, "-c", script, str(BACKEND_DIR), str(self.media_dir)],
            capture_output=True, text=True, timeout=10, check=True,
        )
        stats = json.loads(process.stdout)
        self.assertEqual(stats["last_sweep_result"], result)
        self.assertTrue(stats["last_sweep_at"].endswith("+00:00"))
        self.assertNotIn(str(self.media_dir), json.dumps(stats))

    def test_failed_sweep_keeps_last_successful_sweep_state(self):
        previous = self.sweep()
        previous_stats = get_media_cache_stats(self.media_dir, now=self.now)
        expired = self.create_file("expired.mp4", age=40 * DAY_SECONDS)
        self.save_post("expired", expired.name)
        self.db._conn.execute(
            "CREATE TRIGGER deny_metadata_update BEFORE UPDATE ON analyses "
            "BEGIN SELECT RAISE(ABORT, 'test commit failure'); END"
        )
        self.db._conn.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.sweep()
        stats = get_media_cache_stats(self.media_dir, now=self.now)
        self.assertEqual(stats["last_sweep_result"], previous)
        self.assertEqual(stats["last_sweep_at"], previous_stats["last_sweep_at"])
        self.assertFalse(expired.exists())
        self.assertEqual(self.db.check_cache("expired")["local_filename"], expired.name)

    def test_stats_refresh_inventory_and_replace_history_after_each_successful_sweep(self):
        first = self.sweep()
        first_stats = get_media_cache_stats(self.media_dir, now=self.now)
        video = self.create_file("active.mp4", data=b"12345")
        self.save_post("active", video.name)
        current_stats = get_media_cache_stats(self.media_dir, now=self.now)
        self.assertEqual(current_stats["total_bytes"], 5)
        self.assertEqual(current_stats["last_sweep_result"], first)
        latest = sweep_media(self.media_dir, self.database_path, now=self.now + 10, max_bytes=1)
        latest_stats = get_media_cache_stats(self.media_dir, now=self.now + 10)
        self.assertEqual(latest_stats["total_bytes"], 0)
        self.assertEqual(latest_stats["last_sweep_result"], latest)
        self.assertGreater(latest_stats["last_sweep_at"], first_stats["last_sweep_at"])

    def test_stats_surface_filesystem_and_corrupt_maintenance_errors(self):
        self.create_file("active.mp4")
        with patch.object(Path, "iterdir", side_effect=PermissionError("denied")):
            with self.assertRaises(PermissionError):
                get_media_cache_stats(self.media_dir)
        (self.media_dir / ".maintenance.sqlite3").write_bytes(b"invalid sqlite file")
        with self.assertRaises(sqlite3.DatabaseError):
            get_media_cache_stats(self.media_dir)


if __name__ == "__main__":
    unittest.main()
