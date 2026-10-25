import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { GENERATED_FORMATS, GENERATED_PROVIDERS, GENERATED_SURAH_ONLY } from '@/audio/generated/sourceRegistry';
import { coverageLabel } from '@/audio/format';
import { MEASURED_RELEASE, REVIEWED_RELEASE } from '@/audio/generated/timingRelease';
import { getReciter, hasAyahPlayback, RECITERS, reciterCoverage, surahAudioUrl, timedSurahs, timingSourceOf } from '@/audio/reciters';
import { isPreviewSurah } from '@/audio/timedPreview';
import { MESSAGES } from '@/localization/messages';
import { SOURCE_REGISTRY, SURAH_ONLY_PLAYBACK, type AudioSource, type Provider } from '@/audio/sourceRegistry';
import { localFirstSource } from '@/audio/sources';

import { approval, fixtureRegistry } from './helpers/audioRegistry';

/** A copy of a reciter's MP3Quran ayah source (to build fallbacks and broken variants). */
const sourceOf = (reciterId: string, surah: number) => SOURCE_REGISTRY.sourcesFor(reciterId, surah)[0];

describe('the source registry over the audited catalogue (the app today)', () => {
  it('plays ayah by ayah exactly the catalogue files with verified timing: the 1,148 of the catalogue plus the released timing; nothing as a whole surah', () => {
    let ayah = 0;
    for (const reciter of RECITERS) {
      for (let surah = 1; surah <= 114; surah++) {
        const mode = SOURCE_REGISTRY.mode(reciter.id, surah);
        // Timed previews and per-ayah recordings play their own files outside the MP3Quran registry (availability.ts).
        const ownFiles = reciter.perAyah !== undefined || isPreviewSurah(reciter, surah);
        expect(mode === 'ayah', `${reciter.id} ${surah}`).toBe(!ownFiles && hasAyahPlayback(reciter, surah));
        expect(mode).not.toBe('surah');
        if (mode === 'ayah') ayah++;
      }
    }
    // The catalogue's own 1,148, plus the 399 released reviewed surahs (VBR needs a patched binary: none in tests).
    const released = Object.values(REVIEWED_RELEASE).reduce((n, x) => n + Object.keys(x).length, 0) + Object.values(MEASURED_RELEASE).reduce((n, x) => n + Object.keys(x).length, 0);
    expect(released).toBe(399 + 44); // reviewed, and the measured timing (owner decision 2026-10-25)
    // The catalogue's 1,148 ayah surahs: every reciter with any is offered (audio/reciters.ts: Muhammad Rifaat, on
    // hold, has none).
    const notOffered = GENERATED_RECITERS.filter((r) => !RECITERS.some((x) => x.id === r.id));
    expect(notOffered.map((r) => [r.id, timedSurahs(r).length])).toEqual([['rifaat', 0]]);
    expect(GENERATED_RECITERS.reduce((n, r) => n + timedSurahs(r).length, 0)).toBe(1148);
    expect(ayah).toBe(1148 + released);
    expect(GENERATED_SURAH_ONLY).toEqual([]);
  });

  it('resolves each ayah source to the same MP3Quran file, size and verified timing as the catalogue', () => {
    for (const reciter of RECITERS) {
      for (const surah of timedSurahs(reciter).filter((s) => reciter.perAyah === undefined && !isPreviewSurah(reciter, s))) {
        const capability = SOURCE_REGISTRY.capability(reciter.id, surah);
        expect(capability.mode).toBe('ayah');
        if (capability.mode !== 'ayah') continue;
        expect(capability.sources).toHaveLength(1);
        const [source] = capability.sources;
        expect(source).toMatchObject({ reciterId: reciter.id, surah, provider: 'mp3quran', url: surahAudioUrl(reciter, surah), bytes: reciter.timed[surah][1], priority: 0 });
        expect(source.timing).toEqual({ status: 'verified', kind: timingSourceOf(reciter, surah), fingerprint: reciter.timed[surah][0] });
        expect(source.format).toMatchObject({ bitrateMode: 'cbr', exactSeek: true });
        expect(source.completeness.status).toBe('verified');
        expect(source.identity.status).toBe('verified');
        expect(source.riwayah).toMatchObject({ value: 'hafs', status: 'confirmed' });
      }
    }
  });

  it("labels every reciter's coverage exactly as before (the counts now come from the registry)", () => {
    const copy = MESSAGES.en.audio;
    for (const reciter of RECITERS) {
      const before = reciterCoverage(reciter);
      const expected = before.kind === 'complete' ? null : before.kind === 'none' ? copy.coverageNone : copy.coveragePartial.replace('{n}', String(before.timed));
      expect(coverageLabel(reciter, copy, false), reciter.id).toBe(expected);
    }
  });

  it('records every required field for every source', () => {
    const source = sourceOf('maher', 18);
    for (const key of ['reciterId', 'surah', 'provider', 'url', 'bytes', 'format', 'completeness', 'identity', 'riwayah', 'timing', 'priority', 'validation']) expect(source).toHaveProperty(key);
    expect(source.format).toMatchObject({ kbps: 96, bitrateMode: 'cbr' });
    // Maher's recording is unlabelled by MP3Quran: Hafs is confirmed by the verified Kufan timing only.
    expect(source.riwayah.evidence).toMatch(/Kufan/);
    expect(SOURCE_REGISTRY.provider('mp3quran')).toMatchObject({ streaming: { permitted: true }, offline: { permitted: true } });
    // The owner's decision on MP3Quran's published reuse statement, never a claim of recording-specific permission.
    expect(SOURCE_REGISTRY.provider('mp3quran')?.offline.evidence).toMatch(/^Owner decision \(Hamza, 2026-10-24\).*No recording-specific written permission has been obtained\.$/);
  });

  it('never builds a URL for a surah MP3Quran does not list (its CDN redirects those to Minshawi)', () => {
    for (const surah of [37, 39, 40, 45, 65]) {
      expect(SOURCE_REGISTRY.sourcesFor('islam-sobhi', surah)).toEqual([]);
      expect(SOURCE_REGISTRY.capability('islam-sobhi', surah)).toEqual({ mode: 'none', reason: 'no-recording' });
    }
    expect(SOURCE_REGISTRY.capability('ahmed-salama', 1)).toEqual({ mode: 'none', reason: 'no-recording' });
  });

  it('keeps listed but unverified recordings disabled (no automatic whole-surah playback)', () => {
    // Reciters on hold or not offered (audio/reciters.ts) have no source in the app at all.
    for (const id of ['rifaat']) expect(SOURCE_REGISTRY.capability(id, 1), id).toEqual({ mode: 'none', reason: 'no-recording' });
    // Listed by MP3Quran, no timing released: Sobhi 17/24 (unresolved structure), 74/109 (clipped opening).
    for (const [reciterId, surah] of [['islam-sobhi', 17], ['islam-sobhi', 24], ['islam-sobhi', 74], ['islam-sobhi', 109]] as const) {
      const [source] = SOURCE_REGISTRY.sourcesFor(reciterId, surah);
      expect(source.completeness.status, `${reciterId} ${surah}`).toBe('unverified');
      expect(source.bytes).toBeNull();
      expect(SOURCE_REGISTRY.capability(reciterId, surah)).toEqual({ mode: 'none', reason: 'not-verified' });
    }
  });

  it('records the CBR / VBR class of each file (Islam Sobhi 17 is VBR)', () => {
    expect(sourceOf('islam-sobhi', 17).format).toMatchObject({ bitrateMode: 'vbr', bitrateEvidence: 'xing-tag', exactSeek: false });
    expect(sourceOf('islam-sobhi', 18).format).toMatchObject({ bitrateMode: 'cbr', exactSeek: true });
  });

  it('permits no streaming or storage from Way2Quran or Assabile', () => {
    for (const id of ['way2quran', 'assabile']) expect(SOURCE_REGISTRY.provider(id)).toMatchObject({ streaming: { permitted: false }, offline: { permitted: false } });
  });

  it('allows offline storage of MP3Quran catalogue files (owner decision, 2026-10-24), and needs no extra attribution', () => {
    expect(SOURCE_REGISTRY.offlinePermitted(sourceOf('maher', 1))).toBe(true);
    expect(SOURCE_REGISTRY.attributions()).toEqual([]);
  });
});

