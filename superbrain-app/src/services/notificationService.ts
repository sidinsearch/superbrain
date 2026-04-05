import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post } from '../types';
import { collectionsService } from './collections';

const COLLECTIONS_KEY = '@superbrain_collections';
const WL_NOTIF_IDS_KEY = '@superbrain_wl_notif_ids'; // { [shortcode]: string[] }
const ONBOARDED_KEY = '@superbrain_onboarded';

// ─────────────────────────────────────────────
// Foreground handler
// ─────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Simple deterministic hash of a string → non-negative integer */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Returns true if the post looks time-sensitive (exam / contest / deadline) */
function isDeadlinePost(post: Partial<Post>): boolean {
  const haystack = [post.title, post.summary, ...(post.tags ?? []), post.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\b(deadline|exam|contest|apply|applicat|register|registrat|due date|last date|form|expire|submit|cutoff|enroll|scholarship|hackathon|competi)\b/.test(
    haystack
  );
}

// ─────────────────────────────────────────────
// Message builder
// ─────────────────────────────────────────────
function _buildContent(
  post: Partial<Post>,
  variant: 'reminder' | 'urgent' = 'reminder'
): { title: string; body: string } {
  const name = post.title || 'something you saved';
  const cat = (post.category || '').toLowerCase();

  if (variant === 'urgent') {
    return {
      title: "🚨 You're missing something crucial!",
      body: `"${name}" has a deadline approaching. Don't say we didn't warn you!`,
    };
  }

  if (post.content_type === 'youtube') {
    if (cat.includes('film') || cat.includes('movie') || cat.includes('entertain'))
      return { title: '🍿 Popcorn is getting cold!', body: `You saved "${name}" — time for a movie break?` };
    if (cat.includes('educat') || cat.includes('tutorial') || cat.includes('learn'))
      return { title: '🤓 Brain gains await!', body: `Your tutorial "${name}" is collecting dust. Let's learn!` };
    return { title: '▶️ You are missing something', body: `"${name}" is still waiting in your Watch Later.` };
  }

  if (post.content_type === 'webpage') {
    if (isDeadlinePost(post))
      return { title: '⏰ Tick-tock!', body: `"${name}" needs your attention before it's too late!` };
    if (cat.includes('job') || cat.includes('career') || cat.includes('opportun'))
      return { title: "💼 Your future is calling!", body: `Don't ignore "${name}" — it could be your big break!` };
    if (cat.includes('tool') || cat.includes('product') || cat.includes('software'))
      return { title: '🛠️ Magic tools inside!', body: `You wanted to try "${name}". What are you waiting for?` };
    return { title: '👀 You are missing something', body: `"${name}" is feeling neglected in your Watch Later.` };
  }

  if (cat.includes('food') || cat.includes('recipe'))
    return { title: '🤤 We are hungry too!', body: `That recipe for "${name}" isn't going to cook itself!` };
  if (cat.includes('fitness') || cat.includes('workout'))
    return { title: '💪 No excuses today!', body: `Your muscles called. They want you to do "${name}".` };

  const fallbacks = [
    { title: "👀 You are missing something", body: `"${name}" is still in your Watch Later.` },
    { title: '🫣 Secret stash!', body: `Did you forget you saved "${name}"? Time to check it out!` },
    { title: '🚨 Warning: Boredom detected', body: `Cure it by checking out "${name}" in Watch Later.` },
  ];
  return fallbacks[simpleHash(post.shortcode ?? name) % fallbacks.length];
}

/** Public wrapper — always prepends the 🧠 brand icon to every title */
function buildNotificationContent(
  post: Partial<Post>,
  variant: 'reminder' | 'urgent' = 'reminder'
): { title: string; body: string } {
  const result = _buildContent(post, variant);
  return { ...result, title: '🧠 ' + result.title };
}

// ─────────────────────────────────────────────
// Notification ID map helpers
// ─────────────────────────────────────────────
async function loadNotifIds(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem(WL_NOTIF_IDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function saveNotifIds(map: Record<string, string[]>): Promise<void> {
  await AsyncStorage.setItem(WL_NOTIF_IDS_KEY, JSON.stringify(map));
}

// ─────────────────────────────────────────────
// Permission + category setup
// ─────────────────────────────────────────────
async function requestNotificationPermission(): Promise<boolean> {
  // Never show notification permission prompt until onboarding is completed.
  const onboarded = await AsyncStorage.getItem(ONBOARDED_KEY);
  if (onboarded !== '1') {
    return false;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('watch-later', {
      name: 'Watch Later Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#667eea',
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('watch-later-urgent', {
      name: 'Watch Later — Urgent',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#ff6b6b',
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync('analysis-complete', {
      name: 'Analysis Complete',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#28a745',
      sound: 'default',
    });
  }

  // Register "Mark as Watched" action button (Android & iOS)
  try {
    await Notifications.setNotificationCategoryAsync('watch_later_post', [
      {
        identifier: 'mark_watched',
        buttonTitle: '✓ Mark as Watched',
        options: {
          isDestructive: true,
          opensAppToForeground: false,
        },
      },
    ]);
  } catch (e) {
    console.warn('[Notifications] setNotificationCategoryAsync failed (non-fatal):', e);
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Explicitly called by onboarding completion flow.
export async function requestNotificationPermissionAfterOnboarding(): Promise<boolean> {
  return requestNotificationPermission();
}

// ─────────────────────────────────────────────
// Schedule daily notification(s) for ONE post
// ─────────────────────────────────────────────
export async function schedulePostWatchLaterNotification(post: Post): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;

    await cancelPostWatchLaterNotification(post.shortcode);

    const ids: string[] = [];
    const hash = simpleHash(post.shortcode);
    const slot = hash % 28;
    const notifHour = 8 + Math.floor(slot / 2);
    const notifMinute = (slot % 2) * 30;

    const { title, body } = buildNotificationContent(post, 'reminder');
    const eveningId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        categoryIdentifier: 'watch_later_post',
        data: { shortcode: post.shortcode, type: 'watch_later' },
        ...(Platform.OS === 'android' ? { channelId: 'watch-later', color: '#667eea' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour: notifHour,
        minute: notifMinute,
        repeats: true,
      },
    });
    ids.push(eveningId);

    if (isDeadlinePost(post)) {
      const { title: uTitle, body: uBody } = buildNotificationContent(post, 'urgent');
      const morningId = await Notifications.scheduleNotificationAsync({
        content: {
          title: uTitle,
          body: uBody,
          sound: 'default',
          categoryIdentifier: 'watch_later_post',
          data: { shortcode: post.shortcode, type: 'watch_later_urgent' },
          ...(Platform.OS === 'android'
            ? { channelId: 'watch-later-urgent', color: '#ff6b6b',
                priority: Notifications.AndroidNotificationPriority.HIGH }
            : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          hour: 9,
          minute: hash % 15,
          repeats: true,
        },
      });
      ids.push(morningId);
    }

    const map = await loadNotifIds();
    map[post.shortcode] = ids;
    await saveNotifIds(map);
  } catch (e) {
    console.warn('[Notifications] schedulePostWatchLaterNotification error:', e);
  }
}

// ─────────────────────────────────────────────
// Cancel notifications for ONE post
// ─────────────────────────────────────────────
export async function cancelPostWatchLaterNotification(shortcode: string): Promise<void> {
  try {
    const map = await loadNotifIds();
    const ids = map[shortcode] ?? [];
    await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
    delete map[shortcode];
    await saveNotifIds(map);
  } catch (e) {
    console.warn('[Notifications] cancelPostWatchLaterNotification error:', e);
  }
}

// ─────────────────────────────────────────────
// Reschedule ALL Watch Later posts
// ─────────────────────────────────────────────
export async function scheduleAllWatchLaterNotifications(): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;

    const raw = await AsyncStorage.getItem(COLLECTIONS_KEY);
    if (!raw) return;
    const collections = JSON.parse(raw);
    const watchLater = collections.find((c: any) => c.id === 'default_watch_later');
    if (!watchLater || watchLater.postIds.length === 0) return;

    const postIds: string[] = watchLater.postIds;

    let cachedPosts: Post[] = [];
    try {
      const cp = await AsyncStorage.getItem('@superbrain_posts_cache');
      if (cp) cachedPosts = JSON.parse(cp);
    } catch (_) {}

    const map = await loadNotifIds();
    const currentSet = new Set(postIds);
    for (const sc of Object.keys(map)) {
      if (!currentSet.has(sc)) await cancelPostWatchLaterNotification(sc);
    }

    for (const shortcode of postIds) {
      const post =
        cachedPosts.find(p => p.shortcode === shortcode) ??
        ({ shortcode, title: 'A saved item', content_type: 'instagram' } as Post);
      await schedulePostWatchLaterNotification(post);
    }
  } catch (e) {
    console.warn('[Notifications] scheduleAllWatchLaterNotifications error:', e);
  }
}

// Legacy aliases
export async function scheduleWatchLaterNotification(): Promise<void> {
  await scheduleAllWatchLaterNotifications();
}
export async function rescheduleWatchLaterNotification(): Promise<void> {
  await scheduleAllWatchLaterNotifications();
}

// ─────────────────────────────────────────────
// "Mark as Watched" action handler
// ─────────────────────────────────────────────
export async function handleMarkAsWatched(shortcode: string): Promise<void> {
  try {
    await collectionsService.removePostFromCollection('default_watch_later', shortcode);
    await cancelPostWatchLaterNotification(shortcode);
  } catch (e) {
    console.warn('[Notifications] handleMarkAsWatched error:', e);
  }
}

// ─────────────────────────────────────────────
// Immediate notification on "Add to Watch Later"
// ─────────────────────────────────────────────
export async function sendImmediateWatchLaterNotification(post: Post): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;

    const { body } = buildNotificationContent(post, 'reminder');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🧠 ⏰ Added to Watch Later',
        body,
        sound: 'default',
        data: { shortcode: post.shortcode, type: 'watch_later_added' },
        ...(Platform.OS === 'android' ? { channelId: 'watch-later-urgent', color: '#667eea' } : {}),
      },
      trigger: null,
    });

    await schedulePostWatchLaterNotification(post);
  } catch (e) {
    console.warn('[Notifications] sendImmediateWatchLaterNotification error:', e);
  }
}

