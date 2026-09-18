import type { TranslationDisplayMode } from '../types/accountDomain';
import type {
  FavoriteDto,
  PreferencesDto,
  ReflectionConflictDto,
  ReflectionSyncRecordDto,
  SyncKeyDto,
} from '../types/accountDto';

export type IncomingActiveReflectionRecord = {
  type: 'active';
  verseKey: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
};

/** A durable local-deletion marker — carries no ciphertext/nonce/plaintext. See docs/auth-and-sync/reflection-privacy.md. */
export type IncomingReflectionTombstone = {
  type: 'tombstone';
  verseKey: string;
  deletedAt: string;
};

export type IncomingReflectionRecord = IncomingActiveReflectionRecord | IncomingReflectionTombstone;

export type PutReflectionsResult = {
  saved: ReflectionSyncRecordDto[];
  conflicts: ReflectionConflictDto[];
};

/**
 * Every method is scoped by a `userId` that the caller (syncController) must
 * derive from the verified session token — never from the request body. See
 * Part B §7.
 */
export interface SyncRepository {
  listFavorites(userId: string): Promise<FavoriteDto[]>;
  /** Union-add only — never removes a favorite the caller didn't list. See Part E §25/§30. */
  addFavorites(userId: string, verseKeys: string[]): Promise<FavoriteDto[]>;
  removeFavorite(userId: string, verseKey: string): Promise<void>;

  getPreferences(userId: string): Promise<PreferencesDto | null>;
  /**
   * Last-write-wins by `clientUpdatedAt` vs. the stored `updatedAt` (Part F
   * §31): if the incoming preference is not newer than what's stored, the
   * stored value is returned unchanged rather than overwritten.
   */
  putPreferences(
    userId: string,
    input: { locale?: string; translationDisplayMode?: TranslationDisplayMode; translationId?: string },
    clientUpdatedAt: string,
  ): Promise<PreferencesDto>;

  /** Returns both active records and deletion tombstones — a caller needs the tombstones too, to learn about deletions made on other devices. */
  listReflections(userId: string): Promise<ReflectionSyncRecordDto[]>;
  /**
   * Per-verseKey last-write-wins by timestamp (an active record's
   * `updatedAt`, or a tombstone's `deletedAt`) — a newer tombstone defeats an
   * older active record and vice versa. An exact-timestamp/different-
   * ciphertext tie between two active records is preserved as a conflict,
   * never silently dropped (Part D §29); an exact tie between an active
   * record and a tombstone never flips state either way — see
   * MongooseSyncRepository.putReflections.
   */
  putReflections(userId: string, records: IncomingReflectionRecord[]): Promise<PutReflectionsResult>;

  getSyncKey(userId: string): Promise<SyncKeyDto | null>;
  /** Create only: concurrent setup must never overwrite an existing key. */
  putSyncKey(
    userId: string,
    key: { wrappedKey: string; nonce: string; salt: string; kdfIterations: number; encryptionVersion: number },
  ): Promise<SyncKeyDto>;
  /** Atomic compare-and-replace; null means the expected wrapper is stale. */
  replaceSyncKey(userId: string, expected: SyncKeyDto, replacement: SyncKeyDto): Promise<SyncKeyDto | null>;
}
