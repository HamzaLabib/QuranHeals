import { isEmotionsLanguage, type EmotionsLanguage } from '@/localization/emotionsLanguage';
import { isQuranReadingMode, type QuranReadingMode } from '@/localization/quranLanguage';
import { isValidQuranFontSize } from '@/localization/quranFontSizePreference';
import type { AppLocale } from '@/localization/locales';
import type { EnabledTranslationMode, TranslationDisplayMode } from '@/localization/quranTranslationPreference';
import type { RecentEmotionUse } from '@/storage/recentEmotions';
import { isValidAppearanceMode, type AppearanceMode } from '@/theme/appearancePreference';

import type { PreferencesRecord } from './syncApi';

/**
 * The settings that follow the signed-in account (docs/auth-and-sync/data-behavior.md),
 * each synced on its own with its own "changed at" instant
 * (backend/src/services/preferencesMerge.ts): the newest change wins.
 * Home's recent emotions follow the account too, merged as a history
 * instead (RECENT_EMOTIONS_FIELD below; storage/recentEmotions.ts).
 *
 * Deliberately NOT here — they stay on the device: OS notification
 * permission (each device asks for its own: the reminders' settings sync,
 * a device without permission simply schedules nothing), offline Mushaf
 * and recitation downloads, a guide's step in progress, and the last
 * browsed Mushaf page.
 */
export const SYNCED_PREFERENCE_FIELDS = [
  'locale',
  'translationDisplayMode',
  'translationId',
  'quranLanguage',
  'emotionsLanguage',
  'appearance',
  'quranFontSize',
  // Added 2026-10-27. After translationDisplayMode: the dropdown's kept choice is applied once the switch is known.
  'translationEnabledMode',
  'favoriteReciter',
  'keepAwake',
  'wordMeaningsVisible',
  'memorizationModeVisible',
  'notificationWird',
  'notificationRandomAyah',
  'notificationEmotionCheckIn',
  'mushafGuide',
  'memorizationGuide',
] as const;
export type SyncedPreferenceField = (typeof SYNCED_PREFERENCE_FIELDS)[number];

/** One reminder in the stored form both the app and the account keep (notifications/preferences.ts). */
export type SyncedReminder = {
  enabled: boolean;
  frequency: 'daily' | 'every3days' | 'weekly' | 'twiceDaily';
  time: string;
  weekday: number | null;
  anchor: string | null;
  twice?: { morning: string; evening: string };
};

export type SyncedPreferenceValues = {
  /** 'ar-EG' only ever arrives from an older device (useAppLocale.tsx migrates it). */
  locale: AppLocale;
  translationDisplayMode: TranslationDisplayMode;
  translationId: string;
  quranLanguage: QuranReadingMode;
  emotionsLanguage: EmotionsLanguage;
  appearance: AppearanceMode;
  quranFontSize: number;
  translationEnabledMode: EnabledTranslationMode;
  /** A reciter id; one this app version does not list is never applied (audio/useFavoriteReciter.tsx). */
  favoriteReciter: string;
  keepAwake: boolean;
  wordMeaningsVisible: boolean;
  memorizationModeVisible: boolean;
  notificationWird: SyncedReminder;
  notificationRandomAyah: SyncedReminder;
  notificationEmotionCheckIn: SyncedReminder;
  /** The Mushaf guide closed early, or finished (which also hides the reader's Help icon). Never goes back. */
  mushafGuide: 'closed' | 'finished';
  /** The Memorization Mode Guide's first-time showing is over. */
  memorizationGuide: 'done';
};
export type SyncedPreferenceValue = SyncedPreferenceValues[SyncedPreferenceField];

