import { isEmotionsLanguage, type EmotionsLanguage } from '@/localization/emotionsLanguage';
import { isQuranReadingMode, type QuranReadingMode } from '@/localization/quranLanguage';
import { isValidQuranFontSize } from '@/localization/quranFontSizePreference';
import type { AppLocale } from '@/localization/locales';
import type { TranslationDisplayMode } from '@/localization/quranTranslationPreference';
import { isValidAppearanceMode, type AppearanceMode } from '@/theme/appearancePreference';

import type { PreferencesRecord } from './syncApi';

/**
 * The settings that follow the signed-in account (docs/auth-and-sync/data-behavior.md),
 * each synced on its own with its own "changed at" instant
 * (backend/src/services/preferencesMerge.ts).
 *
 * Deliberately NOT here — they stay on the device: notification
 * preferences and schedules (the device schedules them), Keep Screen
 * Awake, offline Mushaf download, the Mushaf guide, the Show Translation
 * dropdown's kept choice (`enabledMode`), and the last browsed Mushaf page.
 */
export const SYNCED_PREFERENCE_FIELDS = [
  'locale',
  'translationDisplayMode',
  'translationId',
  'quranLanguage',
  'emotionsLanguage',
  'appearance',
  'quranFontSize',
] as const;
export type SyncedPreferenceField = (typeof SYNCED_PREFERENCE_FIELDS)[number];

export type SyncedPreferenceValues = {
  /** 'ar-EG' only ever arrives from an older device (useAppLocale.tsx migrates it). */
  locale: AppLocale;
  translationDisplayMode: TranslationDisplayMode;
  translationId: string;
  quranLanguage: QuranReadingMode;
  emotionsLanguage: EmotionsLanguage;
  appearance: AppearanceMode;
  quranFontSize: number;
};
export type SyncedPreferenceValue = SyncedPreferenceValues[SyncedPreferenceField];

const VALIDATORS: { [F in SyncedPreferenceField]: (value: unknown) => value is SyncedPreferenceValues[F] } = {
  locale: (value): value is AppLocale => value === 'en' || value === 'ar' || value === 'ar-EG',
  translationDisplayMode: (value): value is TranslationDisplayMode => value === 'always' || value === 'on-demand' || value === 'off',
  translationId: (value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80,
  quranLanguage: isQuranReadingMode,
  emotionsLanguage: isEmotionsLanguage,
  appearance: isValidAppearanceMode,
  quranFontSize: isValidQuranFontSize,
};

/** Whether `value` is one this app version can apply for `field` (an unknown future value never is). */
export function isSyncedPreferenceValue<F extends SyncedPreferenceField>(field: F, value: unknown): value is SyncedPreferenceValues[F] {
  return VALIDATORS[field](value);
}

export type CloudPreferenceField = { value: SyncedPreferenceValue; at: number };

/**
 * The account's fields this app can apply, each with the instant it was
 * last changed. A server from before per-field instants sends none: each
 * present field then counts as changed at the record's `updatedAt`.
 * Unreadable or unknown values are left out (never applied, never
 * overwritten from here on the strength of a guess).
 */
export function parseCloudPreferences(record: PreferencesRecord | null | undefined): Partial<Record<SyncedPreferenceField, CloudPreferenceField>> {
  const out: Partial<Record<SyncedPreferenceField, CloudPreferenceField>> = {};
  if (!record || typeof record !== 'object') return out;
  const recordAt = Date.parse(record.updatedAt);
  for (const field of SYNCED_PREFERENCE_FIELDS) {
    const value = (record as Record<string, unknown>)[field];
    if (!isSyncedPreferenceValue(field, value)) continue;
    const own = record.fieldUpdatedAt?.[field];
    const at = typeof own === 'string' ? Date.parse(own) : recordAt;
    if (!Number.isFinite(at)) continue;
    out[field] = { value, at };
  }
  return out;
}
