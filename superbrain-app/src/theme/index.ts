/**
 * Theme Configuration Module
 * Centralized theme, animations, and styling constants
 */

import { Animated, Easing } from 'react-native';

// ────────────────────────────────────────────────────────────────────────────────
// Color Palette
// ────────────────────────────────────────────────────────────────────────────────

export const colors = {
  // Background gradient
  background: '#0f1115',
  backgroundSecondary: '#1a1d24',
  backgroundCard: '#1e2229',
  backgroundTertiary: '#232935',
  backgroundElevated: '#272b35',

  // Primary Theme
  primary: '#6366f1',      // Indigo
  primaryLight: '#818cf8',
  primaryDark: '#4f46e5',
  primaryAccent: '#4c1d95', // Dark purple
  primaryGlow: 'rgba(99, 102, 241, 0.15)',

  // Secondary Theme
  accent: '#8b5cf6',       // Violet
  accentLight: '#a78bfa',
  accentDark: '#7c3aed',

  // Semantic Colors
  success: '#10b981',      // Emerald
  warning: '#f59e0b',      // Amber
  error: '#ef4444',        // Red
  info: '#3b82f6',         // Blue
  pending: '#ec4899',      // Pink

  // Text Colors
  text: '#ffffff',
  textSecondary: '#d1d5db', // Gray-300
  textMuted: '#9ca3af',     // Gray-400
  textOnPrimary: '#ffffff',

  // Border & Divider
  border: '#374151',        // Gray-700
  borderLight: '#4b5563',   // Gray-600
  divider: '#2d31399d',     // Transparent divider

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.7)',
  overlayLight: 'rgba(0, 0, 0, 0.5)',
  overlayMedium: 'rgba(0, 0, 0, 0.3)',

  // Category Colors (for tagging)
  categories: {
    product: '#f59e0b',    // Amber
    places: '#3b82f6',     // Blue
    recipe: '#ef4444',     // Red
    food: '#ef4444',       // Red (alias)
    software: '#0ea5e9',   // Sky
    book: '#b45309',       // Amber-700
    'tv shows': '#d946ef', // Fuchsia
    workout: '#14b8a6',    // Teal
    fitness: '#14b8a6',    // Teal (alias)
    film: '#8b5cf6',       // Violet
    event: '#f43f5e',      // Rose
    fashion: '#ec4899',    // Pink
    education: '#8b5cf6',  // Violet
    entertainment: '#f97316', // Orange
    pets: '#06b6d4',       // Cyan
    music: '#ec4899',      // Pink
    news: '#0ea5e9',       // Sky
    travel: '#14b8a6',     // Teal
    uncategorized: '#6b7280', // Gray
    other: '#6b7280',      // Gray
  } as Record<string, string>,
};

// ────────────────────────────────────────────────────────────────────────────────
// Spacing & Sizing
// ────────────────────────────────────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const sizes = {
  // Border radius
  borderRadius: {
    none: 0,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },

  // Icon sizes
  icon: {
    xs: 16,
    sm: 20,
    md: 24,
    lg: 32,
    xl: 48,
  },

  // Component heights
  button: {
    small: 36,
    medium: 44,
    large: 52,
  },

  // Input heights
  input: {
    small: 36,
    medium: 44,
    large: 52,
  },
};

// ────────────────────────────────────────────────────────────────────────────────
// Typography
// ────────────────────────────────────────────────────────────────────────────────

export const typography = {
  // Font families
  fontFamily: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },

  // Font sizes
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },

  // Font weights
  fontWeight: {
    light: '300' as const,
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
};

// ────────────────────────────────────────────────────────────────────────────────
// Shadow & Elevation
// ────────────────────────────────────────────────────────────────────────────────

export const shadows = {
  none: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 13.16,
    elevation: 13,
  },
};

// ────────────────────────────────────────────────────────────────────────────────
// Animations & Transitions
// ────────────────────────────────────────────────────────────────────────────────

