import { DEVELOPMENT_TIMING } from './generated/developmentTiming';
import { GENERATED_RECITERS, type GeneratedReciter } from './generated/reciterCatalog';
import { PER_AYAH_RELEASE } from './generated/perAyahRelease';
import { MEASURED_RELEASE, REVIEWED_RELEASE, TIMED_PREVIEW_RELEASE, VBR_RELEASE, type ReleasedTimingSurah } from './generated/timingRelease';
import { perAyahSurahs, type PerAyahRecording } from './perAyah';
import { isPreviewSurah, previewSurahs, type TimedPreviewRecording } from './timedPreview';
import { readNativeMp3Seek, vbrSeekEnabled, type NativeMp3Seek } from './vbrSeek';

/**
 * The 17 Quran Heals reciters (exactly, in the approved order), each with one MP3Quran recording of Hafs ʿan ʿĀṣim
 * (generated/reciterCatalog.ts; the audit is in tools/quran-audio/README.md), except Ahmed Mohamed Salama, who has none in
 * the app (`server` null). Every reciter is listed, even where the recording is incomplete, missing or has no verified
 * ayah timing: the gaps are shown, never filled with another recording.
 *
 * Ayah playback (start at an ayah, follow ayahs, turn pages) needs verified timing for that surah: `timed`. A surah
 * without it is unavailable for that reciter, and the player says so instead of substituting another voice. The
 * timing is MP3Quran's own (`timingSource: 'mp3quran'`, fetched and fingerprint-checked) or, where MP3Quran has none
 * that can be used, measured for the same MP3Quran file by the audit (`'measured'`, shipped in the app).
 */
export type Reciter = GeneratedReciter & {
  /** Surahs whose verified timing comes from another source than the reciter's `timingSource` (development: 'measured'). */
  timingSourceBySurah?: Readonly<Record<number, 'measured'>>;
  /** Surahs playable in development builds only (generated/developmentTiming.ts): not in a release. */
  developmentSurahs?: readonly number[];
  /**
   * Release builds: surahs whose reviewed (or VBR) timing passed every release gate, physical-device tests included
   * (generated/timingRelease.ts, tools/quran-audio/development/generate-timing-release.mjs). Never a preview.
   */
  releasedSurahs?: readonly number[];
  /**
   * Development surahs whose timing is the review dashboard's accepted aligned timing (generated/reviewedTiming.ts:
   * Reviewer 1 and/or the automatic acceptance policy): a development preview, never independent verification.
   */
  reviewedPreviewSurahs?: readonly number[];
  /**
   * Development surahs whose catalogue file is VBR and plays with exact seeking (vbrSeek.ts: a patched binary only).
   * The native player is told to seek these files exactly (INDEX_SEEK_URLS); the source registry treats them as seekable.
   */
  vbrIndexSeekSurahs?: readonly number[];
  /**
   * A per-ayah recording (perAyah.ts: one file per ayah, no timing): development preview only. Such a reciter has no
   * surah file (`server` null) and no timing source; `timed` lists its playable surahs (file-set fingerprint, total size).
   */
  perAyah?: PerAyahRecording;
  /**
   * Timed whole-surah recordings on trial (timedPreview.ts: one file per surah, aligned candidate timing, each surah's
   * own recording): development preview only. `timed` lists those surahs (timing fingerprint, file size).
   */
  timedPreview?: TimedPreviewRecording;
};

/**
 * DEVELOPMENT PREVIEW: aligned timing from whole-surah files outside the catalogue (timedPreview.ts). The reciter keeps
 * its place and names; a surah with valid preview timing and NO other timing (production, measured or reviewed) becomes
 * playable ayah by ayah from its own file. The catalogue's own timing is never replaced. A reciter with no recording of
 * its own lists the preview's surahs; a reciter with one keeps `surahs` as the catalogue lists them (the only MP3Quran
 * URLs ever built: an unlisted surah's URL redirects to another Sheikh), and `timedPreview` holds just the added surahs.
 */
