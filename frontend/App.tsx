import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';

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
  ShareHandler: { url: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [initialRoute, setInitialRoute] = useState<'Splash' | 'Settings'>('Splash');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize API service
      await apiService.initialize();
      
      // Check if API token is configured
      const token = await apiService.getApiToken();
      
      if (!token) {
        // No token configured, go directly to Settings
        setInitialRoute('Settings');
      } else {
        // Token exists, show splash then home
        setInitialRoute('Splash');
      }
    } catch (error) {
      console.error('App initialization error:', error);
      setInitialRoute('Settings');
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
              ShareHandler: {
                path: 'p/:shortcode',
                parse: {
                  shortcode: (shortcode) => `https://instagram.com/p/${shortcode}`,
                },
              },
            },
          },
          async getInitialURL() {
            // Check if app was opened via deep link
            const url = await Linking.getInitialURL();
            if (url) {
              return url;
            }
            return null;
          },
          subscribe(listener) {
            // Listen for deep links while app is open
            const subscription = Linking.addEventListener('url', ({ url }) => {
              listener(url);
            });
            return () => subscription.remove();
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
              animation: 'slide_from_bottom',
              presentation: 'transparentModal',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
