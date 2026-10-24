import type { AppLocale } from '@/localization/locales';
import type { QuranReadingMode } from '@/localization/quranLanguage';
import { SURAH_START_PAGES } from '@/mushaf/generated/surahStartPages';

import { bundledSurahPreview } from './bundledDataset';

/**
 * A section's standing (tools/surah-preview/README.md):
 * - 'quoted': the source's own words, verbatim (only whitespace normalised) — the Mukhtasar's «من مقاصد السورة»;
 * - 'approved': prepared from a cited source and approved by a qualified reviewer;
 * - 'pending-review': prepared from a cited source, awaiting that review (development builds show it, marked);
 * - 'unavailable': no text this app may use. Never filled by the app, machine-translated or guessed.
 */
export type ContentStatus = 'quoted' | 'approved' | 'pending-review' | 'unavailable';
const CONTENT_STATUSES: readonly ContentStatus[] = ['quoted', 'approved', 'pending-review', 'unavailable'];

/**
 * One Surah's introduction. `revelation` and `ayahCount` are the Surah's facts (Tanzil); `purpose` (مقصد السورة) and
 * `themes` (موضوعاتها) carry each language's text, its status, and the ids of the sources it comes from
 * (SurahPreviewSource.id). A text is null exactly where its status is 'unavailable'.
 */
export type SurahPreviewEntry = {
  surah: number;
  revelation: 'makki' | 'madani';
  ayahCount: number;
  purpose: { ar: string; en: string | null };
  themes: { ar: readonly string[] | null; en: readonly string[] | null };
  status: { purposeAr: ContentStatus; purposeEn: ContentStatus; themesAr: ContentStatus; themesEn: ContentStatus };
  sources: readonly string[];
};

/** The sources' attribution, carried by the dataset itself. */
export type SurahPreviewSource = { id?: string; title: string; publisher: string; url: string; retrieved: string };

export type SurahPreviewDataset =
  | { status: 'official'; sources: readonly SurahPreviewSource[]; forSurah: (surah: number) => SurahPreviewEntry | null }
  | { status: 'unavailable' };

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(isText);
const isStatus = (value: unknown): value is ContentStatus => CONTENT_STATUSES.includes(value as ContentStatus);

/** Whether a section may be shown at all: its text exists exactly when its status says it does. */
export const shownStatus = (status: ContentStatus) => status !== 'unavailable';

function readEntry(raw: unknown, surah: number): SurahPreviewEntry | null {
  const e = raw as Partial<Record<keyof SurahPreviewEntry, unknown>> | null;
  if (!e || e.surah !== surah || (e.revelation !== 'makki' && e.revelation !== 'madani') || !Number.isInteger(e.ayahCount) || (e.ayahCount as number) < 3) return null;
  const purpose = e.purpose as { ar?: unknown; en?: unknown } | undefined;
  const themes = (e.themes ?? {}) as { ar?: unknown; en?: unknown };
  if (!purpose || !isText(purpose.ar) || (purpose.en !== null && !isText(purpose.en))) return null;
  if ((themes.ar ?? null) !== null && !isTextList(themes.ar)) return null;
  if ((themes.en ?? null) !== null && !isTextList(themes.en)) return null;
  const themesAr = (themes.ar as string[] | undefined) ?? null;
  const themesEn = (themes.en as string[] | undefined) ?? null;
  const purposeEn = (purpose.en as string | null) ?? null;
  // Files from before statuses existed: the Mukhtasar's purpose (quoted), nothing else.
  const given = (e.status ?? {}) as Partial<Record<keyof SurahPreviewEntry['status'], unknown>>;
  const status = {
    purposeAr: given.purposeAr ?? 'quoted',
    purposeEn: given.purposeEn ?? (purposeEn === null ? 'unavailable' : 'quoted'),
    themesAr: given.themesAr ?? (themesAr === null ? 'unavailable' : 'quoted'),
    themesEn: given.themesEn ?? (themesEn === null ? 'unavailable' : 'quoted'),
  };
  if (!Object.values(status).every(isStatus) || status.purposeAr === 'unavailable') return null;
  // A text and its status agree: present exactly when not 'unavailable'.
  const agrees = (text: unknown, st: ContentStatus) => (text === null) === (st === 'unavailable');
  if (!agrees(purposeEn, status.purposeEn as ContentStatus) || !agrees(themesAr, status.themesAr as ContentStatus) || !agrees(themesEn, status.themesEn as ContentStatus)) return null;
  const sources = Array.isArray(e.sources) && e.sources.every(isText) ? (e.sources as string[]) : [];
  return {
    surah,
    revelation: e.revelation,
    ayahCount: e.ayahCount as number,
    purpose: { ar: purpose.ar, en: purposeEn },
    themes: { ar: themesAr, en: themesEn },
    status: status as SurahPreviewEntry['status'],
    sources,
  };
}

/**
 * The dataset from the generated file's shape (format 1: `surahs[s - 1]` is Surah s's entry). Anything else, including
 * the "unavailable" placeholder the import writes when it cannot verify the source, is unavailable: never a partial or
 * guessed introduction. An entry that is not exactly as expected is left out (that Surah shows "unavailable").
 */
export function readSurahPreviewDataset(raw: unknown): SurahPreviewDataset {
  const data = raw as { format?: unknown; status?: unknown; sources?: unknown; surahs?: unknown } | null;
  if (!data || data.format !== 1 || data.status !== 'official' || !Array.isArray(data.surahs) || data.surahs.length !== 114) return { status: 'unavailable' };
  const entries = (data.surahs as unknown[]).map((entry, i) => readEntry(entry, i + 1));
  return {
    status: 'official',
    sources: Array.isArray(data.sources) ? (data.sources as SurahPreviewSource[]) : [],
    forSurah: (surah) => entries[surah - 1] ?? null,
  };
}

let loaded: SurahPreviewDataset | null = null;

/** The bundled dataset, read once (on first opening) and kept: no network, no account, no backend. */
export function surahPreviewDataset(): SurahPreviewDataset {
  if (!loaded) loaded = readSurahPreviewDataset(bundledSurahPreview());
  return loaded;
}

/** Tests only: the next use reads the bundled dataset again. */
export function resetSurahPreviewDatasetForTests() {
  loaded = null;
}

/** The Surahs whose first ayah is on this page (SURAH_START_PAGES), in order: none on most pages, three on page 604. */
export function surahsStartingOn(page: number): number[] {
  const surahs: number[] = [];
  SURAH_START_PAGES.forEach((start, i) => { if (start === page) surahs.push(i + 1); });
  return surahs;
}

/**
 * The introduction's language: the Quran Translation setting's (synced as quranLanguage), and within it the App Language where the source has that text.
 * It has one mode today, None ('quran-text', the Arabic Mushaf without a translation): the introduction is then in English for an
 * English App Language when the source's English text exists, else in Arabic (the source's own language).
 */
export function previewLanguage(entry: SurahPreviewEntry, appLocale: AppLocale, quranMode: QuranReadingMode): 'ar' | 'en' {
  if (quranMode === 'quran-text' && appLocale === 'en' && entry.purpose.en !== null) return 'en';
  return 'ar';
}
