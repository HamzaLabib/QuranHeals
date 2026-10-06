import crypto from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

import { GoogleAuthLibraryVerifier } from '../../src/auth/googleTokenVerifier';

// Real google-auth-library verification; only the certificate download is
// replaced by a locally generated key, so nothing touches the network.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const IOS = '111111111111-iosclientabc.apps.googleusercontent.com';
const ANDROID = '111111111111-androidclientabc.apps.googleusercontent.com';
const WEB = '111111111111-webclientabc.apps.googleusercontent.com';
const QURAN_HEALS_CLIENTS = [IOS, ANDROID, WEB];

function verifier(audiences: readonly string[] = QURAN_HEALS_CLIENTS) {
  const client = new OAuth2Client();
  vi.spyOn(client, 'getFederatedSignonCertsAsync').mockResolvedValue({ certs: { [KID]: PUBLIC_PEM }, format: undefined } as never);
  return new GoogleAuthLibraryVerifier({ client, audiences });
}

function googleToken(claims: Record<string, unknown> = {}, options: { key?: crypto.KeyObject; kid?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: 'https://accounts.google.com', aud: IOS, sub: 'google-sub-123', email: 'user@example.com', email_verified: true, iat: now, exp: now + 3600, ...claims },
    options.key ?? privateKey,
    { algorithm: 'RS256', keyid: options.kid ?? KID },
  );
}

describe('Google ID-token verification (google-auth-library)', () => {
  it.each([['iOS', IOS], ['Android', ANDROID], ['web', WEB]])('1. accepts a token issued to the Quran Heals %s client', async (_platform, aud) => {
    const identity = await verifier().verifyIdToken(googleToken({ aud }));
    expect(identity).toMatchObject({ providerSubject: 'google-sub-123', email: 'user@example.com', emailVerified: true });
    expect(typeof identity.issuedAt).toBe('number');
  });

  it('also accepts the bare accounts.google.com issuer Google uses', async () => {
    await expect(verifier().verifyIdToken(googleToken({ iss: 'accounts.google.com' }))).resolves.toMatchObject({ providerSubject: 'google-sub-123' });
  });

  it("2. rejects another app's audience", async () => {
    await expect(verifier().verifyIdToken(googleToken({ aud: '999999999999-someoneelse.apps.googleusercontent.com' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('3. rejects a wrong issuer', async () => {
    await expect(verifier().verifyIdToken(googleToken({ iss: 'https://evil.example.com' }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('4. rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    await expect(verifier().verifyIdToken(googleToken({ iat: past - 3600, exp: past }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it.each([
    ['garbage', 'not-a-jwt'],
    ['empty', ''],
    ['unsigned (alg none)', jwt.sign({ iss: 'https://accounts.google.com', aud: IOS, sub: 's' }, '', { algorithm: 'none' })],
    ['signed by another key', googleToken({}, { key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey })],
    ['unknown key id', googleToken({}, { kid: 'unknown-kid' })],
  ])('5. rejects a malformed/forged token: %s', async (_label, token) => {
    await expect(verifier().verifyIdToken(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a token with no subject', async () => {
    await expect(verifier().verifyIdToken(googleToken({ sub: undefined }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('6. without GOOGLE_CLIENT_IDS, verification fails clearly instead of accepting any audience', async () => {
    const client = new OAuth2Client();
    await expect(new GoogleAuthLibraryVerifier({ client }).verifyIdToken(googleToken())).rejects.toThrow(/GOOGLE_CLIENT_IDS/);
  });
});
