import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post, ApiResponse, QueueStatus, DatabaseStats, RetryQueueItem, Collection } from '../types';

const ACCESS_TOKEN_LENGTH = 8;

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
    const savedUrl = await AsyncStorage.getItem('apiUrl');
    if (savedUrl) {
      this.apiUrl = savedUrl;
    }
    return this.apiUrl;
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
        { headers }
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
        { headers }
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
        { headers }
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
      throw error;
    }
  }

  async getPosts(): Promise<Post[]> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ success: boolean; data: Post[] }>(
        `${baseUrl}/recent?limit=100`,
        { headers }
      );
      return (response.data.data || []).map(normalizePost);
    } catch (error: any) {
      console.error('Error fetching all posts:', error.response?.data?.detail || error.message);
      return [];
    }
  }

  async getRecentPosts(limit: number = 20): Promise<Post[]> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ success: boolean; data: Post[] }>(
        `${baseUrl}/recent?limit=${limit}`,
        { headers, timeout: 8000 }
      );
      return (response.data.data || []).map(normalizePost);
    } catch (error: any) {
      console.error('Error fetching posts:', error.response?.data?.detail || error.message);
      return [];
    }
  }

  async getPostsByCategory(category: string, limit: number = 20): Promise<Post[]> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ success: boolean; data: Post[] }>(
        `${baseUrl}/category/${category}?limit=${limit}`,
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
      );
      return response.data.categories || [];
    } catch (error) {
      console.error('Error fetching categories:', error);
      return [];
    }
  }

  async checkCache(shortcode: string): Promise<Post | null> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get<{ success: boolean; data: Post }>(
        `${baseUrl}/cache/${shortcode}`,
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
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
        { headers }
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching Instagram credentials:', error);
      throw error;
    }
  }

  async setInstagramCredentials(username: string, password: string): Promise<any> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post(
        `${baseUrl}/settings/instagram`,
        { username, password },
        { headers }
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
        { headers }
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
}

export default new ApiService();
