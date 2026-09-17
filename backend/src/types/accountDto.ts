import type { AuthProvider, IssueReportCategory, TranslationDisplayMode } from './accountDomain';

export type UserDto = {
  id: string;
  provider: AuthProvider;
  email?: string;
  createdAt: string;
};

export type FavoriteDto = {
  verseKey: string;
  createdAt: string;
  updatedAt: string;
};

export type PreferencesDto = {
  locale?: string;
  translationDisplayMode?: TranslationDisplayMode;
  translationId?: string;
  updatedAt: string;
};

export type ReflectionActiveRecordDto = {
  type: 'active';
  verseKey: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
};

/** A durable local deletion marker, carrying no plaintext/ciphertext/nonce — see docs/auth-and-sync/reflection-privacy.md. */
export type ReflectionTombstoneDto = {
  type: 'tombstone';
  verseKey: string;
  deletedAt: string;
};

export type ReflectionSyncRecordDto = ReflectionActiveRecordDto | ReflectionTombstoneDto;

export type ReflectionConflictDto = {
  verseKey: string;
  conflictVersions: Array<{ ciphertext: string; nonce: string; encryptionVersion: number; createdAt: string }>;
};

export type SyncKeyDto = {
  wrappedKey: string;
  nonce: string;
  salt: string;
  kdfIterations: number;
  encryptionVersion: number;
};

export type IssueReportInput = {
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
};
