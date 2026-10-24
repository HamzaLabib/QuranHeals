import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

import { measuredTimingEntries } from './generated/measuredTiming';
import { perAyahTiming, type PerAyahSegment } from './perAyah';
import { isPreviewSurah, previewTiming } from './timedPreview';
import { DEVELOPMENT_TIMING_ALL, hasAyahPlayback, MP3QURAN_API, timingSourceOf, type Reciter } from './reciters';
import { timingFingerprint, type TimingEntry } from './timingFingerprint';
import type { VerifiedEntry, VerifiedLoad, VerifiedRecording } from './verifiedTiming';

/**
 * A surah's verified ayah timing for one recording: where each ayah starts and ends in the surah's audio file.
 * `ayahs[k - 1]` is ayah k. `introEndMs`: where ayah 1 starts (the opening before it: istiʿādha / Basmala).
 */
export type SurahTiming = {
  reciterId: string;
  surah: number;
  introEndMs: number;
  ayahs: readonly { startMs: number; endMs: number }[];
  /**
   * Phase 4.8.3: human-verified timing (verifiedTiming.ts) belongs to ONE exact recording, which is what must play with
   * it (sources.ts). Absent: the catalogue's timing, for the catalogue's own file.
   */
  recording?: VerifiedRecording;
  /**
   * A per-ayah recording (perAyah.ts): every ayah is its own file, `files[k - 1]` ayah k's, and `ayahs[k - 1]` spans
   * that file (0 to its length). `opening`: the Basmala file played before ayah 1, or null.
   */
  perAyah?: { files: readonly PerAyahSegment[]; opening: PerAyahSegment | null };
  /**
   * A timed preview file that begins with audio which is not part of the recitation (timedPreview.ts): where ayah 1's
   * opening (istiʿādha / Basmala) begins, before `introEndMs`. Absent: 0 (the opening rule).
   */
  openingMs?: number;
};

export type TimingResult =
  | { ok: true; timing: SurahTiming }
  /**
   * 'unavailable': this reciter has no verified timing for the surah (never fetched);
   * 'network': it could not be fetched (and is not stored on the device);
   * 'mismatch': the timing is no longer the copy that was audited (MP3Quran changed it, or the measured copy shipped in
   *   the app does not match the catalogue), so it is not used.
   */
  | { ok: false; reason: 'unavailable' | 'network' | 'mismatch' };

/** The timing endpoint for one surah of one recording (https://www.mp3quran.net/api/v3/ayat_timing). */
export const timingUrl = (read: number, surah: number) => `${MP3QURAN_API}/ayat_timing?surah=${surah}&read=${read}`;

/** MP3Quran's timing payload → entries (ayah, start, end), or null for anything else. */
export function parseTimingPayload(raw: unknown): TimingEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const entries: TimingEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { ayah, start_time: start, end_time: end } = item as Record<string, unknown>;
    const startMs = Number(start);
    const endMs = Number(end);
    if (!Number.isInteger(ayah) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    entries.push({ ayah: ayah as number, startMs, endMs });
  }
  return entries;
}

/**
 * The timing for `surah` if `entries` are exactly the audited copy (its fingerprint) and well formed: ayahs 1..N in
 * order, each with a positive length, none overlapping. Anything else: null (never used).
 */
export function verifyTiming(reciter: Reciter, surah: number, entries: readonly TimingEntry[]): SurahTiming | null {
  const audited = reciter.timed[surah];
  if (!audited || timingFingerprint(entries) !== audited[0]) return null;
  const sorted = [...entries].sort((a, b) => a.ayah - b.ayah);
  const ayahs = sorted.filter((entry) => entry.ayah > 0);
  if (ayahs.length !== SURAH_AYAH_COUNTS[surah - 1]) return null;
  let previousEnd = 0;
  for (let i = 0; i < ayahs.length; i++) {
    const { ayah, startMs, endMs } = ayahs[i];
    if (ayah !== i + 1 || !(endMs > startMs) || startMs < previousEnd) return null;
    previousEnd = endMs;
  }
  return {
    reciterId: reciter.id,
    surah,
    introEndMs: ayahs[0].startMs,
    ayahs: ayahs.map(({ startMs, endMs }) => ({ startMs, endMs })),
  };
}

