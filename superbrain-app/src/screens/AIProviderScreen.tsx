import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
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

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const AIProviderScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const [aiProviders, setAiProviders] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providerKey, setProviderKey] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('gemini');
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'success' as 'success' | 'error' | 'warning' | 'info' });

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      const providers = await apiService.getAiProviders();
      setAiProviders(providers.providers);
    } catch (e) {
      console.error('Error loading AI providers:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!providerKey.trim()) {
      setToast({ visible: true, message: 'Please enter an API key', type: 'warning' });
      return;
    }
    try {
      setSaving(true);
      await apiService.setAiProviderKey(selectedProvider, providerKey.trim());
      await loadProviders();
      setProviderKey('');
      setToast({ visible: true, message: 'Verified & saved successfully!', type: 'success' });
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || 'Failed to save or verify API key';
      setToast({ visible: true, message: errorMsg, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (provider: string) => {
    setShowDeleteModal(provider);
  };

  const confirmDelete = async () => {
    if (!showDeleteModal) return;
    const provider = showDeleteModal;
    try {
      setShowDeleteModal(null);
      await apiService.deleteAiProviderKey(provider);
      await loadProviders();
      setToast({ visible: true, message: 'API key removed', type: 'success' });
    } catch {
      setToast({ visible: true, message: 'Failed to remove API key', type: 'error' });
    }
  };

  const providerLabels: Record<string, string> = {
    groq: 'Groq',
    gemini: 'Google Gemini',
    openrouter: 'OpenRouter',
    requesty: 'Requesty',
    ollama: 'Ollama (Local)',
  };

  const providerIcons: Record<string, string> = {
    groq: 'hardware-chip-outline',
    gemini: 'sparkles-outline',
    openrouter: 'globe-outline',
    requesty: 'git-network-outline',
    ollama: 'desktop-outline',
  };

  const providerIconColors: Record<string, string> = {
    groq: '#f97316',
    gemini: '#4285f4',
    openrouter: '#8b5cf6',
    requesty: '#0ea5e9',
    ollama: '#10b981',
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
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>AI Providers</Text>
        </View>

        <Text style={styles.description}>
          Configure AI providers for analysis. At least one provider is recommended.
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Configured Providers</Text>
          
          {aiProviders && (
            <View style={styles.providerList}>
              {Object.entries(aiProviders).map(([key, value]: [string, any]) => (
                <View key={key} style={styles.providerCard}>
                  <View style={[styles.providerIcon, { backgroundColor: `${providerIconColors[key]}20` }]}>
                    <Ionicons 
                      name={providerIcons[key] as any} 
                      size={22} 
                      color={providerIconColors[key]} 
                    />
                  </View>
                  <View style={styles.providerInfo}>
                    <View style={styles.providerHeader}>
                      <Text style={styles.providerName}>{value.name}</Text>
                      <View style={[styles.statusBadge, value.has_key ? styles.statusConfigured : styles.statusNotConfigured]}>
                        <Text style={[styles.statusText, value.has_key ? styles.statusTextConfigured : styles.statusTextNotConfigured]}>
                          {value.has_key ? '✓ Configured' : 'Not configured'}
                        </Text>
                      </View>
                    </View>
                    {value.key_hint && (
                      <Text style={styles.keyHint}>{value.key_hint}</Text>
                    )}
                  </View>
                  {value.has_key && (
                    <TouchableOpacity onPress={() => handleDelete(key)} style={styles.deleteButton}>
                      <Ionicons name="trash-outline" size={20} color="#dc3545" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add API Key</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Provider</Text>
            <View style={styles.providerSelector}>
              {['groq', 'gemini', 'openrouter', 'requesty'].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.providerOption,
                    selectedProvider === p && { backgroundColor: providerIconColors[p], borderColor: providerIconColors[p] },
                    selectedProvider !== p && { borderColor: colors.border }
                  ]}
                  onPress={() => setSelectedProvider(p)}
                >
                  <Ionicons 
                    name={providerIcons[p] as any} 
                    size={20} 
                    color={selectedProvider === p ? '#fff' : providerIconColors[p]} 
                  />
                  <Text style={[
                    styles.providerOptionText, 
                    selectedProvider === p && styles.providerOptionTextActive,
                    { color: selectedProvider === p ? '#fff' : providerIconColors[p] }
                  ]}>
                    {providerLabels[p] || p.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>API Key</Text>
            <TextInput
              style={styles.textInput}
              value={providerKey}
              onChangeText={setProviderKey}
              placeholder="Enter API key..."
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
          </View>
          
          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save API Key</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Get Free API Keys</Text>
          <Text style={styles.infoText}>
            • Groq: console.groq.com{'\n'}
            • Gemini: aistudio.google.com/apikey{'\n'}
            • OpenRouter: openrouter.ai/keys{'\n'}
            • Requesty (optional, paid): app.requesty.ai/api-keys
          </Text>
        </View>
      </ScrollView>
      <Modal
        visible={!!showDeleteModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowDeleteModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <View style={styles.deleteIconContainer}>
              <Ionicons name="trash" size={40} color={colors.error} />
            </View>
            <Text style={styles.deleteTitle}>Delete API Key?</Text>
            <Text style={styles.deleteMessage}>
              Are you sure you want to remove the {providerLabels[showDeleteModal || '']} API key? This action cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowDeleteModal(null)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonDelete}
                onPress={confirmDelete}
              >
                <Text style={styles.modalButtonDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 20,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
    marginLeft: -14,
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  providerList: {
    gap: 12,
  },
  providerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  providerInfo: {
    flex: 1,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  providerName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusConfigured: {
    backgroundColor: 'rgba(40, 167, 69, 0.15)',
  },
  statusNotConfigured: {
    backgroundColor: 'rgba(108, 117, 125, 0.15)',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusTextConfigured: {
    color: '#28a745',
  },
  statusTextNotConfigured: {
    color: '#6c757d',
  },
  keyHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  deleteButton: {
    padding: 8,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 8,
  },
  providerSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  providerOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  providerOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  providerOptionText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  providerOptionTextActive: {
    color: '#fff',
  },
  textInput: {
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
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
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
  },
  deleteModalContent: {
    backgroundColor: colors.background,
    borderRadius: 24,
    padding: 24,
    marginHorizontal: 20,
    alignItems: 'center',
  },
  deleteIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.backgroundCard,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  deleteTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  deleteMessage: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButtonCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.backgroundCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalButtonDelete: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  modalButtonDeleteText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

export default AIProviderScreen;
