import React from 'react';
import { AppState, AppStateStatus, FlatList } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useIsFocused } from '@react-navigation/native';
import ReelsFeed from './ReelsFeed';
import localDb from '../services/localDb';
import type { Post } from '../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../components/ReelItem', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ item, isActive }: { item: Post; isActive: boolean }) => React.createElement(Text, {}, `${item.shortcode}:${isActive}`);
});
jest.mock('../services/localDb', () => ({
  __esModule: true, default: { getPostsWithServerMedia: jest.fn() },
}));

const basePost: Post = {
  shortcode: 'reel1', url: '', username: '', title: '', summary: '', tags: [], music: '', category: '',
  content_type: 'instagram', local_filename: 'reel1.mp4',
};

function feedProps(posts?: Post[], initialShortcode?: string) {
  return {
    route: { key: 'feed', name: 'ReelsFeed', params: { posts, initialShortcode } },
    navigation: { goBack: jest.fn() },
  } as unknown as React.ComponentProps<typeof ReelsFeed>;
}

beforeEach(() => {
  jest.mocked(useIsFocused).mockReturnValue(true);
  jest.mocked(localDb.getPostsWithServerMedia).mockResolvedValue([]);
  // jest-expo models AppState.currentState as a callable mock.
  jest.spyOn(AppState as unknown as { currentState: () => string }, 'currentState')
    .mockReturnValue('active');
});

it('filters unplayable posts and starts at the requested playable reel', () => {
  const posts: Post[] = [
    basePost,
    { ...basePost, shortcode: 'web', content_type: 'webpage' },
    { ...basePost, shortcode: 'missing', local_filename: undefined },
    { ...basePost, shortcode: 'offline', local_filename: undefined, local_uri: 'file:///offline.mp4' },
  ];
  render(<ReelsFeed {...feedProps(posts, 'offline')} />);

  const list = screen.UNSAFE_getByType(FlatList);
  expect(list.props.data.map((post: Post) => post.shortcode)).toEqual(['reel1', 'offline']);
  expect(list.props.initialScrollIndex).toBe(1);
  expect(screen.getByText('offline:true')).toBeTruthy();
  expect(localDb.getPostsWithServerMedia).not.toHaveBeenCalled();
});

it('loads local posts when no route posts are supplied', async () => {
  jest.mocked(localDb.getPostsWithServerMedia).mockResolvedValue([basePost]);
  render(<ReelsFeed {...feedProps()} />);

  expect(await screen.findByText('reel1:true')).toBeTruthy();
  expect(localDb.getPostsWithServerMedia).toHaveBeenCalledTimes(1);
});

it('deactivates the reel in the background or when navigation loses focus', () => {
  let onChange!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onChange = listener;
    return { remove };
  });
  const props = feedProps([basePost]);
  const { rerender, unmount } = render(<ReelsFeed {...props} />);
  expect(screen.getByText('reel1:true')).toBeTruthy();

  act(() => onChange('background'));
  expect(screen.getByText('reel1:false')).toBeTruthy();
  act(() => onChange('active'));
  expect(screen.getByText('reel1:true')).toBeTruthy();
  jest.mocked(useIsFocused).mockReturnValue(false);
  rerender(<ReelsFeed {...props} />);
  expect(screen.getByText('reel1:false')).toBeTruthy();
  unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('shows the empty feed and lets the user return', async () => {
  const props = feedProps();
  render(<ReelsFeed {...props} />);

  expect(await screen.findByText('No reels ready')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Close reels feed'));
  expect(props.navigation.goBack).toHaveBeenCalledTimes(1);
});
