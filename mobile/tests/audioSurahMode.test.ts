import { describe, expect, it } from 'vitest';

import { COMMAND_GRACE_MS, createPlaybackEngine, RETRY_DELAYS_MS, type AudioOutput, type OutputStatus, type StreamCheck } from '@/audio/engine';
import { RECITERS, type Reciter } from '@/audio/reciters';
import { SOURCE_REGISTRY } from '@/audio/sourceRegistry';
import { localFirstSource } from '@/audio/sources';
import type { SurahTiming, TimingLoader } from '@/audio/timing';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

import { approval, fixtureRegistry } from './helpers/audioRegistry';

const SOBHI = 'https://cdn.mp3quran.net/audio/islam-sobhi/r1/';
const MAHER = 'https://cdn.mp3quran.net/audio/maher-muaiqly/r3/';
const BASIT = 'https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/';
const MINSHAWI = 'https://cdn.mp3quran.net/audio/muhammad-minshawi/r1/';
const url = (base: string, surah: number) => `${base}${String(surah).padStart(3, '0')}.mp3`;

/**
 * Islam Sobhi in this fixture: 34 ayah by ayah (a verified source with timing), 35, 36 and 38 approved whole-surah
 * sources (no timing), 37 nothing (MP3Quran does not list it: its URL would redirect to Minshawi). Every other reciter
 * and surah is the real catalogue.
 */
const basit34 = SOURCE_REGISTRY.sourcesFor('abdulbasit', 34)[0];
const registry = fixtureRegistry({
  surahOnly: [approval('islam-sobhi', 35), approval('islam-sobhi', 36), approval('islam-sobhi', 38)],
  extra: [{ ...basit34, reciterId: 'islam-sobhi', url: url(SOBHI, 34) }],
});

/** Synthetic timing: a 4 s opening, then every ayah 10 s long. */
const timingFor = (reciter: Reciter, surah: number): SurahTiming => ({
  reciterId: reciter.id,
  surah,
  introEndMs: 4000,
  ayahs: Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => ({ startMs: 4000 + i * 10_000, endMs: 14_000 + i * 10_000 })),
});
const endOfSurah = (surah: number) => 4000 + SURAH_AYAH_COUNTS[surah - 1] * 10_000;
/** The verified length of the fixture's whole-surah files (tests/helpers/audioRegistry.ts): 600 s + 1 s per surah number. */
const LENGTH = (surah: number) => 600_000 + surah * 1000;

