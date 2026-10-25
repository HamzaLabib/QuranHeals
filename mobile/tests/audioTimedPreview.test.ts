import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { LEN, ONSET, surahOf, TIMED_FIXTURE } from './helpers/timedPreviewFixture';

/**
 * Timed whole-surah previews (audio/timedPreview.ts): Ahmed Mohamed Salama's aligned candidate timing, development only.
 * Tests and release builds run with __DEV__ false, so a fixture is added to the real catalogue's 'ahmed-salama' entry
 * (the same code path as the development build's withTimedPreview), in place of the previews a release build plays.
 */
const FIXTURE = TIMED_FIXTURE;

vi.mock('@/audio/reciters', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/audio/reciters')>();
  const { TIMED_FIXTURE: fixture } = await import('./helpers/timedPreviewFixture');
  const { GENERATED_RECITERS } = await import('@/audio/generated/reciterCatalog');
  const catalogue = real.RECITERS.map((r) => (r.id === fixture.reciterId ? (GENERATED_RECITERS.find((g) => g.id === r.id) as typeof r) : r));
  const all = real.withTimedPreview(catalogue, [fixture]);
  const byId = new Map(all.map((r) => [r.id, r]));
  return { ...real, RECITERS: all, getReciter: (id: string | null | undefined) => (id && byId.get(id)) || null };
});

const { createPlaybackEngine, COMMAND_GRACE_MS } = await import('@/audio/engine');
type Status = import('@/audio/engine').OutputStatus;
const R = await import('@/audio/reciters');
const { previewTiming, previewSurahs } = await import('@/audio/timedPreview');
const { createTimingLoader } = await import('@/audio/timing');
const { audioMode, audioCoverage } = await import('@/audio/availability');
const { localFirstSource } = await import('@/audio/sources');
const { coverageLabel } = await import('@/audio/format');
const { getMessages } = await import('@/localization/messages');

