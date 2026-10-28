import type { TranslationDisplayMode } from '../types/accountDomain';
import type { PreferencesDto } from '../types/accountDto';

/**
 * Account preferences, merged field by field (docs/auth-and-sync/data-behavior.md).
 * Pure functions shared by MongooseSyncRepository (production) and the
 * in-memory test repository, so the two can never disagree.
 *
 * Each synced setting has its own "changed at" instant (`fieldUpdatedAt`),
 * declared by the device that changed it. An incoming value replaces the
 * stored one only when it is strictly newer than that field's own instant,
 * so two devices changing two different settings never undo each other.
 * Two fields merge differently (mergeField):
 *  - `mushafGuide` only ever moves forward ('closed' → 'finished'): a
 *    device that closed the guide early never undoes another's finish.
 *  - `recentEmotions` is a history, not a choice: the account keeps the
 *    union of every device's entries (one per emotion, its latest use),
 *    most recent first, at most RECENT_EMOTIONS_LIMIT.
 *
 * Older records and older apps:
 *  - A record stored before per-field instants existed has only `updatedAt`:
 *    each of its stored fields counts as changed at that instant. The first
 *    write after that stores every field's instant explicitly, so the
 *    fields it did not touch keep their original instant.
 *  - An older app sends one `updatedAt` for its three fields: it is used as
 *    each field's instant, which is exactly what it meant.
 *  - An app that does not know a newer field never sends it, so a write
 *    from it keeps that field exactly as stored.
 *  - `updatedAt` stays the newest instant of any field, so an older app's
 *    whole-record comparison keeps working.
 */
export const PREFERENCE_FIELDS = [
  'locale',
  'translationDisplayMode',
  'translationId',
  'quranLanguage',
  'emotionsLanguage',
  'appearance',
  'quranFontSize',
  // Added 2026-10-27 (validated by syncValidators.ts).
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
  'recentEmotions',
] as const;
export type PreferenceField = (typeof PREFERENCE_FIELDS)[number];

/** One reminder's settings, in the app's own stored form (mobile/src/notifications/preferences.ts). */
export type ReminderPreferenceValue = {
  enabled: boolean;
  frequency: string;
  time: string;
  weekday: number | null;
  anchor: string | null;
  twice?: { morning: string; evening: string };
};
/** One emotion's latest use: `at` is an ISO instant. */
export type RecentEmotionEntry = { key: string; at: string };

/** Mirrors mobile/src/storage/recentEmotions.ts KEEP. */
export const RECENT_EMOTIONS_LIMIT = 12;

export type PreferenceValues = {
  locale?: string;
  translationDisplayMode?: TranslationDisplayMode;
  translationId?: string;
  quranLanguage?: string;
  emotionsLanguage?: string;
  appearance?: string;
  quranFontSize?: number;
  translationEnabledMode?: string;
  favoriteReciter?: string;
  keepAwake?: boolean;
  wordMeaningsVisible?: boolean;
  memorizationModeVisible?: boolean;
  notificationWird?: ReminderPreferenceValue;
  notificationRandomAyah?: ReminderPreferenceValue;
  notificationEmotionCheckIn?: ReminderPreferenceValue;
  mushafGuide?: 'closed' | 'finished';
  memorizationGuide?: 'done';
  recentEmotions?: RecentEmotionEntry[];
};

export type FieldInstants = Partial<Record<PreferenceField, Date>>;

export type StoredPreferences = PreferenceValues & {
  updatedAt: Date;
  fieldUpdatedAt?: FieldInstants;
};

function hasValue(values: PreferenceValues, field: PreferenceField): boolean {
  return values[field] !== undefined && values[field] !== null;
}

/** When `field` was last changed on the account, or null if it holds no value. */
export function fieldInstant(stored: StoredPreferences, field: PreferenceField): Date | null {
  if (!hasValue(stored, field)) return null;
  return stored.fieldUpdatedAt?.[field] ?? stored.updatedAt;
}

