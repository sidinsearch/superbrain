import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post, ApiResponse, QueueStatus, DatabaseStats, RetryQueueItem, Collection } from '../types';
import { TaxonomyPayload } from './taxonomySupport';

const ACCESS_TOKEN_LENGTH = 8;

// Request timeouts
const DEFAULT_TIMEOUT = 10000; // 10s for reads
const ANALYSIS_TIMEOUT = 60000; // 60s for analysis (subprocess)
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY = 1000; // 1s, doubles each retry

function normalizeAccessToken(token: string | null): string | null {
  if (!token) {
    return null;
  }
  const sanitized = token.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (sanitized.length !== ACCESS_TOKEN_LENGTH) {
    return null;
  }
  return sanitized;
}

/** Normalise a raw API post so that thumbnail_url always resolves to an image. */
function normalizePost(p: any): Post {
  const post = { ...p } as Post;
  // Backend sends `thumbnail`; frontend UI uses `thumbnail_url`
  if (!post.thumbnail_url && post.thumbnail) {
    post.thumbnail_url = post.thumbnail;
  }
  const localUri = post.local_uri || post.local_media_uri;
  post.local_filename = post.local_filename || undefined;
  post.media_file_size = Number(post.media_file_size || 0);
  post.local_uri = localUri || undefined;
  post.local_media_uri = localUri || undefined;
  post.media_downloaded_at = post.media_downloaded_at || undefined;
  post.visual_analysis = post.visual_analysis || undefined;
  post.audio_transcription = post.audio_transcription || post.transcribed_text || post.transcript || post.transcription || undefined;
  post.text_analysis = post.text_analysis || undefined;
  post.transcribed_text = post.audio_transcription;
  post.transcript = post.audio_transcription;
  post.transcription = post.audio_transcription;
  return post;
}

class ApiService {
  private apiToken: string | null = null;
  // Default only for development/fallback; user must explicitly configure for production use
  private apiUrl: string = '';

  async initialize() {
    const storedToken = await AsyncStorage.getItem('apiToken');
    const normalizedToken = normalizeAccessToken(storedToken);
    this.apiToken = normalizedToken;
    if (storedToken && !normalizedToken) {
      await AsyncStorage.removeItem('apiToken');
    }
    const savedUrl = await AsyncStorage.getItem('apiUrl');
    if (savedUrl) {
      this.apiUrl = savedUrl;
    } else {
      // Use env var if set, otherwise empty for first-time setup
      this.apiUrl = process.env.EXPO_PUBLIC_API_URL || '';
    }
  }

  public get currentApiUrl(): string {
    return this.apiUrl || process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
  }

  async setApiToken(token: string) {
    const normalizedToken = normalizeAccessToken(token);
    if (!normalizedToken) {
      throw new Error('Access Token must be 8 alphanumeric characters');
    }
    this.apiToken = normalizedToken;
    await AsyncStorage.setItem('apiToken', normalizedToken);
  }

  async setApiUrl(url: string) {
    this.apiUrl = url;
    await AsyncStorage.setItem('apiUrl', url);
  }

  async getApiToken(): Promise<string | null> {
    if (!this.apiToken) {
      const storedToken = await AsyncStorage.getItem('apiToken');
      const normalizedToken = normalizeAccessToken(storedToken);
      this.apiToken = normalizedToken;
      if (storedToken && !normalizedToken) {
        await AsyncStorage.removeItem('apiToken');
      }
    }
    return this.apiToken;
  }

  async getBaseUrl(): Promise<string> {
    // Use in-memory cached URL if available to avoid redundant AsyncStorage reads
    if (this.apiUrl) return this.apiUrl;
    const savedUrl = await AsyncStorage.getItem('apiUrl');
    if (savedUrl) {
      this.apiUrl = savedUrl;
    }
    return this.apiUrl;
  }

  async getMediaUrl(filename: string): Promise<string> {
    const baseUrl = (await this.getBaseUrl()).replace(/\/+$/, '');
    return `${baseUrl}/api/v1/media/${encodeURIComponent(filename)}`;
  }

