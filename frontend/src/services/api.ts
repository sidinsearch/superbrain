import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post, ApiResponse, QueueStatus, DatabaseStats } from '../types';

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

  async analyzeInstagramUrl(url: string): Promise<Post> {
    try {
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.post<ApiResponse>(
        `${baseUrl}/analyze`,
        { url },
        { headers }
      );
      
      if (response.data.success && response.data.post) {
        return response.data.post;
      }
      
      throw new Error('Failed to analyze Instagram post');
    } catch (error: any) {
      console.error('Error analyzing Instagram URL:', error);
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
      return response.data.data || [];
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
      return response.data.data || [];
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
      const headers = await this.getHeaders();
      const baseUrl = await this.getBaseUrl();
      const response = await axios.get(
        `${baseUrl}/health`,
        { headers, timeout: 5000 }
      );
      return response.status === 200;
    } catch (error) {
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
}

export default new ApiService();
