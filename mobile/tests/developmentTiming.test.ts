import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_TIMING } from '@/audio/generated/developmentTiming';
import { GENERATED_FORMATS, GENERATED_PROVIDERS, GENERATED_SURAH_ONLY } from '@/audio/generated/sourceRegistry';
import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { hasAyahPlayback, RECITERS, timedSurahs, timingSourceOf, withDevelopmentTiming } from '@/audio/reciters';
import { createSourceRegistry } from '@/audio/sourceRegistry';
import { createTimingLoader, developmentTimingEntries, verifyTiming } from '@/audio/timing';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

const DEV = withDevelopmentTiming(GENERATED_RECITERS, DEVELOPMENT_TIMING);
const devPairs = Object.entries(DEVELOPMENT_TIMING).flatMap(([id, surahs]) => Object.keys(surahs).map((s) => [id, Number(s)] as const));
const tools = resolve(__dirname, '../../tools/quran-audio');

describe('development-only timing (generated/developmentTiming.ts)', () => {
  it('is not in the catalogue the tests and release builds use (__DEV__ false): 1,148 ayah surahs, unchanged', () => {
    // The app offers the catalogue in the owner's order, without on-hold or unlisted reciters (audioRoster.test.ts);
    // the catalogue itself is unchanged: 1,148 ayah surahs, none of them development timing.
    for (const r of RECITERS) expect(timedSurahs(r), r.id).toEqual(timedSurahs(GENERATED_RECITERS.find((g) => g.id === r.id)!));
    expect(GENERATED_RECITERS.reduce((n, r) => n + timedSurahs(r).length, 0)).toBe(1148);
  });

  it('adds only surahs with no production timing, listed by the recording, for reciters with a timing source', () => {
    expect(devPairs.length).toBeGreaterThan(0);
    for (const [id, s] of devPairs) {
      const prod = GENERATED_RECITERS.find((r) => r.id === id)!;
      expect(prod.timed[s], `${id} ${s}`).toBeUndefined();
      expect(prod.surahs).toContain(s);
    }
    const total = DEV.reduce((n, r) => n + timedSurahs(r).length, 0);
    expect(total).toBe(1148 + devPairs.length);
    // Production timing is untouched for every reciter and surah.
    for (const prod of GENERATED_RECITERS) {
      const dev = DEV.find((r) => r.id === prod.id)!;
      for (const [s, t] of Object.entries(prod.timed)) expect(dev.timed[Number(s)]).toEqual(t);
      expect(dev.timingSource).toBe(prod.timingSource);
    }
  });

  it('every development surah passes the same verification as production timing (fingerprint, ayah set, order, lengths)', () => {
    for (const [id, s] of devPairs) {
      const reciter = DEV.find((r) => r.id === id)!;
      expect(timingSourceOf(reciter, s)).toBe('measured');
      expect(reciter.developmentSurahs).toContain(s);
      const entries = developmentTimingEntries(id, s)!;
      expect(entries, `${id} ${s}`).toHaveLength(SURAH_AYAH_COUNTS[s - 1]);
      const timing = verifyTiming(reciter, s, entries);
      expect(timing, `${id} ${s}`).not.toBeNull();
      for (let k = 1; k < entries.length; k++) expect(entries[k].startMs).toBe(entries[k - 1].endMs);
    }
  });

  it('a development build loads that timing from the app (no MP3Quran fetch), and the rest as before', async () => {
    const fetched: string[] = [];
    const loader = createTimingLoader({
      fetchText: async (url) => (fetched.push(url), '[]'),
      store: { read: async () => null, write: async () => undefined },
    });
    const [id, s] = devPairs[0];
    const reciter = DEV.find((r) => r.id === id)!;
    expect(hasAyahPlayback(reciter, s)).toBe(true);
    expect(await loader.load(reciter, s)).toMatchObject({ ok: true });
    expect(fetched).toEqual([]);
    // The same reciter's production MP3Quran surahs are still fetched and fingerprint-checked.
    const prodSurah = Object.keys(GENERATED_RECITERS.find((r) => r.id === id)!.timed).map(Number)[0];
    if (reciter.timingSource === 'mp3quran') {
      expect(await loader.load(reciter, prodSurah)).toEqual({ ok: false, reason: 'mismatch' }); // '[]' is not the audited timing
      expect(fetched).toHaveLength(1);
    }
  });

  it('the registry plays them ayah by ayah in development, marked as development-only', () => {
    const registry = createSourceRegistry({ reciters: DEV, providers: GENERATED_PROVIDERS, formats: GENERATED_FORMATS, surahOnly: GENERATED_SURAH_ONLY });
    for (const [id, s] of devPairs) {
      const cap = registry.capability(id, s);
      expect(cap.mode, `${id} ${s}`).toBe('ayah');
      if (cap.mode === 'ayah') {
        expect(cap.sources[0].timing).toMatchObject({ status: 'verified', kind: 'measured' });
        expect(cap.sources[0].validation.method).toMatch(/^DEVELOPMENT ONLY/);
      }
    }
  });

  it("the tool applies the production measured rules unchanged (refine-results.mjs MEASURE)", () => {
    const refine = readFileSync(resolve(tools, 'refine-results.mjs'), 'utf8');
    const dev = readFileSync(resolve(tools, 'development/supplement-measured.mjs'), 'utf8');
    for (const [key, value] of [['minChunkScore', '0.7'], ['maxChunkJumpMs', '500'], ['maxPauseMs', '4000']]) {
      expect(refine).toMatch(new RegExp(`${key}: ${value.replace('.', '\\.')},`));
      expect(dev).toMatch(new RegExp(`${key}: ${value.replace('.', '\\.')}[,} ]`));
    }
    expect(dev).toContain('const BLOCK_OFFSET = 10;');
    expect(refine).toContain('const BLOCK_OFFSET = 10;');
  });
});
