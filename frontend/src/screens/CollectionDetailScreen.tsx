import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  StatusBar,
  ActivityIndicator,
  Dimensions,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { Post } from '../types';
import { colors } from '../theme/colors';
import collectionsService from '../services/collections';
import postsCache from '../services/postsCache';
import CustomToast from '../components/CustomToast';

type Props = NativeStackScreenProps<RootStackParamList, 'CollectionDetail'>;

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

const CollectionDetailScreen = ({ route, navigation }: Props) => {
  const { collection } = route.params;
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });

  useEffect(() => {
    loadCollectionPosts();
  }, []);

  const loadCollectionPosts = async () => {
    try {
      setLoading(true);
      // Get all posts from cache
      const allPosts = await postsCache.getCachedPosts();
      if (allPosts) {
        // Filter posts that are in this collection
        const collectionPosts = allPosts.filter(post => 
          collection.postIds.includes(post.shortcode)
        );
        setPosts(collectionPosts);
      }
    } catch (error) {
      console.error('Error loading collection posts:', error);
      setToast({ visible: true, message: 'Failed to load posts', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const togglePostSelection = (shortcode: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newSelection = new Set(selectedPosts);
    if (newSelection.has(shortcode)) {
      newSelection.delete(shortcode);
    } else {
      newSelection.add(shortcode);
    }
    setSelectedPosts(newSelection);
  };

  const handleSelectAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (selectedPosts.size === filteredPosts.length) {
      setSelectedPosts(new Set());
    } else {
      setSelectedPosts(new Set(filteredPosts.map(p => p.shortcode)));
    }
  };

  const handleRemoveSelected = async () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      for (const shortcode of Array.from(selectedPosts)) {
        await collectionsService.removePostFromCollection(collection.id, shortcode);
      }
      // Update collection postIds
      collection.postIds = collection.postIds.filter(id => !selectedPosts.has(id));
      
      // Reload posts
      await loadCollectionPosts();
      setSelectedPosts(new Set());
      setSelectionMode(false);
      setToast({ visible: true, message: `Removed ${selectedPosts.size} post(s)`, type: 'success' });
    } catch (error) {
      console.error('Error removing posts:', error);
      
      setToast({ visible: true, message: 'Failed to remove posts', type: 'error' });
    }
  };

  const handleOpenInstagram = async (shortcode: string) => {
    const url = `https://www.instagram.com/p/${shortcode}/`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        setToast({ visible: true, message: 'Cannot open Instagram', type: 'error' });
      }
    } catch (error) {
      console.error('Error opening Instagram:', error);
      setToast({ visible: true, message: 'Failed to open link', type: 'error' });
    }
  };

  const getCategoryColor = (category: string) => {
    return colors.categories[category as keyof typeof colors.categories] || colors.categories.other;
  };

  const getCategoryIcon = (category: string) => {
    const categoryMap: { [key: string]: string } = {
      'product': '📦',
      'places': '📍',
      'food': '🍔',
      'fashion': '👗',
      'fitness': '💪',
      'education': '📚',
      'entertainment': '🎬',
      'pets': '🐾',
      'other': '📌'
    };
    return categoryMap[category] || '📌';
  };

  const getInstagramImageUrl = (shortcode: string) => {
    return `https://www.instagram.com/p/${shortcode}/media/?size=l`;
  };

  const filteredPosts = posts.filter(post =>
    searchQuery === '' ||
    (post.title && post.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (post.summary && post.summary.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (post.tags && post.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  const renderPost = (post: Post) => {
    const isSelected = selectedPosts.has(post.shortcode);
    const categoryColor = getCategoryColor(post.category);

    return (
      <TouchableOpacity
        key={post.shortcode}
        style={[styles.postCard, isSelected && styles.postCardSelected]}
        onPress={() => {
          if (selectionMode) {
            togglePostSelection(post.shortcode);
          } else {
            navigation.navigate('PostDetail', { post });
          }
        }}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setSelectionMode(true);
          togglePostSelection(post.shortcode);
        }}
        activeOpacity={0.9}
      >
        <Image
          source={{ uri: getInstagramImageUrl(post.shortcode) }}
          style={styles.postImage}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={styles.postGradient}
        >
          {post.category ? (
            <View style={[styles.categoryBadgeSmall, { backgroundColor: categoryColor }]}>
              <Text style={styles.categoryBadgeTextSmall}>{getCategoryIcon(post.category)}</Text>
            </View>
          ) : null}
          <Text style={styles.postTitle} numberOfLines={2}>
            {post.title || 'Untitled'}
          </Text>
          <Text style={styles.postUsername} numberOfLines={1}>@{post.username || 'unknown'}</Text>
        </LinearGradient>
        {selectionMode && (
          <View style={styles.selectionOverlay}>
            <View style={[styles.selectionCheckbox, isSelected && styles.selectionCheckboxActive]}>
              {isSelected && <Text style={styles.selectionCheck}>✓</Text>}
            </View>
          </View>
        )}
        <TouchableOpacity
          style={styles.instagramButton}
          onPress={(e) => {
            e.stopPropagation();
            handleOpenInstagram(post.shortcode);
          }}
        >
          <Text style={styles.instagramIcon}>🔗</Text>
        </TouchableOpacity>
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
        <View style={styles.headerCenter}>
          <View style={styles.headerIconContainer}>
            <Text style={styles.headerIcon}>{collection.icon}</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>{collection.name}</Text>
            <Text style={styles.headerSubtitle}>{posts.length} posts</Text>
          </View>
        </View>
        {selectionMode ? (
          <TouchableOpacity style={styles.cancelButton} onPress={() => {
            setSelectionMode(false);
            setSelectedPosts(new Set());
          }}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={styles.searchIconContainer}>
          <Text style={styles.searchIconText}>🔍</Text>
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder="Search posts in collection..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery !== '' && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
            <Text style={styles.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Selection Actions */}
      {selectionMode && (
        <View style={styles.actionsBar}>
          <TouchableOpacity style={styles.actionButton} onPress={handleSelectAll}>
            <Text style={styles.actionButtonText}>
              {selectedPosts.size === filteredPosts.length ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
          {selectedPosts.size > 0 && (
            <TouchableOpacity style={styles.actionButtonDanger} onPress={handleRemoveSelected}>
              <Text style={styles.actionButtonDangerText}>
                Remove {selectedPosts.size}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Posts Grid */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading posts...</Text>
        </View>
      ) : filteredPosts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No Posts</Text>
          <Text style={styles.emptyText}>
            {searchQuery ? 'No posts match your search' : 'Add posts to this collection from the home screen'}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.postsContainer}
          contentContainerStyle={styles.postsContent}
        >
          <View style={styles.postsGrid}>
            {filteredPosts.map(post => renderPost(post))}
          </View>
        </ScrollView>
      )}

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
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  headerIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerIcon: {
    fontSize: 24,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  selectButton: {
    padding: 8,
  },
  selectIcon: {
    fontSize: 22,
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 15,
    color: colors.error,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 60,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    marginHorizontal: 16,
    marginVertical: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIconContainer: {
    marginRight: 8,
  },
  searchIconText: {
    fontSize: 18,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
  },
  clearButton: {
    padding: 4,
  },
  clearIcon: {
    fontSize: 18,
    color: colors.textMuted,
  },
  actionsBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  actionButtonDanger: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: colors.error,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonDangerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textMuted,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  postsContainer: {
    flex: 1,
  },
  postsContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  postsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  postCard: {
    width: CARD_WIDTH,
    height: 220,
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.backgroundCard,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  postCardSelected: {
    borderColor: colors.primary,
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  postGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    justifyContent: 'flex-end',
  },
  categoryBadgeSmall: {
    alignSelf: 'flex-start',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryBadgeTextSmall: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  postTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  postUsername: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  selectionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionCheckbox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundCard,
    borderWidth: 2,
    borderColor: colors.text,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionCheckboxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  selectionCheck: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '700',
  },
  instagramButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  instagramIcon: {
    fontSize: 16,
  },
});

export default CollectionDetailScreen;
