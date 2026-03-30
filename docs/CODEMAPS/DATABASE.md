# Database Codemap

**Last Updated:** 2026-03-31
**Database:** SQLite (file-based, self-hosted)

## Database File

- **Location:** `backend/superbrain.db`
- **Type:** SQLite with WAL mode for concurrent reads
- **Features:** Foreign keys enabled, automatic migrations

## Tables

### 1. Analyses Table

Stores analyzed content from Instagram, YouTube, and webpages.

```sql
CREATE TABLE analyses (
    shortcode           TEXT PRIMARY KEY,
    url                 TEXT,
    username            TEXT,
    content_type        TEXT DEFAULT 'instagram',
    analyzed_at         TEXT,
    updated_at          TEXT,
    post_date           TEXT,
    likes               INTEGER DEFAULT 0,
    thumbnail           TEXT DEFAULT '',
    title               TEXT,
    summary             TEXT,
    tags                TEXT,          -- JSON array
    music               TEXT,
    category            TEXT,
    visual_analysis     TEXT,
    audio_transcription TEXT,
    text_analysis       TEXT,
    is_hidden           INTEGER DEFAULT 0  -- soft delete
);
```

**Indexes:**
- `idx_analyses_category` - Category lookups
- `idx_analyses_analyzed_at` - Recent posts sorting
- `idx_analyses_content_type` - Content type filtering

### 2. Processing Queue Table

Manages pending and processing analyses.

```sql
CREATE TABLE processing_queue (
    shortcode   TEXT PRIMARY KEY,
    url         TEXT,
    status      TEXT DEFAULT 'queued',  -- queued, processing, retry
    position    INTEGER,
    added_at    TEXT,
    started_at  TEXT,
    updated_at  TEXT,
    retry_after TEXT,     -- for retry items
    attempts    INTEGER DEFAULT 0,
    reason      TEXT,     -- why retry is needed
    content_type TEXT
);
```

**Indexes:**
- `idx_queue_status` - Status filtering
- `idx_queue_position` - Queue ordering
- `idx_queue_retry` - Retry scheduling

### 3. Collections Table

User-created collections for organizing saved posts.

```sql
CREATE TABLE collections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT DEFAULT '📁',
    post_ids    TEXT DEFAULT '[]',  -- JSON array of shortcodes
    created_at  TEXT,
    updated_at  TEXT
);
```

**Default Collection:**
- `default_watch_later` - Auto-created "Watch Later" collection

## Database Operations

### Analyses

```python
# Save analysis
db.save_analysis(
    shortcode, url, username, title, summary,
    tags, music, category, visual_analysis,
    audio_transcription, text_analysis, content_type,
    thumbnail, post_date, likes
)

# Check cache
db.check_cache(shortcode) -> dict or None

# Get recent
db.get_recent(limit) -> List[dict]

# Get by category
db.get_by_category(category, limit) -> List[dict]

# Search by tags
db.search_tags(tags, limit) -> List[dict]

# Get stats
db.get_stats() -> {document_count, storage_mb, categories, capacity_used}

# Delete (soft)
db.delete_post(shortcode) -> bool

# Hard delete (for force re-analyze)
db.hard_delete_post(shortcode) -> bool

# Restore soft-deleted
db.restore_post(shortcode) -> bool

# Update post
db.update_post(shortcode, updates) -> bool
```

### Queue Operations

```python
# Add to queue
db.add_to_queue(shortcode, url) -> position

# Get queue
db.get_queue() -> List[dict]

# Get processing
db.get_processing() -> List[str]

# Mark processing
db.mark_processing(shortcode)

# Remove from queue
db.remove_from_queue(shortcode)

# Get retry queue
db.get_retry_queue() -> List[dict]

# Queue for retry
db.queue_for_retry(shortcode, url, content_type, reason, retry_hours)

# Get retry-ready
db.get_retry_ready() -> List[dict]

# Recover interrupted
db.recover_interrupted_items() -> count
```

### Collections

```python
# Get all collections
db.get_collections() -> List[Collection]

# Get single collection
db.get_collection(collection_id) -> Collection or None

# Upsert collection
db.upsert_collection(id, name, icon, post_ids, created_at, updated_at) -> Collection

# Update collection posts
db.update_collection_posts(collection_id, post_ids) -> bool

# Delete collection
db.delete_collection(collection_id) -> bool
```

## Database Connection

```python
# From core/database.py
from core.database import get_db

db = get_db()

# Check connection
if db.is_connected():
    # Perform operations
```

### Connection Parameters
- Database: SQLite (file-based)
- Location: `backend/superbrain.db`
- Mode: WAL (Write-Ahead Logging) for better concurrency
- Thread-safe: Yes (via `check_same_thread=False`)

## Migrations

The database supports automatic migrations for schema updates:

1. **content_type column** - Added for content type support
2. **thumbnail column** - Added for thumbnail storage
3. **retry columns** - Added for retry queue support (`retry_after`, `attempts`, `reason`, `content_type`)
4. **is_hidden column** - Added for soft-delete support

## Data Flow

```
API Request
    │
    ▼
┌─────────────────┐
│  Check Cache   │ ◄─── Analyses Table
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    │ Cache   │ No Analysis Needed
    │ Found   │    │
    ▼         ▼    ▼
Return Data  ┌─────────────────┐
              │  Not in Cache   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   Add to Queue │
              │ (processing_queue) │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Background      │
              │ Worker Thread   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Run Analysis    │
              │ (main.py)       │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Save to Cache   │
              │ (analyses table)│
              └─────────────────┘
```

## Storage Information

- **File Location:** `backend/superbrain.db`
- **Storage Format:** SQLite with WAL mode
- **Capacity:** Limited by disk space (no cloud limits)
- **Backup:** Export via `/export` endpoint to JSON or ZIP

## Related Areas

- [INDEX.md](INDEX.md) - Overall architecture
- [FRONTEND.md](FRONTEND.md) - Frontend details
- [BACKEND.md](BACKEND.md) - Backend details
