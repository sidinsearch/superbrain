import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, StatusBar, Modal, TextInput, ActivityIndicator, Linking, InteractionManager } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { Post } from '../types';
import { colors } from '../theme/colors';
import { LinearGradient } from 'expo-linear-gradient';
import apiService from '../services/api';
import postsCache from '../services/postsCache';
import CustomToast from '../components/CustomToast';
import collectionsService from '../services/collections';
import { Collection } from '../types';
import { schedulePostWatchLaterNotification, sendImmediateWatchLaterNotification } from '../services/notificationService';

type Props = NativeStackScreenProps<RootStackParamList, 'PostDetail'>;

const CATEGORIES = [
  { id: 'product', name: 'Product', icon: '📦' },
  { id: 'places', name: 'Places', icon: '📍' },
  { id: 'food', name: 'Food', icon: '🍔' },
  { id: 'fashion', name: 'Fashion', icon: '👗' },
  { id: 'fitness', name: 'Fitness', icon: '💪' },
  { id: 'education', name: 'Education', icon: '📚' },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬' },
  { id: 'pets', name: 'Pets', icon: '🐾' },
  { id: 'other', name: 'Other', icon: '📌' },
];

const PostDetailScreen = ({ route, navigation }: Props) => {
  const { post } = route.params;
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editedCategory, setEditedCategory] = useState(post.category);
  const [editedTitle, setEditedTitle] = useState(post.title);
  const [editedSummary, setEditedSummary] = useState(post.summary);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showCollectionsModal, setShowCollectionsModal] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const titleInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (showEditModal) {
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          titleInputRef.current?.focus();
        }, 500);
      });
    }
  }, [showEditModal]);

  const getPostImageUrl = (post: Post) => {
    if (post.thumbnail_url) return post.thumbnail_url;
    if (post.thumbnail) return post.thumbnail;
    return `https://www.instagram.com/p/${post.shortcode}/media/?size=l`;
  };

  const getContentTypeLabel = (type?: string) => {
    switch (type) {
      case 'youtube':  return { icon: '▶️', label: 'YouTube' };
      case 'webpage':  return { icon: '🌐', label: 'Web Page' };
      default:         return { icon: '📸', label: 'Instagram' };
    }
  };

  const getCategoryColor = (category: string) => {
    return colors.categories[category as keyof typeof colors.categories] || colors.categories.other;
  };

  const getCategoryIcon = (category: string) => {
    const cat = CATEGORIES.find(c => c.id === category);
    return cat ? cat.icon : '📌';
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

  const handleAddToCollection = async (collectionId: string) => {
    try {
      await collectionsService.addPostToCollection(collectionId, post.shortcode);
      // Fire instant "Added to Watch Later" notification + schedule daily reminders
      if (collectionId === 'default_watch_later') {
        sendImmediateWatchLaterNotification(post).catch(() => {});
      }
      
      setShowCollectionsModal(false);
      setToast({ visible: true, message: 'Added to collection', type: 'success' });
    } catch (error) {
      console.error('Error adding to collection:', error);
      
      setToast({ visible: true, message: 'Failed to add to collection', type: 'error' });
    }
  };

  const handleShowCollections = () => {
    loadCollections();
    setShowCollectionsModal(true);
  };

  const handleOpenInstagram = async () => {
    const targetUrl = post.url || `https://www.instagram.com/p/${post.shortcode}/`;
    try {
      await Linking.openURL(targetUrl);
    } catch (error) {
      console.error('Error opening URL:', error);
      setToast({ visible: true, message: 'Failed to open link', type: 'error' });
    }
  };

  const handleReanalyze = async () => {
    if (reanalyzing) return;
    setReanalyzing(true);
    const targetUrl = post.url || `https://www.instagram.com/p/${post.shortcode}/`;
    const { shortcode } = post;

    // Mark in cache so HomeScreen shows the analyzing overlay immediately
    await postsCache.markAsAnalyzing(shortcode);

    // Go back right away — user sees the overlay on HomeScreen while analysis runs
    navigation.goBack();

    // Fire-and-forget: component stays alive in nav stack, closure is safe
    apiService.reanalyzePost(targetUrl)
      .then(async () => {
        await postsCache.markAnalysisComplete(shortcode);
        // Clear stale cache so HomeScreen refetches fresh data on next poll
        await postsCache.removePostFromCache(shortcode);
      })
      .catch(async () => {
        await postsCache.markAnalysisComplete(shortcode);
      })
      .finally(() => setReanalyzing(false));
  };

  const handleDelete = () => {
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    try {
      setDeleting(true);
      // Optimistic: remove locally first so the user is never stuck on a
      // network error. Queue the delete if we're offline.
      await postsCache.removePostFromCache(post.shortcode);
      setShowDeleteModal(false);
      setToast({ visible: true, message: 'Post deleted successfully', type: 'success' });
      setTimeout(() => navigation.goBack(), 1500);
      try {
        await apiService.deletePost(post.shortcode);
      } catch (apiErr: any) {
        if (!apiErr?.response) {
          // Network-level failure — sync when back online
          await postsCache.enqueuePendingMutation({ type: 'delete', shortcode: post.shortcode });
        }
      }
    } catch (error) {
      console.error('Delete error:', error);
      setDeleting(false);
      setToast({ visible: true, message: 'Failed to delete post', type: 'error' });
    }
  };

  const handleEdit = () => {
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    try {
      setSaving(true);
      // Apply changes locally first (optimistic — visible even offline)
      post.category = editedCategory;
      post.title = editedTitle;
      post.summary = editedSummary;
      await postsCache.updatePostInCache(post);
      setShowEditModal(false);
      setToast({ visible: true, message: 'Post updated successfully', type: 'success' });
      // Sync to backend; queue if offline
      try {
        await apiService.updatePost(post.shortcode, {
          category: editedCategory,
          title: editedTitle,
          summary: editedSummary,
        });
      } catch (apiErr: any) {
        if (!apiErr?.response) {
          // Network-level failure — sync when back online
          await postsCache.enqueuePendingMutation({
            type: 'update',
            shortcode: post.shortcode,
            updates: { category: editedCategory, title: editedTitle, summary: editedSummary },
          });
        }
      }
    } catch (error) {
      console.error('Update error:', error);
      setToast({ visible: true, message: 'Failed to update post', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => {
          
          navigation.goBack();
        }}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post Details</Text>
        <View style={styles.actionButtons}>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleShowCollections()}>
            <Text style={styles.actionIcon}>📁</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleReanalyze} disabled={reanalyzing}>
            {reanalyzing
              ? <ActivityIndicator size="small" color={colors.text} />
              : <Text style={styles.actionIcon}>🔄</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleEdit()}>
            <Text style={styles.actionIcon}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleDelete()}>
            <Text style={styles.actionIcon}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Image */}
        <TouchableOpacity onPress={handleOpenInstagram} activeOpacity={0.9}>
          <Image
            source={{ uri: getPostImageUrl(post) }}
            style={styles.image}
            resizeMode="cover"
          />
        </TouchableOpacity>

        {/* Category Badge */}
        {post.category ? (
          <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(post.category) }]}>
            <Text style={styles.categoryBadgeIcon}>{getCategoryIcon(post.category)}</Text>
            <Text style={styles.categoryBadgeText}>{post.category.toUpperCase()}</Text>
          </View>
        ) : null}

        {/* Content Type Badge */}
        {(() => {
          const ct = getContentTypeLabel(post.content_type);
          return (
            <View style={styles.contentTypeBadge}>
              <Text style={styles.contentTypeBadgeText}>{ct.icon} {ct.label}</Text>
            </View>
          );
        })()}

        {/* Title */}
        <Text style={styles.title}>{post.title || 'Untitled'}</Text>

        {/* Username & Date */}
        <View style={styles.metaContainer}>
          <Text style={styles.username}>@{post.username || 'unknown'}</Text>
          {post.post_date ? (
            <Text style={styles.date}>{new Date(post.post_date).toLocaleDateString()}</Text>
          ) : null}
        </View>

        {/* Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <Text style={styles.summaryText}>{post.summary || 'No summary available'}</Text>
        </View>

        {/* Tags */}
        {post.tags && post.tags.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tags</Text>
            <View style={styles.tagsContainer}>
              {post.tags.map((tag, index) => (
                <View key={index} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Music - not shown for webpages */}
        {post.content_type !== 'webpage' && post.music && post.music !== 'No music identified' && post.music !== '' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Music</Text>
            <View style={styles.musicCard}>
              <Text style={styles.musicIcon}>🎵</Text>
              <Text style={styles.musicText}>{post.music}</Text>
            </View>
          </View>
        ) : null}

        {/* Stats */}
        <View style={styles.statsContainer}>
          {post.likes && post.likes > 0 ? (
            <View style={styles.statBox}>
              <Text style={styles.statIcon}>❤️</Text>
              <Text style={styles.statValue}>{post.likes}</Text>
              <Text style={styles.statLabel}>Likes</Text>
            </View>
          ) : null}
        </View>

        {/* Original URL */}
        <TouchableOpacity style={styles.linkButton} onPress={handleOpenInstagram}>
          <Text style={styles.linkButtonText}>
            {post.content_type === 'youtube' ? 'Open in YouTube' :
             post.content_type === 'webpage' ? 'Open Web Page' :
             'Open in Instagram'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Edit Modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditModal(false)}
      >
        <TouchableOpacity 
          activeOpacity={1} 
          style={styles.modalOverlay}
          onPress={() => setShowEditModal(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.modalContent, { marginBottom: 250 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit Post</Text>
                <TouchableOpacity onPress={() => setShowEditModal(false)}>
                  <Text style={styles.modalCloseIcon}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView 
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
              >
              <Text style={styles.inputLabel}>Title</Text>
              <TextInput
                ref={titleInputRef}
                style={styles.modalInput}
                value={editedTitle}
                onChangeText={setEditedTitle}
                multiline
                numberOfLines={2}
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.inputLabel}>Summary</Text>
              <TextInput
                style={[styles.modalInput, styles.modalInputMultiline]}
                value={editedSummary}
                onChangeText={setEditedSummary}
                multiline
                numberOfLines={4}
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.inputLabel}>Category</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categoriesScroll}
                contentContainerStyle={styles.categoriesContent}
                keyboardShouldPersistTaps="always"
              >
                {CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryOption,
                      editedCategory === cat.id && styles.categoryOptionActive,
                    ]}
                    onPress={() => setEditedCategory(cat.id)}
                  >
                    <Text style={styles.categoryOptionIcon}>{cat.icon}</Text>
                    <Text
                      style={[
                        styles.categoryOptionText,
                        editedCategory === cat.id && styles.categoryOptionTextActive,
                      ]}
                    >
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowEditModal(false)}
                disabled={saving}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButtonSave, saving && styles.buttonDisabled]}
                onPress={handleSaveEdit}
                disabled={saving}
              >
                <Text style={styles.modalButtonSaveText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <View style={styles.deleteIconContainer}>
              <Text style={styles.deleteIcon}>🗑️</Text>
            </View>
            <Text style={styles.deleteTitle}>Delete Post?</Text>
            <Text style={styles.deleteMessage}>
              Are you sure you want to delete this post? This action cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButtonDelete, deleting && styles.buttonDisabled]}
                onPress={confirmDelete}
                disabled={deleting}
              >
                <Text style={styles.modalButtonDeleteText}>{deleting ? 'Deleting...' : 'Delete'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Collections Modal */}
      <Modal
        visible={showCollectionsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCollectionsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add to Collection</Text>
              <TouchableOpacity onPress={() => setShowCollectionsModal(false)}>
                <Text style={styles.modalCloseIcon}>✕</Text>
              </TouchableOpacity>
            </View>

            {loadingCollections ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Loading collections...</Text>
              </View>
            ) : collections.length === 0 ? (
              <View style={styles.emptyCollections}>
                <Text style={styles.emptyIcon}>📂</Text>
                <Text style={styles.emptyTitle}>No Collections</Text>
                <Text style={styles.emptyText}>Create collections in the Library tab first</Text>
                <TouchableOpacity
                  style={styles.goToLibraryButton}
                  onPress={() => {
                    setShowCollectionsModal(false);
                    navigation.navigate('Library');
                  }}
                >
                  <Text style={styles.goToLibraryText}>Go to Library</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={styles.collectionsList} showsVerticalScrollIndicator={false}>
                {collections.map((collection) => (
                  <TouchableOpacity
                    key={collection.id}
                    style={styles.collectionItem}
                    onPress={() => handleAddToCollection(collection.id)}
                  >
                    <View style={styles.collectionItemLeft}>
                      <Text style={styles.collectionItemIcon}>{collection.icon}</Text>
                      <View>
                        <Text style={styles.collectionItemName}>{collection.name}</Text>
                        <Text style={styles.collectionItemCount}>
                          {collection.postIds.length} {collection.postIds.length === 1 ? 'post' : 'posts'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.collectionItemArrow}>→</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: colors.backgroundCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: 8,
  },
  backIcon: {
    fontSize: 28,
    color: colors.text,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {
    fontSize: 22,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 40,
  },
  image: {
    width: '100%',
    height: 400,
    backgroundColor: colors.backgroundCard,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginHorizontal: 20,
    marginTop: -20,
    marginBottom: 20,
    gap: 6,
  },
  categoryBadgeIcon: {
    fontSize: 14,
  },
  categoryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  contentTypeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 20,
    marginBottom: 12,
  },
  contentTypeBadgeText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: 20,
    marginBottom: 16,
    lineHeight: 32,
  },
  metaContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  username: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
  },
  date: {
    fontSize: 14,
    color: colors.textMuted,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: colors.backgroundCard,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  musicCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  musicIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  musicText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 24,
    gap: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.backgroundCard,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  linkButton: {
    marginHorizontal: 20,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  linkButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  modalCloseIcon: {
    fontSize: 24,
    color: colors.textMuted,
    padding: 4,
  },
  deleteModalContent: {
    backgroundColor: colors.background,
    borderRadius: 24,
    padding: 24,
    marginHorizontal: 20,
    alignItems: 'center',
  },
  deleteIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.backgroundCard,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  deleteIcon: {
    fontSize: 40,
  },
  deleteTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  deleteMessage: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    marginTop: 8,
  },
  modalInput: {
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 16,
  },
  modalInputMultiline: {
    height: 100,
    textAlignVertical: 'top',
  },
  categoriesScroll: {
    marginBottom: 24,
  },
  categoriesContent: {
    paddingRight: 20,
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.backgroundCard,
    marginRight: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryOptionIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  categoryOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  categoryOptionTextActive: {
    color: '#fff',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButtonCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalButtonSave: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalButtonSaveText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalButtonDelete: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  modalButtonDeleteText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textMuted,
  },
  emptyCollections: {
    padding: 40,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
  },
  goToLibraryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  goToLibraryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  collectionsList: {
    maxHeight: 400,
  },
  collectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  collectionItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  collectionItemIcon: {
    fontSize: 28,
  },
  collectionItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  collectionItemCount: {
    fontSize: 13,
    color: colors.textMuted,
  },
  collectionItemArrow: {
    fontSize: 20,
    color: colors.textMuted,
  },
});

export default PostDetailScreen;
