import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

import type { SurahTiming } from './timing';

/**
 * Per-ayah recordings: one audio file per ayah (EveryAyah's SSSAAA.mp3), instead of one file per surah with ayah
 * timing. The file boundaries ARE the ayah boundaries, so nothing is timed or approximated: ayah k plays its own file
 * from its start to its end, and every ayah except Al-Fatiha's and At-Tawbah's first is preceded, at the start of a
 * surah, by that surah's Basmala file (SSS000.mp3), exactly as the surah recordings open with it.
 *
 * DEVELOPMENT PREVIEW ONLY (owner request, 2026-10-23): the recordings' rights are not established (EveryAyah publishes
 * no licence; the files' tags say "(C) VerseByVerseQuran.Com"), and their listening review has not been done. The
 * catalogue (generated/perAyahPreview.ts, from tools/quran-audio/per-ayah) is loaded only when __DEV__ is true
 * (reciters.ts), so a release build has neither the reciter nor the data.
 *
 * A surah is listed only when EVERY file it needs passed the automated integrity checks (present, the listed size,
 * decodable MP3, a plausible length): its Full Surah is then complete. Automated checks are not a listening review:
 * the files flagged high risk await the owner's review in the audio review dashboard.
 */

/** One file: its size in bytes and its decoded length in ms (both measured by the automated scan). */
export type PerAyahFile = readonly [bytes: number, durationMs: number];

export type PerAyahSurah = {
  /** Identity of the surah's exact file set (sizes and SHA-256 of every file, tools/quran-audio/per-ayah). */
  fingerprint: string;
  /** The Basmala file played before ayah 1 (SSS000.mp3); null for Al-Fatiha (its ayah 1 is the Basmala) and At-Tawbah. */
  basmala: PerAyahFile | null;
  /** `ayahs[k - 1]`: ayah k's file. */
  ayahs: readonly PerAyahFile[];
};

export type PerAyahRecording = {
  reciterId: string;
  nameEn: string;
  nameAr: string;
  style: 'murattal' | 'mujawwad';
  provider: 'everyayah';
  /** The folder; ayah k of surah s is `${base}${s padded to 3}${k padded to 3}.mp3` (k = 0: the Basmala). */
  base: string;
  /** The risk report the catalogue was generated from (tools/quran-audio/audit-data). */
  riskReport: string;
  generatedOn: string;
  /** In generated/perAyahRelease.ts only: released after every release gate passed (not a development preview). */
  released?: true;
  surahs: Readonly<Record<number, PerAyahSurah>>;
};

const pad3 = (n: number) => String(n).padStart(3, '0');

/** The file of ayah `ayah` (0: the Basmala before ayah 1). */
export const perAyahUrl = (recording: Pick<PerAyahRecording, 'base'>, surah: number, ayah: number) => `${recording.base}${pad3(surah)}${pad3(ayah)}.mp3`;

/** Whether the surah's file set is complete and well formed: every ayah once, positive lengths, the Basmala as required. */
export function perAyahSurahValid(surah: number, entry: PerAyahSurah | undefined): entry is PerAyahSurah {
  if (!entry || !Number.isInteger(surah) || surah < 1 || surah > 114) return false;
  if (entry.ayahs.length !== SURAH_AYAH_COUNTS[surah - 1]) return false;
  const ok = (f: PerAyahFile) => Number.isInteger(f[0]) && f[0] > 0 && Number.isFinite(f[1]) && f[1] > 0;
  if (!entry.ayahs.every(ok)) return false;
  // Al-Fatiha's Basmala is its ayah 1, At-Tawbah has none: neither plays a separate Basmala file. Every other surah does.
  const wantsBasmala = surah !== 1 && surah !== 9;
  return wantsBasmala ? entry.basmala !== null && ok(entry.basmala) : entry.basmala === null;
}

/** The surahs of a recording that can play (complete, well-formed file sets), ascending. */
export const perAyahSurahs = (recording: PerAyahRecording): number[] =>
  Object.keys(recording.surahs).map(Number).filter((s) => perAyahSurahValid(s, recording.surahs[s])).sort((a, b) => a - b);

/**
 * The surah as timing the engine plays from: every ayah spans its own file, from 0 to its length, and `perAyah` names
 * the files (the Basmala first, before ayah 1). Null for a surah that cannot play.
 */
export function perAyahTiming(recording: PerAyahRecording, surah: number): SurahTiming | null {
  const entry = recording.surahs[surah];
  if (!perAyahSurahValid(surah, entry)) return null;
  return {
    reciterId: recording.reciterId,
    surah,
    introEndMs: 0,
    ayahs: entry.ayahs.map(([, durationMs]) => ({ startMs: 0, endMs: durationMs })),
    perAyah: {
      files: entry.ayahs.map(([bytes, durationMs], i) => ({ url: perAyahUrl(recording, surah, i + 1), bytes, durationMs })),
      opening: entry.basmala ? { url: perAyahUrl(recording, surah, 0), bytes: entry.basmala[0], durationMs: entry.basmala[1] } : null,
    },
  };
}

/** One file the engine plays for an ayah. */
export type PerAyahSegment = { url: string; bytes: number; durationMs: number };

/** What plays for `ayah`, in order: the Basmala then the file for ayah 1 (where the surah has one), else the ayah's file. */
export function perAyahSegments(timing: SurahTiming, ayah: number): readonly PerAyahSegment[] {
  const files = timing.perAyah;
  if (!files) return [];
  const file = files.files[ayah - 1];
  if (!file) return [];
  return ayah === 1 && files.opening ? [files.opening, file] : [file];
}
