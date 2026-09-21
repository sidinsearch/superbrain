# Offline video storage and retention

The backend keeps a disposable MP4 cache in `MEDIA_PATH` (default:
`backend/media`). Docker Compose persists it in the `superbrain-media` volume.
Devices download their own copies. The app's Storage Manager controls device
storage; the server policy below controls the backend cache.

## Server policy

| Setting | Default | Meaning |
| --- | --- | --- |
| `MEDIA_PATH` | `backend/media` | Server cache directory. Relative paths resolve from the backend directory, regardless of the launch directory. Use a dedicated local filesystem directory. |
| `MEDIA_RETENTION_DAYS` | `30` | Delete MP4s this many days after their last successful save on the backend. |
| `MEDIA_CLEANUP_INTERVAL_SECONDS` | `3600` | Run cleanup at startup, then at this interval while the API runs. |
| `MEDIA_MAX_BYTES` | `0` | Finalized MP4 byte budget, enforced oldest-first at each sweep after age/orphan cleanup. `0` disables byte eviction. |

Retention days and the cleanup interval require positive integers. The byte budget
accepts non-negative integers. Invalid values use the defaults and produce a
warning; zero is a valid, silent opt-out for `MEDIA_MAX_BYTES`. Playback does
**not** extend retention or change eviction order. A new download or
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

When the byte budget is enabled, cleanup removes remaining MP4s in order of oldest
modification time, breaking ties by filename, until usage is within the budget.
All regular top-level MP4s count toward usage, including files still within the
publication grace period. An unreferenced file less than one hour old is protected
until its analysis can be saved; a file referenced by a visible analysis can be
evicted immediately if needed. Failed deletions are attempted once per sweep and
cleanup continues with other candidates. Protected or undeletable files can leave
the cache over budget, reported in `over_budget_bytes` and a warning log.

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

By default, retention limits age only. Enable a byte budget, for example
`MEDIA_MAX_BYTES=10737418240` for **10 GiB**, to evict older finalized MP4s even
before their retention period expires. Set it below the volume's capacity and
allow space for downloads and merge fragments, temporary copies, and the rest of
the application. With Docker Compose, set the value in `backend/.env` and
recreate the backend service; for local runs, export it before starting the API.

This is a **sweep-time cache budget**, not a filesystem quota or download admission
limit. Downloads can exceed it between sweeps, or while cleanup fails or the API
is stopped. Temporary workspaces, symlinks, and unrelated files are excluded from
the byte total. A sweep can remain over budget when publication grace or failed
deletions prevent eviction. Use a filesystem/volume quota when an absolute disk
cap is required, and monitor both cache statistics and filesystem free space.

When upgrading a deployment that previously used a relative `MEDIA_PATH` from
outside the backend directory, set an absolute path to the existing cache to
preserve its location. Relative values now consistently use the backend directory
for both the API and download subprocesses.

For illustration, assuming **50 MB per video** (decimal units):

| Retained videos | MP4 storage alone |
| ---: | ---: |
| 100 | 5 GB |
| 1,000 | 50 GB |
| 10,000 | 500 GB |

Steady-state retained MP4 storage is approximately:

`videos saved per day × average video size × retention days`

At 10 videos/day and 50 MB/video, 30 days retains about **15 GB**; at 100/day,
about **150 GB** without byte eviction. At 100 videos/day for 14 days, MP4s alone
would use **70 GB**. Choose a byte budget and retention period that fit the disk.
These are planning examples, not measured average sizes or hard limits.

`yt-dlp` remains in the backend dependencies and increases the Docker image size.
The review estimated roughly 50 MB; the actual layer delta has not been measured.
Analysis/downloads already run in `main.py` subprocesses, but those subprocesses
use the same image. A separately packaged download worker is a possible follow-up
and is not part of this retention change. Runtime media is excluded from Docker
build context so local cached videos are not copied into images.

## Monitoring and manual cleanup

Both endpoints use the same access token as the rest of the API. Use the
`X-API-Key` header. They always use the configured `MEDIA_PATH`, shared with
publication, playback, and scheduled cleanup; clients cannot select a directory
or override the server policy through these requests.

```sh
curl -H "X-API-Key: YOUR_TOKEN" http://localhost:5000/admin/media-cache/stats
curl -X POST -H "X-API-Key: YOUR_TOKEN" http://localhost:5000/admin/media-cache/sweep
```

`GET /admin/media-cache/stats` reports:

- `file_count` and `total_bytes`: current regular top-level MP4s.
- `oldest_age_days` and `newest_age_days`: age since save, clamped to zero for
  future timestamps; both are `null` for an empty cache.
- `max_bytes` and `over_budget_bytes`: configured budget and current excess;
  excess is zero when the budget is disabled.
- `last_sweep_at` and `last_sweep_result`: last completed sweep's UTC timestamp
  and result, or `null` before any sweep. State persists in the cache's
  `.maintenance.sqlite3` database across API workers and restarts.

`POST /admin/media-cache/sweep` runs cleanup immediately and returns its result:
`deleted_files`, `deleted_downloads`, `bytes_freed`, `cleared_rows`, `failed_files`,
`quota_deleted_files`, `total_bytes`, `max_bytes`, and `over_budget_bytes`.
`deleted_files` includes expired/orphaned MP4s, legacy fragments, and quota
evictions; `deleted_downloads` counts abandoned workspaces. `bytes_freed` counts
individually deleted files, excluding workspace contents.

Successful responses use `Cache-Control: no-store`. Missing or invalid tokens
return 401. If a request cannot read the cache or execute the sweep, it returns
503 and logs the underlying error. A completed sweep with individual deletion
failures returns 200 with nonzero `failed_files`, and may have nonzero
`over_budget_bytes`; it still updates the recorded sweep state. An aborted sweep
does not replace the previous completed result. Statistics do not trigger eviction.

## Regression tests

Backend tests need Python 3.11+ and the API's lightweight HTTP dependencies:

```sh
python -m pip install fastapi httpx python-multipart requests
python -m unittest backend.tests.test_media_metadata backend.tests.test_media_retention backend.tests.test_media_endpoint backend.tests.test_instagram_temp_cleanup backend.tests.test_sync_pagination -v
```

Tests use temporary databases and media directories; endpoint tests isolate the
API's token files and background workers. Retention tests cover expired/active
files, deleted posts, failed cleanup, active downloads, and process coordination,
plus byte budgets, publication grace, deterministic eviction, persisted statistics,
and authenticated admin requests.

Client tests use Node 22.13+ (the SQLite sync tests use Node's built-in SQLite):

```sh
cd superbrain-app
npm ci
npm test
npm run typecheck
```

Native media/filesystem APIs are mocked in Jest. Physical-device playback and
real Instagram/YouTube download smoke tests remain part of release validation.
