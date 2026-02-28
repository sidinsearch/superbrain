import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Linking from 'expo-linking';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import ApiService from '../services/api';

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>;

export default function SplashScreen({ navigation }: Props) {
  const [progress] = useState(new Animated.Value(0));

  useEffect(() => {
    const initialize = async () => {
      console.log('SplashScreen - Starting initialization');
      
      // Check for share intent FIRST before anything else
      const url = await Linking.getInitialURL();
      console.log('SplashScreen - Initial URL:', url);
      console.log('SplashScreen - URL type:', typeof url);
      
      if (url) {
        console.log('SplashScreen - URL detected, checking if share intent...');
        
        // Check if it's a share URL
        if (url.includes('share')) {
          console.log('SplashScreen - ✅ SHARE INTENT DETECTED!');
          
          // Parse the URL to get the shared Instagram URL
          const parsed = Linking.parse(url);
          console.log('SplashScreen - Parsed URL:', JSON.stringify(parsed, null, 2));
          
          const sharedUrl = parsed.queryParams?.url as string;
          console.log('SplashScreen - Extracted shared URL:', sharedUrl);
          
          // Navigate directly to ShareHandler immediately
          console.log('SplashScreen - 🚀 Navigating to ShareHandler NOW');
          navigation.replace('ShareHandler', { url: sharedUrl });
          return; // Exit early, don't continue with normal flow
        }
      }
      
      console.log('SplashScreen - No share intent, proceeding with normal flow');
      
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
    outputRange: ['0%', '40%'],
  });

  return (
    <View style={styles.container}>
      {/* Glow effect background */}
      <View style={styles.glowCircle} />
      <View style={styles.glowCircle2} />
      
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <View style={styles.iconGlow} />
          <Text style={styles.emoji}>🧠</Text>
        </View>
        
        <View style={styles.textContainer}>
          <Text style={styles.title}>SuperBrain</Text>
          <Text style={styles.subtitle}>Save it. See it. Do it.</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressBar, { width: progressWidth }]} />
        </View>
        <Text style={styles.loadingText}>LOADING</Text>
      </View>

      {/* Status bar simulation */}
      <View style={styles.statusBar}>
        <Text style={styles.statusTime}>9:41</Text>
        <View style={styles.statusIcons}>
          <Text style={styles.statusIcon}>📶</Text>
          <Text style={styles.statusIcon}>📡</Text>
          <Text style={styles.statusIcon}>🔋</Text>
        </View>
      </View>

      {/* Home indicator */}
      <View style={styles.homeIndicator} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -60,
  },
  glowCircle: {
    position: 'absolute',
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    top: '50%',
    left: '50%',
    marginTop: -250,
    marginLeft: -250,
    opacity: 0.8,
  },
  glowCircle2: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    top: '50%',
    left: '50%',
    marginTop: -150,
    marginLeft: -150,
  },
  content: {
    alignItems: 'center',
    zIndex: 10,
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 24,
  },
  iconGlow: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    top: '50%',
    left: '50%',
    marginTop: -64,
    marginLeft: -64,
    opacity: 0.6,
  },
  emoji: {
    fontSize: 112,
    textAlign: 'center',
    zIndex: 1,
  },
  textContainer: {
    alignItems: 'center',
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    color: '#808080',
    fontWeight: '500',
    letterSpacing: 1,
  },
  progressContainer: {
    position: 'absolute',
    bottom: 80,
    width: 200,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressBar: {
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 2,
  },
  loadingText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#404040',
    letterSpacing: 3,
  },
  statusBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  statusTime: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
  },
  statusIcons: {
    flexDirection: 'row',
    gap: 6,
  },
  statusIcon: {
    fontSize: 16,
    opacity: 0.4,
  },
  homeIndicator: {
    position: 'absolute',
    bottom: 8,
    width: 128,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
  },
});
