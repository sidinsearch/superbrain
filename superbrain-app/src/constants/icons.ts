import { colors } from '../theme/colors';

export const ICON_COLORS: Record<string, string> = {
  folder: colors.primary || '#6366f1',
  airplane: '#0ea5e9',
  restaurant: '#ef4444',
  shirt: '#ec4899',
  fitness: '#10b981',
  book: '#b45309',
  film: '#8b5cf6',
  camera: '#06b6d4',
  star: '#eab308',
  heart: '#f43f5e',
  flame: '#f97316',
  pin: '#3b82f6',
  time: '#64748b',
  clock: '#64748b',
};

export const ICON_OPTIONS = [
  'folder',
  'airplane',
  'restaurant',
  'shirt',
  'fitness',
  'book',
  'film',
  'camera',
  'star',
  'heart',
  'flame',
  'pin',
  'time',
];

export const getCollectionIconName = (collectionId: string, icon?: string): string => {
  if (collectionId === 'default_watch_later') return 'time';
  if (icon === 'clock') return 'time';
  if (icon && icon in ICON_COLORS) return icon;
  return 'folder';
};

export const getCollectionIconColor = (collectionId: string, icon?: string): string => {
  const resolvedIcon = getCollectionIconName(collectionId, icon);
  return ICON_COLORS[resolvedIcon] || colors.primary;
};
