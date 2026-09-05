# Suggested PR title

Add offline video playback with server retention and regression coverage

# Suggested PR description

Saved Instagram reels and YouTube videos can be downloaded to the device and
played in a vertical feed. The backend serves MP4s through an authenticated
endpoint; the mobile app verifies local files, falls back to streaming, and
repairs missing device copies in the background.

The server cache now expires MP4s 30 days after saving, with cleanup at startup
and hourly thereafter. It also removes orphaned/deleted-post media and abandoned
download workspaces after a one-hour grace period. Publication is atomic and
coordinated with cleanup across processes; eviction updates database metadata
for delta sync while preserving downloaded device copies. Instagram's successful
analysis temporary-folder cleanup is restored.

Regression coverage includes endpoint authentication/traversal/404/MP4 delivery,
retention and process coordination, local/remote source selection and missing-file
recovery, device storage actions, and retention-aware SQLite sync. PR CI runs the
focused backend suite, Jest, and TypeScript checks. Native playback and live
provider downloads still require the usual device smoke tests.

Storage planning: at 50 MB/video, 100 retained videos use about 5 GB and 1,000 use
about 50 GB. At 10 videos/day, 30-day retention uses about 15 GB for final MP4s,
plus temporary/merge overhead. Retention limits age, not bytes; operators needing
an absolute disk cap should use a volume quota. `yt-dlp` remains in the image
(the review's roughly 50 MB increase is an estimate, not a measured build delta).
See `docs/OFFLINE_MEDIA.md` for settings, behavior, and validation commands.

Proposed promotion remains `experimental/video-playback` → `beta` → `main` after
maintainer review. This file is a local draft; it does not reopen or update PR #13.
