/**
 * Stores/retrieves the Apple refresh token account deletion needs to
 * revoke this app's Apple authorization for a user (see
 * auth/appleRevocationClient.ts). Every method is scoped by a `userId`
 * the caller must derive from a verified session — never from a
 * client-supplied value. The plaintext refresh token is never exposed
 * beyond this repository's own `get`.
 */
export interface AppleCredentialRepository {
  /** Upserts — a fresh exchange always replaces whatever was stored before. */
  save(userId: string, refreshToken: string): Promise<void>;
  /** The decrypted refresh token for this user, or null if none is stored. */
  get(userId: string): Promise<string | null>;
  /** Idempotent — deleting a non-existent credential is a no-op, never an error. */
  delete(userId: string): Promise<void>;
}
