import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { requireAppleAuthConfig } from '../config/env';
import { AppError } from '../errors/AppError';

export type VerifiedAppleIdentity = {
  providerSubject: string;
  email?: string;
  emailVerified?: boolean;
};

export interface AppleTokenVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedAppleIdentity>;
}

const APPLE_ISSUER = 'https://appleid.apple.com';

const jwks = jwksClient({
  jwksUri: `${APPLE_ISSUER}/auth/keys`,
  cache: true,
  cacheMaxAge: 60 * 60 * 1000,
  rateLimit: true,
});

function getSigningKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  if (!header.kid) {
    callback(new Error('Apple identity token is missing a key id.'));
    return;
  }

  jwks.getSigningKey(header.kid, (error, key) => {
    if (error || !key) {
      callback(error ?? new Error('Unknown Apple signing key.'));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

/**
 * Verifies an Apple-issued identity token against Apple's published JWKS
 * (https://appleid.apple.com/auth/keys), checking signature, issuer, and
 * audience — no custom cryptography, no Apple private key needed (that's
 * only required for server-to-server calls Quran Heals doesn't make in this
 * phase, e.g. token revocation). Throws AppError(401) for anything
 * unverifiable. See Part B §4/§7.
 */
export class AppleJwksVerifier implements AppleTokenVerifier {
  async verifyIdToken(idToken: string): Promise<VerifiedAppleIdentity> {
    const audience = requireAppleAuthConfig();

    const payload = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(
        idToken,
        getSigningKey,
        { issuer: APPLE_ISSUER, audience: [...audience], algorithms: ['RS256'] },
        (error, decoded) => {
          if (error || !decoded || typeof decoded === 'string') {
            reject(error ?? new Error('Invalid Apple identity token.'));
            return;
          }
          resolve(decoded);
        },
      );
    }).catch(() => {
      throw new AppError('Apple sign-in could not be verified.', 401);
    });

    if (!payload.sub) {
      throw new AppError('Apple sign-in could not be verified.', 401);
    }

    return {
      providerSubject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      // Apple sends this as the string "true"/"false" in some token
      // versions, and a real boolean in others.
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    };
  }
}
