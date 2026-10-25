import { fill } from '@/localization/fill';
import type { Messages } from '@/localization/messages';
import { getSurahName } from '@/services/surahNames';

import type { AyahPosition } from './quranSequence';
import type { Reciter } from './reciters';
import { audioCoverage } from './availability';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const localDigits = (text: string | number, rtl: boolean) => (rtl ? String(text).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]) : String(text));

/** "1.4 GB" / "86 MB" (Arabic digits and unit names in Arabic). */
export function formatBytes(bytes: number, copy: Messages['audio'], rtl: boolean): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) {
    const gb = Math.round((mb / 1024) * 10) / 10;
    return fill(copy.gigabytes, { n: localDigits(rtl ? String(gb).replace('.', '٫') : gb, rtl) });
  }
  return fill(copy.megabytes, { n: localDigits(Math.max(1, Math.round(mb)), rtl) });
}

/** "Al-Baqara · Ayah 255" / «البقرة · الآية ٢٥٥». */
export function ayahLabel(position: AyahPosition, copy: Messages['audio'], rtl: boolean): string {
  const name = getSurahName(position.surah);
  return fill(copy.ayahPosition, { surah: rtl ? name.nameArabic : name.nameEnglish, ayah: localDigits(position.ayah, rtl) });
}

export const surahLabel = (surah: number, rtl: boolean) => (rtl ? getSurahName(surah).nameArabic : getSurahName(surah).nameEnglish);

/** A reciter's coverage, as listed under its name; null for all 114 surahs (owner, 2026-10-24: no count shown). */
export function coverageLabel(reciter: Reciter, copy: Messages['audio'], rtl: boolean): string | null {
  const count = coverageCount(reciter, copy, rtl);
  // A per-ayah recording on trial (development builds only) says so before its coverage.
  // So does a reciter with surahs from the review dashboard's accepted aligned timing (reviewedPreviewSurahs).
  // Released timing (generated/timingRelease.ts) is not a preview and is never labelled one.
  if ((reciter.perAyah && !reciter.perAyah.released) || (reciter.timedPreview && !reciter.timedPreview.released) || reciter.reviewedPreviewSurahs?.length) return count ? `${copy.developmentPreview} · ${count}` : copy.developmentPreview;
  return count;
}

function coverageCount(reciter: Reciter, copy: Messages['audio'], rtl: boolean): string | null {
  // What the reciter's own recordings can play, from the source registry (for the audited catalogue: exactly
  // reciterCoverage's counts); never surahs the default reciter plays in its place. Phase 4.8.3: published
  // human-verified surahs included (availability.ts).
  const { ayah, surah: whole } = audioCoverage(reciter.id);
  if (ayah.length === 114) return null;
  // Surahs it can play only whole (approved whole-surah recordings): counted apart, never as ayah playback.
  if (whole.length > 0) return fill(copy.coveragePartialWhole, { n: localDigits(ayah.length, rtl), m: localDigits(whole.length, rtl) });
  if (ayah.length === 0) return copy.coverageNone;
  return fill(copy.coveragePartial, { n: localDigits(ayah.length, rtl) });
}

/** Surah numbers as compact ranges: "9, 52–53, 55–57". */
export function surahRanges(surahs: readonly number[], rtl: boolean): string {
  const sorted = [...surahs].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${localDigits(sorted[i], rtl)}–${localDigits(sorted[j], rtl)}` : localDigits(sorted[i], rtl));
    i = j;
  }
  return parts.join(rtl ? '، ' : ', ');
}

/** A place or length in a recording: "4:05", "1:02:09" (Arabic digits in Arabic). */
export function formatClock(ms: number, rtl: boolean): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return localDigits(h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`, rtl);
}
