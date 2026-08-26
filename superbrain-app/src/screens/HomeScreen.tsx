import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  Dimensions,
  Modal,
  BackHandler,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import apiService from '../services/api';
import postsCache from '../services/postsCache';
import localDb from '../services/localDb';
import syncService from '../services/syncService';
import { collectionsService } from '../services/collections';
import { searchPostsOffline } from '../services/offlineSearch';
import {
  scheduleAllWatchLaterNotifications,
  requestNotificationPermissionAfterOnboarding,
  sendImmediateWatchLaterNotification,
  sendImmediateSavedNotification,
} from '../services/notificationService';
import { Post, Collection } from '../types';
import { colors } from '../theme/colors';
import { RootStackParamList } from '../../App';
import CustomToast from '../components/CustomToast';
import BottomNav from '../components/BottomNav';
import useMediaSync from '../hooks/useMediaSync';
import { getCollectionIconName, getCollectionIconColor } from '../constants/icons';
import { ALL_CATEGORY, DEFAULT_CATEGORIES, CATEGORY_ICONS } from '../constants/categories';
import {
  TaxonomyPayload,
  isTaxonomyApiActive,
  usesStrictCustomTaxonomy,
} from '../services/taxonomySupport';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

const HomeScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
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
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadPostsRef = useRef<(forceRefresh?: boolean) => Promise<void>>(undefined);
  const prevProcessingRef = useRef<number>(0); // tracks backend processing_count across poll ticks
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [shouldShowOnboardingOnInit, setShouldShowOnboardingOnInit] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const lastFocusRefreshRef = useRef(0);

  const handlePostMediaCached = useCallback((shortcode: string, localUri: string) => {
    setPosts(currentPosts => currentPosts.map(post => (
      post.shortcode === shortcode
        ? {
          ...post,
          local_uri: localUri,
          local_media_uri: localUri,
          media_downloaded_at: new Date().toISOString(),
        }
        : post
    )));
  }, []);

  useMediaSync(posts, {
    enabled: isConfigured,
    autoStart: true,
    concurrency: 2,
    onPostMediaCached: handlePostMediaCached,
  });

  useEffect(() => {
    const bootstrap = async () => {
      const shouldDeferNotificationPrompt = await checkFirstLaunch();
      await initializeAndLoad(shouldDeferNotificationPrompt);
    };

    bootstrap();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isInitialized && shouldShowOnboardingOnInit) {
      const t = setTimeout(() => setShowOnboarding(true), 30);
      return () => clearTimeout(t);
    }
  }, [isInitialized, shouldShowOnboardingOnInit]);

  // Exit app when back is pressed on HomeScreen (it is the root screen)
  useFocusEffect(
    React.useCallback(() => {
      const onBackPress = () => {
        BackHandler.exitApp();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }, [])
  );

  // Refresh when screen comes into focus (but skip first time)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (isInitialized) {
        const now = Date.now();
        if (now - lastFocusRefreshRef.current < 5000) {
          return;
        }
        lastFocusRefreshRef.current = now;
        loadPosts(false); // Don't force refresh, let cache-first strategy work
      }
    });
    return unsubscribe;
  }, [navigation, isInitialized]);

  const checkFirstLaunch = async (): Promise<boolean> => {
    try {
      const seen = await AsyncStorage.getItem('@superbrain_onboarded');
      if (seen) return false;
      // Existing install upgrading — user already has data, skip tutorial
      const existingPosts = await AsyncStorage.getItem('@superbrain_posts_cache');
      const existingCollections = await AsyncStorage.getItem('@superbrain_collections');

      const hasExistingPosts = (() => {
        if (!existingPosts) return false;
        try {
          const parsed = JSON.parse(existingPosts);
          return Array.isArray(parsed) && parsed.length > 0;
        } catch {
          return true;
        }
      })();

      const hasMeaningfulCollections = (() => {
        if (!existingCollections) return false;
        try {
          const parsed = JSON.parse(existingCollections);
          if (!Array.isArray(parsed)) return false;
          return parsed.some((c: any) => {
            const hasPosts = Array.isArray(c?.postIds) && c.postIds.length > 0;
            const isDefaultWatchLater = c?.id === 'default_watch_later';
            return hasPosts || !isDefaultWatchLater;
          });
        } catch {
          return true;
        }
      })();

      if (hasExistingPosts || hasMeaningfulCollections) {
        await AsyncStorage.setItem('@superbrain_onboarded', '1');
        return false;
      }

      // Mark to show onboarding once app initialization completes.
      setShouldShowOnboardingOnInit(true);
      return true;
    } catch { /* ignore */ }
    return false;
  };

  const dismissOnboarding = async () => {
    try { await AsyncStorage.setItem('@superbrain_onboarded', '1'); } catch { /* ignore */ }
    setShowOnboarding(false);
    setShouldShowOnboardingOnInit(false);
    setOnboardingStep(0);

    // Prompt for notifications only after onboarding walkthrough is finished.
    requestNotificationPermissionAfterOnboarding().catch(() => {});
    scheduleAllWatchLaterNotifications().catch(() => {});
  };

  const ONBOARDING_STEPS = [
    {
      iconName: 'sparkles-outline',
      title: 'Welcome to SuperBrain',
      description: 'Save from Instagram, YouTube, and web in one place. Find everything fast with AI search and smart tagging.',
    },
    {
      iconName: 'share-outline',
      title: 'Save from Anywhere',
      description: 'Open any social post or website → tap Share → select SuperBrain. Your content is saved and analyzed instantly.',
    },
    {
      iconName: 'layers-outline',
      title: 'Explore Your Feed',
      description: 'Scroll through your saves, filter by category, or search. Tap a post to see details. Long-press to delete multiple.',
    },
    {
      iconName: 'settings-outline',
      title: 'Connect Your Backend',
      description: 'Head to Settings to add your Server URL and Token. You can also configure AI providers and Instagram credentials.',
    },
  ];

  const loadCategories = async (
    prefetchedTaxonomy?: TaxonomyPayload | null | Promise<TaxonomyPayload | null>,
  ) => {
    try {
      // Reuse a pre-fetched taxonomy when available to avoid redundant HTTP calls.
      // On init (no prefetch), fetch taxonomy alongside categories.
      const [cats, taxonomy] = await Promise.all([
        apiService.getCategories(),
        prefetchedTaxonomy !== undefined
          ? Promise.resolve(prefetchedTaxonomy)
          : apiService.getTaxonomy().catch(() => null),
      ]);

      // No GET /taxonomy (upstream today) → keep full built-in pill set + counts.
      // Taxonomy present + use_default_categories=false → configured chips only.
      // Taxonomy present + defaults on → seed from server taxonomy list.
      const taxonomyActive = isTaxonomyApiActive(taxonomy);
      const strictCustom = usesStrictCustomTaxonomy(taxonomy);

      let seed: Array<{ id: string; name: string; icon: string; count: number }>;
      if (taxonomyActive) {
        seed = taxonomy!.categories.map(c => ({
          id: c.id,
          name: c.name,
          icon: CATEGORY_ICONS[c.id] || CATEGORY_ICONS[c.name.trim().toLowerCase()] || 'pricetag-outline',
          count: 0,
        }));
      } else {
        seed = DEFAULT_CATEGORIES.filter(c => c.id !== 'all').map(c => ({ ...c, count: 0 }));
      }

      const mergedById = new Map(seed.map(c => [c.id.toLowerCase(), { ...c }]));
      const configuredIds = new Set(mergedById.keys());

      for (const c of cats || []) {
        const id = c.id.toLowerCase();
        if (strictCustom && !configuredIds.has(id)) {
          continue;
        }
        const existing = mergedById.get(id);
        mergedById.set(id, {
          id,
          name: existing?.name || c.name,
          icon: existing?.icon || CATEGORY_ICONS[c.name.trim().toLowerCase()] || 'pricetag-outline',
          count: c.count,
        });
      }

      const merged = Array.from(mergedById.values());
      // Upstream totals from visible chips; strict taxonomy still counts all posts in All.
      const totalCount = strictCustom
        ? (cats || []).reduce((sum, c) => sum + (c.count || 0), 0)
        : merged.reduce((sum, c) => sum + c.count, 0);
      setCategories([{ ...ALL_CATEGORY, count: totalCount }, ...merged]);
    } catch (e) {
      console.warn('Failed to load categories, using defaults:', e);
    }
  };

  const initializeAndLoad = async (deferNotificationPrompt: boolean = false) => {
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
      // Fire categories, collections sync, and posts loading in parallel
      // for faster first paint. Fetch /taxonomy exactly once here (not
      // awaited yet — same in-flight promise shared with both loadCategories
      // and loadPosts, each awaiting it only at the point they actually need
      // it) instead of each independently re-fetching, which both wasted a
      // redundant HTTP call and could race under flaky network (one fetch
      // succeeding while the other timed out, leaving rendered chips
      // inconsistent with what sync just persisted).
      const taxonomyPromise = apiService.getTaxonomy().catch(() => null);
      const [, ,] = await Promise.all([
        loadCategories(taxonomyPromise),
        collectionsService.syncFromBackend().catch(() => { /* offline */ }),
        loadPosts(false, taxonomyPromise),
      ]);
      // Reschedule Watch Later notifications with (possibly restored) collection data
      if (!deferNotificationPrompt) {
        scheduleAllWatchLaterNotifications().catch(() => { });
      }
      setIsInitialized(true);
    } catch (error) {
      console.error('Error initializing:', error);
      showToast('Failed to connect to server. Check your API settings.', 'error');
      setIsInitialized(true);
    }
  };

  const loadPosts = async (
    forceRefresh: boolean = false,
    prefetchedTaxonomy?: TaxonomyPayload | null | Promise<TaxonomyPayload | null>,
  ) => {
    // Resolved lazily (below) at whichever point in this function first
    // actually needs it, not eagerly here — keeps the fast local-data paint
    // path (right below) unblocked by any network call, including a
    // caller-supplied prefetch promise. `taxonomyCache` is a local (not a
    // ref) so it's scoped to this single loadPosts call — overlapping calls
    // (focus listener vs. poll-interval refresh) each get their own cache
    // instead of racing to reset/read a shared one.
    let taxonomyCache: TaxonomyPayload | null | undefined = undefined;
    // Resolves the taxonomy exactly once per loadPosts call, reusing
    // taxonomyCache if a previous call site within this same cycle already
    // resolved it, otherwise awaiting prefetchedTaxonomy (a caller's
    // in-flight fetch, e.g. bootstrap sharing one /taxonomy call with
    // loadCategories instead of each independently re-fetching), otherwise
    // fetching fresh.
    const resolveTaxonomy = async (): Promise<TaxonomyPayload | null> => {
      if (taxonomyCache !== undefined) return taxonomyCache;
      const resolved = prefetchedTaxonomy !== undefined
        ? await prefetchedTaxonomy
        : await apiService.getTaxonomy().catch(() => null);
      taxonomyCache = resolved;
      return resolved;
    };
    try {
      // Reconcile: if a post was in the failed list AND still stuck in analyzing, clean it up.
      const failedList = await postsCache.getFailedPosts();
      if (failedList.length > 0) {
        for (const fp of failedList) {
          if (postsCache.isAnalyzing(fp.shortcode)) {
            postsCache.markAnalysisComplete(fp.shortcode);
          }
          await postsCache.removePostFromCache(fp.shortcode);
        }
      }

      // Guard: never show any data if token is not configured
      const token = await apiService.getApiToken();
      if (!token) {
        setIsConfigured(false);
        setLoading(false);
        return;
      }

      // ── Step 1: Instantly load from local SQLite DB (0ms, no network) ──
      const localPosts = await localDb.getAllPosts();
      if (localPosts.length > 0) {
        // Merge with any analyzing placeholders currently in flight
        const analyzingShortcodes = postsCache.getAnalyzingPosts();
        const analyzingPlaceholders = posts.filter(
          p => analyzingShortcodes.includes(p.shortcode)
            && !localPosts.find(lp => lp.shortcode === p.shortcode)
        );
        const merged = [...analyzingPlaceholders, ...localPosts];
        setPosts(merged);
        setLoading(false);

        // Upstream path: return early when local data is enough.
        // Taxonomy-aware servers: always continue so migrations reach the device.
        // Defer the taxonomy check until after we confirm connectivity (below)
        // to avoid a 404 round-trip on upstream servers that lack GET /taxonomy.
        if (!forceRefresh && analyzingShortcodes.length === 0) {
          const isOnlineForGate = await apiService.testConnection().catch(() => false);
          if (!isOnlineForGate) {
            return;
          }
          const taxonomy = await resolveTaxonomy();
          if (!isTaxonomyApiActive(taxonomy)) {
            return;
          }
          // taxonomy is active — fall through to background sync below.
        }
      } else {
        // No local data at all — show loading spinner
        setLoading(true);
      }

      // ── Step 2: Background sync with backend ──
      // UI may already be showing local data; refresh if sync changes anything.
      const isOnline = await apiService.testConnection().catch(() => false);

      if (isOnline) {
        // Flush any offline mutations first
        await postsCache.flushPendingPostMutations();
        await postsCache.flushPendingAnalyses();

        // forceFull / taxonomy_version resync only activate when GET /taxonomy exists
        // (see syncService); without it this matches upstream delta-only sync.
        const taxonomy = await resolveTaxonomy();
        const dataChanged = await syncService.syncIfNeeded(forceRefresh, taxonomy);

        // If sync brought new data, re-read from local DB and update UI
        if (dataChanged || forceRefresh) {
          // Category chip reload is taxonomy-aware; skip extra work on mainline.
          if (isTaxonomyApiActive(taxonomy)) {
            await loadCategories(taxonomy);
          }
          const freshPosts = await localDb.getAllPosts();
          if (freshPosts.length > 0) {
            // Clear analyzing state for posts that now exist in the synced data
            const prevAnalyzing = postsCache.getAnalyzingPosts();
            for (const shortcode of prevAnalyzing) {
              const placeholderUrl = posts.find(cp => cp.shortcode === shortcode)?.url;
              const serverPost = freshPosts.find(
                p => p.shortcode === shortcode || (placeholderUrl && p.url === placeholderUrl)
              );
              if (serverPost && !serverPost.processing) {
                await postsCache.markAnalysisComplete(shortcode);
                if (serverPost.shortcode !== shortcode) {
                  await postsCache.removePostFromCache(shortcode);
                }
              }
            }

            // Merge with remaining analyzing placeholders
            const stillAnalyzing = postsCache.getAnalyzingPosts();
            const analyzingPlaceholders = posts.filter(
              p => stillAnalyzing.includes(p.shortcode)
                && !freshPosts.find(fp => fp.shortcode === p.shortcode)
            );
            setPosts([...analyzingPlaceholders, ...freshPosts]);
          }
        }
      } else if (localPosts.length === 0) {
        showToast('No posts yet — share something to get started!', 'info');
      }
      // If offline and we have local data, we already showed it in Step 1

      // ── Step 3: Analyzing-posts watcher ──
      const stillAnalyzing = postsCache.getAnalyzingPosts();
      const hasAnalyzing = stillAnalyzing.length > 0;

      if (hasAnalyzing && !pollIntervalRef.current) {
        prevProcessingRef.current = 1;
        apiService.getQueueStatus().then(s => {
          const total = s ? s.processing_count + s.queue_count : 0;
          if (total === 0) {
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            loadPostsRef.current?.(true);
          } else {
            prevProcessingRef.current = total;
          }
        }).catch(() => { });

        pollIntervalRef.current = setInterval(async () => {
          try {
            const status = await apiService.getQueueStatus();
            if (!status) return;
            const total = status.processing_count + status.queue_count;
            const wasActive = prevProcessingRef.current > 0;
            const nowIdle = total === 0;
            prevProcessingRef.current = total;

            if (wasActive && nowIdle) {
              loadPostsRef.current?.(true);
            } else if (nowIdle && postsCache.getAnalyzingPosts().length === 0) {
              clearInterval(pollIntervalRef.current!);
              pollIntervalRef.current = null;
            }
          } catch { /* network hiccup — keep polling */ }
        }, 2000);
      } else if (!hasAnalyzing && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    } catch (error: any) {
      console.error('Error loading posts:', error);

      // Try to show local data even on error
      const localPosts = await localDb.getAllPosts();
      if (localPosts.length > 0) {
        setPosts(localPosts);
      } else {
        showToast('Failed to load posts: ' + (error.message || 'Unknown error'), 'error');
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

  const filteredPosts = React.useMemo(() => {
    const categoryPosts = posts.filter(post => (
      selectedCategory === 'all' ||
      (post.category || '').trim().toLowerCase() === selectedCategory.trim().toLowerCase()
    ));

    return searchPostsOffline(categoryPosts, deferredSearchQuery);
  }, [posts, deferredSearchQuery, selectedCategory]);

  const hasPlayableMedia = (post: Post) => {
    return post.content_type !== 'webpage' && Boolean(post.local_filename || post.local_uri || post.local_media_uri);
  };

  const hasOfflineMedia = (post: Post) => {
    return Boolean(post.local_uri || post.local_media_uri);
  };

  const openReelsFeed = (initialShortcode: string) => {
    const feedPosts = filteredPosts.filter(hasPlayableMedia);
    if (feedPosts.length === 0) {
      showToast('No reels ready yet', 'info');
      return;
    }
    navigation.navigate('ReelsFeed', { posts: feedPosts, initialShortcode });
  };

  const getCategoryColor = (category: string) => {
    if (!category) return colors.categories.other;
    return colors.categories[category.trim().toLowerCase() as keyof typeof colors.categories] || colors.categories.other;
  };

  const getPostImageUrl = (post: Post) => {
    // Use backend-provided thumbnail (YouTube, webpage) or fall back to Instagram CDN
    if (post.thumbnail_url) return post.thumbnail_url;
    if (post.thumbnail) {
      if (post.thumbnail.startsWith('/static/')) {
        return `${apiService.currentApiUrl}${post.thumbnail}`;
      }
      return post.thumbnail;
    }
    return `https://www.instagram.com/p/${post.shortcode}/media/?size=l`;
  };

  const renderContentTypeIcon = (post: Post) => {
    switch (post.content_type) {
      case 'youtube': return <Ionicons name="logo-youtube" size={14} color="#fff" />;
      case 'webpage': return <Ionicons name="globe-outline" size={14} color="#fff" />;
      default: return <Ionicons name="logo-instagram" size={14} color="#fff" />; // instagram
    }
  };

  const renderReelsEntryOverlay = (post: Post) => {
    if (!hasPlayableMedia(post)) {
      return null;
    }

    return (
      <>
        <View pointerEvents="box-none" style={styles.playOverlay}>
          <TouchableOpacity
            accessibilityLabel="Open reel feed"
            style={styles.playButton}
            activeOpacity={0.82}
            onPress={(event) => {
              event.stopPropagation();
              openReelsFeed(post.shortcode);
            }}
          >
            <Ionicons name="play" size={24} color="#fff" style={{ marginLeft: 3 }} />
          </TouchableOpacity>
        </View>
        {hasOfflineMedia(post) ? (
          <View style={styles.cardOfflineBadge}>
            <Ionicons name="checkmark-circle" size={15} color={colors.success} />
          </View>
        ) : null}
      </>
    );
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

      // Duplicate check using already-loaded collections state
      const targetCollection = collections.find(c => c.id === collectionId);
      const existingIds = new Set(targetCollection?.postIds ?? []);

      const toAdd = Array.from(selectedPosts).filter(sc => !existingIds.has(sc));
      const alreadyIn = Array.from(selectedPosts).filter(sc => existingIds.has(sc));

      if (toAdd.length === 0) {
        setShowCollectionsModal(false);
        setToast({ visible: true, message: 'Already in this collection', type: 'warning' });
        return;
      }

      for (const shortcode of toAdd) {
        await collectionsService.addPostToCollection(collectionId, shortcode);
      }

      // Fire instant + daily notifications for Watch Later adds;
      // fire instant "Saved" notification for all other collections
      if (collectionId === 'default_watch_later') {
        for (const shortcode of toAdd) {
          const post = posts.find(p => p.shortcode === shortcode);
          if (post) sendImmediateWatchLaterNotification(post).catch(() => { });
        }
      } else {
        for (const shortcode of toAdd) {
          const post = posts.find(p => p.shortcode === shortcode);
          if (post) sendImmediateSavedNotification(post).catch(() => { });
        }
      }

      setShowCollectionsModal(false);
      setSelectionMode(false);
      setSelectedPosts(new Set());

      const msg = alreadyIn.length > 0
        ? `Added ${toAdd.length} post(s) — ${alreadyIn.length} already in collection`
        : `Added ${toAdd.length} post(s) to collection`;
      setToast({ visible: true, message: msg, type: 'success' });
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
        // Cancel analyzing state so the overlay clears immediately
        if (postsCache.isAnalyzing(shortcode)) {
          postsCache.markAnalysisComplete(shortcode);
        }
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
      const isAnalyzing = postsCache.isAnalyzing(post.shortcode);
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
          {renderReelsEntryOverlay(post)}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.88)']}
            style={styles.landscapeCardGradient}
          >
            <View style={styles.landscapeCardRow}>
              {post.category ? (
                <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(post.category), flexDirection: 'row', alignItems: 'center' }]}>
                  <Ionicons name={(CATEGORY_ICONS[post.category.trim().toLowerCase()] || CATEGORY_ICONS['other']) as any} size={14} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={styles.categoryBadgeText}>{post.category.toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.landscapeCardTitle} numberOfLines={2}>
              {post.title || 'Untitled'}
            </Text>
            <View style={styles.cardFooter}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {renderContentTypeIcon(post)}
                <Text style={[styles.username, { marginLeft: 4 }]}>{post.username || 'unknown'}</Text>
              </View>
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

    const isAnalyzing = postsCache.isAnalyzing(post.shortcode);

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
        {renderReelsEntryOverlay(post)}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={styles.compactCardGradient}
        >
          {post.category ? (
            <View style={[styles.categoryBadgeSmall, { backgroundColor: getCategoryColor(post.category) }]}>
              <Ionicons name={(CATEGORY_ICONS[post.category.trim().toLowerCase()] || CATEGORY_ICONS['other']) as any} size={14} color="#fff" />
            </View>
          ) : null}
          <Text style={styles.compactCardTitle} numberOfLines={2}>
            {post.title || 'Untitled'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            {renderContentTypeIcon(post)}
            <Text style={[styles.compactUsername, { marginLeft: 4 }]} numberOfLines={1}>{post.username || 'unknown'}</Text>
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
  };

  // Build flat data for FlatList: converts posts into row items
  // Each item is either a single landscape card or a pair of compact cards
  type GridItem =
    | { type: 'landscape'; post: Post; index: number }
    | { type: 'pair'; left: Post; right: Post | null; leftIndex: number; rightIndex: number };

  const buildGridData = useCallback((posts: Post[]): GridItem[] => {
    const items: GridItem[] = [];
    let i = 0;
    while (i < posts.length) {
      const post = posts[i];
      if (post.content_type === 'youtube' || post.content_type === 'webpage') {
        items.push({ type: 'landscape', post, index: i });
        i++;
      } else {
        const next = i + 1 < posts.length && posts[i + 1].content_type !== 'youtube' && posts[i + 1].content_type !== 'webpage'
          ? posts[i + 1] : null;
        items.push({ type: 'pair', left: post, right: next, leftIndex: i, rightIndex: i + 1 });
        i += next ? 2 : 1;
      }
    }
    return items;
  }, []);

  const gridData = React.useMemo(() => buildGridData(filteredPosts), [filteredPosts, buildGridData]);

  const renderGridItem = useCallback(({ item }: { item: GridItem }) => {
    if (item.type === 'landscape') {
      return renderPost(item.post, item.index);
    }
    return (
      <View style={styles.compactRow}>
        {renderPost(item.left, item.leftIndex)}
        {item.right ? renderPost(item.right, item.rightIndex) : <View style={{ flex: 1 }} />}
      </View>
    );
  }, [selectionMode, selectedPosts, posts]);

  const getItemKey = useCallback((item: GridItem) => {
    return item.type === 'landscape' ? item.post.shortcode : `pair-${item.left.shortcode}`;
  }, []);

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
          <Ionicons name="search" size={20} color={colors.textMuted} />
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
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoriesContainer}
        contentContainerStyle={styles.categoriesContent}
      >
        {categories.map(category => {
          const categoryColor = getCategoryColor(category.id);
          const isActive = selectedCategory === category.id;
          return (
            <TouchableOpacity
              key={category.id}
              style={[
                styles.categoryChip,
                isActive && { backgroundColor: categoryColor, borderColor: categoryColor },
              ]}
              onPress={() => {
                setSelectedCategory(category.id);
              }}
            >
              <Ionicons
                name={(category.icon || 'star') as any}
                size={18}
                color={isActive ? '#fff' : categoryColor}
              />
              <Text
                style={[
                  styles.categoryText,
                  isActive && styles.categoryTextActive,
                ]}
              >
                {category.name}
              </Text>
            </TouchableOpacity>
          );
        })}
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
          <View style={styles.setupIconContainer}>
            <Ionicons name="key-outline" size={48} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>Setup Required</Text>
          <Text style={styles.emptyText}>Configure your Access Token and Server URL to continue.</Text>
          <TouchableOpacity
            style={styles.setupButton}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.setupButtonText}>Go to Settings →</Text>
          </TouchableOpacity>
        </View>
      ) : filteredPosts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.setupIconContainer, { backgroundColor: 'rgba(107, 114, 128, 0.1)' }]}>
            <Ionicons name="documents-outline" size={48} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No Posts Found</Text>
          <Text style={styles.emptyText}>
            {searchQuery ? 'Try a different search term' : 'Start analyzing share content to build your library'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={gridData}
          renderItem={renderGridItem}
          keyExtractor={getItemKey}
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
          removeClippedSubviews={true}
          maxToRenderPerBatch={8}
          windowSize={7}
          initialNumToRender={6}
          showsVerticalScrollIndicator={false}
        />
      )}

      <BottomNav activeTab="Home" />

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
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {loadingCollections ? (
              <View style={styles.modalLoadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.modalLoadingText}>Loading collections...</Text>
              </View>
            ) : collections.length === 0 ? (
              <View style={styles.emptyCollections}>
                <Ionicons name="folder-open" size={64} color={colors.textMuted} />
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
                      <Ionicons
                        name={getCollectionIconName(collection.id, collection.icon) as any}
                        size={28}
                        color={getCollectionIconColor(collection.id, collection.icon)}
                      />
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

      {/* ── Onboarding Tutorial (absolute overlay — non-blocking) ──── */}
      {showOnboarding && (
        <View style={styles.onboardingOverlay} pointerEvents="box-none">
          <View style={styles.onboardingBackdrop} />
          <View style={styles.onboardingCard} pointerEvents="auto">
            {/* Header gradient strip */}
            <View style={styles.onboardingHeader}>
              <Text style={styles.onboardingHeaderLabel}>SUPERBRAIN</Text>
            </View>

            {/* Step content */}
            <View style={styles.onboardingBody}>
              {onboardingStep === 0 ? (
                <Text style={styles.onboardingEmoji}>🧠</Text>
              ) : (
                <Ionicons
                  name={ONBOARDING_STEPS[onboardingStep].iconName as any}
                  size={48}
                  color={colors.primary}
                  style={styles.onboardingIcon}
                />
              )}
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
                    if (!isConfigured) {
                      navigation.navigate('Settings');
                    }
                  }
                }}
              >
                <Text style={styles.onboardingBtnPrimaryText}>
                  {onboardingStep < ONBOARDING_STEPS.length - 1
                    ? 'Next'
                    : !isConfigured ? 'Go to Settings' : 'Get Started'}
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
      )}
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
    paddingTop: 56,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIconContainer: {
    marginRight: 10,
  },
  searchIconText: {
    fontSize: 18,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '400',
  },
  clearButton: {
    padding: 4,
  },
  clearIcon: {
    fontSize: 18,
    color: colors.textMuted,
  },
  categoriesContainer: {
    maxHeight: 48,
    marginBottom: 6,
  },
  categoriesContent: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
    gap: 6,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryIcon: {
    width: 20,
    height: 20,
    marginRight: 6,
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
  categoryCountBadge: {
    marginLeft: 6,
    backgroundColor: colors.primary + '30',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  categoryCountText: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: '700',
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
    fontSize: 48,
      height: 48,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 22,
    marginBottom: 24,
  },
  setupIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(99, 102, 241, 0.1)', // Primary color with 10% opacity
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: -10,
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
    marginBottom: 16,
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
    marginBottom: 14,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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
    paddingTop: 40,
    justifyContent: 'flex-end',
  },
  landscapeCardRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  landscapeCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
    letterSpacing: -0.1,
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
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
  cardOfflineBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  compactCard: {
    flex: 1,
    height: 220,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
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
    paddingTop: 40,
    justifyContent: 'flex-end',
  },
  categoryBadgeSmall: {
    alignSelf: 'flex-start',
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryBadgeTextSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  compactCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 3,
    lineHeight: 18,
  },
  compactUsername: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
  },
  navIconContainer: {
    marginBottom: 6,
  },
  navIcon: {
    width: 24,
    height: 24,
    marginBottom: 4,
  },
  navIconText: {
    fontSize: 26,
    color: colors.textMuted,
  },
  navIconTextActive: {
    fontSize: 26,
    color: colors.primary,
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
    marginBottom: 16,
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
  emptyCollectionsIconImage: {
    width: 64,
    height: 64,
    marginBottom: 16,
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
    marginBottom: 16,
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
    marginBottom: 16,
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
  // ── Onboarding (absolute overlay) ─────────────────────────────────────
  onboardingOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 24,
  },
  onboardingBackdrop: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.88)',
  },
  onboardingCard: {
    width: '100%' as const,
    backgroundColor: colors.backgroundCard,
    borderRadius: 24,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 1,
  },
  onboardingHeader: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    alignItems: 'center' as const,
  },
  onboardingHeaderLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#fff',
    letterSpacing: 3,
  },
  onboardingBody: {
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 8,
    alignItems: 'center' as const,
    minHeight: 230,
    justifyContent: 'center' as const,
  },
  onboardingIcon: {
      marginBottom: 16,
      height: 48,
    },
  onboardingEmoji: {
    fontSize: 48,
      height: 48,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    marginBottom: 16,
  },
  onboardingTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: colors.text,
    textAlign: 'center' as const,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  onboardingDesc: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 24,
  },
  onboardingDots: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
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
    width: 28,
    backgroundColor: colors.primary,
  },
  onboardingActions: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: 12,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 8,
  },
  onboardingBtnPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center' as const,
  },
  onboardingBtnPrimaryText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#fff',
  },
  onboardingBtnSecondary: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
  onboardingBtnSecondaryText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: colors.textSecondary,
  },
  onboardingSkip: {
    alignItems: 'center' as const,
    paddingVertical: 14,
    paddingBottom: 20,
  },
  onboardingSkipText: {
    fontSize: 13,
    color: colors.textMuted,
  },
});

export default HomeScreen;
