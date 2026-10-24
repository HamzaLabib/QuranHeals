import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExpoOutput, LOAD_TIMEOUT_MS, LoadSupersededError } from '@/audio/expoOutput';

/**
 * The expo-audio adapter (audio/expoOutput.ts) over a fake native player: a load waits for the source to become
 * playable; a newer load or a stop must end that wait without seeking or reporting the newer source's state.
 */
function fakeExpoAudio(options: { replaceThrows?: boolean } = {}) {
  const calls: string[] = [];
  const player = {
    isLoaded: false,
    currentStatus: { error: null as string | null },
    pause: () => calls.push('pause'),
    play: () => calls.push('play'),
    replace: (source: { uri: string } | null) => {
      calls.push(`replace ${source ? source.uri : 'null'}`);
      if (options.replaceThrows && source === null) throw new Error('native');
      player.isLoaded = false;
    },
    seekTo: async (seconds: number) => void calls.push(`seek ${seconds}`),
    addListener: () => ({ remove: () => undefined }),
    setActiveForLockScreen: () => undefined,
    updateLockScreenMetadata: () => undefined,
    clearLockScreenControls: () => calls.push('clear'),
  };
  const module = {
    setAudioModeAsync: async () => undefined,
    createAudioPlayer: () => player,
    preload: async () => undefined,
    clearAllPreloadedSources: async () => undefined,
  };
  return { player, calls, load: async () => module as never };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the expo-audio output', () => {
  it('a load waits for its source, then seeks to the ayah', async () => {
    const fake = fakeExpoAudio();
    const output = createExpoOutput(fake.load);
    const loading = output.load('a.mp3', 5000);
    await vi.advanceTimersByTimeAsync(150);
    fake.player.isLoaded = true;
    await vi.advanceTimersByTimeAsync(150);
    await loading;
    expect(fake.calls).toEqual(['pause', 'replace a.mp3', 'seek 5']);
  });

  it('a newer load supersedes one still waiting: the old never seeks, and never takes the new source as its own', async () => {
    const fake = fakeExpoAudio();
    const output = createExpoOutput(fake.load);
    const first = output.load('a.mp3', 5000);
    const firstResult = first.then(() => 'resolved', (error) => error);
    await vi.advanceTimersByTimeAsync(150);
    const second = output.load('b.mp3', 9000);
    await vi.advanceTimersByTimeAsync(10);
    fake.player.isLoaded = true; // b is ready
    await vi.advanceTimersByTimeAsync(300);
    await second;
    expect(await firstResult).toBeInstanceOf(LoadSupersededError);
    expect(fake.calls.filter((c) => c.startsWith('seek'))).toEqual(['seek 9']);
  });

  it('stop during a load ends it quietly (a superseded load, never an error state) and nothing plays', async () => {
    const fake = fakeExpoAudio();
    const output = createExpoOutput(fake.load);
    const loading = output.load('a.mp3', 5000).then(() => 'resolved', (error) => error);
    await vi.advanceTimersByTimeAsync(150);
    output.stop();
    fake.player.isLoaded = true;
    await vi.advanceTimersByTimeAsync(300);
    expect(await loading).toBeInstanceOf(LoadSupersededError);
    expect(fake.calls).not.toContain('seek 5');
    expect(fake.calls).not.toContain('play');
  });

  it('stop is safe any number of times: before the player exists, twice, and when the native replace throws', async () => {
    const fake = fakeExpoAudio({ replaceThrows: true });
    const output = createExpoOutput(fake.load);
    expect(() => output.stop()).not.toThrow();
    const loading = output.load('a.mp3', 0);
    await vi.advanceTimersByTimeAsync(150);
    fake.player.isLoaded = true;
    await vi.advanceTimersByTimeAsync(150);
    await loading;
    expect(() => {
      output.stop();
      output.stop();
    }).not.toThrow();
  });
});

// Saleh Al-Talib 12 (iPhone, 2026-10-24): archive.org's ia600903 takes 7–9 s before the first byte of every request,
// and iOS makes several before the file can play, so it can need more than LOAD_TIMEOUT_MS. Each retry used to replace
// the source and start from nothing again: about a minute of loading, then an error, never Saleh's voice.
describe('a host slow to answer (Saleh Al-Talib 12 on archive.org)', () => {
  const SALEH_12 = 'https://ia600903.us.archive.org/12/items/SheikhTalibSurahs626991-114/SurahYusufBySheikhTalib12-16thJan2013.mp3';

  it('a load that times out fails (the engine retries it); the retry keeps waiting for the same source, never restarts it', async () => {
    const fake = fakeExpoAudio();
    const output = createExpoOutput(fake.load);
    const first = output.load(SALEH_12, 520).then(() => 'resolved', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 200);
    expect(await first).toBe('load timeout');
    // The engine's first automatic retry (RETRY_DELAYS_MS[0]), while the native player is still fetching the file.
    await vi.advanceTimersByTimeAsync(1500);
    const retry = output.load(SALEH_12, 520);
    await vi.advanceTimersByTimeAsync(3000);
    fake.player.isLoaded = true; // about 25 s after the first request: the file can play
    await vi.advanceTimersByTimeAsync(200);
    await retry;
    expect(fake.calls.filter((c) => c.startsWith('replace'))).toEqual([`replace ${SALEH_12}`]);
    expect(fake.calls.at(-1)).toBe('seek 0.52');
  });

  it('another source, a stop, or a native error still replaces the source as before', async () => {
    const fake = fakeExpoAudio();
    const output = createExpoOutput(fake.load);
    void output.load(SALEH_12, 0).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 200);
    void output.load('b.mp3', 0).catch(() => undefined); // another source
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 200);
    output.stop();
    void output.load('b.mp3', 0).catch(() => undefined); // after a stop
    await vi.advanceTimersByTimeAsync(200);
    fake.player.currentStatus.error = 'network';
    await vi.advanceTimersByTimeAsync(200);
    fake.player.currentStatus.error = null;
    const again = output.load('b.mp3', 0); // after a native error
    await vi.advanceTimersByTimeAsync(200);
    fake.player.isLoaded = true;
    await vi.advanceTimersByTimeAsync(200);
    await again;
    expect(fake.calls.filter((c) => c.startsWith('replace'))).toEqual([`replace ${SALEH_12}`, 'replace b.mp3', 'replace null', 'replace b.mp3', 'replace b.mp3']);
  });

  it('a seek that never completes fails after LOAD_TIMEOUT_MS: an error the engine can retry, never endless loading', async () => {
    const fake = fakeExpoAudio();
    fake.player.seekTo = () => new Promise<undefined>(() => undefined);
    const output = createExpoOutput(fake.load);
    const loading = output.load(SALEH_12, 50_000).then(() => 'resolved', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(150);
    fake.player.isLoaded = true;
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    expect(await loading).toBe('seek timeout');
    const seeking = output.seek(60_000).then(() => 'resolved', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 10);
    expect(await seeking).toBe('seek timeout');
  });
});
