# Frontend Codemap

**Last Updated:** 2026-03-31
**Location:** `superbrain-app/`

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     React Native App (Expo SDK 54)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                           Screens (11 screens)                        │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │  HomeScreen              │ LibraryScreen           │ SettingsScreen   │   │
│  │  CollectionDetailScreen  │ PostDetailScreen       │ InstagramScreen  │   │
│  │  AIProviderScreen        │ DataImportExportScreen │ FailedAnalysis  │   │
│  │  ShareHandlerScreen      │ SplashScreen                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │   Services   │  │    Types     │  │   Theme      │  │ Components  │  │
│  │              │  │              │  │              │  │             │  │
│  │ api.ts       │  │ Post         │  │ colors.ts    │  │CustomToast  │  │
│  │ collections  │  │ ApiResponse  │  │              │  │             │  │
│  │ notification │  │ QueueStatus  │  │              │  │             │  │
│  │ postsCache   │  │ Collection   │  │              │  │             │  │
│  │              │  │ FailedPost   │  │              │  │             │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## App Screens

| Screen | Purpose | File |
|--------|---------|------|
| **HomeScreen** | Main feed showing analyzed posts | `HomeScreen.tsx` |
| **LibraryScreen** | Browse and manage saved posts | `LibraryScreen.tsx` |
| **SettingsScreen** | App configuration and sync | `SettingsScreen.tsx` |
| **CollectionDetailScreen** | View/edit a collection | `CollectionDetailScreen.tsx` |
| **PostDetailScreen** | View full post details | `PostDetailScreen.tsx` |
| **InstagramScreen** | Configure Instagram credentials | `InstagramScreen.tsx` |
| **AIProviderScreen** | Configure AI provider API keys | `AIProviderScreen.tsx` |
| **DataImportExportScreen** | Import/export data | `DataImportExportScreen.tsx` |
| **FailedAnalysisScreen** | View failed analyses, retry | `FailedAnalysisScreen.tsx` |
| **ShareHandlerScreen** | Handle shared URLs from other apps | `ShareHandlerScreen.tsx` |
| **SplashScreen** | App startup and initialization | `SplashScreen.tsx` |

## Key Modules

### Services

| Module | Purpose | Exports |
|--------|---------|---------|
| `api.ts` | Main API communication with backend | ApiService - Full REST client (662 lines) |
| `collections.ts` | Collections management | CRUD operations for saved posts |
| `notificationService.ts` | Push notifications | Local notification handling |
| `postsCache.ts` | Local caching | AsyncStorage-based post cache |

### Types

| Interface | Purpose |
|-----------|---------|
| `Post` | Instagram/YouTube/webpage post data |
| `ApiResponse` | Standard API response wrapper |
| `QueueStatus` | Analysis queue state |
| `RetryQueueItem` | Failed analysis retry item |
| `Collection` | Saved posts collection |
| `DatabaseStats` | Database statistics |
| `FailedPost` | Failed analysis items |

### Components

| Component | Purpose |
|-----------|---------|
| `CustomToast.tsx` | Custom toast notifications |

### Theme

| Module | Purpose |
|--------|---------|
| `colors.ts` | App color palette (primary, secondary, success, error, etc.) |

## API Service Methods

### Connection & Authentication

```typescript
// Connect using sync code (from server console)
connectWithSyncCode(syncCode: string): Promise<{ success: boolean; api_token?: string; sync_code?: string; error?: string }>

// Token management
setApiToken(token: string): Promise<void>
getApiToken(): Promise<string | null>
setSyncCode(syncCode: string): Promise<void>
getSyncCode(): Promise<string | null>
setApiUrl(url: string): Promise<void>
getBaseUrl(): Promise<string>

// Connection testing
testConnection(): Promise<boolean>
isReachable(): Promise<boolean>
```

### Content Analysis

```typescript
// Analyze a URL (Instagram, YouTube, or webpage)
analyzePost(url: string): Promise<ApiResponse>

// Force re-analyze a cached post
reanalyzePost(url: string): Promise<ApiResponse>

// Quick caption fetch
getPostInfo(url: string): Promise<{shortcode, username, title, full_caption}>

// Analyze Instagram URL specifically
analyzeInstagramUrl(url: string): Promise<Post>
```

### Data Retrieval

