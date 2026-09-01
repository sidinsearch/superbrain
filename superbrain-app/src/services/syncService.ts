/**
 * Sync service — orchestrates data flow between the backend API and localDb.
 *
 * Strategy:
 *   1. On first launch (empty local DB) → fullSync() fetches ALL posts in batches
 *   2. On subsequent opens → deltaSync() fetches only changed posts since last sync
 *   3. UI always reads from localDb — sync runs non-blocking in the background
 */

import localDb from './localDb';
import apiService from './api';
import { Post } from '../types';
import { TaxonomyPayload, isTaxonomyApiActive } from './taxonomySupport';

const BATCH_SIZE = 200; // posts per batch during full sync
const OFFLINE_SEARCH_SCHEMA_VERSION = 'offline-search-v1';

// ─── Full sync ─────────────────────────────────────────────────────

/**
 * Fetch ALL posts from backend in batches and store in local DB.
 * Called on first ever launch or after a database reset.
 * Returns total number of posts synced.
 */
async function fullSync(): Promise<number> {
  let offset = 0;
  let totalSynced = 0;
  let serverTotal = Infinity;

  while (offset < serverTotal) {
    const result = await apiService.getRecentPostsPaginated(BATCH_SIZE, offset);
    if (!result || result.data.length === 0) break;

    serverTotal = result.total;
    await localDb.upsertPosts(result.data);
    totalSynced += result.data.length;
    offset += result.data.length;
  }

  // Record sync time
  await localDb.setLastSyncTime(new Date().toISOString());

  console.log(`[Sync] Full sync complete: ${totalSynced} posts`);
  return totalSynced;
}

// ─── Delta sync ────────────────────────────────────────────────────

/**
 * Fetch only posts that changed since last sync.
 * Also fetches deleted shortcodes and removes them locally.
 * Returns number of posts updated.
 */
async function deltaSync(): Promise<number> {
  const since = await localDb.getLastSyncTime();
  if (!since) {
    // No sync time → fall back to full sync
    return fullSync();
  }

  // Fetch every changed row before advancing the cursor. A single delta can
  // exceed the server's page size after a large playlist import.
  //
  // `/sync` now honors `offset` and returns real `has_more` (backend/api.py),
  // but the client stays defensive against any server that doesn't — an
  // `offset`-blind `/sync` would return the same page forever, and
  // `hasMore`'s length-based fallback would never go false. Two independent
  // safety nets, both against a server that ignores/lacks `offset` support:
  //   1. Hard cap on page count — always terminates regardless of server behavior.
  //   2. Non-advancing-cursor detection — if consecutive pages start with the
  //      same post, the server isn't honoring `offset`; stop and warn rather
  //      than loop forever accumulating duplicates.
  // Either safety net stopping early leaves `paginationComplete` false, so the
  // cursor doesn't advance and the next sync retries the same window — no
  // permanent stall, just a delayed catch-up once offset support is correct.
  const MAX_SYNC_PAGES = 50; // 50 * BATCH_SIZE(200) = 10,000 posts per delta sync
  const changedPosts: Post[] = [];
  let offset = 0;
  let previousFirstShortcode: string | undefined;
  let paginationComplete = false;
  for (let pageNum = 0; pageNum < MAX_SYNC_PAGES; pageNum++) {
    const page = await apiService.syncPosts(since, BATCH_SIZE, offset);
    if (page.failed) {
      console.warn('[Sync] Delta sync page fetch failed — stopping this cycle without advancing the cursor');
      break;
    }
    if (page.data.length === 0) {
      paginationComplete = true;
      break;
    }
    const firstShortcode = page.data[0].shortcode;
    if (firstShortcode === previousFirstShortcode) {
      console.warn(
        '[Sync] Pagination cursor did not advance (server may not support offset) — stopping delta sync early'
      );
      break;
    }
    previousFirstShortcode = firstShortcode;
    changedPosts.push(...page.data);
    offset += page.data.length;
    if (!page.hasMore) {
      paginationComplete = true;
      break;
    }
  }
  if (!paginationComplete) {
    console.warn(
      `[Sync] Delta sync stopped before fetching all changes (page cap, non-advancing cursor, or fetch failure) — ` +
      `lastSyncTime will NOT advance, so the next sync retries this same window from '${since}'.`
    );
  }

  // Filter out hidden (soft-deleted) posts for upsert; delete them locally instead
  const toUpsert: Post[] = [];
  const toDeleteFromSync: string[] = [];
  for (const p of changedPosts) {
    if ((p as any).is_hidden === 1) {
      toDeleteFromSync.push(p.shortcode);
    } else {
      toUpsert.push(p);
    }
  }

  if (toUpsert.length > 0) {
    await localDb.upsertPosts(toUpsert);
  }

  // Fetch explicitly deleted posts
  const deletedItems = await apiService.getSyncDeleted(since);
  const deletedShortcodes = [
    ...toDeleteFromSync,
    ...deletedItems.map(d => d.shortcode),
  ];
  if (deletedShortcodes.length > 0) {
    await localDb.deletePosts(deletedShortcodes);
  }

  // Update sync cursor — only when pagination genuinely completed. Advancing
  // this after an incomplete cycle (page cap / non-advancing cursor) would
  // permanently skip whatever changes existed past the point sync stopped.
  if (paginationComplete) {
    await localDb.setLastSyncTime(new Date().toISOString());
  }

  const totalChanges = toUpsert.length + deletedShortcodes.length;
  if (totalChanges > 0) {
    console.log(`[Sync] Delta sync: ${toUpsert.length} upserted, ${deletedShortcodes.length} deleted`);
  }
  return totalChanges;
}

