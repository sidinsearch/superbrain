import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post } from '../types';

const COLLECTIONS_KEY = '@superbrain_collections';
const WL_NOTIF_IDS_KEY = '@superbrain_wl_notif_ids'; // { [shortcode]: string[] }

// ─────────────────────────────────────────────
// Foreground handler
// ─────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
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
      title: "⚠️ Don't miss the deadline!",
      body: `"${name}" might have a deadline coming up — act today!`,
    };
  }

  if (post.content_type === 'youtube') {
    if (cat.includes('film') || cat.includes('movie') || cat.includes('entertain'))
      return { title: '🎬 Perfect for this weekend', body: `"${name}" is still waiting in your Watch Later!` };
    if (cat.includes('educat') || cat.includes('tutorial') || cat.includes('learn'))
      return { title: '📚 Level up today', body: `You saved "${name}" to learn from — ready when you are.` };
    return { title: '▶️ Still in your Watch Later', body: `Don't let "${name}" collect dust — give it a watch!` };
  }

  if (post.content_type === 'webpage') {
    if (isDeadlinePost(post))
      return { title: '📅 Time-sensitive reminder', body: `You saved "${name}" — don't miss any deadlines!` };
    if (cat.includes('job') || cat.includes('career') || cat.includes('opportun'))
      return { title: "💼 Don't miss this opportunity", body: `"${name}" — act before it closes!` };
    if (cat.includes('tool') || cat.includes('product') || cat.includes('software'))
      return { title: '🛠️ Have you tried this yet?', body: `You saved "${name}" to check out. Later is now!` };
    return { title: '🌐 You saved something important', body: `"${name}" is still in your Watch Later.` };
  }

  if (cat.includes('food') || cat.includes('recipe'))
    return { title: '🍳 Cook something new?', body: `You saved a recipe: "${name}" — perfect for today!` };
  if (cat.includes('fitness') || cat.includes('workout'))
    return { title: '💪 Your body called', body: `Time to try that workout you saved: "${name}"` };

  const fallbacks = [
    { title: "⏰ You're missing out!", body: `"${name}" is still in your Watch Later.` },
    { title: '💡 Remember this?', body: `You saved "${name}" — time to check it out!` },
    { title: '📌 Still on your list', body: `Don't forget: "${name}" in Watch Later.` },
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
export async function requestNotificationPermission(): Promise<boolean> {
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
  }

  // Register "Mark as Watched" action button (Android & iOS)
  await Notifications.setNotificationCategoryAsync('watch_later_post', [
    {
      identifier: 'mark_watched',
      buttonTitle: '✓ Mark as Watched',
      options: {
        isDestructive: true,
        opensAppToForeground: false, // silently removes without opening app
      },
    },
  ]);

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ─────────────────────────────────────────────
// Schedule daily notification(s) for ONE post
// ─────────────────────────────────────────────
/**
 * Schedule repeating daily reminder(s) for a single Watch Later post.
 *
 * Regular posts  → 1 notification at 19:30 + stagger (19:30–19:59)
 * Deadline posts → 2 notifications: 09:00 urgent + 19:30 reminder
 *
 * Notifications fire every day until cancelled (post removed).
 */
export async function schedulePostWatchLaterNotification(post: Post): Promise<void> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;

    // Cancel any existing notifications for this post
    await cancelPostWatchLaterNotification(post.shortcode);

    const ids: string[] = [];
    const hash = simpleHash(post.shortcode);
    // Spread posts across 28 half-hour slots: 08:00, 08:30, 09:00 … 21:30
    // (~30 min apart per post since each gets a deterministic unique-ish slot)
    const slot = hash % 28;
    const notifHour = 8 + Math.floor(slot / 2);
    const notifMinute = (slot % 2) * 30;

    // ── Daily reminder ────────────────────────────────────────────────
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

    // ── Morning urgent (deadline posts only) ─────────────────────────
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
          minute: hash % 15, // 0–14 morning stagger
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

    // Load cached post metadata
    let cachedPosts: Post[] = [];
    try {
      const cp = await AsyncStorage.getItem('@superbrain_posts_cache');
      if (cp) cachedPosts = JSON.parse(cp);
    } catch (_) {}

    // Cancel notifications for posts no longer in Watch Later
    const map = await loadNotifIds();
    const currentSet = new Set(postIds);
    for (const sc of Object.keys(map)) {
      if (!currentSet.has(sc)) await cancelPostWatchLaterNotification(sc);
    }

    // Schedule / refresh each post
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
// Called when user taps the action button on a notification
// ─────────────────────────────────────────────
export async function handleMarkAsWatched(shortcode: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(COLLECTIONS_KEY);
    if (!raw) return;
    const collections = JSON.parse(raw);
    const wl = collections.find((c: any) => c.id === 'default_watch_later');
    if (wl) {
      wl.postIds = (wl.postIds as string[]).filter((id: string) => id !== shortcode);
      wl.updatedAt = new Date().toISOString();
      await AsyncStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
    }
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
        categoryIdentifier: 'watch_later_post',
        data: { shortcode: post.shortcode, type: 'watch_later_added' },
        ...(Platform.OS === 'android' ? { channelId: 'watch-later', color: '#667eea' } : {}),
      },
      trigger: null,
    });

    // Set up daily scheduled notifications for this post
    await schedulePostWatchLaterNotification(post);
  } catch (e) {
    console.warn('[Notifications] sendImmediateWatchLaterNotification error:', e);
  }
}
