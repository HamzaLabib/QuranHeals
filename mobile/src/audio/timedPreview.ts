import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

import type { SurahTiming } from './timing';
import { timingFingerprint, type TimingEntry } from './timingFingerprint';

/**
 * Timed whole-surah recordings on trial: one file per surah from a source outside the catalogue, with automatically
 * ALIGNED ayah timing (tools/quran-audio/alignment, the risk-reviewed candidates of the audio review dashboard).
 *
 * DEVELOPMENT PREVIEW ONLY (owner request, 2026-10-23: Ahmed Mohamed Salama): the files' rights are not established and
 * their timing is a candidate, not a reviewed one. The catalogue (generated/timedPreview.ts, from
 * tools/quran-audio/surah-sources/generate-timed-preview.mjs) is loaded only when __DEV__ is true (reciters.ts), so a
 * release build contains neither the timing nor the reciter's files.
 *
 * Every surah plays ITS OWN recording (url, size): the timing names it (SurahTiming.recording), sources.ts streams
 * exactly that file after the stream check (no redirect, the recorded size), and it plays ayah by ayah only: there is no
 * whole-surah fallback. A surah is listed only when its file is CBR (exact seeking), its alignment passed the structure
 * and completeness checks and its candidate is not blocked; the timing is checked again here (fingerprint, every ayah
 * once, in order, inside the file).
 */
export type TimedPreviewSurah = {
  /** The host of this surah's file (a recording may combine sources, one whole file per surah). */
  provider: string;
  url: string;
  bytes: number;
  durationMs: number;
  /** FNV-1a fingerprint of the timing entries (timingFingerprint.ts), as in the review package. */
  fingerprint: string;
  /** Starts accepted by Reviewer 1 (listened) and by the automatic policy (nobody listened). */
  reviewer1?: number;
  automatic?: number;
  /**
   * Where the recitation's opening begins when the file starts with other audio (an introduction): ayah 1 plays from
   * here, never from the file's start. Located against the same performance's catalogue file (surah-sources/openings.json).
   */
  openingMs?: number;
  /** Ayah 1's start (its onset), then each ayah's length, ms. */
  deltas: readonly number[];
};

export type TimedPreviewRecording = {
  /** An existing catalogue reciter (reciters.ts): the preview adds playable surahs to it. */
  reciterId: string;
  /** The alignment run and source selection the catalogue was generated from. */
  evidence: string;
  generatedOn: string;
  surahs: Readonly<Record<number, TimedPreviewSurah>>;
};

/** Timing entries (ayah, start, end) from the delta encoding. */
export function previewEntries(surah: TimedPreviewSurah): TimingEntry[] {
  const entries: TimingEntry[] = [];
  let at = surah.deltas[0];
  for (let k = 1; k < surah.deltas.length; k++) {
    entries.push({ ayah: k, startMs: at, endMs: at + surah.deltas[k] });
    at += surah.deltas[k];
  }
  return entries;
}

/**
 * The surah's timing for its own recording, or null if anything about it is not as it must be: the canonical ayah
 * count, positive lengths in order, inside the file, the fingerprint the catalogue recorded, an https file of known size.
 */
export function previewTiming(recording: TimedPreviewRecording, surah: number): SurahTiming | null {
  const s = recording.surahs[surah];
  if (!s || !Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  if (!/^https:\/\/\S+$/.test(s.url) || !(Number.isInteger(s.bytes) && s.bytes > 0) || !(s.durationMs > 0)) return null;
  const entries = previewEntries(s);
  if (entries.length !== SURAH_AYAH_COUNTS[surah - 1] || timingFingerprint(entries) !== s.fingerprint) return null;
  if (!(entries[0].startMs >= 0) || entries.some((e) => !(e.endMs > e.startMs)) || entries.at(-1)!.endMs > s.durationMs + 50) return null;
  // An opening point lies before ayah 1's words (inside the file); anything else is not this surah's timing.
  if (s.openingMs !== undefined && !(Number.isInteger(s.openingMs) && s.openingMs >= 0 && s.openingMs < entries[0].startMs)) return null;
  return {
    reciterId: recording.reciterId,
    surah,
    ...(s.openingMs ? { openingMs: s.openingMs } : {}),
    introEndMs: entries[0].startMs,
    ayahs: entries.map(({ startMs, endMs }) => ({ startMs, endMs })),
    recording: { recordingId: `dev-preview:${recording.reciterId}:${surah}`, versionId: `dev-preview:${s.fingerprint}`, versionNo: 0, provider: s.provider, url: s.url, bytes: s.bytes, durationMs: s.durationMs },
  };
}

/** The surahs a preview recording can play (valid timing), ascending. */
export const previewSurahs = (recording: TimedPreviewRecording): number[] =>
  Object.keys(recording.surahs).map(Number).filter((s) => previewTiming(recording, s) !== null).sort((a, b) => a - b);

/**
 * Whether `surah` of this reciter plays from its timed preview file (its own recording, not the catalogue's). For a
 * reciter with a catalogue recording the preview holds only surahs that have no other timing (reciters.ts).
 */
export const isPreviewSurah = (reciter: { timedPreview?: TimedPreviewRecording }, surah: number): boolean =>
  reciter.timedPreview?.surahs[surah] !== undefined;
