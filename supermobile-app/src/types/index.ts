export interface Post {
  shortcode: string;
  url: string;
  username: string;
  title: string;
  summary: string;
  tags: string[];
  music: string;
  category: string;
  content_type?: 'instagram' | 'youtube' | 'webpage';
  thumbnail?: string;      // raw field from backend
  thumbnail_url?: string;  // normalized alias used by UI
  likes?: number;
  post_date?: string;
  analyzed_at?: string;
  processing?: boolean;
}

export interface ApiResponse {
  success: boolean;
  cached: boolean;
  data?: Post;
  error?: string;
  processing_time?: number;
}

export interface QueueStatus {
  currently_processing: string[];
  processing_count: number;
  queue: Array<{shortcode: string; position: number}>;
  queue_count: number;
  retry_queue: RetryQueueItem[];
  retry_count: number;
  max_concurrent: number;
  available_slots: number;
}

export interface RetryQueueItem {
  shortcode: string;
  url: string;
  content_type: string;
  reason: string;
  retry_after: string;
  attempts: number;
}

export interface SearchFilters {
  category?: string;
  tags?: string[];
  searchText?: string;
}

export interface DatabaseStats {
  document_count: number;
  storage_mb: number;
  categories: Record<string, number>;
  capacity_used: string;
}

export interface Collection {
  id: string;
  name: string;
  icon: string;
  postIds: string[]; // shortcodes
  createdAt: string;
  updatedAt: string;
}

// Posts that failed analysis – stored locally so user can retry from Library
export interface FailedPost {
  shortcode: string;
  url: string;
  title: string;
  thumbnail_url?: string;
  content_type?: string;
  failedAt: string;
}
