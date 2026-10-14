import { HIZB_QUARTER_STARTS } from './generated/hizbQuarters';
import { toArabicIndicDigits } from './mushafPage';

/**
 * Hizb and quarter-Hizb labels for the page header (Normal Mode): shown only on
 * the page that holds the start of a Hizb, or of its quarter, half or three
 * quarters — the ayah where the print has its ۞ (generated/hizbQuarters.ts,
 * from Tanzil's metadata with its one documented correction, verified against
 * Quran Foundation and the QCF V1 print). Not a running "current quarter".
 */

/** Part of a Hizb a quarter starts: 0 the Hizb itself, 1 its quarter, 2 its half, 3 its three quarters. */
const PART_PREFIX = ['', 'ربع ', 'نصف ', 'ثلاثة أرباع '] as const;

/**
 * The label for quarter 1–240, its Hizb in Arabic-Indic digits whatever the app's language (as the page number):
 * الحزب ١, ربع الحزب ١, نصف الحزب ١, ثلاثة أرباع الحزب ١, الحزب ٢ … ثلاثة أرباع الحزب ٦٠.
 */
export function hizbQuarterLabel(quarter: number): string {
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 240) throw new Error('Invalid quarter');
  const hizb = Math.floor((quarter - 1) / 4) + 1;
  return `${PART_PREFIX[(quarter - 1) % 4]}الحزب ${toArabicIndicDigits(hizb)}`;
}

const BY_PAGE = new Map<number, string[]>();
for (const [quarter, , page] of HIZB_QUARTER_STARTS) BY_PAGE.set(page, [...(BY_PAGE.get(page) ?? []), hizbQuarterLabel(quarter)]);

/** The labels of every Hizb or quarter-Hizb that starts on this page, in order (none on most pages). */
export function hizbLabelsForPage(page: number): readonly string[] {
  return BY_PAGE.get(page) ?? [];
}
