import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

import type { AuthenticatedRequest } from './requireAuth';

/**
 * Endpoint-specific rate limits (D7), layered under the global per-IP limit.
 * In-memory per process: the backend runs as a single Render instance; a
 * multi-instance deployment would need a shared store (see
 * docs/backend-operations.md).
 *
 * Client IPs come from `req.ip`, which relies on app.set('trust proxy', 1)
 * (Render's single proxy hop). IPv6 clients are grouped per /56 —
 * express-rate-limit's default — so one host can't evade a limit by rotating
 * addresses inside its own allocation.
 *
 * Thresholds are sized for shared IPs (households, campus Wi-Fi, carrier
 * NAT), not for a single device:
 *  - issueReports: a person sends one report occasionally; 10/hour per IP
 *    still lets several people behind one address report, while capping
 *    unauthenticated writes (and stored emails) from a script.
 *  - signIn: each attempt makes the backend verify an Apple/Google token;
 *    30 per 15 min per IP covers repeated legitimate retries by several
 *    people behind one address.
 *  - sessionRefresh (refresh + logout): access tokens live 20 minutes, so a
 *    device refreshes ~1 per 15 min; 120 per 15 min per IP leaves room for
 *    many devices behind one address. A 429 here never signs a user out —
 *    the app only signs out on a 401 (mobile/src/auth/tokenManager.ts).
 *  - accountReauth (account deletion, reflection-sync reset): per ACCOUNT,
 *    after requireAuth; each attempt verifies a fresh provider credential.
 *    The normal flow is 2 requests (428, then the credential), so 10/hour
 *    allows several honest retries.
 */
export type RateLimitPolicy = { windowMs: number; limit: number };
export type RateLimitName = 'global' | 'issueReports' | 'signIn' | 'sessionRefresh' | 'accountReauth';

const MINUTE = 60_000;

export const DEFAULT_RATE_LIMITS: Readonly<Record<RateLimitName, RateLimitPolicy>> = {
  global: { windowMs: MINUTE, limit: 120 },
  issueReports: { windowMs: 60 * MINUTE, limit: 10 },
  signIn: { windowMs: 15 * MINUTE, limit: 30 },
  sessionRefresh: { windowMs: 15 * MINUTE, limit: 120 },
  accountReauth: { windowMs: 60 * MINUTE, limit: 10 },
};

export const RATE_LIMITED_MESSAGE = 'Too many requests. Please try again later.';

export type RateLimiters = Record<RateLimitName, RequestHandler>;

/** One set of limiters per app instance (each with its own counters). `overrides` exists for tests. */
export function createRateLimiters(overrides: Partial<Record<RateLimitName, RateLimitPolicy>> = {}): RateLimiters {
  const policies = { ...DEFAULT_RATE_LIMITS, ...overrides };
  const build = (name: RateLimitName, keyGenerator?: (req: AuthenticatedRequest) => string): RequestHandler =>
    rateLimit({
      windowMs: policies[name].windowMs,
      limit: policies[name].limit,
      standardHeaders: true,
      legacyHeaders: false,
      // Same `{ success, message }` shape as every other API error; Retry-After is set by the library.
      handler: (_req, res) => {
        res.status(429).json({ success: false, message: RATE_LIMITED_MESSAGE });
      },
      ...(keyGenerator ? { keyGenerator: keyGenerator as never } : {}),
    });

  return {
    global: build('global'),
    issueReports: build('issueReports'),
    signIn: build('signIn'),
    sessionRefresh: build('sessionRefresh'),
    // Mounted after requireAuth, so req.auth is the verified account. The
    // key is the internal user id only — no IP or email is kept.
    accountReauth: build('accountReauth', (req) => `user:${req.auth.userId}`),
  };
}
