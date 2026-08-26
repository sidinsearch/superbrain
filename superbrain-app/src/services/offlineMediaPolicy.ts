import AsyncStorage from '@react-native-async-storage/async-storage';
import offlineMediaManager, { OfflineMediaClearResult } from './OfflineMediaManager';

const AUTO_DELETE_ENABLED_KEY = '@superbrain_offline_media_auto_delete_enabled';
const AUTO_DELETE_DAYS_KEY = '@superbrain_offline_media_auto_delete_days';
export const DEFAULT_AUTO_DELETE_DAYS = 30;

export type OfflineMediaAutoDeletePolicy = {
  enabled: boolean;
  maxAgeDays: number;
};

export async function getOfflineMediaAutoDeletePolicy(): Promise<OfflineMediaAutoDeletePolicy> {
  const [enabledRaw, daysRaw] = await Promise.all([
    AsyncStorage.getItem(AUTO_DELETE_ENABLED_KEY),
    AsyncStorage.getItem(AUTO_DELETE_DAYS_KEY),
  ]);

  const parsedDays = Number(daysRaw || DEFAULT_AUTO_DELETE_DAYS);
  return {
    enabled: enabledRaw === 'true',
    maxAgeDays: Number.isFinite(parsedDays) ? Math.max(1, Math.floor(parsedDays)) : DEFAULT_AUTO_DELETE_DAYS,
  };
}

export async function setOfflineMediaAutoDeletePolicy(
  policy: OfflineMediaAutoDeletePolicy,
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(AUTO_DELETE_ENABLED_KEY, policy.enabled ? 'true' : 'false'),
    AsyncStorage.setItem(AUTO_DELETE_DAYS_KEY, String(Math.max(1, Math.floor(policy.maxAgeDays)))),
  ]);
}

export async function runOfflineMediaAutoDeletePolicy(): Promise<OfflineMediaClearResult | null> {
  const policy = await getOfflineMediaAutoDeletePolicy();
  if (!policy.enabled) {
    return null;
  }
  return offlineMediaManager.deleteSavedReelsOlderThan(policy.maxAgeDays);
}