const STORED_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A reminder in stored form; Twice Daily (and its two times) only for the Emotional Check-in. */
function isReminder(value: unknown, twiceDaily: boolean): value is SyncedReminder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const frequencies = twiceDaily ? ['daily', 'every3days', 'weekly', 'twiceDaily'] : ['daily', 'every3days', 'weekly'];
  if (typeof r.enabled !== 'boolean' || typeof r.frequency !== 'string' || !frequencies.includes(r.frequency)) return false;
  if (typeof r.time !== 'string' || !STORED_TIME.test(r.time)) return false;
  if (r.weekday !== null && !(Number.isInteger(r.weekday) && (r.weekday as number) >= 1 && (r.weekday as number) <= 7)) return false;
  if (r.anchor !== null && !(typeof r.anchor === 'string' && CIVIL_DATE.test(r.anchor))) return false;
  if (r.twice === undefined) return true;
  if (!twiceDaily || !r.twice || typeof r.twice !== 'object') return false;
  const { morning, evening } = r.twice as Record<string, unknown>;
  return typeof morning === 'string' && STORED_TIME.test(morning) && typeof evening === 'string' && STORED_TIME.test(evening) && morning !== evening;
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const VALIDATORS: { [F in SyncedPreferenceField]: (value: unknown) => value is SyncedPreferenceValues[F] } = {
  locale: (value): value is AppLocale => value === 'en' || value === 'ar' || value === 'ar-EG',
  translationDisplayMode: (value): value is TranslationDisplayMode => value === 'always' || value === 'on-demand' || value === 'off',
  translationId: (value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80,
  quranLanguage: isQuranReadingMode,
  emotionsLanguage: isEmotionsLanguage,
  appearance: isValidAppearanceMode,
  quranFontSize: isValidQuranFontSize,
  translationEnabledMode: (value): value is EnabledTranslationMode => value === 'always' || value === 'on-demand',
  // The form only: whether this app version lists it is checked where it is applied.
  favoriteReciter: (value): value is string => typeof value === 'string' && /^[a-z0-9-]{1,60}$/.test(value),
  keepAwake: isBoolean,
  wordMeaningsVisible: isBoolean,
  memorizationModeVisible: isBoolean,
  notificationWird: (value): value is SyncedReminder => isReminder(value, false),
  notificationRandomAyah: (value): value is SyncedReminder => isReminder(value, false),
  notificationEmotionCheckIn: (value): value is SyncedReminder => isReminder(value, true),
  mushafGuide: (value): value is 'closed' | 'finished' => value === 'closed' || value === 'finished',
  memorizationGuide: (value): value is 'done' => value === 'done',
};

/** Whether `value` is one this app version can apply for `field` (an unknown future value never is). */
export function isSyncedPreferenceValue<F extends SyncedPreferenceField>(field: F, value: unknown): value is SyncedPreferenceValues[F] {
  return VALIDATORS[field](value);
}

/** The same setting value, whatever the key order an object came back in (a reminder from the account). */
export function samePreferenceValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export type CloudPreferenceField = { value: SyncedPreferenceValue; at: number };

/**
 * The account's fields this app can apply, each with the instant it was
 * last changed. A server from before per-field instants sends none: each
 * present field then counts as changed at the record's `updatedAt`.
 * Unreadable or unknown values are left out (never applied, never
 * overwritten from here on the strength of a guess), and so is a field the
 * account never stored — a default is never applied from the account.
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

// ── Home's recent emotions: a history merged across devices ──────────────

export const RECENT_EMOTIONS_FIELD = 'recentEmotions';

const EMOTION_KEY = /^[A-Za-z0-9_-]{1,100}$/;

/** The account's recent emotions, or null when it holds none (or a server that does not know them). Unreadable entries are left out. */
export function parseCloudRecentEmotions(record: PreferencesRecord | null | undefined): RecentEmotionUse[] | null {
  const raw = record && typeof record === 'object' ? (record as Record<string, unknown>)[RECENT_EMOTIONS_FIELD] : undefined;
  if (!Array.isArray(raw)) return null;
  const out: RecentEmotionUse[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, at } = entry as { key?: unknown; at?: unknown };
    const instant = typeof at === 'string' ? Date.parse(at) : Number.NaN;
    if (typeof key === 'string' && EMOTION_KEY.test(key) && Number.isFinite(instant)) out.push({ key, at: instant });
  }
  return out;
}
