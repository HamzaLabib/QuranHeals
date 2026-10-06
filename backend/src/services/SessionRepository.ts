export type IssuedSession = {
  sessionId: string;
  refreshToken: string;
};

export interface SessionRepository {
  /** A brand-new, independent session — never touches any other session belonging to this user. */
  createSession(userId: string): Promise<IssuedSession>;

  /**
   * Validates the presented refresh token against its session, rotates it
   * (a new refresh token replaces the old one, extending expiry), and
   * returns the new pair plus the session's userId. The immediately
   * previous token, presented again within a short grace window, is
   * answered with the same current token (a lost-response retry). Throws
   * AppError(401) for an unknown, expired, or revoked session; any other
   * superseded token is treated as possible reuse and revokes the session
   * as a side effect. See auth/refreshRotation.ts. Never affects any other
   * session.
   */
  rotateSession(refreshToken: string): Promise<IssuedSession & { userId: string }>;

  /** Revokes only the session identified by this refresh token. A malformed/unknown token is a silent no-op — logout never leaks which tokens are valid. */
  revokeSession(refreshToken: string): Promise<void>;

  /**
   * Whether this session currently authorizes requests: it exists, is
   * owned by `userId`, is not revoked, and has not expired. This is what
   * makes an access token's authority DB-checked rather than purely
   * cryptographic — requireAuth calls this on every request so logout,
   * server-side revocation, and account deletion take effect immediately
   * instead of waiting out the access token's own short expiry. A
   * malformed/unknown sessionId (including one naming a different user)
   * returns false rather than throwing.
   */
  isSessionActive(sessionId: string, userId: string): Promise<boolean>;
}