  async getMediaDownloadHeaders(): Promise<Record<string, string>> {
    const token = await this.getApiToken();
    if (!token) {
      throw new Error('Access Token not configured');
    }
    return { 'X-API-Key': token };
  }

  /**
   * Retry helper: retries transient network failures with exponential backoff.
   * Only retries on timeout, network error, or 5xx — never on 4xx or auth errors.
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const isRetryable =
          error.code === 'ECONNABORTED' || // timeout
          error.code === 'ERR_NETWORK' || // network unreachable
          (error.response?.status && error.response.status >= 500);
        if (!isRetryable || attempt >= retries) break;
        await new Promise(r => setTimeout(r, RETRY_BASE_DELAY * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  }

  private async getHeaders() {
    const token = await this.getApiToken();
    if (!token) {
      throw new Error('Access Token not configured');
    }
    return {
      'X-API-Key': token,
      'Content-Type': 'application/json',
    };
  }

  async reanalyzePost(url: string): Promise<ApiResponse> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post<ApiResponse>(
        `${baseUrl}/analyze`,
        { url, force: true },
        { headers, timeout: ANALYSIS_TIMEOUT }
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 503) {
        return {
          success: false,
          cached: false,
          error: error.response.data.detail || 'Request queued',
        };
      }
      throw error;
    }
  }

  async analyzePost(url: string): Promise<ApiResponse> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post<ApiResponse>(
        `${baseUrl}/analyze`,
        { url },
        { headers, timeout: ANALYSIS_TIMEOUT }
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 503) {
        // Queued - return special response
        return {
          success: false,
          cached: false,
          error: error.response.data.detail || 'Request queued',
        };
      }
      throw error;
    }
  }

  async getPostInfo(url: string): Promise<{ shortcode: string; username: string; title: string; full_caption: string }> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get(
        `${baseUrl}/caption`,
        { 
          headers,
          params: { url }
        }
      );
      
      if (response.data.success) {
        return {
          shortcode: response.data.shortcode || '',
          username: response.data.username || '',
          title: response.data.title || 'Instagram Post',
          full_caption: ''
        };
      }
      
      return {
        shortcode: '',
        username: '',
        title: 'Instagram Post',
        full_caption: ''
      };
    } catch (error: any) {
      console.error('Error fetching post caption:', error);
      return {
        shortcode: '',
        username: '',
        title: 'Instagram Post',
        full_caption: ''
      };
    }
  }

  async analyzeInstagramUrl(url: string): Promise<Post> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post<ApiResponse>(
        `${baseUrl}/analyze`,
        { url },
        { headers, timeout: ANALYSIS_TIMEOUT }
      );
      
      if (response.data.success && response.data.data) {
        return normalizePost(response.data.data);
      }
      
      throw new Error('Failed to analyze post');
    } catch (error: any) {
        console.error('Error analyzing URL:', error.response?.data || error.message);
        // 202 = quota exhausted, queued for automatic retry
        if (error.response?.status === 202) {
          const err = new Error('QUEUED_FOR_RETRY') as any;
          err.isRetryQueued = true;
          err.detail = error.response.data?.detail || 'Queued for retry tomorrow';
          throw err;
        }
          const isNetworkIssue = !error.response || error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK' || error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('timeout');
          const isQueueStatus = error.response?.status === 502 || error.response?.status === 503 || error.response?.status === 504;
          
          if (isQueueStatus || isNetworkIssue) {
          error.isServerQueued = true;
          throw error;
        }
      throw error;
    }
  }

  async getPosts(): Promise<Post[]> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ success: boolean; data: Post[] }>(
        `${baseUrl}/recent?limit=200`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return (response.data.data || []).map(normalizePost);
    } catch (error: any) {
      console.error('Error fetching all posts:', error.response?.data?.detail || error.message);
      return [];
    }
  }

  async getRecentPosts(limit: number = 50): Promise<Post[]> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      return await this.withRetry(async () => {
        const response = await axios.get<{ success: boolean; data: Post[] }>(
          `${baseUrl}/recent?limit=${limit}`,
          { headers, timeout: DEFAULT_TIMEOUT }
        );
        return (response.data.data || []).map(normalizePost);
      });
    } catch (error: any) {
      console.error('Error fetching posts:', error.response?.data?.detail || error.message);
      return [];
    }
  }

  /**
   * Paginated fetch — returns { data, total, offset } for batch-syncing all posts.
   */
  async getRecentPostsPaginated(
    limit: number = 200,
    offset: number = 0
  ): Promise<{ data: Post[]; total: number; offset: number }> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{
        success: boolean; data: Post[]; total: number; offset: number
      }>(
        `${baseUrl}/recent?limit=${limit}&offset=${offset}`,
        { headers, timeout: 30000 }
      );
      return {
        data: (response.data.data || []).map(normalizePost),
        total: response.data.total ?? 0,
        offset: response.data.offset ?? offset,
      };
    } catch (error: any) {
      console.error('Error fetching paginated posts:', error.response?.data?.detail || error.message);
      return { data: [], total: 0, offset };
    }
  }

  /**
   * Delta sync — returns posts modified after the given ISO timestamp.
   */
  async syncPosts(
    since: string,
    limit: number = 200,
    offset: number = 0,
  ): Promise<{ data: Post[]; hasMore: boolean; failed?: boolean }> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{
        success: boolean; data: Post[]; has_more?: boolean
      }>(
        `${baseUrl}/sync?since=${encodeURIComponent(since)}&limit=${limit}&offset=${offset}`,
        { headers, timeout: 30000 }
      );
      const data = (response.data.data || []).map(normalizePost);
      return {
        data,
        hasMore: response.data.has_more ?? data.length === limit,
      };
    } catch (error: any) {
      console.error('Error syncing posts:', error.response?.data?.detail || error.message);
      // `failed: true` distinguishes a transient fetch error from a legitimate
      // empty/final page — callers must not treat this as "sync complete".
      return { data: [], hasMore: false, failed: true };
    }
  }

  /**
   * Deleted sync — returns shortcodes of posts deleted after the given timestamp.
   */
  async getSyncDeleted(since: string): Promise<Array<{ shortcode: string; deleted_at: string }>> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{
        success: boolean; data: Array<{ shortcode: string; deleted_at: string }>
      }>(
        `${baseUrl}/sync/deleted?since=${encodeURIComponent(since)}`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching sync deleted:', error.response?.data?.detail || error.message);
      return [];
    }
  }

  async getPostsByCategory(category: string, limit: number = 20): Promise<Post[]> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ success: boolean; data: Post[] }>(
        `${baseUrl}/category/${category}?limit=${limit}`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching posts by category:', error);
      return [];
    }
  }

  async searchByTags(tags: string[], limit: number = 20): Promise<Post[]> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const tagsString = tags.join(',');
      const response = await axios.get<{ success: boolean; data: Post[] }>(
        `${baseUrl}/search?tags=${tagsString}&limit=${limit}`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data.data || [];
    } catch (error) {
      console.error('Error searching posts:', error);
      return [];
    }
  }

  async getQueueStatus(): Promise<QueueStatus | null> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<QueueStatus>(
        `${baseUrl}/queue-status`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching queue status:', error);
      return null;
    }
  }

  async getCategories(): Promise<Array<{ id: string; name: string; count: number }>> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{
        success: boolean;
        categories: Array<{ id: string; name: string; count: number }>;
      }>(
        `${baseUrl}/categories`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data.categories || [];
    } catch (error) {
      console.error('Error fetching categories:', error);
      return [];
    }
  }

  async getTaxonomy(): Promise<TaxonomyPayload | null> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{
        success: boolean;
        categories: Array<{ id: string; name: string; precedence?: number; guidance?: string }>;
        allow_multiple_categories: boolean;
        fallback_category: string;
        use_default_categories: boolean;
        taxonomy_version?: string;
      }>(
        `${baseUrl}/taxonomy`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      if (!response.data?.success) return null;
      return {
        categories: response.data.categories || [],
        allow_multiple_categories: !!response.data.allow_multiple_categories,
        fallback_category: response.data.fallback_category || 'Other',
        use_default_categories: !!response.data.use_default_categories,
        taxonomy_version: response.data.taxonomy_version || '',
      };
    } catch (error: any) {
      // 404 = upstream / pre-taxonomy servers — silent by design
      if (error?.response?.status !== 404) {
        console.error('Error fetching taxonomy:', error);
      }
      return null;
    }
  }

  async checkCache(shortcode: string): Promise<Post | null> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ success: boolean; data: Post }>(
        `${baseUrl}/cache/${shortcode}`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data.data;
    } catch (error) {
      return null;
    }
  }

  async getStats(): Promise<DatabaseStats | null> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ success: boolean; data: DatabaseStats }>(
        `${baseUrl}/stats`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data.data;
    } catch (error: any) {
      console.error('Error fetching stats:', error.response?.status, error.response?.data || error.message);
      return null;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get(
        `${baseUrl}/ping`,
        { timeout: 8000 }
      );
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }


  async getRetryQueue(): Promise<RetryQueueItem[]> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ retry_queue: RetryQueueItem[]; count: number }>(
        `${baseUrl}/queue/retry`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data.retry_queue || [];
    } catch (error) {
      console.error('Error fetching retry queue:', error);
      return [];
    }
  }

  async flushRetryQueue(): Promise<{ flushed: number; items: string[] }> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post<{ flushed: number; items: string[] }>(
        `${baseUrl}/queue/retry/flush`,
        {},
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error flushing retry queue:', error);
      throw error;
    }
  }

  async resetApiToken(): Promise<{ success: boolean; new_token: string; message: string }> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post<{ success: boolean; new_token: string; message: string }>(
        `${baseUrl}/reset/api-token`,
        {},
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      if (response.data.new_token) {
        await this.setApiToken(response.data.new_token);
      }
      return response.data;
    } catch (error) {
      console.error('Error resetting API token:', error);
      throw error;
    }
  }

  async resetDatabase(): Promise<{ success: boolean; deleted_count: number; message: string }> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post<{ success: boolean; deleted_count: number; message: string }>(
        `${baseUrl}/reset/database`,
        { confirm: 'DELETE_ALL' },
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error resetting database:', error);
      throw error;
    }
  }

  /** Returns true if the backend is reachable (even a 4xx means it's up). */
  async isReachable(): Promise<boolean> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      await axios.get(`${baseUrl}/queue-status`, { headers, timeout: 4000 });
      return true;
    } catch (e: any) {
      if (e?.response) {
        // 4xx = server is up (e.g. wrong token) — treat as reachable
        // 5xx = backend crashed / proxy returning 502/503 — treat as down
        return e.response.status < 500;
      }
      // Network-level failure (ECONNREFUSED, timeout, etc.) — not reachable
      return false;
    }
  }

  async deletePost(shortcode: string): Promise<void> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      await axios.delete(
        `${baseUrl}/post/${shortcode}`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
    } catch (error) {
      console.error('Error deleting post:', error);
      throw error;
    }
  }

  async updatePost(shortcode: string, updates: { category?: string; title?: string; summary?: string }): Promise<void> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      await axios.put(
        `${baseUrl}/post/${shortcode}`,
        updates,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
    } catch (error) {
      console.error('Error updating post:', error);
      throw error;
    }
  }

  // ── Collections API ──────────────────────────────────────────────

  async getCollections(): Promise<Collection[]> {
    const headers = await this.getHeaders();
    const baseUrl = await this.getBaseUrl();
    const res = await axios.get<{ success: boolean; data: any[] }>(
      `${baseUrl}/collections`, { headers, timeout: 10000 }
    );
    // normalise snake_case → camelCase
    return res.data.data.map((c: any) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      postIds: c.post_ids ?? [],
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }

  async upsertCollection(collection: Collection): Promise<Collection> {
    const headers = await this.getHeaders();
    const baseUrl = await this.getBaseUrl();
    const res = await axios.post<{ success: boolean; data: any }>(
      `${baseUrl}/collections`,
      {
        id: collection.id,
        name: collection.name,
        icon: collection.icon,
        post_ids: collection.postIds,
        created_at: collection.createdAt,
        updated_at: collection.updatedAt,
      },
      { headers, timeout: 10000 }
    );
    const c = res.data.data;
    return { id: c.id, name: c.name, icon: c.icon, postIds: c.post_ids ?? [], createdAt: c.created_at, updatedAt: c.updated_at };
  }

  async updateCollectionPosts(collectionId: string, postIds: string[]): Promise<Collection> {
    const headers = await this.getHeaders();
    const baseUrl = await this.getBaseUrl();
    const res = await axios.put<{ success: boolean; data: any }>(
      `${baseUrl}/collections/${collectionId}/posts`,
      { post_ids: postIds },
      { headers, timeout: 10000 }
    );
    const c = res.data.data;
    return { id: c.id, name: c.name, icon: c.icon, postIds: c.post_ids ?? [], createdAt: c.created_at, updatedAt: c.updated_at };
  }

  async deleteCollection(collectionId: string): Promise<void> {
    const headers = await this.getHeaders();
    const baseUrl = await this.getBaseUrl();
    await axios.delete(`${baseUrl}/collections/${collectionId}`, { headers, timeout: 10000 });
  }

  // ── Settings API ──────────────────────────────────────────────

  async getAiProviders(): Promise<any> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get(
        `${baseUrl}/settings/ai-providers`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching AI providers:', error);
      throw error;
    }
  }

  async setAiProviderKey(provider: string, apiKey: string): Promise<any> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post(
        `${baseUrl}/settings/ai-providers`,
        { provider, api_key: apiKey },
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error setting AI provider key:', error);
      throw error;
    }
  }

  async deleteAiProviderKey(provider: string): Promise<any> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.delete(
        `${baseUrl}/settings/ai-providers/${provider}`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error deleting AI provider key:', error);
      throw error;
    }
  }

  async getInstagramCredentials(): Promise<any> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get(
        `${baseUrl}/settings/instagram`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching Instagram credentials:', error);
      throw error;
    }
  }

  async setInstagramCredentials(username: string, password?: string, sessionid?: string): Promise<any> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post(
        `${baseUrl}/settings/instagram`,
        { username, password, sessionid },
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error setting Instagram credentials:', error);
      throw error;
    }
  }

  async deleteInstagramCredentials(): Promise<any> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.delete(
        `${baseUrl}/settings/instagram`,
        { headers, timeout: DEFAULT_TIMEOUT }
      );
      return response.data;
    } catch (error) {
      console.error('Error deleting Instagram credentials:', error);
      throw error;
    }
  }

  async importData(file: any, mode: 'merge' | 'replace' = 'merge'): Promise<any> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await axios.post(
        `${baseUrl}/import/file?mode=${mode}`,
        formData,
        { 
          headers: {
            ...headers,
            'Content-Type': 'multipart/form-data'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error importing data:', error);
      throw error;
    }
  }

  async getExportHeaders(): Promise<Headers> {
    const token = await this.getApiToken();
    return new Headers({
      'X-API-Key': token || '',
    });
  }

  getExportUrl(format: 'json' | 'zip' = 'json'): Promise<string> {
    return this.getBaseUrl().then(baseUrl => {
      return `${baseUrl}/export?format=${format}`;
    });
  }

  async removeQueueItem(shortcode: string): Promise<void> {
    const headers = await this.getHeaders();
    const baseUrl = await this.getBaseUrl();
    await axios.delete(`${baseUrl}/queue/${shortcode}`, { headers });
  }
}

export default new ApiService();
