import { GENERATED_RECITERS, type GeneratedReciter } from './generated/reciterCatalog';

/**
 * The 16 Quran Heals reciters (exactly, in the approved order), each with one MP3Quran recording of Hafs ʿan ʿĀṣim
 * (generated/reciterCatalog.ts; the audit is in tools/quran-audio/README.md). Every reciter is listed, even where the
 * recording is incomplete or has no verified ayah timing: the gaps are shown, never filled with another recording.
 *
 * Ayah playback (start at an ayah, follow ayahs, turn pages) needs verified timing for that surah: `timed`. A surah
 * without it is unavailable for that reciter, and the player says so instead of substituting another voice.
 */
export type Reciter = GeneratedReciter;

export const RECITERS: readonly Reciter[] = GENERATED_RECITERS;

export const DEFAULT_FAVORITE_RECITER_ID = 'maher';

/** MP3Quran (https://www.mp3quran.net), the audio provider; its API's base. */
export const MP3QURAN_API = 'https://www.mp3quran.net/api/v3';

/**
 * Whether recordings may be stored on the device for offline listening: **off** (2026-10-17) until MP3Quran confirms
 * permission for the specific recordings. MP3Quran's published policy (https://www.mp3quran.net/eng/privacy,
 * "Copyrights": "we allow any visitor or developer to copy any material or use any link on the websites") is site-wide;
 * downloads stay off until recording-specific confirmation is obtained. While false: Settings shows the
 * download icon as unavailable, no download can start (audio/downloads.ts refuses), and nothing is ever shown as
 * downloaded unless verified files are actually on the device. Streaming is unaffected.
 */
export const OFFLINE_DOWNLOADS_PERMITTED = false;

const BY_ID = new Map(RECITERS.map((reciter) => [reciter.id, reciter]));

export function getReciter(id: string | null | undefined): Reciter | null {
  return (id && BY_ID.get(id)) || null;
}

export function isReciterId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

export function reciterName(reciter: Reciter, rtl: boolean): string {
  return rtl ? reciter.nameAr : reciter.nameEn;
}

/** The MP3Quran file of a whole surah. */
export function surahAudioUrl(reciter: Reciter, surah: number): string {
  return `${reciter.server}${String(surah).padStart(3, '0')}.mp3`;
}

/** Whether `surah` can be played ayah by ayah with this reciter (audio and verified timing). */
export function hasAyahPlayback(reciter: Reciter, surah: number): boolean {
  return reciter.timingRead !== null && reciter.timed[surah] !== undefined;
}

export function timedSurahs(reciter: Reciter): number[] {
  return Object.keys(reciter.timed).map(Number).sort((a, b) => a - b);
}

/**
 * How much of the Quran a reciter can play ayah by ayah:
 *  - 'complete': all 114 surahs;
 *  - 'partial': some (the rest have no recording, or no verified timing);
 *  - 'none': none (no verified timing for this recording).
 */
export type ReciterCoverage = { kind: 'complete' | 'partial' | 'none'; timed: number; recorded: number };

export function reciterCoverage(reciter: Reciter): ReciterCoverage {
  const timed = timedSurahs(reciter).length;
  return { kind: timed === 114 ? 'complete' : timed === 0 ? 'none' : 'partial', timed, recorded: reciter.surahs.length };
}

/** Bytes of the files an offline download of this reciter stores (its timed surahs only: the ones that can play). */
export function offlineDownloadBytes(reciter: Reciter, surahs: readonly number[] = timedSurahs(reciter)): number {
  return surahs.reduce((sum, surah) => sum + (reciter.timed[surah]?.[1] ?? 0), 0);
}
