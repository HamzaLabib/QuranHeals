import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { coverageLabel } from '@/audio/format';
import { REVIEWED_RELEASE, TIMED_PREVIEW_RELEASE, VBR_RELEASE } from '@/audio/generated/timingRelease';
import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { REVIEWED_TIMING } from '@/audio/generated/reviewedTiming';
import { TIMED_PREVIEW } from '@/audio/generated/timedPreview';
import { VBR_TIMING } from '@/audio/generated/vbrTiming';
import { RECITERS, vbrReleaseFor, withReleasedTiming, withTimedPreview } from '@/audio/reciters';
import { MESSAGES } from '@/localization/messages';

/**
 * The release path of reviewed, VBR and timed-preview timing (tools/quran-audio/development/generate-timing-release.mjs
 * → generated/timingRelease.ts → audio/reciters.ts). Fixture device records only: none of them is real evidence.
 */
type Gen = {
  DEVICE_RECORD_KIND: string;
  releaseTiming: (input: Record<string, unknown>) => {
    reviewed: Record<string, Record<number, unknown>>;
    vbr: Record<string, Record<number, { platforms: string[] }>>;
    timedPreview: { reciterId: string; released?: true; surahs: Record<number, unknown> }[];
    report: Record<string, Record<string, Record<number, { released: boolean; gates: { gate: string; pass: boolean; why: string }[] }>>>;
  };
  renderTimingRelease: (r: unknown) => string;
};
const gen = (await import('../../tools/quran-audio/development/generate-timing-release.mjs')) as unknown as Gen;
const providers = ((await import('../../tools/quran-audio/providers.mjs')) as { PROVIDERS: { id: string; name: string; streaming: { permitted: boolean; evidence: string } }[] }).PROVIDERS;
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const audit = JSON.parse(read('../../tools/quran-audio/audit-results.json'));
const ayahCounts = JSON.parse(read('../../tools/quran-audio/audit-data/ayah-counts.json'));
const credits = read('../src/constants/quranSources.ts');
const input = (over: Record<string, unknown> = {}) => ({ reviewed: REVIEWED_TIMING, vbr: VBR_TIMING, timedPreview: TIMED_PREVIEW, record: null, audit, ayahCounts, providers, credits, ...over });

const METHOD = { 'Pixel 7': 'index', 'iPhone 14': 'avfoundation-precise' } as Record<string, string>;
const passed = (device: string, checks = ['ayah-starts', 'full-surah', 'background']) => ({ passed: true, device, testedOn: '2026-11-01', build: 'fixture-build', runtime: '80848c9e', nativeSeek: METHOD[device], checks });
const entry = (reciterId: string, surah: number, x: { fingerprint: string; bytes: number }, platforms: Record<string, unknown>) => ({ reciterId, surah, fingerprint: x.fingerprint, bytes: x.bytes, ...platforms });
const record = (...entries: unknown[]) => ({ kind: gen.DEVICE_RECORD_KIND, entries });
const banna2 = REVIEWED_TIMING.banna[2];
const yasser48 = VBR_TIMING['yasser-salama'][48];

