export interface AccountDeletionService {
  /**
   * Permanently deletes the account and every model that references its
   * userId — User, every Session (all devices, not just the current one),
   * favorites, preferences, reflections, and the wrapped sync-key/
   * encryption material. Never decrypts anything first — ciphertext and the
   * wrapped master-key blob are deleted as opaque bytes (see
   * docs/reflection-privacy.md). Idempotent: calling this again for an
   * already-deleted userId deletes nothing further and never throws.
   */
  deleteAccount(userId: string): Promise<void>;
}
