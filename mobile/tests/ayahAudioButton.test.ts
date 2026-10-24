import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

const audio = vi.hoisted(() => ({
  listeners: new Set<(status: { positionMs: number; playing: boolean; buffering: boolean; loaded: boolean; finished: boolean; error: string | null }) => void>(),
  loads: [] as string[],
  /** Loads waiting (while `hold` is on): resolve them to let a held load finish. */
  hold: false,
  pending: [] as (() => void)[],
  plays: 0,
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('lucide-react-native', () => ({ Pause: 'Pause', Play: 'Play', RotateCcw: 'RotateCcw' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => undefined } }));
// The real engine over a fake player and synthetic timing (every ayah 10 s after a 4 s opening).
vi.mock('@/audio/index', async () => {
  const { createPlaybackEngine } = await import('@/audio/engine');
  const { surahAudioUrl } = await import('@/audio/reciters');
  const { SURAH_AYAH_COUNTS } = await import('@/utils/ayahLink');
  const audioEngine = createPlaybackEngine({
    output: {
      load: async (uri: string, startMs: number) => {
        audio.loads.push(`${uri}@${startMs}`);
        if (audio.hold) await new Promise<void>((resolve) => audio.pending.push(resolve));
      },
      seek: async (ms: number) => void audio.loads.push(`seek@${ms}`),
      play: () => void (audio.plays += 1),
      pause: () => undefined,
      stop: () => undefined,
      subscribe: (listener) => {
        audio.listeners.add(listener);
        return () => audio.listeners.delete(listener);
      },
      setNowPlaying: () => undefined,
      preload: () => undefined,
    },
    timing: {
      load: async (reciter, surah) => ({
        ok: true as const,
        timing: { reciterId: reciter.id, surah, introEndMs: 4000, ayahs: Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => ({ startMs: 4000 + i * 10_000, endMs: 14_000 + i * 10_000 })) },
      }),
      stored: async () => null,
    },
    resolveSource: async (reciter, surah) => ({ uri: surahAudioUrl(reciter, surah), local: false }),
    now: () => 10 ** 12,
  });
  return { audioEngine, audioDownloads: {}, audioFiles: {}, setAudioLocale: () => undefined };
});

const { AyahAudioButton } = await import('@/components/AyahAudioButton');
const { audioEngine } = await import('@/audio/index');
const favorite = vi.hoisted(() => ({ reciterId: 'maher' }));
vi.mock('@/audio/useFavoriteReciter', () => ({ useFavoriteReciter: () => ({ reciterId: favorite.reciterId, isReady: true, setReciterId: () => undefined }) }));

const copy = MESSAGES.en.audio;
let root: ReactTestRenderer | undefined;
let problem: string | null = null;
const flush = async () => {
  for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); });
};
const button = () => root!.root.findByProps({ testID: 'ayah-audio' });
const element = (surah: number, ayah: number) => createElement(AyahAudioButton, { surah, ayah, copy, rtl: false, color: '#111', accent: '#3E6B4B', onProblem: (p: string | null) => { problem = p; } });
async function render(surah = 94, ayah = 5) {
  await act(async () => {
    root = create(element(surah, ayah));
  });
}
/** The screen shows another ayah in the same card (Another ayah, a new emotion). */
async function show(surah: number, ayah: number) {
  await act(async () => root!.update(element(surah, ayah)));
  await flush();
}
async function press() {
  await act(async () => button().props.onPress());
  await flush();
}
async function reachEnd(ayah: number) {
  const start = 4000 + (ayah - 1) * 10_000;
  for (const positionMs of [start + 100, start + 10_000]) {
    await act(async () => {
      for (const listener of audio.listeners) listener({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null });
    });
  }
  await flush();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  favorite.reciterId = 'maher';
  problem = null;
  audio.loads = [];
  audio.hold = false;
  audio.pending = [];
  audio.plays = 0;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  audioEngine.stop();
});

