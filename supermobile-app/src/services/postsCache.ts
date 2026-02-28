import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post, FailedPost } from '../types';
import apiService from './api';

const POSTS_CACHE_KEY = '@superbrain_posts_cache';
const CACHE_TIMESTAMP_KEY = '@superbrain_posts_timestamp';
const ANALYZING_POSTS_KEY = '@superbrain_analyzing_posts';
const FAILED_POSTS_KEY = '@superbrain_failed_posts';
const PENDING_MUTATIONS_KEY = '@superbrain_pending_post_mutations';
const PENDING_ANALYSES_KEY  = '@superbrain_pending_analyses';

type PendingPostMutation =
  | { type: 'delete'; shortcode: string }
  | { type: 'update'; shortcode: string; updates: Record<string, string> };

type PendingAnalysis = {
  url:           string;
  shortcode:     string;
  title:         string;
  thumbnail_url?: string;
  content_type?: string;
  queuedAt:      string;
};
// Keep cache for 30 minutes — background refresh happens anyway when
// analyzing posts exist, so long TTL just prevents unnecessary server
// round-trips when showing already-up-to-date data.
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

class PostsCacheService {
  private analyzingPosts: Set<string> = new Set();

  // ── In-memory hot cache ──────────────────────────────────────────────────
  private posts: Post[] | null = null;
  private cacheTimestamp: number = 0;
  private failedPostsCache: FailedPost[] | null = null;
  // Offline mutation queue — flushed next time online
  private pendingMutationsList: PendingPostMutation[] = [];
  // Offline analysis queue — URLs that couldn't reach backend, retried on reconnect
  private pendingAnalysesList: PendingAnalysis[] = [];

  constructor() {
    this.preWarm();
  }

  private async preWarm(): Promise<void> {
    try {
      const [postsRaw, tsRaw, analyzingRaw, failedRaw, pendingRaw, pendingAnalysesRaw] = await Promise.all([
        AsyncStorage.getItem(POSTS_CACHE_KEY),
        AsyncStorage.getItem(CACHE_TIMESTAMP_KEY),
        AsyncStorage.getItem(ANALYZING_POSTS_KEY),
        AsyncStorage.getItem(FAILED_POSTS_KEY),
        AsyncStorage.getItem(PENDING_MUTATIONS_KEY),
        AsyncStorage.getItem(PENDING_ANALYSES_KEY),
      ]);
      if (postsRaw) this.posts = JSON.parse(postsRaw);
      if (tsRaw) this.cacheTimestamp = parseInt(tsRaw, 10);
      if (analyzingRaw) this.analyzingPosts = new Set(JSON.parse(analyzingRaw));
      if (failedRaw) this.failedPostsCache = JSON.parse(failedRaw);
      if (pendingRaw) this.pendingMutationsList = JSON.parse(pendingRaw);
      if (pendingAnalysesRaw) this.pendingAnalysesList = JSON.parse(pendingAnalysesRaw);
    } catch (e) {
      console.error('PostsCache preWarm error:', e);
    }
  }

  /** Queue a post delete/update to be flushed when online. */
  async enqueuePendingMutation(m: PendingPostMutation): Promise<void> {
    // De-duplicate: replace older entry with same type+shortcode
    this.pendingMutationsList = this.pendingMutationsList.filter(
      x => !(x.type === m.type && x.shortcode === m.shortcode)
    );
    this.pendingMutationsList.push(m);
    try {
      await AsyncStorage.setItem(PENDING_MUTATIONS_KEY, JSON.stringify(this.pendingMutationsList));
    } catch { /* best effort */ }
  }

  /** Replay queued post mutations. Removes ones that succeed or get 4xx. Keeps network failures. */
  async flushPendingPostMutations(): Promise<void> {
    if (this.pendingMutationsList.length === 0) return;
    console.log(`[PostsCache] flushing ${this.pendingMutationsList.length} pending mutation(s)`);
    const remaining: PendingPostMutation[] = [];
    for (const m of this.pendingMutationsList) {
      try {
        if (m.type === 'delete') {
          await apiService.deletePost(m.shortcode);
        } else if (m.type === 'update') {
          await apiService.updatePost(m.shortcode, m.updates);
        }
      } catch (e: any) {
        if (!e?.response) remaining.push(m); // network error — retry next time
        // HTTP error (4xx/5xx) = discard
      }
    }
    this.pendingMutationsList = remaining;
    try {
      if (remaining.length === 0) {
        await AsyncStorage.removeItem(PENDING_MUTATIONS_KEY);
      } else {
        await AsyncStorage.setItem(PENDING_MUTATIONS_KEY, JSON.stringify(remaining));
      }
    } catch { /* best effort */ }
  }

