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
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { RootStackParamList } from '../../App';
import collectionsService from '../services/collections';
import { Collection } from '../types';
import CustomToast from '../components/CustomToast';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const EMOJI_ICONS = ['📁', '✈️', '🍔', '👕', '💪', '📚', '🎬', '📸', '⭐', '❤️', '🔥', '🎯'];

const LibraryScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const createInputRef = useRef<TextInput>(null);
  const editInputRef = useRef<TextInput>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('📁');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [collectionToEdit, setCollectionToEdit] = useState<Collection | null>(null);
  const [editCollectionName, setEditCollectionName] = useState('');
  const [editSelectedIcon, setEditSelectedIcon] = useState('📁');
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'warning' | 'info' });

  useEffect(() => {
    loadCollections();
  }, []);

  useEffect(() => {
    if (showCreateModal) {
      const focusInput = () => {
        setTimeout(() => {
          createInputRef.current?.focus();
          // Try again after a bit more delay
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

    try {
      await collectionsService.createCollection(newCollectionName.trim(), selectedIcon);
      setNewCollectionName('');
      setSelectedIcon('📁');
      setShowCreateModal(false);
      loadCollections();
      setToast({ visible: true, message: 'Collection created successfully', type: 'success' });
    } catch (error) {
      setToast({ visible: true, message: 'Failed to create collection', type: 'error' });
    }
  };

  const handleEditCollection = (collection: Collection) => {
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCollectionToDelete(collection);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (collectionToDelete) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchIconContainer}>
          <Text style={styles.searchIconText}>🔍</Text>
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
            <Text style={styles.clearIcon}>✕</Text>
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
              <Text style={styles.emptyIcon}>📁</Text>
              <Text style={styles.emptyTitle}>No Collections Yet</Text>
              <Text style={styles.emptyText}>
                Create collections to organize your saved posts
              </Text>
            </View>
          ) : (
            <View style={styles.collectionsGrid}>
              {filteredCollections.map((collection) => (
                <View key={collection.id} style={styles.collectionWrapper}>
                  <TouchableOpacity
                    style={styles.collectionCard}
                    onPress={() => navigation.navigate('CollectionDetail', { collection })}
                    onLongPress={() => handleDeleteCollection(collection)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.collectionIconContainer}>
                      <Text style={styles.collectionIcon}>{collection.icon}</Text>
                    </View>
                    <Text style={styles.collectionName} numberOfLines={1}>
                      {collection.name}
                    </Text>
                    <Text style={styles.collectionCount}>
                      {collection.postIds.length} {collection.postIds.length === 1 ? 'post' : 'posts'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => handleEditCollection(collection)}
                  >
                    <Text style={styles.editIcon}>✏️</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowCreateModal(true)}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Home')}>
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconText}>🏠</Text>
          </View>
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItemActive} onPress={() => navigation.navigate('Library')}>
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconTextActive}>📚</Text>
          </View>
          <Text style={styles.navLabelActive}>Library</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Settings')}>
          <View style={styles.navIconContainer}>
            <Text style={styles.navIconText}>⚙️</Text>
          </View>
          <Text style={styles.navLabel}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* Create Collection Modal */}
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
                <Text style={styles.modalCloseIcon}>✕</Text>
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
              {EMOJI_ICONS.map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconOption,
                    selectedIcon === icon && styles.iconOptionActive,
                  ]}
                  onPress={() => setSelectedIcon(icon)}
                >
                  <Text style={styles.iconOptionText}>{icon}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => {
                  setShowCreateModal(false);
                  setNewCollectionName('');
                  setSelectedIcon('📁');
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

      {/* Edit Collection Modal */}
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
                <Text style={styles.modalCloseIcon}>✕</Text>
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
              {EMOJI_ICONS.map((icon) => (
                <TouchableOpacity
                  key={icon}
                  style={[
                    styles.iconOption,
                    editSelectedIcon === icon && styles.iconOptionActive,
                  ]}
                  onPress={() => setEditSelectedIcon(icon)}
                >
                  <Text style={styles.iconOptionText}>{icon}</Text>
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

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <View style={styles.deleteIconContainer}>
              <Text style={styles.deleteIcon}>🗑️</Text>
            </View>
            <Text style={styles.deleteTitle}>Delete Collection?</Text>
            <Text style={styles.deleteMessage}>
              Are you sure you want to delete "{collectionToDelete?.name}"? This will not delete the posts.
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
  searchIconText: {
    fontSize: 18,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
  },
  clearButton: {
    padding: 4,
  },
  clearIcon: {
    fontSize: 18,
    color: colors.textMuted,
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
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
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
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
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
  editIcon: {
    fontSize: 16,
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
  collectionIcon: {
    fontSize: 32,
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
    right: 20,
    bottom: 100,
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
  fabIcon: {
    fontSize: 32,
    color: '#fff',
    fontWeight: '300',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
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
  modalCloseIcon: {
    fontSize: 24,
    color: colors.textMuted,
    padding: 4,
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
  deleteIcon: {
    fontSize: 40,
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
  iconOptionText: {
    fontSize: 24,
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
  },  modalButtonDelete: {
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
  },});

export default LibraryScreen;
