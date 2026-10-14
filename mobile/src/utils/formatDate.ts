import type { AppLocale } from '@/localization/locales';

/** BCP-47 tags for Intl.DateTimeFormat — ar-EG intentionally gets its own Gregorian-medium formatting, distinct from `ar`'s. */
const INTL_LOCALE_TAG: Record<AppLocale, string> = {
  en: 'en-US',
  ar: 'ar',
  'ar-EG': 'ar-EG',
};

/**
 * Localized "last edited" date for a reflection's `updatedAt` timestamp
 * (epoch ms). Never throws — an Intl failure (unlikely; RN/Hermes bundles
 * full ICU) falls back to a locale-neutral ISO date rather than crashing the
 * reflections list.
 */
export function formatReflectionDate(updatedAtMs: number, locale: AppLocale): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE_TAG[locale] ?? INTL_LOCALE_TAG.en, { dateStyle: 'medium' }).format(
      new Date(updatedAtMs),
    );
  } catch {
    return new Date(updatedAtMs).toISOString().slice(0, 10);
  }
}

/**
 * A stored local civil date (YYYY-MM-DD, e.g. a Khatma's `localDate`) in the
 * same localized medium style. Formatted as that calendar day in UTC, so the
 * device's time zone can never move it to the day before or after. Never
 * throws: a malformed or unformattable value is returned as given.
 */
export function formatCivilDate(localDate: string, locale: AppLocale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return localDate;
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE_TAG[locale] ?? INTL_LOCALE_TAG.en, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
    );
  } catch {
    return localDate;
  }
}
