import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import apiService from '../services/api';
import CustomToast from '../components/CustomToast';
import { RootStackParamList } from '../../App';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const DataImportExportScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' as 'success' | 'error' | 'warning' | 'info' });
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  const loadStats = async () => {
    try {
      const s = await apiService.getStats();
      setStats(s);
    } catch (e) {
      console.error('Error loading stats:', e);
    }
  };

  React.useEffect(() => {
    loadStats();
  }, []);

  const handleExport = async (format: 'json' | 'zip') => {
    try {
      setExporting(true);

      const reachable = await apiService.testConnection();
      if (!reachable) {
        setToast({
          visible: true,
          message: 'Backend is not connected. Check server URL and Access Token in Settings.',
          type: 'error',
        });
        return;
      }

      const baseUrl = await apiService.getBaseUrl();
      const token = await apiService.getApiToken();
      
      // Use timestamp with time to ensure unique filename each export
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = format === 'zip' 
        ? `superbrain_export_${timestamp}.zip`
        : `superbrain_export_${timestamp}.json`;
      const destinationFile = new File(Paths.cache, filename);
      
      const downloadedFile = await File.downloadFileAsync(
        `${baseUrl}/export?format=${format}`,
        destinationFile,
        { headers: { 'X-API-Key': token || '' } }
      );
      
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(downloadedFile.uri, {
          mimeType: format === 'zip' ? 'application/zip' : 'application/json',
          dialogTitle: 'Export SuperBrain Data',
        });
        setToast({ 
          visible: true, 
          message: `Export downloaded: ${filename}`, 
          type: 'success' 
        });
      } else {
        setToast({ 
          visible: true, 
          message: `Export saved: ${downloadedFile.uri}`, 
          type: 'success' 
        });
      }
    } catch (error: any) {
      console.error('Export error:', error);
      const status = error?.response?.status;
      if (status === 401) {
        setToast({ visible: true, message: 'Invalid Access Token. Reconnect in Settings.', type: 'error' });
      } else if (status === 0 || error?.message?.toLowerCase?.().includes('network')) {
        setToast({ visible: true, message: 'Cannot reach backend. Ensure server is running and URL is correct.', type: 'error' });
      } else {
        setToast({ visible: true, message: error.message || 'Export failed', type: 'error' });
      }
    } finally {
      setExporting(false);
    }
  };

  const handleSelectImportFile = () => {
    setShowImportDialog(true);
  };

  const handleImport = async (mode: 'merge' | 'replace') => {
    setShowImportDialog(false);
    
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/zip',
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const file = result.assets[0];
      
      // Check if it's a ZIP file
      if (!file.name.toLowerCase().endsWith('.zip')) {
        setToast({ visible: true, message: 'Please select a ZIP file', type: 'error' });
        return;
      }

      // Check if it looks like a SuperBrain export (has superbrain_export in name or contains the right structure)
      // For now, we accept any ZIP and let the server validate
      setImporting(true);
      
      // Use the file directly - the expo-file-system File is compatible with the API
      const importFile = new File(file.uri, file.name) as any;
      
      const importResult = await apiService.importData(importFile, mode);
      
      setToast({ 
        visible: true, 
        message: `Import complete: ${importResult.imported_posts} posts imported`, 
        type: 'success' 
      });
      
      // Refresh stats
      loadStats();
       
    } catch (error: any) {
      console.error('Import error:', error);
      setToast({ visible: true, message: error.message || 'Import failed', type: 'error' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Data Import/Export</Text>
        </View>

        <Text style={styles.description}>
          Export your posts and collections or import from a backup.
        </Text>

        {/* Stats Card */}
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>Your Data</Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats?.total_posts ?? 0}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{stats?.total_collections ?? 0}</Text>
              <Text style={styles.statLabel}>Collections</Text>
            </View>
          </View>
        </View>

        {/* Export Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="download-outline" size={20} color={colors.text} /> Export
          </Text>
           
          <Text style={styles.sectionDescription}>
            Download all your posts and collections as a ZIP file.
          </Text>
           
          <TouchableOpacity
            style={[styles.exportButton, exporting && { opacity: 0.7 }]}
            onPress={() => handleExport('zip')}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Ionicons name="archive-outline" size={28} color={colors.primary} />
                <Text style={styles.exportButtonText}>Export ZIP</Text>
                <Text style={styles.exportButtonSubtext}>Backup your data</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Import Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.text} /> Import
          </Text>
          
          <Text style={styles.sectionDescription}>
            Restore from a previously exported SuperBrain ZIP file.
          </Text>
          
          <TouchableOpacity 
            style={[styles.importButton, importing && { opacity: 0.7 }]}
            onPress={handleSelectImportFile}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="folder-open-outline" size={24} color="#fff" />
                <Text style={styles.importButtonText}>Select ZIP File</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>About Export</Text>
          <Text style={styles.infoText}>
            • ZIP format is recommended for mobile devices{'\n'}
            • Includes posts, collections, and metadata{'\n'}
            • Import supports merge or replace mode{'\n'}
            • Large exports may take time to generate
          </Text>
        </View>
      </ScrollView>

      {/* Import Mode Dialog */}
      <Modal
        visible={showImportDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowImportDialog(false)}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogContent}>
            <Text style={styles.dialogTitle}>Import Data</Text>
            <Text style={styles.dialogMessage}>
              Choose how to import data from the ZIP file. Only SuperBrain export ZIP files are accepted.
            </Text>
            
            <View style={styles.dialogButtons}>
              <TouchableOpacity
                style={styles.dialogCancelButton}
                onPress={() => setShowImportDialog(false)}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity
              style={styles.dialogOptionButton}
              onPress={() => handleImport('merge')}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <View style={styles.dialogOptionContent}>
                <Text style={styles.dialogOptionTitle}>Merge</Text>
                <Text style={styles.dialogOptionSubtitle}>Add to existing data (skip duplicates)</Text>
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.dialogOptionButton}
              onPress={() => handleImport('replace')}
            >
              <Ionicons name="refresh-circle-outline" size={20} color="#dc3545" />
              <View style={styles.dialogOptionContent}>
                <Text style={[styles.dialogOptionTitle, { color: '#dc3545' }]}>Replace</Text>
                <Text style={styles.dialogOptionSubtitle}>Clear database first, then import</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 20,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 24,
    lineHeight: 20,
  },
  statsCard: {
    backgroundColor: colors.backgroundCard,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
    marginHorizontal: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  exportButton: {
    backgroundColor: colors.backgroundCard,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 8,
  },
  exportButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  exportButtonSubtext: {
    fontSize: 12,
    color: colors.textMuted,
  },
  importButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  importButtonText: {
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
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 22,
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
    marginBottom: 8,
    textAlign: 'center',
  },
  dialogMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  dialogButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  dialogCancelButton: {
    flex: 1,
    backgroundColor: colors.background,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dialogCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  dialogOptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  dialogOptionContent: {
    marginLeft: 12,
    flex: 1,
  },
  dialogOptionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  dialogOptionSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});

export default DataImportExportScreen;
