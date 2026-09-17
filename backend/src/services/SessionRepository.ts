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
   * returns the new pair plus the session's userId. Throws AppError(401)
   * for an unknown, expired, revoked, or already-superseded token — a
   * mismatched-but-well-formed token is treated as possible reuse and
   * revokes the session as a side effect (see MongooseSessionRepository).
   * Never affects any other session.
   */
  rotateSession(refreshToken: string): Promise<IssuedSession & { userId: string }>;

  /** Revokes only the session identified by this refresh token. A malformed/unknown token is a silent no-op — logout never leaks which tokens are valid. */
  revokeSession(refreshToken: string): Promise<void>;
}