export function withTimedPreview(reciters: readonly Reciter[], preview: readonly TimedPreviewRecording[]): readonly Reciter[] {
  const byId = new Map(preview.map((p) => [p.reciterId, p]));
  return reciters.map((reciter) => {
    const p = byId.get(reciter.id);
    if (!p || reciter.perAyah) return reciter;
    const surahs = previewSurahs(p).filter((s) => reciter.timed[s] === undefined);
    if (!surahs.length) return reciter;
    const own: TimedPreviewRecording = { ...p, surahs: Object.fromEntries(surahs.map((s) => [s, p.surahs[s]])) };
    const timed = { ...reciter.timed, ...Object.fromEntries(surahs.map((s) => [s, [p.surahs[s].fingerprint, p.surahs[s].bytes] as const])) };
    return reciter.server === null ? { ...reciter, surahs, timed, timedPreview: own } : { ...reciter, timed, timedPreview: own };
  });
}

// Release builds: only the timed-preview surahs that passed every release gate (generated/timingRelease.ts; rights of the
// file's provider included), marked `released`. Development builds: the whole preview, labelled as one.
const TIMED_PREVIEW: readonly TimedPreviewRecording[] = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./generated/timedPreview') as typeof import('./generated/timedPreview')).TIMED_PREVIEW
  : TIMED_PREVIEW_RELEASE;

/**
 * DEVELOPMENT PREVIEW: per-ayah recordings (perAyah.ts) as reciters, listed after the catalogue's. Each surah whose file
 * set is complete is playable ayah by ayah; nothing is downloadable (offline storage is never permitted for them).
 */
export function withPerAyahPreview(reciters: readonly Reciter[], preview: readonly PerAyahRecording[]): readonly Reciter[] {
  const taken = new Set(reciters.map((r) => r.id));
  const extra = preview
    .filter((p) => !taken.has(p.reciterId))
    .map((p): Reciter => {
      const surahs = perAyahSurahs(p);
      return {
        id: p.reciterId, nameEn: p.nameEn, nameAr: p.nameAr, mp3quranReciterId: null, moshafId: null, server: null, style: p.style,
        // EveryAyah names the recording Hafs only through its Kufan ayah set (every ayah file present); not an MP3Quran label.
        riwayaLabel: 'unlabelled', surahs, timingSource: null, timingRead: null,
        timed: Object.fromEntries(surahs.map((s) => [s, [p.surahs[s].fingerprint, p.surahs[s].ayahs.reduce((sum, f) => sum + f[0], p.surahs[s].basmala?.[0] ?? 0)] as const])),
        perAyah: p,
      };
    });
  return extra.length ? [...reciters, ...extra] : reciters;
}

// Loaded only in development builds: Metro drops the require (and the data) from a release bundle.
// A release build plays only the per-ayah recordings of generated/perAyahRelease.ts, written by
// tools/quran-audio/per-ayah/generate-preview.mjs --release once every release gate passes (Ali Jaber, 2026-10-25: on
// the owner's decisions, without rights documents or device evidence; surahs with an unresolved override left out).
const PER_AYAH_PREVIEW: readonly PerAyahRecording[] = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./generated/perAyahPreview') as typeof import('./generated/perAyahPreview')).PER_AYAH_PREVIEW
  : PER_AYAH_RELEASE;

/**
 * The catalogue with DEVELOPMENT-ONLY measured timing added (generated/developmentTiming.ts): for surahs that have no
 * production timing, from the same MP3Quran file and checked by the same rules. Used only when `__DEV__` is true, so a
 * release build plays exactly the production catalogue.
 */
export function withDevelopmentTiming(
  reciters: readonly GeneratedReciter[],
  development: Readonly<Record<string, Readonly<Record<number, { fingerprint: string; bytes: number }>>>>,
): readonly Reciter[] {
  return reciters.map((reciter) => {
    const extra = Object.entries(development[reciter.id] ?? {})
      .map(([s, d]) => [Number(s), d] as const)
      // Never over production timing, never for a surah the recording does not list (its URL would redirect).
      .filter(([s]) => reciter.timed[s] === undefined && reciter.surahs.includes(s) && reciter.server !== null);
    if (extra.length === 0) return reciter;
    return {
      ...reciter,
      // A reciter with no timing at all until now: its development timing is shipped in the app (like measured timing).
      timingSource: reciter.timingSource ?? 'measured',
      timed: { ...reciter.timed, ...Object.fromEntries(extra.map(([s, d]) => [s, [d.fingerprint, d.bytes] as const])) },
      timingSourceBySurah: Object.fromEntries(extra.map(([s]) => [s, 'measured' as const])),
      developmentSurahs: extra.map(([s]) => s).sort((a, b) => a - b),
    };
  });
}

