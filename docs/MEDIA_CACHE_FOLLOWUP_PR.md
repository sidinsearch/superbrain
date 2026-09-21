# Suggested PR title

Add an offline media byte budget and authenticated cache monitoring

# Suggested PR description

Age-based retention can leave large volumes of recently downloaded MP4s on disk.
This adds `MEDIA_MAX_BYTES`: after expiry and orphan cleanup, each sweep evicts
the oldest finalized MP4s until usage is within the configured budget. The default
is `0` (disabled); invalid values warn and fall back to zero. For example,
`MEDIA_MAX_BYTES=10737418240` targets a 10 GiB MP4 cache.

Eviction uses the existing cross-process maintenance lock, updates media metadata
for delta sync, and preserves saved analyses and device copies. Newly published,
unreferenced files retain their one-hour grace period. Failed deletions are
attempted once per sweep while other candidates remain eligible; any remaining
excess is reported as `over_budget_bytes` and logged.

Operators can inspect the cache with `GET /admin/media-cache/stats` and trigger
cleanup with `POST /admin/media-cache/sweep`. Both require the existing access
token and run filesystem/database work off the event loop. Statistics include
file count, bytes, oldest/newest ages, budget excess, and the last completed sweep.
Sweep history persists across API workers and restarts. Unavailable operations
return 503; completed sweeps report individual deletion failures in their result.

Relative `MEDIA_PATH` values now resolve from the backend directory so the API
and download subprocesses use the same location regardless of their working
directory. Existing deployments using a relative path from another launch
directory should set an absolute path to preserve their cache location.

This is a budget applied at each sweep. It excludes active download workspaces
and other application storage, and usage can exceed it between sweeps or when
files cannot be evicted. At 50 MB/video, 1,000 videos use about 50 GB, and
100 videos/day over 14 days use about 70 GB before cleanup. Operators should allow
temporary-download headroom and use a volume quota when an absolute cap is needed.
Configuration, monitoring requests, and capacity guidance are documented in
`docs/OFFLINE_MEDIA.md`, the environment example, and Docker Compose.

Validation:

- Focused backend suite: 65 tests pass locally on Python 3.11, covering metadata,
  retention, media/admin endpoints, temporary
  download cleanup, and delta-sync pagination. Includes budget boundaries,
  eviction order, failed deletions, publication grace, persisted statistics,
  cross-process coordination, authentication, and relative-path consistency.
- Client: 33 Jest tests across five suites pass; application and test TypeScript
  checks pass.
- GitHub CI remains required before promotion to beta. Native playback and live
  provider downloads remain release smoke tests.

Target branch: `experimental/video-playback`.
