import crypto from 'node:crypto';

/**
 * Startup validation of sign-in configuration (server.ts, production only).
 * Fails fast instead of leaving a misconfiguration to surface on a user's
 * first sign-in or, worse, on an Apple account deletion. Problems name
 * variables only — never a value, key or ID.
 *
 * - Google is enabled by GOOGLE_CLIENT_IDS: the comma-separated iOS,
 *   Android and web OAuth client IDs the mobile app uses (the only accepted
 *   ID-token audiences).
 * - Apple is enabled by APPLE_AUDIENCE_IDS. Account deletion must revoke
 *   Apple's authorization (App Store requirement), so enabled Apple also
 *   requires the revocation key set and the refresh-token encryption key.
 */
export type AuthConfigInput = {
  GOOGLE_CLIENT_IDS: readonly string[];
  APPLE_AUDIENCE_IDS: readonly string[];
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_REFRESH_TOKEN_ENCRYPTION_KEY?: string;
};

const GOOGLE_CLIENT_ID = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const APPLE_TEN_CHAR_ID = /^[A-Z0-9]{10}$/;

export function findAuthConfigProblems(config: AuthConfigInput, options: { production: boolean }): string[] {
  const problems: string[] = [];
  const googleEnabled = config.GOOGLE_CLIENT_IDS.length > 0;
  const appleEnabled = config.APPLE_AUDIENCE_IDS.length > 0;

  if (options.production && !googleEnabled && !appleEnabled) {
    problems.push('No sign-in provider is configured: set GOOGLE_CLIENT_IDS and/or APPLE_AUDIENCE_IDS.');
  }

  if (googleEnabled && config.GOOGLE_CLIENT_IDS.some((id) => !GOOGLE_CLIENT_ID.test(id))) {
    problems.push('GOOGLE_CLIENT_IDS must contain only Google OAuth client IDs (…apps.googleusercontent.com), comma-separated.');
  }

  if (appleEnabled) {
    for (const name of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID', 'APPLE_REFRESH_TOKEN_ENCRYPTION_KEY'] as const) {
      if (!config[name]?.trim()) problems.push(`${name} is required when Apple sign-in is enabled (APPLE_AUDIENCE_IDS is set).`);
    }
    if (config.APPLE_TEAM_ID?.trim() && !APPLE_TEN_CHAR_ID.test(config.APPLE_TEAM_ID.trim())) {
      problems.push('APPLE_TEAM_ID must be the 10-character Apple Developer Team ID.');
    }
    if (config.APPLE_KEY_ID?.trim() && !APPLE_TEN_CHAR_ID.test(config.APPLE_KEY_ID.trim())) {
      problems.push('APPLE_KEY_ID must be the 10-character Sign in with Apple key ID.');
    }
    if (config.APPLE_PRIVATE_KEY?.trim()) {
      try {
        const key = crypto.createPrivateKey(config.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'));
        if (key.asymmetricKeyType !== 'ec') problems.push('APPLE_PRIVATE_KEY must be the Sign in with Apple (.p8, EC) private key.');
      } catch {
        problems.push('APPLE_PRIVATE_KEY is not a readable PEM private key (escape its newlines as \\n).');
      }
    }
    if (config.APPLE_CLIENT_ID?.trim() && !config.APPLE_AUDIENCE_IDS.includes(config.APPLE_CLIENT_ID.trim())) {
      problems.push('APPLE_CLIENT_ID (the app bundle ID) must also be listed in APPLE_AUDIENCE_IDS.');
    }
    const encryptionKey = config.APPLE_REFRESH_TOKEN_ENCRYPTION_KEY?.trim();
    if (encryptionKey && Buffer.from(encryptionKey, 'base64').length !== 32) {
      problems.push('APPLE_REFRESH_TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64-encoded.');
    }
  }

  return problems;
}

export function assertAuthConfig(config: AuthConfigInput, options: { production: boolean }): void {
  const problems = findAuthConfigProblems(config, options);
  if (problems.length > 0) {
    throw new Error(`Invalid sign-in configuration:\n- ${problems.join('\n- ')}`);
  }
}
