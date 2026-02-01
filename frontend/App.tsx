import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

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

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [initialUrl, setInitialUrl] = useState<string | null>(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize API service
      await apiService.initialize();
      
      // Check for share intent (Android)
      if (Platform.OS === 'android') {
        const url = await Linking.getInitialURL();
        console.log('App - Initial URL on launch:', url);
        if (url) {
          setInitialUrl(url);
        }
      }
    } catch (error) {
      console.error('App initialization error:', error);
    } finally {
      setIsReady(true);
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer
        linking={{
          prefixes: ['superbrain://', 'https://instagram.com', 'https://www.instagram.com'],
          config: {
            screens: {
              Splash: 'splash',
              Home: 'home',
              Library: 'library',
              Settings: 'settings',
              ShareHandler: 'share',
            },
          },
          async getInitialURL() {
            // Check if app was opened via deep link or share intent
            const url = await Linking.getInitialURL();
            console.log('NavigationContainer - getInitialURL:', url);
            
            if (url) {
              // Parse the URL to check for text content (Android share intent)
              const parsed = Linking.parse(url);
              console.log('NavigationContainer - Parsed:', JSON.stringify(parsed, null, 2));
              
              // Handle Android SEND intent with text
              if (parsed.queryParams?.text) {
                const textContent = parsed.queryParams.text as string;
                console.log('NavigationContainer - Got text from share:', textContent);
                return `superbrain://share?text=${encodeURIComponent(textContent)}`;
              }
              
              // Handle Instagram URLs or HTTP URLs
              if (url.includes('instagram.com') || url.startsWith('http')) {
                console.log('NavigationContainer - Routing to ShareHandler with URL:', url);
                return `superbrain://share?url=${encodeURIComponent(url)}`;
              }
            }
            
            console.log('NavigationContainer - Default routing with URL:', url);
            return url;
          },
          subscribe(listener) {
            // Listen for deep links while app is open
            const subscription = Linking.addEventListener('url', ({ url }) => {
              console.log('NavigationContainer - Received URL event:', url);
              
              if (url) {
                // Parse the URL to check for text content
                const parsed = Linking.parse(url);
                
                // Handle Android SEND intent with text
                if (parsed.queryParams?.text) {
                  const textContent = parsed.queryParams.text as string;
                  console.log('NavigationContainer - Event got text from share:', textContent);
                  listener(`superbrain://share?text=${encodeURIComponent(textContent)}`);
                  return;
                }
                
                // Handle Instagram URLs or HTTP URLs
                if (url.includes('instagram.com') || url.startsWith('http')) {
                  console.log('NavigationContainer - Routing event to ShareHandler');
                  listener(`superbrain://share?url=${encodeURIComponent(url)}`);
                  return;
                }
              }
              
              listener(url);
            });
            return () => subscription.remove();
          },
        }}
      >
        <StatusBar style="light" />
        <Stack.Navigator
          initialRouteName="Splash"
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
              animation: 'slide_from_bottom',
              presentation: 'transparentModal',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
