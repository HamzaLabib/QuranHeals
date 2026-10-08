import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().optional(),
    // Explicit database name; never inferred from the URI or MongoDB's
    // default `test`. Validated per NODE_ENV in config/databaseTarget.ts.
    MONGODB_DB_NAME: z.string().optional(),
    // 'true' makes startup fail when the MongoDB user can reach more than
    // its own database (config/credentialScope.ts); otherwise it only warns.
    // Turn on once each environment has its own scoped database user.
    MONGODB_ENFORCE_CREDENTIAL_SCOPE: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['true', 'false']).optional()),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Proxy hops in front of the app (Express 'trust proxy'), which decides
    // req.ip and therefore every per-IP rate limit. 1 = the long-standing
    // value. Must equal the real hop count: too low makes users share a
    // proxy's bucket, too high lets clients spoof their IP. Verify on Render
    // with CLIENT_IP_DIAGNOSTICS (docs/backend-operations.md#rate-limits).
    TRUST_PROXY_HOPS: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().int().min(0).max(10).default(1)),
    // Endpoint-specific limits (D7). OFF unless set to 'on', so deploying
    // never enables them before TRUST_PROXY_HOPS has been verified; the
    // global per-IP limit always applies regardless.
    ENDPOINT_RATE_LIMITS: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['on', 'off']).default('off')),
    // 'true' logs a description of the forwarding chain for GET /api/health
    // requests that carry `X-Quran-Heals-IP-Check: 1` — address kinds and
    // keyed hashes only, never real IPs — to determine TRUST_PROXY_HOPS.
    // Temporary; leave unset otherwise.
    CLIENT_IP_DIAGNOSTICS: z.preprocess((value) => (value === '' ? undefined : value), z.enum(['true', 'false']).optional()),
    CORS_ORIGIN: z.string().default('*'),

    // Server-only secret used to sign/verify this backend's own session
    // tokens (issued after a verified Apple/Google sign-in). Never sent to
    // the mobile client as a value — only the signed token is. A development
    // default is allowed so `npm run dev` works out of the box; production
    // must set a real secret (see the check below).
    SESSION_JWT_SECRET: z.string().min(1).default('dev-only-insecure-session-secret'),

    // Google OAuth "Web" or "Android"/"iOS" client ID(s) that Quran Heals
    // issues ID tokens for. google-auth-library accepts a single audience or
    // a list; kept as one comma-separated string here to match CORS_ORIGIN's
    // convention. Optional at parse time so the server can boot without
    // Google configured yet — see requireGoogleAuthConfig().
    GOOGLE_CLIENT_IDS: z.string().optional(),

    // Apple "Services ID" / app bundle ID(s) Quran Heals accepts as the
    // audience of an Apple identity token. Comma-separated, same convention
    // as GOOGLE_CLIENT_IDS. Optional at parse time — see requireAppleAuthConfig().
    APPLE_AUDIENCE_IDS: z.string().optional(),

    // Server-to-server Apple config (Phase B4), needed only to exchange an
    // authorization code for a refresh token and to later revoke it on
    // account deletion — identity-token verification (above) never needs
    // these. All four are required together; see requireAppleRevocationConfig().
    APPLE_TEAM_ID: z.string().optional(),
    APPLE_KEY_ID: z.string().optional(),
    // The Sign in with Apple private key's (.p8) PEM contents, with its
    // literal newlines escaped as the two characters `\n` — the standard
    // way to fit a multi-line PEM into a single-line env var. Decoded back
    // to real newlines by requireAppleRevocationConfig(). Never logged.
    APPLE_PRIVATE_KEY: z.string().optional(),
    // The app's bundle identifier — used both as the client secret JWT's
    // `sub` claim and as `client_id` on Apple's /auth/token and
    // /auth/revoke calls. For a native (non-web) Sign in with Apple
    // integration, Apple requires this to be the bundle ID, not a
    // separate web Services ID.
    APPLE_CLIENT_ID: z.string().optional(),
    // 32 raw bytes, base64-encoded (e.g. `openssl rand -base64 32`) — the
    // AES-256-GCM key used to encrypt the Apple refresh token at rest (see
    // crypto/appleCredentialEncryption.ts). Never logged, never sent to
    // any client. Optional at parse time — see requireAppleRefreshTokenEncryptionKey().
    APPLE_REFRESH_TOKEN_ENCRYPTION_KEY: z.string().optional(),

    // Error monitoring (monitoring/monitoring.ts). Off when SENTRY_DSN is
    // unset. Environment defaults to NODE_ENV; release defaults to Render's
    // RENDER_GIT_COMMIT when present.
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
    RENDER_GIT_COMMIT: z.string().optional(),
  })
  .transform((value) => ({
    ...value,
    GOOGLE_CLIENT_IDS: value.GOOGLE_CLIENT_IDS?.split(',').map((id) => id.trim()).filter(Boolean) ?? [],
    APPLE_AUDIENCE_IDS: value.APPLE_AUDIENCE_IDS?.split(',').map((id) => id.trim()).filter(Boolean) ?? [],
  }));

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const formatted = parsedEnv.error.issues.map((issue) => issue.message).join(', ');
  throw new Error(`Invalid environment configuration: ${formatted}`);
}

