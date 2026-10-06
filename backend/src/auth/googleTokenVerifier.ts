import { OAuth2Client } from 'google-auth-library';

import { requireGoogleAuthConfig } from '../config/env';
import { AppError } from '../errors/AppError';

export type VerifiedGoogleIdentity = {
  providerSubject: string;
  email?: string;
  emailVerified?: boolean;
  /** The token's `iat` (seconds since epoch), as signed by Google. */
  issuedAt?: number;
};

export interface GoogleTokenVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity>;
}

/**
 * Verifies a Google-issued ID token using google-auth-library — the
 * official, maintained client, not a hand-rolled JWT/JWKS check. Throws
 * AppError(401) for anything that fails verification (bad signature, wrong
 * audience/issuer, expired token), so a caller can never coerce a session
 * out of an unverifiable token. See Part B §4/§7.
 */
export class GoogleAuthLibraryVerifier implements GoogleTokenVerifier {
  /**
   * Tests inject a client (with stubbed certificates) and the audience list;
   * production uses a fresh client and GOOGLE_CLIENT_IDS — every Quran Heals
   * iOS/Android/web OAuth client ID, and nothing else.
   */
  constructor(private readonly options: { client?: OAuth2Client; audiences?: readonly string[] } = {}) {}

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    const audience = this.options.audiences ?? requireGoogleAuthConfig();
    const client = this.options.client ?? new OAuth2Client();

    let ticket;
    try {
      ticket = await client.verifyIdToken({ idToken, audience: [...audience] });
    } catch {
      throw new AppError('Google sign-in could not be verified.', 401);
    }

    const payload = ticket.getPayload();
    if (!payload?.sub) {
      throw new AppError('Google sign-in could not be verified.', 401);
    }

    return {
      providerSubject: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified,
      issuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
    };
  }
}
