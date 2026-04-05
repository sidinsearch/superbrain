import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import apiService from '../services/api';
import CustomToast from '../components/CustomToast';
import { RootStackParamList } from '../../App';
import { QueueStatus } from '../types';
import BottomNav from '../components/BottomNav';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface DialogState {
  visible: boolean;
  title: string;
  message: string;
  confirmText: string;
  destructive: boolean;
  onConfirm: () => void;
}

interface SettingsItemProps {
  icon: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  showBadge?: boolean;
  badgeText?: string;
}

const SettingsItem = ({ icon, iconColor = colors.primary, title, subtitle, onPress, showBadge, badgeText }: SettingsItemProps) => (
  <TouchableOpacity style={styles.settingsItem} onPress={onPress} activeOpacity={0.7}>
    <View style={[styles.settingsIcon, { backgroundColor: `${iconColor}20` }]}>
      <Ionicons name={icon as any} size={22} color={iconColor} />
    </View>
    <View style={styles.settingsItemContent}>
      <Text style={styles.settingsItemTitle}>{title}</Text>
      {subtitle && <Text style={styles.settingsItemSubtitle}>{subtitle}</Text>}
    </View>
    {showBadge && badgeText && (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badgeText}</Text>
      </View>
    )}
    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
  </TouchableOpacity>
);

