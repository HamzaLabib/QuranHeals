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
 *
 * Older records and older apps:
 *  - A record stored before per-field instants existed has only `updatedAt`:
 *    each of its stored fields counts as changed at that instant. The first
 *    write after that stores every field's instant explicitly, so the
 *    fields it did not touch keep their original instant.
 *  - An older app sends one `updatedAt` for its three fields: it is used as
 *    each field's instant, which is exactly what it meant.
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
] as const;
export type PreferenceField = (typeof PREFERENCE_FIELDS)[number];

export type PreferenceValues = {
  locale?: string;
  translationDisplayMode?: TranslationDisplayMode;
  translationId?: string;
  quranLanguage?: string;
  emotionsLanguage?: string;
  appearance?: string;
  quranFontSize?: number;
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
    const incoming = fieldUpdatedAt[field] ?? clientUpdatedAt;
    const stored = next.fieldUpdatedAt![field] ?? null;
    if (stored !== null && incoming.getTime() <= stored.getTime()) continue;
    (next as Record<string, unknown>)[field] = input[field];
    next.fieldUpdatedAt![field] = incoming;
    if (incoming.getTime() > next.updatedAt.getTime()) next.updatedAt = incoming;
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
