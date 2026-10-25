import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_TIMING } from '@/audio/generated/developmentTiming';
import { PER_AYAH_PREVIEW } from '@/audio/generated/perAyahPreview';
import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { REVIEWED_TIMING } from '@/audio/generated/reviewedTiming';
import { REVIEWED_RELEASE } from '@/audio/generated/timingRelease';
import { GENERATED_FORMATS, GENERATED_PROVIDERS, GENERATED_SURAH_ONLY } from '@/audio/generated/sourceRegistry';
import { TIMED_PREVIEW } from '@/audio/generated/timedPreview';
import { coverageLabel } from '@/audio/format';
import { mergeDevelopmentTiming, orderedReciters, RECITER_ORDER, RECITERS, timedSurahs, timingSourceOf, withDevelopmentTiming, withPerAyahPreview, withReviewedPreview, withTimedPreview } from '@/audio/reciters';
import { createSourceRegistry } from '@/audio/sourceRegistry';
import { createTimingLoader, verifyTiming } from '@/audio/timing';
import type { TimingEntry } from '@/audio/timingFingerprint';
import { getMessages } from '@/localization/messages';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

// Development preview of the review dashboard's accepted aligned timing (owner, 2026-10-24: Reviewer 2 not required;
// tools/quran-audio/development/generate-reviewed-timing.mjs). Tests run as a release build (__DEV__ false), so the
// development composition is built here exactly as audio/reciters.ts builds it when __DEV__ is true.
const ALL = mergeDevelopmentTiming(DEVELOPMENT_TIMING, REVIEWED_TIMING);
const DEV = orderedReciters(withPerAyahPreview(withTimedPreview(withReviewedPreview(withDevelopmentTiming(GENERATED_RECITERS, ALL), DEVELOPMENT_TIMING, REVIEWED_TIMING), TIMED_PREVIEW), PER_AYAH_PREVIEW));
const pairs = Object.entries(REVIEWED_TIMING).flatMap(([id, surahs]) => Object.keys(surahs).map((s) => [id, Number(s)] as const));
const entriesOf = (id: string, s: number): TimingEntry[] => {
  const d = REVIEWED_TIMING[id][s].deltas;
  const out: TimingEntry[] = [];
  let at = d[0];
  for (let k = 1; k < d.length; k++) { out.push({ ayah: k, startMs: at, endMs: at + d[k] }); at += d[k]; }
  return out;
};

describe('reviewed aligned timing in development builds (generated/reviewedTiming.ts)', () => {
  it('only surahs the catalogue\'s MP3Quran recording lists, with no production and no measured development timing', () => {
    expect(pairs.length).toBe(399);
    for (const [id, s] of pairs) {
      const prod = GENERATED_RECITERS.find((r) => r.id === id)!;
      expect(prod.server, id).not.toBeNull();
      expect(prod.surahs, `${id} ${s}`).toContain(s);
      expect(prod.timed[s], `${id} ${s}`).toBeUndefined();
      expect(DEVELOPMENT_TIMING[id]?.[s], `${id} ${s}`).toBeUndefined();
    }
    // Never for a reciter on hold.
    expect(Object.keys(REVIEWED_TIMING).filter((id) => ['rifaat', 'gebril'].includes(id))).toEqual([]);
  });

  it('every surah passes the app\'s own verification: fingerprint, canonical ayah count, order, positive lengths', () => {
    for (const [id, s] of pairs) {
      const reciter = DEV.find((r) => r.id === id)!;
      const entries = entriesOf(id, s);
      expect(entries, `${id} ${s}`).toHaveLength(SURAH_AYAH_COUNTS[s - 1]);
      expect(verifyTiming(reciter, s, entries), `${id} ${s}`).not.toBeNull();
      expect(timingSourceOf(reciter, s)).toBe('measured');
      expect(reciter.reviewedPreviewSurahs).toContain(s);
      // How its starts were accepted is kept: Reviewer 1 and the automatic policy, never anything else.
      const x = REVIEWED_TIMING[id][s];
      expect(x.reviewer1 + x.automatic, `${id} ${s}`).toBe(SURAH_AYAH_COUNTS[s - 1]);
    }
  });

  it('plays ayah by ayah in a development build: the registry and the timing loader (from the app, nothing fetched)', async () => {
    const registry = createSourceRegistry({ reciters: DEV, providers: GENERATED_PROVIDERS, formats: GENERATED_FORMATS, surahOnly: GENERATED_SURAH_ONLY });
    const fetched: string[] = [];
    const loader = createTimingLoader({
      fetchText: async (url) => (fetched.push(url), '[]'),
      store: { read: async () => null, write: async () => undefined },
      measured: (id, s) => (REVIEWED_TIMING[id]?.[s] ? entriesOf(id, s) : null),
    });
    for (const [id, s] of pairs) {
      expect(registry.capability(id, s).mode, `${id} ${s}`).toBe('ayah');
      expect(await loader.load(DEV.find((r) => r.id === id)!, s), `${id} ${s}`).toMatchObject({ ok: true });
    }
    expect(fetched).toEqual([]);
  });

  it('development coverage (owner order); release builds play exactly the released surahs, as released, never labelled a preview', () => {
    const coverage = Object.fromEntries(DEV.map((r) => [r.id, timedSurahs(r).length]));
    expect(coverage).toEqual({
      minshawi: 114, husary: 114, abdulbasit: 114, banna: 114, sufi: 114, 'ahmed-salama': 114, hudhaifi: 114, shuraim: 114, maher: 114,
      shatri: 114, ajmi: 114, jaber: 114, basfar: 114, 'islam-sobhi': 104, naina: 114, 'yasser-salama': 113, 'saleh-talib': 69,
    });
    expect(DEV.map((r) => r.id)).toEqual([...RECITER_ORDER]);
    // Tests run as a release build: the catalogue plus REVIEWED_RELEASE (generated/timingRelease.ts), never as a preview.
    for (const r of RECITERS) {
      expect(r.reviewedPreviewSurahs, r.id).toBeUndefined();
      const catalogue = GENERATED_RECITERS.find((g) => g.id === r.id);
      if (!catalogue) continue;
      for (const s of timedSurahs(catalogue)) expect(r.timed[s], `${r.id} ${s}`).toEqual(catalogue.timed[s]);
      for (const [s, x] of Object.entries(REVIEWED_RELEASE[r.id] ?? {})) expect(r.timed[Number(s)], `${r.id} ${s}`).toEqual([x.fingerprint, x.bytes]);
    }
  });

  it('the reciter list shows coverage only, never a development or release status, in a development build too', () => {
    for (const [locale, rtl] of [['en', false], ['ar', true]] as const) {
      const copy = getMessages(locale).audio;
      for (const r of DEV) expect(coverageLabel(r, copy, rtl) ?? '', `${locale} ${r.id}`).not.toMatch(/preview|development|beta|trial|test|معاينة|تجريبي|للتطوير/i);
    }
    expect(coverageLabel(DEV.find((r) => r.id === 'abdulbasit')!, getMessages('en').audio, false)).toBeNull(); // all 114 surahs: no line
    expect(coverageLabel(DEV.find((r) => r.id === 'islam-sobhi')!, getMessages('en').audio, false)).toBe('104 of 114 surahs');
  });
});
