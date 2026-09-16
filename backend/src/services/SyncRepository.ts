import type { TranslationDisplayMode } from '../types/accountDomain';
import type {
  FavoriteDto,
  PreferencesDto,
  ReflectionConflictDto,
  ReflectionRecordDto,
  SyncKeyDto,
} from '../types/accountDto';

export type IncomingReflection = {
  verseKey: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type PutReflectionsResult = {
  saved: ReflectionRecordDto[];
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

  listReflections(userId: string): Promise<ReflectionRecordDto[]>;
  /** Per-verseKey last-write-wins by updatedAt; an exact-timestamp/different-ciphertext tie is preserved as a conflict, never silently dropped. See Part D §29. */
  putReflections(userId: string, records: IncomingReflection[]): Promise<PutReflectionsResult>;

  getSyncKey(userId: string): Promise<SyncKeyDto | null>;
  /** Set-once in normal operation (the mobile client only calls this the first time a device establishes the sync key); overwriting is allowed at the repository level but the controller never does so once a key already exists, to avoid silently orphaning devices that already unwrapped the old one. */
  putSyncKey(
    userId: string,
    key: { wrappedKey: string; nonce: string; salt: string; kdfIterations: number; encryptionVersion: number },
  ): Promise<SyncKeyDto>;
}
