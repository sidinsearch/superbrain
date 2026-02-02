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

  const fetchInstagramCaption = async (shortcode: string): Promise<string> => {
    try {
      console.log('Fetching caption from backend API...');
      
      // Call backend endpoint to get caption
      const caption = await apiService.getPostInfo(`https://www.instagram.com/p/${shortcode}/`);
      
      if (caption && caption.title && caption.title !== 'Instagram Post') {
        console.log('Got caption from backend:', caption.title);
        return caption.title;
      }
    } catch (error) {
      console.log('Backend caption fetch failed:', error);
    }
    
    return 'Instagram Post';
  };

  const handleInstagramUrl = async () => {
    if (!url) {
      console.log('ShareHandler - No URL to process');
      return;
    }
    
    try {
      console.log('ShareHandler - Processing URL:', url);
      setError(null);

      const shortcode = extractShortcode(url);
      console.log('ShareHandler - Extracted shortcode:', shortcode);
      
      if (!shortcode) {
        console.error('ShareHandler - Invalid Instagram URL:', url);
        setError('Invalid Instagram URL');
        setProcessing(false);
        return;
      }

      // Get Instagram thumbnail
      const thumbnailUrl = `https://www.instagram.com/p/${shortcode}/media/?size=m`;
      
      // Create temporary post for preview
      const tempPost: Post = {
        shortcode,
        url: `https://www.instagram.com/p/${shortcode}/`,
        username: '',
        title: 'Loading...',
        summary: '',
        tags: [],
        music: '',
        category: 'other',
        thumbnail_url: thumbnailUrl,
      };
      
      setPost(tempPost);
      setProcessing(false);
      
      // Load collections immediately
      loadCollections();
      setShowCollections(true);
      
      // Fetch Instagram caption in background (non-blocking)
      fetchInstagramCaption(shortcode).then(caption => {
        console.log('ShareHandler - Got caption:', caption);
        setPost(prev => prev ? { ...prev, title: caption } : null);
      }).catch(err => {
        console.log('ShareHandler - Caption fetch error:', err);
        setPost(prev => prev ? { ...prev, title: 'Instagram Post' } : null);
      });
      
    } catch (err: any) {
      console.error('ShareHandler - Error processing Instagram URL:', err);
      setError('Failed to process Instagram post');
      setProcessing(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => {
    setToast({ visible: true, message, type });
  };

  const loadCollections = async () => {
    try {
      setLoadingCollections(true);
      const data = await collectionsService.getCollections();
      console.log('ShareHandler - Raw collections data:', data);
      
      // Filter: only show collections with both name and id, and that are not "All Posts"
      const userCollections = data.filter(c => 
        c.name && 
        c.id && 
        c.name !== 'All Posts' && 
        c.name !== 'Instagram Post' &&
        c.name !== 'Instagram Posts'
      );
      
      console.log('ShareHandler - Filtered collections:', userCollections);
      setCollections(userCollections);
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
    if (isSaving) return;
    
    try {
      setIsSaving(true);
      
      if (url && post) {
        // Extract shortcode for collection save
        const shortcode = extractShortcode(url);
        if (shortcode) {
          // Mark as analyzing in cache
          postsCache.markAsAnalyzing(shortcode);
          
          // Create placeholder post and add to cache immediately
          const placeholderPost: Post = {
            ...post,
            shortcode,
            processing: true,
          };
          
          // Add placeholder to cache so it appears in feed
          const cachedPosts = await postsCache.getCachedPosts() || [];
          const updatedPosts = [placeholderPost, ...cachedPosts.filter(p => p.shortcode !== shortcode)];
          await postsCache.savePosts(updatedPosts);
          
          await collectionsService.addPostToCollection(collectionId, shortcode);
          
          // Trigger backend analysis in background
          apiService.analyzeInstagramUrl(url).then(async () => {
            // When analysis completes, refresh cache
            const freshPosts = await apiService.getRecentPosts(50);
            await postsCache.savePosts(freshPosts);
            postsCache.markAnalysisComplete(shortcode);
          }).catch(err => {
            console.error('Background analysis error:', err);
            postsCache.markAnalysisComplete(shortcode);
          });
        }
      }
      
      showToast('✨ Analyzing...', 'info');
      
      // Navigate to Home to show the analyzing post
      setTimeout(() => {
        navigation.replace('Home');
      }, 500);
    } catch (error) {
      console.error('Error adding to collection:', error);
      showToast('Failed to add to collection', 'error');
      setIsSaving(false);
    }
  };

  const handleDone = async () => {
    if (isSaving) return;
    
    try {
      setIsSaving(true);
      
      if (url && post) {
        const shortcode = extractShortcode(url);
        if (shortcode) {
          // Mark as analyzing in cache
          postsCache.markAsAnalyzing(shortcode);
          
          // Create placeholder post and add to cache immediately
          const placeholderPost: Post = {
            ...post,
            shortcode,
            processing: true,
          };
          
          // Add placeholder to cache so it appears in feed
          const cachedPosts = await postsCache.getCachedPosts() || [];
          const updatedPosts = [placeholderPost, ...cachedPosts.filter(p => p.shortcode !== shortcode)];
          await postsCache.savePosts(updatedPosts);
        }
        
        // Trigger backend analysis in background
        apiService.analyzeInstagramUrl(url).then(async () => {
          // When analysis completes, refresh cache
          const freshPosts = await apiService.getRecentPosts(50);
          await postsCache.savePosts(freshPosts);
          if (extractShortcode(url)) {
            postsCache.markAnalysisComplete(extractShortcode(url));
          }
        }).catch(err => {
          console.error('Background analysis error:', err);
          if (extractShortcode(url)) {
            postsCache.markAnalysisComplete(extractShortcode(url));
          }
        });
      }
      
      showToast('✨ Analyzing...', 'info');
      
      // Navigate to Home to show the analyzing post
      setTimeout(() => {
        navigation.replace('Home');
      }, 500);
    } catch (error) {
      console.error('Error:', error);
      setIsSaving(false);
    }
  };

  // Skip processing state, show collections immediately
  if (!url && processing) {
    return (
      <View style={styles.overlayContainer}>
        <TouchableOpacity 
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => navigation.replace('Home')}
        />
        <View style={styles.bottomSheet}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.overlayContainer}>
        <TouchableOpacity 
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => navigation.replace('Home')}
        />
        <View style={styles.bottomSheet}>
          <View style={styles.errorContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Error</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={() => navigation.replace('Home')}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.overlayContainer}>
      <TouchableOpacity 
        style={styles.backdrop}
        activeOpacity={1}
        onPress={() => navigation.goBack()}
      />
      <View style={styles.bottomSheet}>
        {/* Handle bar */}
        <View style={styles.handleBar} />
        
        {/* Post Preview */}
        {post && (
          <View style={styles.postPreview}>
            <Image 
              source={{ uri: post.thumbnail_url }} 
              style={styles.thumbnail}
              resizeMode="cover"
            />
            <View style={styles.postInfo}>
              <Text style={styles.postUrl} numberOfLines={1}>{url}</Text>
              <Text style={styles.postTitle}>{post.title || 'Instagram Post'}</Text>
            </View>
          </View>
        )}
        
        <Text style={styles.sectionTitle}>Select Collection</Text>

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
          <ScrollView 
            horizontal 
            style={styles.collectionsScroll}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.collectionsContent}
          >
            {collections.map((collection) => (
              <TouchableOpacity
                key={collection.id}
                style={[styles.collectionCard, isSaving && styles.collectionCardDisabled]}
                onPress={() => handleAddToCollection(collection.id)}
                disabled={isSaving}
              >
                <Text style={styles.collectionCardIcon}>{collection.icon}</Text>
                <Text style={styles.collectionCardName} numberOfLines={2}>{collection.name}</Text>
                <Text style={styles.collectionCardCount}>
                  {collection.postIds.length} {collection.postIds.length === 1 ? 'post' : 'posts'}
                </Text>
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
            {isSaving ? 'Saving...' : 'Done'}
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
  overlayContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  bottomSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '50%',
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  postPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    padding: 10,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  postInfo: {
    flex: 1,
  },
  postUrl: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 4,
  },
  postTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  collectionsLoading: {
    padding: 20,
    alignItems: 'center',
  },
  collectionsScroll: {
    marginBottom: 16,
    maxHeight: 120,
  },
  collectionsContent: {
    paddingRight: 20,
  },
  collectionCard: {
    width: 110,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  collectionCardIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  collectionCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  collectionCardCount: {
    fontSize: 11,
    color: colors.textMuted,
  },
  collectionCardDisabled: {
    opacity: 0.5,
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
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: colors.text,
    fontSize: 16,
    marginTop: 16,
  },
  errorContainer: {
    padding: 40,
    alignItems: 'center',
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
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
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
