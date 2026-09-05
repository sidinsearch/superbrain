# Offline video storage and retention

The backend keeps a disposable MP4 cache in `MEDIA_PATH` (default:
`backend/media`). Docker Compose persists it in the `superbrain-media` volume.
Devices download their own copies. The app's Storage Manager controls device
storage; the server policy below controls the backend cache.

## Server policy

| Setting | Default | Meaning |
| --- | --- | --- |
| `MEDIA_PATH` | `backend/media` | Server cache directory; use a dedicated local filesystem directory. |
| `MEDIA_RETENTION_DAYS` | `30` | Delete MP4s this many days after their last successful save on the backend. |
| `MEDIA_CLEANUP_INTERVAL_SECONDS` | `3600` | Run cleanup at startup, then at this interval while the API runs. |

Both numeric settings require positive integers. Invalid values use the defaults
and produce a warning. Playback does **not** extend retention. A new download or
re-analysis starts a new retention period. Expired media is removed even if the
analysis remains saved. Age is based on the file's modification timestamp, set
at publication; existing files use their current timestamps on the first sweep.

Cleanup also removes MP4s that no visible database row references, including
soft-deleted posts, once the file is at least one hour old. This grace period
protects a new file while its analysis is being saved. Abandoned `.download-*`
workspaces and legacy download fragments are eligible after an hour. Active
workspaces hold a lease and are skipped. Unrelated files and symlinks are ignored.

Complete files are published atomically from private workspaces. A SQLite lock
coordinates publication and cleanup across API workers and analysis subprocesses.
Cleanup uses a separate database connection and skips deletion if it cannot read
the database. Failed deletions are logged and retried on the next sweep.

After a file is deleted or found missing, its database `local_filename` and
`media_file_size` are cleared and `updated_at` is advanced for delta sync. Titles,
summaries, tags, and original links remain. A deleted server URL returns 404;
streaming/downloading it again requires re-analysis of the original post. Device
copies remain playable after server expiry and can be removed through Storage
Manager. Device files removed by the OS fall back to remote playback and trigger
a background recovery download when server media is available.

Normal Instagram analysis now removes its temporary source folder after a
successful database save. Failed analyses retain temporary files for recovery.
Older versions left those folders behind: review existing `backend/temp` usage
separately when upgrading. This policy does not manage that directory, uploads,
thumbnails, logs, or database size.

## Capacity planning

Retention limits **age, not total disk usage**. A burst of downloads can still
fill the disk before expiry. Allow space for retained MP4s, downloads and merge
fragments, temporary copies, and the rest of the application. Cleanup can lag the
age limit by one sweep interval, or longer while the API is stopped or cleanup
fails. Use a filesystem/volume quota when an absolute disk cap is required.

For illustration, assuming **50 MB per video** (decimal units):

| Retained videos | MP4 storage alone |
| ---: | ---: |
| 100 | 5 GB |
| 1,000 | 50 GB |
| 10,000 | 500 GB |

Steady-state retained MP4 storage is approximately:

`videos saved per day × average video size × retention days`

At 10 videos/day and 50 MB/video, 30 days retains about **15 GB**; at 100/day,
about **150 GB**. Choose a shorter retention period for smaller disks. These are
planning examples, not measured average sizes or hard limits.

`yt-dlp` remains in the backend dependencies and increases the Docker image size.
The review estimated roughly 50 MB; the actual layer delta has not been measured.
Analysis/downloads already run in `main.py` subprocesses, but those subprocesses
use the same image. A separately packaged download worker is a possible follow-up
and is not part of this retention change. Runtime media is excluded from Docker
build context so local cached videos are not copied into images.

## Regression tests

Backend tests need Python 3.11+ and the API's lightweight HTTP dependencies:

```sh
python -m pip install fastapi httpx python-multipart requests
python -m unittest backend.tests.test_media_metadata backend.tests.test_media_retention backend.tests.test_media_endpoint backend.tests.test_instagram_temp_cleanup backend.tests.test_sync_pagination -v
```

Tests use temporary databases and media directories; endpoint tests isolate the
API's token files and background workers. Retention tests cover expired/active
files, deleted posts, failed cleanup, active downloads, and process coordination.

Client tests use Node 22.13+ (the SQLite sync tests use Node's built-in SQLite):

```sh
cd superbrain-app
npm ci
npm test
npm run typecheck
```

Native media/filesystem APIs are mocked in Jest. Physical-device playback and
real Instagram/YouTube download smoke tests remain part of release validation.
