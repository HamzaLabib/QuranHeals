import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

import { FIXTURE_AYAH_MS, FIXTURE_BASMALA_MS, PER_AYAH_FIXTURE } from './helpers/perAyahFixture';

/**
 * Per-ayah recordings (audio/perAyah.ts): one file per ayah, the development preview of Mohamed Gebril (EveryAyah).
 * Tests and release builds run with __DEV__ false, so the real catalogue is never loaded here: a fixture recording is
 * added to the reciters instead (same code path as the development build's withPerAyahPreview).
 */
const LENGTH = FIXTURE_AYAH_MS;
const BASMALA = FIXTURE_BASMALA_MS;
const FIXTURE = PER_AYAH_FIXTURE;

vi.mock('@/audio/reciters', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/audio/reciters')>();
  const { PER_AYAH_FIXTURE } = await import('./helpers/perAyahFixture');
  const all = real.withPerAyahPreview(real.RECITERS, [PER_AYAH_FIXTURE]);
  const byId = new Map(all.map((r) => [r.id, r]));
  return { ...real, RECITERS: all, getReciter: (id: string | null | undefined) => (id && byId.get(id)) || null, isReciterId: (v: unknown) => typeof v === 'string' && byId.has(v) };
});

const { createPlaybackEngine, COMMAND_GRACE_MS, PER_AYAH_DURATION_TOLERANCE } = await import('@/audio/engine');
type Output = import('@/audio/engine').AudioOutput;
type Status = import('@/audio/engine').OutputStatus;
const { getReciter, surahAudioUrl, withPerAyahPreview, hasAyahPlayback, RECITERS } = await import('@/audio/reciters');
const { perAyahSegments, perAyahSurahValid, perAyahTiming, perAyahUrl, perAyahSurahs } = await import('@/audio/perAyah');
const { createTimingLoader } = await import('@/audio/timing');
const { audioMode, audioCoverage, hasAyahAudio } = await import('@/audio/availability');

const name = (uri: string) => uri.split('/').slice(-2).join('/');