function setup(options: { failLoad?: (uri: string) => boolean; checkStream?: 'none' | ((uri: string, bytes: number | null) => Promise<StreamCheck>); timingNetworkFails?: boolean } = {}) {
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
  };
  const timingLoads: string[] = [];
  const timing: TimingLoader = {
    async load(reciter, surah) {
      timingLoads.push(`${reciter.id}:${surah}`);
      if (options.timingNetworkFails) return { ok: false, reason: 'network' };
      return registry.mode(reciter.id, surah) === 'ayah' ? { ok: true, timing: timingFor(reciter, surah) } : { ok: false, reason: 'unavailable' };
    },
    async stored() {
      return null;
    },
  };
  const checks: string[] = [];
  const engine = createPlaybackEngine({
    output,
    timing,
    capability: (reciter, surah) => registry.mode(reciter.id, surah),
    resolveSource: localFirstSource({ uri: async () => null }, registry),
    // The whole-surah stream check: passes unless a test says otherwise ('none': no checker at all).
    checkStream: options.checkStream === 'none' ? undefined : async (uri, bytes) => {
      checks.push(uri);
      return options.checkStream && options.checkStream !== 'none' ? options.checkStream(uri, bytes) : 'ok';
    },
    describe: (position, reciter) => ({ title: `${position.surah}:${position.ayah}`, artist: reciter.id }),
    now: () => clock,
    schedule: (run, ms) => {
      const timer = { at: clock + ms, run };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  /** The player reports a status (after the command grace period). */
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
  return { engine, calls, checks, settle, at, advanceTimers, loads, timingLoads };
}

async function wholeSurah36(t: ReturnType<typeof setup>) {
  t.engine.start({ surah: 36, ayah: 1 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
  await t.settle();
}

describe('surah-only mode: a complete recording without timing', () => {
  it('plays the whole surah from its start, never fetches timing, and reports no ayah', async () => {
    const t = setup();
    await wholeSurah36(t);
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'surah', position: { surah: 36, ayah: 0 }, reciterId: 'islam-sobhi', error: null });
    expect(t.loads()).toEqual([`load ${url(SOBHI, 36)} @0`]);
    // No timing for the whole surah; only the next surah's look-ahead, in the fallback voice (Sobhi has no 37).
    expect(t.timingLoads).toEqual(['minshawi:37']);
    expect(t.calls).toContain('now 36:0');
    // No ayah of the surah is ever "being recited".
    for (let ayah = 1; ayah <= SURAH_AYAH_COUNTS[35]; ayah++) expect(t.engine.isAt({ surah: 36, ayah })).toBe(false);
  });

  it('reports the place and the length in the file (a separate store), never as an ayah', async () => {
    const t = setup();
    await wholeSurah36(t);
    const state = t.engine.getState();
    const seen: number[] = [];
    t.engine.subscribeProgress((p) => seen.push(p.positionMs));
    await t.at(1000, { durationMs: LENGTH(36) });
    await t.at(65_000, { durationMs: LENGTH(36) });
    expect(t.engine.getProgress()).toEqual({ positionMs: 65_000, durationMs: LENGTH(36) });
    expect(seen).toEqual([1000, 65_000]);
    // The playback state did not change: the Mushaf is not re-rendered by the position.
    expect(t.engine.getState()).toBe(state);
    expect(t.engine.getState().position).toEqual({ surah: 36, ayah: 0 });
  });

  it('seeks within the surah (clamped to the file), pauses and resumes in place', async () => {
    const t = setup();
    await wholeSurah36(t);
    await t.at(1000, { durationMs: LENGTH(36) });
    t.engine.seekTo(300_000);
    t.engine.seekTo(9_999_999);
    t.engine.seekTo(-5);
    await t.settle();
    expect(t.loads().slice(1)).toEqual(['seek @300000', `seek @${LENGTH(36)}`, 'seek @0']);
    t.engine.pause();
    expect(t.engine.getState().phase).toBe('paused');
    t.engine.resume();
    expect(t.engine.getState().phase).toBe('playing');
    expect(t.loads()).toHaveLength(4); // resumed in place: no reload
  });

  it('ignores a stale end or position from the previous file right after loading', async () => {
    const t = setup();
    await wholeSurah36(t);
    await t.at(900_000, { finished: true });
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 36, ayah: 0 } });
    expect(t.engine.getProgress().positionMs).toBe(0);
  });

  it('at the end goes on to the next surah: whole again, or the verified ayah timing of Al-Minshawi where the reciter has none', async () => {
    const t = setup();
    t.engine.start({ surah: 35, ayah: 1 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    await t.at(1000, { durationMs: LENGTH(35) });
    await t.at(LENGTH(35), { finished: true, playing: false });
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'surah', position: { surah: 36, ayah: 0 } });
    await t.at(1000, { durationMs: LENGTH(36) });
    await t.at(LENGTH(36), { finished: true, playing: false });
    // Fallback (default reciter): ayah by ayah, verified timing, his own file; the reciter asked for is kept.
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'ayah', position: { surah: 37, ayah: 1 }, reciterId: 'minshawi', preferredReciterId: 'islam-sobhi' });
    expect(t.loads().at(-1)).toBe(`load ${url(MINSHAWI, 37)} @0`);
    expect(t.loads().join(' ')).not.toContain(url(SOBHI, 37));
  });

  it('detects the end from the position when the player does not report it', async () => {
    const t = setup();
    await wholeSurah36(t);
    await t.at(1000, { durationMs: LENGTH(36) });
    await t.at(LENGTH(36) - 100, { playing: false });
    expect(t.engine.getState().position).toEqual({ surah: 37, ayah: 1 });
  });

  it('continues from ayah playback into a whole-surah surah at its start, and back into ayah playback', async () => {
    const t = setup();
    t.engine.start({ surah: 34, ayah: SURAH_AYAH_COUNTS[33] }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ granularity: 'ayah', position: { surah: 34, ayah: 54 } });
    await t.at(endOfSurah(34) - 5000);
    await t.at(endOfSurah(34));
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'surah', position: { surah: 35, ayah: 0 } });
    expect(t.loads().at(-1)).toBe(`load ${url(SOBHI, 35)} @0`);
    expect(t.timingLoads).not.toContain('islam-sobhi:35');
  });

  it('Previous / Next move by surah (to its start), and never by page', async () => {
    const t = setup();
    await wholeSurah36(t);
    t.engine.skip(-1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ granularity: 'surah', position: { surah: 35, ayah: 0 } });
    t.engine.skip(-1);
    await t.settle();
    // Surah 34 plays ayah by ayah for this reciter: from its first ayah.
    expect(t.engine.getState()).toMatchObject({ granularity: 'ayah', position: { surah: 34, ayah: 1 } });
    t.engine.start({ surah: 36, ayah: 1 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    const before = t.loads().length;
    t.engine.skipPage(1);
    t.engine.skipPage(-1);
    await t.settle();
    expect(t.loads()).toHaveLength(before);
    t.engine.skip(1);
    await t.settle();
    // Sobhi has no 37: the fallback voice, ayah by ayah.
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'ayah', position: { surah: 37, ayah: 1 }, reciterId: 'minshawi', preferredReciterId: 'islam-sobhi' });
  });

  it('switches reciter at once, from the surah start, and keeps a pause', async () => {
    const t = setup();
    await wholeSurah36(t);
    await t.at(1000, { durationMs: LENGTH(36) });
    await t.at(200_000);
    t.engine.selectReciter('abdulbasit');
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'ayah', reciterId: 'abdulbasit', pendingReciterId: null, sessionReciterId: 'abdulbasit', position: { surah: 36, ayah: 1 } });
    expect(t.loads().at(-1)).toBe(`load ${url(BASIT, 36)} @0`);
    t.engine.start({ surah: 35, ayah: 1 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    t.engine.pause();
    t.engine.selectReciter('abdulbasit');
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'paused', reciterId: 'abdulbasit', position: { surah: 35, ayah: 1 } });
    expect(t.calls.filter((c) => c === 'play')).toHaveLength(3); // start, switch, start: the paused switch added none
  });

  it('refuses a reciter with no recording of this surah (notice; the current recitation goes on)', async () => {
    const t = setup();
    await wholeSurah36(t);
    t.engine.selectReciter('ahmed-salama');
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'islam-sobhi', notice: { kind: 'reciter-unavailable', reciterId: 'ahmed-salama', surah: 36 } });
    expect(t.loads()).toHaveLength(1);
  });
});

