import { describe, expect, it } from 'vitest';

import { COMMAND_GRACE_MS, createPlaybackEngine, RETRY_DELAYS_MS, type AudioOutput, type OutputStatus } from '@/audio/engine';
import { pageOfPosition } from '@/audio/quranSequence';
import { getReciter, hasAyahPlayback, surahAudioUrl, type Reciter } from '@/audio/reciters';
import { measuredTimingEntries } from '@/audio/generated/measuredTiming';
import { verifyTiming, type SurahTiming, type TimingLoader, type TimingResult } from '@/audio/timing';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** Synthetic timing: a 4 s opening, then every ayah 10 s long. */
const INTRO = 4000;
const AYAH = 10_000;
const startOf = (ayah: number) => INTRO + (ayah - 1) * AYAH;
const endOf = (ayah: number) => startOf(ayah) + AYAH;
function timingFor(reciter: Reciter, surah: number): SurahTiming {
  return {
    reciterId: reciter.id,
    surah,
    introEndMs: INTRO,
    ayahs: Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => ({ startMs: startOf(i + 1), endMs: endOf(i + 1) })),
  };
}

/**
 * `without`: fixture pairs ('reciterId:surah') treated as having no verified timing. Al-Minshawi has all 114 surahs in this
 * build, so a voice (or the fallback) without a surah exists only as a fixture.
 */
function setup(options: { timing?: (reciter: Reciter, surah: number) => TimingResult; failLoad?: (uri: string) => boolean; without?: readonly string[] } = {}) {
  const calls: string[] = [];
  const listeners = new Set<(status: OutputStatus) => void>();
  let clock = 0;
  const timers: { at: number; run: () => void }[] = [];
  const output: AudioOutput = {
    async load(uri, startMs) {
      calls.push(`load ${uri} @${startMs}`);
      if (options.failLoad?.(uri)) throw new Error('unreachable');
    },
    async seek(ms) {
      calls.push(`seek @${ms}`);
    },
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    stop: () => calls.push('stop'),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setNowPlaying: (info) => calls.push(info ? `now ${info.title}` : 'now -'),
    preload: (uri) => calls.push(`preload ${uri}`),
    claim: () => calls.push('claim'),
  };
  const timing: TimingLoader = {
    async load(reciter, surah) {
      return options.timing?.(reciter, surah) ?? { ok: true, timing: timingFor(reciter, surah) };
    },
    async stored() {
      return null;
    },
  };
  const without = new Set(options.without ?? []);
  const engine = createPlaybackEngine({
    output,
    timing,
    capability: (reciter, surah) => (!without.has(`${reciter.id}:${surah}`) && hasAyahPlayback(reciter, surah) ? 'ayah' : 'none'),
    resolveSource: async (reciter, surah) => ({ uri: surahAudioUrl(reciter, surah), local: false }),
    describe: (position, reciter) => ({ title: `${position.surah}:${position.ayah}`, artist: reciter.id }),
    now: () => clock,
    schedule: (run, ms) => {
      const timer = { at: clock + ms, run };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
  });
  /** Lets pending promises (timing, load) settle. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  /** The player reports `positionMs` while playing (after the command grace period). */
  const at = async (positionMs: number, patch: Partial<OutputStatus> = {}) => {
    clock += COMMAND_GRACE_MS;
    for (const listener of listeners) listener({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null, ...patch });
    await settle();
  };
  const advanceTimers = async (ms: number) => {
    clock += ms;
    for (const timer of timers.filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.run();
    }
    await settle();
  };
  const loads = () => calls.filter((c) => c.startsWith('load') || c.startsWith('seek'));
  return { engine, calls, settle, at, loads, advanceTimers };
}

const maher = getReciter('maher')!;
const sobhi = getReciter('islam-sobhi')!;
const abdulbasit = getReciter('abdulbasit')!;
const minshawi = getReciter('minshawi')!;
const url = (reciter: Reciter, surah: number) => surahAudioUrl(reciter, surah);

describe('starting playback', () => {
  it('plays a Mushaf page from its first ayah (page 3 begins at Al-Baqara 6)', async () => {
    const t = setup();
    t.engine.startPage(3, 'maher');
    await t.settle();
    const state = t.engine.getState();
    expect(state.phase).toBe('playing');
    expect(state.position).toEqual({ surah: 2, ayah: 6 });
    expect(state.reciterId).toBe('maher');
    expect(t.loads()).toEqual([`load ${url(maher, 2)} @${startOf(6)}`]);
    expect(t.calls).toContain('play');
  });

  it('starts a surah\'s ayah 1 from the file\'s start (its istiʿādha and Basmala), never inside the opening', async () => {
    const t = setup();
    t.engine.start({ surah: 18, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    expect(t.loads()).toEqual([`load ${url(maher, 18)} @0`]);
  });

  it('starts from a selected ayah', async () => {
    const t = setup();
    t.engine.start({ surah: 18, ayah: 10 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 18, ayah: 10 });
    expect(t.loads()).toEqual([`load ${url(abdulbasit, 18)} @${startOf(10)}`]);
  });

  it('refuses a surah the reciter has no verified recording of (no load, no other voice)', async () => {
    // Fixture: Al-Minshawi without verified timing of surah 54.
    const t = setup({ without: ['minshawi:54'] });
    t.engine.start({ surah: 54, ayah: 1 }, { mode: 'continuous', reciterId: 'minshawi' });
    await t.settle();
    const state = t.engine.getState();
    expect(state.phase).toBe('error');
    expect(state.error).toEqual({ kind: 'unavailable', surah: 54, reciterId: 'minshawi' });
    expect(t.loads()).toEqual([]);
  });

  it('a surah the reciter has no verified timing of never plays in its voice: Al-Minshawi (verified) plays instead; neither: unavailable', async () => {
    // Saleh Al-Talib 2: no recording anywhere; Islam Sobhi 17: listed by MP3Quran, structure unresolved (no timing).
    for (const [reciterId, surah] of [['saleh-talib', 2], ['islam-sobhi', 17]] as const) {
      const t = setup();
      t.engine.start({ surah, ayah: 1 }, { mode: 'continuous', reciterId });
      await t.settle();
      expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'minshawi', preferredReciterId: reciterId, error: null });
      // Never a URL of the reciter asked for: Al-Minshawi's own file.
      expect(t.loads()).toEqual([`load ${url(minshawi, surah)} @0`]);
    }
    // Surah 54 with a fixture Al-Minshawi without it: neither has verified timing: the usual error, nothing loaded.
    const u = setup({ without: ['minshawi:54'] });
    u.engine.start({ surah: 54, ayah: 1 }, { mode: 'continuous', reciterId: 'saleh-talib' });
    await u.settle();
    expect(u.engine.getState()).toMatchObject({ phase: 'error', reciterId: 'saleh-talib', error: { kind: 'unavailable', surah: 54, reciterId: 'saleh-talib' } });
    u.engine.retry();
    await u.settle();
    expect(u.loads()).toEqual([]);
  });

  it('choosing a Sheikh without the current surah (Saleh Al-Talib, 2) while another recites is refused with a notice, never substituted', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 3 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.selectReciter('saleh-talib');
    expect(t.engine.getState()).toMatchObject({ reciterId: 'maher', pendingReciterId: null, notice: { kind: 'reciter-unavailable', reciterId: 'saleh-talib', surah: 2 } });
    expect(t.loads()).toHaveLength(1);
  });

  it('a new start replaces what was playing (one player)', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 255 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.start({ surah: 94, ayah: 5 }, { mode: 'single', reciterId: 'maher' });
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 94, ayah: 5 });
    expect(t.engine.getState().mode).toBe('single');
    expect(t.engine.getState().session).toBe(2);
  });
});

