import localDb from './localDb';
import type { Post } from '../types';

// Run the production SQL against SQLite rather than mirroring its CASE logic in a mock.
// Node 22.13+ exposes node:sqlite without a runtime flag.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(':memory:');
    return {
      execAsync: async (sql: string) => database.exec(sql),
      runAsync: async (sql: string, params: unknown[] = []) => database.prepare(sql).run(...params),
      getAllAsync: async (sql: string, params: unknown[] = []) => database.prepare(sql).all(...params),
      getFirstAsync: async (sql: string, params: unknown[] = []) => database.prepare(sql).get(...params),
      withTransactionAsync: async (callback: () => Promise<void>) => {
        database.exec('BEGIN');
        try {
          await callback();
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    };
  },
}));

const post: Post = {
  shortcode: 'reel1', url: '', username: '', title: 'Saved reel', summary: 'AI summary', tags: ['travel'],
  music: '', category: 'travel', content_type: 'instagram', local_filename: 'reel1.mp4', media_file_size: 1024,
};
const localUri = 'file:///documents/reels/reel1.mp4';

beforeEach(async () => {
  await localDb.clearAll();
  await localDb.upsertPosts([post]);
  await localDb.updatePostLocalMedia('reel1', localUri, 'reel1.mp4', 1024);
});

it('preserves the device download after server cache expiry and keeps it in the feed', async () => {
  const before = await localDb.getPost('reel1');
  await localDb.upsertPosts([{ ...post, local_filename: undefined, media_file_size: 0 }]);

  const after = await localDb.getPost('reel1');
  expect(after).toMatchObject({
    local_media_uri: localUri, local_uri: localUri, media_file_size: 0,
    media_downloaded_at: before!.media_downloaded_at, summary: 'AI summary', tags: ['travel'],
  });
  expect(after!.local_filename).toBeUndefined();
  expect((await localDb.getPostsWithServerMedia()).map(post => post.shortcode)).toEqual(['reel1']);
});

it('preserves a local copy on unchanged metadata but invalidates it when the server file changes', async () => {
  await localDb.upsertPosts([post]);
  expect((await localDb.getPost('reel1'))!.local_media_uri).toBe(localUri);

  await localDb.upsertPosts([{ ...post, local_filename: 'replacement.mp4', media_file_size: 2048 }]);
  const after = await localDb.getPost('reel1');
  expect(after!.local_media_uri).toBeUndefined();
  expect(after!.media_downloaded_at).toBeUndefined();
});

it('clears a purged device pointer even when the server filename has already expired', async () => {
  await localDb.upsertPosts([{ ...post, local_filename: undefined, media_file_size: 0 }]);
  await localDb.clearPostLocalMediaByFilename('reel1.mp4');

  const after = await localDb.getPost('reel1');
  expect(after!.local_media_uri).toBeUndefined();
  expect(after!.summary).toBe('AI summary');
  expect(await localDb.getPostsWithServerMedia()).toEqual([]);
});

it('matches the exact device basename rather than treating underscores as SQL wildcards', async () => {
  await localDb.updatePostLocalMedia('reel1', 'file:///documents/reels/aXb.mp4', '', 0);
  await localDb.clearPostLocalMediaByFilename('a_b.mp4');

  expect((await localDb.getPost('reel1'))!.local_media_uri).toBe('file:///documents/reels/aXb.mp4');
});
