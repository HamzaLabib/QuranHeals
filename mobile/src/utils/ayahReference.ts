import { getSurahName } from '@/services/surahNames';

/**
 * The one shared "Surah reference" format used everywhere an ayah's
 * location is displayed — emotion-selected ayahs, the general Quran flow,
 * "Another ayah" results, favorites, and the share text, all funnel through
 * this instead of each building their own string:
 *
 *   English Surah name · Surah:Ayah · Arabic Surah name
 *
 * e.g. "Al-Baqara · 2:286 · البقرة"
 *
 * This exact order is fixed in every app language (English, Arabic,
 * Egyptian Arabic) — it is never reversed for RTL locales. The Surah/Ayah
 * number always uses plain Western/Latin digits (template-literal number
 * interpolation, never `toLocaleString()` or any other locale-aware
 * formatting that could substitute Arabic-Indic digits).
 *
 * Both names come from the local, verified 114-surah mapping
 * (services/surahNames.ts) — resolved from `surahNumber` alone, never from
 * a network-provided `surahNameEnglish`/`surahNameArabic` field — so this is
 * correct even fully offline and identical regardless of which flow
 * produced the ayah.
 */
export function formatAyahReference(surahNumber: number, ayahNumber: number): string {
  const { nameEnglish, nameArabic } = getSurahName(surahNumber);
  return `${nameEnglish} · ${surahNumber}:${ayahNumber} · ${nameArabic}`;
}