function setup() {
  const calls: string[] = [];
  const preloads: string[] = [];
  const listeners = new Set<(status: Status) => void>();
  let clock = 0;
  let loaded = '';
  const output: Output = {
    async load(uri, startMs) {
      loaded = uri;
      calls.push(`load ${name(uri)} @${startMs}`);
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
    setNowPlaying: () => undefined,
    preload: (uri) => preloads.push(name(uri)),
  };
  // The real timing loader: a per-ayah reciter's timing comes from its catalogue, nothing is fetched.
  const fetched: string[] = [];
  const timing = createTimingLoader({
    fetchText: async (url) => {
      fetched.push(url);
      // A timed reciter (Abdul Basit) in the reciter-change tests: synthetic timing is not needed, the tests only look at loads.
      throw new Error('offline');
    },
    store: { read: async () => null, write: async () => undefined },
  });
  const engine = createPlaybackEngine({
    output,
    timing: {
      load: async (reciter, surah) => {
        if (reciter.perAyah) return timing.load(reciter, surah);
        return { ok: true, timing: { reciterId: reciter.id, surah, introEndMs: 3000, ayahs: Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => ({ startMs: 3000 + i * 10_000, endMs: 13_000 + i * 10_000 })) } };
      },
      stored: async () => null,
    },
    resolveSource: async (reciter, surah) => ({ uri: surahAudioUrl(reciter, surah), local: false }),
    capability: (reciter, surah) => audioMode(reciter.id, surah),
    now: () => clock,
    schedule: () => () => undefined,
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const status = async (patch: Partial<Status> = {}) => {
    clock += COMMAND_GRACE_MS;
    for (const l of listeners) l({ positionMs: 100, playing: true, buffering: false, loaded: true, finished: false, error: null, durationMs: LENGTH, ...patch });
    await settle();
  };
  /** The loaded file plays to its end (a status inside it, then the player's end report). */
  const finish = async (durationMs = loaded.endsWith('000.mp3') ? BASMALA : LENGTH) => {
    await status({ positionMs: 200, durationMs });
    await status({ positionMs: durationMs, durationMs, finished: true, playing: false });
  };
  const loads = () => calls.filter((c) => c.startsWith('load'));
  return { engine, calls, preloads, fetched, settle, status, finish, loads };
}

async function playing(from: { surah: number; ayah: number }, mode: 'continuous' | 'fullSurah' | 'single' = 'continuous') {
  const t = setup();
  if (mode === 'fullSurah') t.engine.startFullSurah(from.surah, 'gebril-test');
  else t.engine.start(from, { mode, reciterId: 'gebril-test' });
  await t.settle();
  return t;
}

describe('per-ayah recordings: the catalogue', () => {
  it('builds each ayah\'s URL from the folder (SSSAAA.mp3; ayah 0 = the Basmala file)', () => {
    expect(perAyahUrl(FIXTURE, 2, 255)).toBe('https://everyayah.com/data/Fixture_128kbps/002255.mp3');
    expect(perAyahUrl(FIXTURE, 112, 0)).toBe('https://everyayah.com/data/Fixture_128kbps/112000.mp3');
  });

  it('lists a surah only when its file set is complete: every ayah once, the Basmala except for Al-Fatiha and At-Tawbah', () => {
    expect(perAyahSurahs(FIXTURE)).toEqual([1, 2, 9, 112, 113]);
    expect(perAyahSurahValid(3, FIXTURE.surahs[3])).toBe(false); // one ayah missing
    expect(perAyahSurahValid(4, FIXTURE.surahs[4])).toBe(false); // no Basmala file for a surah that has one
    expect(perAyahSurahValid(1, { ...FIXTURE.surahs[1], basmala: [1, 1] })).toBe(false); // Al-Fatiha's Basmala is its ayah 1
    expect(perAyahSurahValid(9, { ...FIXTURE.surahs[9], basmala: [1, 1] })).toBe(false); // At-Tawbah has none
    expect(perAyahSurahValid(112, { ...FIXTURE.surahs[112], ayahs: FIXTURE.surahs[112].ayahs.map((f, i) => (i === 2 ? [f[0], 0] as const : f)) })).toBe(false);
  });

  it('times every ayah as its own whole file, the Basmala first for ayah 1', () => {
    const timing = perAyahTiming(FIXTURE, 2)!;
    expect(timing.ayahs).toHaveLength(286);
    expect(timing.ayahs[254]).toEqual({ startMs: 0, endMs: LENGTH });
    expect(perAyahSegments(timing, 1).map((s) => name(s.url))).toEqual(['Fixture_128kbps/002000.mp3', 'Fixture_128kbps/002001.mp3']);
    expect(perAyahSegments(timing, 2).map((s) => name(s.url))).toEqual(['Fixture_128kbps/002002.mp3']);
    expect(perAyahSegments(perAyahTiming(FIXTURE, 1)!, 1).map((s) => name(s.url))).toEqual(['Fixture_128kbps/001001.mp3']);
    expect(perAyahSegments(perAyahTiming(FIXTURE, 9)!, 1).map((s) => name(s.url))).toEqual(['Fixture_128kbps/009001.mp3']);
    expect(perAyahTiming(FIXTURE, 3)).toBeNull();
  });

  it('becomes a reciter with no surah file and no timing source, playable only where its file set is complete', () => {
    const r = withPerAyahPreview([], [FIXTURE])[0];
    expect(r).toMatchObject({ id: 'gebril-test', server: null, timingSource: null, timingRead: null, surahs: [1, 2, 9, 112, 113] });
    expect(Object.keys(r.timed).map(Number)).toEqual([1, 2, 9, 112, 113]);
    expect(r.timed[112]).toEqual(['fx112', 60_000 + 90_000 + 90_001 + 90_002 + 90_003]);
    expect(hasAyahPlayback(r, 2)).toBe(true);
    expect(hasAyahPlayback(r, 3)).toBe(false);
    // Never two reciters with one id: a preview never replaces a catalogue reciter.
    expect(withPerAyahPreview([r], [FIXTURE])).toHaveLength(1);
  });

  it('plays ayah by ayah where complete, and not at all elsewhere (Full Surah only with every file)', () => {
    expect(audioMode('gebril-test', 2)).toBe('ayah');
    expect(audioMode('gebril-test', 3)).toBe('none');
    expect(audioMode('gebril-test', 50)).toBe('none');
    expect(audioCoverage('gebril-test')).toEqual({ ayah: [1, 2, 9, 112, 113], surah: [] });
    expect(hasAyahAudio(getReciter('gebril-test')!, 3)).toBe(false);
  });

  it('shows only its real coverage in both languages: no development or release status', async () => {
    const { coverageLabel } = await import('@/audio/format');
    const { getMessages } = await import('@/localization/messages');
    const r = getReciter('gebril-test')!; // an unreleased per-ayah recording on trial
    expect(coverageLabel(r, getMessages('en').audio, false)).toBe('5 of 114 surahs');
    expect(coverageLabel(r, getMessages('ar').audio, true)).toBe('٥ من ١١٤ سورة');
    // With all 114 surahs there is no line at all.
    expect(coverageLabel(getReciter('abdulbasit')!, getMessages('en').audio, false)).toBeNull();
  });

  it('times a per-ayah surah from its catalogue, never fetching anything', async () => {
    const loader = createTimingLoader({ fetchText: async () => { throw new Error('no network'); }, store: { read: async () => null, write: async () => undefined } });
    const r = getReciter('gebril-test')!;
    const result = await loader.load(r, 112);
    expect(result.ok && result.timing.perAyah?.files).toHaveLength(4);
    expect(await loader.load(r, 3)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await loader.stored(r, 112)).not.toBeNull(); // offline-safe: nothing to fetch
  });
});

describe('per-ayah recordings: release builds', () => {
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

  it('release builds (__DEV__ false, as tests) play only the released recordings (generated/perAyahRelease.ts), never the preview', () => {
    // RECITERS here is the mocked list with the fixture added; the real module's list has the released Ali Jaber only.
    expect(RECITERS.filter((r) => r.perAyah).map((r) => r.id)).toEqual(['jaber', 'gebril-test']);
    const reciters = src('audio/reciters.ts');
    expect(reciters).toMatch(/const PER_AYAH_PREVIEW: readonly PerAyahRecording\[\] = __DEV__\s*\?[\s\S]*?require\('\.\/generated\/perAyahPreview'\)[\s\S]*?: PER_AYAH_RELEASE;/);
    expect(reciters).toMatch(/export const RECITERS: readonly Reciter\[\] = orderedReciters\(__DEV__\s*\? withPerAyahPreview\(/);
  });

  it('the generated development catalogue is well formed: Mohamed Gebril, every listed surah complete', async () => {
    const { PER_AYAH_PREVIEW } = await import('@/audio/generated/perAyahPreview');
    const g = PER_AYAH_PREVIEW.find((p) => p.reciterId === 'gebril')!;
    expect(g).toMatchObject({ nameEn: 'Mohamed Gebril', nameAr: 'محمد جبريل', provider: 'everyayah', base: 'https://everyayah.com/data/Muhammad_Jibreel_128kbps/' });
    const listed = Object.keys(g.surahs).map(Number);
    expect(perAyahSurahs(g)).toEqual(listed.sort((a, b) => a - b)); // nothing listed that cannot play
    expect(listed).toHaveLength(114);
    expect(listed.reduce((n, s) => n + g.surahs[s].ayahs.length, 0)).toBe(6236);
  });

  it('the generated development catalogue has Ali Abdullah Jaber too, every surah complete, after Gebril', async () => {
    const { PER_AYAH_PREVIEW } = await import('@/audio/generated/perAyahPreview');
    expect(PER_AYAH_PREVIEW.map((p) => p.reciterId)).toEqual(['gebril', 'jaber']);
    const j = PER_AYAH_PREVIEW[1];
    expect(j).toMatchObject({ nameEn: 'Ali Abdullah Jaber', nameAr: 'علي عبد الله جابر', provider: 'everyayah', base: 'https://everyayah.com/data/Ali_Jaber_64kbps/' });
    expect(perAyahSurahs(j)).toHaveLength(114);
    expect(Object.values(j.surahs).reduce((n, s) => n + s.ayahs.length, 0)).toBe(6236);
    // At-Tawbah: no Basmala is played, although EveryAyah has a 009000.mp3 (the same Basmala file as every surah's).
    expect(j.surahs[9].basmala).toBeNull();
    expect(j.surahs[1].basmala).toBeNull();
    // As reciters (development builds): listed after the catalogue's, each its own voice.
    const r = withPerAyahPreview([], PER_AYAH_PREVIEW);
    expect(r.map((x) => [x.id, x.nameEn, x.server, x.surahs.length])).toEqual([['gebril', 'Mohamed Gebril', null, 114], ['jaber', 'Ali Abdullah Jaber', null, 114]]);
    expect(perAyahUrl(j, 2, 255)).toBe('https://everyayah.com/data/Ali_Jaber_64kbps/002255.mp3');
  });

  it('the preview data is imported nowhere else (Metro drops it from a release bundle)', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const users = walk(path.join(__dirname, '..', 'src')).filter((f) => /(from\s*|require\(|import\()'[^']*generated\/perAyahPreview'/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(path.join(__dirname, '..', 'src'), f).replaceAll('\\', '/'))).toEqual(['audio/reciters.ts']);
  });
});

describe('per-ayah playback', () => {
  it('an ayah plays its own file from its start; the next ayah\'s file follows without leaving playback', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    expect(t.loads()).toEqual(['load Fixture_128kbps/002005.mp3 @0']);
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 2, ayah: 5 }, granularity: 'ayah' });
    expect(t.preloads).toEqual(['Fixture_128kbps/002006.mp3']);
    await t.finish();
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/002006.mp3 @0');
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 2, ayah: 6 } });
    expect(t.preloads.at(-1)).toBe('Fixture_128kbps/002007.mp3');
    expect(t.fetched).toEqual([]);
  });

  it('ayah 1 plays the surah\'s Basmala, then its own file, highlighted as ayah 1 throughout', async () => {
    const t = await playing({ surah: 2, ayah: 1 });
    expect(t.loads()).toEqual(['load Fixture_128kbps/002000.mp3 @0']);
    expect(t.preloads).toEqual(['Fixture_128kbps/002001.mp3']);
    await t.finish(BASMALA);
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/002001.mp3 @0');
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 1 });
    await t.finish();
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/002002.mp3 @0');
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 2 });
  });

  it('Al-Fatiha 1 is its own Basmala (no separate file); At-Tawbah has none', async () => {
    expect((await playing({ surah: 1, ayah: 1 })).loads()).toEqual(['load Fixture_128kbps/001001.mp3 @0']);
    expect((await playing({ surah: 9, ayah: 1 })).loads()).toEqual(['load Fixture_128kbps/009001.mp3 @0']);
  });

  it('continues into the next surah with its Basmala, and stops after the Quran\'s last available ayah', async () => {
    const t = await playing({ surah: 112, ayah: 4 });
    expect(t.preloads).toEqual(['Fixture_128kbps/113000.mp3']);
    await t.finish();
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/113000.mp3 @0');
    expect(t.engine.getState().position).toEqual({ surah: 113, ayah: 1 });
  });

  it('Full Surah: every ayah of the surah in order, then stop (never into the next surah)', async () => {
    const t = await playing({ surah: 112, ayah: 1 }, 'fullSurah');
    await t.finish(BASMALA);
    for (let a = 1; a <= 4; a++) {
      expect(t.engine.getState().position).toEqual({ surah: 112, ayah: a });
      await t.finish();
    }
    expect(t.loads()).toEqual(['000', '001', '002', '003', '004'].map((k) => `load Fixture_128kbps/112${k}.mp3 @0`));
    expect(t.engine.getState().phase).toBe('ended');
    expect(t.calls.at(-1)).toBe('stop');
  });

  it('the ayah screens\' single ayah plays once, then ends', async () => {
    const t = await playing({ surah: 2, ayah: 255 }, 'single');
    expect(t.preloads).toEqual([]);
    await t.finish();
    expect(t.engine.getState().phase).toBe('ended');
    expect(t.loads()).toEqual(['load Fixture_128kbps/002255.mp3 @0']);
  });

  it('a surah whose file set is incomplete never plays its own files (no partial surah): the default reciter instead', async () => {
    const t = await playing({ surah: 3, ayah: 5 });
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', reciterId: 'minshawi', preferredReciterId: 'gebril-test' });
    expect(t.loads()).toHaveLength(1);
    expect(t.loads()[0]).toBe('load r1/003.mp3 @43000'); // the harness logs a URL's last two segments (Al-Minshawi: muhammad-minshawi/r1)
    expect(t.loads().some((c) => c.includes('everyayah'))).toBe(false);
  });
});

