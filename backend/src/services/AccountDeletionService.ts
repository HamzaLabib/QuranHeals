export interface AccountDeletionService {
  /**
   * Permanently deletes the account and every model that references its
   * userId — User, every Session (all devices, not just the current one),
   * favorites, preferences, reflections, the wrapped sync-key/encryption
   * material, and any stored (encrypted) Apple refresh token. Never
   * decrypts anything first — ciphertext, the wrapped master-key blob, and
   * the Apple credential are all deleted as opaque bytes (see
   * docs/reflection-privacy.md). Idempotent: calling this again for an
   * already-deleted userId deletes nothing further and never throws.
   *
   * For an Apple-authenticated account, the caller (accountController) is
   * responsible for revoking Apple's authorization BEFORE calling this —
   * this service only ever deletes local documents, never calls Apple
   * itself (an external API call cannot be part of this Mongo transaction;
   * see auth/appleRevocationClient.ts and Part B4 §7).
   */
  deleteAccount(userId: string): Promise<void>;
}