/** The union of two histories: one entry per emotion (its latest use), most recent first, at most the limit. */
export function mergeRecentEmotions(a: readonly RecentEmotionEntry[], b: readonly RecentEmotionEntry[]): RecentEmotionEntry[] {
  const latest = new Map<string, RecentEmotionEntry>();
  for (const entry of [...a, ...b]) {
    const known = latest.get(entry.key);
    if (!known || Date.parse(entry.at) > Date.parse(known.at)) latest.set(entry.key, { key: entry.key, at: new Date(entry.at).toISOString() });
  }
  return [...latest.values()]
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
    .slice(0, RECENT_EMOTIONS_LIMIT);
}

const sameRecent = (a: readonly RecentEmotionEntry[], b: readonly RecentEmotionEntry[]) =>
  a.length === b.length && a.every((entry, index) => entry.key === b[index].key && Date.parse(entry.at) === Date.parse(b[index].at));

const GUIDE_RANK = { closed: 1, finished: 2 } as const;

/**
 * The field's value and instant after `incoming` (at `incomingAt`) meets
 * what is stored, or null when nothing changes.
 */
function mergeField(
  field: PreferenceField,
  stored: { value: unknown; at: Date } | null,
  incoming: unknown,
  incomingAt: Date,
): { value: unknown; at: Date } | null {
  if (field === 'recentEmotions') {
    const before = (stored?.value as RecentEmotionEntry[] | undefined) ?? [];
    const merged = mergeRecentEmotions(before, incoming as RecentEmotionEntry[]);
    if (stored && sameRecent(merged, before)) return null;
    return { value: merged, at: stored && stored.at.getTime() > incomingAt.getTime() ? stored.at : incomingAt };
  }
  if (field === 'mushafGuide' && stored) {
    const before = GUIDE_RANK[stored.value as keyof typeof GUIDE_RANK] ?? 0;
    const after = GUIDE_RANK[incoming as keyof typeof GUIDE_RANK] ?? 0;
    // Forward only: a later 'closed' never replaces 'finished'; 'finished' always replaces 'closed'.
    if (after < before || (after === before && incomingAt.getTime() <= stored.at.getTime())) return null;
    return { value: incoming, at: incomingAt.getTime() > stored.at.getTime() ? incomingAt : stored.at };
  }
  if (stored !== null && incomingAt.getTime() <= stored.at.getTime()) return null;
  return { value: incoming, at: incomingAt };
}

/**
 * The record after applying `input`, or null when nothing in it is newer
 * than what is stored (the stored record is then returned unchanged).
 * `fieldUpdatedAt` gives each incoming field its own instant; a field
 * without one uses `clientUpdatedAt` (older apps).
 */
export function mergePreferences(
  existing: StoredPreferences | null,
  input: PreferenceValues,
  clientUpdatedAt: Date,
  fieldUpdatedAt: FieldInstants = {},
): StoredPreferences | null {
  const next: StoredPreferences = { updatedAt: existing?.updatedAt ?? new Date(0), fieldUpdatedAt: {} };
  // Every stored field keeps its own instant explicitly from now on.
  for (const field of PREFERENCE_FIELDS) {
    if (!existing) break;
    const at = fieldInstant(existing, field);
    if (at === null) continue;
    (next as Record<string, unknown>)[field] = existing[field];
    next.fieldUpdatedAt![field] = at;
  }

  let changed = false;
  for (const field of PREFERENCE_FIELDS) {
    if (!hasValue(input, field)) continue;
    const storedAt = next.fieldUpdatedAt![field] ?? null;
    const stored = storedAt === null ? null : { value: (next as Record<string, unknown>)[field], at: storedAt };
    const merged = mergeField(field, stored, input[field], fieldUpdatedAt[field] ?? clientUpdatedAt);
    if (!merged) continue;
    (next as Record<string, unknown>)[field] = merged.value;
    next.fieldUpdatedAt![field] = merged.at;
    if (merged.at.getTime() > next.updatedAt.getTime()) next.updatedAt = merged.at;
    changed = true;
  }
  return changed ? next : null;
}

export function toPreferencesDto(stored: StoredPreferences): PreferencesDto {
  const dto: PreferencesDto = { updatedAt: stored.updatedAt.toISOString(), fieldUpdatedAt: {} };
  for (const field of PREFERENCE_FIELDS) {
    const at = fieldInstant(stored, field);
    if (at === null) continue;
    (dto as Record<string, unknown>)[field] = stored[field];
    dto.fieldUpdatedAt![field] = at.toISOString();
  }
  return dto;
}
