"""Retention for the server's disposable offline-video cache.

SQLite write locks coordinate publishers and sweepers across API workers and
analysis subprocesses, including on Windows. They are released after a crash.
"""

from contextlib import contextmanager
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import time

logger = logging.getLogger(__name__)
DAY_SECONDS = 86400
ORPHAN_GRACE_SECONDS = 3600


def positive_env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
        if value > 0:
            return value
    except ValueError:
        pass
    logger.warning("Invalid %s; using %s", name, default)
    return default


@contextmanager
def media_lock(path: Path, timeout: float = 30):
    """Use a small, dedicated SQLite file as a process-safe exclusive lock."""
    connection = sqlite3.connect(str(path), timeout=timeout)
    try:
        connection.execute("BEGIN IMMEDIATE")
        yield
    finally:
        connection.rollback()
        connection.close()


def sweep_media(media_dir: Path, database_path: Path, *, now: float | None = None,
                retention_days: int | None = None) -> dict[str, int]:
    """Expire MP4s, unreferenced files, and abandoned download workspaces.

    Use a separate DB connection so the sweep never shares the API's connection
    across threads. A failed DB query must never be mistaken for zero references.
    A one-hour grace protects the gap between publishing a file and saving its
    analysis row. Only our MP4s/download artifacts are managed, never symlinks.
    """
    now = time.time() if now is None else now
    retention_days = (positive_env_int("MEDIA_RETENTION_DAYS", 30)
                      if retention_days is None else retention_days)
    if retention_days <= 0:
        raise ValueError("retention_days must be positive")
    result = {"deleted_files": 0, "deleted_downloads": 0, "bytes_freed": 0,
              "cleared_rows": 0, "failed_files": 0}
    if not media_dir.exists():
        return result

    with media_lock(media_dir / ".maintenance.sqlite3"):
        # mode=rw avoids creating a blank DB if DATABASE_PATH is incorrect.
        connection = sqlite3.connect(
            database_path.resolve().as_uri() + "?mode=rw", uri=True, timeout=30,
        )
        try:
            # Serialize with save/delete/restore while inspecting references.
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(
                "SELECT local_filename, is_hidden FROM analyses "
                "WHERE local_filename IS NOT NULL AND local_filename != ''"
            ).fetchall()
            active_names = {name for name, hidden in rows if not hidden}

            for path in media_dir.iterdir():
                try:
                    info = path.lstat()
                    if stat.S_ISLNK(info.st_mode):
                        continue
                    age = now - info.st_mtime
                    if stat.S_ISDIR(info.st_mode):
                        if path.name.startswith(".download-") and age >= ORPHAN_GRACE_SECONDS:
                            try:
                                # A running download holds this lease even if its
                                # directory timestamp is old. Never remove it.
                                with media_lock(path / ".active.sqlite3", timeout=0):
                                    pass
                            except sqlite3.OperationalError:
                                continue
                            shutil.rmtree(path)
                            result["deleted_downloads"] += 1
                        continue
                    if not stat.S_ISREG(info.st_mode):
                        continue
                    if path.suffix.lower() == ".mp4":
                        expired = age >= retention_days * DAY_SECONDS
                        orphaned = path.name not in active_names and age >= ORPHAN_GRACE_SECONDS
                        if not (expired or orphaned):
                            continue
                    elif path.suffix.lower() in {".part", ".ytdl", ".m4a", ".webm"}:
                        # Leftovers from versions that downloaded directly here.
                        if age < ORPHAN_GRACE_SECONDS:
                            continue
                    else:
                        continue
                    path.unlink()
                    result["deleted_files"] += 1
                    result["bytes_freed"] += info.st_size
                except OSError:
                    result["failed_files"] += 1
                    logger.exception("Could not remove cached media %s", path.name)

            # Repair evictions and files removed externally/on a prior crash.
            # Failed unlinks retain their metadata and are retried next sweep.
            # Keep the database's existing naive-UTC ISO representation.
            timestamp = (
                datetime.fromtimestamp(now, timezone.utc)
                .replace(tzinfo=None)
                .isoformat()
            )
            for name in {name for name, _ in rows}:
                if Path(name).name != name or "/" in name or "\\" in name or "\x00" in name:
                    continue
                path = media_dir / name
                if not path.exists():
                    cursor = connection.execute(
                        "UPDATE analyses SET local_filename = '', media_file_size = 0, "
                        "updated_at = ? WHERE local_filename = ?", (timestamp, name),
                    )
                    result["cleared_rows"] += cursor.rowcount
            connection.commit()
        finally:
            connection.close()
    logger.info("Media cache sweep: %s", result)
    return result
