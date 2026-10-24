import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExpoOutput } from '@/audio/expoOutput';
import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { GENERATED_FORMATS, GENERATED_PROVIDERS, GENERATED_SURAH_ONLY } from '@/audio/generated/sourceRegistry';
import { TIMED_PREVIEW } from '@/audio/generated/timedPreview';
import { VBR_TIMING } from '@/audio/generated/vbrTiming';
import { indexSeekUrls, INDEX_SEEK_URLS, RECITERS, withDevelopmentTiming, withVbrSeek } from '@/audio/reciters';
import { createSourceRegistry } from '@/audio/sourceRegistry';
import { previewEntries, previewTiming, type TimedPreviewRecording } from '@/audio/timedPreview';
import { ayahStartMs, type SurahTiming } from '@/audio/timing';
import { timingFingerprint } from '@/audio/timingFingerprint';
import { EXACT_MP3_SEEK_HEADER, readNativeMp3Seek, VBR_SEEK_DEVICE_VERIFIED, vbrSeekEnabled } from '@/audio/vbrSeek';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/**
 * 2026-10-24 work on Islam Sobhi, Yasser Mahmoud Salama 48 and Ahmed Al-Agamy 42: exact VBR seeking behind capability
 * detection (audio/vbrSeek.ts, native-patches/expo-audio-exact-mp3-seek) and the opening point of timed preview files
 * that begin with audio outside the recitation (timedPreview.ts openingMs). Every test also pins that nothing changes
 * for anything else.
 */
const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const sobhi = GENERATED_RECITERS.find((r) => r.id === 'islam-sobhi')!;
const formatOf = (id: string, s: number) => GENERATED_FORMATS[id].exceptions[s]?.[2] ?? GENERATED_FORMATS[id].bitrateMode;

