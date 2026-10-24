import { describe, expect, it, vi } from 'vitest';

/**
 * Saleh Al-Talib 12 (iPhone test, 2026-10-24): it loaded for about a minute and failed, or seemed to switch to
 * Al-Minshawi. Its recording is the development build's timed preview from archive.org (ia600903), a host that takes
 * 7–9 s before the first byte of every request. Tests run with __DEV__ false, so the real generated entry is added to
 * the catalogue here (the development build's withTimedPreview).
 */
vi.mock('@/audio/reciters', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/audio/reciters')>();
  const { TIMED_PREVIEW } = await import('@/audio/generated/timedPreview');
  const all = real.withTimedPreview(real.RECITERS, TIMED_PREVIEW.filter((r) => r.reciterId === 'saleh-talib'));
  const byId = new Map(all.map((r) => [r.id, r]));
  return { ...real, RECITERS: all, getReciter: (id: string | null | undefined) => (id && byId.get(id)) || null };
});

const { createPlaybackEngine, RETRY_DELAYS_MS } = await import('@/audio/engine');
type Status = import('@/audio/engine').OutputStatus;
const { createTimingLoader } = await import('@/audio/timing');
const { audioMode } = await import('@/audio/availability');
const { localFirstSource } = await import('@/audio/sources');
const R = await import('@/audio/reciters');

const SALEH_12 = 'https://ia600903.us.archive.org/12/items/SheikhTalibSurahs626991-114/SurahYusufBySheikhTalib12-16thJan2013.mp3';
const loader = () => createTimingLoader({ fetchText: async () => { throw new Error('offline'); }, store: { read: async () => null, write: async () => undefined } });

describe('Saleh Al-Talib 12: the recording', () => {
  it('is available in his own voice (development preview), from its archive.org file and never his MP3Quran URL', async () => {
    const saleh = R.getReciter('saleh-talib')!;
    expect(saleh.surahs).not.toContain(12); // MP3Quran does not list it: its 012.mp3 redirects to Al-Minshawi's
    expect(audioMode('saleh-talib', 12)).toBe('ayah');
    const timing = await loader().load(saleh, 12);
    expect(timing.ok && timing.timing.recording).toMatchObject({ provider: 'archive', url: SALEH_12, bytes: 33_607_680 });
    const source = await localFirstSource({ uri: async () => null })(saleh, 12, timing.ok ? timing.timing : null);
    expect(source).toEqual({ uri: SALEH_12, local: false, bytes: 33_607_680, verify: true });
  });
});

describe('Saleh Al-Talib 12: a slow load', () => {
  function setup(failures: number) {
    const loads: string[] = [];
    const listeners = new Set<(s: Status) => void>();
    const scheduled: (() => void)[] = [];
    let left = failures;
    const engine = createPlaybackEngine({
      output: {
        async load(uri, ms) {
          loads.push(`${uri} @${ms}`);
          if (left-- > 0) throw new Error('load timeout'); // not playable within LOAD_TIMEOUT_MS
        },
        async seek() {},
        play: () => undefined, pause: () => undefined, stop: () => undefined,
        subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
        setNowPlaying: () => undefined, preload: () => undefined,
      },
      timing: loader(),
      resolveSource: localFirstSource({ uri: async () => null }),
      capability: (reciter, surah) => audioMode(reciter.id, surah),
      checkStream: async () => 'ok',
      schedule: (fn) => { scheduled.push(fn); return () => undefined; },
    });
    const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    const runRetry = async () => { scheduled.shift()?.(); await settle(); };
    return { engine, loads, settle, runRetry, scheduled };
  }

  it('a timed-out load is a network error naming Saleh (retried), never Al-Minshawi in his place', async () => {
    const t = setup(1);
    t.engine.start({ surah: 12, ayah: 1 }, { mode: 'continuous', reciterId: 'saleh-talib' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'error', reciterId: 'saleh-talib', preferredReciterId: 'saleh-talib', error: { kind: 'network', surah: 12, reciterId: 'saleh-talib' } });
    expect(t.scheduled).toHaveLength(1); // the automatic retry (RETRY_DELAYS_MS[0])
    await t.runRetry();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'saleh-talib', position: { surah: 12, ayah: 1 }, error: null });
    expect(t.loads).toEqual([`${SALEH_12} @0`, `${SALEH_12} @0`]);
    expect(t.loads.join(' ')).not.toContain('minshawi');
  });

  it('still failing after every automatic retry: the error stays (Retry offered), Saleh is still the one asked for', async () => {
    const t = setup(RETRY_DELAYS_MS.length + 1);
    t.engine.start({ surah: 12, ayah: 1 }, { mode: 'continuous', reciterId: 'saleh-talib' });
    await t.settle();
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) await t.runRetry();
    expect(t.scheduled).toHaveLength(0);
    expect(t.engine.getState()).toMatchObject({ phase: 'error', reciterId: 'saleh-talib', error: { kind: 'network', reciterId: 'saleh-talib' } });
    // Retry: Saleh's file again (the host answered this time).
    t.engine.retry();
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'saleh-talib' });
    expect(t.loads.every((l) => l.startsWith(SALEH_12))).toBe(true);
  });

  it('Mushaf page 235 starts at Hud 11:118, which Saleh has no recording of: Al-Minshawi recites Hud, Saleh from 12:1', async () => {
    const t = setup(0);
    t.engine.start({ surah: 11, ayah: 118 }, { mode: 'continuous', reciterId: 'saleh-talib' });
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ reciterId: 'minshawi', preferredReciterId: 'saleh-talib' });
    const u = setup(0);
    u.engine.start({ surah: 12, ayah: 1 }, { mode: 'continuous', reciterId: 'saleh-talib' });
    await u.settle();
    expect(u.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'saleh-talib' });
  });
});
