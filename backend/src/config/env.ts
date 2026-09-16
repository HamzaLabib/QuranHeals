import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(4000),
    MONGODB_URI: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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

