import crypto from 'node:crypto';

import { env } from '../config/env';
import { AppError } from '../errors/AppError';
import { formatRefreshToken, hashRefreshToken, parseRefreshToken, REFRESH_TOKEN_TTL_MS } from './session';

/**
 * How long after a rotation the immediately previous refresh token may be
 * presented again and still recover the session. Covers a client whose
 * refresh response was lost (timeout, dropped connection, app suspended or
 * killed before it saved the new token) and that retries promptly — the
 * mobile client retries once, about a second later (see
 * mobile/src/auth/tokenManager.ts). Deliberately short: within this
 * window, whoever holds the previous token can obtain the current one.
 */
export const REFRESH_RETRY_GRACE_MS = 2 * 60 * 1000;

const INVALID_SESSION_MESSAGE = 'Session is invalid or has expired. Please sign in again.';

/** Server-side session state relevant to rotation. Only hashes of refresh tokens are ever stored. */
export type RotationSessionState = {
  userId: string;
  refreshTokenHash: string;
  /** Hash of the token that was rotated INTO `refreshTokenHash`. Absent until the first rotation. */
  previousRefreshTokenHash?: string;
  /** Server time of the last rotation (epoch ms). */
  rotatedAt?: number;
  expiresAt: number;
  revokedAt?: number;
};

export type RotationUpdate = {
  refreshTokenHash: string;
  previousRefreshTokenHash: string;
  rotatedAt: number;
  expiresAt: number;
};

/** Persistence used by rotateRefreshToken. Implementations must make compareAndRotate atomic. */
export interface RotationStore {
  /**
   * Applies `update` only if the session exists, is not revoked, has not
   * expired at `now`, and its current refresh-token hash is exactly
   * `expectedHash` — as one atomic operation. Returns the session's userId
   * if it was applied, otherwise null. Must return null (never throw) for
   * an id the store cannot represent.
   */
  compareAndRotate(sessionId: string, expectedHash: string, update: RotationUpdate, now: number): Promise<string | null>;
  find(sessionId: string): Promise<RotationSessionState | null>;
  revoke(sessionId: string, now: number): Promise<void>;
}

let rotationKey: Buffer | undefined;

/**
 * Domain-separated from the JWT signing use of the same secret, so the two
 * can never be confused for one another.
 */
function getRotationKey(): Buffer {
  rotationKey ??= crypto.createHmac('sha256', env.SESSION_JWT_SECRET).update('quran-heals:refresh-token-rotation:v1').digest();
  return rotationKey;
}

/**
 * The successor of a refresh token is derived from it with a server-only
 * key, rather than drawn at random. This is what lets a retry with the
 * immediately previous token be answered with the SAME current token the
 * lost response carried — recomputed, never stored or recovered from the
 * database (only hashes are stored) — and what makes two concurrent
 * refreshes of the same token converge on one successor instead of forking
 * the chain. Without the server key, holding a token reveals nothing about
 * its successor.
 */
export function deriveNextRefreshToken(sessionId: string, presentedToken: string): string {
  const secret = crypto.createHmac('sha256', getRotationKey()).update(presentedToken).digest('base64url');
  return formatRefreshToken(sessionId, secret);
}

function invalidSession(): AppError {
  return new AppError(INVALID_SESSION_MESSAGE, 401);
}

/**
 * Rotates a refresh token. Outcomes:
 *  - the session's CURRENT token → rotated to its derived successor;
 *  - the IMMEDIATELY PREVIOUS token, within REFRESH_RETRY_GRACE_MS of that
 *    rotation, while its successor is still current → treated as a retry:
 *    the same successor is returned again and nothing changes;
 *  - any other token for the session (older generations, the previous
 *    token after the window or after its successor was itself rotated, a
 *    forged secret) → possible theft/reuse: the session is revoked;
 *  - unknown, expired, or revoked session → rejected, nothing changes.
 * Every rejection is the same 401. The grace window uses the server's
 * clock only.
 */
export async function rotateRefreshToken(
  store: RotationStore,
  presentedToken: string,
  now: number = Date.now(),
): Promise<{ sessionId: string; refreshToken: string; userId: string }> {
  const parsed = parseRefreshToken(presentedToken);
  if (!parsed) throw invalidSession();

  const { sessionId } = parsed;
  const presentedHash = hashRefreshToken(presentedToken);
  const nextRefreshToken = deriveNextRefreshToken(sessionId, presentedToken);
  const nextHash = hashRefreshToken(nextRefreshToken);

  const rotatedUserId = await store.compareAndRotate(
    sessionId,
    presentedHash,
    { refreshTokenHash: nextHash, previousRefreshTokenHash: presentedHash, rotatedAt: now, expiresAt: now + REFRESH_TOKEN_TTL_MS },
    now,
  );
  if (rotatedUserId !== null) return { sessionId, refreshToken: nextRefreshToken, userId: rotatedUserId };

  const session = await store.find(sessionId);
  if (!session || session.revokedAt !== undefined || session.expiresAt <= now) throw invalidSession();

  const isRetryOfLastRotation =
    session.previousRefreshTokenHash === presentedHash &&
    session.refreshTokenHash === nextHash &&
    session.rotatedAt !== undefined &&
    Math.abs(now - session.rotatedAt) <= REFRESH_RETRY_GRACE_MS;
  if (isRetryOfLastRotation) return { sessionId, refreshToken: nextRefreshToken, userId: session.userId };

  await store.revoke(sessionId, now);
  throw invalidSession();
}
