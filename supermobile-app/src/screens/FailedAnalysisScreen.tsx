import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  StatusBar,
  ActivityIndicator,
  Dimensions,
  Modal,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { FailedPost, Post } from '../types';
import { colors } from '../theme/colors';
import postsCache from '../services/postsCache';
import apiService from '../services/api';
import CustomToast from '../components/CustomToast';

type Props = NativeStackScreenProps<RootStackParamList, 'FailedAnalysis'>;

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

const FailedAnalysisScreen = ({ navigation }: Props) => {
  const [failedPosts, setFailedPosts] = useState<FailedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<FailedPost | null>(null);
  const [reanalyzingPosts, setReanalyzingPosts] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });

  const loadFailedPosts = useCallback(async () => {
    try {
      setLoading(true);
      const failed = await postsCache.getFailedPosts();
      setFailedPosts(failed);
    } catch (error) {
      console.error('FailedAnalysisScreen - Error loading failed posts:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFailedPosts();
  }, [loadFailedPosts]);

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => {
    setToast({ visible: true, message, type });
  };

  const getThumbnailUrl = (fp: FailedPost): string => {
    if (fp.thumbnail_url) return fp.thumbnail_url;
    if (fp.content_type === 'instagram') {
      return `https://www.instagram.com/p/${fp.shortcode}/media/?size=m`;
    }
    return '';
  };

  const getContentTypeIcon = (type?: string): string => {
    switch (type) {
      case 'youtube': return '🎥';
      case 'webpage': return '🌐';
      default: return '📸';
    }
  };

  const handleDelete = async (fp: FailedPost) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await postsCache.removeFailed(fp.shortcode);
    await postsCache.removePostFromCache(fp.shortcode);
    const updated = failedPosts.filter(p => p.shortcode !== fp.shortcode);
    setFailedPosts(updated);
    setSelectedPost(null);
    if (updated.length === 0) {
      navigation.goBack();
    }
  };

  const handleReanalyze = async (fp: FailedPost) => {
    if (reanalyzingPosts.has(fp.shortcode)) return;
    setReanalyzingPosts(prev => new Set(prev).add(fp.shortcode));

    // Optimistically remove from failed list
    await postsCache.removeFailed(fp.shortcode);
    // Mark as analyzing so HomeScreen shows the overlay
    postsCache.markAsAnalyzing(fp.shortcode);
    // Add placeholder to cache so it appears on HomeScreen
    const placeholder: Post = {
      shortcode: fp.shortcode,
      url: fp.url,
      title: fp.title || fp.url,
      username: '',
      summary: '',
      tags: [],
      music: '',
      category: 'other',
      content_type: fp.content_type as any,
      thumbnail_url: fp.thumbnail_url,
      processing: true,
    };
    const cached = await postsCache.getCachedPosts() || [];
    await postsCache.savePosts([placeholder, ...cached.filter(p => p.shortcode !== fp.shortcode)]);

    const updated = failedPosts.filter(p => p.shortcode !== fp.shortcode);
    setFailedPosts(updated);
    setSelectedPost(null);

    // Navigate to Home so user sees the analyzing overlay
    navigation.navigate('Home');

    // Fire re-analysis in background (fire-and-forget after navigate)
    apiService.reanalyzePost(fp.url)
      .then(async () => {
        const freshPosts = await apiService.getRecentPosts(50);
        await postsCache.savePosts(freshPosts);
        postsCache.markAnalysisComplete(fp.shortcode);
      })
      .catch(async () => {
        await postsCache.markAsFailed(fp.shortcode, fp.url, fp.title, fp.thumbnail_url, fp.content_type);
        postsCache.markAnalysisComplete(fp.shortcode);
      })
      .finally(() => {
        setReanalyzingPosts(prev => {
          const s = new Set(prev);
          s.delete(fp.shortcode);
          return s;
        });
      });
  };

  const handleView = async (fp: FailedPost) => {
    try {
      await Linking.openURL(fp.url);
    } catch {
      showToast('Failed to open link', 'error');
    }
  };

  const renderCard = (fp: FailedPost) => {
    const thumbnailUrl = getThumbnailUrl(fp);
    const isReanalyzing = reanalyzingPosts.has(fp.shortcode);

    return (
      <TouchableOpacity
        key={fp.shortcode}
        style={styles.postCard}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedPost(fp);
        }}
        activeOpacity={0.85}
      >
        {thumbnailUrl ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.postImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.postImage, styles.postImagePlaceholder]}>
            <Text style={styles.postImagePlaceholderIcon}>
              {getContentTypeIcon(fp.content_type)}
            </Text>
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={styles.postGradient}
        >
          <Text style={styles.postTitle} numberOfLines={2}>
            {fp.title || fp.url}
          </Text>
        </LinearGradient>
        {/* Red warning badge */}
        <View style={styles.failedBadge}>
          <Text style={styles.failedBadgeText}>⚠️</Text>
        </View>
        {isReanalyzing && (
          <View style={styles.analyzingOverlay}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.analyzingText}>Queuing…</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>⚠️ Failed Analysis</Text>
          <Text style={styles.headerSubtitle}>
            {failedPosts.length} {failedPosts.length === 1 ? 'post' : 'posts'} failed
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : failedPosts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyTitle}>All Clear!</Text>
          <Text style={styles.emptyText}>No failed posts.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          <View style={styles.gridRow}>
            {failedPosts.map((fp, i) => {
              // Group into rows of 2
              if (i % 2 !== 0) return null;
              const next = failedPosts[i + 1];
              return (
                <View key={fp.shortcode} style={styles.rowContainer}>
                  {renderCard(fp)}
                  {next ? renderCard(next) : <View style={styles.postCardEmpty} />}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Detail bottom sheet */}
      <Modal
        visible={!!selectedPost}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPost(null)}
      >
        <TouchableOpacity
          style={styles.sheetOverlay}
          activeOpacity={1}
          onPress={() => setSelectedPost(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation()}>
            <View style={styles.sheet}>
              {/* Drag bar */}
              <View style={styles.sheetHandle} />

              {/* Thumbnail */}
              {selectedPost && (() => {
                const thumbUrl = getThumbnailUrl(selectedPost);
                return thumbUrl ? (
                  <Image
                    source={{ uri: thumbUrl }}
                    style={styles.sheetImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.sheetImage, styles.postImagePlaceholder]}>
                    <Text style={styles.postImagePlaceholderIcon}>
                      {getContentTypeIcon(selectedPost.content_type)}
                    </Text>
                  </View>
                );
              })()}

              {/* Title */}
              <Text style={styles.sheetTitle} numberOfLines={3}>
                {selectedPost?.title || selectedPost?.url}
              </Text>

              {/* Failed date */}
              {selectedPost?.failedAt && (
                <Text style={styles.sheetDate}>
                  Failed {new Date(selectedPost.failedAt).toLocaleDateString()}
                </Text>
              )}

              {/* Action buttons */}
              <View style={styles.sheetActions}>
                <TouchableOpacity
                  style={styles.btnView}
                  onPress={() => selectedPost && handleView(selectedPost)}
                >
                  <Text style={styles.btnViewText}>🔗 View</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.btnDelete}
                  onPress={() => selectedPost && handleDelete(selectedPost)}
                >
                  <Text style={styles.btnDeleteText}>🗑 Delete</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.btnReanalyze,
                    selectedPost && reanalyzingPosts.has(selectedPost.shortcode) && { opacity: 0.5 },
                  ]}
                  onPress={() => selectedPost && handleReanalyze(selectedPost)}
                  disabled={!!selectedPost && reanalyzingPosts.has(selectedPost.shortcode)}
                >
                  {selectedPost && reanalyzingPosts.has(selectedPost.shortcode) ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.btnReanalyzeText}>🔄 Re-analyze</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <CustomToast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.backgroundCard,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  backIcon: {
    fontSize: 20,
    color: colors.text,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: 15,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
  grid: {
    padding: 16,
    paddingBottom: 32,
  },
  gridRow: {
    flexDirection: 'column',
    gap: 0,
  },
  rowContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 12,
  },
  postCard: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.25,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.backgroundCard,
    borderWidth: 1.5,
    borderColor: '#d4350080',
  },
  postCardEmpty: {
    width: CARD_WIDTH,
  },
  postImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  postImagePlaceholder: {
    backgroundColor: colors.backgroundCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postImagePlaceholderIcon: {
    fontSize: 40,
  },
  postGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
    justifyContent: 'flex-end',
    padding: 10,
  },
  postTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  failedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 2,
  },
  failedBadgeText: {
    fontSize: 14,
  },
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  analyzingText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  // Bottom sheet
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: 16,
  },
  sheetImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 14,
    backgroundColor: colors.background,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
    lineHeight: 22,
    width: '100%',
  },
  sheetDate: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 20,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 4,
  },
  btnView: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  btnViewText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  btnDelete: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#d4350022',
    borderWidth: 1,
    borderColor: '#d43500',
    alignItems: 'center',
  },
  btnDeleteText: {
    color: '#d43500',
    fontSize: 13,
    fontWeight: '600',
  },
  btnReanalyze: {
    flex: 1.3,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnReanalyzeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default FailedAnalysisScreen;
