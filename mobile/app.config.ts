import type { ConfigContext, ExpoConfig } from 'expo/config';

// app.json stays the source of truth for the app config. This file only adds
// build-time guards on the backend URL and Google client IDs a build embeds,
// so a bad preview/production EAS build fails before a binary exists (see
// docs/release-builds.md), plus the Android Google sign-in redirect scheme.
// Kept self-contained: Expo transpiles this file when it evaluates the
// config but not other TypeScript files it imports. The helpers are
// exported for tests/apiUrlPolicy.test.ts and tests/googleAuthConfig.test.ts.

export const API_URL_ENV = 'EXPO_PUBLIC_API_URL';
/** Set per EAS build profile in eas.json (`env`). */
export const API_URL_POLICY_ENV = 'QURAN_HEALS_API_URL_POLICY';

/**
 * 'local'  — development: the URL may be unset (the app then uses the local
 *            backend on port 4000) or any http(s) URL, e.g. a LAN dev server.
 * 'hosted' — preview/production builds installed on real phones: the URL
 *            must be set and be a public https:// address.
 */
export type ApiUrlPolicy = 'local' | 'hosted';

const HOSTED_PROFILES = new Set(['preview', 'production']);

type Env = Record<string, string | undefined>;

export function resolveApiUrlPolicy(env: Env): ApiUrlPolicy {
  const explicit = env[API_URL_POLICY_ENV]?.trim();
  if (explicit === 'hosted' || explicit === 'local') return explicit;
  if (explicit) throw new Error(`${API_URL_POLICY_ENV} must be "hosted" or "local", got "${explicit}".`);
  // Fallback for EAS builds whose profile env didn't set the policy.
  return HOSTED_PROFILES.has(env.EAS_BUILD_PROFILE ?? '') ? 'hosted' : 'local';
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  return (
    a === 0 || // "this network", incl. 0.0.0.0
    a === 10 || // private, incl. the Android emulator's 10.0.2.2
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) // private
  );
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isPrivateIPv4(host)) return true;
  // IPv6 loopback, unspecified, unique-local (fc00::/7) and link-local (fe80::/10).
  if (host.includes(':')) {
    return host === '::1' || host === '::' || /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host);
  }
  return false;
}

export type ApiUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Validates a URL for a build that real users/testers install. */
export function checkHostedApiUrl(raw: string | undefined): ApiUrlCheck {
  const value = raw?.trim();
  if (!value) {
    return { ok: false, reason: `${API_URL_ENV} is not set. Hosted (preview/production) builds must set it to the public https:// backend URL in the EAS environment for this profile.` };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: `${API_URL_ENV} is not a valid URL: "${value}".` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: `${API_URL_ENV} must use https:// for hosted builds, got "${value}".` };
  }
  if (isLocalOrPrivateHost(url.hostname)) {
    return { ok: false, reason: `${API_URL_ENV} points at a local or private-network host ("${url.hostname}"), which phones outside your network cannot reach. Use the public backend URL.` };
  }
  if (url.username || url.password || url.search || url.hash) {
    return { ok: false, reason: `${API_URL_ENV} must be a plain base URL without credentials, query or fragment, got "${value}".` };
  }
  return { ok: true, url: value.replace(/\/+$/, '') };
}

/**
 * Throws when a hosted build would embed a missing or unsafe API URL.
 *
 * Enforced only on the EAS build worker (EAS_BUILD=true), which reads this
 * config before prebuild/compilation — so a bad build fails before any
 * binary exists. Locally, `eas build`/`eas config` also evaluate this file,
 * but partly before the EAS environment variables are downloaded (and with
 * a developer's own .env possibly loaded), so a local evaluation cannot tell
 * a missing URL from one that simply hasn't been fetched yet. On the worker
 * the environment is authoritative: the profile's EAS environment plus its
 * eas.json `env`, never a local .env (gitignored, so never uploaded).
 * Development ('local') builds are never blocked.
 */
export function assertApiUrlForBuild(env: Env): void {
  if (env.EAS_BUILD !== 'true') return;
  if (resolveApiUrlPolicy(env) !== 'hosted') return;
  const result = checkHostedApiUrl(env[API_URL_ENV]);
  if (!result.ok) {
    const profile = env.EAS_BUILD_PROFILE ? ` (EAS build profile "${env.EAS_BUILD_PROFILE}")` : '';
    throw new Error(`Refusing to build Quran Heals${profile}: ${result.reason}`);
  }
}

const GOOGLE_CLIENT_ID_ENVS = ['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] as const;
const GOOGLE_CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/**
 * On the EAS build worker, any Google client ID that is set must look like
 * one. An unset ID is allowed: the app then hides Google sign-in on that
 * platform (src/auth/googleConfig.ts) instead of offering a broken button.
 */
export function assertGoogleClientIdsForBuild(env: Env): void {
  if (env.EAS_BUILD !== 'true') return;
  for (const name of GOOGLE_CLIENT_ID_ENVS) {
    const value = env[name]?.trim();
    if (value && !GOOGLE_CLIENT_ID.test(value)) {
      throw new Error(`Refusing to build Quran Heals: ${name} is not a Google OAuth client ID (expected …apps.googleusercontent.com).`);
    }
  }
}

/**
 * Google sign-in (expo-auth-session) redirects native builds to
 * `<applicationId>:/oauthredirect`. iOS registers the bundle identifier as a
 * URL scheme automatically; Android only registers `scheme`/`android.scheme`,
 * so the package name is added here, derived from android.package so the two
 * can never drift apart.
 */
export function withGoogleRedirectScheme(config: ExpoConfig): ExpoConfig {
  const androidPackage = config.android?.package;
  if (!androidPackage) return config;
  const current = config.android?.scheme;
  const schemes = Array.isArray(current) ? current : current ? [current] : [];
  if (schemes.includes(androidPackage)) return config;
  return { ...config, android: { ...config.android, scheme: [...schemes, androidPackage] } };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  assertApiUrlForBuild(process.env);
  assertGoogleClientIdsForBuild(process.env);
  return withGoogleRedirectScheme(config as ExpoConfig);
};