describe('continuous recitation', () => {
  it('moves to the next ayah in the same file without seeking', async () => {
    const t = setup();
    t.engine.start({ surah: 1, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(1) + 500);
    await t.at(endOf(1) - 20);
    expect(t.engine.getState().position).toEqual({ surah: 1, ayah: 2 });
    expect(t.loads()).toHaveLength(1);
  });

  it('continues into the next surah from its start after a surah\'s last ayah', async () => {
    const t = setup();
    t.engine.start({ surah: 1, ayah: 7 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(7) + 100);
    await t.at(endOf(7));
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 1 });
    expect(t.loads()).toEqual([`load ${url(maher, 1)} @${startOf(7)}`, `load ${url(maher, 2)} @0`]);
    expect(t.engine.getState().phase).toBe('playing');
  });

  it('preloads the next surah on a surah\'s last ayah', async () => {
    const t = setup();
    t.engine.start({ surah: 1, ayah: 6 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(6) + 100);
    await t.at(endOf(6));
    expect(t.calls).toContain(`preload ${url(maher, 2)}`);
  });

  it('the recited ayah\'s page is the one to show (automatic page turning)', () => {
    expect(pageOfPosition({ surah: 2, ayah: 5 })).toBe(2);
    expect(pageOfPosition({ surah: 2, ayah: 6 })).toBe(3);
    expect(pageOfPosition({ surah: 114, ayah: 6 })).toBe(604);
  });

  it('stops gracefully after An-Nas 6', async () => {
    const t = setup();
    t.engine.start({ surah: 114, ayah: 6 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(6) + 100);
    await t.at(endOf(6));
    expect(t.engine.getState().phase).toBe('ended');
    expect(t.engine.getState().position).toEqual({ surah: 114, ayah: 6 });
    expect(t.calls.at(-1)).toBe('stop');
  });

  it('a stale position right after a load never counts as the new ayah\'s end', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 10 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    // The player still reports the previous file's later position.
    await t.at(endOf(40));
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 10 });
    await t.at(startOf(10) + 50);
    await t.at(endOf(10));
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 11 });
  });
});