describe('Listen on an ayah a whole-surah recording cannot start at', () => {
  it('stops with a choice instead of silently starting from the beginning', async () => {
    const t = setup();
    t.engine.start({ surah: 36, ayah: 12 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'error', granularity: 'ayah', position: { surah: 36, ayah: 12 }, error: { kind: 'surah-only', surah: 36, reciterId: 'islam-sobhi' } });
    expect(t.loads()).toEqual([]);
    expect(t.calls).not.toContain('play');
    // No automatic retry either.
    await t.advanceTimers(RETRY_DELAYS_MS[0] + RETRY_DELAYS_MS[1]);
    expect(t.loads()).toEqual([]);
    t.engine.retry();
    await t.settle();
    expect(t.loads()).toEqual([]);
  });

  it('plays the whole surah from its start only when the listener chooses it', async () => {
    const t = setup();
    t.engine.start({ surah: 36, ayah: 12 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    t.engine.playWholeSurah();
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'surah', position: { surah: 36, ayah: 0 }, error: null });
    expect(t.loads()).toEqual([`load ${url(SOBHI, 36)} @0`]);
  });

  it("the page's Play stops the same way when the page begins inside the surah", async () => {
    const t = setup();
    t.engine.startPage(441, 'islam-sobhi'); // page 441 begins at 36:13
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'surah-only', surah: 36 }, position: { surah: 36, ayah: 13 } });
    t.engine.startPage(428, 'islam-sobhi'); // page 428 begins at 34:1, which this reciter plays ayah by ayah
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'ayah', position: { surah: 34, ayah: 1 } });
    expect(t.loads()).toEqual([`load ${url(SOBHI, 34)} @0`]);
  });

  it('a reciter chosen during ayah playback, whole-surah only for this surah, is offered, never queued', async () => {
    const t = setup();
    t.engine.start({ surah: 36, ayah: 5 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await t.settle();
    t.engine.selectReciter('islam-sobhi');
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'abdulbasit', pendingReciterId: null, notice: { kind: 'reciter-surah-only', reciterId: 'islam-sobhi', surah: 36 } });
    t.engine.playWholeSurah();
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'surah', reciterId: 'islam-sobhi', sessionReciterId: 'islam-sobhi', notice: null, position: { surah: 36, ayah: 0 } });
  });

  it('the ayah screens (one ayah) never play a whole-surah recording: the verified ayah of the fallback voice instead', async () => {
    const t = setup();
    t.engine.start({ surah: 36, ayah: 1 }, { mode: 'single', reciterId: 'islam-sobhi' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'ayah', reciterId: 'minshawi', preferredReciterId: 'islam-sobhi', error: null });
    t.engine.playWholeSurah();
    await t.settle();
    expect(t.loads()).toEqual([`load ${url(MINSHAWI, 36)} @0`]);
  });
});

