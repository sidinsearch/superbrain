import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Linking,
} from 'react-native';
import { colors } from '../theme/colors';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import apiService from '../services/api';
import CustomToast from '../components/CustomToast';
import { RootStackParamList } from '../../App';
import { QueueStatus } from '../types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const SettingsScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [apiToken, setApiToken] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected');
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [flushingRetry, setFlushingRetry] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      await apiService.initialize();
      const token = await apiService.getApiToken();
      const url = await apiService.getBaseUrl();
      setApiToken(token || '');
      setApiUrl(url);
      
      // Test connection if token exists
      if (token) {
        testConnection();
        // Load queue status in background
        apiService.getQueueStatus().then(s => setQueueStatus(s)).catch(() => {});
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    try {
      setTesting(true);
      setConnectionStatus('testing');
      const isConnected = await apiService.testConnection();
      setConnectionStatus(isConnected ? 'connected' : 'disconnected');
      return isConnected;
    } catch (error) {
      setConnectionStatus('disconnected');
      return false;
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!apiToken.trim()) {
      setToast({ visible: true, message: 'Please enter an API token', type: 'warning' });
      return;
    }

    try {
      setLoading(true);
      await apiService.setApiToken(apiToken.trim());
      await apiService.setApiUrl(apiUrl.trim() || 'http://192.168.137.1:5000');
      
      // Test connection
      const connected = await testConnection();
      
      if (connected) {
        // Refresh queue status
        apiService.getQueueStatus().then(s => setQueueStatus(s)).catch(() => {});
        setToast({ visible: true, message: 'Configuration saved and connected!', type: 'success' });
      } else {
        setToast({ visible: true, message: 'Saved but could not connect to server', type: 'warning' });
      }
    } catch (error) {
      setToast({ visible: true, message: 'Failed to save settings', type: 'error' });
      console.error('Save error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return colors.success;
      case 'testing': return colors.warning;
      case 'disconnected': return colors.error;
      default: return colors.textMuted;
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return '✓ Connected';
      case 'testing': return '⟳ Testing...';
      case 'disconnected': return '✕ Disconnected';
      default: return '⚠ Unknown';
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
          ? `↩ Moved ${result.flushed} item(s) back to queue`
          : '✔ No retry items ready yet',
        type: result.flushed > 0 ? 'success' : 'info',
      });
    } catch {
      setToast({ visible: true, message: 'Failed to flush retry queue', type: 'error' });
    } finally {
      setFlushingRetry(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        <Text style={styles.headerSubtitle}>Configure your API connection</Text>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Connection Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Connection Status</Text>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + '20' }]}>
              <Text style={[styles.statusText, { color: getStatusColor() }]}>
                {getStatusText()}
              </Text>
            </View>
          </View>
          
          <TouchableOpacity
            style={styles.testButton}
            onPress={testConnection}
            disabled={testing || !apiToken}
          >
            <Text style={styles.testButtonText}>
              {testing ? 'Testing...' : 'Test Connection'}
            </Text>
          </TouchableOpacity>

          {/* Live processing/queue status */}
          {queueStatus !== null && (queueStatus.processing_count > 0 || queueStatus.queue_count > 0) && (
            <View style={{ marginTop: 12, padding: 10, backgroundColor: colors.warning + '18', borderRadius: 8 }}>
              <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '600' }}>
                {queueStatus.processing_count > 0
                  ? `⚙️ Analyzing ${queueStatus.processing_count} post${queueStatus.processing_count > 1 ? 's' : ''}…`
                  : ''}
                {queueStatus.queue_count > 0
                  ? `${queueStatus.processing_count > 0 ? '  ' : ''}⏳ ${queueStatus.queue_count} post${queueStatus.queue_count > 1 ? 's' : ''} waiting in queue`
                  : ''}
              </Text>
            </View>
          )}
        </View>

        {/* API Configuration */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>API Configuration</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>API Token</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your API token"
              placeholderTextColor={colors.textMuted}
              value={apiToken}
              onChangeText={setApiToken}
              autoCapitalize="none"
              secureTextEntry
            />
            <Text style={styles.inputHint}>
              Get your API token from the backend server logs
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Server URL</Text>
            <TextInput
              style={styles.input}
              placeholder="http://192.168.137.1:5000"
              placeholderTextColor={colors.textMuted}
              value={apiUrl}
              onChangeText={setApiUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
            <Text style={styles.inputHint}>
              Default: http://192.168.137.1:5000 (laptop hotspot)
            </Text>
          </View>

          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Configuration</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Retry Queue — only shown when there are stuck items */}
        {queueStatus !== null && (queueStatus.retry_count ?? 0) > 0 && (
          <View style={styles.retryCard}>
            <View style={styles.retryHeader}>
              <Text style={styles.sectionTitle}>⏰ Retry Queue</Text>
              <View style={styles.retryBadge}>
                <Text style={styles.retryBadgeText}>{queueStatus.retry_count} pending</Text>
              </View>
            </View>
            <Text style={styles.retryInfo}>
              These posts hit an API quota limit and will auto-retry. Tap below to retry immediately.
            </Text>
            <TouchableOpacity
              style={[styles.testButton, flushingRetry && { opacity: 0.6 }]}
              onPress={handleFlushRetry}
              disabled={flushingRetry}
            >
              <Text style={styles.testButtonText}>
                {flushingRetry ? 'Flushing...' : 'Retry Now (flush ready items)'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Information */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>ℹ️ How to get your API token</Text>
          <Text style={styles.infoText}>
            1. Start the backend server{'\n'}
            2. Check the console logs for "API Token"{'\n'}
            3. Copy the token and paste it above{'\n'}
            4. Click "Test Connection" to verify
          </Text>
        </View>

        {/* App Info */}
        <View style={styles.appInfo}>
          <Text style={styles.appInfoTitle}>SuperBrain</Text>
          <View style={styles.appInfoCreditRow}>
            <Text style={styles.appInfoCreditText}>made with ❤️ by </Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://github.com/sidinsearch')}>
              <Text style={styles.appInfoCreditLink}>sidinsearch</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Home')}>
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconText}>🏠</Text>
          </View>
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Library')}>
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconText}>📚</Text>
          </View>
          <Text style={styles.navLabel}>Library</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItemActive} onPress={() => navigation.navigate('Settings')}>
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconTextActive}>⚙️</Text>
          </View>
          <Text style={styles.navLabelActive}>Settings</Text>
        </TouchableOpacity>
      </View>

      <CustomToast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast({ ...toast, visible: false })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
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
    flex: 1,
  },
  contentContainer: {
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
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  testButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  testButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  inputHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoCard: {
    backgroundColor: colors.backgroundCard,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  retryCard: {
    backgroundColor: colors.backgroundCard,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  retryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  retryBadge: {
    backgroundColor: 'rgba(255,165,0,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  retryBadgeText: {
    color: '#FFA500',
    fontSize: 13,
    fontWeight: '600',
  },
  retryInfo: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: 14,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  appInfoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 1,
  },
  appInfoCreditRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appInfoCreditText: {
    fontSize: 13,
    color: colors.text,
  },
  appInfoCreditLink: {
    fontSize: 13,
    color: colors.primary,
  },
  appInfoText: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
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
});

export default SettingsScreen;