```typescript
// Get all posts
getPosts(): Promise<Post[]>

// Get recent posts with limit
getRecentPosts(limit?: number): Promise<Post[]>

// Get posts by category
getPostsByCategory(category: string, limit?: number): Promise<Post[]>

// Search by tags
searchByTags(tags: string[], limit?: number): Promise<Post[]>

// Check cache for a post
checkCache(shortcode: string): Promise<Post | null>

// Get categories with counts
getCategories(): Promise<Array<{ id: string; name: string; count: number }>>
```

### Queue Management

```typescript
// Get current queue status
getQueueStatus(): Promise<QueueStatus | null>

// Get retry queue
getRetryQueue(): Promise<RetryQueueItem[]>

// Flush retry queue
flushRetryQueue(): Promise<{ flushed: number; items: string[] }>
```

### Posts Management

```typescript
// Delete a post
deletePost(shortcode: string): Promise<void>

// Update post metadata
updatePost(shortcode: string, updates: {category?, title?, summary?}): Promise<void>
```

### Collections

```typescript
// Get all collections
getCollections(): Promise<Collection[]>

// Create/update collection
upsertCollection(collection: Collection): Promise<Collection>

// Update collection posts
updateCollectionPosts(collectionId: string, postIds: string[]): Promise<Collection>

// Delete collection
deleteCollection(collectionId: string): Promise<void>
```

### Settings & Configuration

```typescript
// AI Providers
getAiProviders(): Promise<any>
setAiProviderKey(provider: string, apiKey: string): Promise<any>
deleteAiProviderKey(provider: string): Promise<any>

// Instagram Credentials
getInstagramCredentials(): Promise<any>
setInstagramCredentials(username: string, password: string): Promise<any>
deleteInstagramCredentials(): Promise<any>

// Reset Operations
resetApiToken(): Promise<{ success: boolean; new_token: string; message: string }>
resetSyncCode(): Promise<{ success: boolean; sync_code: string; message: string }>
resetDatabase(): Promise<{ success: boolean; deleted_count: number; message: string }>
```

### Import/Export

```typescript
// Import data
importData(file: File, mode: 'merge' | 'replace'): Promise<any>

// Export data
getExportHeaders(): Promise<Headers>
getExportUrl(format: 'json' | 'zip'): Promise<string>
```

### System

```typescript
// Test backend connection
testConnection(): Promise<boolean>

// Check if backend is reachable
isReachable(): Promise<boolean>

// Get database statistics
getStats(): Promise<DatabaseStats | null>
```

## Configuration

### API Configuration
- Default URL: `http://192.168.31.205:5000` (configurable)
- Authentication: `X-API-Key` header or Sync Code
- Token stored in AsyncStorage

### Key Dependencies
```json
{
  "@react-native-async-storage/async-storage": "^2.2.0",
  "@react-navigation/bottom-tabs": "^7.10.1",
  "@react-navigation/native": "^7.1.28",
  "@react-navigation/native-stack": "^7.11.0",
  "axios": "^1.13.4",
  "expo": "~54.0.33",
  "expo-av": "~16.0.8",
  "expo-notifications": "^0.32.16",
  "react": "19.1.0",
  "react-native": "0.81.5"
}
```

## Post Interface

```typescript
interface Post {
  shortcode: string;
  url: string;
  username: string;
  title: string;
  summary: string;
  tags: string[];
  music: string;
  category: string;
  content_type?: 'instagram' | 'youtube' | 'webpage';
  thumbnail?: string;
  thumbnail_url?: string;
  likes?: number;
  post_date?: string;
  analyzed_at?: string;
  processing?: boolean;
}
```

## Data Flow

```
URL Input (Share/Manual)
        │
        ▼
┌───────────────────┐
│ ShareHandlerScreen│ (if shared from other app)
│    or HomeScreen │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│   ApiService      │
│  analyzePost()    │
└────────┬──────────┘
         │ POST /analyze
         ▼
┌───────────────────┐
│  Backend API      │
│  (FastAPI)        │
└────────┬──────────┘
         │
    ┌────┴────┐
    │         │
 Cache Hit  Cache Miss
    │         │
    ▼         ▼
┌─────────┐ ┌──────────┐
│ Return  │ │ Queue    │
│ Cached  │ │ Process  │
└─────────┘ └──────────┘
         │
         ▼
┌───────────────────┐
│  Display in UI   │
│  (PostDetailScreen│
│   or HomeScreen) │
└───────────────────┘
```

## Related Areas

- [INDEX.md](INDEX.md) - Overall architecture
- [BACKEND.md](BACKEND.md) - Backend API details
- [DATABASE.md](DATABASE.md) - Data storage
