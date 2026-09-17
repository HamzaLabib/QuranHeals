/**
 * Optional-account domain types (Part A–J of the auth/sync/reporting phase).
 * Deliberately kept separate from domain.ts (Quran/emotion data) — these
 * describe accounts, synced user data, and issue reports, never Quran
 * content, and must never be confused with the 1,845 approved
 * emotion-verse mappings or the Quran/translation collections.
 */

/** Mirrors the mobile app's TranslationDisplayMode (mobile/src/localization/quranTranslationPreference.ts) — kept as a plain string union here so the backend never needs to import mobile code. */
export type TranslationDisplayMode = 'always' | 'on-demand' | 'off';

export type AuthProvider = 'apple' | 'google';

/**
 * One account per (provider, providerSubject) pair. Signing in with Apple
 * and Google — even with the same email — creates two separate User
 * documents in this phase; Quran Heals does not auto-link identities by
 * email (see Part B §9), and no other linking mechanism is implemented yet.
 * `email` is recorded only when the provider actually supplied and, for
 * Google, verified it — including Apple's private-relay address, which is
 * still a usable forwarding email and is stored as-is, never rejected.
 */
export type UserEntity = {
  provider: AuthProvider;
  providerSubject: string;
  email?: string;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

/**
 * One document per signed-in device/session (multi-device auth phase) —
 * deliberately never a single refresh-token field on UserEntity, so signing
 * in on a second device creates an independent session instead of
 * overwriting/invalidating the first. `refreshTokenHash` is a sha256 hex
 * digest of the opaque refresh token the device actually holds; the
 * plaintext token itself is never stored. Revoking (logout, reuse
 * detected) sets `revokedAt`; a MongoDB TTL index on `expiresAt` (see
 * models/Session.ts) removes the document once it can no longer be used
 * regardless of whether it was ever explicitly revoked.
 */
export type SessionEntity = {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

/** A single synced favorite ayah, keyed by the stable verseKey — never a localized label or Quran text. */
export type UserFavoriteEntity = {
  userId: string;
  verseKey: string;
  createdAt?: Date;
  updatedAt?: Date;
};

/**
 * One document per user holding the durable, cross-device preferences
 * listed in Part F §26. Deliberately excludes recent-ayah history (Part F
 * §27), which stays device-local and is never uploaded.
 */
export type UserPreferenceEntity = {
  userId: string;
  locale?: string;
  translationDisplayMode?: TranslationDisplayMode;
  translationId?: string;
  updatedAt?: Date;
};

/**
 * Server-visible reflection record: ciphertext only. `encryptionVersion`
 * lets the format evolve without breaking older records still on this
 * version. Never add a plaintext/preview/summary/keyword/sentiment field
 * here — see Part D §21.
 *
 * `deleted` makes this a durable deletion tombstone instead of an active
 * record — see docs/auth-and-sync/reflection-privacy.md's "Deletion
 * tombstones" section. A tombstone row keeps `userId`/`verseKey`/`updatedAt`
 * (the single LWW timestamp field, reused as the deletion time) but never
 * has ciphertext/nonce/encryptionVersion/createdAt — those three plus
 * createdAt are only required when `deleted` is false (see
 * models/UserReflection.ts's conditional `required`). Existing documents
 * from before this field existed have `deleted` absent/undefined, which is
 * falsy — they are read back as active records unchanged, so no migration
 * is needed.
 */
export type UserReflectionEntity = {
  userId: string;
  verseKey: string;
  deleted?: boolean;
  ciphertext?: string;
  nonce?: string;
  encryptionVersion?: number;
  /**
   * Older ciphertext versions displaced by an ambiguous same-timestamp
   * conflict (Part D §29: "if timestamps are ambiguous/conflicting, keep
   * both conflict versions"). Empty in the overwhelmingly common case where
   * updatedAt strictly orders two writes. Still ciphertext-only.
   */
  conflictVersions?: Array<{ ciphertext: string; nonce: string; encryptionVersion: number; createdAt: Date }>;
  createdAt?: Date;
  updatedAt?: Date;
};

/**
 * The user's reflection master key, wrapped (encrypted) under a key derived
 * from their separate Sync Passphrase — never the plaintext key. See
 * docs/reflection-privacy.md for the full key-recovery design. One document
 * per user.
 */
export type UserSyncKeyEntity = {
  userId: string;
  wrappedKey: string;
  nonce: string;
  salt: string;
  kdfIterations: number;
  encryptionVersion: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export const ISSUE_REPORT_CATEGORIES = [
  'ayah_not_relevant',
  'quran_text_display',
  'translation_issue',
  'app_technical_issue',
  'other',
] as const;

export type IssueReportCategory = (typeof ISSUE_REPORT_CATEGORIES)[number];

export type IssueReportStatus = 'new';

/**
 * Fully separate from private reflections — see Part I §38. Never accepts
 * or stores reflection plaintext, ciphertext, or reflection-derived
 * metadata, even if a caller sends such a field; the validator only reads
 * the fields listed here.
 */
export type IssueReportEntity = {
  category: IssueReportCategory;
  comment?: string;
  email?: string;
  verseKey?: string;
  surahNumber?: number;
  ayahNumber?: number;
  emotionKey?: string;
  appLocale?: string;
  translationDisplayMode?: TranslationDisplayMode;
  appVersion?: string;
  platform?: string;
  status: IssueReportStatus;
  createdAt?: Date;
};
