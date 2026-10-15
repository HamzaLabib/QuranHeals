import { getCalendars, getLocales } from 'expo-localization';

/**
 * The device's preferred languages (BCP 47 tags, most preferred first) and its
 * 12/24-hour clock setting, from expo-localization. Read on demand, never
 * cached: only used when nothing is saved yet (localization/locales.ts's
 * resolveInitialAppLanguage) and to show reminder times (notifications/format.ts).
 * Never throws: a failure means "unknown".
 */
export function getDeviceLanguageTags(): string[] {
  try {
    return getLocales().map((locale) => locale.languageTag).filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
  } catch {
    return [];
  }
}

export function deviceUses24HourClock(): boolean | null {
  try {
    return getCalendars()[0]?.uses24hourClock ?? null;
  } catch {
    return null;
  }
}
