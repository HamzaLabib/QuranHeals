import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FAVORITE_RECITER_ID,
  getReciter,
  hasAyahPlayback,
  offlineDownloadBytes,
  RECITERS,
  reciterCoverage,
  surahAudioUrl,
  timedSurahs,
} from '@/audio/reciters';
import { measuredTimingEntries } from '@/audio/generated/measuredTiming';
import { verifyTiming } from '@/audio/timing';
import { timingFingerprint } from '@/audio/timingFingerprint';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** The approved list: exactly these 16, in this order, with these names. */
const APPROVED = [
  ['Abdul Basit Abdus Samad', 'عبد الباسط عبد الصمد'],
  ['Muhammad Siddiq Al-Minshawi', 'محمد صديق المنشاوي'],
  ['Ahmed Naeena', 'أحمد نعينع'],
  ['Mahmoud Khalil Al-Husary', 'محمود خليل الحصري'],
  ['Mahmoud Ali Al-Banna', 'محمود علي البنا'],
  ['Yasser Mahmoud Salama', 'ياسر محمود سلامة'],
  ['Saud Al-Shuraim', 'سعود الشريم'],
  ['Abdul Rashid Ali Sufi', 'عبد الرشيد علي صوفي'],
  ['Ali Al-Hudhaifi', 'علي الحذيفي'],
  ['Abu Bakr Al-Shatri', 'أبو بكر الشاطري'],
  ['Ahmed Al-Ajmi', 'أحمد العجمي'],
  ['Maher Al-Muaiqly', 'ماهر المعيقلي'],
  ['Abdullah Basfar', 'عبد الله بصفر'],
  ['Saleh Al-Talib', 'صالح آل طالب'],
  ['Muhammad Rifaat', 'محمد رفعت'],
  ['Islam Sobhi', 'إسلام صبحي'],
  ['Ahmed Mohamed Salama', 'أحمد محمد سلامة'],
] as const;

/** MP3Quran reciter id → the moshaf (recording) used, from https://www.mp3quran.net/api/v3/reciters (2026-10-17). */
const SOURCES: Record<string, [reciter: number | null, moshaf: number | null]> = {
  abdulbasit: [51, 53], minshawi: [112, 112], naina: [9, 9], husary: [118, 118], banna: [121, 121], 'yasser-salama': [152, 152],
  shuraim: [31, 31], sufi: [64, 258], hudhaifi: [74, 74], shatri: [4, 4], ajmi: [5, 5], maher: [102, 133], basfar: [60, 60],
  'saleh-talib': [41, 41], rifaat: [241, 241], 'islam-sobhi': [253, 253],
  // Not on MP3Quran: no recording in the app (tools/quran-audio/reciters.mjs, noRecording).
  'ahmed-salama': [null, null],
};