describe('ayah mode never falls back silently to whole-surah playback', () => {
  it('a timing failure stays an error at the ayah asked for', async () => {
    const t = setup({ timingNetworkFails: true });
    t.engine.start({ surah: 34, ayah: 7 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'error', granularity: 'ayah', position: { surah: 34, ayah: 7 }, error: { kind: 'network' } });
    expect(t.loads()).toEqual([]);
  });

  it('existing reciters keep ayah playback with their verified timing (no whole-surah mode anywhere in the catalogue)', () => {
    for (const reciter of RECITERS) for (let s = 1; s <= 114; s++) expect(SOURCE_REGISTRY.mode(reciter.id, s)).not.toBe('surah');
  });
});

describe('stream checks and fallbacks', () => {
  it('refuses a stream redirected to another recording, e.g. Minshawi (no play, no other voice)', async () => {
    const t = setup({ checkStream: async () => 'redirected' });
    await wholeSurah36(t);
    expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'source', surah: 36, reciterId: 'islam-sobhi' } });
    expect(t.loads()).toEqual([]);
    expect(t.calls).not.toContain('play');
  });

  it('refuses a stream of another size, or one that is gone or expired', async () => {
    for (const answer of ['size-mismatch', 'missing'] as const) {
      const t = setup({ checkStream: async () => answer });
      await wholeSurah36(t);
      expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'source' } });
      expect(t.loads()).toEqual([]);
    }
  });

  it('fails closed when the check cannot be made (offline, a timeout, no trustworthy size): retried, never played unchecked', async () => {
    let answer: StreamCheck = 'unverifiable';
    const t = setup({ checkStream: async () => answer });
    await wholeSurah36(t);
    expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'network', surah: 36 } });
    expect(t.loads()).toEqual([]);
    answer = 'ok';
    await t.advanceTimers(RETRY_DELAYS_MS[0]);
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'surah' });
  });

  it('refuses a whole-surah stream when there is no stream check at all', async () => {
    const t = setup({ checkStream: 'none' });
    await wholeSurah36(t);
    expect(t.engine.getState()).toMatchObject({ phase: 'error' });
    expect(t.loads()).toEqual([]);
  });

  it('never preloads a whole-surah stream before its check (a preload would follow a redirect to another recording)', async () => {
    const t = setup();
    t.engine.start({ surah: 34, ayah: SURAH_AYAH_COUNTS[33] }, { mode: 'continuous', reciterId: 'islam-sobhi' }); // next: whole 35
    await t.settle();
    await wholeSurah36(t); // next: 37, Sobhi has none: the fallback's audited ayah file; whole surahs are never preloaded
    expect(t.calls.filter((c) => c.startsWith('preload'))).toEqual([`preload ${url(MINSHAWI, 37)}`]);
    // Ayah sources are still preloaded as before.
    const u = setup();
    u.engine.start({ surah: 18, ayah: SURAH_AYAH_COUNTS[17] }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await u.settle();
    expect(u.calls).toContain(`preload ${url(BASIT, 19)}`);
  });

  it('makes no stream check for the audited ayah sources (no added request or latency)', async () => {
    const t = setup({ checkStream: async () => 'redirected' });
    t.engine.start({ surah: 18, ayah: 10 }, { mode: 'continuous', reciterId: 'maher' });
    await t.settle();
    expect(t.checks).toEqual([]);
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', granularity: 'ayah' });
  });

  it('checks each whole-surah stream before it loads, with its verified size', async () => {
    const sizes: (number | null)[] = [];
    const t = setup({ checkStream: async (_uri, bytes) => (sizes.push(bytes), 'ok') });
    await wholeSurah36(t);
    t.engine.seekTo(1000);
    t.engine.skip(-1);
    await t.settle();
    expect(t.checks).toEqual([url(SOBHI, 36), url(SOBHI, 35)]);
    expect(sizes).toEqual([1_000_036, 1_000_035]);
  });

  it('stops a loaded stream whose length is not the verified length (identity beyond the HEAD answer)', async () => {
    const t = setup();
    await wholeSurah36(t);
    await t.at(1000, { durationMs: 636_000 + 2000 }); // within tolerance
    expect(t.engine.getState()).toMatchObject({ phase: 'playing' });
    const u = setup();
    await wholeSurah36(u);
    await u.at(1000, { durationMs: 420_000 }); // e.g. another Sheikh's file behind the same URL
    expect(u.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'source', surah: 36 } });
    expect(u.calls.at(-2)).toBe('stop');
    // No automatic retry for a file that is not the verified one.
    await u.advanceTimers(RETRY_DELAYS_MS[0] + RETRY_DELAYS_MS[1]);
    expect(u.loads()).toHaveLength(1);
  });

  it('a VBR whole-surah file plays (approximate seeking is acceptable without ayahs), never ayah by ayah', async () => {
    const vbrRegistry = fixtureRegistry({ surahOnly: [approval('islam-sobhi', 17, { bitrateMode: 'vbr' })] });
    expect(vbrRegistry.mode('islam-sobhi', 17)).toBe('surah');
    expect(vbrRegistry.capability('islam-sobhi', 17)).toMatchObject({ mode: 'surah', sources: [{ format: { bitrateMode: 'vbr', exactSeek: false } }] });
  });

  it('a broken stream fails gracefully, retries by itself, then shows the error', async () => {
    const t = setup({ failLoad: () => true });
    await wholeSurah36(t);
    expect(t.engine.getState()).toMatchObject({ phase: 'error', granularity: 'surah', error: { kind: 'network', surah: 36 } });
    await t.advanceTimers(RETRY_DELAYS_MS[0]);
    await t.advanceTimers(RETRY_DELAYS_MS[1]);
    expect(t.loads()).toEqual([`load ${url(SOBHI, 36)} @0`, `load ${url(SOBHI, 36)} @0`, `load ${url(SOBHI, 36)} @0`]);
    expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'network' } });
  });
});