describe('timed previews: the catalogue', () => {
  it('validates each surah: the canonical ayah count, the recorded fingerprint, lengths inside the file', () => {
    expect(previewSurahs(FIXTURE)).toEqual([1, 112, 113]);
    expect(previewTiming(FIXTURE, 2)).toBeNull(); // an ayah missing
    expect(previewTiming(FIXTURE, 3)).toBeNull(); // fingerprint mismatch
    expect(previewTiming({ ...FIXTURE, surahs: { 112: { ...surahOf(112), durationMs: 1000 } } }, 112)).toBeNull(); // timing past the file
    expect(previewTiming({ ...FIXTURE, surahs: { 112: { ...surahOf(112), url: 'http://x/112.mp3' } } }, 112)).toBeNull(); // https only
  });

  it('times a surah for ITS OWN recording: onset, ayahs, and the file the timing belongs to', () => {
    const t = previewTiming(FIXTURE, 112)!;
    expect(t.introEndMs).toBe(ONSET);
    expect(t.ayahs).toEqual([0, 1, 2, 3].map((i) => ({ startMs: ONSET + i * LEN, endMs: ONSET + (i + 1) * LEN })));
    expect(t.recording).toMatchObject({ provider: 'assabile', url: 'https://media.assabile.com/ahmed/112.mp3', bytes: 100_112 });
  });

  it('adds the playable surahs to the catalogue\'s Ahmed Mohamed Salama, never to another reciter', () => {
    const a = R.getReciter('ahmed-salama')!;
    expect(a).toMatchObject({ nameEn: 'Ahmed Mohamed Salama', nameAr: 'أحمد محمد سلامة', server: null, surahs: [1, 112, 113] });
    expect(R.hasAyahPlayback(a, 112)).toBe(true);
    expect(R.hasAyahPlayback(a, 2)).toBe(false);
    // Yasser Mahmoud Salama is another reciter: untouched (only his own released recordings, none of the fixture's).
    const y = R.getReciter('yasser-salama')!;
    const fixtureUrls = Object.values(FIXTURE.surahs).map((x) => x.url);
    expect(y.timedPreview?.reciterId ?? 'yasser-salama').toBe('yasser-salama');
    for (const x of Object.values(y.timedPreview?.surahs ?? {})) expect(fixtureUrls).not.toContain(x.url);
    expect(y.nameEn).toBe('Yasser Mahmoud Salama');
  });

  it('a reciter with a recording of its own gains only surahs with no other timing, and keeps its catalogue', () => {
    const base = R.getReciter('maher')!;
    expect(base.server).not.toBeNull();
    // Synthetic: surah 112 already timed by the catalogue, 113 not (neither listed nor timed).
    const own = { ...base, surahs: base.surahs.filter((s) => s !== 113), timed: Object.fromEntries(Object.entries(base.timed).filter(([s]) => Number(s) !== 113)) };
    const [m] = R.withTimedPreview([own], [{ ...FIXTURE, reciterId: 'maher' }]);
    expect(m.surahs).toEqual(own.surahs); // the MP3Quran list: the only catalogue URLs ever built
    expect(m.timed[112]).toEqual(own.timed[112]); // the catalogue's timing is never replaced
    expect(m.timed[113]).toEqual([FIXTURE.surahs[113].fingerprint, FIXTURE.surahs[113].bytes]);
    expect(Object.keys(m.timedPreview!.surahs).map(Number)).toEqual([1, 113].filter((s) => own.timed[s] === undefined));
    expect(R.hasAyahPlayback(m, 113)).toBe(true);
    // Nothing to add: the reciter is returned unchanged.
    expect(R.withTimedPreview([base], [{ ...FIXTURE, reciterId: 'maher', surahs: { 112: FIXTURE.surahs[112] } }])[0]).toBe(base);
  });

  it('a mixed reciter: the preview surah plays its own file; the registry never builds an MP3Quran source for it', async () => {
    const { createSourceRegistry } = await import('@/audio/sourceRegistry');
    const { GENERATED_FORMATS, GENERATED_PROVIDERS, GENERATED_SURAH_ONLY } = await import('@/audio/generated/sourceRegistry');
    const base = R.getReciter('yasser-salama')!;
    // Synthetic: surah 113 listed by MP3Quran but without timing (as a VBR file is), offered by a preview file.
    const own = { ...base, surahs: [...new Set([...base.surahs, 113])], timed: Object.fromEntries(Object.entries(base.timed).filter(([s]) => Number(s) !== 113)) };
    const [y] = R.withTimedPreview([own], [{ ...FIXTURE, reciterId: 'yasser-salama', surahs: { 113: FIXTURE.surahs[113] } }]);
    const registry = createSourceRegistry({ reciters: [y], providers: GENERATED_PROVIDERS, formats: GENERATED_FORMATS, surahOnly: GENERATED_SURAH_ONLY });
    expect(registry.sourcesFor('yasser-salama', 113)).toEqual([]);
    const loader = createTimingLoader({ fetchText: async () => { throw new Error('no network'); }, store: { read: async () => null, write: async () => undefined } });
    const r = await loader.load(y, 113);
    expect(r.ok && r.timing.recording?.url).toBe('https://media.way2quran.com/ahmed/113.mp3');
    expect(await localFirstSource({ uri: async () => null })(y, 113, r.ok ? r.timing : null)).toEqual({ uri: 'https://media.way2quran.com/ahmed/113.mp3', local: false, bytes: 100_113, verify: true });
  });

  it('plays ayah by ayah where valid, nothing elsewhere, and never a whole surah', () => {
    expect(audioMode('ahmed-salama', 112)).toBe('ayah');
    expect(audioMode('ahmed-salama', 2)).toBe('none');
    expect(audioCoverage('ahmed-salama')).toEqual({ ayah: [1, 112, 113], surah: [] });
  });

  it('shows only its playable coverage in both languages: no development or release status', () => {
    const a = R.getReciter('ahmed-salama')!; // the fixture: an unreleased timed preview
    expect(coverageLabel(a, getMessages('en').audio, false)).toBe('3 of 114 surahs');
    expect(coverageLabel(a, getMessages('ar').audio, true)).toBe('٣ من ١١٤ سورة');
  });

  it('the timing loader serves the preview without any request; the source is that recording, checked before it plays', async () => {
    const loader = createTimingLoader({ fetchText: async () => { throw new Error('no network'); }, store: { read: async () => null, write: async () => undefined } });
    const a = R.getReciter('ahmed-salama')!;
    const r = await loader.load(a, 113);
    expect(r.ok && r.timing.recording?.url).toBe('https://media.way2quran.com/ahmed/113.mp3');
    expect(await loader.load(a, 2)).toEqual({ ok: false, reason: 'unavailable' });
    const resolve = localFirstSource({ uri: async () => null });
    expect(await resolve(a, 113, r.ok ? r.timing : null)).toEqual({ uri: 'https://media.way2quran.com/ahmed/113.mp3', local: false, bytes: 100_113, verify: true });
  });
});