// ─────────────────────────────────────────────
// Instant "Saved to SuperBrain" notification
// (kept for backward compat but now rarely used directly)
// ─────────────────────────────────────────────
export async function sendImmediateSavedNotification(post: Post): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;

    const body = post.title
      ? `"${post.title}" is being analyzed…`
      : 'Your post is being analyzed…';

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🧠 Saved to SuperBrain',
        body,
        sound: 'default',
        data: { shortcode: post.shortcode, type: 'saved' },
        ...(Platform.OS === 'android' ? { channelId: 'watch-later-urgent', color: '#667eea' } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[Notifications] sendImmediateSavedNotification error:', e);
  }
}

// ─────────────────────────────────────────────
// Analysis-complete notification
// Fires AFTER the backend finishes analyzing
// ─────────────────────────────────────────────
export async function sendAnalysisCompleteNotification(post: Post): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;

    const name = post.title || 'Your saved post';
    const cat = (post.category || '').toLowerCase();

    let title = '🧠 ✅ Analysis Complete';
    let body = `"${name}" has been analyzed and saved!`;

    if (post.content_type === 'youtube') {
      title = '🧠 🎬 Video Analyzed';
      body = `"${name}" is ready — summary, tags, and more!`;
    } else if (post.content_type === 'webpage') {
      title = '🧠 🌐 Page Analyzed';
      body = `"${name}" has been saved with AI summary.`;
    } else if (cat.includes('food') || cat.includes('recipe')) {
      title = '🧠 🍳 Recipe Saved';
      body = `"${name}" — analyzed and ready to cook!`;
    } else if (cat.includes('fitness') || cat.includes('workout')) {
      title = '🧠 💪 Workout Saved';
      body = `"${name}" — analyzed and ready for action!`;
    } else if (cat.includes('educat') || cat.includes('tutorial') || cat.includes('learn')) {
      title = '🧠 📚 Learning Content Ready';
      body = `"${name}" — your summary and notes are ready.`;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: { shortcode: post.shortcode, type: 'analysis_complete' },
        ...(Platform.OS === 'android' ? {
          channelId: 'analysis-complete',
          color: '#28a745',
          priority: Notifications.AndroidNotificationPriority.HIGH,
        } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[Notifications] sendAnalysisCompleteNotification error:', e);
  }
}

// ─────────────────────────────────────────────
// Analysis-failed notification
// ─────────────────────────────────────────────
export async function sendAnalysisFailedNotification(shortcode: string, title?: string): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;

    const name = title || 'A saved post';

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🧠 ❌ Analysis Failed',
        body: `"${name}" could not be analyzed. Tap to retry.`,
        sound: 'default',
        data: { shortcode, type: 'analysis_failed' },
        ...(Platform.OS === 'android' ? {
          channelId: 'analysis-complete',
          color: '#dc3545',
          priority: Notifications.AndroidNotificationPriority.HIGH,
        } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[Notifications] sendAnalysisFailedNotification error:', e);
  }
}
