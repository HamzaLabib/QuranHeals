import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExpoOutput, LoadSupersededError } from '@/audio/expoOutput';

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