  hasPendingMutations(): boolean {
    return this.pendingMutationsList.length > 0;
  }

  // ─── Pending analysis queue (offline share → retry when reconnected) ────────

  /** Queue a URL for analysis that couldn't reach the backend (offline). */
  async enqueuePendingAnalysis(a: PendingAnalysis): Promise<void> {
    // De-duplicate by shortcode
    this.pendingAnalysesList = this.pendingAnalysesList.filter(x => x.shortcode !== a.shortcode);
    this.pendingAnalysesList.push(a);
    try {
      await AsyncStorage.setItem(PENDING_ANALYSES_KEY, JSON.stringify(this.pendingAnalysesList));
    } catch { /* best effort */ }
  }

  /**
   * Replay queued analyses. For each URL:
   *   - Success / 202-quota → remove from queue, markAnalysisComplete so watcher picks it up
   *   - Network error       → keep in queue, placeholder stays alive
   *   - Other HTTP error    → discard (invalid URL etc.), mark failed
   */
  async flushPendingAnalyses(): Promise<void> {
    if (this.pendingAnalysesList.length === 0) return;
    console.log(`[PostsCache] flushing ${this.pendingAnalysesList.length} pending analysis/analyses`);
    const remaining: PendingAnalysis[] = [];
    for (const a of this.pendingAnalysesList) {
      try {
        await apiService.analyzeInstagramUrl(a.url);
        // Success: watcher will detect completion via getRecentPosts
        await this.markAnalysisComplete(a.shortcode);
      } catch (e: any) {
        if (e?.isRetryQueued) {
          // Backend accepted it (202) — backend handles retry, we're done
          await this.markAnalysisComplete(a.shortcode);
        } else if (!e?.response) {
          // Still offline — keep queued, leave analyzing placeholder alive
          remaining.push(a);
        } else {
          // HTTP error — discard, mark as failed so user can see it
          await this.markAnalysisComplete(a.shortcode);
          await this.markAsFailed(a.shortcode, a.url, a.title, a.thumbnail_url, a.content_type);
        }
      }
    }
    this.pendingAnalysesList = remaining;
    try {
      if (remaining.length === 0) await AsyncStorage.removeItem(PENDING_ANALYSES_KEY);
      else await AsyncStorage.setItem(PENDING_ANALYSES_KEY, JSON.stringify(remaining));
    } catch { /* best effort */ }
  }

  hasPendingAnalyses(): boolean {
    return this.pendingAnalysesList.length > 0;
  }

  /**
   * Mark a post as currently being analyzed
   */
  async markAsAnalyzing(shortcode: string): Promise<void> {
    try {
      this.analyzingPosts.add(shortcode);
      await AsyncStorage.setItem(
        ANALYZING_POSTS_KEY, 
        JSON.stringify(Array.from(this.analyzingPosts))
      );
    } catch (error) {
      console.error('Error marking post as analyzing:', error);
    }
  }

  /**
   * Mark a post as analysis complete
   */
  async markAnalysisComplete(shortcode: string): Promise<void> {
    try {
      this.analyzingPosts.delete(shortcode);
      await AsyncStorage.setItem(
        ANALYZING_POSTS_KEY, 
        JSON.stringify(Array.from(this.analyzingPosts))
      );
    } catch (error) {
      console.error('Error marking analysis complete:', error);
    }
  }

  /**
   * Check if a post is currently being analyzed
   */
  isAnalyzing(shortcode: string): boolean {
    return this.analyzingPosts.has(shortcode);
  }

  /**
   * Get all analyzing posts
   */
  getAnalyzingPosts(): string[] {
    return Array.from(this.analyzingPosts);
  }
  /**
   * Save posts to local cache — updates memory first for instant reads,
   * then persists to AsyncStorage.
   */
  async savePosts(posts: Post[]): Promise<void> {
    this.posts = posts;
    this.cacheTimestamp = Date.now();
    try {
      await AsyncStorage.multiSet([
        [POSTS_CACHE_KEY, JSON.stringify(posts)],
        [CACHE_TIMESTAMP_KEY, this.cacheTimestamp.toString()],
      ]);
    } catch (error) {
      console.error('Error saving posts to cache:', error);
    }
  }