describe('controls', () => {
  it('next / previous move one ayah, across surahs', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.skip(-1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 1, ayah: 7 });
    t.engine.skip(1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 1 });
    t.engine.skip(1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 2 });
    // Same file: a seek, not a reload.
    expect(t.loads().at(-1)).toBe(`seek @${startOf(2)}`);
  });

  it('pause and resume', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.toggle();
    expect(t.engine.getState().phase).toBe('paused');
    expect(t.calls.at(-1)).toBe('pause');
    // A paused player never moves on.
    await t.at(endOf(1), { playing: false });
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 1 });
    t.engine.toggle();
    expect(t.engine.getState().phase).toBe('playing');
    expect(t.calls.at(-1)).toBe('play');
  });

  it('Previous / Next play the ayah (from a pause too), loading the right recording across surahs', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.pause();
    t.engine.skip(1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 2, ayah: 2 } });
    expect(t.calls.at(-1)).toBe('play');
    t.engine.pause();
    t.engine.skip(-1);
    t.engine.skip(-1);
    await t.settle();
    // Across the surah boundary: Al-Fatiha's file, at its last ayah; the earlier skip's load never plays as well.
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 1, ayah: 7 } });
    expect(t.loads().at(-1)).toBe(`load ${url(maher, 1)} @${startOf(7)}`);
    expect(t.calls.filter((c) => c === 'play')).toHaveLength(3);
  });

  it('nothing before Al-Fatiha 1 or after An-Nas 6', async () => {
    const t = setup();
    t.engine.start({ surah: 1, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    const before = t.loads().length;
    t.engine.skip(-1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 1, ayah: 1 });
    t.engine.start({ surah: 114, ayah: 6 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.skip(1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 114, ayah: 6 });
    expect(t.loads()).toHaveLength(before + 1);
  });

  it('Next into a surah the reciter has no verified recording of stops there with a message (no verse skipped, no other voice)', async () => {
    const t = setup({ without: ['minshawi:52'] }); // fixture: Al-Minshawi without 52
    t.engine.start({ surah: 51, ayah: 60 }, { mode: 'continuous', reciterId: 'minshawi' });
    await t.settle();
    expect(t.engine.getState().phase).toBe('playing');
    t.engine.skip(1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'error', position: { surah: 52, ayah: 1 }, reciterId: 'minshawi', error: { kind: 'unavailable', surah: 52 } });
  });

  it('pausing while an ayah loads shows paused at once and stays paused once it has loaded; resume then plays it', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    t.engine.pause();
    expect(t.engine.getState().phase).toBe('paused');
    await t.settle();
    expect(t.engine.getState().phase).toBe('paused');
    expect(t.calls).not.toContain('play');
    t.engine.resume();
    expect(t.engine.getState().phase).toBe('playing');
    expect(t.calls.at(-1)).toBe('play');
  });

  it('follows a pause from outside the app (a call, the lock screen), and its resume', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(1) + 100);
    await t.at(startOf(1) + 200, { playing: false });
    expect(t.engine.getState().phase).toBe('paused');
    await t.at(startOf(1) + 300, { playing: true });
    expect(t.engine.getState().phase).toBe('playing');
  });

  it('stop releases everything and returns to idle', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.selectReciter('abdulbasit');
    t.engine.stop();
    const state = t.engine.getState();
    expect(state).toMatchObject({ phase: 'idle', position: null, reciterId: null, pendingReciterId: null, sessionReciterId: null });
    expect(t.calls.at(-1)).toBe('stop');
  });
});

