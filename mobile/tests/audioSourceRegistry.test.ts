import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { GENERATED_FORMATS, GENERATED_PROVIDERS, GENERATED_SURAH_ONLY } from '@/audio/generated/sourceRegistry';
import { coverageLabel } from '@/audio/format';
import { getReciter, hasAyahPlayback, RECITERS, reciterCoverage, surahAudioUrl, timedSurahs } from '@/audio/reciters';
import { MESSAGES } from '@/localization/messages';
import { SOURCE_REGISTRY, SURAH_ONLY_PLAYBACK, type AudioSource, type Provider } from '@/audio/sourceRegistry';
import { localFirstSource } from '@/audio/sources';

import { approval, fixtureRegistry } from './helpers/audioRegistry';

/** A copy of a reciter's MP3Quran ayah source (to build fallbacks and broken variants). */
const sourceOf = (reciterId: string, surah: number) => SOURCE_REGISTRY.sourcesFor(reciterId, surah)[0];

describe('the source registry over the audited catalogue (the app today)', () => {
  it('plays exactly the surahs that played before, ayah by ayah: 1,148, and nothing as a whole surah', () => {
    let ayah = 0;
    for (const reciter of RECITERS) {
      for (let surah = 1; surah <= 114; surah++) {
        const mode = SOURCE_REGISTRY.mode(reciter.id, surah);
        expect(mode === 'ayah', `${reciter.id} ${surah}`).toBe(hasAyahPlayback(reciter, surah));
        expect(mode).not.toBe('surah');
        if (mode === 'ayah') ayah++;
      }
    }
    // The catalogue's 1,148 ayah surahs: every reciter with any is offered (audio/reciters.ts: Muhammad Rifaat, on
    // hold, has none).
    const notOffered = GENERATED_RECITERS.filter((r) => !RECITERS.some((x) => x.id === r.id));
    expect(notOffered.map((r) => [r.id, timedSurahs(r).length])).toEqual([['rifaat', 0]]);
    expect(GENERATED_RECITERS.reduce((n, r) => n + timedSurahs(r).length, 0)).toBe(1148);
    expect(ayah).toBe(1148);
    expect(GENERATED_SURAH_ONLY).toEqual([]);
  });

  it('resolves each ayah source to the same MP3Quran file, size and verified timing as the catalogue', () => {
    for (const reciter of RECITERS) {
      for (const surah of timedSurahs(reciter)) {
        const capability = SOURCE_REGISTRY.capability(reciter.id, surah);
        expect(capability.mode).toBe('ayah');
        if (capability.mode !== 'ayah') continue;
        expect(capability.sources).toHaveLength(1);
        const [source] = capability.sources;
        expect(source).toMatchObject({ reciterId: reciter.id, surah, provider: 'mp3quran', url: surahAudioUrl(reciter, surah), bytes: reciter.timed[surah][1], priority: 0 });
        expect(source.timing).toEqual({ status: 'verified', kind: reciter.timingSource, fingerprint: reciter.timed[surah][0] });
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
    expect(SOURCE_REGISTRY.provider('mp3quran')).toMatchObject({ streaming: { permitted: true }, offline: { permitted: false } });
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
    for (const [reciterId, surah] of [['islam-sobhi', 36], ['yasser-salama', 1], ['saleh-talib', 1], ['minshawi', 9], ['husary', 1]] as const) {
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

  it('allows no offline storage while the app switch is off, and needs no extra attribution', () => {
    expect(SOURCE_REGISTRY.offlinePermitted(sourceOf('maher', 1))).toBe(false);
    expect(SOURCE_REGISTRY.attributions()).toEqual([]);
  });
});

describe('the capability rules', () => {
  it('the app offers no untimed whole-surah playback: even an approved source without timing does not play', () => {
    expect(SURAH_ONLY_PLAYBACK).toBe(false);
    const app = fixtureRegistry({ surahOnly: [approval('islam-sobhi', 36)], surahOnlyPlayback: SURAH_ONLY_PLAYBACK });
    expect(app.capability('islam-sobhi', 36)).toEqual({ mode: 'none', reason: 'not-verified' });
    for (const reciter of RECITERS) for (let s = 1; s <= 114; s++) expect(SOURCE_REGISTRY.mode(reciter.id, s)).not.toBe('surah');
  });

  it('(dormant capability) an approved, complete, permitted recording without timing plays whole when enabled', () => {
    const registry = fixtureRegistry({ surahOnly: [approval('islam-sobhi', 36)] });
    const capability = registry.capability('islam-sobhi', 36);
    expect(capability.mode).toBe('surah');
    if (capability.mode === 'surah') expect(capability.sources.map((s) => s.url)).toEqual(['https://cdn.mp3quran.net/audio/islam-sobhi/r1/036.mp3']);
    expect(registry.coverage('islam-sobhi')).toEqual({ ayah: [], surah: [36] });
    // Everything else is unchanged.
    expect(registry.mode('maher', 18)).toBe('ayah');
    expect(registry.mode('islam-sobhi', 35)).toBe('none');
  });

  it('a VBR recording with verified timing still never plays ayah by ayah: whole surah only', () => {
    const vbr: AudioSource = { ...sourceOf('maher', 18), durationMs: 2_000_000, format: { ...sourceOf('maher', 18).format, bitrateMode: 'vbr', exactSeek: false } };
    const registry = fixtureRegistry({ extra: [{ ...vbr, reciterId: 'yasser-salama', url: 'https://cdn.example/yasser/018.mp3' }] });
    expect(registry.mode('yasser-salama', 18)).toBe('surah');
  });

  it('a whole-surah source without its verified length never plays (the app could not check the loaded stream)', () => {
    const base = { ...sourceOf('maher', 18), reciterId: 'yasser-salama', url: 'https://cdn.example/y/018.mp3', timing: { status: 'none' as const, reason: 'none' } };
    expect(fixtureRegistry({ extra: [{ ...base, durationMs: null }] }).capability('yasser-salama', 18)).toEqual({ mode: 'none', reason: 'not-verified' });
    expect(fixtureRegistry({ extra: [{ ...base, durationMs: 1_000_000 }] }).mode('yasser-salama', 18)).toBe('surah');
  });

  it('invalid rights metadata (an unknown provider, or a permission not explicitly granted) never plays', () => {
    const base = { ...sourceOf('maher', 18), reciterId: 'yasser-salama', url: 'https://cdn.example/y/018.mp3', durationMs: 1_000_000 };
    // (Yasser Salama's own listed MP3Quran file of 18 is permitted but unverified, hence 'not-verified'.)
    expect(fixtureRegistry({ extra: [{ ...base, provider: 'unknown-host' }] }).capability('yasser-salama', 18)).toEqual({ mode: 'none', reason: 'not-verified' });
    const vague = GENERATED_PROVIDERS.map((p) => (p.id === 'mp3quran' ? { ...p, streaming: { permitted: 'yes' as unknown as boolean, evidence: '' } } : p));
    expect(fixtureRegistry({ providers: vague, extra: [base] }).capability('yasser-salama', 18)).toEqual({ mode: 'none', reason: 'not-permitted' });
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
    const base = { ...sourceOf('maher', 18), reciterId: 'yasser-salama', url: 'https://cdn.example/y/018.mp3' };
    for (const broken of [
      { ...base, completeness: { status: 'failed' as const, evidence: 'ends at 18:74' } },
      { ...base, completeness: { status: 'unverified' as const, evidence: '' } },
      { ...base, identity: { status: 'unverified' as const, evidence: '' } },
      { ...base, riwayah: { value: null, status: 'unconfirmed' as const, evidence: '' } },
      { ...base, bytes: null },
    ]) {
      expect(fixtureRegistry({ extra: [broken] }).capability('yasser-salama', 18)).toEqual({ mode: 'none', reason: 'not-verified' });
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
    expect(SOURCE_REGISTRY.reciterOfflinePermitted('maher')).toBe(false); // today: switch off, MP3Quran offline not granted
    const permitting: Provider[] = GENERATED_PROVIDERS.map((p) => (p.id === 'mp3quran' ? { ...p, offline: { permitted: true, evidence: 'test' } } : p));
    expect(fixtureRegistry({ offlineSwitch: true }).reciterOfflinePermitted('maher')).toBe(false); // switch on, provider says no
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: false }).reciterOfflinePermitted('maher')).toBe(false); // provider yes, switch off
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: true }).reciterOfflinePermitted('maher')).toBe(true);
    // A reciter with nothing that plays ayah by ayah has nothing to download.
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: true }).reciterOfflinePermitted('yasser-salama')).toBe(false);
  });

  it('offline storage needs the app switch and the provider permission', () => {
    const permitting: Provider[] = GENERATED_PROVIDERS.map((p) => (p.id === 'mp3quran' ? { ...p, offline: { permitted: true, evidence: 'test' } } : p));
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: false }).offlinePermitted(sourceOf('maher', 1))).toBe(false);
    expect(fixtureRegistry({ providers: permitting, offlineSwitch: true }).offlinePermitted(sourceOf('maher', 1))).toBe(true);
    expect(fixtureRegistry({ offlineSwitch: true }).offlinePermitted(sourceOf('maher', 1))).toBe(false);
  });
});