/**
 * ON HOLD (owner, 2026-10-24: Muhammad Rifaat, Mohamed Gebril): reciters not offered in the app, in development or release builds (pickers, playback, the
 * ayah screens). A reversible visibility decision: their recordings, timing, catalogue entries, preview data, audits and
 * review dashboard entries are all kept (tools/quran-audio is unchanged), and a Favorite Reciter stored on a device is
 * not deleted: while on hold it reads as the default (favoriteReciterPreference.ts) and returns once reinstated.
 */
export const ON_HOLD_RECITER_IDS: readonly string[] = ['rifaat', 'gebril'];
export const withoutOnHold = (reciters: readonly Reciter[], onHold: readonly string[] = ON_HOLD_RECITER_IDS): readonly Reciter[] =>
  reciters.filter((reciter) => !onHold.includes(reciter.id));

/**
 * The owner's reciter order (2026-10-24, final: 17), the same in English and Arabic, for every picker (the Mushaf player, Settings →
 * Favorite Reciter, the ayah screens). Ids are the catalogue's stable ids. A reciter absent from a build (Ali Abdullah
 * Jaber is a development preview) is skipped, never replaced. Being listed here grants nothing: a reciter plays only
 * where its own recording and timing allow, and development previews stay out of release builds.
 * Not in the list, and so not offered (kept in the catalogue, audits and review dashboard): the on-hold reciters above.
 */
export const RECITER_ORDER: readonly string[] = [
  'minshawi', 'husary', 'abdulbasit', 'banna', 'sufi', 'ahmed-salama', 'hudhaifi', 'shuraim', 'maher',
  'shatri', 'ajmi', 'jaber', 'basfar', 'yasser-salama', 'naina', 'islam-sobhi', 'saleh-talib',
];
/** English display names as the owner writes them (2026-10-24); the catalogue's own names are unchanged. */
export const DISPLAY_NAMES_EN: Readonly<Record<string, string>> = { ajmi: 'Ahmed Al-Agamy', naina: 'Ahmed Naina' };
/** Arabic display names as the owner writes them (2026-10-24); the catalogue's own names are unchanged. */
export const DISPLAY_NAMES_AR: Readonly<Record<string, string>> = { hudhaifi: 'علي بن عبد الرحمن الحذيفي' };

/** The reciters offered in the app: the owner's order, without on-hold or unlisted reciters, with display names. */
export function orderedReciters(all: readonly Reciter[], order: readonly string[] = RECITER_ORDER): readonly Reciter[] {
  const byId = new Map(withoutOnHold(all).map((r) => [r.id, r]));
  return order.flatMap((id) => {
    const r = byId.get(id);
    return r ? [{ ...r, nameEn: DISPLAY_NAMES_EN[id] ?? r.nameEn, nameAr: DISPLAY_NAMES_AR[id] ?? r.nameAr }] : [];
  });
}

type DevTiming = Readonly<Record<string, Readonly<Record<number, { fingerprint: string; bytes: number; deltas: readonly number[] }>>>>;

/**
 * DEVELOPMENT PREVIEW (owner, 2026-10-24): the review dashboard's accepted aligned timing for MP3Quran catalogue surahs
 * with no other timing (generated/reviewedTiming.ts; tools/quran-audio/development/generate-reviewed-timing.mjs).
 * Loaded only in development builds: Metro drops the require (and the data) from a release bundle. A release build
 * plays only the surahs of it that passed every release gate (REVIEWED_RELEASE, generated/timingRelease.ts), plus the
 * development measured timing an owner decision released (MEASURED_RELEASE; the two never share a surah).
 */
const REVIEWED_TIMING: DevTiming = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./generated/reviewedTiming') as typeof import('./generated/reviewedTiming')).REVIEWED_TIMING
  : mergeDevelopmentTiming(MEASURED_RELEASE, REVIEWED_RELEASE);

/** Development timing: the measured timing first, then reviewed aligned timing for surahs that have none. */
export function mergeDevelopmentTiming(measured: DevTiming, reviewed: DevTiming): DevTiming {
  const out: Record<string, Record<number, DevTiming[string][number]>> = {};
  for (const [id, surahs] of Object.entries(reviewed)) out[id] = { ...surahs };
  for (const [id, surahs] of Object.entries(measured)) out[id] = { ...out[id], ...surahs };
  return out;
}

