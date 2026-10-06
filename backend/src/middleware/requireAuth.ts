import type { NextFunction, Request, Response } from 'express';

import { verifySessionToken } from '../auth/session';
import { AppError } from '../errors/AppError';
import type { SessionRepository } from '../services/SessionRepository';
import type { UserRepository } from '../services/UserRepository';

export type AuthenticatedRequest = Request & { auth: { userId: string } };

const BEARER_PREFIX = 'Bearer ';

export type RequireAuthDeps = {
  sessionRepository: SessionRepository;
  userRepository: UserRepository;
};

/**
 * The only place a request's userId is ever established for an authenticated
 * route. Always derived from a verified session token in the Authorization
 * header — a request body's own `userId` field (if any) is never read for
 * this purpose. See Part B §7: "Never trust { userId: '123' } simply
 * because the mobile client sent it."
 *
 * Beyond the JWT's signature and expiry, this is authoritative: it also
 * re-checks, on every request, that the session the token names (`sid`) is
 * still active (exists, not revoked, not expired, owned by that same
 * userId) and that the user still exists — so a logout, a server-side
 * session revocation, or an account deletion takes effect immediately on
 * the next request, rather than only once the access token's own ~20-minute
 * expiry is reached. A token issued before the multi-device auth phase
 * carries no `sid` at all (see SessionPayload's doc comment) — that case
 * skips only the session-liveness check, never the user-existence one.
 *
 * Every failure (missing header, invalid JWT, revoked/missing session,
 * session/user mismatch, missing user) returns the same generic 401 — never
 * a distinguishable reason, so a request can't be used to probe which of
 * those is true.
 */
export function createRequireAuth({ sessionRepository, userRepository }: RequireAuthDeps) {
  return function requireAuth(req: Request, _res: Response, next: NextFunction): void {
    void (async () => {
      const header = req.header('authorization');

      if (!header || !header.startsWith(BEARER_PREFIX)) {
        throw new AppError('Sign in required.', 401);
      }

      const token = header.slice(BEARER_PREFIX.length).trim();
      const { userId, sid } = verifySessionToken(token);

      const [sessionActive, user] = await Promise.all([
        sid ? sessionRepository.isSessionActive(sid, userId) : Promise.resolve(true),
        userRepository.findById(userId),
      ]);

      if (!sessionActive || !user) {
        throw new AppError('Sign in required.', 401);
      }

      (req as AuthenticatedRequest).auth = { userId };
    })().then(next, next);
  };
}
