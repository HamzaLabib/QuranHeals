import { fill } from '@/localization/fill';
import type { Messages } from '@/localization/messages';
import { getSurahName } from '@/services/surahNames';

import type { AyahPosition } from './quranSequence';
import { reciterCoverage, type Reciter } from './reciters';

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

/** A reciter's coverage, as listed under its name. */
export function coverageLabel(reciter: Reciter, copy: Messages['audio'], rtl: boolean): string {
  const coverage = reciterCoverage(reciter);
  if (coverage.kind === 'complete') return copy.coverageComplete;
  if (coverage.kind === 'none') return copy.coverageNone;
  return fill(copy.coveragePartial, { n: localDigits(coverage.timed, rtl) });
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
