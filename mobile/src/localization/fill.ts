import { toArabicIndicDigits } from '@/mushaf/mushafPage';

import { isRtlLocale, type AppLocale } from './locales';

/** A number in the app language's digits (Arabic-Indic in Arabic, as the Mushaf reader shows them). */
export function localNumber(locale: AppLocale, n: number): string {
  return isRtlLocale(locale) ? toArabicIndicDigits(n) : String(n);
}

/** Replaces each `{name}` in a message with its value; a missing value leaves the placeholder visible. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
