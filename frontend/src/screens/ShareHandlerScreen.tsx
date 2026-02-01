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
  const { url } = route.params;
  const [processing, setProcessing] = useState(true);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showCollections, setShowCollections] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });

  useEffect(() => {
    handleInstagramUrl();
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
    try {
      setProcessing(true);
      setError(null);

      const shortcode = extractShortcode(url);
      if (!shortcode) {
        setError('Invalid Instagram URL');
        setProcessing(false);
        return;
      }

      // Check if post already exists in cache
      const cachedPosts = await postsCache.getCachedPosts();
      const existingPost = cachedPosts?.find(p => p.shortcode === shortcode);

      if (existingPost) {
        setPost(existingPost);
        setProcessing(false);
        setShowCollections(true);
        return;
      }

      // Call backend to analyze and save the post
      const response = await apiService.analyzeInstagramUrl(url);
      
      if (response && response.shortcode) {
        // Refresh cache to get the new post
        const updatedPosts = await apiService.getPosts();
        await postsCache.savePosts(updatedPosts);
        
        const newPost = updatedPosts.find(p => p.shortcode === shortcode);
        if (newPost) {
          setPost(newPost);
          setProcessing(false);
          setShowCollections(true);
        }
      }
    } catch (err) {
      console.error('Error processing Instagram URL:', err);
      setError('Failed to process Instagram post');
      setProcessing(false);
    }
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
    if (!post) return;
    
    try {
      await collectionsService.addPostToCollection(collectionId, post.shortcode);
      setToast({ visible: true, message: 'Added to collection', type: 'success' });
      setTimeout(() => {
        navigation.goBack();
      }, 1000);
    } catch (error) {
      console.error('Error adding to collection:', error);
      setToast({ visible: true, message: 'Failed to add to collection', type: 'error' });
    }
  };

  const handleSkip = () => {
    navigation.goBack();
  };

  if (processing) {
    return (
      <Modal visible={true} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.processingContainer}>
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
        </View>
      </Modal>
    );
  }

  if (error) {
    return (
      <Modal visible={true} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.contentContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Error</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={handleSkip}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={true} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.contentContainer}>
          <View style={styles.successHeader}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successTitle}>Saved to SuperBrain</Text>
          </View>

          {post ? (
            <View style={styles.postPreview}>
              <Image
                source={{ uri: post.thumbnail_url }}
                style={styles.previewImage}
                resizeMode="cover"
              />
              <Text style={styles.postTitle} numberOfLines={2}>
                {post.title || 'Untitled'}
              </Text>
            </View>
          ) : null}

          <Text style={styles.collectionsTitle}>Add to Collection</Text>

          {loadingCollections ? (
            <View style={styles.collectionsLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : collections.length === 0 ? (
            <View style={styles.emptyCollections}>
              <Text style={styles.emptyText}>No collections yet</Text>
              <Text style={styles.emptySubtext}>Create one in the Library tab</Text>
            </View>
          ) : (
            <ScrollView style={styles.collectionsList} showsVerticalScrollIndicator={false}>
              {collections.map((collection) => (
                <TouchableOpacity
                  key={collection.id}
                  style={styles.collectionItem}
                  onPress={() => handleAddToCollection(collection.id)}
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

          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>

      <CustomToast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast({ ...toast, visible: false })}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  contentContainer: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  processingContainer: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  thumbnailContainer: {
    width: width - 48,
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
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
  successHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  successIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  postPreview: {
    alignItems: 'center',
    marginBottom: 24,
  },
  previewImage: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginBottom: 12,
  },
  postTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  collectionsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  collectionsLoading: {
    padding: 20,
    alignItems: 'center',
  },
  collectionsList: {
    maxHeight: 200,
    marginBottom: 16,
  },
  collectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  collectionIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  collectionInfo: {
    flex: 1,
  },
  collectionName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  collectionCount: {
    fontSize: 13,
    color: colors.textMuted,
  },
  collectionArrow: {
    fontSize: 20,
    color: colors.textMuted,
  },
  emptyCollections: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textMuted,
  },
  skipButton: {
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
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
