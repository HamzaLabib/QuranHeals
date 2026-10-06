import jwt from 'jsonwebtoken';

import { requireAppleRevocationConfig } from '../config/env';

/**
 * Minted fresh for every server-to-server Apple call (authorization-code
 * exchange, revocation) rather than cached — a short-lived (5 minute) ES256
 * JWT per Apple's "client secret" spec for Sign in with Apple
 * (https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens),
 * signed with this app's private key. Never logged; never sent to any
 * client. Minting fresh each time means there's nothing long-lived to leak
 * from this process's memory, and avoids needing to track/rotate a cached
 * secret's own expiry.
 */
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

export function generateAppleClientSecret(): string {
  const { teamId, keyId, privateKey, clientId } = requireAppleRevocationConfig();
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iss: teamId,
      iat: now,
      exp: now + CLIENT_SECRET_TTL_SECONDS,
      aud: 'https://appleid.apple.com',
      sub: clientId,
    },
    privateKey,
    { algorithm: 'ES256', keyid: keyId },
  );
}