describe('changing the reciter during playback', () => {
  async function playing(position = { surah: 2, ayah: 3 }, without: readonly string[] = []) {
    const t = setup({ without });
    t.engine.start(position, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(position.ayah) + 100);
    return t;
  }

  it('finishes the current ayah in the original voice, then switches at the next ayah', async () => {
    const t = await playing();
    t.engine.selectReciter('abdulbasit');
    expect(t.engine.getState()).toMatchObject({ reciterId: 'maher', pendingReciterId: 'abdulbasit' });
    // Mid-ayah: nothing changes, nothing is interrupted.
    await t.at(startOf(3) + 5000);
    expect(t.engine.getState()).toMatchObject({ reciterId: 'maher', pendingReciterId: 'abdulbasit', position: { surah: 2, ayah: 3 } });
    expect(t.calls).not.toContain('pause');
    expect(t.loads()).toEqual([`load ${url(maher, 2)} @${startOf(3)}`]);
    // The ayah's end: the next ayah begins in the new voice.
    await t.at(endOf(3));
    expect(t.engine.getState()).toMatchObject({ reciterId: 'abdulbasit', pendingReciterId: null, position: { surah: 2, ayah: 4 }, phase: 'playing' });
    expect(t.loads().at(-1)).toBe(`load ${url(abdulbasit, 2)} @${startOf(4)}`);
  });

  it('several changes during one ayah: the last one wins', async () => {
    const t = await playing();
    t.engine.selectReciter('abdulbasit');
    t.engine.selectReciter('minshawi');
    t.engine.selectReciter('naina');
    expect(t.engine.getState().pendingReciterId).toBe('naina');
    await t.at(endOf(3));
    expect(t.engine.getState().reciterId).toBe('naina');
  });

  it('choosing the current voice again cancels the pending change', async () => {
    const t = await playing();
    t.engine.selectReciter('abdulbasit');
    t.engine.selectReciter('maher');
    expect(t.engine.getState().pendingReciterId).toBeNull();
    await t.at(endOf(3));
    expect(t.engine.getState().reciterId).toBe('maher');
    expect(t.loads()).toHaveLength(1);
  });

  it('a manual skip applies the pending reciter at once', async () => {
    const t = await playing();
    t.engine.selectReciter('abdulbasit');
    t.engine.skip(1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ reciterId: 'abdulbasit', pendingReciterId: null, position: { surah: 2, ayah: 4 } });
    expect(t.loads().at(-1)).toBe(`load ${url(abdulbasit, 2)} @${startOf(4)}`);
  });

  it('pausing keeps the pending choice; after resuming the switch still happens at the boundary', async () => {
    const t = await playing();
    t.engine.selectReciter('abdulbasit');
    t.engine.pause();
    expect(t.engine.getState()).toMatchObject({ phase: 'paused', pendingReciterId: 'abdulbasit', reciterId: 'maher' });
    t.engine.resume();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', pendingReciterId: 'abdulbasit', reciterId: 'maher' });
    await t.at(endOf(3));
    expect(t.engine.getState().reciterId).toBe('abdulbasit');
  });

  it('a reciter without the coming surah is refused with a notice, never substituted', async () => {
    // Fixture: Al-Minshawi without verified timing of surah 54; the next ayah after 53's last (62) is 54:1.
    const t = await playing({ surah: 53, ayah: 62 }, ['minshawi:54']);
    t.engine.selectReciter('minshawi');
    expect(t.engine.getState().pendingReciterId).toBeNull();
    expect(t.engine.getState().notice).toEqual({ kind: 'reciter-unavailable', reciterId: 'minshawi', surah: 54 });
    await t.at(endOf(62));
    expect(t.engine.getState()).toMatchObject({ reciterId: 'maher', position: { surah: 54, ayah: 1 } });
  });

  it('continuing into a surah the current voice lacks stops with a message instead of another voice', async () => {
    // Fixture: Al-Minshawi has 51 (60 ayahs) but not 52.
    const t = setup({ without: ['minshawi:52'] });
    expect(minshawi.timed[51]).toBeDefined();
    t.engine.start({ surah: 51, ayah: 60 }, { mode: 'continuous', reciterId: 'minshawi' });
    await t.settle();
    await t.at(startOf(60) + 100);
    await t.at(endOf(60));
    expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'unavailable', surah: 52, reciterId: 'minshawi' }, position: { surah: 52, ayah: 1 } });
    // Choosing another reciter there resumes at that ayah in the chosen voice.
    t.engine.selectReciter('maher');
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'maher', position: { surah: 52, ayah: 1 } });
  });

  it('the player\'s choice becomes the session reciter until the player is closed', async () => {
    const t = await playing();
    t.engine.selectReciter('abdulbasit');
    expect(t.engine.getState().sessionReciterId).toBe('abdulbasit');
    t.engine.stop();
    expect(t.engine.getState().sessionReciterId).toBeNull();
  });

  it('the ayah screens\' single-ayah playback does not keep a session reciter', async () => {
    const t = await playing();
    t.engine.selectReciter('abdulbasit');
    t.engine.start({ surah: 94, ayah: 5 }, { mode: 'single', reciterId: 'maher' });
    await t.settle();
    expect(t.engine.getState().sessionReciterId).toBeNull();
    expect(t.engine.getState().reciterId).toBe('maher');
  });
});

describe('the app owns its audio (Android: closed from Recents, a car, a stale notification)', () => {
  it('the app closed while reciting: stopped and idle; nothing plays afterwards, not even at the ayah`s end', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(1) + 100);
    await t.at(startOf(1) + 200, { playing: false, closed: true });
    expect(t.engine.getState()).toMatchObject({ phase: 'idle', position: null });
    expect(t.calls.at(-1)).toBe('stop');
    const before = t.calls.length;
    await t.at(endOf(1));
    expect(t.calls.slice(before)).not.toContain('play');
    expect(t.engine.getState().phase).toBe('idle');
  });

  it('the app closed while an ayah loads: the load never plays', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.at(0, { playing: false, loaded: false, closed: true });
    await t.settle();
    expect(t.engine.getState().phase).toBe('idle');
    expect(t.calls).not.toContain('play');
  });

  it('a play from outside after one ayah ended (the ayah screens) is paused again: the app shows nothing playing', async () => {
    const t = setup();
    t.engine.start({ surah: 94, ayah: 5 }, { mode: 'single', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(5) + 100);
    await t.at(endOf(5));
    expect(t.engine.getState().phase).toBe('ended');
    await t.at(endOf(5) + 100, { playing: true });
    expect(t.calls.at(-1)).toBe('pause');
    expect(t.engine.getState().phase).toBe('ended');
  });

  it('paused while loading, a play from outside meanwhile: still paused once loaded, the player too', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    t.engine.pause();
    await t.at(0, { playing: true, loaded: false });
    await t.settle();
    expect(t.engine.getState().phase).toBe('paused');
    expect(t.calls).not.toContain('play');
    expect(t.calls.at(-1)).not.toBe('play');
    expect(t.calls.filter((c) => c === 'pause').length).toBeGreaterThan(0);
  });

  it('a paused recitation resumed from the lock screen or notification is still followed (background playback unchanged)', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.pause();
    await t.at(startOf(1) + 100, { playing: true });
    expect(t.engine.getState().phase).toBe('playing');
    expect(t.calls.at(-1)).toBe('pause');
  });
});

