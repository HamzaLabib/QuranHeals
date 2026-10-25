import { describe, expect, it } from 'vitest';

import { COMMAND_GRACE_MS, createPlaybackEngine, REPEAT_CYCLE, type AudioOutput, type OutputStatus, type RepeatSetting } from '@/audio/engine';
import { getReciter, hasAyahPlayback, surahAudioUrl, type Reciter } from '@/audio/reciters';
import { ayahAt, ayahStartMs, type SurahTiming, type TimingLoader, type TimingResult } from '@/audio/timing';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** Synthetic timing: a 4 s opening, then every ayah 10 s long. */
const INTRO = 4000;
const AYAH = 10_000;
const startOf = (ayah: number) => INTRO + (ayah - 1) * AYAH;
const endOf = (ayah: number) => startOf(ayah) + AYAH;
const timingFor = (reciter: Reciter, surah: number): SurahTiming => ({
  reciterId: reciter.id,
  surah,
  introEndMs: INTRO,
  ayahs: Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => ({ startMs: startOf(i + 1), endMs: endOf(i + 1) })),
});

/** `without`: fixture pairs ('reciterId:surah') without verified timing (Al-Minshawi has all 114 in this build). */
function setup(options: { failSeek?: boolean; timing?: (reciter: Reciter, surah: number) => TimingResult; without?: readonly string[] } = {}) {
  const calls: string[] = [];
  const listeners = new Set<(status: OutputStatus) => void>();
  let clock = 0;
  const output: AudioOutput = {
    async load(uri, startMs) {
      calls.push(`load ${uri.split('/').slice(-3).join('/')} @${startMs}`);
    },
    async seek(ms) {
      calls.push(`seek @${ms}`);
      if (options.failSeek) throw new Error('seek failed');
    },
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    stop: () => calls.push('stop'),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setNowPlaying: () => undefined,
    preload: () => undefined,
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
    resolveSource: async (reciter, surah) => ({ uri: surahAudioUrl(reciter, surah), local: false }),
    capability: (reciter, surah) => (!without.has(`${reciter.id}:${surah}`) && hasAyahPlayback(reciter, surah) ? 'ayah' : 'none'),
    now: () => clock,
    schedule: () => () => undefined,
  });
  const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const at = async (positionMs: number, patch: Partial<OutputStatus> = {}) => {
    clock += COMMAND_GRACE_MS;
    for (const listener of listeners) listener({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null, ...patch });
    await settle();
  };
  /** The player recites `ayah` through to its end (a status inside it, then its end). */
  const recite = async (ayah: number) => {
    await at(startOf(ayah) + 100);
    await at(endOf(ayah));
  };
  const loads = () => calls.filter((c) => c.startsWith('load'));
  const seeks = () => calls.filter((c) => c.startsWith('seek'));
  return { engine, calls, settle, at, recite, loads, seeks };
}

async function listening(repeat: RepeatSetting, from = { surah: 2, ayah: 5 }) {
  const t = setup();
  t.engine.setRepeat(repeat);
  t.engine.start(from, { mode: 'continuous', reciterId: 'abdulbasit' });
  await t.settle();
  return t;
}