// ─── Smart sync entry point ────────────────────────────────────────

/**
 * Decides whether to do a full or delta sync.
 * - Empty local DB → full sync
 * - forceFull → full sync only when GET /taxonomy is active (taxonomy-aware
 *   servers / pull-to-refresh after migrations). Without taxonomy, forceFull
 *   is ignored so behavior matches upstream mainline (delta only).
 * - taxonomy_version change → full sync (no-op when endpoint absent)
 * - Has data → delta sync
 *
 * Accepts an optional pre-fetched taxonomy payload so callers that already
 * fetched GET /taxonomy do not trigger a redundant round-trip.
 * Returns true if any data changed.
 */
async function syncIfNeeded(
  forceFull: boolean = false,
  prefetchedTaxonomy?: TaxonomyPayload | null,
): Promise<boolean> {
  try {
    const empty = await localDb.isEmpty();
    let taxonomyChanged = false;
    let taxonomyVersion = '';
    let taxonomyActive = false;
    const localSearchSchemaVersion = await localDb.getSyncMeta('offline_search_schema_version');
    const searchSchemaChanged = localSearchSchemaVersion !== OFFLINE_SEARCH_SCHEMA_VERSION;
    try {
      const taxonomy = prefetchedTaxonomy !== undefined
        ? prefetchedTaxonomy
        : await apiService.getTaxonomy();
      taxonomyActive = isTaxonomyApiActive(taxonomy);
      taxonomyVersion = taxonomyActive ? (taxonomy?.taxonomy_version || '') : '';
      if (taxonomyVersion) {
        const localVersion = await localDb.getSyncMeta('taxonomy_version');
        taxonomyChanged = localVersion !== taxonomyVersion;
        if (taxonomyChanged) {
          console.log(
            `[Sync] Taxonomy version changed (${localVersion || 'none'} → ${taxonomyVersion}); forcing full sync`
          );
        }
      }
    } catch {
      /* offline / taxonomy endpoint unavailable — upstream path */
    }

    const effectiveForceFull = forceFull && taxonomyActive;

    if (empty || effectiveForceFull || taxonomyChanged || searchSchemaChanged) {
      const count = await fullSync();
      if (taxonomyVersion) {
        await localDb.setSyncMeta('taxonomy_version', taxonomyVersion);
      }
      await localDb.setSyncMeta('offline_search_schema_version', OFFLINE_SEARCH_SCHEMA_VERSION);
      return count > 0;
    } else {
      const changes = await deltaSync();
      return changes > 0;
    }
  } catch (error) {
    console.warn('[Sync] Sync failed (will retry later):', error);
    return false;
  }
}

// ─── Export ─────────────────────────────────────────────────────────

const syncService = {
  fullSync,
  deltaSync,
  syncIfNeeded,
};

export default syncService;
