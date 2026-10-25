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

describe('owner permission statement for the 177 alternative-source recordings (development/source-permissions.json)', () => {
  type Statement = { id: string; statedBy: string; statedOn: string; statement: string; streamingInApp: boolean; offlineDownloads: string; redistribution: string; documents: unknown[]; recordings: { reciterId: string; surah: number; provider: string; url: string }[] };
  const permissions = JSON.parse(read('../../tools/quran-audio/development/source-permissions.json')) as { kind: string; statements: Statement[] };
  const [st] = permissions.statements;
  const everyPreview = TIMED_PREVIEW.flatMap((p) => Object.entries(p.surahs).map(([s, x]) => ({ reciterId: p.reciterId, surah: Number(s), provider: x.provider, url: x.url })));

  it('records the owner\'s statement as stated: streaming in the app; downloads and redistribution not stated; no documents on file', () => {
    expect(permissions.kind).toBe('owner-source-permission-statements');
    expect(permissions.statements).toHaveLength(1);
    expect(st).toMatchObject({ statedBy: 'Hamza (owner)', statedOn: '2026-10-25', streamingInApp: true, offlineDownloads: 'not stated', redistribution: 'not stated', documents: [] });
    expect(st.statement).toMatch(/^I have obtained permission for the alternative-source recordings previously listed as 177 reciter–surah combinations\./);
  });

  it('names exactly the 177 preview recordings (reciter, surah, provider, file), nothing more', () => {
    expect(st.recordings).toHaveLength(177);
    expect(st.recordings).toEqual(everyPreview);
  });

  it('extends no permission to a provider: providers.mjs still grants these hosts nothing', () => {
    for (const id of ['way2quran', 'assabile']) expect(providers.find((p) => p.id === id)?.streaming.permitted, id).toBe(false);
    for (const id of ['archive', 'quranicaudio']) expect(providers.find((p) => p.id === id), id).toBeUndefined();
  });

  it('with the statement and the credits, the 177 previews fail only the device gate', () => {
    const { report } = gen.releaseTiming(input({ permissions }));
    const all = Object.values(report.timedPreview).flatMap((x) => Object.values(x));
    expect(all).toHaveLength(177);
    for (const r of all) expect(r.gates.filter((g) => !g.pass).map((g) => g.gate)).toEqual(['devices']);
  });

  it('covers only the exact file: another URL, another surah, streaming not stated or an unknown record kind give nothing', () => {
    const preview = TIMED_PREVIEW.find((p) => p.reciterId === 'ahmed-salama')!;
    const [s, x] = Object.entries(preview.surahs).find(([, y]) => y.provider === 'way2quran')!;
    const surah = Number(s);
    const passes = (p: unknown) => gen.releaseTiming(input({ permissions: p })).report.timedPreview['ahmed-salama'][surah].gates.find((g) => g.gate === 'provider')!.pass;
    const one = (rec: object, extra: object = {}) => ({ kind: 'owner-source-permission-statements', statements: [{ ...st, ...extra, recordings: [{ reciterId: 'ahmed-salama', surah, provider: x.provider, url: x.url, ...rec }] }] });
    expect(passes(one({}))).toBe(true);
    expect(passes(one({ url: `${x.url}?other` }))).toBe(false);
    expect(passes(one({ surah: surah + 1 }))).toBe(false);
    expect(passes(one({ reciterId: 'islam-sobhi' }))).toBe(false);
    expect(passes(one({}, { streamingInApp: false }))).toBe(false);
    expect(passes({ ...one({}), kind: 'something-else' })).toBe(false);
    expect(passes(null)).toBe(false);
  });
});

describe('credits for alternative recording hosts', () => {
  it('a host is credited exactly when this build plays its files: none in a release today', async () => {
    const { QURAN_SOURCES, timedRecordingHosts } = await import('@/constants/quranSources');
    expect(timedRecordingHosts().size).toBe(0); // release build (vitest __DEV__ false): nothing released yet
    for (const key of ['way2quran', 'assabile', 'archive', 'quranicaudio', 'everyayah']) expect(QURAN_SOURCES.find((x) => x.key === key)?.inThisBuild?.(), key).toBe(false);
    const fixture = [{ timedPreview: { surahs: { 1: { provider: 'way2quran' }, 2: { provider: 'archive' } } } }];
    expect([...timedRecordingHosts(fixture)].sort()).toEqual(['archive', 'way2quran']);
  });

  it('every credit has English and Arabic text', () => {
    for (const key of ['way2quran', 'assabile', 'archive', 'quranicaudio', 'everyayah'] as const) {
      for (const locale of ['en', 'ar', 'ar-EG'] as const) {
        const copy = MESSAGES[locale].credits as Record<string, string>;
        expect(copy[`${key}Name`], `${locale} ${key}`).toBeTruthy();
        expect(copy[`${key}Work`], `${locale} ${key}`).toBeTruthy();
      }
    }
  });
});

