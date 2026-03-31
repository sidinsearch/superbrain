/**
 * Reusable UI Components with Animations
 * Production-ready components for SuperBrain app
 */

import React, { useRef, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Easing,
  ViewStyle,
  TextStyle,
  GestureResponderEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, sizes, typography, shadows, animations } from '../theme';

// ────────────────────────────────────────────────────────────────────────────────
// Button Component with Animations
// ────────────────────────────────────────────────────────────────────────────────

interface ButtonProps {
  title: string;
  onPress: (event: GestureResponderEvent) => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  style?: ViewStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  icon,
  style,
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const getBackgroundColor = () => {
    switch (variant) {
      case 'primary':
        return colors.primary;
      case 'secondary':
        return colors.accent;
      case 'outline':
        return 'transparent';
      case 'danger':
        return colors.error;
      default:
        return colors.primary;
    }
  };

  const buttonHeight = size === 'small' ? sizes.button.small : size === 'large' ? sizes.button.large : sizes.button.medium;

  const buttonStyle = [
    styles.button,
    {
      height: buttonHeight,
      minWidth: buttonHeight * 2.5,
      backgroundColor: getBackgroundColor(),
      borderWidth: variant === 'outline' ? 2 : 0,
      borderColor: variant === 'outline' ? colors.primary : 'transparent',
      opacity: disabled ? 0.5 : 1,
    },
    style,
  ];

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={buttonStyle}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        activeOpacity={0.7}
      >
        <View style={[styles.buttonContent, { flexDirection: 'row' }]}>
          {loading ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <>
              {icon && <Ionicons name={icon as any} size={20} color={colors.text} style={{ marginRight: spacing.sm }} />}
              <Text style={[styles.buttonText, { fontSize: typography.fontSize[size === 'small' ? 'sm' : 'md'] }]}>
                {title}
              </Text>
            </>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// Card Component with Shadow
// ────────────────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  elevation?: 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({ children, style, onPress, elevation = 'md' }) => {
  const pressAnim = useRef(new Animated.Value(0)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(pressAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: false,
      }),
      Animated.timing(pressAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: false,
      }),
    ]).start();

    onPress?.();
  };

  const shadowIntensity = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [shadows[elevation].elevation, shadows[elevation].elevation * 1.5],
  });

  return (
    <Animated.View
      style={[
        styles.card,
        shadows[elevation],
        { elevation: shadowIntensity },
        style,
      ]}
    >
      <TouchableOpacity
        onPress={handlePress}
        disabled={!onPress}
        activeOpacity={0.8}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// Animated Loading Spinner
// ────────────────────────────────────────────────────────────────────────────────

interface LoaderProps {
  size?: number;
  color?: string;
}

export const Loader: React.FC<LoaderProps> = ({ size = 40, color = colors.primary }) => {
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Ionicons name="reload" size={size} color={color} />
    </Animated.View>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// Gradient Container
// ────────────────────────────────────────────────────────────────────────────────

interface GradientContainerProps {
  children: React.ReactNode;
  colors?: string[];
  style?: ViewStyle;
}

export const GradientContainer: React.FC<GradientContainerProps> = ({
  children,
  colors: gradientColors = [colors.primary, colors.accent],
  style,
}) => {
  return (
    <LinearGradient colors={gradientColors as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.gradientContainer, style]}>
      {children}
    </LinearGradient>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// Badge Component
// ────────────────────────────────────────────────────────────────────────────────

interface BadgeProps {
  label: string;
  color?: string;
  backgroundColor?: string;
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  color = colors.text,
  backgroundColor = colors.primary,
  style,
}) => {
  return (
    <View style={[styles.badge, { backgroundColor }, style]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// Animated Alert / Toast
// ────────────────────────────────────────────────────────────────────────────────

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  visible: boolean;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'info', duration = 3000, visible }) => {
  const slideAnim = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: animations.duration.base,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();

      const timer = setTimeout(() => {
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: animations.duration.base,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }).start();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const getBackgroundColor = () => {
    switch (type) {
      case 'success':
        return colors.success;
      case 'error':
        return colors.error;
      case 'warning':
        return colors.warning;
      case 'info':
        return colors.info;
      default:
        return colors.primary;
    }
  };

  return (
    <Animated.View style={[styles.toast, { backgroundColor: getBackgroundColor(), transform: [{ translateY: slideAnim }] }]}>
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// Modal Overlay with Animation
// ────────────────────────────────────────────────────────────────────────────────

interface ModalOverlayProps {
  visible: boolean;
  children: React.ReactNode;
  onClose: () => void;
}

export const ModalOverlay: React.FC<ModalOverlayProps> = ({ visible, children, onClose }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: animations.duration.base,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: animations.duration.base,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: animations.duration.fast,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 100,
          duration: animations.duration.fast,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.modalOverlay}>
      <TouchableOpacity style={styles.modalBackdrop} onPress={onClose} activeOpacity={0.8} />
      <Animated.View
        style={[
          styles.modalContent,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  button: {
    borderRadius: sizes.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    color: colors.text,
    fontWeight: '600' as const,
  },

  card: {
    backgroundColor: colors.backgroundCard,
    borderRadius: sizes.borderRadius.lg,
    padding: spacing.lg,
    marginVertical: spacing.sm,
  },

  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: sizes.borderRadius.full,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600' as const,
  },

  toast: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: sizes.borderRadius.md,
    marginHorizontal: spacing.lg,
  },
  toastText: {
    color: colors.text,
    fontSize: typography.fontSize.sm,
  },

  gradientContainer: {
    flex: 1,
  },

  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 1000,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  modalContent: {
    backgroundColor: colors.backgroundCard,
    borderTopLeftRadius: sizes.borderRadius.xl,
    borderTopRightRadius: sizes.borderRadius.xl,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});
