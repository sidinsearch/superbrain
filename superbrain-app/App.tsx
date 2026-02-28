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
import FailedAnalysisScreen from './src/screens/FailedAnalysisScreen';

// API Service
import apiService from './src/services/api';
import * as Notifications from 'expo-notifications';
import { scheduleWatchLaterNotification, handleMarkAsWatched } from './src/services/notificationService';
import { Post, Collection } from './src/types';

export type RootStackParamList = {
  Splash: undefined;
  Home: undefined;
  Library: undefined;
  Settings: undefined;
  PostDetail: { post: Post };
  CollectionDetail: { collection: Collection };
  ShareHandler: { url?: string };
  FailedAnalysis: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = React.createRef<any>();

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [initialRoute, setInitialRoute] = useState<'Splash' | 'Home'>('Splash');
  const [shareUrl, setShareUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    initializeApp();

    // Handle notification action buttons (e.g. "Mark as Watched")
    // Fires when app is in foreground or background
    const notifSub = Notifications.addNotificationResponseReceivedListener(async response => {
      const { actionIdentifier, notification } = response;
      const shortcode = notification.request.content.data?.shortcode as string | undefined;
      if (actionIdentifier === 'mark_watched' && shortcode) {
        await handleMarkAsWatched(shortcode);
      } else if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        // User tapped the notification itself — navigate to Home so they see the post
        if (navigationRef.current) {
          navigationRef.current.navigate('Home');
        }
      }
    });
    
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
    
    return () => {
      subscription.remove();
      notifSub.remove();
    };
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

      // Handle notification tap when app was fully killed
      // addNotificationResponseReceivedListener doesn't fire in killed state,
      // so we check getLastNotificationResponseAsync on every cold start
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      if (lastResponse) {
        const { actionIdentifier, notification } = lastResponse;
        const shortcode = notification.request.content.data?.shortcode as string | undefined;
        if (actionIdentifier === 'mark_watched' && shortcode) {
          await handleMarkAsWatched(shortcode);
        } else if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
          // Tapped notification body — navigate to Home after app loads
          setTimeout(() => {
            if (navigationRef.current) navigationRef.current.navigate('Home');
          }, 500);
        }
      }

      // Schedule Watch Later notifications in background
      scheduleWatchLaterNotification().catch(() => {});
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
          prefixes: [
            'superbrain://',
            'https://instagram.com', 'https://www.instagram.com',
            'https://youtube.com', 'https://www.youtube.com', 'https://youtu.be',
          ],
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
          <Stack.Screen
            name="FailedAnalysis"
            component={FailedAnalysisScreen}
            options={{ animation: 'slide_from_right' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
