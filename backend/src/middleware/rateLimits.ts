import { isIP } from 'node:net';

import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import type { AuthenticatedRequest } from './requireAuth';

/**
 * Endpoint-specific rate limits (D7), layered under the global per-IP limit.
 * In-memory per process: the backend runs as a single Render instance; a
 * multi-instance deployment would need a shared store (see
 * docs/backend-operations.md).
 *
 * The client address (CLIENT_IP_SOURCE, see clientAddress below) is either
 * `req.ip`, which depends on TRUST_PROXY_HOPS, or Cloudflare's
 * CF-Connecting-IP. IPv6 clients are grouped per /56 —
 * express-rate-limit's default — so one host can't evade a limit by rotating
 * addresses inside its own allocation.
 *
 * Thresholds are sized for shared IPs (households, a mosque's or campus
 * Wi-Fi, carrier NAT), not for a single device:
 *  - global: opening the app makes about 10 requests and the offline Mushaf
 *    download 32 to this server (its fonts come from Quran Foundation), so
 *    300/min lets about 30 people behind one address open the app in the same
 *    minute, or 9 download the Mushaf, while one address still can't exceed
 *    5 requests a second.
 *  - issueReports: a person sends one report occasionally; 10/hour per IP
 *    still lets several people behind one address report, while capping
 *    unauthenticated writes (and stored emails) from a script.
 *  - signIn: each attempt makes the backend verify an Apple/Google token
 *    (a forged token fails fast); 60 per 15 min per IP covers a room of
 *    people signing in on one Wi-Fi, with retries.
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
  global: { windowMs: MINUTE, limit: 300 },
  issueReports: { windowMs: 60 * MINUTE, limit: 10 },
  signIn: { windowMs: 15 * MINUTE, limit: 60 },
  sessionRefresh: { windowMs: 15 * MINUTE, limit: 120 },
  accountReauth: { windowMs: 60 * MINUTE, limit: 10 },
};

export const RATE_LIMITED_MESSAGE = 'Too many requests. Please try again later.';

export type RateLimiters = Record<RateLimitName, RequestHandler>;

/**
 * Where a per-IP limit takes the client's address from (env CLIENT_IP_SOURCE):
 *  - 'request': `req.ip`, as Express derives it from X-Forwarded-For with TRUST_PROXY_HOPS;
 *  - 'cf-connecting-ip': Cloudflare's CF-Connecting-IP. Render documents that Cloudflare sets it on every request
 *    to a web service and overwrites any value the caller sent (render.com/articles/host-pocketbase-on-render,
 *    July 2026), so it needs no hop count. Confirm it on this service with the diagnostic before relying on it.
 *    A request without a valid one (local runs, tests) falls back to `req.ip`.
 */
export type ClientIpSource = 'request' | 'cf-connecting-ip';

export function clientAddress(req: Pick<Request, 'ip' | 'get'>, source: ClientIpSource): string {
  if (source === 'cf-connecting-ip') {
    const header = req.get('cf-connecting-ip')?.trim() ?? '';
    if (isIP(header) !== 0) return header;
  }
  return req.ip ?? '';
}

/** One set of limiters per app instance (each with its own counters). `overrides` exists for tests. */
export function createRateLimiters(
  overrides: Partial<Record<RateLimitName, RateLimitPolicy>> = {},
  options: { clientIpSource?: ClientIpSource } = {},
): RateLimiters {
  const policies = { ...DEFAULT_RATE_LIMITS, ...overrides };
  const source = options.clientIpSource ?? 'request';
  // IPv6 grouped per /56, exactly like the library's default key.
  const perIp = source === 'request' ? undefined : (req: AuthenticatedRequest) => ipKeyGenerator(clientAddress(req, source));
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
    global: build('global', perIp),
    issueReports: build('issueReports', perIp),
    signIn: build('signIn', perIp),
    sessionRefresh: build('sessionRefresh', perIp),
    // Mounted after requireAuth, so req.auth is the verified account. The
    // key is the internal user id only — no IP or email is kept.
    accountReauth: build('accountReauth', (req) => `user:${req.auth.userId}`),
  };
}
