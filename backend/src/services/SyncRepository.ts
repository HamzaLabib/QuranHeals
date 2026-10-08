import type { TranslationDisplayMode } from '../types/accountDomain';
import type {
  FavoriteDto,
  FavoriteSyncRecordDto,
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
  keyFingerprint?: string;
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

export type IncomingActiveFavoriteRecord = {
  type: 'active';
  verseKey: string;
  createdAt: string;
  updatedAt: string;
};

/** A durable local-deletion marker — carries no other fields. */
export type IncomingFavoriteTombstone = {
  type: 'tombstone';
  verseKey: string;
  deletedAt: string;
};

export type IncomingFavoriteRecord = IncomingActiveFavoriteRecord | IncomingFavoriteTombstone;

/**
 * Every method is scoped by a `userId` that the caller (syncController) must
 * derive from the verified session token — never from the request body. See
 * Part B §7.
 */
export interface SyncRepository {
  /** Active favorites only — the long-standing contract pre-tombstone clients rely on. */
  listFavorites(userId: string): Promise<FavoriteDto[]>;
  /**
   * Legacy union-add (no timestamps) — used by pre-tombstone app versions
   * and the mobile app's own best-effort fire-and-forget add. Never
   * resurrects an existing tombstone or touches an existing active record:
   * `$setOnInsert` only applies when the (userId, verseKey) document doesn't
   * exist yet, so re-adding a verseKey that's already active OR already
   * tombstoned is always a complete no-op. A genuinely newer "undelete" must
   * go through `putFavorites` below, with a real client timestamp.
   */
  addFavorites(userId: string, verseKeys: string[]): Promise<FavoriteDto[]>;
  /** Legacy single-item delete (no timestamp) — writes/refreshes a deletion tombstone using the current server time, same as before but durable instead of a hard delete. */
  removeFavorite(userId: string, verseKey: string): Promise<void>;

  /** Returns both active favorites and deletion tombstones — a caller needs the tombstones too, to learn about deletions made on other devices. Never returned to pre-tombstone clients (see listFavorites). */
  listFavoriteSyncRecords(userId: string): Promise<FavoriteSyncRecordDto[]>;
  /**
   * Per-verseKey last-write-wins by timestamp (an active record's
   * `updatedAt`, or a tombstone's `deletedAt`) — mirrors putReflections,
   * minus conflict-version preservation (a favorite carries no content to
   * disagree about, so an exact tie is resolved deterministically: the
   * tombstone always wins, in either direction).
   */
  putFavorites(userId: string, records: IncomingFavoriteRecord[]): Promise<FavoriteSyncRecordDto[]>;

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
  /**
   * Read-only: the ciphertext versions preserved by exact-timestamp
   * conflicts, for active records that have any. Lets a client decrypt and
   * offer them for recovery on the device; the server never decrypts and
   * never removes them here.
   */
  listReflectionConflicts(userId: string): Promise<ReflectionConflictDto[]>;

  getSyncKey(userId: string): Promise<SyncKeyDto | null>;
  /** Create only: concurrent setup must never overwrite an existing key. */
  putSyncKey(userId: string, key: SyncKeyDto): Promise<SyncKeyDto>;
  /** Atomic compare-and-replace; null means the expected wrapper is stale. */
  replaceSyncKey(userId: string, expected: SyncKeyDto, replacement: SyncKeyDto): Promise<SyncKeyDto | null>;

  /**
   * Forgotten-password reset: deletes this user's sync key and every
   * reflection record (ciphertext and deletion markers) — nothing else
   * (never favorites, preferences, sessions, or the account). Idempotent.
   */
  resetReflectionSync(userId: string): Promise<void>;
  /** When this user's current sync key was created (null if none). */
  getSyncKeyCreatedAt(userId: string): Promise<Date | null>;
  /** Deletes this user's active reflection records NOT encrypted under the key with this fingerprint (tombstones are kept). */
  deleteReflectionsNotEncryptedWith(userId: string, keyFingerprint: string): Promise<void>;
}