describe('another app records or calls (Android audio focus): paused, never resumed by itself', () => {
  const interrupted: Partial<OutputStatus> = { playing: false, interrupted: true };

  it('while reciting: paused at once; the ayah`s end and later reports never resume it', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(1) + 100);
    await t.at(startOf(1) + 200, interrupted);
    expect(t.engine.getState().phase).toBe('paused');
    const before = t.calls.length;
    // The recording ends: the focus comes back natively, which reports nothing that plays.
    await t.at(startOf(1) + 200, { playing: false });
    await t.at(endOf(1), { playing: false });
    expect(t.calls.slice(before)).not.toContain('play');
    expect(t.engine.getState()).toMatchObject({ phase: 'paused', position: { surah: 2, ayah: 1 } });
  });

  it('while the first ayah loads: it never plays once loaded', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.at(0, { ...interrupted, loaded: false });
    await t.settle();
    expect(t.engine.getState().phase).toBe('paused');
    expect(t.calls.filter((c) => c === 'play')).toEqual([]);
  });

  it('during the transition into the next surah (a new file loading): it never plays once loaded', async () => {
    const t = setup();
    t.engine.start({ surah: 1, ayah: 7 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(7) + 100);
    const plays = t.calls.filter((c) => c === 'play').length;
    // The ayah ends (the next surah starts loading), and the recording starts in the same moment.
    const ending = t.at(endOf(7));
    await t.at(0, { ...interrupted, loaded: false });
    await ending;
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'paused', position: { surah: 2, ayah: 1 } });
    expect(t.calls.filter((c) => c === 'play')).toHaveLength(plays);
    expect(t.calls.at(-1)).not.toBe('play');
  });

  it('Repeat Ayah: interrupted while the repeat seeks back, it stays paused', async () => {
    const t = setup();
    t.engine.setRepeat(2);
    t.engine.start({ surah: 2, ayah: 5 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(5) + 100);
    const plays = t.calls.filter((c) => c === 'play').length;
    const ending = t.at(endOf(5));
    await t.at(endOf(5), interrupted);
    await ending;
    await t.settle();
    expect(t.engine.getState().phase).toBe('paused');
    expect(t.calls.filter((c) => c === 'play')).toHaveLength(plays);
  });

  it('the ayah screens` single ayah and Full Surah pause the same way', async () => {
    for (const start of [
      (t: ReturnType<typeof setup>) => t.engine.start({ surah: 94, ayah: 5 }, { mode: 'single', reciterId: 'maher' }),
      (t: ReturnType<typeof setup>) => t.engine.startFullSurah(94, 'maher'),
    ]) {
      const t = setup();
      start(t);
      await t.settle();
      await t.at(startOf(t.engine.getState().position!.ayah) + 100);
      await t.at(startOf(t.engine.getState().position!.ayah) + 200, interrupted);
      expect(t.engine.getState().phase).toBe('paused');
    }
  });

  it('only the reader`s own requests claim playback back, always before playing; the engine never claims by itself', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    expect(t.calls[0]).toBe('claim');
    await t.settle();
    await t.at(startOf(1) + 100);
    // Ayah after ayah, the engine never claims.
    const claims = () => t.calls.filter((c) => c === 'claim').length;
    await t.at(endOf(1));
    await t.at(endOf(2));
    expect(claims()).toBe(1);
    await t.at(endOf(2) + 100, interrupted);
    expect(t.engine.getState().phase).toBe('paused');
    // The reader presses play.
    t.engine.resume();
    expect(t.calls.slice(-2)).toEqual(['claim', 'play']);
    expect(t.engine.getState().phase).toBe('playing');
    for (const press of [() => t.engine.skip(1), () => t.engine.skipPage(1), () => t.engine.retry()]) {
      const before = claims();
      press();
      expect(claims()).toBe(before + 1);
      await t.settle();
    }
  });

  it('not playing (paused, ended, idle): an interruption changes nothing and plays nothing', async () => {
    const t = setup();
    await t.at(0, interrupted);
    expect(t.engine.getState().phase).toBe('idle');
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.pause();
    const before = t.calls.length;
    await t.at(startOf(1) + 100, interrupted);
    expect(t.engine.getState().phase).toBe('paused');
    expect(t.calls.slice(before)).not.toContain('play');
  });
});

