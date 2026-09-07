import React from 'react';
import { Alert, InteractionManager } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import StorageManager from './StorageManager';
import offlineMediaManager from '../services/OfflineMediaManager';
import { getOfflineMediaAutoDeletePolicy, setOfflineMediaAutoDeletePolicy } from '../services/offlineMediaPolicy';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../services/OfflineMediaManager', () => ({
  __esModule: true,
  default: { getStorageSummary: jest.fn(), deleteSavedReelsOlderThan: jest.fn(), clearSavedReels: jest.fn() },
}));
jest.mock('../services/offlineMediaPolicy', () => ({
  DEFAULT_AUTO_DELETE_DAYS: 30, getOfflineMediaAutoDeletePolicy: jest.fn(), setOfflineMediaAutoDeletePolicy: jest.fn(),
}));

const summary = {
  fileCount: 2, totalBytes: 3 * 1024 * 1024, totalDiskSpaceBytes: 64 * 1024 ** 3,
  availableDiskSpaceBytes: 32 * 1024 ** 3, oldestModificationTime: null, newestModificationTime: null,
};

beforeEach(() => {
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(callback => {
    const task = Promise.resolve().then(callback as () => void);
    return { then: task.then.bind(task), done: task.then.bind(task), cancel: jest.fn() } as never;
  });
  jest.mocked(getOfflineMediaAutoDeletePolicy).mockResolvedValue({ enabled: false, maxAgeDays: 30 });
  jest.mocked(setOfflineMediaAutoDeletePolicy).mockResolvedValue(undefined);
  jest.mocked(offlineMediaManager.getStorageSummary).mockResolvedValue(summary);
  jest.mocked(offlineMediaManager.deleteSavedReelsOlderThan).mockResolvedValue({ deletedCount: 1, failedCount: 0, bytesFreed: 1024 * 1024 });
  jest.mocked(offlineMediaManager.clearSavedReels).mockResolvedValue({ deletedCount: 2, failedCount: 0, bytesFreed: summary.totalBytes });
});

it('shows measured storage without deleting files when the policy is disabled', async () => {
  render(<StorageManager />);

  expect(await screen.findByText('2 cached videos')).toBeTruthy();
  expect(screen.getByText('3.00 MB')).toBeTruthy();
  expect(offlineMediaManager.deleteSavedReelsOlderThan).not.toHaveBeenCalled();
});

it('runs the saved age policy on load and persists changes to the switch', async () => {
  const onResult = jest.fn();
  jest.mocked(getOfflineMediaAutoDeletePolicy).mockResolvedValue({ enabled: true, maxAgeDays: 45 });
  render(<StorageManager onResult={onResult} />);

  expect(await screen.findByText('Older than 45 days')).toBeTruthy();
  expect(offlineMediaManager.deleteSavedReelsOlderThan).toHaveBeenCalledWith(45);
  fireEvent(screen.getByLabelText('Auto-delete old videos'), 'valueChange', false);

  await waitFor(() => expect(setOfflineMediaAutoDeletePolicy).toHaveBeenCalledWith({ enabled: false, maxAgeDays: 45 }));
  expect(onResult).toHaveBeenCalledWith('Auto-delete disabled', 'info');
});

it('waits for destructive confirmation before clearing and refreshing the cache', async () => {
  const onResult = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<StorageManager onResult={onResult} />);
  fireEvent.press(await screen.findByText('Clear Cache'));

  expect(offlineMediaManager.clearSavedReels).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2]!;
  expect(buttons.find(button => button.text === 'Cancel')?.style).toBe('cancel');
  jest.mocked(offlineMediaManager.getStorageSummary).mockResolvedValue({ ...summary, fileCount: 0, totalBytes: 0 });
  await act(async () => { await buttons.find(button => button.text === 'Clear Cache')!.onPress!(); });

  expect(offlineMediaManager.clearSavedReels).toHaveBeenCalledTimes(1);
  expect(screen.getByText('0 cached videos')).toBeTruthy();
  expect(onResult).toHaveBeenCalledWith('Freed 3.00 MB from 2 videos', 'success');
});

it('uses the configured age for manual deletion and refreshes the totals', async () => {
  const onResult = jest.fn();
  jest.mocked(getOfflineMediaAutoDeletePolicy).mockResolvedValue({ enabled: false, maxAgeDays: 45 });
  render(<StorageManager onResult={onResult} />);
  fireEvent.press(await screen.findByText('Delete Old'));

  await waitFor(() => expect(onResult).toHaveBeenCalledWith('Freed 1.00 MB from 1 video', 'success'));
  expect(offlineMediaManager.deleteSavedReelsOlderThan).toHaveBeenCalledWith(45);
  expect(offlineMediaManager.getStorageSummary).toHaveBeenCalledTimes(2);
});

it('reports a deletion exception without losing the storage controls', async () => {
  const onResult = jest.fn();
  jest.mocked(offlineMediaManager.deleteSavedReelsOlderThan).mockRejectedValueOnce(new Error('Filesystem error'));
  render(<StorageManager onResult={onResult} />);
  fireEvent.press(await screen.findByText('Delete Old'));

  await waitFor(() => expect(onResult).toHaveBeenCalledWith('Auto-delete failed', 'error'));
  expect(screen.getByText('2 cached videos')).toBeTruthy();
  expect(screen.getByLabelText('Refresh offline storage')).toBeEnabled();
});
