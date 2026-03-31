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
  Alert,
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

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const OTP_LENGTH = 8;

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

const SettingsScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [apiToken, setApiToken] = useState('');
  const [otpValues, setOtpValues] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const otpInputRefs = useRef<(TextInput | null)[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [flushingRetry, setFlushingRetry] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });
  const [resettingToken, setResettingToken] = useState(false);
  const [resettingDb, setResettingDb] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({
    visible: false,
    title: '',
    message: '',
    confirmText: '',
    destructive: false,
    onConfirm: () => {},
  });

  useEffect(() => {
    loadSettings();
  }, []);

  // Reload settings when screen regains focus (e.g., navigating back from Library)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadSettings();
    });
    
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (apiToken.length === OTP_LENGTH) {
      const chars = apiToken.split('');
      setOtpValues(chars);
    }
  }, [apiToken]);

  const handleOtpChange = (value: string, index: number) => {
    const newValues = [...otpValues];
    newValues[index] = value.toUpperCase();
    setOtpValues(newValues);
    
    const newToken = newValues.join('');
    setApiToken(newToken);
    
    if (value && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otpValues[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const loadSettings = async () => {
    try {
      // Always initialize first to ensure API service has latest state
      await apiService.initialize();
      const token = await apiService.getApiToken();
      const syncCode = await apiService.getSyncCode();
      
      // If we have a token, verify it's valid by checking connection
      if (token) {
        setConnectionStatus('connected');
        
        // Restore the sync code for display (falls back to token if not stored separately)
        setApiToken(syncCode || token);
        
        // Try to get queue status to verify token is valid
        const status = await apiService.getQueueStatus();
        if (status !== null) {
          setQueueStatus(status);
        } else {
          // Token might be invalid - clear it
          console.log('Token validation failed, clearing...');
          setConnectionStatus('disconnected');
          setApiToken('');
        }
      } else {
        setApiToken('');
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
    if (!apiToken.trim()) {
      setToast({ visible: true, message: 'Please enter a sync code', type: 'warning' });
      return;
    }

    try {
      setSaving(true);
      
      const syncCode = apiToken.trim().toUpperCase();
      const connectResult = await apiService.connectWithSyncCode(syncCode);
      
      if (connectResult.success && connectResult.api_token) {
        setConnectionStatus('connected');
        // Store the sync code separately so it persists for display
        await apiService.setSyncCode(connectResult.sync_code || syncCode);
        setApiToken(connectResult.sync_code || syncCode);
        apiService.getQueueStatus().then(s => setQueueStatus(s)).catch(() => {});
        setToast({ 
          visible: true, 
          message: `Connected! Sync code: ${connectResult.sync_code}`, 
          type: 'success' 
        });
      } else {
        setToast({ visible: true, message: connectResult.error || 'Connection failed', type: 'error' });
      }
    } catch (error: any) {
      setToast({ visible: true, message: error.message || 'Connection failed', type: 'error' });
    } finally {
      setSaving(false);
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

  const handleResetSyncCode = () => {
    setDialog({
      visible: true,
      title: 'Reset Sync Code',
      message: 'This will generate a new sync code. You will need to update it in your app settings. Continue?',
      confirmText: 'Reset',
      destructive: true,
      onConfirm: async () => {
        setDialog(prev => ({ ...prev, visible: false }));
        try {
          setResettingToken(true);
          const result = await apiService.resetSyncCode();
          // Store the new sync code for persistence
          await apiService.setSyncCode(result.sync_code);
          setApiToken(result.sync_code);
          setToast({ visible: true, message: `New sync code: ${result.sync_code}`, type: 'success' });
        } catch {
          setToast({ visible: true, message: 'Failed to reset sync code', type: 'error' });
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

        {/* Sync Code */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusTitleRow}>
              <Ionicons name="sync" size={18} color={colors.primary} style={{ marginRight: 8 }} />
              <Text style={styles.statusTitle}>Sync Code</Text>
            </View>
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
          
          <View style={styles.otpContainer}>
            {otpValues.map((value, index) => (
              <TextInput
                key={index}
                ref={(ref) => { otpInputRefs.current[index] = ref; }}
                style={[styles.otpInput, value && styles.otpInputFilled]}
                value={value}
                onChangeText={(text) => handleOtpChange(text, index)}
                onKeyPress={(e) => handleOtpKeyPress(e, index)}
                keyboardType="default"
                autoCapitalize="characters"
                maxLength={1}
                placeholderTextColor={colors.textMuted}
              />
            ))}
          </View>

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
            subtitle="Burner account for downloading"
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
            title="Reset Sync Code"
            subtitle="Generate a new sync code"
            onPress={handleResetSyncCode}
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

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Home')}>
          <Ionicons name="home" size={24} color={colors.textMuted} />
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Library')}>
          <Ionicons name="library" size={24} color={colors.textMuted} />
          <Text style={styles.navLabel}>Library</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItemActive} onPress={() => navigation.navigate('Settings')}>
          <Ionicons name="settings" size={24} color={colors.primary} />
          <Text style={styles.navLabelActive}>Settings</Text>
        </TouchableOpacity>
      </View>

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
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  otpInput: {
    width: 36,
    height: 44,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  otpInputFilled: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}10`,
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
    paddingVertical: 8,
  },
  navItemActive: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  navLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  navLabelActive: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 4,
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
