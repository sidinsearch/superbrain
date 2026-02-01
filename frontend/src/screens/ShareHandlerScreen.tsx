import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from 'react-native';
import * as Linking from 'expo-linking';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { colors } from '../theme/colors';
import apiService from '../services/api';
import postsCache from '../services/postsCache';
import collectionsService from '../services/collections';
import { Post, Collection } from '../types';
import CustomToast from '../components/CustomToast';

type Props = NativeStackScreenProps<RootStackParamList, 'ShareHandler'>;

const { width } = Dimensions.get('window');

const ShareHandlerScreen = ({ route, navigation }: Props) => {
  const [url, setUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showCollections, setShowCollections] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });

  useEffect(() => {
    getSharedUrl();
  }, []);

  const getSharedUrl = async () => {
    try {
      console.log('ShareHandler - Getting shared URL...');
      
      // Try to get URL from route params first
      if (route.params?.url) {
        console.log('ShareHandler - Got URL from route params:', route.params.url);
        const decodedUrl = decodeURIComponent(route.params.url);
        console.log('ShareHandler - Decoded URL:', decodedUrl);
        setUrl(decodedUrl);
        return;
      }

      // Otherwise get from initial URL (share intent)
      const initialUrl = await Linking.getInitialURL();
      console.log('ShareHandler - Initial URL:', initialUrl);
      
      if (initialUrl) {
        // Extract the actual URL from query param if it exists
        const parsed = Linking.parse(initialUrl);
        console.log('ShareHandler - Parsed URL:', JSON.stringify(parsed, null, 2));
        
        if (parsed.queryParams?.url) {
          const sharedUrl = decodeURIComponent(parsed.queryParams.url as string);
          console.log('ShareHandler - Extracted URL from query:', sharedUrl);
          setUrl(sharedUrl);
        } else if (parsed.queryParams?.text) {
          // Handle text content from share intent
          const textContent = decodeURIComponent(parsed.queryParams.text as string);
          console.log('ShareHandler - Got text content:', textContent);
          // Extract Instagram URL from text
          const urlMatch = textContent.match(/(https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?)/);
          if (urlMatch) {
            console.log('ShareHandler - Extracted Instagram URL from text:', urlMatch[0]);
            setUrl(urlMatch[0]);
          } else {
            setUrl(textContent);
          }
        } else if (initialUrl.includes('instagram.com')) {
          console.log('ShareHandler - Direct Instagram URL:', initialUrl);
          setUrl(initialUrl);
        } else {
          console.log('ShareHandler - Using initial URL as-is:', initialUrl);
          setUrl(initialUrl);
        }
      } else {
        console.error('ShareHandler - No URL found');
        setError('No URL to process');
        setProcessing(false);
      }
    } catch (err) {
      console.error('Error getting shared URL:', err);
      setError('Failed to get shared URL');
      setProcessing(false);
    }
  };

  useEffect(() => {
    if (url) {
      handleInstagramUrl();
    }
  }, [url]);

  const extractShortcode = (instagramUrl: string): string | null => {
    // Handle various Instagram URL formats
    const patterns = [
      /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = instagramUrl.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  };

  const handleInstagramUrl = async () => {
    if (!url) {
      console.log('ShareHandler - No URL to process');
      return;
    }
    
    try {
      console.log('ShareHandler - Processing URL:', url);
      setProcessing(true);
      setError(null);

      const shortcode = extractShortcode(url);
      console.log('ShareHandler - Extracted shortcode:', shortcode);
      
      if (!shortcode) {
        console.error('ShareHandler - Invalid Instagram URL:', url);
        setError('Invalid Instagram URL');
        setProcessing(false);
        return;
      }

      // Normalize the URL to standard format
      const normalizedUrl = `https://www.instagram.com/p/${shortcode}/`;
      console.log('ShareHandler - Normalized URL:', normalizedUrl);

      // Check if post already exists in cache
      const cachedPosts = await postsCache.getCachedPosts();
      const existingPost = cachedPosts?.find(p => p.shortcode === shortcode);

      if (existingPost && !existingPost.processing) {
        console.log('ShareHandler - Found existing completed post in cache');
        setPost(existingPost);
        setProcessing(false);
        setShowCollections(true);
        return;
      }

      // Get Instagram thumbnail immediately
      const thumbnailUrl = `https://www.instagram.com/p/${shortcode}/media/?size=m`;
      
      // Create temporary post with processing status
      const tempPost: Post = {
        shortcode,
        url: normalizedUrl,
        username: '',
        title: 'Processing...',
        summary: '',
        tags: [],
        music: '',
        category: 'other',
        thumbnail_url: thumbnailUrl,
        processing: true,
      };
      
      console.log('ShareHandler - Created temp post, adding to cache');
      // Add to cache immediately so it shows in Home
      const currentPosts = await postsCache.getCachedPosts() || [];
      await postsCache.savePosts([tempPost, ...currentPosts]);
      
      // Show thumbnail with processing overlay
      setPost(tempPost);
      showToast('Analyzing post...', 'info');
      
      console.log('ShareHandler - Calling backend API to analyze with URL:', normalizedUrl);
      // Call backend to analyze the post in background
      const response = await apiService.analyzeInstagramUrl(normalizedUrl);
      console.log('ShareHandler - Got response from API:', response);
      
      if (response && response.shortcode) {
        console.log('ShareHandler - Analysis successful, refreshing cache');
        // Refresh cache to get the analyzed post data
        const updatedPosts = await apiService.getPosts();
        await postsCache.savePosts(updatedPosts);
        
        const analyzedPost = updatedPosts.find(p => p.shortcode === shortcode);
        if (analyzedPost) {
          console.log('ShareHandler - Found analyzed post, showing collections');
          analyzedPost.processing = false;
          setPost(analyzedPost);
          setProcessing(false);
          setShowCollections(true);
          showToast('Post analyzed!', 'success');
        }
      }
    } catch (err: any) {
      console.error('ShareHandler - Error processing Instagram URL:', err);
      console.error('ShareHandler - Error details:', err.response?.data || err.message);
      setError('Failed to process Instagram post');
      setProcessing(false);
      showToast('Failed to process post', 'error');
    }
  };

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => {
    setToast({ visible: true, message, type });
  };

  const loadCollections = async () => {
    try {
      setLoadingCollections(true);
      const data = await collectionsService.getCollections();
      setCollections(data);
    } catch (error) {
      console.error('Error loading collections:', error);
      setToast({ visible: true, message: 'Failed to load collections', type: 'error' });
    } finally {
      setLoadingCollections(false);
    }
  };

  useEffect(() => {
    if (showCollections) {
      loadCollections();
    }
  }, [showCollections]);

  const handleAddToCollection = async (collectionId: string) => {
    if (!post || isSaving) return;
    
    try {
      setIsSaving(true);
      await collectionsService.addPostToCollection(collectionId, post.shortcode);
      showToast('Saved to collection!', 'success');
      
      // Navigate to the collection detail screen
      setTimeout(() => {
        const collection = collections.find(c => c.id === collectionId);
        if (collection) {
          navigation.replace('CollectionDetail', { collectionId, collectionName: collection.name });
        } else {
          navigation.replace('Home');
        }
      }, 500);
    } catch (error) {
      console.error('Error adding to collection:', error);
      showToast('Failed to add to collection', 'error');
      setIsSaving(false);
    }
  };

  const handleDone = async () => {
    if (!post || isSaving) return;
    
    try {
      setIsSaving(true);
      // Post is already saved by backend, just navigate to All Saved Posts
      showToast('Saved to All Posts!', 'success');
      
      setTimeout(() => {
        // Navigate to Home which shows all posts
        navigation.replace('Home');
      }, 500);
    } catch (error) {
      console.error('Error:', error);
      setIsSaving(false);
    }
  };

  if (processing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        {post?.thumbnail_url ? (
          <View style={styles.thumbnailContainer}>
            <Image
              source={{ uri: post.thumbnail_url }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
                <View style={styles.processingOverlay}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={styles.processingText}>Processing...</Text>
                </View>
              </View>
            ) : (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Processing Instagram post...</Text>
              </View>
            )}
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Error</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.replace('Home')}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.contentContainer}>
          {/* Handle bar */}
          <View style={styles.handleBar} />
          
          <View style={styles.header}>
            <Text style={styles.headerIcon}>💾</Text>
            <Text style={styles.headerTitle}>Save to SuperBrain</Text>
            <Text style={styles.headerSubtitle}>Choose a collection or tap Done</Text>
          </View>

          {post && (
            <View style={styles.postPreview}>
              <Image
                source={{ uri: post.thumbnail_url }}
                style={styles.previewImage}
                resizeMode="cover"
              />
              <View style={styles.postInfo}>
                <Text style={styles.postTitle} numberOfLines={2}>
                  {post.title || 'Instagram Post'}
                </Text>
                <Text style={styles.postSubtitle}>Select a collection to save</Text>
              </View>
            </View>
          )}

          <Text style={styles.collectionsTitle}>Select Collection</Text>

          {loadingCollections ? (
            <View style={styles.collectionsLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : collections.length === 0 ? (
            <View style={styles.emptyCollections}>
              <Text style={styles.emptyText}>📁 No collections yet</Text>
              <Text style={styles.emptySubtext}>Create one in the Library tab</Text>
            </View>
          ) : (
            <ScrollView style={styles.collectionsList} showsVerticalScrollIndicator={false}>
              {collections.map((collection) => (
                <TouchableOpacity
                  key={collection.id}
                  style={[styles.collectionItem, isSaving && styles.collectionItemDisabled]}
                  onPress={() => handleAddToCollection(collection.id)}
                  disabled={isSaving}
                >
                  <Text style={styles.collectionIcon}>{collection.icon}</Text>
                  <View style={styles.collectionInfo}>
                    <Text style={styles.collectionName}>{collection.name}</Text>
                    <Text style={styles.collectionCount}>
                      {collection.postIds.length} {collection.postIds.length === 1 ? 'post' : 'posts'}
                    </Text>
                  </View>
                  <Text style={styles.collectionArrow}>→</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity 
            style={[styles.doneButton, isSaving && styles.doneButtonDisabled]} 
            onPress={handleDone}
            disabled={isSaving}
          >
            <Text style={styles.doneButtonText}>
              {isSaving ? 'Saving...' : 'Done (Save to All Posts)'}
            </Text>
          </TouchableOpacity>
      </View>

      <CustomToast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast({ ...toast, visible: false })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  contentContainer: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '65%',
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  headerIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
  },
  postPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  postInfo: {
    flex: 1,
  },
  postTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  postSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
  },
  collectionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  collectionsLoading: {
    padding: 20,
    alignItems: 'center',
  },
  collectionsList: {
    maxHeight: 180,
    marginBottom: 16,
  },
  collectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  collectionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  collectionInfo: {
    flex: 1,
  },
  collectionName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  collectionCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  collectionArrow: {
    fontSize: 18,
    color: colors.textMuted,
  },
  emptyCollections: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: colors.textMuted,
  },
  doneButton: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  doneButtonDisabled: {
    backgroundColor: colors.textMuted,
    opacity: 0.6,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  collectionItemDisabled: {
    opacity: 0.5,
  },
  processingContainer: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: colors.text,
    fontSize: 16,
    marginTop: 16,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  closeButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

export default ShareHandlerScreen;
