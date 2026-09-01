import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  ViewToken,
} from 'react-native';
import type { RootStackParamList } from '../../App';
import ReelItem from '../components/ReelItem';
import localDb from '../services/localDb';
import { colors } from '../theme/colors';
import { Post } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ReelsFeed'>;

function isPlayableReel(post: Post): boolean {
  const localUri = post.local_uri || post.local_media_uri;
  return (
    post.content_type !== 'webpage' &&
    Boolean(post.local_filename || localUri)
  );
}

const ReelsFeed = ({ route, navigation }: Props) => {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const flatListRef = useRef<FlatList<Post>>(null);
  const [posts, setPosts] = useState<Post[]>(() => route.params?.posts?.filter(isPlayableReel) || []);
  const [loading, setLoading] = useState(!route.params?.posts?.length);
  const [activeShortcode, setActiveShortcode] = useState<string | null>(route.params?.initialShortcode || null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadReels = async () => {
      if (route.params?.posts?.length) {
        setPosts(route.params.posts.filter(isPlayableReel));
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const cachedPosts = await localDb.getPostsWithServerMedia();
        if (!cancelled) {
          setPosts(cachedPosts.filter(isPlayableReel));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadReels();

    return () => {
      cancelled = true;
    };
  }, [route.params?.posts]);

  const initialIndex = useMemo(() => {
    const targetShortcode = route.params?.initialShortcode;
    if (!targetShortcode) {
      return 0;
    }
    const index = posts.findIndex(post => post.shortcode === targetShortcode);
    return index >= 0 ? index : 0;
  }, [posts, route.params?.initialShortcode]);

  useEffect(() => {
    if (posts.length === 0) {
      setActiveShortcode(null);
      return;
    }

    if (!activeShortcode || !posts.some(post => post.shortcode === activeShortcode)) {
      setActiveShortcode(posts[initialIndex]?.shortcode || posts[0].shortcode);
    }
  }, [activeShortcode, initialIndex, posts]);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 80,
  }).current;

  const onViewableItemsChanged = useRef(({
    viewableItems,
  }: {
    viewableItems: ViewToken<Post>[];
  }) => {
    const centeredItem = viewableItems.find(viewToken => viewToken.isViewable && viewToken.item);
    if (centeredItem?.item?.shortcode) {
      setActiveShortcode(centeredItem.item.shortcode);
    }
  }).current;

  const handleMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.y / height);
    const nextPost = posts[nextIndex];
    if (nextPost) {
      setActiveShortcode(nextPost.shortcode);
    }
  }, [height, posts]);

  const renderItem = useCallback(({ item }: { item: Post }) => (
    <ReelItem
      item={item}
      height={height}
      topInset={insets.top}
      bottomInset={insets.bottom}
      isActive={isFocused && appState === 'active' && activeShortcode === item.shortcode}
    />
  ), [activeShortcode, appState, height, insets.bottom, insets.top, isFocused]);

  const getItemLayout = useCallback((_: ArrayLike<Post> | null | undefined, index: number) => ({
    length: height,
    offset: height * index,
    index,
  }), [height]);

  const handleScrollToIndexFailed = useCallback(({ index }: { index: number }) => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToOffset({
        offset: Math.max(0, index * height),
        animated: false,
      });
    });
  }, [height]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <StatusBar hidden />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <View style={styles.centered}>
        <StatusBar hidden />
        <TouchableOpacity
          accessibilityLabel="Close reels feed"
          style={[styles.backButton, { top: insets.top + 12 }]}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Ionicons name="film-outline" size={44} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>No reels ready</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <FlatList
        ref={flatListRef}
        data={posts}
        renderItem={renderItem}
        keyExtractor={item => item.shortcode}
        getItemLayout={getItemLayout}
        initialScrollIndex={initialIndex}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        pagingEnabled
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        removeClippedSubviews
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={80}
        windowSize={3}
        extraData={`${activeShortcode}:${isFocused}:${appState}:${height}`}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onMomentumScrollEnd={handleMomentumEnd}
      />

      <TouchableOpacity
        accessibilityLabel="Close reels feed"
        style={[styles.backButton, { top: insets.top + 12 }]}
        onPress={() => navigation.goBack()}
        activeOpacity={0.82}
      >
        <Ionicons name="chevron-back" size={28} color="#fff" />
      </TouchableOpacity>

      <View style={[styles.positionBadge, { top: insets.top + 14 }]}>
        <Text style={styles.positionText}>
          {Math.max(1, posts.findIndex(post => post.shortcode === activeShortcode) + 1)} / {posts.length}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  backButton: {
    position: 'absolute',
    left: 14,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  positionBadge: {
    position: 'absolute',
    alignSelf: 'center',
    minWidth: 58,
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  positionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0,
  },
});

export default ReelsFeed;
