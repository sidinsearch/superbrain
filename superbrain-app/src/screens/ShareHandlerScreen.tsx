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
  BackHandler,
} from 'react-native';
import * as Linking from 'expo-linking';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { colors } from '../theme/colors';
import apiService from '../services/api';
import postsCache from '../services/postsCache';
import collectionsService from '../services/collections';
import { sendImmediateWatchLaterNotification, sendImmediateSavedNotification } from '../services/notificationService';
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
          const urlMatch = textContent.match(/(https?:\/\/[^\s]+)/);
          if (urlMatch) {
            console.log('ShareHandler - Extracted URL from text:', urlMatch[0]);
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
      handleUrl();
    }
  }, [url]);

  // ── URL type helpers ──────────────────────────────────────────────────────

  const detectUrlType = (u: string): 'instagram' | 'youtube' | 'webpage' => {
    if (/instagram\.com|instagr\.am/.test(u)) return 'instagram';
    if (/(?:youtube\.com|youtu\.be)/.test(u)) return 'youtube';
    return 'webpage';
  };

  const extractYouTubeVideoId = (u: string): string | null => {
    const patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = u.match(p);
      if (m) return m[1];
    }
    return null;
  };

  /** Generate a frontend-side shortcode that mirrors the backend's convention. */
  const buildShortcode = (u: string, type: string, ytId: string | null): string | null => {
    if (type === 'instagram') {
      const patterns = [
        /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/,
      ];
      for (const p of patterns) {
        const m = u.match(p);
        if (m) return m[1];
      }
      return null;
    }
    if (type === 'youtube' && ytId) return `YT_${ytId}`;
    // Webpage: deterministic FNV-1a hash → 16 hex chars (mirrors WP_ prefix)
    const clean = u.toLowerCase().replace(/\/$/, '');
    let h = 2166136261;
    for (let i = 0; i < clean.length; i++) {
      h ^= clean.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    let h2 = h ^ 0xdeadbeef;
    h2 = Math.imul(h2, 16777619) >>> 0;
    return `WP_${h.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  };

  const buildThumbnailUrl = (type: string, shortcode: string, ytId: string | null): string => {
    if (type === 'youtube' && ytId)
      return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    if (type === 'instagram')
      return `https://www.instagram.com/p/${shortcode}/media/?size=m`;
    return ''; // webpage: no preview thumbnail
  };

  // ── Main URL handler ──────────────────────────────────────────────────────

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
    if (!url) return;
    // Legacy alias kept for any residual calls
    return handleUrl();
  };

  const handleUrl = async () => {
    if (!url) {
      console.log('ShareHandler - No URL to process');
      return;
    }

    try {
      console.log('ShareHandler - Processing URL:', url);
      setError(null);

      const urlType = detectUrlType(url);
      const ytId = urlType === 'youtube' ? extractYouTubeVideoId(url) : null;
      const shortcode = buildShortcode(url, urlType, ytId);
      console.log('ShareHandler - type=%s shortcode=%s', urlType, shortcode);

      if (!shortcode) {
        setError('Could not parse this URL');
        setProcessing(false);
        return;
      }

      const thumbnailUrl = buildThumbnailUrl(urlType, shortcode, ytId);
      const defaultTitle =
        urlType === 'youtube' ? 'YouTube Video' :
        urlType === 'webpage' ? 'Web Page' :
        'Instagram Post';

      const tempPost: Post = {
        shortcode,
        url,
        username: '',
        title: 'Loading...',
        summary: '',
        tags: [],
        music: '',
        category: 'other',
        content_type: urlType,
        thumbnail_url: thumbnailUrl || undefined,
      };

      setPost(tempPost);
      setProcessing(false);

      // Load collections immediately
      loadCollections();
      setShowCollections(true);

      // For Instagram try to fetch a better title from backend
      if (urlType === 'instagram') {
        fetchInstagramCaption(shortcode).then(caption => {
          setPost(prev => prev ? { ...prev, title: caption } : null);
        }).catch(() => {
          setPost(prev => prev ? { ...prev, title: defaultTitle } : null);
        });
      } else {
        setPost(prev => prev ? { ...prev, title: defaultTitle } : null);
      }

    } catch (err: any) {
      console.error('ShareHandler - Error processing URL:', err);
      setError('Failed to process this URL');
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
        const shortcode = post.shortcode; // already computed correctly for all URL types
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

          // Fire instant + daily notifications for Watch Later adds;
          // fire instant "Saved" notification for all other collections
          if (collectionId === 'default_watch_later') {
            sendImmediateWatchLaterNotification(placeholderPost).catch(() => {});
          } else {
            sendImmediateSavedNotification(placeholderPost).catch(() => {});
          }

          // Trigger backend analysis in background
          apiService.analyzeInstagramUrl(url).then(async () => {
            // When analysis completes, merge fresh posts with analyzing placeholders
            const freshPosts = await apiService.getRecentPosts(50);
            if (freshPosts.length > 0) {
              const stillAnalyzing = postsCache.getAnalyzingPosts().filter(s => s !== shortcode);
              const cachedNow = await postsCache.getCachedPosts() || [];
              const placeholders = cachedNow.filter(
                p => stillAnalyzing.includes(p.shortcode) && !freshPosts.find(fp => fp.shortcode === p.shortcode)
              );
              await postsCache.savePosts([...placeholders, ...freshPosts]);
            }
            postsCache.markAnalysisComplete(shortcode);
          }).catch((err: any) => {
            if (err?.isRetryQueued) {
              showToast('⏰ Queued — will retry automatically tomorrow', 'info');
            } else {
              console.error('Background analysis error:', err);              // Track in local failed list so user can re-analyze from Library
              postsCache.markAsFailed(
                shortcode,
                url,
                post?.title || '',
                post?.thumbnail_url,
                post?.content_type,
              );            }
            postsCache.markAnalysisComplete(shortcode);
          });
        }
      }
      
      showToast('✨ Saved — analyzing in background...', 'info');
      
      // Return to previous app
      setTimeout(() => {
        BackHandler.exitApp();
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
        const shortcode = post.shortcode; // already computed correctly for all URL types
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
          const freshPosts = await apiService.getRecentPosts(50);
          if (freshPosts.length > 0) {
            const sc = post.shortcode!;
            const stillAnalyzing = postsCache.getAnalyzingPosts().filter(s => s !== sc);
            const cachedNow = await postsCache.getCachedPosts() || [];
            const placeholders = cachedNow.filter(
              p => stillAnalyzing.includes(p.shortcode) && !freshPosts.find(fp => fp.shortcode === p.shortcode)
            );
            await postsCache.savePosts([...placeholders, ...freshPosts]);
          }
          if (post.shortcode) postsCache.markAnalysisComplete(post.shortcode);
        }).catch((err: any) => {
          if (err?.isRetryQueued) {
            showToast('⏰ Quota full — queued for retry tomorrow', 'info');
          } else {
            console.error('Background analysis error:', err);            if (post?.shortcode) {
              postsCache.markAsFailed(
                post.shortcode,
                url,
                post?.title || '',
                post?.thumbnail_url,
                post?.content_type,
              );
            }          }
          if (post.shortcode) postsCache.markAnalysisComplete(post.shortcode);
        });
      }
      
      if (post) sendImmediateSavedNotification(post).catch(() => {});
      showToast('✨ Saved — analyzing in background...', 'info');
      
      // Return to previous app
      setTimeout(() => {
        BackHandler.exitApp();
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
        <View style={styles.backdrop}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>🧠</Text>
            <Text style={styles.appName}>SuperBrain</Text>
            <Text style={styles.tagline}>Save it. See it. Do it.</Text>
          </View>
        </View>
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
        <View style={styles.backdrop}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>🧠</Text>
            <Text style={styles.appName}>SuperBrain</Text>
            <Text style={styles.tagline}>Save it. See it. Do it.</Text>
          </View>
        </View>
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
      <View style={styles.backdrop}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>🧠</Text>
          <Text style={styles.appName}>SuperBrain</Text>
          <Text style={styles.tagline}>Save it. See it. Do it.</Text>
        </View>
      </View>
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
    backgroundColor: colors.background,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 200, // Move logo up to avoid bottom sheet
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoText: {
    fontSize: 80,
    marginBottom: 16,
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 1,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textMuted,
    letterSpacing: 0.5,
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
