import { describe, expect, it, vi } from 'vitest';

import { createAudioDownloads, looksLikeMp3, type AudioFiles, type FileDownload } from '@/audio/downloads';
import { getReciter, surahAudioUrl, timedSurahs, type Reciter } from '@/audio/reciters';
import { localFirstSource } from '@/audio/sources';
import type { TimingLoader } from '@/audio/timing';

vi.mock('@/audio/reciters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/audio/reciters')>();
  // A small test reciter (three timed surahs, the third with no recording) next to the real catalog.
  const test: Reciter = { ...actual.getReciter('maher')!, id: 'test', surahs: [1, 112, 113, 114], timed: { 1: ['a', 100], 112: ['b', 200], 113: ['c', 300] } };
  return {
    ...actual,
    getReciter: (id: string | null | undefined) => (id === 'test' ? test : actual.getReciter(id)),
  };
});

type Transfer = { url: string; surah: number; resolve: (finished: boolean) => void; reject: (error: unknown) => void; onProgress: (bytes: number) => void; paused: boolean; cancelled: boolean };

function fakeFiles(options: { free?: number | null; corrupt?: number[] } = {}) {
  const stored = new Map<string, Set<number>>();
  const transfers: Transfer[] = [];
  const partials = new Set<string>();
  const set = (id: string) => stored.get(id) ?? stored.set(id, new Set()).get(id)!;
  const files: AudioFiles = {
    stored: async (id) => [...set(id)].sort((a, b) => a - b),
    uri: async (id, surah) => (set(id).has(surah) ? `file:///docs/quran-audio/recitations/${id}/${surah}.mp3` : null),
    bytes: async (id) => [...set(id)].reduce((sum, s) => sum + (getReciter(id)!.timed[s]?.[1] ?? 0), 0),
    reciters: async () => [...stored.entries()].filter(([, s]) => s.size > 0).map(([id]) => id),
    async download(url, id, surah, onProgress): Promise<FileDownload> {
      partials.add(`${id}/${surah}`);
      let transfer!: Transfer;
      const done = new Promise<boolean>((resolve, reject) => {
        transfer = { url, surah, resolve, reject, onProgress, paused: false, cancelled: false };
      });
      transfers.push(transfer);
      return {
        done,
        pause: () => {
          transfer.paused = true;
          transfer.resolve(false);
        },
        resume: () => {
          transfer.paused = false;
          return new Promise<boolean>((resolve, reject) => {
            transfer.resolve = resolve;
            transfer.reject = reject;
          });
        },
        cancel: () => {
          transfer.cancelled = true;
          transfer.reject(new Error('cancelled'));
        },
      };
    },
    commit: async (id, surah) => {
      partials.delete(`${id}/${surah}`);
      if (options.corrupt?.includes(surah)) return false;
      set(id).add(surah);
      return true;
    },
    discardPartial: async (id, surah) => void partials.delete(`${id}/${surah}`),
    remove: async (id) => void stored.delete(id),
    freeBytes: async () => (options.free === undefined ? 10 ** 12 : options.free),
  };
  return { files, transfers, stored, partials, set };
}

const okTiming: TimingLoader = {
  load: async (reciter, surah) => ({ ok: true, timing: { reciterId: reciter.id, surah, introEndMs: 0, ayahs: [] } }),
  stored: async () => null,
};

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Finishes the latest transfer. */
async function finishLatest(transfers: Transfer[]) {
  await settle();
  const transfer = transfers.at(-1)!;
  transfer.onProgress(50);
  transfer.resolve(true);
  await settle();
}

