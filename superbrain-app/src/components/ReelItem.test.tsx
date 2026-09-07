import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';
import ReelItem from './ReelItem';
import apiService from '../services/api';
import offlineMediaManager from '../services/OfflineMediaManager';
import localDb from '../services/localDb';
import type { Post } from '../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo', () => ({ useEvent: (_player: unknown, _event: string, initial: unknown) => initial }));
jest.mock('expo-video', () => ({ VideoView: 'VideoView', useVideoPlayer: jest.fn() }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { getMediaUrl: jest.fn(), getMediaDownloadHeaders: jest.fn(), currentApiUrl: 'https://api.example.com' },
}));
jest.mock('../services/OfflineMediaManager', () => ({
  __esModule: true,
  default: { checkFileExists: jest.fn(), ensurePostMediaDownloaded: jest.fn() },
}));
jest.mock('../services/localDb', () => ({
  __esModule: true,
  default: { clearPostLocalMedia: jest.fn() },
}));

const post: Post = {
  shortcode: 'reel1', url: 'https://instagram.com/reel/reel1', username: 'creator',
  title: 'A reel', summary: '', tags: [], music: '', category: '', content_type: 'instagram',
  local_filename: 'reel1.mp4', media_file_size: 1024,
};
const remoteUrl = 'https://api.example.com/api/v1/media/reel1.mp4';
const headers = { Authorization: 'Bearer test-token' };
const player = { play: jest.fn(), pause: jest.fn(), status: 'readyToPlay' };
const props = { isActive: true, height: 800, topInset: 0, bottomInset: 0 };

function latestSource() {
  return jest.mocked(useVideoPlayer).mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  jest.mocked(useVideoPlayer).mockReturnValue(player as never);
  jest.mocked(apiService.getMediaUrl).mockResolvedValue(remoteUrl);
  jest.mocked(apiService.getMediaDownloadHeaders).mockResolvedValue(headers);
  jest.mocked(offlineMediaManager.checkFileExists).mockResolvedValue(false);
  jest.mocked(offlineMediaManager.ensurePostMediaDownloaded).mockResolvedValue('file:///reels/reel1.mp4');
  jest.mocked(localDb.clearPostLocalMedia).mockResolvedValue(undefined);
});

it.each(['local_uri', 'local_media_uri'] as const)('plays the verified %s without requesting a remote URL', async field => {
  jest.mocked(offlineMediaManager.checkFileExists).mockResolvedValue(true);
  render(<ReelItem {...props} item={{ ...post, [field]: 'file:///reels/reel1.mp4' }} />);

  expect(await screen.findByText('Offline')).toBeTruthy();
  expect(latestSource()).toMatchObject({ uri: 'file:///reels/reel1.mp4', contentType: 'progressive' });
  expect(offlineMediaManager.checkFileExists).toHaveBeenCalledWith('file:///reels/reel1.mp4', 1024);
  expect(apiService.getMediaUrl).not.toHaveBeenCalled();
  expect(offlineMediaManager.ensurePostMediaDownloaded).not.toHaveBeenCalled();
});

it('streams the authenticated server URL when there is no saved local URI', async () => {
  render(<ReelItem {...props} item={post} />);

  await waitFor(() => expect(latestSource()).toMatchObject({ uri: remoteUrl, headers, useCaching: false }));
  expect(screen.queryByText('Offline')).toBeNull();
  expect(offlineMediaManager.checkFileExists).not.toHaveBeenCalled();
  expect(localDb.clearPostLocalMedia).not.toHaveBeenCalled();
});

it('clears a missing local copy and starts re-download while remote playback continues', async () => {
  let finishDownload!: (uri: string) => void;
  jest.mocked(offlineMediaManager.ensurePostMediaDownloaded).mockImplementation(() => new Promise(resolve => {
    finishDownload = resolve;
  }));
  render(<ReelItem {...props} item={{ ...post, local_uri: 'file:///missing.mp4', local_media_uri: 'file:///missing.mp4' }} />);

  await waitFor(() => expect(latestSource()).toMatchObject({ uri: remoteUrl, headers }));
  expect(screen.queryByText('Offline')).toBeNull();
  expect(localDb.clearPostLocalMedia).toHaveBeenCalledWith('reel1');
  expect(offlineMediaManager.ensurePostMediaDownloaded).toHaveBeenCalledWith({
    ...post, local_uri: undefined, local_media_uri: undefined,
  });
  await act(async () => finishDownload('file:///reels/reel1.mp4'));
});

it('keeps streaming if repair of the offline copy fails', async () => {
  jest.mocked(offlineMediaManager.ensurePostMediaDownloaded).mockRejectedValueOnce(new Error('Disk full'));
  render(<ReelItem {...props} item={{ ...post, local_uri: 'file:///missing.mp4' }} />);

  await waitFor(() => expect(latestSource()).toMatchObject({ uri: remoteUrl }));
  expect(screen.queryByText('Disk full')).toBeNull();
});

it('shows an unavailable message for a post without local or server media', async () => {
  render(<ReelItem {...props} item={{ ...post, local_filename: undefined }} />);

  expect(await screen.findByText('No media file available')).toBeTruthy();
  expect(latestSource()).toBeNull();
});

it('pauses playback when the reel becomes inactive', async () => {
  const { rerender } = render(<ReelItem {...props} item={post} />);
  await waitFor(() => expect(player.play).toHaveBeenCalled());
  player.pause.mockClear();

  rerender(<ReelItem {...props} isActive={false} item={post} />);

  expect(player.pause).toHaveBeenCalled();
});
