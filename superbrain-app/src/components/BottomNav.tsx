import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { colors } from '../theme/colors';

type TabName = 'Home' | 'Library' | 'Settings';
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface BottomNavProps {
  activeTab: TabName;
}

const TAB_ICON_SIZE = 22;

const tabs: { route: TabName; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { route: 'Home', icon: 'home', label: 'Home' },
  { route: 'Library', icon: 'library', label: 'Library' },
  { route: 'Settings', icon: 'settings', label: 'Settings' },
];

const BottomNav: React.FC<BottomNavProps> = ({ activeTab }) => {
  const navigation = useNavigation<NavigationProp>();

  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const isActive = tab.route === activeTab;
        return (
          <TouchableOpacity
            key={tab.route}
            style={styles.navItem}
            onPress={() => navigation.navigate(tab.route)}
          >
            <Ionicons
              name={tab.icon}
              size={TAB_ICON_SIZE}
              color={isActive ? colors.primary : colors.textMuted}
            />
            <Text style={isActive ? styles.navLabelActive : styles.navLabel}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
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
});

export default BottomNav;