describe('downloading a reciter for offline listening', () => {
  it('downloads every timed surah, in order, from MP3Quran, and completes', async () => {
    const { files, transfers } = fakeFiles();
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    downloads.start('test');
    await settle();
    expect(downloads.getState()).toMatchObject({ reciterId: 'test', phase: 'running', surahs: [1, 112, 113], bytesTotal: 600, current: 1 });
    await finishLatest(transfers);
    await finishLatest(transfers);
    await finishLatest(transfers);
    expect(transfers.map((t) => t.url)).toEqual([1, 112, 113].map((s) => surahAudioUrl(getReciter('test')!, s)));
    expect(downloads.getState()).toMatchObject({ phase: 'completed', completed: [1, 112, 113], bytesDone: 600 });
  });

  it('shows progress', async () => {
    const { files, transfers } = fakeFiles();
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    downloads.start('test');
    await settle();
    transfers[0].onProgress(40);
    expect(downloads.getState().bytesDone).toBe(40);
  });

  it('resumes after a restart from the next unfinished surah (finished files are kept)', async () => {
    const { files, transfers, set } = fakeFiles();
    set('test').add(1);
    set('test').add(112);
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    downloads.start('test');
    await settle();
    expect(downloads.getState()).toMatchObject({ completed: [1, 112], bytesDone: 300, current: 113 });
    await finishLatest(transfers);
    expect(transfers).toHaveLength(1);
    expect(downloads.getState().phase).toBe('completed');
  });

  it('pauses and resumes a file', async () => {
    const { files, transfers } = fakeFiles();
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    downloads.start('test');
    await settle();
    downloads.pause();
    await settle();
    expect(downloads.getState().phase).toBe('paused');
    expect(transfers[0].paused).toBe(true);
    downloads.resume();
    await settle();
    expect(downloads.getState().phase).toBe('running');
    transfers[0].resolve(true);
    await settle();
    expect(downloads.getState().completed).toEqual([1]);
  });

  it('cancels: the partial file is discarded, finished surahs stay', async () => {
    const { files, transfers, partials, set } = fakeFiles();
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    downloads.start('test');
    await finishLatest(transfers);
    await settle();
    downloads.cancel();
    await settle();
    expect(downloads.getState().phase).toBe('cancelled');
    expect(transfers[1].cancelled).toBe(true);
    expect(partials.size).toBe(0);
    expect([...set('test')]).toEqual([1]);
  });

  it('a network failure stops with an error; starting again retries from there', async () => {
    const { files, transfers } = fakeFiles();
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    downloads.start('test');
    await settle();
    transfers[0].reject(new Error('offline'));
    await settle();
    expect(downloads.getState()).toMatchObject({ phase: 'error', error: 'network' });
    downloads.start('test');
    await finishLatest(transfers);
    expect(transfers[1].url).toBe(transfers[0].url);
    expect(downloads.getState().completed).toEqual([1]);
  });

  it('a file that fails verification is not kept', async () => {
    const { files, transfers, set } = fakeFiles({ corrupt: [1] });
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    downloads.start('test');
    await finishLatest(transfers);
    expect(downloads.getState()).toMatchObject({ phase: 'error', error: 'verify' });
    expect(set('test').size).toBe(0);
  });

  it('timing that cannot be verified stops the download (a surah never stored without its timing)', async () => {
    const { files, transfers } = fakeFiles();
    const downloads = createAudioDownloads({ files, timing: { ...okTiming, load: async () => ({ ok: false, reason: 'mismatch' }) }, permitted: () => true });
    downloads.start('test');
    await settle();
    expect(downloads.getState()).toMatchObject({ phase: 'error', error: 'verify' });
    expect(transfers).toHaveLength(0);
  });

  it('checks free space first', async () => {
    const { files, transfers } = fakeFiles({ free: 1000 });
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    downloads.start('test');
    await settle();
    expect(downloads.getState()).toMatchObject({ phase: 'error', error: 'storage' });
    expect(transfers).toHaveLength(0);
  });

  it('deletes a reciter\'s audio', async () => {
    const { files, set } = fakeFiles();
    set('test').add(1);
    const downloads = createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    await downloads.remove('test');
    expect(set('test').size).toBe(0);
    expect(await files.bytes('test')).toBe(0);
  });

  it('licensing: with downloads not permitted (the shipped setting), nothing starts and nothing is fetched', async () => {
    const { files, transfers } = fakeFiles();
    const downloads = createAudioDownloads({ files, timing: okTiming });
    downloads.start('test');
    await settle();
    expect(downloads.getState()).toMatchObject({ phase: 'error', error: 'not-permitted' });
    expect(transfers).toHaveLength(0);
  });

  it('only downloads when asked: creating the manager starts nothing', async () => {
    const { files, transfers } = fakeFiles();
    createAudioDownloads({ files, timing: okTiming, permitted: () => true });
    await settle();
    expect(transfers).toHaveLength(0);
  });

  it('a real reciter\'s download covers exactly its timed surahs', () => {
    const downloads = createAudioDownloads({ files: fakeFiles().files, timing: okTiming, permitted: () => true });
    const maher = getReciter('maher')!;
    expect(timedSurahs(maher).length).toBeGreaterThan(100);
    expect(downloads.totalBytes('maher')).toBe(Object.values(maher.timed).reduce((sum, [, bytes]) => sum + bytes, 0));
    // A surah without verified timing is never part of a download (it could not play ayah by ayah).
    expect(timedSurahs(maher)).not.toContain(36);
  });
});

describe('playing downloaded audio', () => {
  it('uses the stored file without any network request', async () => {
    const { files, set } = fakeFiles();
    set('maher').add(2);
    const resolve = localFirstSource(files);
    expect(await resolve(getReciter('maher')!, 2)).toEqual({ uri: 'file:///docs/quran-audio/recitations/maher/2.mp3', local: true });
  });

  it('streams a surah that is not stored', async () => {
    const resolve = localFirstSource(fakeFiles().files);
    expect(await resolve(getReciter('maher')!, 3)).toEqual({ uri: 'https://cdn.mp3quran.net/audio/maher-muaiqly/r3/003.mp3', local: false });
  });
});

describe('verifying files', () => {
  it('recognises MP3 headers and rejects anything else', () => {
    expect(looksLikeMp3(new Uint8Array([0x49, 0x44, 0x33, 4]))).toBe(true);
    expect(looksLikeMp3(new Uint8Array([0xff, 0xfb, 0x90, 0]))).toBe(true);
    expect(looksLikeMp3(new TextEncoder().encode('<htm'))).toBe(false);
    expect(looksLikeMp3(new Uint8Array([]))).toBe(false);
  });
});