describe('per-ayah playback: Repeat Ayah', () => {
  for (const [repeat, total] of [[0, 1], [1, 2], [2, 3], [3, 4]] as const) {
    it(`${repeat === 0 ? 'off' : repeat}: one file, recited ${total} time(s) (a seek back to its start, no reload), then the next ayah`, async () => {
      const t = setup();
      t.engine.setRepeat(repeat);
      t.engine.start({ surah: 2, ayah: 5 }, { mode: 'continuous', reciterId: 'gebril-test' });
      await t.settle();
      for (let k = 0; k < total; k++) {
        expect(t.engine.getState().position, `recitation ${k + 1}`).toEqual({ surah: 2, ayah: 5 });
        await t.finish();
      }
      expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
      expect(t.calls.filter((c) => c.startsWith('seek'))).toEqual(Array.from({ length: total - 1 }, () => 'seek @0'));
      expect(t.loads()).toEqual(['load Fixture_128kbps/002005.mp3 @0', 'load Fixture_128kbps/002006.mp3 @0']);
    });
  }

  it('∞: the same ayah until the setting changes', async () => {
    const t = setup();
    t.engine.setRepeat('infinite');
    t.engine.start({ surah: 2, ayah: 5 }, { mode: 'continuous', reciterId: 'gebril-test' });
    await t.settle();
    for (let k = 0; k < 6; k++) await t.finish();
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 5 });
    t.engine.setRepeat(0);
    await t.finish();
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
  });

  it('ayah 1 repeats with its Basmala, and its repeat count is kept across its two files', async () => {
    const t = setup();
    t.engine.setRepeat(1);
    t.engine.start({ surah: 112, ayah: 1 }, { mode: 'continuous', reciterId: 'gebril-test' });
    await t.settle();
    await t.finish(BASMALA);
    await t.finish(); // first recitation
    expect(t.loads().slice(-1)).toEqual(['load Fixture_128kbps/112000.mp3 @0']);
    await t.finish(BASMALA);
    await t.finish(); // second recitation
    expect(t.engine.getState().position).toEqual({ surah: 112, ayah: 2 });
    expect(t.loads().map((l) => l.slice(21, 27))).toEqual(['112000', '112001', '112000', '112001', '112002']);
  });
});