describe('timed previews: the generated development catalogue', () => {
  const byId = async () => new Map((await import('@/audio/generated/timedPreview')).TIMED_PREVIEW.map((p) => [p.reciterId, p]));
  const listed = (p: { surahs: Record<number, unknown> }) => Object.keys(p.surahs).map(Number).sort((x, y) => x - y);

  it('every listed surah passes the app\'s own timing check; never an on-hold reciter', async () => {
    const all = await byId();
    expect([...all.keys()]).toEqual(['ahmed-salama', 'ajmi', 'islam-sobhi', 'saleh-talib', 'yasser-salama']);
    for (const p of all.values()) expect(previewSurahs(p)).toEqual(listed(p));
  });

  it('Ahmed Mohamed Salama: all 114, one whole file per surah from the selected host (1, 3, 6, 90 with Reviewer 1\'s times)', async () => {
    const a = (await byId()).get('ahmed-salama')!;
    expect(listed(a)).toHaveLength(114);
    for (const s of listed(a)) expect(a.surahs[s].url).toMatch(/^https:\/\/media\.(way2quran|assabile)\.com\/.*ahmed-mohamed-salama/);
    expect(new Set(listed(a).map((s) => a.surahs[s].provider))).toEqual(new Set(['way2quran', 'assabile']));
    // The four very high risk starts were decided by Reviewer 1 (90:13 corrected to 62,330 ms).
    for (const s of [1, 3, 6, 90]) expect(a.surahs[s].automatic, String(s)).toBe(0);
    expect(previewTiming(a, 90)!.ayahs[12].startMs).toBe(62_330);
  });

  it('reciters with an MP3Quran recording: only surahs it does not list or serves as VBR, from direct (non-redirecting) https URLs', async () => {
    const all = await byId();
    const t = all.get('saleh-talib')!;
    const s = all.get('islam-sobhi')!;
    const y = all.get('yasser-salama')!;
    expect(listed(t)).toEqual([12, 14, 19, 21, 29, 32, 48, 51, 62, 63, 67, 68, 69, 71, 87, 88, 89, 91, 92, 93, 94, 95, 97, 98, 99, 100, 101, 102, 104, 105, 106, 107, 109, 110, 112, 113, 114]);
    for (const n of listed(t)) expect(t.surahs[n].url).toMatch(/^https:\/\/ia\d+\.us\.archive\.org\/\d+\/items\//);
    expect(listed(s)).toEqual([21, 23, 25, 29, 30, 38, 47, 48, 49, 52, 57, 62, 65, 72, 95, 98, 100, 101, 104, 105, 106, 107, 110, 111]);
    expect(s.surahs[65].url).toBe('https://media.way2quran.com/islam-sobhi/hafs-an-asim/065.mp3');
    expect(listed(y)).toEqual([42]);
    const j = all.get('ajmi')!;
    expect(listed(j)).toEqual([42]);
    expect(j.surahs[42].url).toBe('https://download.quranicaudio.com/quran/ahmed_ibn_3ali_al-3ajamy/042.mp3');
    const { GENERATED_RECITERS } = await import('@/audio/generated/reciterCatalog');
    const { GENERATED_FORMATS } = await import('@/audio/generated/sourceRegistry');
    for (const p of [t, s, y, j]) {
      const g = GENERATED_RECITERS.find((r) => r.id === p.reciterId)!;
      const f = GENERATED_FORMATS[p.reciterId];
      for (const n of listed(p)) {
        // Never over the catalogue's own timing; a listed surah only where the catalogue's file is VBR (no exact seeking).
        expect(g.timed[n], `${p.reciterId} ${n}`).toBeUndefined();
        if (g.surahs.includes(n)) expect((f.exceptions[n] ?? [0, 0, f.bitrateMode])[2], `${p.reciterId} ${n}`).toBe('vbr');
        expect(p.surahs[n].url).not.toMatch(/mp3quran/);
      }
    }
  });
});

describe('timed previews: release builds', () => {
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  it('load the preview only in development builds, and nothing else imports it', () => {
    expect(src('audio/reciters.ts')).toMatch(/const TIMED_PREVIEW: readonly TimedPreviewRecording\[\] = __DEV__\s*\?[\s\S]*?require\('\.\/generated\/timedPreview'\)[\s\S]*?: \[\];/);
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
    const users = walk(path.join(__dirname, '..', 'src')).filter((f) => /(from\s*|require\(|import\()'[^']*generated\/timedPreview'/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map((f) => path.basename(f))).toEqual(['reciters.ts']);
  });
});

describe('timed previews: playback (the engine\'s timed path)', () => {
  function setup() {
    const calls: string[] = [];
    const listeners = new Set<(s: Status) => void>();
    let clock = 0;
    const checks: string[] = [];
    const loader = createTimingLoader({ fetchText: async () => { throw new Error('offline'); }, store: { read: async () => null, write: async () => undefined } });
    const engine = createPlaybackEngine({
      output: {
        async load(uri, ms) { calls.push(`load ${uri.split('/').pop()} @${ms}`); },
        async seek(ms) { calls.push(`seek @${ms}`); },
        play: () => calls.push('play'), pause: () => calls.push('pause'), stop: () => calls.push('stop'),
        subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
        setNowPlaying: () => undefined, preload: () => undefined,
      },
      timing: loader,
      resolveSource: localFirstSource({ uri: async () => null }),
      capability: (reciter, surah) => audioMode(reciter.id, surah),
      checkStream: async (uri) => { checks.push(uri.split('/').pop()!); return 'ok'; },
      now: () => clock,
      schedule: () => () => undefined,
    });
    const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const at = async (positionMs: number) => {
      clock += COMMAND_GRACE_MS;
      for (const l of listeners) l({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null });
      await settle();
    };
    return { engine, calls, checks, settle, at };
  }

  it('an ayah starts at its aligned start in its own file, after the stream check; ayah 1 from the file\'s start', async () => {
    const t = setup();
    t.engine.start({ surah: 112, ayah: 3 }, { mode: 'continuous', reciterId: 'ahmed-salama' });
    await t.settle();
    expect(t.checks).toEqual(['112.mp3']);
    expect(t.calls.filter((c) => c.startsWith('load'))).toEqual([`load 112.mp3 @${ONSET + 2 * LEN}`]);
    const u = setup();
    u.engine.start({ surah: 112, ayah: 1 }, { mode: 'continuous', reciterId: 'ahmed-salama' });
    await u.settle();
    expect(u.calls.filter((c) => c.startsWith('load'))).toEqual(['load 112.mp3 @0']);
  });

  it('follows ayahs inside the file and moves to the next surah\'s own file (another host)', async () => {
    const t = setup();
    t.engine.start({ surah: 112, ayah: 4 }, { mode: 'continuous', reciterId: 'ahmed-salama' });
    await t.settle();
    await t.at(ONSET + 3 * LEN + 100);
    await t.at(ONSET + 4 * LEN);
    expect(t.engine.getState().position).toEqual({ surah: 113, ayah: 1 });
    expect(t.calls.filter((c) => c.startsWith('load')).at(-1)).toBe('load 113.mp3 @0');
    expect(t.checks).toEqual(['112.mp3', '113.mp3']);
  });

  it('Full Surah follows every ayah, then stops; Repeat seeks back to the ayah\'s aligned start', async () => {
    const t = setup();
    t.engine.setRepeat(1);
    t.engine.startFullSurah(112, 'ahmed-salama');
    await t.settle();
    for (let a = 1; a <= 4; a++) {
      for (let k = 0; k < 2; k++) {
        expect(t.engine.getState().position).toEqual({ surah: 112, ayah: a });
        await t.at(ONSET + (a - 1) * LEN + 100);
        await t.at(ONSET + a * LEN);
      }
    }
    expect(t.engine.getState().phase).toBe('ended');
    expect(t.calls.filter((c) => c.startsWith('seek'))).toEqual(['seek @0', `seek @${ONSET + LEN}`, `seek @${ONSET + 2 * LEN}`, `seek @${ONSET + 3 * LEN}`]);
  });

  it('a surah without valid preview timing never plays its file (no untimed fallback): the default reciter\'s verified timing is asked for', async () => {
    const t = setup();
    t.engine.start({ surah: 2, ayah: 5 }, { mode: 'continuous', reciterId: 'ahmed-salama' });
    await t.settle();
    // Al-Minshawi is asked for; his timing is fetched from MP3Quran, which this test's loader refuses (offline).
    expect(t.engine.getState()).toMatchObject({ reciterId: 'minshawi', preferredReciterId: 'ahmed-salama', error: { kind: 'network', surah: 2, reciterId: 'minshawi' } });
    expect(t.calls.filter((c) => c.startsWith('load'))).toEqual([]);
  });
});
