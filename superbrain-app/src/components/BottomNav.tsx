import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
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

const TAB_ICON_SIZE = 24;

const tabs: { route: TabName; icon: keyof typeof Ionicons.glyphMap; iconOutline: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { route: 'Home', icon: 'home', iconOutline: 'home-outline', label: 'Home' },
  { route: 'Library', icon: 'library', iconOutline: 'library-outline', label: 'Library' },
  { route: 'Settings', icon: 'settings', iconOutline: 'settings-outline', label: 'Settings' },
];

const TabButton: React.FC<{
  tab: typeof tabs[0];
  isActive: boolean;
  onPress: () => void;
}> = ({ tab, isActive, onPress }) => {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.85,
      friction: 5,
      tension: 300,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 200,
      useNativeDriver: true,
    }).start();
  };

  return (
    <TouchableOpacity
      style={styles.navItem}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
    >
      <Animated.View style={[styles.navItemInner, { transform: [{ scale }] }]}>
        {isActive && <View style={styles.activeIndicator} />}
        <Ionicons
          name={isActive ? tab.icon : tab.iconOutline}
          size={TAB_ICON_SIZE}
          color={isActive ? colors.primary : colors.textMuted}
        />
        <Text style={isActive ? styles.navLabelActive : styles.navLabel}>
          {tab.label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

const BottomNav: React.FC<BottomNavProps> = ({ activeTab }) => {
  const navigation = useNavigation<NavigationProp>();
  const bottomPadding = Platform.OS === 'ios' ? 28 : 20;

  return (
    <View style={[styles.bottomNav, { paddingBottom: bottomPadding }]}>
      <View style={styles.topBorder} />
      {tabs.map((tab) => (
        <TabButton
          key={tab.route}
          tab={tab}
          isActive={tab.route === activeTab}
          onPress={() => navigation.navigate(tab.route)}
        />
      ))}
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
    paddingTop: 10,
  },
  topBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navItemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  activeIndicator: {
    position: 'absolute',
    top: -10,
    width: 20,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.primary,
  },
  navLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  navLabelActive: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: 0.1,
  },
});

export default BottomNav;