const tool = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../tools/quran-audio/${name}`, import.meta.url)), 'utf8'));
const results = tool('audit-results.json') as {
  reciters: {
    id: string; moshafName: string; surahs: number[]; bytes: Record<string, number>; timed: Record<string, { fingerprint: string }>;
    timingRead: number | null; timingSource: 'mp3quran' | 'measured' | null; excluded: Record<string, string[]>;
  }[];
};
const measured = tool('measured-timing.json') as { reciters: Record<string, { audio: string; surahs: Record<string, [number, number][]> }> };

/** Maher's surahs withdrawn on 2026-10-17: a boundary inside recitation, proven by a second timing of the same performance. */
const MAHER_WITHDRAWN = [3, 7, 19, 26, 29, 32, 34, 36, 40, 41, 42, 44, 68];

describe('the 17 reciters', () => {
  it('are exactly the approved 17, in order, with their English and Arabic names', () => {
    expect(RECITERS).toHaveLength(17);
    expect(RECITERS.map((r) => [r.nameEn, r.nameAr])).toEqual(APPROVED.map(([en, ar]) => [en, ar]));
    expect(new Set(RECITERS.map((r) => r.id)).size).toBe(17);
  });

  it('never include the excluded reciters', () => {
    const names = RECITERS.flatMap((r) => [r.nameEn, r.nameAr]).join(' | ');
    for (const excluded of ['Afasy', 'Alafasy', 'العفاسي', 'Sudais', 'السديس']) expect(names).not.toContain(excluded);
    const ids = RECITERS.map((r) => r.mp3quranReciterId);
    // MP3Quran: 123 Mishary Alafasi, 54 Abdulrahman Alsudaes.
    expect(ids).not.toContain(123);
    expect(ids).not.toContain(54);
  });

  it('default to Maher Al-Muaiqly', () => {
    expect(DEFAULT_FAVORITE_RECITER_ID).toBe('maher');
    expect(getReciter(DEFAULT_FAVORITE_RECITER_ID)?.nameEn).toBe('Maher Al-Muaiqly');
  });

  it('use the audited MP3Quran reciter and recording ids', () => {
    for (const reciter of RECITERS) expect([reciter.mp3quranReciterId, reciter.moshafId]).toEqual(SOURCES[reciter.id]);
  });

  it('are Hafs ʿan ʿĀṣim recordings: labelled so by MP3Quran, except the one recording it leaves unlabelled', () => {
    for (const reciter of RECITERS) {
      const audited = results.reciters.find((r) => r.id === reciter.id)!;
      if (reciter.server === null) {
        expect(reciter.riwayaLabel).toBeNull();
        continue;
      }
      if (reciter.riwayaLabel === 'hafs') expect(audited.moshafName).toMatch(/^حفص عن عاصم/);
      else expect(audited.moshafName).toBe('المصحف المجود - المصحف المجود');
      // Never another riwaya.
      expect(audited.moshafName).not.toMatch(/ورش|قالون|الدوري|السوسي|خلف|شعبة|البزي|قنبل/);
    }
    expect(RECITERS.filter((r) => r.riwayaLabel === 'unlabelled').map((r) => r.id)).toEqual(['maher']);
    expect(RECITERS.filter((r) => r.server === null).map((r) => r.id)).toEqual(['ahmed-salama']);
  });

  it('stream from MP3Quran\'s CDN', () => {
    for (const reciter of RECITERS.filter((r) => r.server !== null)) expect(reciter.server).toMatch(/^https:\/\/cdn\.mp3quran\.net\/audio\/[a-z0-9-]+\/r\d\/$/);
    expect(surahAudioUrl(getReciter('maher')!, 2)).toBe('https://cdn.mp3quran.net/audio/maher-muaiqly/r3/002.mp3');
  });
});

describe('availability', () => {
  it('lists incomplete recordings as they are (never filled from another recording)', () => {
    expect(getReciter('saleh-talib')!.surahs).toHaveLength(32);
    expect(getReciter('rifaat')!.surahs).toHaveLength(31);
    expect(getReciter('islam-sobhi')!.surahs).toHaveLength(109);
    // No recording in the app at all (the only one found has no timing and no permission for app use).
    expect(getReciter('ahmed-salama')!.surahs).toEqual([]);
    expect(() => surahAudioUrl(getReciter('ahmed-salama')!, 1)).toThrow();
    for (const id of ['abdulbasit', 'minshawi', 'naina', 'husary', 'banna', 'yasser-salama', 'shuraim', 'sufi', 'hudhaifi', 'shatri', 'ajmi', 'maher', 'basfar']) {
      expect(getReciter(id)!.surahs).toHaveLength(114);
    }
  });

  it('only surahs with a recording can have verified timing', () => {
    for (const reciter of RECITERS) for (const surah of timedSurahs(reciter)) expect(reciter.surahs).toContain(surah);
  });

  it('reciters without verified timing have no ayah playback at all', () => {
    for (const id of ['yasser-salama', 'saleh-talib', 'rifaat', 'islam-sobhi', 'ahmed-salama']) {
      const reciter = getReciter(id)!;
      expect(reciter.timingSource).toBeNull();
      expect(reciter.timingRead).toBeNull();
      expect(timedSurahs(reciter)).toEqual([]);
      expect(reciterCoverage(reciter).kind).toBe('none');
      expect(hasAyahPlayback(reciter, 1)).toBe(false);
    }
  });

  it('Ali Al-Hudhaifi plays from timing measured for his MP3Quran recording (no MP3Quran timing is used)', () => {
    const hudhaifi = getReciter('hudhaifi')!;
    expect(hudhaifi.timingSource).toBe('measured');
    expect(hudhaifi.timingRead).toBeNull();
    expect(hudhaifi.server).toBe('https://cdn.mp3quran.net/audio/ali-hudhaifi/r1/');
    expect(measured.reciters.hudhaifi.audio).toBe(hudhaifi.server);
    expect(timedSurahs(hudhaifi).length).toBeGreaterThan(0);
    expect(timedSurahs(hudhaifi)).toEqual(Object.keys(measured.reciters.hudhaifi.surahs).map(Number));
    for (const surah of timedSurahs(hudhaifi)) expect(hasAyahPlayback(hudhaifi, surah)).toBe(true);
    // Every other reciter with timing uses MP3Quran's, except Mahmoud Ali Al-Banna: one surah, measured the same way.
    expect(RECITERS.filter((r) => r.timingSource === 'measured').map((r) => r.id)).toEqual(['banna', 'hudhaifi']);
    expect(timedSurahs(getReciter('banna')!)).toEqual([108]);
    for (const r of RECITERS.filter((x) => x.timingSource === 'mp3quran')) expect(r.timingRead).toBe(r.moshafId);
  });

  it('Maher Al-Muaiqly: every surah except those whose MP3Quran timing was proven wrong', () => {
    const maher = getReciter('maher')!;
    expect(reciterCoverage(maher)).toEqual({ kind: 'partial', timed: 114 - MAHER_WITHDRAWN.length, recorded: 114 });
    for (const surah of MAHER_WITHDRAWN) expect(hasAyahPlayback(maher, surah)).toBe(false);
    const audited = results.reciters.find((r) => r.id === 'maher')!;
    for (const surah of MAHER_WITHDRAWN) expect(audited.excluded[surah].join(' ')).toMatch(/second timing of the same performance/);
    expect(hasAyahPlayback(maher, 1)).toBe(true);
    expect(hasAyahPlayback(maher, 18)).toBe(true);
  });

  it('Abdul Basit covers all 114 surahs; the others name their gaps', () => {
    expect(reciterCoverage(getReciter('abdulbasit')!).kind).toBe('complete');
    expect(hasAyahPlayback(getReciter('husary')!, 1)).toBe(false); // its Al-Fatiha timing labels the Basmala as ayah 0
    expect(hasAyahPlayback(getReciter('basfar')!, 2)).toBe(false); // 2:149 has zero length
    expect(hasAyahPlayback(getReciter('shuraim')!, 87)).toBe(false); // misaligned with its audio
    expect(reciterCoverage(getReciter('husary')!).kind).toBe('partial');
  });

  it('download sizes come from the audited files', () => {
    const maher = getReciter('maher')!;
    expect(offlineDownloadBytes(maher)).toBeGreaterThan(1_000_000_000);
    expect(offlineDownloadBytes(maher, [1])).toBe(maher.timed[1][1]);
    expect(offlineDownloadBytes(getReciter('yasser-salama')!)).toBe(0);
  });
});

describe('the generated catalog', () => {
  it('matches the audit results exactly (surahs, timed surahs, fingerprints, sizes)', () => {
    for (const reciter of RECITERS) {
      const audited = results.reciters.find((r) => r.id === reciter.id)!;
      expect(reciter.surahs).toEqual(audited.surahs);
      expect(reciter.timingRead).toBe(audited.timingRead);
      expect(reciter.timingSource).toBe(audited.timingSource);
      expect(Object.keys(reciter.timed).map(Number)).toEqual(Object.keys(audited.timed).map(Number));
      for (const [surah, [fingerprint, bytes]] of Object.entries(reciter.timed)) {
        expect(fingerprint).toBe(audited.timed[surah].fingerprint);
        expect(bytes).toBe(audited.bytes[surah]);
      }
    }
  });

  it('ships exactly the measured timing that was audited, and it verifies like any other timing', () => {
    for (const reciter of RECITERS.filter((r) => r.timingSource === 'measured')) {
      for (const surah of timedSurahs(reciter)) {
        const entries = measuredTimingEntries(reciter.id, surah)!;
        expect(entries.map((e) => [e.startMs, e.endMs])).toEqual(measured.reciters[reciter.id].surahs[surah]);
        const timing = verifyTiming(reciter, surah, entries);
        expect(timing).not.toBeNull();
        expect(timing!.ayahs).toHaveLength(SURAH_AYAH_COUNTS[surah - 1]);
      }
    }
    expect(measuredTimingEntries('maher', 1)).toBeNull();
  });

  it("the audit used the app's canonical ayah counts", () => {
    expect(tool('audit-data/ayah-counts.json')).toEqual([...SURAH_AYAH_COUNTS]);
  });

  it('uses the same timing fingerprint as the audit tool', async () => {
    const tool = (await import('../../tools/quran-audio/fingerprint.mjs')) as { timingFingerprint: (entries: unknown[]) => string };
    const samples = [
      [{ ayah: 0, startMs: 0, endMs: 7820 }, { ayah: 1, startMs: 7820, endMs: 14020 }],
      [{ ayah: 2, startMs: 10, endMs: 20 }, { ayah: 1, startMs: 0, endMs: 10 }],
      [],
    ];
    for (const sample of samples) expect(timingFingerprint(sample)).toBe(tool.timingFingerprint(sample));
  });
});