describe('Repeat Ayah: the setting', () => {
  it('cycles Off → 1 → 2 → 3 → ∞ → Off', () => {
    const t = setup();
    const seen: RepeatSetting[] = [t.engine.getState().repeat];
    for (let i = 0; i < 5; i++) {
      t.engine.cycleRepeat();
      seen.push(t.engine.getState().repeat);
    }
    expect(seen).toEqual([0, 1, 2, 3, 'infinite', 0]);
    expect(REPEAT_CYCLE).toEqual([0, 1, 2, 3, 'infinite']);
  });

  it('is off again once the player is closed (stop); kept across a new start meanwhile', async () => {
    const t = await listening(2);
    t.engine.start({ surah: 2, ayah: 9 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    expect(t.engine.getState().repeat).toBe(2);
    t.engine.stop();
    expect(t.engine.getState().repeat).toBe(0);
  });
});

describe('Repeat Ayah: recitations per ayah', () => {
  for (const [repeat, total] of [[0, 1], [1, 2], [2, 3], [3, 4]] as const) {
    it(`${repeat === 0 ? 'off' : repeat}: ayah 5 recited ${total} time(s), each repeat a seek back to its verified start (no reload), then ayah 6`, async () => {
      const t = await listening(repeat);
      for (let k = 0; k < total; k++) {
        expect(t.engine.getState().position, `recitation ${k + 1}`).toEqual({ surah: 2, ayah: 5 });
        await t.recite(5);
      }
      expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
      expect(t.seeks()).toEqual(Array.from({ length: total - 1 }, () => `seek @${startOf(5)}`));
      expect(t.loads()).toHaveLength(1); // one file, one player: never reloaded for a repeat
      expect(t.engine.getState().phase).toBe('playing');
    });
  }

  it('∞: stays on the same ayah, recitation after recitation', async () => {
    const t = await listening('infinite');
    for (let k = 0; k < 8; k++) await t.recite(5);
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 5 });
    expect(t.seeks()).toHaveLength(8);
    expect(t.loads()).toHaveLength(1);
  });

  it('ignores the player while a repeat seek is in flight (no double end, no overlap)', async () => {
    const t = await listening(1);
    await t.at(startOf(5) + 100);
    await t.at(endOf(5)); // the end: a seek back
    await t.at(endOf(5) + 80); // a late report from before the seek landed
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 5 });
    expect(t.seeks()).toHaveLength(1);
  });

  it('a change of setting applies at once, without restarting: the recitations already made count', async () => {
    const t = await listening(3);
    await t.recite(5);
    await t.recite(5); // 2 recitations made
    t.engine.setRepeat(1); // 2 in all: done after this one
    await t.recite(5);
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
    expect(t.loads()).toHaveLength(1);
    // Turned on in the middle of an ayah: that ayah repeats.
    t.engine.setRepeat(2);
    await t.recite(6);
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
  });

  it('a manual Next / Previous starts the count again for the new ayah (the setting stays)', async () => {
    const t = await listening(1);
    await t.recite(5); // one repeat of 5 pending
    t.engine.skip(1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ position: { surah: 2, ayah: 6 }, repeat: 1 });
    await t.recite(6);
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 }); // 6 repeats once
    await t.recite(6);
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 7 });
  });

  it('a reciter chosen meanwhile takes over at the repeat, and the count starts again in that voice', async () => {
    const t = await listening(1);
    t.engine.selectReciter('minshawi');
    expect(t.engine.getState().pendingReciterId).toBe('minshawi');
    await t.recite(5);
    expect(t.engine.getState()).toMatchObject({ reciterId: 'minshawi', position: { surah: 2, ayah: 5 } });
    expect(t.loads().at(-1)).toBe(`load muhammad-minshawi/r1/002.mp3 @${startOf(5)}`);
    await t.recite(5); // Minshawi's first recitation: one repeat follows
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 5 });
    await t.recite(5);
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
  });

  it("repeats a surah's last ayah, then goes on to the next surah (continuous playback)", async () => {
    const t = await listening(1, { surah: 112, ayah: 4 });
    await t.recite(4);
    expect(t.engine.getState().position).toEqual({ surah: 112, ayah: 4 });
    // The file may report its end on the last ayah: the repeat seeks back and plays again.
    await t.at(startOf(4) + 100);
    await t.at(endOf(4), { finished: true, playing: false });
    expect(t.engine.getState().position).toEqual({ surah: 113, ayah: 1 });
    expect(t.calls.filter((c) => c === 'play').length).toBeGreaterThanOrEqual(2);
  });

  // Phase 4.8.8 opening rule: ayah 1 of a complete surah recording starts AND repeats from 0:00.000 (with its opening);
  // its spoken onset (introEndMs) is kept for highlighting; every other ayah repeats from its own verified start.
  it('ayah 1 repeats from the file start (0:00.000), like its first recitation, then moves on to ayah 2', async () => {
    const t = await listening(2, { surah: 2, ayah: 1 });
    expect(t.loads()).toEqual(['load abdulbasit-abdulsamad/r3/002.mp3 @0']);
    for (let k = 0; k < 3; k++) {
      expect(t.engine.getState().position, `recitation ${k + 1}`).toEqual({ surah: 2, ayah: 1 });
      await t.recite(1);
    }
    expect(t.seeks()).toEqual(['seek @0', 'seek @0']);
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 2 });
    expect(t.loads()).toHaveLength(1);
  });

  it('∞ on ayah 1: every repeat from 0:00.000; the opening before the onset is heard each time without leaving ayah 1', async () => {
    const t = await listening('infinite', { surah: 2, ayah: 1 });
    for (let k = 0; k < 4; k++) {
      await t.at(500); // inside the opening (before the spoken onset): still ayah 1, no premature end
      expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 1 });
      await t.recite(1);
    }
    expect(t.seeks()).toEqual(Array.from({ length: 4 }, () => 'seek @0'));
  });

  it('the onset is still where highlighting begins (timing unchanged); other ayahs repeat from their own start', async () => {
    const timing = timingFor(getReciter('abdulbasit')!, 2);
    expect(timing.introEndMs).toBe(INTRO);
    expect(ayahAt(timing, INTRO - 1)).toBe(0);
    expect(ayahAt(timing, INTRO)).toBe(1);
    expect(ayahStartMs(timing, 1)).toBe(0);
    const t = await listening(1, { surah: 2, ayah: 2 });
    await t.recite(2);
    expect(t.seeks()).toEqual([`seek @${startOf(2)}`]);
  });

  it('never loops when the seek back fails: it moves on as if repeat were off', async () => {
    const t = setup({ failSeek: true });
    t.engine.setRepeat('infinite');
    t.engine.start({ surah: 2, ayah: 5 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await t.settle();
    await t.recite(5);
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
  });

  it('never loops on an unusable timestamp (defence in depth: verified timing never has one)', async () => {
    let loaded: SurahTiming | null = null;
    const t = setup({
      timing: (reciter, surah) => {
        loaded = timingFor(reciter, surah);
        return { ok: true, timing: loaded };
      },
    });
    t.engine.setRepeat('infinite');
    t.engine.start({ surah: 2, ayah: 5 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await t.settle();
    await t.at(startOf(5) + 100);
    (loaded as unknown as SurahTiming).ayahs[4].startMs = Number.NaN; // corrupted while it plays
    await t.at(endOf(5));
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
    expect(t.seeks()).toEqual([]);
  });

  it('pause and resume during a repeat keep the place', async () => {
    const t = await listening(2);
    await t.recite(5);
    t.engine.pause();
    expect(t.engine.getState().phase).toBe('paused');
    t.engine.resume();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 2, ayah: 5 } });
    expect(t.loads()).toHaveLength(1);
  });

  it("the ayah screens' single ayah never repeats", async () => {
    const t = setup();
    t.engine.setRepeat('infinite');
    t.engine.start({ surah: 2, ayah: 5 }, { mode: 'single', reciterId: 'abdulbasit' });
    await t.settle();
    await t.recite(5);
    expect(t.engine.getState().phase).toBe('ended');
    expect(t.seeks()).toEqual([]);
  });
});

