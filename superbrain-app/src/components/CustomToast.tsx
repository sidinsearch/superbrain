import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { colors } from '../theme/colors';

const { width } = Dimensions.get('window');

interface CustomToastProps {
  visible: boolean;
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  onHide: () => void;
  duration?: number;
}

const CustomToast: React.FC<CustomToastProps> = ({
  visible,
  message,
  type = 'info',
  onHide,
  duration = 3000,
}) => {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          friction: 8,
          tension: 65,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        hideToast();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const hideToast = () => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onHide();
    });
  };

  if (!visible) return null;

  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return { backgroundColor: '#1DB954', icon: '✓' };
      case 'error':
        return { backgroundColor: '#E53935', icon: '✕' };
      case 'warning':
        return { backgroundColor: '#FB8C00', icon: '⚠' };
      default:
        return { backgroundColor: '#2196F3', icon: 'ℹ' };
    }
  };

  const typeStyles = getTypeStyles();

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.toast, { backgroundColor: typeStyles.backgroundColor }]}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>{typeStyles.icon}</Text>
        </View>
        <Text style={styles.message} numberOfLines={2}>{message}</Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 54,
    left: 16,
    right: 16,
    zIndex: 99999,
    elevation: 99999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 12,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  icon: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '700',
  },
  message: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    letterSpacing: 0.2,
    lineHeight: 20,
  },
});

export default CustomToast;
