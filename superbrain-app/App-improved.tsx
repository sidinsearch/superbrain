import React, { useEffect, useState, useRef } from 'react';
import { 
  StatusBar, 
  Platform, 
  Alert, 
  Animated,
  ActivityIndicator,
  View 
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

// ──── Screen Imports ────
import SplashScreen from './src/screens/SplashScreen';
import HomeScreen from './src/screens/HomeScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PostDetailScreen from './src/screens/PostDetailScreen';
import CollectionDetailScreen from './src/screens/CollectionDetailScreen';
import ShareHandlerScreen from './src/screens/ShareHandlerScreen';
import FailedAnalysisScreen from './src/screens/FailedAnalysisScreen';
import AIProviderScreen from './src/screens/AIProviderScreen';
import InstagramScreen from './src/screens/InstagramScreen';
import DataImportExportScreen from './src/screens/DataImportExportScreen';

// ──── Service Imports ────
import apiService from './src/services/api';
import { 
  scheduleWatchLaterNotification, 
  handleMarkAsWatched 
} from './src/services/notificationService';

// ──── Type & Theme Imports ────
import { Post, Collection } from './src/types';
import { default as theme } from './src/theme/index';

// ────────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ────────────────────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Splash: undefined;
  Home: undefined;
  Library: undefined;
  Settings: undefined;
  PostDetail: { post: Post };
  CollectionDetail: { collection: Collection };
  ShareHandler: { url?: string };
  FailedAnalysis: undefined;
  AIProvider: undefined;
  Instagram: undefined;
  DataImportExport: undefined;
};

// ────────────────────────────────────────────────────────────────────────────────
// Navigation Setup
// ────────────────────────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = React.createRef<any>();

// Deep linking configuration
const linking = {
  prefixes: [
    'superbrain://',
    'https://superbrain.app',
    'http://superbrain.app',
  ],
  config: {
    screens: {
      Home: '/',
      Library: '/library',
      Settings: '/settings',
      PostDetail: '/post/:id',
      ShareHandler: '/share/:url',
      FailedAnalysis: '/failed',
      AIProvider: '/ai',
      Instagram: '/instagram',
      DataImportExport: '/import-export',
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────────
// Notification Configuration
// ────────────────────────────────────────────────────────────────────────────────

// Set notification handler
Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ────────────────────────────────────────────────────────────────────────────────
// Main App Component
// ────────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [initialRoute, setInitialRoute] = useState<'Splash' | 'Home'>('Splash');
  const [shareUrl, setShareUrl] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);

  // ──── Initialize App ────
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Skip initial authentication check - will be handled by services
        // Initialize services on app startup
        try {
          // Services will initialize themselves
          console.log('App initialized');
        } catch (error) {
          console.error('Service initialization error:', error);
        }

        // Setup notification listeners
        notificationListener.current = Notifications.addNotificationReceivedListener(
          (notification) => {
            console.log('Notification received:', notification);
          }
        );

        responseListener.current = Notifications.addNotificationResponseReceivedListener(
          async (response) => {
            handleNotificationResponse(response);
          }
        );

        // Handle deep linking
        const url = await Linking.getInitialURL();
        if (url != null) {
          setShareUrl(url);
        }

        Linking.addEventListener('url', ({ url }) => {
          setShareUrl(url);
        });

        setIsReady(true);
        
        // Fade in animation
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();

      } catch (error) {
        console.error('Failed to initialize app:', error);
        Alert.alert('Initialization Error', 'Failed to initialize the app');
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();

    return () => {
      // Cleanup listeners
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  // ──── Handle notification response ────
  const handleNotificationResponse = async (response: any) => {
    const { notification } = response;
    const data = notification.request.content.data;

    if (data.postId) {
      try {
        // Navigate to post detail if postId is available
        navigationRef.current?.navigate('PostDetail' as any);
      } catch (error) {
        console.error('Failed to navigate to post:', error);
      }
    }
  };

  // ──── Loading screen ────
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  // ──── Setup status bar ────
  StatusBar.setBarStyle('light-content', true);
  if (Platform.OS === 'android') {
    StatusBar.setBackgroundColor(theme.colors.primary, true);
  }

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <NavigationContainer
          ref={navigationRef}
          linking={linking}
          fallback={<ActivityIndicator size="large" color={theme.colors.primary} />}
        >
          <Stack.Navigator
            screenOptions={{
              headerStyle: theme.screenOptions.headerStyle || {},
              headerTintColor: theme.screenOptions.headerTintColor,
              headerTitleStyle: theme.screenOptions.headerTitleStyle,
            }}
            initialRouteName={initialRoute}
          >
            {/* Splash Screen */}
            <Stack.Screen
              name="Splash"
              component={SplashScreen}
              options={{
                headerShown: false,
              }}
            />

            {/* Main Screens */}
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{
                headerShown: false,
              }}
            />

            <Stack.Screen
              name="Library"
              component={LibraryScreen}
              options={{
                headerTitle: 'Library',
              }}
            />

            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                headerTitle: 'Settings',
              }}
            />

            {/* Detail Screens */}
            <Stack.Screen
              name="PostDetail"
              component={PostDetailScreen}
              options={{
                headerTitle: 'Post Details',
              }}
            />

            <Stack.Screen
              name="CollectionDetail"
              component={CollectionDetailScreen}
              options={{
                headerTitle: 'Collection',
              }}
            />

            {/* Modal Screens */}
            <Stack.Group
              screenOptions={{
                presentation: 'modal',
              }}
            >
              <Stack.Screen
                name="ShareHandler"
                component={ShareHandlerScreen}
                options={{
                  headerTitle: 'Process Content',
                }}
              />

              <Stack.Screen
                name="FailedAnalysis"
                component={FailedAnalysisScreen}
                options={{
                  headerTitle: 'Failed Analysis',
                }}
              />

              <Stack.Screen
                name="AIProvider"
                component={AIProviderScreen}
                options={{
                  headerTitle: 'AI Configuration',
                }}
              />

              <Stack.Screen
                name="Instagram"
                component={InstagramScreen}
                options={{
                  headerTitle: 'Instagram Setup',
                }}
              />

              <Stack.Screen
                name="DataImportExport"
                component={DataImportExportScreen}
                options={{
                  headerTitle: 'Data Management',
                }}
              />
            </Stack.Group>
          </Stack.Navigator>
        </NavigationContainer>
        <ExpoStatusBar style="light" />
      </GestureHandlerRootView>
    </Animated.View>
  );
}

// Export navigation reference for external use
export { navigationRef };