describe('Full Surah', () => {
  it('starts at ayah 1 of the surah in the given reciter, follows its ayahs in one file, and stops after its last ayah', async () => {
    const t = setup();
    t.engine.startFullSurah(112, 'abdulbasit');
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ mode: 'fullSurah', phase: 'playing', position: { surah: 112, ayah: 1 }, reciterId: 'abdulbasit' });
    expect(t.loads()).toEqual(['load abdulbasit-abdulsamad/r3/112.mp3 @0']);
    for (let ayah = 1; ayah <= 4; ayah++) {
      expect(t.engine.getState().position, `ayah ${ayah}`).toEqual({ surah: 112, ayah });
      await t.recite(ayah);
    }
    expect(t.engine.getState().phase).toBe('ended');
    expect(t.loads()).toHaveLength(1); // never into Al-Falaq
  });

  it('with Repeat, each ayah repeats before the next, and the last one too before it stops', async () => {
    const t = setup();
    t.engine.setRepeat(1);
    t.engine.startFullSurah(112, 'abdulbasit');
    await t.settle();
    for (let ayah = 1; ayah <= 4; ayah++) {
      await t.recite(ayah);
      expect(t.engine.getState().position, `ayah ${ayah} repeats`).toEqual({ surah: 112, ayah });
      await t.recite(ayah);
    }
    expect(t.engine.getState().phase).toBe('ended');
    // Phase 4.8.8: ayah 1 repeats from 0:00.000 (opening rule); ayahs 2-4 from their own starts, as before.
    expect(t.seeks()).toEqual([0, startOf(2), startOf(3), startOf(4)].map((ms) => `seek @${ms}`));
  });

  it('restarts the surah from ayah 1 when pressed during playback, and keeps the session reciter', async () => {
    const t = await listening(0, { surah: 2, ayah: 40 });
    t.engine.selectReciter('minshawi');
    t.engine.startFullSurah(2, 'minshawi');
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ mode: 'fullSurah', position: { surah: 2, ayah: 1 }, reciterId: 'minshawi', sessionReciterId: 'minshawi' });
  });

  it('never plays a surah the reciter has no verified timing for (no untimed fallback): Al-Minshawi\'s verified timing, or the error', async () => {
    const t = setup();
    t.engine.startFullSurah(17, 'islam-sobhi'); // Islam Sobhi's Al-Isra: structure unresolved, no timing
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ mode: 'fullSurah', reciterId: 'minshawi', preferredReciterId: 'islam-sobhi', error: null });
    expect(t.loads().join(' ')).toContain('muhammad-minshawi/r1/017.mp3');
    expect(t.loads().join(' ')).not.toContain('islam-sobhi');
    // Neither (Saleh Al-Talib has no Al-Qamar; Al-Minshawi without it is a fixture): the error says so.
    const u = setup({ without: ['minshawi:54'] });
    u.engine.startFullSurah(54, 'saleh-talib');
    await u.settle();
    expect(u.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'unavailable', surah: 54, reciterId: 'saleh-talib' } });
    expect(u.loads()).toEqual([]);
  });

  it('rejects an invalid surah number', () => {
    const t = setup();
    expect(t.engine.startFullSurah(0, 'abdulbasit')).toBeNull();
    expect(t.engine.startFullSurah(115, 'abdulbasit')).toBeNull();
  });
});