describe('exact VBR seeking: capability detection', () => {
  it('needs a patched binary AND a device-verified method or the device-test flag', () => {
    expect(vbrSeekEnabled(null, '1')).toBe(false);
    expect(vbrSeekEnabled('index', undefined)).toBe(false);
    expect(vbrSeekEnabled('index', '0')).toBe(false);
    expect(vbrSeekEnabled('index', '1')).toBe(true);
    expect(vbrSeekEnabled('avfoundation-precise', undefined, { index: false, 'avfoundation-precise': true })).toBe(true);
  });

  it('device verification (owner, 2026-10-24): iOS only; Android still needs the device-test flag', () => {
    expect(VBR_SEEK_DEVICE_VERIFIED).toEqual({ index: false, 'avfoundation-precise': true });
    expect(vbrSeekEnabled('avfoundation-precise', undefined)).toBe(true); // a patched iPhone binary, no flag
    expect(vbrSeekEnabled('index', undefined)).toBe(false); // a patched Android binary, no flag
    expect(vbrSeekEnabled(null, undefined)).toBe(false); // any unpatched binary (every release build), either platform
  });

  it('an unpatched binary (tests, web) reports nothing, and the app then uses no VBR timing at all', () => {
    expect(readNativeMp3Seek()).toBeNull();
    expect(INDEX_SEEK_URLS.size).toBe(0);
    for (const r of RECITERS) expect(r.vbrIndexSeekSurahs, r.id).toBeUndefined();
  });

  it('the VBR timing is required only in development builds with the capability, and nothing else imports it', () => {
    expect(src('audio/reciters.ts')).toMatch(/const VBR_TIMING: DevTiming = __DEV__ && vbrSeekEnabled\(readNativeMp3Seek\(\), process\.env\.EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST\)\s*\?[\s\S]*?require\('\.\/generated\/vbrTiming'\)[\s\S]*?: \{\};/);
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
    const users = walk(path.join(__dirname, '..', 'src')).filter((f) => /generated\/vbrTiming'/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map((f) => path.basename(f))).toEqual(['reciters.ts']);
  });
});

describe('exact VBR seeking: the generated timing (generated/vbrTiming.ts)', () => {
  it('only the three reciters\' target surahs, each a VBR file of the catalogue, canonical ayah count, positive lengths', () => {
    expect(Object.keys(VBR_TIMING).sort()).toEqual(['ajmi', 'islam-sobhi', 'yasser-salama']);
    expect(Object.keys(VBR_TIMING.ajmi).map(Number)).toEqual([42]);
    expect(Object.keys(VBR_TIMING['yasser-salama']).map(Number)).toEqual([48]);
    for (const s of [17, 24, 74, 109]) expect(VBR_TIMING['islam-sobhi'][s], `excluded ${s}`).toBeUndefined();
    for (const [id, surahs] of Object.entries(VBR_TIMING)) {
      const g = GENERATED_RECITERS.find((r) => r.id === id)!;
      for (const [k, x] of Object.entries(surahs)) {
        const s = Number(k);
        expect(g.surahs, `${id} ${s}`).toContain(s);
        expect(formatOf(id, s), `${id} ${s}`).toBe('vbr');
        expect(g.timed[s], `${id} ${s} has no other timing`).toBeUndefined();
        expect(x.deltas.length - 1).toBe(SURAH_AYAH_COUNTS[s - 1]);
        expect(x.deltas.slice(1).every((d) => d > 0)).toBe(true);
        const entries = previewEntries({ provider: 'mp3quran', url: 'x', bytes: x.bytes, durationMs: 1, fingerprint: '', deltas: x.deltas });
        expect(timingFingerprint(entries), `${id} ${s}`).toBe(x.fingerprint);
      }
    }
  });
});

describe('exact VBR seeking: composition and registry (as a development build with a patched binary)', () => {
  const vbr = { 'islam-sobhi': { 99: VBR_TIMING['islam-sobhi'][99] } };
  const dev = withVbrSeek(withDevelopmentTiming([sobhi], vbr), vbr);
  const registry = (reciters: readonly (typeof dev)[number][]) => createSourceRegistry({ reciters, providers: GENERATED_PROVIDERS, formats: GENERATED_FORMATS, surahOnly: GENERATED_SURAH_ONLY });

  it('marks exactly the VBR surahs it times, and only those files are told to seek exactly', () => {
    expect(dev[0].vbrIndexSeekSurahs).toEqual([99]);
    expect([...indexSeekUrls(dev)]).toEqual([`${sobhi.server}099.mp3`]);
  });

  it('a marked VBR surah plays ayah by ayah; unmarked, the same timing never makes a VBR file playable', () => {
    expect(registry(dev).capability('islam-sobhi', 99).mode).toBe('ayah');
    const unmarked = withDevelopmentTiming([sobhi], vbr);
    expect(registry(unmarked).capability('islam-sobhi', 99).mode).toBe('none');
  });

  it('every CBR surah\'s capability and sources are identical with or without the marking', () => {
    const before = registry(withDevelopmentTiming([sobhi], {}));
    const after = registry(dev);
    for (let s = 1; s <= 114; s++) if (s !== 99) expect(after.capability('islam-sobhi', s), String(s)).toEqual(before.capability('islam-sobhi', s));
  });
});

describe('exact VBR seeking: the expo-audio output', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function fake() {
    const sources: unknown[] = [];
    const player = {
      isLoaded: false, currentStatus: { error: null }, pause: () => undefined, play: () => undefined,
      replace: (s: unknown) => { sources.push(s); player.isLoaded = true; },
      seekTo: async () => undefined, addListener: () => ({ remove: () => undefined }),
      setActiveForLockScreen: () => undefined, updateLockScreenMetadata: () => undefined, clearLockScreenControls: () => undefined,
    };
    const module = { setAudioModeAsync: async () => undefined, createAudioPlayer: () => player, preload: async () => undefined, clearAllPreloadedSources: async () => undefined };
    return { sources, load: async () => module as never };
  }

  it('only listed files carry the marker header; every other source loads exactly as before ({ uri })', async () => {
    const f = fake();
    const out = createExpoOutput(f.load, new Set(['https://x/099.mp3']));
    const a = out.load('https://x/099.mp3', 0);
    await vi.advanceTimersByTimeAsync(200);
    await a;
    const b = out.load('https://x/001.mp3', 0);
    await vi.advanceTimersByTimeAsync(200);
    await b;
    expect(f.sources).toEqual([{ uri: 'https://x/099.mp3', headers: { [EXACT_MP3_SEEK_HEADER]: 'index' } }, { uri: 'https://x/001.mp3' }]);
    const g = fake();
    const plain = createExpoOutput(g.load);
    const c = plain.load('https://x/099.mp3', 0);
    await vi.advanceTimersByTimeAsync(200);
    await c;
    expect(g.sources).toEqual([{ uri: 'https://x/099.mp3' }]);
  });
});

