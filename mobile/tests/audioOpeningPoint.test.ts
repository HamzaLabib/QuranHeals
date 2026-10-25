import { describe, expect, it, vi } from 'vitest';

import { LEN, ONSET, surahOf, TIMED_FIXTURE } from './helpers/timedPreviewFixture';

/**
 * The engine with a timed preview file that begins with audio outside the recitation (timedPreview.ts openingMs): ayah 1
 * loads, repeats and starts Full Surah at the opening point, never at the file's start; a surah without one is unchanged.
 */
const OPENING = 3000;
vi.mock('@/audio/reciters', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/audio/reciters')>();
  const { TIMED_FIXTURE: fixture, surahOf: of } = await import('./helpers/timedPreviewFixture');
  // The catalogue's own entry, in place of the previews a release build plays.
  const { GENERATED_RECITERS } = await import('@/audio/generated/reciterCatalog');
  const catalogue = real.RECITERS.map((r) => (r.id === fixture.reciterId ? (GENERATED_RECITERS.find((g) => g.id === r.id) as typeof r) : r));
  const all = real.withTimedPreview(catalogue, [{ ...fixture, surahs: { ...fixture.surahs, 114: { ...of(114), openingMs: 3000 } } }]);
  const byId = new Map(all.map((r) => [r.id, r]));
  return { ...real, RECITERS: all, getReciter: (id: string | null | undefined) => (id && byId.get(id)) || null };
});

const { createPlaybackEngine, COMMAND_GRACE_MS } = await import('@/audio/engine');
type Status = import('@/audio/engine').OutputStatus;
const { createTimingLoader } = await import('@/audio/timing');
const { audioMode } = await import('@/audio/availability');
const { localFirstSource } = await import('@/audio/sources');

function setup() {
  const calls: string[] = [];
  const listeners = new Set<(s: Status) => void>();
  let clock = 0;
  const engine = createPlaybackEngine({
    output: {
      async load(uri, ms) { calls.push(`load ${uri.split('/').pop()} @${ms}`); },
      async seek(ms) { calls.push(`seek @${ms}`); },
      play: () => calls.push('play'), pause: () => calls.push('pause'), stop: () => calls.push('stop'),
      subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
      setNowPlaying: () => undefined, preload: () => undefined,
    },
    timing: createTimingLoader({ fetchText: async () => { throw new Error('offline'); }, store: { read: async () => null, write: async () => undefined } }),
    resolveSource: localFirstSource({ uri: async () => null }),
    capability: (reciter, surah) => audioMode(reciter.id, surah),
    checkStream: async () => 'ok',
    now: () => clock,
    schedule: () => () => undefined,
  });
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const at = async (positionMs: number) => {
    clock += COMMAND_GRACE_MS;
    for (const l of listeners) l({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null });
    await settle();
  };
  return { engine, calls, settle, at };
}

describe('opening point: the engine', () => {
  it('ayah 1 loads at the opening point; other ayahs at their own start', async () => {
    const t = setup();
    t.engine.start({ surah: 114, ayah: 1 }, { mode: 'continuous', reciterId: 'ahmed-salama' });
    await t.settle();
    expect(t.calls.filter((c) => c.startsWith('load'))).toEqual([`load 114.mp3 @${OPENING}`]);
    const u = setup();
    u.engine.start({ surah: 114, ayah: 3 }, { mode: 'continuous', reciterId: 'ahmed-salama' });
    await u.settle();
    expect(u.calls.filter((c) => c.startsWith('load'))).toEqual([`load 114.mp3 @${ONSET + 2 * LEN}`]);
  });

  it('Repeat of ayah 1 and Full Surah return to the opening point, never to the file\'s start', async () => {
    const t = setup();
    t.engine.setRepeat(1);
    t.engine.startFullSurah(114, 'ahmed-salama');
    await t.settle();
    expect(t.calls.filter((c) => c.startsWith('load'))).toEqual([`load 114.mp3 @${OPENING}`]);
    await t.at(ONSET + 100);
    await t.at(ONSET + LEN);
    expect(t.calls.filter((c) => c.startsWith('seek'))[0]).toBe(`seek @${OPENING}`);
  });

  it('a surah without an opening point is unchanged: ayah 1 from 0', async () => {
    expect(TIMED_FIXTURE.surahs[112]).toEqual(surahOf(112));
    const t = setup();
    t.engine.start({ surah: 112, ayah: 1 }, { mode: 'continuous', reciterId: 'ahmed-salama' });
    await t.settle();
    expect(t.calls.filter((c) => c.startsWith('load'))).toEqual(['load 112.mp3 @0']);
  });
});