describe('timing release: the generator gates', () => {
  it('today nothing is released, and generated/timingRelease.ts is exactly the generator\'s output from the current inputs', () => {
    const r = gen.releaseTiming(input());
    expect(r.reviewed).toEqual({});
    expect(r.vbr).toEqual({});
    expect(r.timedPreview).toEqual([]);
    expect(read('../src/audio/generated/timingRelease.ts')).toBe(gen.renderTimingRelease(r));
    expect(REVIEWED_RELEASE).toEqual({});
    expect(VBR_RELEASE).toEqual({});
    expect(TIMED_PREVIEW_RELEASE).toEqual([]);
  });

  it('every reviewed and VBR surah passes timing, review, integrity, provider and attribution: only the device record is missing', () => {
    const { report } = gen.releaseTiming(input());
    for (const kind of ['reviewed', 'vbr'] as const) {
      for (const [id, surahs] of Object.entries(report[kind])) {
        for (const [s, x] of Object.entries(surahs)) expect(x.gates.filter((g) => !g.pass).map((g) => g.gate), `${kind} ${id}:${s}`).toEqual(['devices']);
      }
    }
  });

  it('timed previews are blocked by their providers\' rights, whatever the device record', () => {
    const { report } = gen.releaseTiming(input());
    for (const [id, surahs] of Object.entries(report.timedPreview)) {
      for (const [s, x] of Object.entries(surahs)) expect(x.gates.find((g) => g.gate === 'provider')?.pass, `${id}:${s}`).toBe(false);
    }
  });

  it('a reviewed surah is released only with passed Android AND iOS results for exactly its timing and file', () => {
    const both = gen.releaseTiming(input({ record: record(entry('banna', 2, banna2, { android: passed('Pixel 7'), ios: passed('iPhone 14') })) }));
    expect(Object.keys(both.reviewed)).toEqual(['banna']);
    expect(Object.keys(both.reviewed.banna).map(Number)).toEqual([2]);
    expect(gen.releaseTiming(input({ record: record(entry('banna', 2, banna2, { android: passed('Pixel 7') })) })).reviewed).toEqual({});
    expect(gen.releaseTiming(input({ record: record(entry('banna', 2, { ...banna2, fingerprint: 'ffffffff' }, { android: passed('Pixel 7'), ios: passed('iPhone 14') })) })).reviewed).toEqual({});
    expect(gen.releaseTiming(input({ record: record(entry('banna', 2, banna2, { android: passed('Pixel 7', ['ayah-starts']), ios: passed('iPhone 14') })) })).reviewed).toEqual({});
    expect(gen.releaseTiming(input({ record: { kind: 'something-else', entries: [entry('banna', 2, banna2, { android: passed('Pixel 7'), ios: passed('iPhone 14') })] } })).reviewed).toEqual({});
  });

  it('fails closed on evidence that does not name the exact tested binary and capability', () => {
    const both = (android: unknown, ios: unknown = passed('iPhone 14')) => gen.releaseTiming(input({ record: record(entry('banna', 2, banna2, { android, ios })) })).reviewed;
    expect(both({ ...passed('Pixel 7'), nativeSeek: undefined })).toEqual({}); // an unpatched binary reports none
    expect(both({ ...passed('Pixel 7'), nativeSeek: 'avfoundation-precise' })).toEqual({}); // another platform's player
    expect(both({ ...passed('Pixel 7'), runtime: undefined })).toEqual({});
    expect(both({ ...passed('Pixel 7'), runtime: 'not-hex!' })).toEqual({});
    expect(both({ ...passed('Pixel 7'), build: '' })).toEqual({});
    expect(both({ ...passed('Pixel 7'), testedOn: 'yesterday' })).toEqual({});
    expect(both({ ...passed('Pixel 7'), passed: 'true' })).toEqual({}); // only the boolean true counts
    expect(both({ ...passed('Pixel 7'), checks: 'ayah-starts,full-surah,background' })).toEqual({});
  });

  it('even with passing device evidence, refuses timing whose review, size or exclusivity is not established', () => {
    const rec = record(entry('banna', 2, banna2, { android: passed('Pixel 7'), ios: passed('iPhone 14') }));
    const release = (reviewed: unknown, extra: Record<string, unknown> = {}) => gen.releaseTiming(input({ reviewed, record: rec, ...extra })).reviewed;
    expect(Object.keys(release({ banna: { 2: banna2 } }))).toEqual(['banna']); // the control: it would be released
    expect(release({ banna: { 2: { ...banna2, automatic: banna2.automatic + 1 } } })).toEqual({}); // counts ≠ ayahs
    expect(release({ banna: { 2: { ...banna2, reviewer1: undefined, automatic: undefined } } })).toEqual({});
    expect(release({ banna: { 2: banna2 } }, { development: { banna: { 2: banna2 } } })).toEqual({}); // development timing first
    const noSize = { ...banna2, bytes: undefined };
    expect(gen.releaseTiming(input({ reviewed: { banna: { 2: noSize } }, record: record(entry('banna', 2, noSize as never, { android: passed('Pixel 7'), ios: passed('iPhone 14') })) })).reviewed).toEqual({});
  });

  it('two preview recordings for one reciter are ambiguous: neither is released', () => {
    const preview = TIMED_PREVIEW.find((p) => p.reciterId === 'ahmed-salama')!;
    const [s, x] = Object.entries(preview.surahs).find(([, y]) => y.provider === 'way2quran')!;
    const permitting = providers.map((p) => (p.id === 'way2quran' ? { ...p, streaming: { permitted: true, evidence: 'fixture' } } : p));
    const ok = { ...entry('ahmed-salama', Number(s), x, { android: passed('Pixel 7'), ios: passed('iPhone 14') }), url: x.url };
    const r = gen.releaseTiming(input({ timedPreview: [preview, { ...preview, evidence: 'another' }], providers: permitting, credits: `${credits}\nkey: 'way2quran'`, record: record(ok) }));
    expect(r.timedPreview).toEqual([]);
  });

  it('fails closed on a malformed or ambiguous record', () => {
    const ok = entry('banna', 2, banna2, { android: passed('Pixel 7'), ios: passed('iPhone 14') });
    expect(gen.releaseTiming(input({ record: { kind: gen.DEVICE_RECORD_KIND, entries: 'everything passed' } })).reviewed).toEqual({});
    expect(gen.releaseTiming(input({ record: { kind: gen.DEVICE_RECORD_KIND } })).reviewed).toEqual({});
    expect(gen.releaseTiming(input({ record: record(ok, ok) })).reviewed).toEqual({});
    expect(gen.releaseTiming(input({ record: record(null, ok) })).reviewed.banna[2]).toBeDefined(); // a stray null entry is ignored, not trusted
  });

  it('a VBR surah is released per platform that passed, including the far-seek check', () => {
    const vbrChecks = ['ayah-starts', 'full-surah', 'background', 'far-seek'];
    const ios = gen.releaseTiming(input({ record: record(entry('yasser-salama', 48, yasser48, { ios: passed('iPhone 14', vbrChecks) })) }));
    expect(ios.vbr['yasser-salama'][48].platforms).toEqual(['avfoundation-precise']);
    const noFar = gen.releaseTiming(input({ record: record(entry('yasser-salama', 48, yasser48, { ios: passed('iPhone 14') })) }));
    expect(noFar.vbr).toEqual({});
  });

  it('a timed preview from a permitting, credited provider with a device record is released, marked released', () => {
    const preview = TIMED_PREVIEW.find((p) => p.reciterId === 'ahmed-salama')!;
    const [s, x] = Object.entries(preview.surahs).find(([, y]) => y.provider === 'way2quran')!;
    const permitting = providers.map((p) => (p.id === 'way2quran' ? { ...p, streaming: { permitted: true, evidence: 'fixture' } } : p));
    const withUrl = (url: string) => ({ ...entry('ahmed-salama', Number(s), x, { android: passed('Pixel 7'), ios: passed('iPhone 14') }), url });
    const r = gen.releaseTiming(input({ providers: permitting, credits: `${credits}\nkey: 'way2quran'`, record: record(withUrl(x.url)) }));
    expect(r.timedPreview).toHaveLength(1);
    expect(r.timedPreview[0]).toMatchObject({ reciterId: 'ahmed-salama', released: true });
    expect(Object.keys(r.timedPreview[0].surahs)).toEqual([s]);
    // The record must name this exact file: another URL (same size and timing) releases nothing.
    expect(gen.releaseTiming(input({ providers: permitting, credits: `${credits}\nkey: 'way2quran'`, record: record(withUrl(`${x.url}?other`)) })).timedPreview).toEqual([]);
  });
});