describe('one ayah (the ayah screens)', () => {
  it('plays the ayah and stops at its end, without moving on', async () => {
    const t = setup();
    t.engine.start({ surah: 94, ayah: 5 }, { mode: 'single', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(5) + 100);
    await t.at(endOf(5));
    expect(t.engine.getState()).toMatchObject({ phase: 'ended', position: { surah: 94, ayah: 5 } });
    expect(t.loads()).toHaveLength(1);
  });

  it('replays from the ayah\'s start', async () => {
    const t = setup();
    t.engine.start({ surah: 94, ayah: 5 }, { mode: 'single', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(5) + 100);
    await t.at(endOf(5));
    t.engine.resume();
    await t.settle();
    expect(t.engine.getState().phase).toBe('playing');
    expect(t.loads().at(-1)).toBe(`seek @${startOf(5)}`);
  });
});

describe('failures', () => {
  it('a network failure is retried by itself, then reported with Retry', async () => {
    let online = false;
    const t = setup({ failLoad: () => !online });
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    expect(t.engine.getState().error?.kind).toBe('network');
    await t.advanceTimers(RETRY_DELAYS_MS[0]);
    expect(t.engine.getState().error?.kind).toBe('network');
    await t.advanceTimers(RETRY_DELAYS_MS[1]);
    expect(t.engine.getState().phase).toBe('error');
    // No further automatic attempts.
    const attempts = t.loads().length;
    await t.advanceTimers(60_000);
    expect(t.loads()).toHaveLength(attempts);
    online = true;
    t.engine.retry();
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 2, ayah: 1 }, error: null });
  });

  it('timing that no longer matches the audit is never used', async () => {
    const t = setup({ timing: () => ({ ok: false, reason: 'mismatch' }) });
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    expect(t.engine.getState().error?.kind).toBe('mismatch');
    expect(t.loads()).toEqual([]);
  });

  it('an error while streaming stops at that ayah, ready to retry from its start', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 1 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    await t.at(startOf(1) + 100);
    await t.at(startOf(1) + 200, { error: 'connection lost' });
    expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'network' }, position: { surah: 2, ayah: 1 } });
    t.engine.retry();
    await t.settle();
    expect(t.loads().at(-1)).toBe(`load ${url(maher, 2)} @0`);
  });
});

describe('session ownership (the ayah screens)', () => {
  it('start returns its session; release stops exactly that session, and only while it is the current one', async () => {
    const t = setup();
    const first = t.engine.start({ surah: 94, ayah: 5 }, { mode: 'single', reciterId: 'maher' })!;
    await t.settle();
    const second = t.engine.start({ surah: 2, ayah: 255 }, { mode: 'continuous', reciterId: 'maher' })!;
    await t.settle();
    expect(second).toBe(first + 1);
    t.engine.release(first); // an older session: the Mushaf's recitation carries on
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', mode: 'continuous' });
    t.engine.release(second);
    expect(t.engine.getState().phase).toBe('idle');
    expect(() => t.engine.release(second)).not.toThrow(); // idempotent
    expect(t.engine.getState().phase).toBe('idle');
  });

  it('a session released while its timing and audio are still loading never plays afterwards', async () => {
    const t = setup();
    const session = t.engine.start({ surah: 94, ayah: 5 }, { mode: 'single', reciterId: 'maher' })!;
    expect(t.engine.getState().phase).toBe('loading'); // timing not loaded yet
    t.engine.release(session);
    await t.settle();
    expect(t.engine.getState().phase).toBe('idle');
    expect(t.calls).not.toContain('play');
  });
});

describe('page jumps (the audio window`s Previous / Next page)', () => {
  it('Next page: from the recited page to the next page`s first ayah, playing (from a pause too)', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 10 }, { mode: 'continuous', reciterId: 'maher' }); // page 3 (2:6–2:16)
    await t.settle();
    t.engine.pause();
    t.engine.skipPage(1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 2, ayah: 17 } }); // page 4 begins at 2:17
    expect(pageOfPosition(t.engine.getState().position!)).toBe(4);
    expect(t.loads().at(-1)).toBe(`seek @${startOf(17)}`);
  });

  it('Previous page: the previous page`s first ayah, across a surah (page 50 → 49 begins at 2:283)', async () => {
    const t = setup();
    t.engine.start({ surah: 3, ayah: 5 }, { mode: 'continuous', reciterId: 'maher' }); // page 50 (3:1–3:9)
    await t.settle();
    t.engine.skipPage(-1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 2, ayah: 283 } });
    expect(t.loads().at(-1)).toBe(`load ${url(maher, 2)} @${startOf(283)}`);
  });

  it('nothing before page 1 or after page 604', async () => {
    const t = setup();
    t.engine.start({ surah: 1, ayah: 3 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.skipPage(-1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 1, ayah: 3 });
    t.engine.start({ surah: 114, ayah: 2 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.skipPage(1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 114, ayah: 2 });
  });

  it('a pending reciter takes over at once; one without the target surah stops there with its message', async () => {
    const t = setup({ without: ['minshawi:52'] }); // fixture: Al-Minshawi without 52
    t.engine.start({ surah: 2, ayah: 10 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.selectReciter('abdulbasit');
    t.engine.skipPage(1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ reciterId: 'abdulbasit', pendingReciterId: null, position: { surah: 2, ayah: 17 } });
    // Al-Minshawi (fixture) has 51 but not 52: page 523 begins at 51:52, page 524 at 52:15.
    t.engine.start({ surah: 51, ayah: 52 }, { mode: 'continuous', reciterId: 'minshawi' });
    await t.settle();
    expect(t.engine.getState().phase).toBe('playing');
    t.engine.skipPage(1);
    await t.settle();
    const state = t.engine.getState();
    expect(state.phase).toBe('error');
    expect(state.error).toMatchObject({ kind: 'unavailable', reciterId: 'minshawi' });
    expect(state.reciterId).toBe('minshawi');
    expect(state.position).toEqual({ surah: 52, ayah: 15 }); // the target ayah, not skipped
  });

  it('rapid jumps: the last one wins, one recording at a time', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 10 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    t.engine.skipPage(1);
    t.engine.skipPage(1);
    t.engine.skipPage(1);
    await t.settle();
    // Each jump starts from the position the previous one set: page 3 → 4 → 5 → 6.
    expect(pageOfPosition(t.engine.getState().position!)).toBe(6);
    expect(t.engine.getState().phase).toBe('playing');
    expect(t.calls.filter((c) => c === 'play').length).toBeLessThanOrEqual(2);
  });
});