describe('per-ayah playback: controls', () => {
  it('previous / next ayah load that ayah\'s file at once, across surahs', async () => {
    const t = await playing({ surah: 113, ayah: 1 });
    t.engine.skip(-1);
    await t.settle();
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/112004.mp3 @0');
    t.engine.skip(1);
    await t.settle();
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/113000.mp3 @0');
    expect(t.engine.getState().position).toEqual({ surah: 113, ayah: 1 });
  });

  it('previous / next page start the page\'s first ayah', async () => {
    const t = await playing({ surah: 2, ayah: 5 }); // page 2
    t.engine.skipPage(1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 }); // page 3 begins with 2:6
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/002006.mp3 @0');
    t.engine.skipPage(-1);
    await t.settle();
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 1 });
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/002000.mp3 @0');
  });

  it('rapid skips: only the last one plays', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    t.engine.skip(1);
    t.engine.skip(1);
    t.engine.skip(1);
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'playing', position: { surah: 2, ayah: 8 } });
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/002008.mp3 @0');
  });

  it('pause and resume stay on the file; a pause while the next file loads keeps it paused once loaded', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    t.engine.pause();
    expect(t.engine.getState().phase).toBe('paused');
    t.engine.resume();
    expect(t.engine.getState().phase).toBe('playing');
    expect(t.calls.slice(-2)).toEqual(['pause', 'play']);
    await t.status({ positionMs: 200 });
    await t.status({ positionMs: LENGTH, finished: true, playing: false });
    // The next file is loading now; paused meanwhile:
    t.engine.pause();
    await t.settle();
    expect(t.engine.getState()).toMatchObject({ phase: 'paused', position: { surah: 2, ayah: 6 } });
    expect(t.calls.at(-1)).not.toBe('play');
  });

  it('another app records during the transition to the next ayah`s file: paused, and that file never plays', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    await t.status({ positionMs: 200 });
    const plays = t.calls.filter((c) => c === 'play').length;
    // The file ends (the next ayah's file starts loading) and the recording takes the audio focus in the same moment.
    const ending = t.status({ positionMs: LENGTH, durationMs: LENGTH, finished: true, playing: false });
    await t.status({ playing: false, interrupted: true });
    await ending;
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/002006.mp3 @0');
    expect(t.engine.getState()).toMatchObject({ phase: 'paused', position: { surah: 2, ayah: 6 } });
    expect(t.calls.filter((c) => c === 'play')).toHaveLength(plays);
    // The reader presses play: the new file plays.
    t.engine.resume();
    expect(t.calls.at(-1)).toBe('play');
  });

  it('stop unloads and ends the session', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    t.engine.stop();
    expect(t.engine.getState().phase).toBe('idle');
    expect(t.calls.at(-1)).toBe('stop');
    await t.finish();
    expect(t.loads()).toHaveLength(1);
  });

  it('a stale end report of the previous file, right after the next file loads, is ignored', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    await t.finish();
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
    await t.status({ positionMs: LENGTH, finished: true, playing: false }); // still the old file's report
    expect(t.engine.getState().position).toEqual({ surah: 2, ayah: 6 });
    expect(t.loads()).toHaveLength(2);
  });

  it('the player stopping just short of the file\'s end is not taken for a pause from outside the app', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    await t.status({ positionMs: 200 });
    await t.status({ positionMs: LENGTH - 600, playing: false });
    expect(t.engine.getState().phase).toBe('playing');
    // ... but a stop in the middle of the file is (a call, the lock screen).
    await t.status({ positionMs: 2000, playing: false });
    expect(t.engine.getState().phase).toBe('paused');
  });

  it('a file whose loaded length is not the scanned length is not the scanned file: stopped, never played on', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    const off = LENGTH + Math.max(PER_AYAH_DURATION_TOLERANCE.ms, LENGTH * PER_AYAH_DURATION_TOLERANCE.ratio) + 50;
    await t.status({ positionMs: 100, durationMs: off });
    expect(t.engine.getState()).toMatchObject({ phase: 'error', error: { kind: 'source' } });
    expect(t.calls.at(-1)).toBe('pause');
    expect(t.calls).toContain('stop');
  });

  it('a length within the tolerance plays on', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    await t.status({ positionMs: 100, durationMs: LENGTH + 120 });
    expect(t.engine.getState().phase).toBe('playing');
  });
});