describe('resolving a stream (localFirstSource)', () => {
  const noFiles = { uri: async () => null };

  it('gives the same URL as before for an ayah surah, with no alternates and no stream check (no extra request)', async () => {
    expect(await localFirstSource(noFiles)(getReciter('maher')!, 18)).toEqual({ uri: 'https://cdn.mp3quran.net/audio/maher-muaiqly/r3/018.mp3', local: false });
  });

  it('marks a whole-surah stream for the stream check, with its verified size and length', async () => {
    const registry = fixtureRegistry({ surahOnly: [approval('islam-sobhi', 36)] });
    expect(await localFirstSource(noFiles, registry)(getReciter('islam-sobhi')!, 36)).toEqual({
      uri: 'https://cdn.mp3quran.net/audio/islam-sobhi/r1/036.mp3', local: false, bytes: 1_000_036, durationMs: 636_000, verify: true,
    });
  });

  it('lists the verified alternates of the same reciter', async () => {
    const mirror: AudioSource = { ...sourceOf('maher', 18), url: 'https://mirror.example/maher/018.mp3', priority: 1 };
    const resolved = await localFirstSource(noFiles, fixtureRegistry({ extra: [mirror] }))(getReciter('maher')!, 18);
    expect(resolved).toEqual({ uri: 'https://cdn.mp3quran.net/audio/maher-muaiqly/r3/018.mp3', local: false, alternates: [{ uri: mirror.url, bytes: mirror.bytes }] });
  });

  it('builds no URL at all for a surah that may not play', async () => {
    await expect(localFirstSource(noFiles)(getReciter('islam-sobhi')!, 37)).rejects.toThrow(/no playable source/);
    await expect(localFirstSource(noFiles)(getReciter('islam-sobhi')!, 36)).rejects.toThrow(/no playable source/);
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