export const animations = {
  // Easing functions
  easing: {
    linear: Easing.linear,
    inOut: Easing.inOut(Easing.ease),
    in: Easing.in(Easing.ease),
    out: Easing.out(Easing.ease),
    easeInCubic: Easing.bezier(0.32, 0, 0.67, 0),
    easeOutCubic: Easing.bezier(0.33, 1, 0.68, 1),
    easeInOutCubic: Easing.bezier(0.65, 0, 0.35, 1),
    easeInCirc: Easing.bezier(0.6, 0.04, 0.98, 0.335),
    easeOutCirc: Easing.bezier(0.075, 0.82, 0.165, 1),
    easeInQuart: Easing.bezier(0.895, 0.03, 0.685, 0.22),
    easeOutQuart: Easing.bezier(0.165, 0.84, 0.44, 1),
  },

  // Animation durations (ms)
  duration: {
    fast: 150,
    base: 250,
    slow: 350,
    slower: 500,
  },

  // Preset animations
  presets: {
    // Fade animations
    fadeIn: {
      duration: 200,
      easing: Easing.ease,
    },
    fadeOut: {
      duration: 150,
      easing: Easing.ease,
    },

    // Scale animations
    scaleIn: {
      duration: 250,
      easing: Easing.out(Easing.ease),
    },
    scaleOut: {
      duration: 150,
      easing: Easing.in(Easing.ease),
    },

    // Slide animations
    slideInRight: {
      duration: 300,
      easing: Easing.out(Easing.ease),
    },
    slideOutRight: {
      duration: 250,
      easing: Easing.in(Easing.ease),
    },
    slideInUp: {
      duration: 300,
      easing: Easing.out(Easing.ease),
    },
    slideOutDown: {
      duration: 250,
      easing: Easing.in(Easing.ease),
    },

    // Spring-like animations
    bounce: {
      duration: 400,
      easing: Easing.out(Easing.bounce),
    },

    // Attention seeker
    pulse: {
      duration: 1500,
      easing: Easing.linear,
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────────
// Screen Options (Navigation)
// ────────────────────────────────────────────────────────────────────────────────

export const screenOptions = {
  headerStyle: {
    backgroundColor: colors.primary,
    shadowOpacity: 0,
    elevation: 0,
  },
  headerTintColor: colors.text,
  headerTitleStyle: {
    fontWeight: '600' as const,
    fontSize: typography.fontSize.lg,
  },
  cardStyle: { backgroundColor: colors.background },
  cardShadowEnabled: false,
};

// ────────────────────────────────────────────────────────────────────────────────
// Common Styles
// ────────────────────────────────────────────────────────────────────────────────

export const commonStyles = {
  // Flex
  flex: { flex: 1 },
  row: { flexDirection: 'row' as const },
  center: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },

  // Containers
  container: { paddingHorizontal: spacing.lg },
  safeContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },

  // Text
  textCenter: { textAlign: 'center' as const },

  // Borders
  borderBottom: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },

  // Absolute positioning
  absolute: { position: 'absolute' as const },
  absoluteFill: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
};

// ────────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Get category color by name
 */
export const getCategoryColor = (category: string): string => {
  const cat = category.toLowerCase();
  return colors.categories[cat as keyof typeof colors.categories] || colors.primary;
};

/**
 * Create linear gradient colors
 */
export const createGradient = (startColor: string, endColor: string) => [
  startColor,
  endColor,
];

/**
 * Interpolate between values based on animation progress
 */
export const interpolate = (
  progress: Animated.Value,
  inputRange: number[],
  outputRange: (string | number)[],
): Animated.AnimatedInterpolation<string | number> => {
  return progress.interpolate({
    inputRange,
    outputRange: outputRange as any,
  });
};

export default {
  colors,
  spacing,
  sizes,
  typography,
  shadows,
  animations,
  screenOptions,
  commonStyles,
  getCategoryColor,
  createGradient,
  interpolate,
};