describe('the capability rules', () => {
  it('the app offers no untimed whole-surah playback: even an approved source without timing does not play', () => {
    expect(SURAH_ONLY_PLAYBACK).toBe(false);
    const app = fixtureRegistry({ surahOnly: [approval('islam-sobhi', 74)], surahOnlyPlayback: SURAH_ONLY_PLAYBACK });
    expect(app.capability('islam-sobhi', 74)).toEqual({ mode: 'none', reason: 'not-verified' });
    for (const reciter of RECITERS) for (let s = 1; s <= 114; s++) expect(SOURCE_REGISTRY.mode(reciter.id, s)).not.toBe('surah');
  });

  it('(dormant capability) an approved, complete, permitted recording without timing plays whole when enabled', () => {
    const registry = fixtureRegistry({ surahOnly: [approval('islam-sobhi', 74)] });
    const capability = registry.capability('islam-sobhi', 74);
    expect(capability.mode).toBe('surah');
    if (capability.mode === 'surah') expect(capability.sources.map((s) => s.url)).toEqual(['https://cdn.mp3quran.net/audio/islam-sobhi/r1/074.mp3']);
    expect(registry.coverage('islam-sobhi').surah).toEqual([74]);
    expect(registry.coverage('islam-sobhi').ayah).toEqual(SOURCE_REGISTRY.coverage('islam-sobhi').ayah); // its timed surahs unchanged
    // Everything else is unchanged.
    expect(registry.mode('maher', 18)).toBe('ayah');
    expect(registry.mode('islam-sobhi', 37)).toBe('none');
  });

  it('a VBR recording with verified timing still never plays ayah by ayah: whole surah only', () => {
    const vbr: AudioSource = { ...sourceOf('maher', 18), durationMs: 2_000_000, format: { ...sourceOf('maher', 18).format, bitrateMode: 'vbr', exactSeek: false } };
    const registry = fixtureRegistry({ extra: [{ ...vbr, reciterId: 'saleh-talib', surah: 2, url: 'https://cdn.example/talib/002.mp3' }] });
    expect(registry.mode('saleh-talib', 2)).toBe('surah');
  });

  it('a whole-surah source without its verified length never plays (the app could not check the loaded stream)', () => {
    const base = { ...sourceOf('maher', 18), reciterId: 'saleh-talib', surah: 2, url: 'https://cdn.example/t/002.mp3', timing: { status: 'none' as const, reason: 'none' } };
    expect(fixtureRegistry({ extra: [{ ...base, durationMs: null }] }).capability('saleh-talib', 2)).toEqual({ mode: 'none', reason: 'not-verified' });
    expect(fixtureRegistry({ extra: [{ ...base, durationMs: 1_000_000 }] }).mode('saleh-talib', 2)).toBe('surah');
  });

  it('invalid rights metadata (an unknown provider, or a permission not explicitly granted) never plays', () => {
    const base = { ...sourceOf('maher', 18), reciterId: 'saleh-talib', surah: 2, url: 'https://cdn.example/t/002.mp3', durationMs: 1_000_000 };
    // (Saleh Al-Talib has no MP3Quran file of 2: the unknown host's source is the only one, and it is not permitted.)
    expect(fixtureRegistry({ extra: [{ ...base, provider: 'unknown-host' }] }).capability('saleh-talib', 2)).toEqual({ mode: 'none', reason: 'not-permitted' });
    const vague = GENERATED_PROVIDERS.map((p) => (p.id === 'mp3quran' ? { ...p, streaming: { permitted: 'yes' as unknown as boolean, evidence: '' } } : p));
    expect(fixtureRegistry({ providers: vague, extra: [base] }).capability('saleh-talib', 2)).toEqual({ mode: 'none', reason: 'not-permitted' });
    // The catalogue's own ayah sources are under the same rule.
    expect(fixtureRegistry({ providers: vague }).mode('maher', 18)).toBe('none');
  });

  it('a source whose provider does not permit streaming stays disabled, whatever was verified', () => {
    const registry = fixtureRegistry({
      extra: [{ ...sourceOf('maher', 18), reciterId: 'ahmed-salama', provider: 'assabile', url: 'https://www.assabile.com/x/018.mp3', timing: { status: 'none', reason: 'none' }, priority: 10 }],
    });
    expect(registry.capability('ahmed-salama', 18)).toEqual({ mode: 'none', reason: 'not-permitted' });
  });

  it('partial, unverified, wrong-reciter or unconfirmed-riwayah recordings never play', () => {
    const base = { ...sourceOf('maher', 18), reciterId: 'saleh-talib', surah: 2, url: 'https://cdn.example/t/002.mp3' };
    for (const broken of [
      { ...base, completeness: { status: 'failed' as const, evidence: 'ends at 18:74' } },
      { ...base, completeness: { status: 'unverified' as const, evidence: '' } },
      { ...base, identity: { status: 'unverified' as const, evidence: '' } },
      { ...base, riwayah: { value: null, status: 'unconfirmed' as const, evidence: '' } },
      { ...base, bytes: null },
    ]) {
      expect(fixtureRegistry({ extra: [broken] }).capability('saleh-talib', 2)).toEqual({ mode: 'none', reason: 'not-verified' });
    }
  });

  it("never resolves another reciter's recording, even if one is registered under the wrong key", () => {
    const registry = fixtureRegistry({ extra: [{ ...sourceOf('minshawi', 37) }] });
    expect(registry.sourcesFor('islam-sobhi', 37)).toEqual([]);
    expect(registry.mode('islam-sobhi', 37)).toBe('none');
  });

  it('falls back only to verified, permitted sources of the same reciter; for ayah playback only with the same timing', () => {
    const primary = sourceOf('maher', 18);
    const mirror: AudioSource = { ...primary, url: 'https://mirror.example/maher/018.mp3', priority: 1 };
    const otherTiming: AudioSource = { ...primary, url: 'https://other.example/maher/018.mp3', priority: 2, timing: { status: 'verified', kind: 'mp3quran', fingerprint: 'deadbeef' } };
    const unverified: AudioSource = { ...primary, url: 'https://bad.example/maher/018.mp3', priority: 3, completeness: { status: 'unverified', evidence: '' } };
    const capability = fixtureRegistry({ extra: [unverified, otherTiming, mirror] }).capability('maher', 18);
    expect(capability.mode).toBe('ayah');
    if (capability.mode === 'ayah') expect(capability.sources.map((s) => s.url)).toEqual([primary.url, mirror.url]);
  });

  it("a reciter's offline download needs the app switch and every stored source's provider to permit it", () => {
    expect(SOURCE_REGISTRY.reciterOfflinePermitted('maher')).toBe(true); // today: switch on, MP3Quran offline on (owner decision)
    const permitting: Provider[] = GENERATED_PROVIDERS.map((p) => (p.id === 'mp3quran' ? { ...p, offline: { permitted: true, evidence: 'test' } } : p));
    const denying: Provider[] = GENERATED_PROVIDERS.map((p) => (p.id === 'mp3quran' ? { ...p, offline: { permitted: false, evidence: 'test' } } : p));
    expect(fixtureRegistry({ providers: denying, offlineSwitch: true }).reciterOfflinePermitted('maher')).toBe(false); // switch on, provider says no
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: false }).reciterOfflinePermitted('maher')).toBe(false); // provider yes, switch off
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: true }).reciterOfflinePermitted('maher')).toBe(true);
    // A reciter with nothing that plays ayah by ayah has nothing to download.
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: true }).reciterOfflinePermitted('ahmed-salama')).toBe(false); // no catalogue recording
  });

  it('offline storage needs the app switch and the provider permission', () => {
    const permitting: Provider[] = GENERATED_PROVIDERS.map((p) => (p.id === 'mp3quran' ? { ...p, offline: { permitted: true, evidence: 'test' } } : p));
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: false }).offlinePermitted(sourceOf('maher', 1))).toBe(false);
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: true }).offlinePermitted(sourceOf('maher', 1))).toBe(true);
    const denying: Provider[] = GENERATED_PROVIDERS.map((p) => (p.id === 'mp3quran' ? { ...p, offline: { permitted: false, evidence: 'test' } } : p));
    expect(fixtureRegistry({ providers: denying, offlineSwitch: true }).offlinePermitted(sourceOf('maher', 1))).toBe(false);
    // Providers that grant nothing never store, whatever the switch.
    for (const id of ['way2quran', 'assabile']) expect(SOURCE_REGISTRY.provider(id)?.offline.permitted, id).toBe(false);
  });
});