describe('exact VBR seeking: the native patch (not applied by any install hook)', () => {
  it('its anchors match the installed expo-audio exactly once each (or it is already applied)', () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'native-patches', 'expo-audio-exact-mp3-seek', 'apply.mjs'), '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/check passed: nothing written/);
  });

  it('package.json runs no native patch on install', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(JSON.stringify(pkg.scripts ?? {})).not.toMatch(/native-patches|patch-package/);
  });
});

describe('opening point of a timed preview file (openingMs)', () => {
  const timing = (openingMs?: number): SurahTiming => ({ reciterId: 'x', surah: 112, introEndMs: 5000, ayahs: [0, 1, 2, 3].map((i) => ({ startMs: 5000 + i * 4000, endMs: 9000 + i * 4000 })), ...(openingMs !== undefined ? { openingMs } : {}) });

  it('ayah 1 starts at the opening point; without one, at 0 exactly as before; other ayahs unchanged', () => {
    expect(ayahStartMs(timing(), 1)).toBe(0);
    expect(ayahStartMs(timing(3000), 1)).toBe(3000);
    expect(ayahStartMs(timing(3000), 2)).toBe(9000);
    expect(ayahStartMs({ ...timing(3000), perAyah: { files: [], opening: null } }, 1)).toBe(0);
  });

  it('a preview surah\'s opening point must lie before ayah 1\'s words', () => {
    const n = 4;
    const deltas = [5000, ...Array.from({ length: n }, () => 4000)];
    const entries = Array.from({ length: n }, (_, i) => ({ ayah: i + 1, startMs: 5000 + i * 4000, endMs: 9000 + i * 4000 }));
    const s = { provider: 'archive', url: 'https://x/112.mp3', bytes: 1, durationMs: 30_000, fingerprint: timingFingerprint(entries), deltas };
    const rec = (openingMs?: number): TimedPreviewRecording => ({ reciterId: 'x', evidence: '', generatedOn: '', surahs: { 112: { ...s, ...(openingMs !== undefined ? { openingMs } : {}) } } });
    expect(previewTiming(rec(), 112)?.openingMs).toBeUndefined();
    expect(previewTiming(rec(4000), 112)?.openingMs).toBe(4000);
    expect(previewTiming(rec(5000), 112)).toBeNull();
    expect(previewTiming(rec(-1), 112)).toBeNull();
  });

  it('in the generated catalogue only the ten Islam Sobhi copies with an introduction have one', () => {
    const withOpening = TIMED_PREVIEW.flatMap((p) => Object.entries(p.surahs).filter(([, x]) => x.openingMs !== undefined).map(([s]) => `${p.reciterId}:${s}`));
    expect(withOpening.sort()).toEqual(['21', '25', '29', '38', '47', '48', '49', '52', '110', '111'].map((s) => `islam-sobhi:${s}`).sort());
    for (const p of TIMED_PREVIEW) for (const s of Object.keys(p.surahs).map(Number)) expect(previewTiming(p, s), `${p.reciterId} ${s}`).not.toBeNull();
  });
});
