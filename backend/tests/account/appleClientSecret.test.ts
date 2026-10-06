import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function generateTestEs256KeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}

async function freshModule(overrides: Partial<Record<'APPLE_TEAM_ID' | 'APPLE_KEY_ID' | 'APPLE_PRIVATE_KEY' | 'APPLE_CLIENT_ID', string>>) {
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  return import('../../src/auth/appleClientSecret.js');
}

describe('Apple client secret generation', () => {
  it('signs a valid ES256 JWT with the configured team/key/client identifiers', async () => {
    const { privateKeyPem, publicKeyPem } = generateTestEs256KeyPair();
    const { generateAppleClientSecret } = await freshModule({
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY7890',
      APPLE_PRIVATE_KEY: privateKeyPem.replace(/\n/g, '\\n'),
      APPLE_CLIENT_ID: 'com.quranheals.app',
    });

    const secret = generateAppleClientSecret();
    const decodedHeader = JSON.parse(Buffer.from(secret.split('.')[0], 'base64url').toString('utf8'));
    const payload = jwt.verify(secret, publicKeyPem, { algorithms: ['ES256'] }) as Record<string, unknown>;

    expect(decodedHeader).toMatchObject({ alg: 'ES256', kid: 'KEY7890' });
    expect(payload).toMatchObject({ iss: 'TEAM123456', aud: 'https://appleid.apple.com', sub: 'com.quranheals.app' });
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect((payload.exp as number) - (payload.iat as number)).toBe(5 * 60);
  });

  it('never leaks the private key material into the generated secret itself', async () => {
    const { privateKeyPem } = generateTestEs256KeyPair();
    const { generateAppleClientSecret } = await freshModule({
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY7890',
      APPLE_PRIVATE_KEY: privateKeyPem.replace(/\n/g, '\\n'),
      APPLE_CLIENT_ID: 'com.quranheals.app',
    });

    const secret = generateAppleClientSecret();

    expect(secret).not.toContain('PRIVATE KEY');
  });

  it('throws a clear configuration error when any required var is missing', async () => {
    const { generateAppleClientSecret } = await freshModule({
      APPLE_TEAM_ID: '',
      APPLE_KEY_ID: '',
      APPLE_PRIVATE_KEY: '',
      APPLE_CLIENT_ID: '',
    });

    expect(() => generateAppleClientSecret()).toThrow(/APPLE_TEAM_ID|APPLE_KEY_ID|APPLE_PRIVATE_KEY|APPLE_CLIENT_ID/);
  });
});