describe('timing release: the app (release build: vitest\'s __DEV__ is false)', () => {
  it('plays no reviewed, VBR or timed-preview surah today: exactly the production catalogue', () => {
    for (const r of RECITERS) {
      const catalogue = GENERATED_RECITERS.find((g) => g.id === r.id);
      if (catalogue) expect(Object.keys(r.timed), r.id).toEqual(Object.keys(catalogue.timed));
      expect(r.releasedSurahs, r.id).toBeUndefined();
      expect(r.timedPreview, r.id).toBeUndefined();
    }
  });

  it('released reviewed timing becomes playable, marked released, never labelled a preview, never over production timing', () => {
    const released = { banna: { 2: banna2 }, abdulbasit: { 1: banna2 } };
    const reciters = withReleasedTiming(GENERATED_RECITERS, released);
    const banna = reciters.find((r) => r.id === 'banna')!;
    expect(banna.timed[2]).toEqual([banna2.fingerprint, banna2.bytes]);
    expect(banna.releasedSurahs).toEqual([2]);
    expect(banna.developmentSurahs).toBeUndefined();
    expect(banna.timingSourceBySurah).toEqual({ 2: 'measured' });
    expect(coverageLabel(banna, MESSAGES.en.audio, false) ?? '').not.toContain(MESSAGES.en.audio.developmentPreview);
    const abdulbasit = reciters.find((r) => r.id === 'abdulbasit')!;
    expect(abdulbasit.releasedSurahs).toBeUndefined(); // surah 1 already has production timing
  });

  it('a released timed preview is not labelled a preview; an unreleased one is', () => {
    const preview = TIMED_PREVIEW.find((p) => p.reciterId === 'ahmed-salama')!;
    const label = (p: typeof preview) => coverageLabel(withTimedPreview(GENERATED_RECITERS, [p]).find((r) => r.id === 'ahmed-salama')!, MESSAGES.en.audio, false) ?? '';
    expect(label(preview)).toContain(MESSAGES.en.audio.developmentPreview);
    expect(label({ ...preview, released: true })).not.toContain(MESSAGES.en.audio.developmentPreview);
  });

  it('a VBR release reaches only binaries whose exact-seek method passed on the device', () => {
    const release = { 'yasser-salama': { 48: { ...yasser48, platforms: ['avfoundation-precise'] as const } } };
    expect(vbrReleaseFor(release, 'avfoundation-precise')).toEqual({ 'yasser-salama': { 48: yasser48 } });
    expect(vbrReleaseFor(release, 'index')).toEqual({});
  });
});
