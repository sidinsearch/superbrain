"""Retention for the server's disposable offline-video cache.

SQLite write locks coordinate publishers and sweepers across API workers and
analysis subprocesses, including on Windows. They are released after a crash.
"""

from contextlib import contextmanager
from datetime import datetime, timezone
import json
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


def non_negative_env_int(name: str, default: int) -> int:
    """Read a byte budget, allowing zero to explicitly disable it."""
    try:
        value = int(os.getenv(name, str(default)))
        if value >= 0:
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
        yield connection
    finally:
        connection.rollback()
        connection.close()


def _finalized_media_files(media_dir: Path) -> list[tuple[Path, os.stat_result]]:
    """Inventory top-level regular MP4s without following symbolic links."""
    files = []
    for path in media_dir.iterdir():
        if path.suffix.lower() != ".mp4":
            continue
        try:
            info = path.lstat()
        except FileNotFoundError:
            # An operator may remove a file outside the maintenance lock.
            continue
        if stat.S_ISREG(info.st_mode):
            files.append((path, info))
    return files


def _record_sweep(connection: sqlite3.Connection, now: float,
                  result: dict[str, int]) -> None:
    connection.execute(
        "CREATE TABLE IF NOT EXISTS media_cache_sweep_state ("
        "singleton INTEGER PRIMARY KEY CHECK (singleton = 1), "
        "last_sweep_at TEXT NOT NULL, result_json TEXT NOT NULL)"
    )
    connection.execute(
        "INSERT INTO media_cache_sweep_state VALUES (1, ?, ?) "
        "ON CONFLICT(singleton) DO UPDATE SET "
        "last_sweep_at = excluded.last_sweep_at, result_json = excluded.result_json",
        (datetime.fromtimestamp(now, timezone.utc).isoformat(), json.dumps(result)),
    )
    connection.commit()


def get_media_cache_stats(media_dir: Path, *, now: float | None = None) -> dict:
    """Return a locked cache snapshot and the last successfully committed sweep.

    Counts and ages describe finalized MP4s only, excluding staging workspaces,
    legacy fragments, symlinks, and maintenance files. The last sweep is shared
    by every worker through the maintenance database. Inspection errors are
    propagated so the API can report an unavailable cache rather than zero use.
    """
    now = time.time() if now is None else now
    max_bytes = non_negative_env_int("MEDIA_MAX_BYTES", 0)
    result = {
        "file_count": 0, "total_bytes": 0, "oldest_age_days": None,
        "newest_age_days": None, "last_sweep_at": None,
        "max_bytes": max_bytes, "over_budget_bytes": 0, "last_sweep_result": None,
    }
    try:
        media_dir.stat()
    except FileNotFoundError:
        return result

    with media_lock(media_dir / ".maintenance.sqlite3") as maintenance:
        files = _finalized_media_files(media_dir)
        total_bytes = sum(info.st_size for _, info in files)
        result.update(file_count=len(files), total_bytes=total_bytes)
        if files:
            ages = [max(0, now - info.st_mtime) / DAY_SECONDS for _, info in files]
            result.update(oldest_age_days=max(ages), newest_age_days=min(ages))
        result["over_budget_bytes"] = max(0, total_bytes - max_bytes) if max_bytes else 0
        # Publishers from older versions already create this SQLite lock file,
        # but have never written sweep state into it.
        table_exists = maintenance.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' "
            "AND name = 'media_cache_sweep_state'"
        ).fetchone()
        if table_exists:
            row = maintenance.execute(
                "SELECT last_sweep_at, result_json FROM media_cache_sweep_state "
                "WHERE singleton = 1"
            ).fetchone()
            if row:
                result["last_sweep_at"] = row[0]
                result["last_sweep_result"] = json.loads(row[1])
    return result


def sweep_media(media_dir: Path, database_path: Path, *, now: float | None = None,
                retention_days: int | None = None,
                max_bytes: int | None = None) -> dict[str, int]:
    """Expire MP4s, unreferenced files, and abandoned download workspaces.

    Use a separate DB connection so the sweep never shares the API's connection
    across threads. A failed DB query must never be mistaken for zero references.
    A one-hour grace protects the gap between publishing a file and saving its
    analysis row. After expiry/orphan cleanup, an optional byte budget evicts
    remaining MP4s oldest-first. Unregistered fresh files keep their publication
    grace even when over budget. Only MP4s/download artifacts are managed, never
    symlinks. This is a sweep-time budget, not a filesystem admission limit.
    """
    now = time.time() if now is None else now
    retention_days = (positive_env_int("MEDIA_RETENTION_DAYS", 30)
                      if retention_days is None else retention_days)
    if retention_days <= 0:
        raise ValueError("retention_days must be positive")
    max_bytes = (non_negative_env_int("MEDIA_MAX_BYTES", 0)
                 if max_bytes is None else max_bytes)
    if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes < 0:
        raise ValueError("max_bytes must be a non-negative integer")
    result = {"deleted_files": 0, "deleted_downloads": 0, "bytes_freed": 0,
              "cleared_rows": 0, "failed_files": 0, "quota_deleted_files": 0,
              "total_bytes": 0, "max_bytes": max_bytes, "over_budget_bytes": 0}
    try:
        media_dir.stat()
    except FileNotFoundError:
        return result

    with media_lock(media_dir / ".maintenance.sqlite3") as maintenance:
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
            failed_names = set()

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
                    failed_names.add(path.name)
                    result["failed_files"] += 1
                    logger.exception("Could not remove cached media %s", path.name)

            # Count files rather than analysis rows: several rows may reference
            # the same MP4, and recent unreferenced files still consume space.
            files = _finalized_media_files(media_dir)
            total_bytes = sum(info.st_size for _, info in files)
            if max_bytes:
                for path, info in sorted(files, key=lambda item: (item[1].st_mtime, item[0].name)):
                    if total_bytes <= max_bytes:
                        break
                    if path.name in failed_names:
                        continue
                    if path.name not in active_names and now - info.st_mtime < ORPHAN_GRACE_SECONDS:
                        continue
                    try:
                        path.unlink()
                    except OSError:
                        result["failed_files"] += 1
                        logger.exception("Could not remove cached media %s", path.name)
                        continue
                    total_bytes -= info.st_size
                    result["deleted_files"] += 1
                    result["quota_deleted_files"] += 1
                    result["bytes_freed"] += info.st_size
            result["total_bytes"] = total_bytes
            result["over_budget_bytes"] = max(0, total_bytes - max_bytes) if max_bytes else 0

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
                try:
                    path.stat()
                except FileNotFoundError:
                    cursor = connection.execute(
                        "UPDATE analyses SET local_filename = '', media_file_size = 0, "
                        "updated_at = ? WHERE local_filename = ?", (timestamp, name),
                    )
                    result["cleared_rows"] += cursor.rowcount
            connection.commit()
            # Publish observability state only after the analysis updates commit.
            # Keeping it in the lock database shares it across API processes.
            _record_sweep(maintenance, now, result)
        finally:
            connection.close()
    if result["over_budget_bytes"]:
        logger.warning(
            "Media cache remains %s bytes over its %s-byte budget; "
            "protected fresh files or deletion failures will be retried next sweep",
            result["over_budget_bytes"], max_bytes,
        )
    logger.info("Media cache sweep: %s", result)
    return result
