import type { AudioIssueProblem, AuthProvider, IssueReportCategory, TranslationDisplayMode } from './accountDomain';

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

export type FavoriteActiveRecordDto = {
  type: 'active';
  verseKey: string;
  createdAt: string;
  updatedAt: string;
};

/** A durable local deletion marker — see docs on deletion tombstones (mirrors ReflectionTombstoneDto). */
export type FavoriteTombstoneDto = {
  type: 'tombstone';
  verseKey: string;
  deletedAt: string;
};

export type FavoriteSyncRecordDto = FavoriteActiveRecordDto | FavoriteTombstoneDto;

export type PreferencesDto = {
  locale?: string;
  translationDisplayMode?: TranslationDisplayMode;
  translationId?: string;
  quranLanguage?: string;
  emotionsLanguage?: string;
  appearance?: string;
  quranFontSize?: number;
  /** The newest of the fields' instants (what older apps compare). */
  updatedAt: string;
  /** When each stored field was last changed (services/preferencesMerge.ts). Older apps ignore it. */
  fieldUpdatedAt?: Partial<Record<'locale' | 'translationDisplayMode' | 'translationId' | 'quranLanguage' | 'emotionsLanguage' | 'appearance' | 'quranFontSize', string>>;
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
  keyFingerprint?: string;
};

type SubmissionCommon = {
  email?: string;
  appLocale?: string;
  appVersion?: string;
  platform?: string;
};

/** A reported problem. `type` is absent from app versions before feedback existed. */
export type IssueSubmissionInput = SubmissionCommon & {
  type?: 'issue';
  category: IssueReportCategory;
  comment?: string;
  source?: 'ayah' | 'settings';
  verseKey?: string;
  surahNumber?: number;
  ayahNumber?: number;
  audioProblem?: AudioIssueProblem;
  reciterId?: string;
  audioSource?: string;
  playbackContext?: string;
  translationDisplayMode?: TranslationDisplayMode;
};

/** General feedback from Home: a required message, no category and no ayah context. */
export type FeedbackSubmissionInput = SubmissionCommon & {
  type: 'feedback';
  comment: string;
  source?: 'home';
};

export type IssueReportInput = IssueSubmissionInput | FeedbackSubmissionInput;
