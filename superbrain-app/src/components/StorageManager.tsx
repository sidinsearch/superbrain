import React, { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import offlineMediaManager, {
  OfflineMediaClearResult,
  OfflineMediaStorageSummary,
} from '../services/OfflineMediaManager';
import {
  DEFAULT_AUTO_DELETE_DAYS,
  getOfflineMediaAutoDeletePolicy,
  setOfflineMediaAutoDeletePolicy,
} from '../services/offlineMediaPolicy';

type StorageManagerProps = {
  onResult?: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) {
    return '0 MB';
  }

  const mb = bytes / (1024 * 1024);
  if (mb < 1024) {
    return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
  }

  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) {
    return 'Never';
  }
  return new Date(timestamp).toLocaleDateString();
}

function resultMessage(result: OfflineMediaClearResult, fallback: string): string {
  if (result.failedCount > 0 && result.deletedCount === 0) {
    return 'Could not delete cached videos';
  }
  if (result.deletedCount === 0) {
    return fallback;
  }
  return `Freed ${formatBytes(result.bytesFreed)} from ${result.deletedCount} video${result.deletedCount === 1 ? '' : 's'}`;
}

const StorageManager = ({ onResult }: StorageManagerProps) => {
  const [summary, setSummary] = useState<OfflineMediaStorageSummary | null>(null);
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState(false);
  const [autoDeleteDays, setAutoDeleteDays] = useState(DEFAULT_AUTO_DELETE_DAYS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refreshStorage = useCallback(async () => {
    setLoading(true);
    try {
      const nextSummary = await offlineMediaManager.getStorageSummary();
      setSummary(nextSummary);
    } catch {
      onResult?.('Could not read offline storage', 'error');
    } finally {
      setLoading(false);
    }
  }, [onResult]);

  useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(async () => {
      try {
        const policy = await getOfflineMediaAutoDeletePolicy();

        if (cancelled) {
          return;
        }

        setAutoDeleteEnabled(policy.enabled);
        setAutoDeleteDays(policy.maxAgeDays);

        if (policy.enabled) {
          await offlineMediaManager.deleteSavedReelsOlderThan(policy.maxAgeDays);
        }

        if (!cancelled) {
          await refreshStorage();
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
          onResult?.('Could not load storage settings', 'error');
        }
      }
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [onResult, refreshStorage]);

  const handleToggleAutoDelete = useCallback(async (enabled: boolean) => {
    setAutoDeleteEnabled(enabled);
    await setOfflineMediaAutoDeletePolicy({
      enabled,
      maxAgeDays: autoDeleteDays,
    });
    if (enabled) {
      onResult?.(`Auto-delete enabled for videos older than ${autoDeleteDays} days`, 'success');
    } else {
      onResult?.('Auto-delete disabled', 'info');
    }
  }, [autoDeleteDays, onResult]);

  const handleRunAutoDelete = useCallback(async () => {
    try {
      setBusy(true);
      const result = await offlineMediaManager.deleteSavedReelsOlderThan(autoDeleteDays);
      await refreshStorage();
      onResult?.(resultMessage(result, 'No old cached videos to delete'), 'success');
    } catch {
      onResult?.('Auto-delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }, [autoDeleteDays, onResult, refreshStorage]);

  const handleClearCache = useCallback(() => {
    Alert.alert(
      'Clear Offline Videos',
      'This deletes downloaded MP4 files from this device but keeps your AI summaries, tags, and metadata.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy(true);
              const result = await offlineMediaManager.clearSavedReels();
              await refreshStorage();
              onResult?.(resultMessage(result, 'No cached videos to clear'), 'success');
            } catch {
              onResult?.('Could not clear cached videos', 'error');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [onResult, refreshStorage]);

  const cachedBytes = summary?.totalBytes || 0;
  const availableBytes = summary?.availableDiskSpaceBytes || 0;
  const diskBytes = summary?.totalDiskSpaceBytes || 0;
  const hasCachedVideos = cachedBytes > 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <View style={styles.iconWrap}>
            <Ionicons name="phone-portrait-outline" size={21} color={colors.success} />
          </View>
          <View>
            <Text style={styles.title}>Offline Videos</Text>
            <Text style={styles.subtitle}>
              {summary ? `${summary.fileCount} cached video${summary.fileCount === 1 ? '' : 's'}` : 'Checking cache'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          accessibilityLabel="Refresh offline storage"
          style={styles.iconButton}
          onPress={refreshStorage}
          disabled={loading || busy}
          activeOpacity={0.78}
        >
          <Ionicons name="refresh" size={19} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Calculating storage...</Text>
        </View>
      ) : (
        <>
          <View style={styles.metricRow}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Used</Text>
              <Text style={styles.metricValue}>{formatBytes(cachedBytes)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Available</Text>
              <Text style={styles.metricValue}>{formatBytes(availableBytes)}</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>Device capacity</Text>
            <Text style={styles.metaValue}>{formatBytes(diskBytes)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>Oldest video</Text>
            <Text style={styles.metaValue}>{formatDate(summary?.oldestModificationTime || null)}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.policyRow}>
            <View style={styles.policyTextWrap}>
              <Text style={styles.policyTitle}>Auto-delete old videos</Text>
              <Text style={styles.policySubtitle}>Older than {autoDeleteDays} days</Text>
            </View>
            <Switch
              value={autoDeleteEnabled}
              onValueChange={handleToggleAutoDelete}
              disabled={busy}
              trackColor={{ false: colors.border, true: `${colors.success}70` }}
              thumbColor={autoDeleteEnabled ? colors.success : colors.textMuted}
            />
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, busy && styles.disabledButton]}
              onPress={handleRunAutoDelete}
              disabled={busy || !hasCachedVideos}
              activeOpacity={0.82}
            >
              <Ionicons name="timer-outline" size={18} color={colors.text} />
              <Text style={styles.secondaryButtonText}>Delete Old</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dangerButton, (!hasCachedVideos || busy) && styles.disabledButton]}
              onPress={handleClearCache}
              disabled={busy || !hasCachedVideos}
              activeOpacity={0.82}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="trash-outline" size={18} color="#fff" />
              )}
              <Text style={styles.dangerButtonText}>Clear Cache</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: `${colors.success}18`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
    letterSpacing: 0,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundTertiary,
  },
  loadingRow: {
    height: 94,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13,
    letterSpacing: 0,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  metric: {
    flex: 1,
    minHeight: 66,
    borderRadius: 12,
    backgroundColor: colors.backgroundTertiary,
    padding: 12,
    justifyContent: 'center',
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 5,
    letterSpacing: 0,
  },
  metricValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  metaRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 13,
    letterSpacing: 0,
  },
  metaValue: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 14,
  },
  policyRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  policyTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  policyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  policySubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
    letterSpacing: 0,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  dangerButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  dangerButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  disabledButton: {
    opacity: 0.48,
  },
});

export default StorageManager;
