export interface Post {
  shortcode: string;
  url: string;
  username: string;
  title: string;
  summary: string;
  tags: string[];
  music: string;
  category: string;
  thumbnail_url?: string;
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
  max_concurrent: number;
  available_slots: number;
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