describe('the ayah screens\' play button', () => {
  it('plays the displayed ayah once in the Favorite Reciter', async () => {
    await render();
    expect(button().props.accessibilityLabel).toBe(copy.playAyah);
    await press();
    expect(audioEngine.getState()).toMatchObject({ phase: 'playing', mode: 'single', position: { surah: 94, ayah: 5 }, reciterId: 'maher' });
    expect(audio.loads).toEqual(['https://cdn.mp3quran.net/audio/maher-muaiqly/r3/094.mp3@44000']);
    expect(button().props.accessibilityLabel).toBe(copy.pauseAyah);
  });

  it('pauses, resumes, and after the ayah ends offers to play it again (never on to another ayah)', async () => {
    await render();
    await press();
    await press();
    expect(audioEngine.getState().phase).toBe('paused');
    await press();
    expect(audioEngine.getState().phase).toBe('playing');
    await reachEnd(5);
    expect(audioEngine.getState()).toMatchObject({ phase: 'ended', position: { surah: 94, ayah: 5 } });
    expect(button().props.accessibilityLabel).toBe(copy.replayAyah);
    expect(audio.loads).toHaveLength(1);
    await press();
    expect(audioEngine.getState().phase).toBe('playing');
  });

  it('uses the Favorite Reciter chosen in Settings', async () => {
    favorite.reciterId = 'abdulbasit';
    await render();
    await press();
    expect(audioEngine.getState().reciterId).toBe('abdulbasit');
  });

  it('a Favorite Reciter without a verified recording of the surah: Al-Minshawi recites it; the Favorite Reciter is kept', async () => {
    favorite.reciterId = 'yasser-salama';
    await render();
    await press();
    expect(audioEngine.getState()).toMatchObject({ phase: 'playing', mode: 'single', position: { surah: 94, ayah: 5 }, reciterId: 'minshawi', preferredReciterId: 'yasser-salama' });
    expect(audio.loads).toEqual(['https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/094.mp3@44000']);
    expect(problem).toBeNull();
    expect(favorite.reciterId).toBe('yasser-salama');
  });

  it('neither the Favorite Reciter nor Al-Minshawi has a verified recording of the surah: nothing plays, and it says so', async () => {
    favorite.reciterId = 'yasser-salama';
    await render(9, 5);
    await press();
    expect(audioEngine.getState().phase).toBe('idle');
    expect(audio.loads).toEqual([]);
    expect(problem).toBe('Yasser Mahmoud Salama has no verified recording of this surah. You can choose another Favorite Reciter in Settings.');
  });

  it('leaving the ayah stops its recitation', async () => {
    await render();
    await press();
    await act(async () => root!.unmount());
    root = undefined;
    expect(audioEngine.getState().phase).toBe('idle');
  });

  it('sits beside Copy on the ayah screens\' card only (not Favorites\' compact cards)', () => {
    const card = readFileSync(resolve(__dirname, '../src/components/AyahCard.tsx'), 'utf-8');
    const controls = card.slice(card.indexOf('<View style={styles.controlsRight}>'), card.indexOf('accessibilityLabel={messages.ayah.copyAyah}'));
    expect(controls).toContain('{!compact && (');
    expect(controls).toContain('<AyahAudioButton');
  });
});

describe('switching ayahs (How I Feel, A Message from the Quran)', () => {
  it('showing another ayah stops the one playing; the new ayah waits for its own Play (no autoplay)', async () => {
    await render(94, 5);
    await press();
    expect(audioEngine.getState().phase).toBe('playing');
    const plays = audio.plays;
    await show(94, 6);
    expect(audioEngine.getState().phase).toBe('idle');
    expect(button().props.accessibilityLabel).toBe(copy.playAyah);
    expect(audio.plays).toBe(plays);
    await press();
    expect(audioEngine.getState()).toMatchObject({ phase: 'playing', position: { surah: 94, ayah: 6 }, mode: 'single' });
  });

  it('switching while paused resets the old ayah', async () => {
    await render(94, 5);
    await press();
    await press(); // pause
    expect(audioEngine.getState().phase).toBe('paused');
    await show(2, 255);
    expect(audioEngine.getState().phase).toBe('idle');
    expect(button().props.accessibilityLabel).toBe(copy.playAyah);
  });

  it('switching while the old ayah is still loading: it never starts playing afterwards', async () => {
    audio.hold = true;
    await render(94, 5);
    await press();
    expect(audioEngine.getState().phase).toBe('loading');
    await show(94, 6);
    expect(audioEngine.getState().phase).toBe('idle');
    // The old load finishes late: nothing plays, nothing is shown as this ayah's.
    await act(async () => { for (const resolve of audio.pending.splice(0)) resolve(); });
    await flush();
    expect(audio.plays).toBe(0);
    expect(audioEngine.getState().phase).toBe('idle');
    expect(button().props.accessibilityLabel).toBe(copy.playAyah);
    expect(problem).toBeNull();
  });

  it('rapid Next: one recording at most, only the last ayah pressed plays', async () => {
    await render(94, 1);
    for (const ayah of [2, 3, 4]) {
      await press();
      await show(94, ayah);
    }
    expect(audioEngine.getState().phase).toBe('idle');
    await press();
    expect(audioEngine.getState()).toMatchObject({ phase: 'playing', position: { surah: 94, ayah: 4 } });
    // Each Play replaced the one before (the single output): never two at once.
    expect(audio.plays).toBe(4);
  });

  it('an old session`s events never mark the new ayah as playing', async () => {
    await render(94, 5);
    await press();
    await show(94, 6);
    // Something else starts the old ayah again (e.g. another screen): not this card's session.
    audioEngine.start({ surah: 94, ayah: 6 }, { mode: 'single', reciterId: 'maher' });
    await flush();
    expect(button().props.accessibilityLabel).toBe(copy.playAyah);
  });

  it('closing the card during loading or playback stops it, without errors', async () => {
    audio.hold = true;
    await render(94, 5);
    await press();
    await act(async () => root!.unmount());
    root = undefined;
    expect(audioEngine.getState().phase).toBe('idle');
    await act(async () => { for (const resolve of audio.pending.splice(0)) resolve(); });
    await flush();
    expect(audio.plays).toBe(0);
  });

  it('never stops the Mushaf`s continuous recitation (another session)', async () => {
    await render(94, 5);
    audioEngine.start({ surah: 2, ayah: 255 }, { mode: 'continuous', reciterId: 'maher' });
    await flush();
    await show(94, 6);
    await act(async () => root!.unmount());
    root = undefined;
    expect(audioEngine.getState()).toMatchObject({ phase: 'playing', mode: 'continuous', position: { surah: 2, ayah: 255 } });
  });
});
