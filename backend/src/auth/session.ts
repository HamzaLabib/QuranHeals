import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../config/env';
import { AppError } from '../errors/AppError';

// Short-lived by design: a leaked access token is only useful for this
// long. Normal use relies on the refresh flow (see SessionRepository),
// never on a single long-lived bearer token — see the multi-device auth
// phase's "Do NOT 'fix' this by simply increasing JWT expiration time."
const ACCESS_TOKEN_TTL = '20m';

// A refresh token that hasn't been used to renew a session in this long is
// treated as abandoned. Rotated on every successful refresh, so an
// actively-used device's session never actually reaches this age.
export const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export type SessionPayload = {
  userId: string;
  /**
   * Absent on a token issued before the multi-device auth phase shipped
   * (the old, single 180-day stateless token) — requireAuth never depends
   * on this field being present, so those already-issued tokens keep
   * working unchanged until they naturally expire. Only present on tokens
   * issued by signAccessToken with a sessionId.
   */
  sid?: string;
};

/** Issues this backend's own access token after a verified Apple/Google sign-in or a refresh. Never encodes anything the client sent unverified. */
export function signAccessToken(userId: string, sessionId?: string): string {
  const payload: SessionPayload = sessionId ? { userId, sid: sessionId } : { userId };
  return jwt.sign(payload, env.SESSION_JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

/** Back-compat alias — existing callers/tests refer to this name for issuing an access token. */
export const signSessionToken = signAccessToken;

/**
 * Verifies this backend's own access token. Throws AppError(401) on any
 * failure (expired, tampered, wrong secret, malformed) — callers must never
 * fall back to trusting a client-supplied userId when this throws. See Part
 * B §7.
 */
export function verifySessionToken(token: string): SessionPayload {
  try {
    const decoded = jwt.verify(token, env.SESSION_JWT_SECRET);
    if (typeof decoded !== 'object' || decoded === null || typeof (decoded as { userId?: unknown }).userId !== 'string') {
      throw new Error('Malformed session token payload.');
    }
    const sid = (decoded as { sid?: unknown }).sid;
    return { userId: (decoded as SessionPayload).userId, sid: typeof sid === 'string' ? sid : undefined };
  } catch {
    throw new AppError('Session is invalid or has expired. Please sign in again.', 401);
  }
}

const REFRESH_TOKEN_SECRET_BYTES = 32;

/**
 * A refresh token is `${sessionId}.${secret}` — the sessionId half lets
 * refresh/logout find the right Session document with a single indexed
 * lookup instead of scanning every session's hash; the secret half is
 * never stored server-side, only its sha256 hash (hashRefreshToken).
 */
export function formatRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function generateRefreshTokenSecret(): string {
  return crypto.randomBytes(REFRESH_TOKEN_SECRET_BYTES).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const separatorIndex = token.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) return null;
  return { sessionId: token.slice(0, separatorIndex), secret: token.slice(separatorIndex + 1) };
}