describe('per-ayah playback: changing the reciter', () => {
  it('to a timed surah recording: takes over at the next ayah boundary, at that ayah\'s verified start', async () => {
    const t = await playing({ surah: 2, ayah: 5 });
    t.engine.selectReciter('abdulbasit');
    expect(t.engine.getState()).toMatchObject({ reciterId: 'gebril-test', pendingReciterId: 'abdulbasit' });
    await t.status({ positionMs: 3000 });
    expect(t.loads()).toHaveLength(1); // never mid-ayah
    await t.finish();
    expect(t.engine.getState()).toMatchObject({ reciterId: 'abdulbasit', pendingReciterId: null, position: { surah: 2, ayah: 6 } });
    expect(t.loads().at(-1)).toBe('load r3/002.mp3 @53000');
  });

  it('from a timed surah recording: the per-ayah voice takes over at the next ayah with that ayah\'s file', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 5 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await t.settle();
    t.engine.selectReciter('gebril-test');
    await t.status({ positionMs: 43_100, durationMs: undefined });
    await t.status({ positionMs: 53_000, durationMs: undefined });
    expect(t.engine.getState()).toMatchObject({ reciterId: 'gebril-test', position: { surah: 2, ayah: 6 } });
    expect(t.loads().at(-1)).toBe('load Fixture_128kbps/002006.mp3 @0');
  });

  it('a per-ayah reciter without the coming surah is refused with a notice, never substituted', async () => {
    const t = setup();
    t.engine.start({ surah: 3, ayah: 5 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await t.settle();
    t.engine.selectReciter('gebril-test');
    expect(t.engine.getState().notice).toEqual({ kind: 'reciter-unavailable', reciterId: 'gebril-test', surah: 3 });
    expect(t.engine.getState().pendingReciterId).toBeNull();
  });
});