describe('class-level device evidence (the native player verified per playback class and platform)', () => {
  const checks = ['ayah-starts', 'full-surah', 'background'];
  const result = (device: string, samples: string[], extra: string[] = []) => ({ ...passed(device, [...checks, ...extra]), samples });
  const classRecord = (...classes: unknown[]) => ({ kind: gen.DEVICE_RECORD_KIND, entries: [], classes });
  const cbr = (android: unknown, ios: unknown) => ({ class: 'mp3quran-cbr', android, ios });
  const count = (o: Record<string, Record<number, unknown>>) => Object.values(o).reduce((n, x) => n + Object.keys(x).length, 0);
  // Two real reviewed-timing members (from different reciters) as samples.
  const [s1, s2] = [Object.keys(REVIEWED_TIMING)[0], Object.keys(REVIEWED_TIMING)[1]].map((id) => `${id}:${Object.keys(REVIEWED_TIMING[id])[0]}`);

  it('a passed CBR class record on both platforms, with two real samples, releases every reviewed surah — and nothing else', () => {
    const r = gen.releaseTiming(input({ record: classRecord(cbr(result('Pixel 7', [s1, s2]), result('iPhone 14', [s1, s2]))) }));
    expect(count(r.reviewed)).toBe(Object.values(REVIEWED_TIMING).reduce((n, x) => n + Object.keys(x).length, 0));
    expect(r.vbr).toEqual({});
    expect(r.timedPreview).toEqual([]);
    const why = r.report.reviewed.banna[3].gates.find((g) => g.gate === 'devices')!.why;
    expect(why).toMatch(/class mp3quran-cbr verified/);
    expect(why).not.toMatch(/listened/);
  });

  it('fails closed: one sample, a sample from another class, one platform only, a wrong player, or two records for one class', () => {
    const some = (rec: unknown) => count(gen.releaseTiming(input({ record: rec })).reviewed);
    const ios = result('iPhone 14', [s1, s2]);
    expect(some(classRecord(cbr(result('Pixel 7', [s1]), ios)))).toBe(0);
    expect(some(classRecord(cbr(result('Pixel 7', [s1, 'yasser-salama:48']), ios)))).toBe(0); // 48 is a VBR member
    expect(some(classRecord(cbr(null, ios)))).toBe(0);
    expect(some(classRecord(cbr({ ...result('Pixel 7', [s1, s2]), nativeSeek: undefined }, ios)))).toBe(0);
    expect(some(classRecord(cbr(result('Pixel 7', [s1, s2]), ios), cbr(result('Pixel 7', [s1, s2]), ios)))).toBe(0);
  });

  it('VBR: per platform, with far-seek; a host class with a single member needs that one sample', () => {
    const vbrCls = { class: 'mp3quran-vbr', ios: result('iPhone 14', ['yasser-salama:48', 'ajmi:42'], ['far-seek']), android: null };
    const r = gen.releaseTiming(input({ record: classRecord(vbrCls) }));
    expect(Object.values(r.vbr).every((x) => Object.values(x).every((y) => (y as { platforms: string[] }).platforms.join() === 'avfoundation-precise'))).toBe(true);
    expect(count(r.vbr)).toBe(Object.values(VBR_TIMING).reduce((n, x) => n + Object.keys(x).length, 0));
    const decisions = { kind: 'owner-release-decisions', decisions: [{ id: 'owner-test', decidedOn: '2026-10-25', layers: ['alternative-source-recordings'] }] };
    const host = { class: 'host:quranicaudio', android: result('Pixel 7', ['ajmi:42']), ios: result('iPhone 14', ['ajmi:42']) };
    const p = gen.releaseTiming(input({ decisions, record: classRecord(host) }));
    expect(p.timedPreview.map((x) => x.reciterId)).toEqual(['ajmi']);
  });

  it('the owner decision passes the provider gate for alternative sources only, as a decision; a decision for another layer does not', () => {
    const provider = (decisions: unknown) => gen.releaseTiming(input({ decisions })).report.timedPreview['ahmed-salama'][1].gates.find((g) => g.gate === 'provider')!;
    const yes = provider({ kind: 'owner-release-decisions', decisions: [{ id: 'owner-test', decidedOn: '2026-10-25', layers: ['alternative-source-recordings'] }] });
    expect(yes.pass).toBe(true);
    expect(yes.why).toMatch(/proceed without verified rights documentation \(not a permission\)/);
    expect(provider({ kind: 'owner-release-decisions', decisions: [{ id: 'owner-test', decidedOn: '2026-10-25', layers: ['per-ayah:jaber'] }] }).pass).toBe(false);
  });

  it('the repository records the owner decision verbatim, as a decision and not a permission', () => {
    const d = JSON.parse(read('../../tools/quran-audio/development/owner-release-decisions.json')) as { kind: string; decisions: { statement: string; meaning: string; layers: string[]; stillRequired: string[] }[] };
    expect(d.kind).toBe('owner-release-decisions');
    expect(d.decisions[0].layers).toEqual(['reviewed-timing', 'vbr-timing', 'alternative-source-recordings', 'per-ayah:jaber']);
    expect(d.decisions[0].statement).toMatch(/^I authorize proceeding with all four audio layers/);
    expect(d.decisions[0].meaning).toMatch(/not a permission/);
    expect(d.decisions[0].stillRequired).toContain('compatible native playback (physical-device evidence)');
  });
});