const ACCESS_TOKEN_LENGTH = 8;
const sanitizeAccessToken = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const SettingsScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const tokenInputRefs = useRef<Array<TextInput | null>>([]);
  // Start with truly empty; loadSettings will populate from storage if they exist
  const [serverUrl, setServerUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [flushingRetry, setFlushingRetry] = useState(false);
  const [resettingDb, setResettingDb] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });
  const [resettingToken, setResettingToken] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({
    visible: false,
    title: '',
    message: '',
    confirmText: 'OK',
    destructive: false,
    onConfirm: () => { },
  });

  useEffect(() => {
    loadSettings();
  }, []);

  // Handle QR scan data when returning from QRScanner
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      const routes = navigation.getState()?.routes;
      const currentRoute = routes?.[routes.length - 1];
      const params = currentRoute?.params as any;
      if (params?.qrData) {
        const { url, token } = params.qrData;
        if (url) setServerUrl(url);
        if (token) setApiToken(token);
        // Clear the params so we don't re-trigger
        navigation.setParams({ qrData: undefined } as any);
        // Auto-save after a brief delay to let state update
        setTimeout(() => handleQRConnect(url, token), 300);
      }
    });
    return unsubscribe;
  }, [navigation]);

  const loadSettings = async () => {
    try {
      const token = await apiService.getApiToken();
      const baseUrl = await apiService.getBaseUrl();

      // Only populate if values exist in storage; otherwise keep empty
      if (baseUrl) {
        setServerUrl(baseUrl);
      }
      if (token) {
        setApiToken(sanitizeAccessToken(token).slice(0, ACCESS_TOKEN_LENGTH));
      }

      // Only attempt to validate connection if both are configured
      if (token && baseUrl) {
        try {
          const status = await apiService.getQueueStatus();
          if (status !== null) {
            setConnectionStatus('connected');
            setQueueStatus(status);
          } else {
            setConnectionStatus('disconnected');
          }
        } catch {
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      setConnectionStatus('disconnected');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!serverUrl.trim()) {
      setToast({ visible: true, message: 'Please enter server URL', type: 'warning' });
      return;
    }

    const normalizedToken = sanitizeAccessToken(apiToken);

    if (!normalizedToken) {
      setToast({ visible: true, message: 'Please enter Access Token', type: 'warning' });
      return;
    }

    if (normalizedToken.length !== ACCESS_TOKEN_LENGTH) {
      setToast({ visible: true, message: 'Access Token must be 8 characters', type: 'warning' });
      return;
    }

    try {
      setSaving(true);

      const normalizedUrl = serverUrl.trim().replace(/\/+$/, '');
      await apiService.setApiUrl(normalizedUrl);
      await apiService.setApiToken(normalizedToken);

      const reachable = await apiService.testConnection();
      if (!reachable) {
        setConnectionStatus('disconnected');
        setToast({ visible: true, message: 'Cannot reach server URL', type: 'error' });
        return;
      }

      const status = await apiService.getQueueStatus();
      if (status !== null) {
        setConnectionStatus('connected');
        setQueueStatus(status);
        setToast({ visible: true, message: 'Connected successfully', type: 'success' });
      } else {
        setConnectionStatus('disconnected');
        setToast({ visible: true, message: 'Invalid Access Token', type: 'error' });
      }
    } catch (error: any) {
      setConnectionStatus('disconnected');
      setToast({ visible: true, message: error.message || 'Connection failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleQRConnect = async (qrUrl: string, qrToken: string) => {
    if (!qrUrl || !qrToken) return;
    try {
      setSaving(true);
      const normalizedUrl = qrUrl.trim().replace(/\/+$/, '');
      const normalizedToken = sanitizeAccessToken(qrToken);

      if (!normalizedToken || normalizedToken.length !== ACCESS_TOKEN_LENGTH) {
        setToast({ visible: true, message: 'Invalid token from QR code', type: 'error' });
        return;
      }

      await apiService.setApiUrl(normalizedUrl);
      await apiService.setApiToken(normalizedToken);

      const reachable = await apiService.testConnection();
      if (!reachable) {
        setConnectionStatus('disconnected');
        setToast({ visible: true, message: 'Server not reachable', type: 'error' });
        return;
      }

      const status = await apiService.getQueueStatus();
      if (status !== null) {
        setConnectionStatus('connected');
        setQueueStatus(status);
        setToast({ visible: true, message: '✅ Connected via QR code!', type: 'success' });
      } else {
        setConnectionStatus('disconnected');
        setToast({ visible: true, message: 'Invalid Access Token from QR', type: 'error' });
      }
    } catch (error: any) {
      setConnectionStatus('disconnected');
      setToast({ visible: true, message: error.message || 'QR connection failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTokenDigitChange = (index: number, text: string) => {
    const sanitized = sanitizeAccessToken(text);

    if (!sanitized) {
      const chars = apiToken.padEnd(ACCESS_TOKEN_LENGTH, ' ').split('');
      chars[index] = ' ';
      setApiToken(chars.join('').trimEnd());
      return;
    }

    const chars = apiToken.padEnd(ACCESS_TOKEN_LENGTH, ' ').split('');

    // Support paste of full/partial token in any box
    if (sanitized.length > 1) {
      let writeIndex = index;
      for (let i = 0; i < sanitized.length && writeIndex < ACCESS_TOKEN_LENGTH; i += 1) {
        chars[writeIndex] = sanitized[i];
        writeIndex += 1;
      }
      setApiToken(chars.join('').trimEnd());
      const focusIndex = Math.min(writeIndex, ACCESS_TOKEN_LENGTH - 1);
      tokenInputRefs.current[focusIndex]?.focus();
      return;
    }

    chars[index] = sanitized[0];
    setApiToken(chars.join('').trimEnd());

    if (index < ACCESS_TOKEN_LENGTH - 1) {
      tokenInputRefs.current[index + 1]?.focus();
    }
  };

  const handleTokenKeyPress = (index: number, key: string) => {
    if (key !== 'Backspace') {
      return;
    }

    const chars = apiToken.padEnd(ACCESS_TOKEN_LENGTH, ' ').split('');
    if (chars[index]?.trim()) {
      chars[index] = ' ';
      setApiToken(chars.join('').trimEnd());
      return;
    }

    if (index > 0) {
      chars[index - 1] = ' ';
      setApiToken(chars.join('').trimEnd());
      tokenInputRefs.current[index - 1]?.focus();
    }
  };

  const handleFlushRetry = async () => {
    try {
      setFlushingRetry(true);
      const result = await apiService.flushRetryQueue();
      const s = await apiService.getQueueStatus();
      setQueueStatus(s);
      setToast({
        visible: true,
        message: result.flushed > 0
          ? `Moved ${result.flushed} item(s) back to queue`
          : 'No retry items ready yet',
        type: result.flushed > 0 ? 'success' : 'info',
      });
    } catch {
      setToast({ visible: true, message: 'Failed to flush retry queue', type: 'error' });
    } finally {
      setFlushingRetry(false);
    }
  };

  const handleResetApiToken = () => {
    setDialog({
      visible: true,
      title: 'Reset Access Token',
      message: 'This will generate a new Access Token. You will need to update it in your app settings. Continue?',
      confirmText: 'Reset',
      destructive: true,
      onConfirm: async () => {
        setDialog(prev => ({ ...prev, visible: false }));
        try {
          setResettingToken(true);
          const result = await apiService.resetApiToken();
          setApiToken(result.new_token);
          setToast({ visible: true, message: 'New Access Token generated', type: 'success' });
        } catch {
          setToast({ visible: true, message: 'Failed to reset Access Token', type: 'error' });
        } finally {
          setResettingToken(false);
        }
      },
    });
  };

  const handleResetDatabase = () => {
    setDialog({
      visible: true,
      title: 'Reset Database',
      message: 'This will delete ALL posts and collections. This cannot be undone!',
      confirmText: 'Delete All',
      destructive: true,
      onConfirm: async () => {
        setDialog(prev => ({ ...prev, visible: false }));
        try {
          setResettingDb(true);
          const result = await apiService.resetDatabase();
          setToast({ visible: true, message: `Database cleared. ${result.deleted_count} posts deleted.`, type: 'success' });
        } catch (error) {
          setToast({ visible: true, message: 'Failed to reset database', type: 'error' });
        } finally {
          setResettingDb(false);
        }
      },
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSubtitle}>Configure your SuperBrain</Text>
        </View>

        <View style={styles.headerSpacer} />

        {/* Server and Access Token */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusTitleRow}>
              <Ionicons name="sync" size={18} color={colors.primary} style={{ marginRight: 8 }} />
              <Text style={styles.statusTitle}>Connection</Text>
            </View>
            <View style={styles.statusRightRow}>
              <TouchableOpacity
                style={styles.qrButton}
                onPress={() => navigation.navigate('QRScanner' as any)}
                activeOpacity={0.7}
              >
                <Ionicons name="qr-code-outline" size={18} color={colors.primary} />
              </TouchableOpacity>
              <View style={[styles.statusBadge, connectionStatus === 'connected' ? styles.statusConnected : styles.statusDisconnected]}>
                <Ionicons
                  name={connectionStatus === 'connected' ? 'checkmark-circle' : 'close-circle'}
                  size={14}
                  color={connectionStatus === 'connected' ? '#28a745' : '#dc3545'}
                />
                <Text style={[styles.statusText, connectionStatus === 'connected' ? styles.statusTextConnected : styles.statusTextDisconnected]}>
                  {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.inputLabel}>Server URL</Text>
          <TextInput
            style={styles.apiInput}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="e.g., http://localhost:8000"
            placeholderTextColor={colors.textMuted}
            editable={!saving}
          />

          <Text style={styles.inputLabel}>Access Token</Text>
          <View style={styles.tokenInputRow}>
            {Array.from({ length: ACCESS_TOKEN_LENGTH }).map((_, index) => (
              <TextInput
                key={`token-${index}`}
                ref={(ref) => {
                  tokenInputRefs.current[index] = ref;
                }}
                style={styles.tokenDigitInput}
                value={apiToken[index] || ''}
                onChangeText={(text) => handleTokenDigitChange(index, text)}
                onKeyPress={({ nativeEvent }) => handleTokenKeyPress(index, nativeEvent.key)}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!saving}
                maxLength={8}
                textAlign="center"
                keyboardType="default"
                placeholder="•"
                placeholderTextColor={colors.textMuted}
              />
            ))}
          </View>
          <Text style={styles.tokenHint}>8-character alphanumeric Access Token</Text>

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Settings Menu */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Configuration</Text>

          <SettingsItem
            icon="cloud-outline"
            iconColor="#8b5cf6"
            title="AI Providers"
            subtitle="Configure Groq, Gemini, OpenRouter"
            onPress={() => navigation.navigate('AIProvider')}
          />

          <SettingsItem
            icon="logo-instagram"
            iconColor="#e4405f"
            title="Instagram"
            subtitle="Optional login for reliable Instagram downloads"
            onPress={() => navigation.navigate('Instagram')}
          />

          <SettingsItem
            icon="download-outline"
            iconColor="#10b981"
            title="Data Import/Export"
            subtitle="Backup and restore your data"
            onPress={() => navigation.navigate('DataImportExport')}
          />
        </View>

        {/* Queue Management */}
        {queueStatus !== null && (queueStatus.retry_count ?? 0) > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Queue</Text>

            <SettingsItem
              icon="refresh-circle-outline"
              iconColor="#f59e0b"
              title="Retry Queue"
              subtitle={`${queueStatus.retry_count} posts pending`}
              onPress={handleFlushRetry}
              showBadge
              badgeText={`${queueStatus.retry_count}`}
            />
          </View>
        )}

        {/* Danger Zone */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Danger Zone</Text>

          <SettingsItem
            icon="key-outline"
            iconColor="#6366f1"
            title="Reset Access Token"
            subtitle="Generate a new Access Token"
            onPress={handleResetApiToken}
          />

          <SettingsItem
            icon="trash-outline"
            iconColor="#dc3545"
            title="Reset Database"
            subtitle="Delete all posts and collections"
            onPress={handleResetDatabase}
          />
        </View>

        {/* App Info */}
        <View style={styles.appInfo}>
          <View style={styles.appInfoRow}>
            <Text style={styles.appInfoEmoji}>🧠</Text>
            <Text style={styles.appInfoTitle}>SuperBrain</Text>
          </View>
          <View style={styles.appInfoCreditRow}>
            <Text style={styles.appInfoCreditText}>made with </Text>
            <Text style={styles.appInfoEmojiSmall}>❤️</Text>
            <Text style={styles.appInfoCreditText}> by </Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://github.com/sidinsearch')}>
              <Text style={styles.appInfoCreditLink}>sidinsearch</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <BottomNav activeTab="Settings" />

      <CustomToast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast({ ...toast, visible: false })}
      />

      {/* Themed Dialog Modal */}
      <Modal
        visible={dialog.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setDialog(prev => ({ ...prev, visible: false }))}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogContent}>
            <Text style={styles.dialogTitle}>{dialog.title}</Text>
            <Text style={styles.dialogMessage}>{dialog.message}</Text>
            <View style={styles.dialogButtons}>
              <TouchableOpacity
                style={styles.dialogCancelButton}
                onPress={() => setDialog(prev => ({ ...prev, visible: false }))}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogConfirmButton, dialog.destructive && styles.dialogDestructiveButton]}
                onPress={dialog.onConfirm}
              >
                <Text style={[styles.dialogConfirmText, dialog.destructive && styles.dialogDestructiveText]}>
                  {dialog.confirmText}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
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
  headerSpacer: {
    height: 16,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  statusCard: {
    backgroundColor: colors.backgroundCard,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  statusRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qrButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${colors.primary}18`,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${colors.primary}30`,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  statusConnected: {
    backgroundColor: 'rgba(40, 167, 69, 0.15)',
  },
  statusDisconnected: {
    backgroundColor: 'rgba(220, 53, 69, 0.15)',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusTextConnected: {
    color: '#28a745',
  },
  statusTextDisconnected: {
    color: '#dc3545',
  },
  inputLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  apiInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    marginBottom: 14,
  },
  tokenInputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tokenDigitInput: {
    width: 34,
    height: 46,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  tokenHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 14,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  settingsItemContent: {
    flex: 1,
  },
  settingsItemTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  settingsItemSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  badge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  appInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appInfoEmoji: {
    fontSize: 24,
  },
  appInfoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  appInfoCreditRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appInfoCreditText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  appInfoEmojiSmall: {
    fontSize: 14,
  },
  appInfoCreditLink: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialogContent: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dialogTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  dialogMessage: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  dialogButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  dialogCancelButton: {
    flex: 1,
    backgroundColor: colors.background,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dialogCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  dialogConfirmButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  dialogDestructiveButton: {
    backgroundColor: '#dc3545',
  },
  dialogConfirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  dialogDestructiveText: {
    color: '#fff',
  },
});

export default SettingsScreen;