/** Where timing is kept on the device once fetched and verified (a small JSON text per surah and recording). */
export type TimingStore = {
  read(read: number, surah: number): Promise<string | null>;
  write(read: number, surah: number, text: string): Promise<void>;
};

export type TimingLoader = {
  load(reciter: Reciter, surah: number): Promise<TimingResult>;
  /** A stored copy only (no network): for offline checks. */
  stored(reciter: Reciter, surah: number): Promise<SurahTiming | null>;
};

/**
 * Loads a surah's timing. MP3Quran timing: from memory, else the device (verified again), else MP3Quran (verified, then
 * stored so it works offline from then on); concurrent loads of the same surah share one request. Measured timing
 * (generated/measuredTiming.ts, shipped in the app): verified the same way, never fetched or stored.
 * `measured` is injectable for tests.
 */
export function createTimingLoader(deps: {
  fetchText: (url: string) => Promise<string>;
  store: TimingStore;
  measured?: (reciterId: string, surah: number) => TimingEntry[] | null;
  /**
   * Phase 4.8.3: the published human-verified timing (verifiedTiming.ts), consulted FIRST. A reciter and surah with a
   * published version uses only it; one whose published entry failed validation ('rejected') is unavailable
   * ('mismatch'): neither ever falls back to the catalogue's timing or file.
   */
  verified?: {
    entry(reciterId: string, surah: number): VerifiedEntry | null;
    rejected(reciterId: string, surah: number): boolean;
    load(entry: VerifiedEntry): Promise<VerifiedLoad>;
    stored(entry: VerifiedEntry): Promise<SurahTiming | null>;
  };
}): TimingLoader {
  const memory = new Map<string, SurahTiming>();
  const inFlight = new Map<string, Promise<TimingResult>>();
  const keyOf = (reciter: Reciter, surah: number) => `${reciter.id}:${surah}`;
  const measured = deps.measured ?? ((reciterId: string, surah: number) => measuredTimingEntries(reciterId, surah) ?? developmentTimingEntries(reciterId, surah));

  const fromMeasured = (reciter: Reciter, surah: number): SurahTiming | null => {
    const key = keyOf(reciter, surah);
    const cached = memory.get(key);
    if (cached) return cached;
    const entries = measured(reciter.id, surah);
    const timing = entries ? verifyTiming(reciter, surah, entries) : null;
    if (timing) memory.set(key, timing);
    return timing;
  };

  const fromText = (reciter: Reciter, surah: number, text: string | null): SurahTiming | null => {
    if (!text) return null;
    try {
      const entries = parseTimingPayload(JSON.parse(text));
      return entries ? verifyTiming(reciter, surah, entries) : null;
    } catch {
      return null;
    }
  };

  /** A per-ayah recording's surah (perAyah.ts): built from the catalogue, nothing fetched or stored. */
  // A timed preview surah (timedPreview.ts): its aligned timing for its own recording, shipped in development builds.
  const fromFiles = (reciter: Reciter, surah: number): SurahTiming | null => {
    if (!reciter.perAyah && !isPreviewSurah(reciter, surah)) return null;
    const key = keyOf(reciter, surah);
    const cached = memory.get(key);
    if (cached) return cached;
    const timing = reciter.perAyah ? perAyahTiming(reciter.perAyah, surah) : previewTiming(reciter.timedPreview!, surah);
    if (timing) memory.set(key, timing);
    return timing;
  };

  const stored = async (reciter: Reciter, surah: number) => {
    if (deps.verified?.rejected(reciter.id, surah)) return null;
    const published = deps.verified?.entry(reciter.id, surah);
    if (published && deps.verified) return deps.verified.stored(published);
    if (reciter.perAyah || isPreviewSurah(reciter, surah)) return fromFiles(reciter, surah);
    if (!hasAyahPlayback(reciter, surah)) return null;
    if (timingSourceOf(reciter, surah) === 'measured') return fromMeasured(reciter, surah);
    if (reciter.timingRead === null) return null;
    const key = keyOf(reciter, surah);
    const cached = memory.get(key);
    if (cached) return cached;
    const timing = fromText(reciter, surah, await deps.store.read(reciter.timingRead, surah).catch(() => null));
    if (timing) memory.set(key, timing);
    return timing;
  };

  const load = async (reciter: Reciter, surah: number): Promise<TimingResult> => {
    if (deps.verified?.rejected(reciter.id, surah)) return { ok: false, reason: 'mismatch' };
    const published = deps.verified?.entry(reciter.id, surah);
    if (published && deps.verified) return deps.verified.load(published);
    if (reciter.perAyah || isPreviewSurah(reciter, surah)) {
      const timing = fromFiles(reciter, surah);
      return timing ? { ok: true, timing } : { ok: false, reason: 'unavailable' };
    }
    if (!hasAyahPlayback(reciter, surah)) return { ok: false, reason: 'unavailable' };
    if (timingSourceOf(reciter, surah) === 'measured') {
      const timing = fromMeasured(reciter, surah);
      return timing ? { ok: true, timing } : { ok: false, reason: 'mismatch' };
    }
    if (reciter.timingRead === null) return { ok: false, reason: 'unavailable' };
    const local = await stored(reciter, surah);
    if (local) return { ok: true, timing: local };
    const key = keyOf(reciter, surah);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const read = reciter.timingRead;
    const request = (async (): Promise<TimingResult> => {
      let text: string;
      try {
        text = await deps.fetchText(timingUrl(read, surah));
      } catch {
        return { ok: false, reason: 'network' };
      }
      const timing = fromText(reciter, surah, text);
      if (!timing) return { ok: false, reason: 'mismatch' };
      memory.set(key, timing);
      await deps.store.write(read, surah, text).catch(() => undefined);
      return { ok: true, timing };
    })();
    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      inFlight.delete(key);
    }
  };

  return { load, stored };
}