  /**
   * Get cached posts — served from memory (instant, no I/O).
   */
  async getCachedPosts(): Promise<Post[] | null> {
    if (this.posts !== null) return this.posts;
    // Fallback: preWarm may not have finished yet on very first call
    try {
      const cached = await AsyncStorage.getItem(POSTS_CACHE_KEY);
      if (cached) {
        this.posts = JSON.parse(cached);
        return this.posts;
      }
    } catch {}
    return null;
  }

  /**
   * Check if cache is still valid — synchronous in-memory check, no I/O.
   */
  isCacheValid(): boolean {
    if (!this.cacheTimestamp) return false;
    return (Date.now() - this.cacheTimestamp) < CACHE_DURATION;
  }

  /**
   * @deprecated Use isCacheValid() (sync) instead.
   */
  async isCacheValidAsync(): Promise<boolean> {
    return this.isCacheValid();
  }

  /**
   * Get posts from cache if valid, otherwise return null.
   */
  async getValidCachedPosts(): Promise<Post[] | null> {
    if (!this.isCacheValid()) return null;
    return this.getCachedPosts();
  }

  /**
   * Clear the cache (both memory and AsyncStorage).
   */
  async clearCache(): Promise<void> {
    this.posts = null;
    this.cacheTimestamp = 0;
    try {
      await AsyncStorage.multiRemove([POSTS_CACHE_KEY, CACHE_TIMESTAMP_KEY]);
    } catch (error) {
      console.error('Error clearing posts cache:', error);
    }
  }

  /**
   * Update a single post in cache.
   */
  async updatePostInCache(updatedPost: Post): Promise<void> {
    try {
      const posts = await this.getCachedPosts();
      if (!posts) return;
      const index = posts.findIndex(p => p.shortcode === updatedPost.shortcode);
      if (index !== -1) {
        posts[index] = updatedPost;
        await this.savePosts(posts);
      }
    } catch (error) {
      console.error('Error updating post in cache:', error);
    }
  }

  /**
   * Remove a post from cache.
   */
  async removePostFromCache(shortcode: string): Promise<void> {
    try {
      const posts = await this.getCachedPosts();
      if (!posts) return;
      await this.savePosts(posts.filter(p => p.shortcode !== shortcode));
    } catch (error) {
      console.error('Error removing post from cache:', error);
    }
  }

  // ─── Failed posts ────────────────────────────────────────────────────────────

  /** Returns failed posts from memory (instant) or AsyncStorage on first call. */
  async getFailedPosts(): Promise<FailedPost[]> {
    if (this.failedPostsCache !== null) return this.failedPostsCache;
    try {
      const stored = await AsyncStorage.getItem(FAILED_POSTS_KEY);
      this.failedPostsCache = stored ? (JSON.parse(stored) as FailedPost[]) : [];
      return this.failedPostsCache;
    } catch {
      return [];
    }
  }

  async markAsFailed(
    shortcode: string,
    url: string,
    title: string,
    thumbnail_url?: string,
    content_type?: string,
  ): Promise<void> {
    try {
      const existing = await this.getFailedPosts();
      const entry: FailedPost = { shortcode, url, title: title || url, thumbnail_url, content_type, failedAt: new Date().toISOString() };
      this.failedPostsCache = [entry, ...existing.filter(p => p.shortcode !== shortcode)];
      await AsyncStorage.setItem(FAILED_POSTS_KEY, JSON.stringify(this.failedPostsCache));
    } catch (error) {
      console.error('Error marking post as failed:', error);
    }
  }

  async removeFailed(shortcode: string): Promise<void> {
    try {
      const existing = await this.getFailedPosts();
      this.failedPostsCache = existing.filter(p => p.shortcode !== shortcode);
      await AsyncStorage.setItem(FAILED_POSTS_KEY, JSON.stringify(this.failedPostsCache));
    } catch (error) {
      console.error('Error removing failed post:', error);
    }
  }
}

export default new PostsCacheService();
