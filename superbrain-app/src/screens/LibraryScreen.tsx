import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Modal,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
  Keyboard,
  Dimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { rescheduleWatchLaterNotification } from '../services/notificationService';
import { RootStackParamList } from '../../App';
import { collectionsService } from '../services/collections';
import postsCache from '../services/postsCache';
import { Collection, FailedPost } from '../types';
import CustomToast from '../components/CustomToast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width: screenWidth } = Dimensions.get('window');

const ICON_OPTIONS = [
  'folder',
  'airplane',
  'restaurant',
  'shirt',
  'fitness',
  'book',
  'film',
  'camera',
  'star',
  'heart',
  'flame',
  'pin',
];

const ICON_COLORS: Record<string, string> = {
  'folder': colors.primary, // Default indigo
  'airplane': '#0ea5e9', // Sky blue for travel
  'restaurant': '#ef4444', // Red for food
  'shirt': '#ec4899', // Pink for fashion
  'fitness': '#10b981', // Emerald green for health
  'book': '#b45309', // Brown/amber for books
  'film': '#8b5cf6', // Violet for entertainment
  'camera': '#06b6d4', // Cyan for photos
  'star': '#eab308', // Yellow for favorites
  'heart': '#f43f5e', // Rose red for likes
  'flame': '#f97316', // Orange for hot/trending
  'pin': '#3b82f6', // Blue for locations
  'time': '#64748b', // Slate gray for history/time
};

const LibraryScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const createInputRef = useRef<TextInput>(null);
  const editInputRef = useRef<TextInput>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('folder');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [collectionToEdit, setCollectionToEdit] = useState<Collection | null>(null);
  const [editCollectionName, setEditCollectionName] = useState('');
  const [editSelectedIcon, setEditSelectedIcon] = useState('folder');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());
  const [showLibraryTips, setShowLibraryTips] = useState(false);
  const [failedPosts, setFailedPosts] = useState<FailedPost[]>([]);

  useEffect(() => {
    loadCollections();
    checkLibraryTips();
    
    const unsubscribe = navigation.addListener('focus', () => {
      loadCollections();
    });
    
    return unsubscribe;
  }, [navigation]);

  const checkLibraryTips = async () => {
    const seen = await AsyncStorage.getItem('@superbrain_library_tips_seen');
    if (seen) return;
    const existingPosts = await AsyncStorage.getItem('@superbrain_posts_cache');
    const existingCollections = await AsyncStorage.getItem('@superbrain_collections');
    if (existingPosts || existingCollections) {
      await AsyncStorage.setItem('@superbrain_library_tips_seen', '1');
      return;
    }
    setShowLibraryTips(true);
  };

  const dismissLibraryTips = async () => {
    await AsyncStorage.setItem('@superbrain_library_tips_seen', '1');
    setShowLibraryTips(false);
  };

  useEffect(() => {
    if (showCreateModal) {
      const focusInput = () => {
        setTimeout(() => {
          createInputRef.current?.focus();
          setTimeout(() => {
            createInputRef.current?.focus();
          }, 200);
        }, 500);
      };
      focusInput();
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (showEditModal) {
      const focusInput = () => {
        setTimeout(() => {
          editInputRef.current?.focus();
          setTimeout(() => {
            editInputRef.current?.focus();
          }, 200);
        }, 500);
      };
      focusInput();
    }
  }, [showEditModal]);

  const loadCollections = async () => {
    try {
      setLoading(true);
      const data = await collectionsService.getCollections();
      setCollections(data);
      const watchLater = data.find(c => c.id === 'default_watch_later');
      if (watchLater && watchLater.postIds.length > 0) {
        rescheduleWatchLaterNotification().catch(() => {});
      }
      const failed = await postsCache.getFailedPosts();
      setFailedPosts(failed);
    } catch (error) {
      console.error('Error loading collections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) {
      setToast({ visible: true, message: 'Please enter a collection name', type: 'warning' });
      return;
    }

    const trimmedName = newCollectionName.trim().toLowerCase();
    const duplicate = collections.find(
      c => c.name.trim().toLowerCase() === trimmedName && c.icon === selectedIcon,
    );
    if (duplicate) {
      setToast({ visible: true, message: 'A collection with this name and icon already exists', type: 'warning' });
      return;
    }

    try {
      await collectionsService.createCollection(newCollectionName.trim(), selectedIcon);
      setNewCollectionName('');
      setSelectedIcon('folder');
      setShowCreateModal(false);
      loadCollections();
      setToast({ visible: true, message: 'Collection created successfully', type: 'success' });
    } catch (error) {
      setToast({ visible: true, message: 'Failed to create collection', type: 'error' });
    }
  };

  const handleEditCollection = (collection: Collection) => {
    if (collection.id === 'default_watch_later') {
      setToast({ visible: true, message: 'Watch Later is a default collection and cannot be edited', type: 'warning' });
      return;
    }
    setCollectionToEdit(collection);
    setEditCollectionName(collection.name);
    setEditSelectedIcon(collection.icon);
    setShowEditModal(true);
  };

  const handleUpdateCollection = async () => {
    if (!editCollectionName.trim()) {
      setToast({ visible: true, message: 'Please enter a collection name', type: 'warning' });
      return;
    }

    if (collectionToEdit) {
      try {
        await collectionsService.updateCollection(collectionToEdit.id, {
          name: editCollectionName.trim(),
          icon: editSelectedIcon,
        });
        setShowEditModal(false);
        setCollectionToEdit(null);
        loadCollections();
        setToast({ visible: true, message: 'Collection updated successfully', type: 'success' });
      } catch (error) {
        setToast({ visible: true, message: 'Failed to update collection', type: 'error' });
      }
    }
  };

  const handleDeleteCollection = (collection: Collection) => {
    if (collection.id === 'default_watch_later') {
      setToast({ visible: true, message: 'Watch Later is a default collection and cannot be deleted', type: 'warning' });
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCollectionToDelete(collection);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    if (selectionMode && selectedCollections.size > 0) {
      for (const collectionId of Array.from(selectedCollections)) {
        if (collectionId === 'default_watch_later') continue;
        await collectionsService.deleteCollection(collectionId);
      }
      setShowDeleteModal(false);
      setSelectionMode(false);
      setSelectedCollections(new Set());
      loadCollections();
      setToast({ 
        visible: true, 
        message: `${selectedCollections.size} collection(s) deleted`, 
        type: 'success' 
      });
    } else if (collectionToDelete) {
      await collectionsService.deleteCollection(collectionToDelete.id);
      setShowDeleteModal(false);
      setCollectionToDelete(null);
      loadCollections();
      setToast({ visible: true, message: 'Collection deleted', type: 'success' });
    }
  };

  const filteredCollections = collections.filter(col =>
    searchQuery === '' || col.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        <Text style={styles.headerSubtitle}>
          {collections.length} collections
        </Text>
        {selectionMode && (
          <View style={styles.selectionButtonsContainer}>
            <TouchableOpacity 
              style={styles.cancelButton}
              onPress={() => {
                setSelectionMode(false);
                setSelectedCollections(new Set());
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.deleteButton, selectedCollections.size === 0 && styles.deleteButtonDisabled]}
              onPress={() => selectedCollections.size > 0 && setShowDeleteModal(true)}
              disabled={selectedCollections.size === 0}
            >
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchIconContainer}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder="Search collections..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery !== '' && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading collections...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.collectionsContainer}
          contentContainerStyle={styles.collectionsContent}
        >
          {filteredCollections.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={[styles.collectionIconContainer, { backgroundColor: 'rgba(107, 114, 128, 0.1)' }]}>
                <Ionicons name="folder-open-outline" size={48} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No Collections Yet</Text>
              <Text style={styles.emptyText}>
                Create collections to organize your saved posts
              </Text>
            </View>
          ) : (
            <View style={styles.collectionsGrid}>
              {failedPosts.length > 0 && (
                <View style={styles.collectionWrapper}>
                  <TouchableOpacity
                    style={[styles.collectionCard, styles.failedCollectionCard]}
                    onPress={() => navigation.navigate('FailedAnalysis')}
                    activeOpacity={0.8}
                  >
                    <View style={styles.collectionIconContainer}>
                      <Ionicons name="warning" size={32} color={colors.error} />
                    </View>
                    <Text style={[styles.collectionName, { color: colors.error }]} numberOfLines={1}>
                      Failed Analysis
                    </Text>
                    <Text style={styles.collectionCount}>
                      {failedPosts.length} {failedPosts.length === 1 ? 'post' : 'posts'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {filteredCollections.map((collection) => {
                const isSelected = selectedCollections.has(collection.id);
                return (
                <View key={collection.id} style={styles.collectionWrapper}>
                  <TouchableOpacity
                    style={[
                      styles.collectionCard,
                      isSelected && styles.collectionCardSelected
                    ]}
                    onPress={() => {
                      if (selectionMode) {
                        const newSelected = new Set(selectedCollections);
                        if (isSelected) {
                          newSelected.delete(collection.id);
                        } else {
                          newSelected.add(collection.id);
                        }
                        setSelectedCollections(newSelected);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      } else {
                        navigation.navigate('CollectionDetail', { collection });
                      }
                    }}
                    onLongPress={() => {
                      if (!selectionMode && collection.id !== 'default_watch_later') {
                        setSelectionMode(true);
                        setSelectedCollections(new Set([collection.id]));
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    {selectionMode && (
                      <View style={styles.checkboxContainer}>
                        <View style={[
                          styles.checkbox,
                          isSelected && styles.checkboxSelected
                        ]}>
                          {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </View>
                      </View>
                    )}
                    <View style={styles.collectionIconContainer}>
                      <Ionicons 
                        name={collection.icon as any} 
                        size={32} 
                        color={ICON_COLORS[collection.icon] || colors.primary} 
                      />
                    </View>
                    <Text style={styles.collectionName} numberOfLines={1}>
                      {collection.name}
                    </Text>
                    <Text style={styles.collectionCount}>
                      {collection.postIds.length} {collection.postIds.length === 1 ? 'post' : 'posts'}
                    </Text>
                  </TouchableOpacity>
                  {!selectionMode && collection.id !== 'default_watch_later' && (
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => handleEditCollection(collection)}
                  >
                    <Ionicons name="pencil" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  )}
                </View>
              );})}
            </View>
          )}
        </ScrollView>
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowCreateModal(true)}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </TouchableOpacity>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Home')}>
          <Ionicons name="home" size={24} color={colors.textMuted} />
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItemActive} onPress={() => navigation.navigate('Library')}>
          <Ionicons name="library" size={24} color={colors.primary} />
          <Text style={styles.navLabelActive}>Library</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Settings')}>
          <Ionicons name="settings" size={24} color={colors.textMuted} />
          <Text style={styles.navLabel}>Settings</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => {}}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
        >
          <TouchableOpacity 
            activeOpacity={1}
            style={{ justifyContent: 'center', paddingHorizontal: 20, flex: 1 }}
          >
            <View style={[styles.modalContent, { marginBottom: 140 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Collection</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Collection Name</Text>
            <TextInput
              ref={createInputRef}
              style={styles.modalInput}
              placeholder="e.g., Travel, Recipes, Inspiration"
              placeholderTextColor={colors.textMuted}
              value={newCollectionName}
              onChangeText={setNewCollectionName}
            />

            <Text style={styles.inputLabel}>Choose Icon</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.iconsScroll}
              contentContainerStyle={styles.iconsContent}
              keyboardShouldPersistTaps="always"
            >
              {ICON_OPTIONS.map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconOption,
                    selectedIcon === icon && styles.iconOptionActive,
                  ]}
                  onPress={() => setSelectedIcon(icon)}
                >
                  <Ionicons
                    name={icon as any}
                    size={24}
                    color={selectedIcon === icon ? (ICON_COLORS[icon] || colors.primary) : (ICON_COLORS[icon] || colors.textMuted)}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => {
                  setShowCreateModal(false);
                  setNewCollectionName('');
                  setSelectedIcon('folder');
                }}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonCreate}
                onPress={handleCreateCollection}
              >
                <Text style={styles.modalButtonCreateText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showEditModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowEditModal(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
        >
          <TouchableOpacity 
            activeOpacity={1}
            style={{ justifyContent: 'center', paddingHorizontal: 20, flex: 1 }}
          >
            <View style={[styles.modalContent, { marginBottom: 140 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Collection</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Collection Name</Text>
            <TextInput
              ref={editInputRef}
              style={styles.modalInput}
              placeholder="Enter collection name"
              placeholderTextColor={colors.textMuted}
              value={editCollectionName}
              onChangeText={setEditCollectionName}
            />

            <Text style={styles.inputLabel}>Choose Icon</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.iconsScroll}
              contentContainerStyle={styles.iconsContent}
              keyboardShouldPersistTaps="always"
            >
              {ICON_OPTIONS.map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconOption,
                    editSelectedIcon === icon && styles.iconOptionActive,
                  ]}
                  onPress={() => setEditSelectedIcon(icon)}
                >
                  <Ionicons
                    name={icon as any}
                    size={24}
                    color={editSelectedIcon === icon ? '#fff' : colors.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonCreate}
                onPress={handleUpdateCollection}
              >
                <Text style={styles.modalButtonCreateText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <View style={styles.deleteIconContainer}>
              <Ionicons name="trash" size={40} color={colors.error} />
            </View>
            <Text style={styles.deleteTitle}>Delete Collection?</Text>
            <Text style={styles.deleteMessage}>
              {selectionMode && selectedCollections.size > 0
                ? `Are you sure you want to delete ${selectedCollections.size} collection(s)? This will not delete the posts.`
                : `Are you sure you want to delete "${collectionToDelete?.name}"? This will not delete the posts.`
              }
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowDeleteModal(false)}
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

      <Modal visible={showLibraryTips} transparent animationType="fade" onRequestClose={dismissLibraryTips}>
        <View style={styles.tipsOverlay}>
          <View style={styles.tipsCard}>
            <View style={styles.tipsHeader}>
              <Text style={styles.tipsHeaderLabel}>YOUR LIBRARY</Text>
            </View>
            <View style={styles.tipsBody}>
              <View style={styles.tipRow}>
                <View style={styles.tipIconWrap}>
                  <Ionicons name="time" size={22} color={colors.primary} />
                </View>
                <View style={styles.tipTextWrap}>
                  <Text style={styles.tipTitle}>Watch Later</Text>
                  <Text style={styles.tipDesc}>Everything you save lands here first. Get a daily notification reminder for each post.</Text>
                </View>
              </View>
              <View style={styles.tipRow}>
                <View style={styles.tipIconWrap}>
                  <Ionicons name="notifications" size={22} color={colors.primary} />
                </View>
                <View style={styles.tipTextWrap}>
                  <Text style={styles.tipTitle}>Notifications</Text>
                  <Text style={styles.tipDesc}>Each saved post gets a daily reminder at its own fixed time. Tap "Mark as Watched" on a post to silence it.</Text>
                </View>
              </View>
              <View style={styles.tipRow}>
                <View style={styles.tipIconWrap}>
                  <Ionicons name="folder" size={22} color={colors.primary} />
                </View>
                <View style={styles.tipTextWrap}>
                  <Text style={styles.tipTitle}>Collections</Text>
                  <Text style={styles.tipDesc}>Organise your saves into custom collections — travel, recipes, workouts, anything you like.</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.tipsDismiss} onPress={dismissLibraryTips}>
              <Text style={styles.tipsDismissText}>Got it!</Text>
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
  selectionButtonsContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.backgroundCard,
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.error,
  },
  deleteButtonDisabled: {
    backgroundColor: colors.error + '40',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundCard,
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIconContainer: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
  },
  clearButton: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textMuted,
  },
  collectionsContainer: {
    flex: 1,
  },
  collectionsContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 100,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  collectionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  collectionWrapper: {
    width: '48%',
    marginBottom: 16,
    position: 'relative',
  },
  collectionCard: {
    width: '100%',
    backgroundColor: colors.backgroundCard,
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  collectionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  checkboxContainer: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  editButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 1,
  },
  collectionIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  collectionName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  collectionCount: {
    fontSize: 13,
    color: colors.textMuted,
  },
  fab: {
    position: 'absolute',
    right: Math.max(0, screenWidth / 6 - 28),
    bottom: 96,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  deleteModalContent: {
    backgroundColor: colors.background,
    borderRadius: 24,
    padding: 24,
    marginHorizontal: 20,
    alignItems: 'center',
    maxWidth: 400,
    width: '90%',
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
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 24,
  },
  iconsScroll: {
    maxHeight: 60,
    marginBottom: 24,
  },
  iconsContent: {
    paddingVertical: 4,
  },
  iconOption: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
  },
  iconOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '20',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButtonCancel: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalButtonCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalButtonCreate: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalButtonCreateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
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
  tipsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  tipsCard: {
    width: '100%',
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipsHeader: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tipsHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 3,
  },
  tipsBody: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
    gap: 16,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  tipIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipTextWrap: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 3,
  },
  tipDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  tipsDismiss: {
    marginHorizontal: 24,
    marginTop: 20,
    marginBottom: 24,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tipsDismissText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  failedCollectionCard: {
    borderColor: colors.error + '55',
    borderWidth: 1.5,
  },
});

export default LibraryScreen;
