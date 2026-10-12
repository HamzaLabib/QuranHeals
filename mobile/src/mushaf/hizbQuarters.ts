import { HIZB_QUARTER_STARTS } from './generated/hizbQuarters';

/**
 * Hizb and quarter-Hizb labels for the page header (Normal Mode): shown only on
 * the page that holds the start of a Hizb, or of its quarter, half or three
 * quarters — the ayah where the print has its ۞ (generated/hizbQuarters.ts,
 * from Tanzil's metadata with its one documented correction, verified against
 * Quran Foundation and the QCF V1 print). Not a running "current quarter".
 */

/** Masculine ordinals, as the header's الجزء الأول … الثلاثون, continued to 60 (الحزب is masculine). */
export const HIZB_ORDINALS = [
  'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
  'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون',
  'الحادي والعشرون', 'الثاني والعشرون', 'الثالث والعشرون', 'الرابع والعشرون', 'الخامس والعشرون',
  'السادس والعشرون', 'السابع والعشرون', 'الثامن والعشرون', 'التاسع والعشرون', 'الثلاثون',
  'الحادي والثلاثون', 'الثاني والثلاثون', 'الثالث والثلاثون', 'الرابع والثلاثون', 'الخامس والثلاثون',
  'السادس والثلاثون', 'السابع والثلاثون', 'الثامن والثلاثون', 'التاسع والثلاثون', 'الأربعون',
  'الحادي والأربعون', 'الثاني والأربعون', 'الثالث والأربعون', 'الرابع والأربعون', 'الخامس والأربعون',
  'السادس والأربعون', 'السابع والأربعون', 'الثامن والأربعون', 'التاسع والأربعون', 'الخمسون',
  'الحادي والخمسون', 'الثاني والخمسون', 'الثالث والخمسون', 'الرابع والخمسون', 'الخامس والخمسون',
  'السادس والخمسون', 'السابع والخمسون', 'الثامن والخمسون', 'التاسع والخمسون', 'الستون',
] as const;

/** Part of a Hizb a quarter starts: 0 the Hizb itself, 1 its quarter, 2 its half, 3 its three quarters. */
const PART_PREFIX = ['', 'ربع ', 'نصف ', 'ثلاثة أرباع '] as const;

/** The label for quarter 1–240: الحزب الأول, ربع الحزب الأول, نصف الحزب الأول, ثلاثة أرباع الحزب الأول, الحزب الثاني … */
export function hizbQuarterLabel(quarter: number): string {
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 240) throw new Error('Invalid quarter');
  const hizb = Math.floor((quarter - 1) / 4) + 1;
  return `${PART_PREFIX[(quarter - 1) % 4]}الحزب ${HIZB_ORDINALS[hizb - 1]}`;
}

const BY_PAGE = new Map<number, string[]>();
for (const [quarter, , page] of HIZB_QUARTER_STARTS) BY_PAGE.set(page, [...(BY_PAGE.get(page) ?? []), hizbQuarterLabel(quarter)]);

/** The labels of every Hizb or quarter-Hizb that starts on this page, in order (none on most pages). */
export function hizbLabelsForPage(page: number): readonly string[] {
  return BY_PAGE.get(page) ?? [];
}
