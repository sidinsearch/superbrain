import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, StatusBar } from 'react-native';
import * as Linking from 'expo-linking';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import ApiService from '../services/api';
import { colors } from '../theme/colors';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  const [progress] = useState(new Animated.Value(0));
  const [fadeIn] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.8));

  useEffect(() => {
    // Fade in the content
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    const initialize = async () => {
      // Check for share intent FIRST before anything else
      const url = await Linking.getInitialURL();
      
      if (url) {
        if (url.includes('share')) {
          const parsed = Linking.parse(url);
          const sharedUrl = parsed.queryParams?.url as string;
          navigation.replace('ShareHandler', { url: sharedUrl });
          return;
        }
      }
      
      // Normal flow - initialize API and show animation
      await ApiService.initialize();
      const token = await ApiService.getApiToken();
      
      // Animate progress bar
      Animated.timing(progress, {
        toValue: 1,
        duration: 1800,
        useNativeDriver: false,
      }).start();

      setTimeout(() => {
        navigation.replace('Home');
      }, 2000);
    };

    initialize();
  }, []);

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f1115" translucent />
      
      {/* Subtle glow effects */}
      <View style={styles.glowCircle} />
      <View style={styles.glowCircle2} />
      
      <Animated.View style={[
        styles.content,
        {
          opacity: fadeIn,
          transform: [{ scale: scaleAnim }],
        },
      ]}>
        <View style={styles.iconContainer}>
          <View style={styles.iconGlow} />
          <Text style={styles.emoji}>🧠</Text>
        </View>
        
        <View style={styles.textContainer}>
          <Text style={styles.title}>SuperBrain</Text>
          <Text style={styles.subtitle}>Save it. See it. Do it.</Text>
        </View>
      </Animated.View>

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressBar, { width: progressWidth }]} />
        </View>
        <Text style={styles.loadingText}>LOADING</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowCircle: {
    position: 'absolute',
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: 'rgba(99, 102, 241, 0.04)',
    top: '50%',
    left: '50%',
    marginTop: -250,
    marginLeft: -200,
  },
  glowCircle2: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(139, 92, 246, 0.03)',
    top: '50%',
    left: '50%',
    marginTop: -175,
    marginLeft: -125,
  },
  content: {
    alignItems: 'center',
    zIndex: 10,
    marginTop: -40,
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 28,
  },
  iconGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    top: '50%',
    left: '50%',
    marginTop: -70,
    marginLeft: -70,
  },
  emoji: {
    fontSize: 100,
    textAlign: 'center',
    zIndex: 1,
  },
  textContainer: {
    alignItems: 'center',
  },
  title: {
    fontSize: 42,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 17,
    color: colors.textMuted,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  progressContainer: {
    position: 'absolute',
    bottom: 80,
    width: 180,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 1.5,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 1.5,
    opacity: 0.7,
  },
  loadingText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 4,
    opacity: 0.5,
  },
});