/** Marks the development surahs that come from reviewed aligned timing (labelled a development preview). */
export function withReviewedPreview(reciters: readonly Reciter[], measured: DevTiming, reviewed: DevTiming): readonly Reciter[] {
  return reciters.map((reciter) => {
    const own = (reciter.developmentSurahs ?? []).filter((s) => reviewed[reciter.id]?.[s] !== undefined && measured[reciter.id]?.[s] === undefined);
    return own.length ? { ...reciter, reviewedPreviewSurahs: own } : reciter;
  });
}

/** The released VBR surahs this binary's exact-seek method passed its device test on (the platform marker removed). */
export function vbrReleaseFor(release: typeof VBR_RELEASE, native: NativeMp3Seek): DevTiming {
  const out: Record<string, Record<number, ReleasedTimingSurah>> = {};
  for (const [id, surahs] of Object.entries(release)) {
    for (const [s, { platforms, ...timing }] of Object.entries(surahs)) if (platforms.includes(native)) (out[id] ??= {})[Number(s)] = timing;
  }
  return out;
}

/**
 * Behind capability detection (vbrSeek.ts): the review dashboard's accepted timing of the MP3Quran VBR recordings of
 * Islam Sobhi, Yasser Mahmoud Salama (48) and Ahmed Al-Agamy (42), used only when the installed binary seeks them
 * exactly and its method is device-verified (or, in development builds only, the device-test flag is set).
 *  - Development builds: all of it (generated/vbrTiming.ts, tools/quran-audio/development/generate-vbr-timing.mjs).
 *  - Release builds: only surahs released for this binary's platform (VBR_RELEASE, generated/timingRelease.ts).
 * Empty on unpatched binaries, unverified platforms and in tests: then nothing below changes. When used, the original
 * recording plays instead of a CBR copy of it (timedPreview.ts fills only surahs without timing).
 */
const NATIVE_MP3_SEEK = readNativeMp3Seek();
const VBR_TIMING: DevTiming = NATIVE_MP3_SEEK === null || !vbrSeekEnabled(NATIVE_MP3_SEEK, process.env.EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST)
  ? {}
  : __DEV__
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./generated/vbrTiming') as typeof import('./generated/vbrTiming')).VBR_TIMING
    : vbrReleaseFor(VBR_RELEASE, NATIVE_MP3_SEEK);

/**
 * Release builds: the catalogue with the released reviewed / VBR timing added, for surahs that have no production timing
 * (the same rules as withDevelopmentTiming), marked `releasedSurahs`, never as development or preview surahs.
 */
export function withReleasedTiming(reciters: readonly GeneratedReciter[], released: DevTiming): readonly Reciter[] {
  return withDevelopmentTiming(reciters, released).map(({ developmentSurahs, ...reciter }) => (developmentSurahs ? { ...reciter, releasedSurahs: developmentSurahs } : reciter));
}

/** Marks the development surahs whose catalogue file is VBR and plays with exact seeking (vbrSeek.ts). */
export function withVbrSeek(reciters: readonly Reciter[], vbr: DevTiming): readonly Reciter[] {
  return reciters.map((reciter) => {
    const own = Object.entries(vbr[reciter.id] ?? {}).filter(([s, d]) => reciter.timed[Number(s)]?.[0] === d.fingerprint).map(([s]) => Number(s));
    return own.length ? { ...reciter, vbrIndexSeekSurahs: own.sort((a, b) => a - b) } : reciter;
  });
}

/** The catalogue files that play with exact VBR seeking (the native player is told so: vbrSeek.ts). */
export function indexSeekUrls(reciters: readonly Reciter[]): ReadonlySet<string> {
  return new Set(reciters.flatMap((r) => (r.vbrIndexSeekSurahs ?? []).map((s) => `${r.server}${String(s).padStart(3, '0')}.mp3`)));
}

const REVIEWED_AND_VBR: DevTiming = mergeDevelopmentTiming(VBR_TIMING, REVIEWED_TIMING);

/**
 * The app-shipped timing the app can load (timing.ts): measured development timing, plus reviewed and VBR timing —
 * all of it in development builds, only the released surahs in a release (REVIEWED_AND_VBR is then the released set).
 * A release lists only released surahs as playable (RECITERS below), so the measured development timing stays inert.
 */
export const DEVELOPMENT_TIMING_ALL: DevTiming = mergeDevelopmentTiming(DEVELOPMENT_TIMING, REVIEWED_AND_VBR);