// The measured-timing path (also Ali Al-Hudhaifi's), here with Mahmoud Ali Al-Banna (surah 108, measured for his MP3Quran file).
describe('a reciter with measured timing (Mahmoud Ali Al-Banna)', () => {
  const banna = getReciter('banna')!;
  /** The timing the app would load: the shipped measured timing, verified against the catalogue. */
  const real = (reciter: Reciter, surah: number): TimingResult => {
    const timing = verifyTiming(reciter, surah, measuredTimingEntries(reciter.id, surah) ?? []);
    return timing ? { ok: true, timing } : { ok: false, reason: 'unavailable' };
  };
  const surah = [112, ...Object.keys(banna.timed).map(Number)].find((s) => banna.timed[s] && measuredTimingEntries('banna', s) && SURAH_AYAH_COUNTS[s - 1] >= 3)!;
  const timing = (real(banna, surah) as { ok: true; timing: SurahTiming }).timing;

  it('starts the MP3Quran file at the measured start of the ayah, and carries on through the next without reloading', async () => {
    const t = setup({ timing: real });
    t.engine.start({ surah, ayah: 2 }, { mode: 'continuous', reciterId: 'banna' });
    await t.settle();
    expect(t.loads()).toEqual([`load ${url(banna, surah)} @${timing.ayahs[1].startMs}`]);
    expect(url(banna, surah)).toMatch(/^https:\/\/cdn\.mp3quran\.net\/audio\/mahmoud-banna\/r1\//);
    await t.at(timing.ayahs[1].startMs + 100);
    await t.at(timing.ayahs[1].endMs);
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah, ayah: 3 }, reciterId: 'banna' });
    expect(t.loads()).toHaveLength(1);
  });

  it('plays ayah 1 from the start of the file, and a single ayah stops at its measured end', async () => {
    const t = setup({ timing: real });
    t.engine.start({ surah, ayah: 1 }, { mode: 'single', reciterId: 'banna' });
    await t.settle();
    expect(t.loads()).toEqual([`load ${url(banna, surah)} @0`]);
    await t.at(timing.ayahs[0].startMs + 100);
    await t.at(timing.ayahs[0].endMs - 100);
    expect(t.engine.getState().phase).toBe('playing');
    await t.at(timing.ayahs[0].endMs);
    expect(t.engine.getState()).toMatchObject({ phase: 'ended', position: { surah, ayah: 1 } });
  });

  it('a surah without measured timing is never played with other timing: the default reciter plays it, with his own', async () => {
    const missing = Array.from({ length: 114 }, (_, i) => i + 1).find((s) => !banna.timed[s] && minshawi.timed[s]);
    if (missing === undefined) return;
    const t = setup();
    t.engine.start({ surah: missing, ayah: 1 }, { mode: 'continuous', reciterId: 'banna' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'minshawi', preferredReciterId: 'banna' });
    expect(t.loads()).toEqual([`load ${url(minshawi, missing)} @0`]);
  });
});

