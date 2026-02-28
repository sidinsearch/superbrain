import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  Dimensions,
  Modal,
  InteractionManager,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import apiService from '../services/api';
import postsCache from '../services/postsCache';
import collectionsService from '../services/collections';
import { scheduleAllWatchLaterNotifications } from '../services/notificationService';
import { Post, Collection } from '../types';
import { colors } from '../theme/colors';
import { RootStackParamList } from '../../App';
import CustomToast from '../components/CustomToast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

const CATEGORIES = [
  { id: 'all', name: 'All', icon: '🌟' },
  { id: 'product', name: 'Product', icon: '📦' },
  { id: 'places', name: 'Places', icon: '📍' },
  { id: 'food', name: 'Food', icon: '🍔' },
  { id: 'fashion', name: 'Fashion', icon: '👗' },
  { id: 'fitness', name: 'Fitness', icon: '💪' },
  { id: 'education', name: 'Education', icon: '📚' },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬' },
  { id: 'pets', name: 'Pets', icon: '🐾' },
];

const HomeScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showCollectionsModal, setShowCollectionsModal] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });
  const [isInitialized, setIsInitialized] = useState(false);
  const [isConfigured, setIsConfigured] = useState(true);
  // analyzingIds mirrors postsCache.analyzingPosts as React state so that
  // clearing an overlay always triggers a re-render even if `posts` doesn't change.
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(
    () => new Set(postsCache.getAnalyzingPosts())
  );
  const syncAnalyzingIds = () => setAnalyzingIds(new Set(postsCache.getAnalyzingPosts()));
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const loadPostsRef = useRef<((forceRefresh?: boolean) => Promise<void>) | undefined>(undefined);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  useEffect(() => {
    initializeAndLoad();
    checkFirstLaunch();
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Refresh when screen comes into focus (but skip first time).
  // Deferred with InteractionManager so the navigation animation completes
  // before we do any AsyncStorage reads or setState calls — prevents jank.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (isInitialized) {
        InteractionManager.runAfterInteractions(() => {
          loadPosts(false);
        });
      }
    });
    return unsubscribe;
  }, [navigation, isInitialized]);

  const checkFirstLaunch = async () => {
    try {
      const seen = await AsyncStorage.getItem('@superbrain_onboarded');
      if (seen) return;
      // Existing install upgrading — user already has data, skip tutorial
      const existingPosts = await AsyncStorage.getItem('@superbrain_posts_cache');
      const existingCollections = await AsyncStorage.getItem('@superbrain_collections');
      if (existingPosts || existingCollections) {
        await AsyncStorage.setItem('@superbrain_onboarded', '1');
        return;
      }
      setTimeout(() => setShowOnboarding(true), 700);
    } catch { /* ignore */ }
  };

  const dismissOnboarding = async () => {
    try { await AsyncStorage.setItem('@superbrain_onboarded', '1'); } catch { /* ignore */ }
    setShowOnboarding(false);
    setOnboardingStep(0);
  };

  const ONBOARDING_STEPS = [
    {
      icon: '🧠',
      title: 'Welcome to SuperBrain',
      description: 'Your personal second brain. Save posts from Instagram, YouTube, and Websites — no need to endlessly scroll through your saves. Find anything fast with search and filters.',
    },
    {
      icon: '↗️',
      title: 'Save from Anywhere',
      description: 'Open any Instagram post, YouTube video, or Website → tap Share → select SuperBrain. Done. Your content is saved and analyzed instantly.',
    },
    {
      icon: '📱',
      title: 'Explore Your Feed',
      description: 'Scroll through your saves, filter by category, or search. Tap a post to see full details. Long-press to select and delete multiple posts at once.',
    },
  ];

  const initializeAndLoad = async () => {
    // Pre-load cached posts IMMEDIATELY so the user sees their data even if
    // the backend is unreachable. This runs before any network call.
    try {
      const cached = await postsCache.getCachedPosts();
      if (cached && cached.length > 0) {
        setPosts(cached);
        setLoading(false);
        syncAnalyzingIds();
      }
    } catch { /* ignore — will retry in loadPosts */ }

    try {
      await apiService.initialize();
      const token = await apiService.getApiToken();
      if (!token) {
        setIsConfigured(false);
        setLoading(false);
        setIsInitialized(true);
        return;
      }
      setIsConfigured(true);
      // Fire-and-forget background tasks — don't block post loading on network calls
      collectionsService.syncFromBackend().catch(() => {});
      scheduleAllWatchLaterNotifications().catch(() => {});
      await loadPosts(false);
      setIsInitialized(true);
    } catch (error) {
      console.error('Error initializing:', error);
      // Still show cached posts if available rather than a blank screen
      try {
        const cached = await postsCache.getCachedPosts();
        if (cached && cached.length > 0) {
          setPosts(cached);
          setLoading(false);
          setIsConfigured(true);
          syncAnalyzingIds();
        }
      } catch { /* nothing we can do */ }
      showToast('Server unreachable — showing cached data', 'info');
      setIsInitialized(true);
    }
  };

  const loadPosts = async (forceRefresh: boolean = false) => {
    try {
      // Reconcile: if a post was in the failed list AND still stuck in analyzing, clean it up.
      // This prevents \"✨ Analyzing...\" overlay appearing permanently for posts that failed
      // analysis while the app was in the background.
      const failedList = await postsCache.getFailedPosts();
      if (failedList.length > 0) {
        for (const fp of failedList) {
          if (postsCache.isAnalyzing(fp.shortcode)) {
            postsCache.markAnalysisComplete(fp.shortcode);
          }
        }
        syncAnalyzingIds();
      }

      // Guard: never show any data if token is not configured
      const token = await apiService.getApiToken();
      if (!token) {
        setIsConfigured(false);
        setLoading(false);
        return;
      }
      // Always load and display cached posts immediately (non-blocking)
      const cachedPosts = await postsCache.getCachedPosts();
      if (cachedPosts && cachedPosts.length > 0) {
        console.log('HomeScreen - Loaded from cache:', cachedPosts.length, 'posts');
        // Only update UI if something actually changed — avoids redundant re-renders
        // on every screen focus when the list is already up to date.
        setPosts(prev => {
          if (
            prev.length === cachedPosts.length &&
            prev[0]?.shortcode === cachedPosts[0]?.shortcode &&
            prev[prev.length - 1]?.shortcode === cachedPosts[cachedPosts.length - 1]?.shortcode
          ) return prev;
          return cachedPosts;
        });
        setLoading(false); // Clear loading immediately when we have cache
        
        // Only skip the server fetch if the cache is still fresh AND no posts are
        // still being analyzed. isCacheValid() is a synchronous in-memory check.
        if (!forceRefresh) {
          if (postsCache.isCacheValid() && postsCache.getAnalyzingPosts().length === 0) {
            return;
          }
        }
        
        // If we got here, we'll fetch in background but UI is already showing cached posts
      } else {
        // No cache, show loading spinner
        setLoading(true);
      }
      
      // Fetch from server in background (UI already showing if we have cache)
      console.log('HomeScreen - Fetching from server in background...');
      const fetchedPosts = await apiService.getRecentPosts(50);
      console.log('HomeScreen - Fetched', fetchedPosts.length, 'posts from server');
      
      // Reconcile analyzing state against whatever the server returned
      // (even if it returned nothing — we still want to clear completed posts)
      const prevAnalyzing = postsCache.getAnalyzingPosts();
      for (const shortcode of prevAnalyzing) {
        const serverPost = fetchedPosts.find(p => p.shortcode === shortcode);
        if (serverPost && !serverPost.processing) {
          await postsCache.markAnalysisComplete(shortcode);
          console.log('HomeScreen - Analysis complete for:', shortcode);
        }
      }
      syncAnalyzingIds(); // update React state so overlay re-renders immediately

      const stillAnalyzing = postsCache.getAnalyzingPosts();
      const hasAnalyzing = stillAnalyzing.length > 0;

      if (fetchedPosts.length > 0) {
        // Server returned real data — safe to merge placeholders + save
        const analyzingPlaceholders = (cachedPosts || []).filter(
          p => stillAnalyzing.includes(p.shortcode) && !fetchedPosts.find(fp => fp.shortcode === p.shortcode)
        );
        const mergedPosts = [
          ...analyzingPlaceholders,
          ...fetchedPosts.filter(p => !stillAnalyzing.includes(p.shortcode)),
        ];
        setPosts(mergedPosts);
        await postsCache.savePosts(mergedPosts);
      } else if (cachedPosts && cachedPosts.length > 0) {
        // Server returned empty (offline / busy / error) — keep showing cached data.
        // CRITICAL: do NOT call savePosts here or we wipe real posts from the cache.
        console.log('HomeScreen - Server returned empty, keeping cached posts intact');
        setPosts(cachedPosts);
      } else {
        console.log('HomeScreen - No posts found anywhere');
        showToast('No posts yet — share something to get started!', 'info');
      }

      if (hasAnalyzing && !pollIntervalRef.current) {
        // Poll /recent directly every 3 s. No queue-status indirection — we just
        // check whether each analyzing post now has processing:false on the server.
        console.log('HomeScreen - Starting analyzing watcher');
        pollIntervalRef.current = setInterval(async () => {
          try {
            const freshPosts = await apiService.getRecentPosts(50);
            const prevAnalyzing = postsCache.getAnalyzingPosts();
            let anyCompleted = false;
            for (const sc of prevAnalyzing) {
              const done = freshPosts.find(p => p.shortcode === sc && !p.processing);
              if (done) {
                await postsCache.markAnalysisComplete(sc);
                anyCompleted = true;
                console.log('HomeScreen [watcher] - Analysis complete:', sc);
              }
            }
            if (anyCompleted) syncAnalyzingIds();

            const stillAnalyzing = postsCache.getAnalyzingPosts();

            if (freshPosts.length > 0) {
              // Only merge+save when the server actually returned data — never wipe
              // the cache with an empty response caused by a network hiccup.
              const cached = await postsCache.getCachedPosts() || [];
              const placeholders = cached.filter(
                p => stillAnalyzing.includes(p.shortcode) && !freshPosts.find(fp => fp.shortcode === p.shortcode)
              );
              const merged = [
                ...placeholders,
                ...freshPosts.filter(p => !stillAnalyzing.includes(p.shortcode)),
              ];
              setPosts(merged);
              await postsCache.savePosts(merged);
            }
            // If freshPosts is empty (offline/server busy), leave posts+cache untouched.

            if (stillAnalyzing.length === 0) {
              console.log('HomeScreen [watcher] - All done, stopping');
              clearInterval(pollIntervalRef.current!);
              pollIntervalRef.current = null;
            }
          } catch { /* network hiccup — keep polling */ }
        }, 3000);

      } else if (!hasAnalyzing && pollIntervalRef.current) {
        console.log('HomeScreen - Stopping watcher, all posts analyzed');
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    } catch (error: any) {
      console.error('Error loading posts:', error);
      
      // Only show error if we don't have cached posts
      const cachedPosts = await postsCache.getCachedPosts();
      if (!cachedPosts || cachedPosts.length === 0) {
        showToast('Failed to load posts: ' + (error.message || 'Unknown error'), 'error');
      } else {
        console.log('HomeScreen - Using cached posts after server error');
        setPosts(cachedPosts);
      }
    } finally {
      setLoading(false);
    }
  };
  // Always keep ref pointing to latest loadPosts so setInterval never uses a stale closure
  loadPostsRef.current = loadPosts;

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPosts(true); // Force refresh from server
    setRefreshing(false);
  };

  const showToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => {
    setToast({ visible: true, message, type });
  };

  const filteredPosts = posts.filter(post => {
    const matchesSearch = searchQuery === '' ||
      (post.title && post.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (post.summary && post.summary.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (post.tags && post.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())));
    
    const matchesCategory = selectedCategory === 'all' || post.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

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

  const getPostImageUrl = (post: Post) => {
    // Use backend-provided thumbnail (YouTube, webpage) or fall back to Instagram CDN
    if (post.thumbnail_url) return post.thumbnail_url;
    if (post.thumbnail) return post.thumbnail;
    return `https://www.instagram.com/p/${post.shortcode}/media/?size=l`;
  };

  const getContentTypeIcon = (post: Post) => {
    switch (post.content_type) {
      case 'youtube':  return '▶️';
      case 'webpage':  return '🌐';
      default:         return '📸'; // instagram
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
      setSelectionMode(false);
    } else {
      setSelectedPosts(new Set(filteredPosts.map(p => p.shortcode)));
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

  const handleAddToCollection = async (collectionId: string) => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      for (const shortcode of Array.from(selectedPosts)) {
        await collectionsService.addPostToCollection(collectionId, shortcode);
      }
      setShowCollectionsModal(false);
      setSelectionMode(false);
      setSelectedPosts(new Set());
      setToast({ visible: true, message: `Added ${selectedPosts.size} post(s) to collection`, type: 'success' });
    } catch (error) {
      console.error('Error adding to collection:', error);
      setToast({ visible: true, message: 'Failed to add to collection', type: 'error' });
    }
  };

  const handleDeletePosts = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const deleteCount = selectedPosts.size;
      for (const shortcode of Array.from(selectedPosts)) {
        await apiService.deletePost(shortcode);
        await postsCache.removePostFromCache(shortcode);
      }
      setPosts(posts.filter(p => !selectedPosts.has(p.shortcode)));
      setSelectionMode(false);
      setSelectedPosts(new Set());
      setShowDeleteModal(false);
      setToast({ visible: true, message: `Deleted ${deleteCount} post(s)`, type: 'success' });
    } catch (error) {
      console.error('Error deleting posts:', error);
      setShowDeleteModal(false);
      setToast({ visible: true, message: 'Failed to delete posts', type: 'error' });
    }
  };

  const handleShowCollections = () => {
    loadCollections();
    setShowCollectionsModal(true);
  };

  const renderPost = (post: Post, index: number) => {
    const categoryColor = getCategoryColor(post.category);
    const isSelected = selectedPosts.has(post.shortcode);

    // YouTube and webpage always get a landscape (full-width 16:9) card
    if (post.content_type === 'youtube' || post.content_type === 'webpage') {
      const isAnalyzing = analyzingIds.has(post.shortcode);
      return (
        <TouchableOpacity
          key={post.shortcode}
          style={[styles.landscapeCard, isSelected && styles.cardSelected]}
          onPress={() => {
            if (selectionMode) {
              togglePostSelection(post.shortcode);
              return;
            }
            if (isAnalyzing || post.processing) {
              setToast({ visible: true, message: '✨ Post is being analyzed...', type: 'warning' });
              return;
            }
            navigation.navigate('PostDetail', { post });
          }}
          onLongPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setSelectionMode(true);
            togglePostSelection(post.shortcode);
          }}
          activeOpacity={0.9}
        >
          <Image
            source={{ uri: getPostImageUrl(post) }}
            style={styles.landscapeCardImage}
            resizeMode="cover"
          />
          {/* no play overlay */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.88)']}
            style={styles.landscapeCardGradient}
          >
            <View style={styles.landscapeCardRow}>
              {post.category ? (
                <View style={[styles.categoryBadge, { backgroundColor: categoryColor }]}>
                  <Text style={styles.categoryBadgeText}>{post.category.toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.landscapeCardTitle} numberOfLines={2}>
              {post.title || 'Untitled'}
            </Text>
            <View style={styles.cardFooter}>
              <Text style={styles.username}>{getContentTypeIcon(post)} {post.username || 'unknown'}</Text>
              {post.likes && post.likes > 0 ? (
                <Text style={styles.likes}>{post.likes} likes</Text>
              ) : null}
            </View>
          </LinearGradient>
          {isAnalyzing ? (
            <View style={styles.analyzingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.analyzingText}>✨ Analyzing...</Text>
            </View>
          ) : post.processing ? (
            <View style={styles.analyzingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.analyzingText}>✨ Analyzing...</Text>
            </View>
          ) : null}
          {selectionMode ? (
            <View style={styles.selectionOverlay}>
              <View style={[styles.selectionCheckbox, isSelected && styles.selectionCheckboxActive]}>
                {isSelected ? <Text style={styles.selectionCheck}>✓</Text> : null}
              </View>
            </View>
          ) : null}
        </TouchableOpacity>
      );
    }

    const isAnalyzing = analyzingIds.has(post.shortcode);
    
    return (
      <TouchableOpacity
        key={post.shortcode}
        style={[styles.compactCard, isSelected && styles.cardSelected]}
        onPress={() => {
          if (selectionMode) {
            togglePostSelection(post.shortcode);
            return;
          }
          if (isAnalyzing || post.processing) {
            setToast({ visible: true, message: '✨ Post is being analyzed...', type: 'warning' });
            return;
          }
          navigation.navigate('PostDetail', { post });
        }}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setSelectionMode(true);
          togglePostSelection(post.shortcode);
        }}
        activeOpacity={0.9}
      >
        <Image
          source={{ uri: getPostImageUrl(post) }}
          style={styles.compactCardImage}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={styles.compactCardGradient}
        >
          {post.category ? (
            <View style={[styles.categoryBadgeSmall, { backgroundColor: categoryColor }]}>
              <Text style={styles.categoryBadgeTextSmall}>{getCategoryIcon(post.category)}</Text>
            </View>
          ) : null}
          <Text style={styles.compactCardTitle} numberOfLines={2}>
            {post.title || 'Untitled'}
          </Text>
          <Text style={styles.compactUsername} numberOfLines={1}>{getContentTypeIcon(post)} {post.username || 'unknown'}</Text>
        </LinearGradient>
        {isAnalyzing ? (
          <View style={styles.analyzingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.analyzingText}>✨ Analyzing...</Text>
          </View>
        ) : post.processing ? (
          <View style={styles.analyzingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.analyzingText}>✨ Analyzing...</Text>
          </View>
        ) : null}
        {selectionMode ? (
          <View style={styles.selectionOverlay}>
            <View style={[styles.selectionCheckbox, isSelected && styles.selectionCheckboxActive]}>
              {isSelected ? <Text style={styles.selectionCheck}>✓</Text> : null}
            </View>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  // Build grid: YT/web = full-width landscape, instagram = paired compact rows
  const buildGridRows = (posts: Post[]) => {
    const elements: React.ReactElement[] = [];
    let i = 0;
    while (i < posts.length) {
      const post = posts[i];
      if (post.content_type === 'youtube' || post.content_type === 'webpage') {
        elements.push(renderPost(post, i));
        i++;
      } else {
        const next = i + 1 < posts.length ? posts[i + 1] : null;
        if (next && next.content_type !== 'youtube' && next.content_type !== 'webpage') {
          elements.push(
            <View key={`row-${i}`} style={styles.compactRow}>
              {renderPost(post, i)}
              {renderPost(next, i + 1)}
            </View>
          );
          i += 2;
        } else {
          // Lone card — fills full row width via flex: 1
          elements.push(
            <View key={`row-${i}`} style={styles.compactRow}>
              {renderPost(post, i)}
            </View>
          );
          i++;
        }
      }
    }
    return elements;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SuperBrain</Text>
          <Text style={styles.headerSubtitle}>{filteredPosts.length} saved posts</Text>
        </View>
        {selectionMode ? (
          <TouchableOpacity 
            style={styles.cancelButton} 
            onPress={() => {
              setSelectionMode(false);
              setSelectedPosts(new Set());
            }}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchIconContainer}>
          <Text style={styles.searchIconText}>🔍</Text>
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder="Search posts, tags, topics..."
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoriesContainer}
        contentContainerStyle={styles.categoriesContent}
      >
        {CATEGORIES.map(category => (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.categoryChip,
              selectedCategory === category.id && styles.categoryChipActive,
            ]}
            onPress={() => {
              setSelectedCategory(category.id);
            }}
          >
            <Text style={styles.categoryIcon}>{category.icon}</Text>
            <Text
              style={[
                styles.categoryText,
                selectedCategory === category.id && styles.categoryTextActive,
              ]}
            >
              {category.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Selection Actions */}
      {selectionMode ? (
        <View style={styles.actionsBar}>
          <View style={styles.actionsRow}>
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={handleSelectAll}
            >
              <Text style={styles.actionButtonText}>
                {selectedPosts.size === filteredPosts.length ? 'Deselect' : 'Select All'}
              </Text>
            </TouchableOpacity>
            {selectedPosts.size > 0 ? (
              <>
                <TouchableOpacity 
                  style={styles.actionButtonPrimary} 
                  onPress={handleShowCollections}
                >
                  <Text style={styles.actionButtonPrimaryText}>Add to Library</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.actionButtonDelete} 
                  onPress={handleDeletePosts}
                >
                  <Text style={styles.actionButtonDeleteText}>Delete</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
          {selectedPosts.size > 0 ? (
            <Text style={styles.selectedCountText}>{selectedPosts.size} selected</Text>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading posts...</Text>
        </View>
      ) : !isConfigured ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>⚙️</Text>
          <Text style={styles.emptyTitle}>Setup Required</Text>
          <Text style={styles.emptyText}>Configure your server URL and API token to get started.</Text>
          <TouchableOpacity
            style={styles.setupButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.setupButtonText}>Go to Settings →</Text>
          </TouchableOpacity>
        </View>
      ) : filteredPosts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No Posts Found</Text>
          <Text style={styles.emptyText}>
            {searchQuery ? 'Try a different search term' : 'Start analyzing share content to build your library'}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.postsContainer}
          contentContainerStyle={styles.postsContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          <View style={styles.postsGrid}>
            {buildGridRows(filteredPosts)}
          </View>
        </ScrollView>
      )}

      <View style={styles.bottomNav}>
        <TouchableOpacity 
          style={styles.navItemActive} 
          onPress={() => navigation.navigate('Home')}
        >
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconTextActive}>🏠</Text>
          </View>
          <Text style={styles.navLabelActive}>Home</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.navItem} 
          onPress={() => navigation.navigate('Library')}
        >
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconText}>📚</Text>
          </View>
          <Text style={styles.navLabel}>Library</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.navItem} 
          onPress={() => navigation.navigate('Settings')}
        >
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconText}>⚙️</Text>
          </View>
          <Text style={styles.navLabel}>Settings</Text>
        </TouchableOpacity>
      </View>

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
              <View style={styles.modalLoadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.modalLoadingText}>Loading collections...</Text>
              </View>
            ) : collections.length === 0 ? (
              <View style={styles.emptyCollections}>
                <Text style={styles.emptyIcon}>📂</Text>
                <Text style={styles.emptyCollectionsTitle}>No Collections</Text>
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

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <View style={styles.deleteIconContainer}>
              <Text style={styles.deleteIcon}>🗑️</Text>
            </View>
            <Text style={styles.deleteTitle}>Delete Posts?</Text>
            <Text style={styles.deleteMessage}>
              Are you sure you want to delete {selectedPosts.size} {selectedPosts.size === 1 ? 'post' : 'posts'}? This action cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowDeleteModal(false)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonDelete}
                onPress={confirmDelete}
              >
                <Text style={styles.modalButtonDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <CustomToast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast({ ...toast, visible: false })}
      />

      {/* ── Onboarding Tutorial Modal ─────────────────────────── */}
      <Modal
        visible={showOnboarding}
        transparent
        animationType="fade"
        onRequestClose={dismissOnboarding}
      >
        <View style={styles.onboardingOverlay}>
          <View style={styles.onboardingCard}>
            {/* Header gradient strip */}
            <View style={styles.onboardingHeader}>
              <Text style={styles.onboardingHeaderLabel}>SUPERBRAIN</Text>
            </View>

            {/* Step content */}
            <View style={styles.onboardingBody}>
              <Text style={styles.onboardingIcon}>{ONBOARDING_STEPS[onboardingStep].icon}</Text>
              <Text style={styles.onboardingTitle}>{ONBOARDING_STEPS[onboardingStep].title}</Text>
              <Text style={styles.onboardingDesc}>{ONBOARDING_STEPS[onboardingStep].description}</Text>
            </View>

            {/* Step dots */}
            <View style={styles.onboardingDots}>
              {ONBOARDING_STEPS.map((_, i) => (
                <View
                  key={i}
                  style={[styles.onboardingDot, i === onboardingStep && styles.onboardingDotActive]}
                />
              ))}
            </View>

            {/* Buttons */}
            <View style={styles.onboardingActions}>
              {onboardingStep > 0 && (
                <TouchableOpacity
                  style={styles.onboardingBtnSecondary}
                  onPress={() => setOnboardingStep(s => s - 1)}
                >
                  <Text style={styles.onboardingBtnSecondaryText}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.onboardingBtnPrimary}
                onPress={() => {
                  if (onboardingStep < ONBOARDING_STEPS.length - 1) {
                    setOnboardingStep(s => s + 1);
                  } else {
                    dismissOnboarding();
                  }
                }}
              >
                <Text style={styles.onboardingBtnPrimaryText}>
                  {onboardingStep < ONBOARDING_STEPS.length - 1 ? 'Next →' : 'Get Started 🚀'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Skip — always rendered so card height stays constant */}
            <TouchableOpacity
              onPress={dismissOnboarding}
              style={[styles.onboardingSkip, onboardingStep === ONBOARDING_STEPS.length - 1 && { opacity: 0 }]}
              disabled={onboardingStep === ONBOARDING_STEPS.length - 1}
            >
              <Text style={styles.onboardingSkipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    marginHorizontal: 20,
    marginBottom: 16,
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
  categoriesContainer: {
    maxHeight: 50,
    marginBottom: 8,
  },
  categoriesContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 10,
    backgroundColor: colors.backgroundCard,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryIcon: {
    fontSize: 22,
    marginRight: 8,
    lineHeight: 28,
    includeFontPadding: false,
  },
  categoryText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  categoryTextActive: {
    color: '#fff',
    fontWeight: '600',
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
  setupButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: colors.primary,
  },
  setupButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  postsContainer: {
    flex: 1,
  },
  postsContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  postsGrid: {},
  compactRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  largeCard: {
    width: '100%',
    height: 280,
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.backgroundCard,
  },
  largeCardImage: {
    width: '100%',
    height: '100%',
  },
  largeCardGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    justifyContent: 'flex-end',
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 12,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  largeCardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  username: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  likes: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  landscapeCard: {
    width: '100%',
    height: Math.round((width - 40) * 9 / 16),
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.backgroundCard,
  },
  landscapeCardImage: {
    width: '100%',
    height: '100%',
  },
  landscapeCardGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
    paddingTop: 32,
    justifyContent: 'flex-end',
  },
  landscapeCardRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  landscapeCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  playIcon: {
    fontSize: 20,
    color: '#fff',
    marginLeft: 4,
  },
  compactCard: {
    flex: 1,
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.backgroundCard,
  },
  compactCardImage: {
    width: '100%',
    height: '100%',
  },
  compactCardGradient: {
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
  compactCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  compactUsername: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: colors.backgroundCard,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 24,
    paddingTop: 16,
    height: 80,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navItemActive: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconContainer: {
    marginBottom: 6,
  },
  navIconText: {
    fontSize: 26,
    color: colors.textMuted,
  },
  navIconTextActive: {
    fontSize: 26,
    color: colors.primary,
  },
  navLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  navLabelActive: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.backgroundCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  actionsBar: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  actionButtonPrimary: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonPrimaryText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  actionButtonDelete: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#dc3545',
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonDeleteText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  selectedCountText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
  cardSelected: {
    opacity: 0.8,
  },
  selectionOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionCheckboxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  selectionCheck: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '700',
  },
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  analyzingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  analyzingText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    marginTop: 12,
  },
  processingText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    marginTop: 12,
  },
  processingTextSmall: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '70%',
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
  modalLoadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textMuted,
  },
  emptyCollections: {
    padding: 40,
    alignItems: 'center',
  },
  emptyCollectionsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
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
    maxHeight: 350,
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
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButtonCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalButtonDelete: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#dc3545',
    alignItems: 'center',
  },
  modalButtonDeleteText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  // ── Onboarding ──────────────────────────────────────────────
  onboardingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  onboardingCard: {
    width: '100%',
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  onboardingHeader: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    alignItems: 'center',
  },
  onboardingHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 3,
  },
  onboardingBody: {
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 8,
    alignItems: 'center',
    minHeight: 220,
    justifyContent: 'center',
  },
  onboardingIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  onboardingTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 14,
  },
  onboardingDesc: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 23,
  },
  onboardingDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    marginBottom: 4,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  onboardingDotActive: {
    width: 24,
    backgroundColor: colors.primary,
  },
  onboardingActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 8,
  },
  onboardingBtnPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  onboardingBtnPrimaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  onboardingBtnSecondary: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  onboardingBtnSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  onboardingSkip: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingBottom: 20,
  },
  onboardingSkipText: {
    fontSize: 13,
    color: colors.textMuted,
  },
});

export default HomeScreen;