describe('resolving a stream (localFirstSource)', () => {
  const noFiles = { uri: async () => null };

  it('gives the same URL as before for an ayah surah, with no alternates and no stream check (no extra request)', async () => {
    expect(await localFirstSource(noFiles)(getReciter('maher')!, 18)).toEqual({ uri: 'https://cdn.mp3quran.net/audio/maher-muaiqly/r3/018.mp3', local: false });
  });

  it('marks a whole-surah stream for the stream check, with its verified size and length', async () => {
    const registry = fixtureRegistry({ surahOnly: [approval('islam-sobhi', 74)] });
    expect(await localFirstSource(noFiles, registry)(getReciter('islam-sobhi')!, 74)).toEqual({
      uri: 'https://cdn.mp3quran.net/audio/islam-sobhi/r1/074.mp3', local: false, bytes: 1_000_074, durationMs: 674_000, verify: true,
    });
  });

  it('lists the verified alternates of the same reciter', async () => {
    const mirror: AudioSource = { ...sourceOf('maher', 18), url: 'https://mirror.example/maher/018.mp3', priority: 1 };
    const resolved = await localFirstSource(noFiles, fixtureRegistry({ extra: [mirror] }))(getReciter('maher')!, 18);
    expect(resolved).toEqual({ uri: 'https://cdn.mp3quran.net/audio/maher-muaiqly/r3/018.mp3', local: false, alternates: [{ uri: mirror.url, bytes: mirror.bytes }] });
  });

  it('builds no URL at all for a surah that may not play', async () => {
    await expect(localFirstSource(noFiles)(getReciter('islam-sobhi')!, 37)).rejects.toThrow(/no playable source/);
    await expect(localFirstSource(noFiles)(getReciter('islam-sobhi')!, 74)).rejects.toThrow(/no playable source/);
  });
});

describe('the generated registry data', () => {
  it('is what tools/quran-audio/generate-catalog.mjs writes from the providers and approvals (none approved yet)', () => {
    const tools = resolve(__dirname, '../../tools/quran-audio');
    const approvals = JSON.parse(readFileSync(resolve(tools, 'surah-mode-approvals.json'), 'utf8'));
    expect(approvals.approved).toEqual([]);
    const providers = readFileSync(resolve(tools, 'providers.mjs'), 'utf8');
    for (const p of GENERATED_PROVIDERS) expect(providers).toContain(`id: '${p.id}'`);
    // Formats are recorded for every catalogue recording, offered in the app or not.
    expect(Object.keys(GENERATED_FORMATS).sort()).toEqual(GENERATED_RECITERS.filter((r) => r.server !== null).map((r) => r.id).sort());
  });
});