export const env = parsedEnv.data;

// Fails fast (at startup, not on the first sign-in request) if a real
// deployment forgot to set a production session secret. Test/development
// keep the convenience default so the suite and local `npm run dev` never
// need a `.env` file just to boot.
if (env.NODE_ENV === 'production' && env.SESSION_JWT_SECRET === 'dev-only-insecure-session-secret') {
  throw new Error('SESSION_JWT_SECRET must be set to a real secret in production.');
}

/** Throws a clear, actionable error if Google sign-in is used before GOOGLE_CLIENT_IDS is configured. */
export function requireGoogleAuthConfig(): readonly [string, ...string[]] {
  if (env.GOOGLE_CLIENT_IDS.length === 0) {
    throw new Error('Google sign-in is not configured: set GOOGLE_CLIENT_IDS in the backend environment.');
  }
  return env.GOOGLE_CLIENT_IDS as [string, ...string[]];
}

/** Throws a clear, actionable error if Apple sign-in is used before APPLE_AUDIENCE_IDS is configured. */
export function requireAppleAuthConfig(): readonly [string, ...string[]] {
  if (env.APPLE_AUDIENCE_IDS.length === 0) {
    throw new Error('Apple sign-in is not configured: set APPLE_AUDIENCE_IDS in the backend environment.');
  }
  return env.APPLE_AUDIENCE_IDS as [string, ...string[]];
}

export type AppleRevocationConfig = { teamId: string; keyId: string; privateKey: string; clientId: string };

/** Throws a clear, actionable error if an Apple authorization-code exchange or revocation call is attempted before all four vars are configured. */
export function requireAppleRevocationConfig(): AppleRevocationConfig {
  const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID } = env;
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY || !APPLE_CLIENT_ID) {
    throw new Error(
      'Apple account-deletion revocation is not configured: set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, and APPLE_CLIENT_ID in the backend environment.',
    );
  }
  return { teamId: APPLE_TEAM_ID, keyId: APPLE_KEY_ID, privateKey: APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), clientId: APPLE_CLIENT_ID };
}

const APPLE_REFRESH_TOKEN_KEY_BYTES = 32;

/** Throws a clear, actionable error if Apple credential encryption is used before APPLE_REFRESH_TOKEN_ENCRYPTION_KEY is configured correctly. */
export function requireAppleRefreshTokenEncryptionKey(): Buffer {
  if (!env.APPLE_REFRESH_TOKEN_ENCRYPTION_KEY) {
    throw new Error('Apple credential encryption is not configured: set APPLE_REFRESH_TOKEN_ENCRYPTION_KEY in the backend environment.');
  }
  const key = Buffer.from(env.APPLE_REFRESH_TOKEN_ENCRYPTION_KEY, 'base64');
  if (key.length !== APPLE_REFRESH_TOKEN_KEY_BYTES) {
    throw new Error('APPLE_REFRESH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).');
  }
  return key;
}

