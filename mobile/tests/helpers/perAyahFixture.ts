import type { PerAyahRecording } from '@/audio/perAyah';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** A synthetic per-ayah recording (audio/perAyah.ts) for tests: every ayah file 6 s, every Basmala file 4 s. */
export const FIXTURE_AYAH_MS = 6000;
export const FIXTURE_BASMALA_MS = 4000;

const fileSet = (surah: number, basmala: boolean) => ({
  fingerprint: `fx${surah}`,
  basmala: basmala ? ([60_000, FIXTURE_BASMALA_MS] as const) : null,
  ayahs: Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => [90_000 + i, FIXTURE_AYAH_MS] as const),
});

export const PER_AYAH_FIXTURE: PerAyahRecording = {
  reciterId: 'gebril-test', nameEn: 'Fixture Per-Ayah', nameAr: 'تجربة', style: 'murattal', provider: 'everyayah',
  base: 'https://everyayah.com/data/Fixture_128kbps/', riskReport: 'fixture', generatedOn: '2026-10-23',
  surahs: {
    1: fileSet(1, false),
    2: fileSet(2, true),
    9: fileSet(9, false),
    112: fileSet(112, true),
    113: fileSet(113, true),
    // Not playable: one ayah file missing (a gap is never filled), and no Basmala file for a surah that opens with one.
    3: { ...fileSet(3, true), ayahs: fileSet(3, true).ayahs.slice(1) },
    4: fileSet(4, false),
  },
};
