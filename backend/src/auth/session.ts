import jwt from 'jsonwebtoken';

import { env } from '../config/env';
import { AppError } from '../errors/AppError';

const SESSION_TOKEN_TTL = '180d';

export type SessionPayload = {
  userId: string;
};

/** Issues this backend's own session token after a verified Apple/Google sign-in. Never encodes anything the client sent unverified. */
export function signSessionToken(userId: string): string {
  return jwt.sign({ userId } satisfies SessionPayload, env.SESSION_JWT_SECRET, {
    expiresIn: SESSION_TOKEN_TTL,
  });
}

/**
 * Verifies this backend's own session token. Throws AppError(401) on any
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
    return { userId: (decoded as SessionPayload).userId };
  } catch {
    throw new AppError('Session is invalid or has expired. Please sign in again.', 401);
  }
}
