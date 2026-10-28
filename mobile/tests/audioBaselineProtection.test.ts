import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_TIMING } from '@/audio/generated/developmentTiming';
import { PER_AYAH_PREVIEW } from '@/audio/generated/perAyahPreview';
import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { REVIEWED_TIMING } from '@/audio/generated/reviewedTiming';
import { TIMED_PREVIEW } from '@/audio/generated/timedPreview';
import { mergeDevelopmentTiming, ON_HOLD_RECITER_IDS, orderedReciters, RECITER_ORDER, RECITERS, timedSurahs, withDevelopmentTiming, withPerAyahPreview, withReviewedPreview, withTimedPreview, type Reciter } from '@/audio/reciters';

/**
 * Protection of everything verified before the 2026-10-24 work on Islam Sobhi's missing surahs, Yasser Mahmoud Salama
 * 48 and Ahmed Al-Agamy 42 (owner requirement). The fixture is the baseline captured BEFORE that work: per reciter, per
 * playable surah, the timing fingerprint, the file size and the file that plays, for the development composition (as
 * audio/reciters.ts builds it when __DEV__ is true) and for a release build. Every baseline entry must stay exactly as
 * it was; the only change allowed is a NEW playable surah of those three reciters' missing surahs.
 * Rewrite the fixture only on purpose: QH_WRITE_AUDIO_BASELINE=1 npx vitest run tests/audioBaselineProtection.test.ts
 */
const FIXTURE = path.join(__dirname, 'fixtures', 'audio-baseline-2026-10-24.json');
const ALLOWED_NEW: Readonly<Record<string, (surah: number) => boolean>> = {
  'islam-sobhi': () => true,
  'yasser-salama': (s) => s === 48,
  ajmi: (s) => s === 42,
};

type Snapshot = Record<string, Record<number, [fingerprint: string, bytes: number, file: string]>>;
const fileOf = (r: Reciter, s: number) => r.timedPreview?.surahs[s]?.url ?? (r.perAyah ? `per-ayah:${r.perAyah.base ?? r.id}` : `${r.server}${String(s).padStart(3, '0')}.mp3`);
const snapshot = (reciters: readonly Reciter[]): Snapshot =>
  Object.fromEntries(reciters.map((r) => [r.id, Object.fromEntries(timedSurahs(r).map((s) => [s, [r.timed[s][0], r.timed[s][1], fileOf(r, s)]]))]));

const ALL = mergeDevelopmentTiming(DEVELOPMENT_TIMING, REVIEWED_TIMING);
const DEV = orderedReciters(withPerAyahPreview(withTimedPreview(withReviewedPreview(withDevelopmentTiming(GENERATED_RECITERS, ALL), DEVELOPMENT_TIMING, REVIEWED_TIMING), TIMED_PREVIEW), PER_AYAH_PREVIEW));
const now = { order: DEV.map((r) => r.id), development: snapshot(DEV), release: snapshot(RECITERS) };

if (process.env.QH_WRITE_AUDIO_BASELINE === '1') {
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  fs.writeFileSync(FIXTURE, JSON.stringify({ capturedAt: new Date().toISOString(), ...now }, null, 1));
}
const base = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as typeof now;

describe('audio baseline protection (work on Sobhi, Yasser 48, Agamy 42 only)', () => {
  it('reciter order and on-hold reciters unchanged', () => {
    // Order changes since the baseline are the owner's reorders only (2026-10-24: the last four; 2026-10-28: the whole
    // list). The same reciters as the baseline: none added, none dropped.
    expect(now.order).toEqual([
      'minshawi', 'husary', 'abdulbasit', 'banna', 'shuraim', 'hudhaifi', 'sufi', 'ahmed-salama', 'shatri',
      'ajmi', 'maher', 'jaber', 'basfar', 'yasser-salama', 'naina', 'islam-sobhi', 'saleh-talib',
    ]);
    expect([...now.order].sort()).toEqual([...base.order].sort());
    expect(now.order).toEqual([...RECITER_ORDER]);
    expect([...ON_HOLD_RECITER_IDS]).toEqual(['rifaat', 'gebril']);
  });

  it('release builds: every baseline entry unchanged; added entries (owner release, 2026-10-25) are development surahs, identical', () => {
    for (const [id, surahs] of Object.entries(base.release)) {
      for (const [s, entry] of Object.entries(surahs)) expect(now.release[id]?.[Number(s)], `${id} ${s}`).toEqual(entry);
    }
    // A release adds only what development builds already play, with the same timing, size and file.
    for (const [id, surahs] of Object.entries(now.release)) {
      for (const [s, entry] of Object.entries(surahs)) if (!base.release[id]?.[Number(s)]) expect(entry, `${id} ${s}`).toEqual(now.development[id]?.[Number(s)]);
    }
  });

  it('development builds: every baseline surah keeps its timing fingerprint, size and file', () => {
    for (const [id, surahs] of Object.entries(base.development)) {
      for (const [s, entry] of Object.entries(surahs)) expect(now.development[id]?.[Number(s)], `${id} ${s}`).toEqual(entry);
    }
  });

  it('development builds: new surahs only for the three reciters\' missing surahs; no coverage decreases', () => {
    for (const [id, surahs] of Object.entries(now.development)) {
      const added = Object.keys(surahs).map(Number).filter((s) => base.development[id]?.[s] === undefined);
      for (const s of added) expect(ALLOWED_NEW[id]?.(s) ?? false, `unexpected new surah ${id} ${s}`).toBe(true);
      expect(Object.keys(surahs).length, id).toBeGreaterThanOrEqual(Object.keys(base.development[id] ?? {}).length);
    }
  });
});