export const RECITERS: readonly Reciter[] = orderedReciters(__DEV__
  ? withPerAyahPreview(withTimedPreview(withVbrSeek(withReviewedPreview(withDevelopmentTiming(GENERATED_RECITERS, DEVELOPMENT_TIMING_ALL), DEVELOPMENT_TIMING, REVIEWED_AND_VBR), VBR_TIMING), TIMED_PREVIEW), PER_AYAH_PREVIEW)
  : withPerAyahPreview(withTimedPreview(withVbrSeek(withReleasedTiming(GENERATED_RECITERS, REVIEWED_AND_VBR), VBR_TIMING), TIMED_PREVIEW), PER_AYAH_PREVIEW));

/** Catalogue files the native player must seek exactly (empty unless the VBR timing is in use). */
export const INDEX_SEEK_URLS: ReadonlySet<string> = indexSeekUrls(RECITERS);

/** The timing source of one surah: its own (development measured timing) or the reciter's. */
export const timingSourceOf = (reciter: Reciter, surah: number): GeneratedReciter['timingSource'] =>
  reciter.timingSourceBySurah?.[surah] ?? reciter.timingSource;

/**
 * The app's default reciter (owner, 2026-10-24): Muhammad Siddiq Al-Minshawi. One setting, used twice:
 *  - the Favorite Reciter for anyone who has never chosen one (a saved choice is never changed);
 *  - the fallback voice: where the reciter asked for has no verified recording of a surah, the engine plays this one's
 *    verified ayah timing instead (audio/engine.ts `voiceFor`), never an unverified or untimed recording, never a third.
 */
export const DEFAULT_RECITER_ID = 'minshawi';
export const DEFAULT_FAVORITE_RECITER_ID = DEFAULT_RECITER_ID;
export const FALLBACK_RECITER_ID = DEFAULT_RECITER_ID;

/** MP3Quran (https://www.mp3quran.net), the audio provider; its API's base. */
export const MP3QURAN_API = 'https://www.mp3quran.net/api/v3';

/**
 * Whether recordings may be stored on the device for offline listening: **on** since 2026-10-24, the owner's decision
 * (Hamza) on the basis of MP3Quran's published reuse statement (https://www.mp3quran.net/eng/privacy, "Copyrights": "we
 * allow any visitor or developer to copy any material or use any link on the websites"). That statement is site-wide:
 * no recording-specific written permission has been obtained. Only MP3Quran catalogue files can be stored, because only
 * that provider permits offline storage (tools/quran-audio/providers.mjs; sourceRegistry.ts checks both), and only a
 * reciter's timed surahs (offlineDownloadBytes). Every stored file is still verified (size, fingerprint, free space) and
 * nothing is shown as downloaded unless verified files are actually on the device. false turns downloads off again:
 * Settings then shows the download icon as unavailable and no download can start (audio/downloads.ts refuses).
 */
export const OFFLINE_DOWNLOADS_PERMITTED = true;

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
  // Never reached for a reciter without a recording: it has no timed surah, so nothing of it is ever loaded.
  if (reciter.server === null) throw new Error(`${reciter.id} has no recording in the app`);
  return `${reciter.server}${String(surah).padStart(3, '0')}.mp3`;
}

/** Whether `surah` can be played ayah by ayah with this reciter (audio and verified timing). */
export function hasAyahPlayback(reciter: Reciter, surah: number): boolean {
  return (reciter.timingSource !== null || reciter.perAyah !== undefined || reciter.timedPreview !== undefined) && reciter.timed[surah] !== undefined;
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

/**
 * The surahs an offline download stores: the timed surahs of the reciter's own catalogue recording. Timed-preview surahs
 * (files from other hosts, timedPreview.ts) and per-ayah recordings (perAyah.ts: one file per ayah, no surah file to
 * store) play by streaming only and are never stored (audio/downloads.ts).
 */
export function downloadableSurahs(reciter: Reciter): number[] {
  if (reciter.perAyah !== undefined) return [];
  return timedSurahs(reciter).filter((surah) => !isPreviewSurah(reciter, surah));
}

/** Bytes of the files an offline download of this reciter stores (downloadableSurahs: the ones it can store). */
export function offlineDownloadBytes(reciter: Reciter, surahs: readonly number[] = downloadableSurahs(reciter)): number {
  return surahs.reduce((sum, surah) => sum + (reciter.timed[surah]?.[1] ?? 0), 0);
}
