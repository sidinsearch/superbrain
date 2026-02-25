import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post, ApiResponse, QueueStatus, DatabaseStats, RetryQueueItem, Collection } from '../types';

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
  private apiUrl: string = 'http://192.168.31.205:5000'; // Laptop hotspot IP

  async initialize() {
    this.apiToken = await AsyncStorage.getItem('apiToken');
    const savedUrl = await AsyncStorage.getItem('apiUrl');
    if (savedUrl) {
      this.apiUrl = savedUrl;
    }
  }

  async setApiToken(token: string) {
    this.apiToken = token;
    await AsyncStorage.setItem('apiToken', token);
  }

  async setApiUrl(url: string) {
    this.apiUrl = url;
    await AsyncStorage.setItem('apiUrl', url);
  }

  async getApiToken(): Promise<string | null> {
    if (!this.apiToken) {
      this.apiToken = await AsyncStorage.getItem('apiToken');
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
      throw new Error('API token not configured');
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
      console.log('API - Analyzing URL:', url);
      const response = await axios.post<ApiResponse>(
        `${baseUrl}/analyze`,
        { url },
        { headers }
      );
      
      console.log('API - Response:', response.data);
      
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
        { headers }
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
      console.log(`Fetching stats from ${baseUrl}/stats`);
      const response = await axios.get<{ success: boolean; data: DatabaseStats }>(
        `${baseUrl}/stats`,
        { headers }
      );
      console.log('Stats fetched:', response.data.data);
      return response.data.data;
    } catch (error: any) {
      console.error('Error fetching stats:', error.response?.status, error.response?.data || error.message);
      return null;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const baseUrl = await this.getBaseUrl();
      // Use /ping — no auth, no DB, instant response even while backend is analyzing
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
}

export default new ApiService();
