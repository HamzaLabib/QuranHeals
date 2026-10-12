import { SURAH_START_PAGES } from '@/mushaf/generated/surahStartPages';
import { getAllSurahNames } from '@/services/surahNames';

/**
 * The Mushaf search's Surah list: all 114 Surahs in Quran order, with the
 * page each begins on (generated from Tanzil's page table, which matches the
 * QCF V1 pages the reader draws), filtered by what the reader types.
 *
 * Matching is forgiving, never fuzzy guessing:
 * - Arabic: diacritics and tatweel ignored; أ إ آ ٱ → ا, ى → ي, ة → ه, ؤ → و,
 *   ئ → ي; a leading «سورة» ignored. So «البقره», «بقرة» and «ٱلْبَقَرَة» all
 *   find البقرة.
 * - English (Tanzil's transliterations): case, spaces, hyphens and
 *   apostrophes ignored; doubled vowels and a final "h" are spelling
 *   variants, and ee / oo read as i / u. So "baqarah", "Fatiha", "Imran",
 *   "Yasin" and "Ya-Sin" all find their Surah.
 * - A Surah number, in Western or Arabic-Indic digits.
 * An exact name comes first, then names that start with the query, then
 * names that merely contain it; otherwise Quran order is kept.
 */
export type SurahEntry = {
  surahNumber: number;
  nameArabic: string;
  nameEnglish: string;
  startPage: number;
};

export const SURAHS: readonly SurahEntry[] = getAllSurahNames().map((surah, index) => ({
  ...surah,
  startPage: SURAH_START_PAGES[index],
}));

const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

export function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/^\s*سوره\s+/, '')
    .replace(/\s+/g, '');
}

export function normalizeLatin(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/(.)\1+/g, '$1')
    .replace(/(.)h$/, '$1');
}

const toWesternDigits = (text: string) => text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

const KEYS = SURAHS.map((surah) => ({
  surah,
  arabic: normalizeArabic(surah.nameArabic),
  latin: normalizeLatin(surah.nameEnglish),
  // Without the article, for "starts with" ranking: البقرة → بقره, Al-Baqara → baqara.
  arabicBare: normalizeArabic(surah.nameArabic).replace(/^ال/, ''),
  latinBare: normalizeLatin(surah.nameEnglish.replace(/^(a[a-z]{0,2}-|aal-i-)/i, '')),
}));

export function searchSurahs(query: string): SurahEntry[] {
  const raw = query.trim();
  if (!raw) return [...SURAHS];
  const digits = toWesternDigits(raw);
  if (/^\d{1,3}$/.test(digits)) {
    const surah = SURAHS[Number(digits) - 1];
    return surah ? [surah] : [];
  }
  const arabic = normalizeArabic(raw);
  const latin = normalizeLatin(raw);
  const ranked: { surah: SurahEntry; rank: number }[] = [];
  for (const key of KEYS) {
    let rank = -1;
    if (arabic && /[\u0600-\u06FF]/.test(arabic)) {
      if (key.arabic === arabic || key.arabicBare === arabic) rank = 0;
      else if (key.arabic.startsWith(arabic) || key.arabicBare.startsWith(arabic)) rank = 1;
      else if (key.arabic.includes(arabic)) rank = 2;
    }
    if (rank < 0 && latin) {
      if (key.latin === latin || key.latinBare === latin) rank = 0;
      else if (key.latin.startsWith(latin) || key.latinBare.startsWith(latin)) rank = 1;
      else if (key.latin.includes(latin)) rank = 2;
    }
    if (rank >= 0) ranked.push({ surah: key.surah, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.surah.surahNumber - b.surah.surahNumber).map((entry) => entry.surah);
}
