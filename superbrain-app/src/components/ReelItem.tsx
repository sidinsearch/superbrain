import React, { memo, useEffect, useMemo, useState } from 'react';
import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { VideoSource, VideoView, useVideoPlayer } from 'expo-video';
import { colors } from '../theme/colors';
import { Post } from '../types';
import apiService from '../services/api';
import offlineMediaManager from '../services/OfflineMediaManager';

type ReelItemProps = {
  item: Post;
  isActive: boolean;
  height: number;
  topInset: number;
  bottomInset: number;
};

type ResolvedVideoSource = {
  source: VideoSource;
  isLocal: boolean;
  error?: string;
};

function getStoredLocalUri(item: Post): string | undefined {
  return item.local_uri || item.local_media_uri;
}

function getThumbnailUri(item: Post): string | undefined {
  const thumbnailUri = item.thumbnail_url || item.thumbnail;
  if (thumbnailUri?.startsWith('/static/')) {
    return `${apiService.currentApiUrl}${thumbnailUri}`;
  }
  return thumbnailUri;
}

function getDisplayTitle(item: Post): string {
  return item.title?.trim() || item.summary?.trim() || 'Untitled';
}

function getDisplayCreator(item: Post): string {
  return item.username?.trim() || 'unknown';
}

const ReelItem = ({ item, isActive, height, topInset, bottomInset }: ReelItemProps) => {
  const [resolvedSource, setResolvedSource] = useState<ResolvedVideoSource>({
    source: null,
    isLocal: false,
  });
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const [muted, setMuted] = useState(true);

  const title = getDisplayTitle(item);
  const creator = getDisplayCreator(item);
  const thumbnailUri = getThumbnailUri(item);
  const storedLocalUri = getStoredLocalUri(item);

  useEffect(() => {
    let cancelled = false;

    const resolveVideoSource = async () => {
      setFirstFrameRendered(false);
      setResolvedSource({ source: null, isLocal: false });

      try {
        if (
          storedLocalUri &&
          await offlineMediaManager.checkFileExists(storedLocalUri, item.media_file_size)
        ) {
          if (!cancelled) {
            setResolvedSource({
              source: {
                uri: storedLocalUri,
                contentType: 'progressive',
                metadata: { title, artist: creator, artwork: thumbnailUri },
              },
              isLocal: true,
            });
          }
          return;
        }

        if (!item.local_filename) {
          throw new Error('No media file available');
        }

        const [remoteUrl, headers] = await Promise.all([
          apiService.getMediaUrl(item.local_filename),
          apiService.getMediaDownloadHeaders(),
        ]);

        if (!cancelled) {
          setResolvedSource({
            source: {
              uri: remoteUrl,
              headers,
              contentType: 'progressive',
              useCaching: false,
              metadata: { title, artist: creator, artwork: thumbnailUri },
            },
            isLocal: false,
          });
        }
      } catch (error: any) {
        if (!cancelled) {
          setResolvedSource({
            source: null,
            isLocal: false,
            error: error?.message || 'Video unavailable',
          });
        }
      }
    };

    resolveVideoSource();

    return () => {
      cancelled = true;
    };
  }, [
    creator,
    item.local_filename,
    item.media_file_size,
    storedLocalUri,
    thumbnailUri,
    title,
  ]);

  const player = useVideoPlayer(resolvedSource.source, playerInstance => {
    playerInstance.loop = true;
    playerInstance.muted = true;
    playerInstance.volume = 1;
    playerInstance.timeUpdateEventInterval = 0;
    playerInstance.staysActiveInBackground = false;
    playerInstance.showNowPlayingNotification = false;
    playerInstance.audioMixingMode = 'mixWithOthers';
    playerInstance.bufferOptions = {
      preferredForwardBufferDuration: 2,
      waitsToMinimizeStalling: true,
      minBufferForPlayback: 0.2,
    };
  });

  const statusEvent = useEvent(player, 'statusChange', {
    status: player.status,
    error: undefined,
  });

  useEffect(() => {
    player.loop = true;
    player.muted = muted;
    player.keepScreenOnWhilePlaying = isActive;

    if (isActive && resolvedSource.source && statusEvent?.status !== 'error') {
      player.play();
      return;
    }

    player.pause();
  }, [isActive, muted, player, resolvedSource.source, statusEvent?.status]);

  useEffect(() => {
    return () => {
      player.pause();
    };
  }, [player]);

  const showLoading = useMemo(() => {
    return Boolean(resolvedSource.source && !firstFrameRendered && statusEvent?.status !== 'error');
  }, [firstFrameRendered, resolvedSource.source, statusEvent?.status]);

  const errorMessage = resolvedSource.error || statusEvent?.error?.message;

  return (
    <View style={[styles.container, { height }]}>
      {thumbnailUri && !firstFrameRendered ? (
        <Image source={{ uri: thumbnailUri }} style={styles.poster} resizeMode="cover" />
      ) : null}

      {resolvedSource.source ? (
        <VideoView
          player={player}
          style={styles.video}
          contentFit="cover"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          startsPictureInPictureAutomatically={false}
          surfaceType={Platform.OS === 'android' ? 'textureView' : 'surfaceView'}
          useExoShutter={false}
          onFirstFrameRender={() => setFirstFrameRendered(true)}
        />
      ) : null}

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.42)', 'transparent', 'rgba(0,0,0,0.88)']}
        locations={[0, 0.42, 1]}
        style={styles.gradient}
      />

      {resolvedSource.isLocal ? (
        <View style={[styles.offlineBadge, { top: topInset + 14 }]}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.offlineBadgeText}>Offline</Text>
        </View>
      ) : null}

      <TouchableOpacity
        accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
        style={[styles.muteButton, { bottom: bottomInset + 118 }]}
        activeOpacity={0.82}
        onPress={() => setMuted(value => !value)}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#fff" />
      </TouchableOpacity>

      {showLoading ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : null}

      {errorMessage ? (
        <View style={styles.errorOverlay}>
          <Ionicons name="alert-circle" size={28} color="#fff" />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <View style={[styles.metaPanel, { bottom: bottomInset + 30 }]}>
        <View style={styles.creatorRow}>
          <Ionicons
            name={item.content_type === 'youtube' ? 'logo-youtube' : 'logo-instagram'}
            size={18}
            color="#fff"
          />
          <Text style={styles.creatorText} numberOfLines={1}>
            @{creator}
          </Text>
        </View>
        <Text style={styles.titleText} numberOfLines={3}>
          {title}
        </Text>
        {item.category ? (
          <View style={styles.categoryPill}>
            <Text style={styles.categoryText} numberOfLines={1}>
              {item.category}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  poster: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  offlineBadge: {
    position: 'absolute',
    right: 16,
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 4,
  },
  offlineBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  muteButton: {
    position: 'absolute',
    right: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  errorOverlay: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '42%',
    alignItems: 'center',
    gap: 10,
    zIndex: 5,
  },
  errorText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0,
  },
  metaPanel: {
    position: 'absolute',
    left: 18,
    right: 86,
    zIndex: 3,
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 10,
  },
  creatorText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0,
  },
  titleText: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: 0,
  },
  categoryPill: {
    alignSelf: 'flex-start',
    marginTop: 12,
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  categoryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
});

export default memo(ReelItem);
