import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post } from '../types';

const POSTS_CACHE_KEY = '@superbrain_posts_cache';
const CACHE_TIMESTAMP_KEY = '@superbrain_posts_timestamp';
const ANALYZING_POSTS_KEY = '@superbrain_analyzing_posts';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

class PostsCacheService {
  private analyzingPosts: Set<string> = new Set();

  constructor() {
    this.loadAnalyzingPosts();
  }

  /**
   * Load analyzing posts from storage
   */
  private async loadAnalyzingPosts(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(ANALYZING_POSTS_KEY);
      if (stored) {
        this.analyzingPosts = new Set(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Error loading analyzing posts:', error);
    }
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
   * Save posts to local cache
   */
  async savePosts(posts: Post[]): Promise<void> {
    try {
      await AsyncStorage.setItem(POSTS_CACHE_KEY, JSON.stringify(posts));
      await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
      console.error('Error saving posts to cache:', error);
    }
  }

  /**
   * Get cached posts
   */
  async getCachedPosts(): Promise<Post[] | null> {
    try {
      const cached = await AsyncStorage.getItem(POSTS_CACHE_KEY);
      if (!cached) return null;
      return JSON.parse(cached);
    } catch (error) {
      console.error('Error reading posts cache:', error);
      return null;
    }
  }

  /**
   * Check if cache is still valid
   */
  async isCacheValid(): Promise<boolean> {
    try {
      const timestamp = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
      if (!timestamp) return false;
      
      const cacheAge = Date.now() - parseInt(timestamp);
      return cacheAge < CACHE_DURATION;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get posts from cache if valid, otherwise return null
   */
  async getValidCachedPosts(): Promise<Post[] | null> {
    const isValid = await this.isCacheValid();
    if (!isValid) return null;
    return this.getCachedPosts();
  }

  /**
   * Clear the cache
   */
  async clearCache(): Promise<void> {
    try {
      await AsyncStorage.removeItem(POSTS_CACHE_KEY);
      await AsyncStorage.removeItem(CACHE_TIMESTAMP_KEY);
    } catch (error) {
      console.error('Error clearing posts cache:', error);
    }
  }

  /**
   * Update a single post in cache
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
   * Remove a post from cache
   */
  async removePostFromCache(shortcode: string): Promise<void> {
    try {
      const posts = await this.getCachedPosts();
      if (!posts) return;

      const filtered = posts.filter(p => p.shortcode !== shortcode);
      await this.savePosts(filtered);
    } catch (error) {
      console.error('Error removing post from cache:', error);
    }
  }
}

export default new PostsCacheService();