// Owner, 2026-10-24: Al-Minshawi is the default reciter and the fallback where the reciter asked for has no verified
// recording of a surah (reciters.ts DEFAULT_RECITER_ID, engine.ts voiceFor). This build: Islam Sobhi has 16 and 18 but
// not 17 (unresolved structure); Saleh Al-Talib has neither 53 nor 54; Al-Minshawi has all 114, so his lacking 54 is a fixture.
describe('fallback to Al-Minshawi', () => {
  const last = (surah: number) => SURAH_AYAH_COUNTS[surah - 1];

  it('the reciter asked for plays wherever it has a verified recording: no fallback', async () => {
    const t = setup();
    t.engine.start({ surah: 18, ayah: 3 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'islam-sobhi', preferredReciterId: 'islam-sobhi' });
    expect(t.loads().join(' ')).not.toContain('minshawi');
  });

  it('continuous: into a surah it has no recording of, Al-Minshawi at the ayah boundary; back at the next surah it has', async () => {
    const t = setup();
    t.engine.start({ surah: 16, ayah: last(16) }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    await t.at(startOf(last(16)) + 100);
    await t.at(endOf(last(16)));
    // A new surah: switched exactly at the boundary, from 17:1 (no ayah skipped, nothing mid-ayah).
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 17, ayah: 1 }, reciterId: 'minshawi', preferredReciterId: 'islam-sobhi' });
    expect(t.loads().at(-1)).toBe(`load ${url(minshawi, 17)} @0`);
    // Within the surah: the same voice, the same file, ayah after ayah.
    await t.at(startOf(1) + 100);
    await t.at(endOf(1));
    expect(t.engine.getState()).toMatchObject({ position: { surah: 17, ayah: 2 }, reciterId: 'minshawi' });
    // The last ayah of 17, then 18, where Islam Sobhi has a recording again.
    const u = setup();
    u.engine.start({ surah: 17, ayah: last(17) }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await u.settle();
    expect(u.engine.getState()).toMatchObject({ reciterId: 'minshawi', preferredReciterId: 'islam-sobhi' });
    await u.at(startOf(last(17)) + 100);
    await u.at(endOf(last(17)));
    expect(u.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 18, ayah: 1 }, reciterId: 'islam-sobhi', preferredReciterId: 'islam-sobhi' });
    expect(u.loads().at(-1)).toBe(`load ${url(sobhi, 18)} @0`);
  });

  it('neither has a recording: the usual unavailable error at that surah, never a skip and never a third voice', async () => {
    const t = setup({ without: ['minshawi:54'] });
    t.engine.start({ surah: 53, ayah: last(53) }, { mode: 'continuous', reciterId: 'saleh-talib' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ reciterId: 'minshawi', preferredReciterId: 'saleh-talib' });
    await t.at(startOf(last(53)) + 100);
    await t.at(endOf(last(53)));
    expect(t.engine.getState()).toMatchObject({ phase: 'error', position: { surah: 54, ayah: 1 }, error: { kind: 'unavailable', surah: 54, reciterId: 'saleh-talib' } });
    expect(t.loads().some((c) => c.includes('/054.mp3') || c.includes('/055.mp3'))).toBe(false);
  });

  it('the ayah screens, Full Surah, Repeat and skips use the same rule; the reciter asked for is never replaced', async () => {
    const single = setup();
    single.engine.start({ surah: 17, ayah: 3 }, { mode: 'single', reciterId: 'islam-sobhi' });
    await single.settle();
    expect(single.engine.getState()).toMatchObject({ phase: 'playing', mode: 'single', reciterId: 'minshawi', preferredReciterId: 'islam-sobhi' });
    expect(single.loads()).toEqual([`load ${url(minshawi, 17)} @${startOf(3)}`]);

    const full = setup();
    full.engine.startFullSurah(17, 'islam-sobhi');
    await full.settle();
    expect(full.engine.getState()).toMatchObject({ mode: 'fullSurah', reciterId: 'minshawi', preferredReciterId: 'islam-sobhi' });
    full.engine.skip(1);
    await full.settle();
    expect(full.engine.getState()).toMatchObject({ position: { surah: 17, ayah: 2 }, reciterId: 'minshawi' });

    const repeat = setup();
    repeat.engine.setRepeat(1);
    repeat.engine.start({ surah: 17, ayah: 2 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await repeat.settle();
    await repeat.at(startOf(2) + 100);
    await repeat.at(endOf(2));
    expect(repeat.engine.getState()).toMatchObject({ position: { surah: 17, ayah: 2 }, reciterId: 'minshawi' });
    expect(repeat.loads().at(-1)).toBe(`seek @${startOf(2)}`);

    // Previous from 18:1 (Islam Sobhi) into 17 (none): Al-Minshawi; Next back into 18: Islam Sobhi.
    const skip = setup();
    skip.engine.start({ surah: 18, ayah: 1 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await skip.settle();
    skip.engine.skip(-1);
    await skip.settle();
    expect(skip.engine.getState()).toMatchObject({ position: { surah: 17, ayah: last(17) }, reciterId: 'minshawi', preferredReciterId: 'islam-sobhi' });
    skip.engine.skip(1);
    await skip.settle();
    expect(skip.engine.getState()).toMatchObject({ position: { surah: 18, ayah: 1 }, reciterId: 'islam-sobhi' });
  });

  it('a reciter chosen in the player is the one asked for from then on; idle again after stop', async () => {
    const t = setup();
    t.engine.start({ surah: 6, ayah: 2 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await t.settle();
    t.engine.selectReciter('maher');
    await t.at(startOf(2) + 100);
    await t.at(endOf(2));
    expect(t.engine.getState()).toMatchObject({ reciterId: 'maher', preferredReciterId: 'maher' });
    t.engine.stop();
    expect(t.engine.getState()).toMatchObject({ phase: 'idle', reciterId: null, preferredReciterId: null });
  });
});
