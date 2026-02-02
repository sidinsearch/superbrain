import AsyncStorage from '@react-native-async-storage/async-storage';
import { Collection } from '../types';

const COLLECTIONS_KEY = '@superbrain_collections';

class CollectionsService {
  async getCollections(): Promise<Collection[]> {
    try {
      const data = await AsyncStorage.getItem(COLLECTIONS_KEY);
      const collections = data ? JSON.parse(data) : [];
      // Clean up postIds - filter out null/undefined/empty strings
      return collections.map((col: Collection) => ({
        ...col,
        postIds: (col.postIds || []).filter((id: string) => id && id.trim())
      }));
    } catch (error) {
      console.error('Error loading collections:', error);
      return [];
    }
  }

  async saveCollections(collections: Collection[]): Promise<void> {
    try {
      // Clean up postIds before saving - remove empty/null/undefined values
      const cleanedCollections = collections.map(col => ({
        ...col,
        postIds: (col.postIds || []).filter((id: string) => id && id.trim())
      }));
      await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(cleanedCollections));
    } catch (error) {
      console.error('Error saving collections:', error);
    }
  }

  async createCollection(name: string, icon: string): Promise<Collection> {
    const newCollection: Collection = {
      id: Date.now().toString(),
      name,
      icon,
      postIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const collections = await this.getCollections();
    collections.push(newCollection);
    await this.saveCollections(collections);

    return newCollection;
  }

  async updateCollection(id: string, updates: Partial<Collection>): Promise<void> {
    const collections = await this.getCollections();
    const index = collections.findIndex(c => c.id === id);
    
    if (index !== -1) {
      collections[index] = {
        ...collections[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await this.saveCollections(collections);
    }
  }

  async deleteCollection(id: string): Promise<void> {
    const collections = await this.getCollections();
    const filtered = collections.filter(c => c.id !== id);
    await this.saveCollections(filtered);
  }

  async addPostToCollection(collectionId: string, postId: string): Promise<void> {
    const collections = await this.getCollections();
    const collection = collections.find(c => c.id === collectionId);
    
    if (collection && !collection.postIds.includes(postId)) {
      collection.postIds.push(postId);
      collection.updatedAt = new Date().toISOString();
      await this.saveCollections(collections);
    }
  }

  async removePostFromCollection(collectionId: string, postId: string): Promise<void> {
    const collections = await this.getCollections();
    const collection = collections.find(c => c.id === collectionId);
    
    if (collection) {
      collection.postIds = collection.postIds.filter(id => id !== postId);
      collection.updatedAt = new Date().toISOString();
      await this.saveCollections(collections);
    }
  }

  async getCollectionPosts(collectionId: string): Promise<string[]> {
    const collections = await this.getCollections();
    const collection = collections.find(c => c.id === collectionId);
    return collection ? collection.postIds : [];
  }
}

export default new CollectionsService();
