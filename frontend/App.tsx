import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import { Platform, Alert } from 'react-native';

// Screens
import SplashScreen from './src/screens/SplashScreen';
import HomeScreen from './src/screens/HomeScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PostDetailScreen from './src/screens/PostDetailScreen';
import CollectionDetailScreen from './src/screens/CollectionDetailScreen';
import ShareHandlerScreen from './src/screens/ShareHandlerScreen';

// API Service
import apiService from './src/services/api';
import { Post, Collection } from './src/types';

export type RootStackParamList = {
  Splash: undefined;
  Home: undefined;
  Library: undefined;
  Settings: undefined;
  PostDetail: { post: Post };
  CollectionDetail: { collection: Collection };
  ShareHandler: { url?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = React.createRef<any>();

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [initialRoute, setInitialRoute] = useState<'Splash' | 'Home'>('Splash');
  const [shareUrl, setShareUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    initializeApp();
    
    // CRITICAL: Also listen for URL events (handles share intents)
    const subscription = Linking.addEventListener('url', ({ url }) => {
      console.log('App.tsx - URL EVENT RECEIVED:', url);
      if (url && url.includes('share')) {
        const parsed = Linking.parse(url);
        const sharedUrl = parsed.queryParams?.url as string;
        console.log('App.tsx - Navigating to ShareHandler with URL:', sharedUrl);
        // Navigate to ShareHandler (app is already running)
        if (navigationRef.current) {
          navigationRef.current.navigate('ShareHandler', { url: sharedUrl });
        }
      }
    });
    
    return () => subscription.remove();
  }, []);

  const initializeApp = async () => {
    try {
      // Check for share intent FIRST
      const url = await Linking.getInitialURL();
      console.log('App.tsx - Initial URL:', url);
      
      if (url) {
        console.log('App.tsx - URL DETECTED:', url);
        if (url.includes('share')) {
          console.log('App.tsx - Share intent detected! Skipping splash, going to Home');
          const parsed = Linking.parse(url);
          const sharedUrl = parsed.queryParams?.url as string;
          console.log('App.tsx - Extracted shared URL:', sharedUrl);
          
          setInitialRoute('Home');  // Skip splash, go straight to Home
          setShareUrl(sharedUrl);
        } else {
          console.log('App.tsx - URL does not contain share:', url);
        }
      } else {
        console.log('App.tsx - NO URL DETECTED (getInitialURL returned null)');
      }
      
      // Initialize API service
      await apiService.initialize();
    } catch (error) {
      console.error('App initialization error:', error);
    } finally {
      setIsReady(true);
      
      // If we have a share URL, navigate to ShareHandler after Home loads
      if (shareUrl && navigationRef.current) {
        setTimeout(() => {
          console.log('App.tsx - Auto-navigating to ShareHandler with URL:', shareUrl);
          navigationRef.current?.navigate('ShareHandler', { url: shareUrl });
        }, 300); // Give Home screen time to load
      }
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer
        ref={navigationRef}
        linking={{
          prefixes: ['superbrain://', 'https://instagram.com', 'https://www.instagram.com'],
          config: {
            screens: {
              Splash: 'splash',
              Home: 'home',
              Library: 'library',
              Settings: 'settings',
              ShareHandler: {
                path: 'share',
                parse: {
                  url: (url: string) => decodeURIComponent(url),
                },
              },
            },
          },
        }}
      >
        <StatusBar style="light" />
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            animation: 'fade',
          }}
        >
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Library" component={LibraryScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen 
            name="PostDetail" 
            component={PostDetailScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen 
            name="CollectionDetail" 
            component={CollectionDetailScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen 
            name="ShareHandler" 
            component={ShareHandlerScreen}
            options={{ 
              presentation: 'transparentModal',
              animation: 'slide_from_bottom',
              headerShown: false,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