/**
 * Development-only timing (generated/developmentTiming.ts, and in development builds the reviewed aligned timing of
 * generated/reviewedTiming.ts) as timing entries, or null. The catalogue lists
 * these surahs only in development builds (reciters.ts), so a release never asks for them.
 */
export function developmentTimingEntries(reciterId: string, surah: number): TimingEntry[] | null {
  const deltas = DEVELOPMENT_TIMING_ALL[reciterId]?.[surah]?.deltas;
  if (!deltas || deltas.length < 2) return null;
  const entries: TimingEntry[] = [];
  let at = deltas[0];
  for (let k = 1; k < deltas.length; k++) {
    entries.push({ ayah: k, startMs: at, endMs: at + deltas[k] });
    at += deltas[k];
  }
  return entries;
}

/**
 * Where to start playing ayah `ayah`: the file's start for ayah 1 (with its istiʿādha / Basmala), else the ayah's start.
 * A per-ayah recording starts every ayah at the start of its own file. A timed preview file with audio before the
 * recitation (`openingMs`) starts ayah 1 where the recitation's opening begins.
 */
export function ayahStartMs(timing: SurahTiming, ayah: number): number {
  if (timing.perAyah) return 0;
  return ayah === 1 ? timing.openingMs ?? 0 : timing.ayahs[ayah - 1].startMs;
}

/** The ayah being recited at `ms` (1-based), or 0 before ayah 1. After the last ayah: the last ayah. */
export function ayahAt(timing: SurahTiming, ms: number): number {
  if (ms < timing.introEndMs) return 0;
  let low = 0;
  let high = timing.ayahs.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (timing.ayahs[mid].startMs <= ms) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}