describe('fallback among verified sources of the same reciter', () => {
  const mirror = { ...SOURCE_REGISTRY.sourcesFor('maher', 18)[0], url: 'https://mirror.example/maher/018.mp3', priority: 1 };
  const withMirror = fixtureRegistry({ extra: [mirror] });

  function mirrored(failLoad: (uri: string) => boolean, checkStream?: (uri: string) => Promise<StreamCheck>) {
    const calls: string[] = [];
    const engine = createPlaybackEngine({
      output: {
        async load(uri, startMs) {
          calls.push(`load ${uri} @${startMs}`);
          if (failLoad(uri)) throw new Error('unreachable');
        },
        async seek() {},
        play: () => calls.push('play'),
        pause: () => undefined,
        stop: () => undefined,
        subscribe: () => () => undefined,
        setNowPlaying: () => undefined,
        preload: () => undefined,
      },
      timing: { load: async (reciter, surah) => ({ ok: true, timing: timingFor(reciter, surah) }), stored: async () => null },
      capability: (reciter, surah) => withMirror.mode(reciter.id, surah),
      resolveSource: localFirstSource({ uri: async () => null }, withMirror),
      checkStream,
      now: () => 0,
      schedule: () => () => undefined,
    });
    return { engine, calls };
  }
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it('tries the next verified source when the preferred one is unreachable', async () => {
    const t = mirrored((uri) => uri.includes('cdn.mp3quran.net'));
    t.engine.start({ surah: 18, ayah: 3 }, { mode: 'continuous', reciterId: 'maher' });
    await settle();
    expect(t.calls).toEqual([`load ${url(MAHER, 18)} @24000`, `load ${mirror.url} @24000`, 'play']);
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'maher', position: { surah: 18, ayah: 3 } });
  });

  it('ayah sources are not stream-checked: an ayah mirror is only for an unreachable preferred stream', async () => {
    const t = mirrored(() => false, async () => 'redirected');
    t.engine.start({ surah: 18, ayah: 3 }, { mode: 'continuous', reciterId: 'maher' });
    await settle();
    expect(t.calls).toEqual([`load ${url(MAHER, 18)} @24000`, 'play']);
  });

  it('whole surah: skips a redirected source for the next verified one of the same reciter, which is checked too', async () => {
    // A mirror: the same approved recording (size, length, verification) at another URL, less preferred.
    const approved = registry.capability('islam-sobhi', 36);
    if (approved.mode !== 'surah') throw new Error('fixture');
    const reg = fixtureRegistry({ surahOnly: [approval('islam-sobhi', 36)], extra: [{ ...approved.sources[0], url: 'https://mirror.example/sobhi/036.mp3', priority: 1 }] });
    const checked: string[] = [];
    const calls: string[] = [];
    const engine = createPlaybackEngine({
      output: { async load(uri, at) { calls.push(`load ${uri} @${at}`); }, async seek() {}, play: () => calls.push('play'), pause() {}, stop() {}, subscribe: () => () => undefined, setNowPlaying() {}, preload() {} },
      timing: { load: async () => ({ ok: false, reason: 'unavailable' }), stored: async () => null },
      capability: (reciter, surah) => reg.mode(reciter.id, surah),
      resolveSource: localFirstSource({ uri: async () => null }, reg),
      checkStream: async (uri) => (checked.push(uri), uri.includes('cdn.mp3quran.net') ? 'redirected' : 'ok'),
      now: () => 0,
      schedule: () => () => undefined,
    });
    engine.start({ surah: 36, ayah: 1 }, { mode: 'continuous', reciterId: 'islam-sobhi' });
    await settle();
    expect(checked).toEqual([url(SOBHI, 36), 'https://mirror.example/sobhi/036.mp3']);
    expect(calls).toEqual(['load https://mirror.example/sobhi/036.mp3 @0', 'play']);
    expect(engine.getState()).toMatchObject({ phase: 'playing', granularity: 'surah', reciterId: 'islam-sobhi' });
  });

  it('fails as a network error once every source is unreachable', async () => {
    const t = mirrored(() => true);
    t.engine.start({ surah: 18, ayah: 3 }, { mode: 'continuous', reciterId: 'maher' });
    await settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'network' } });
  });
});
