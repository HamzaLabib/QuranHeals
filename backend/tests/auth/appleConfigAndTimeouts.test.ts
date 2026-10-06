import crypto from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

// A throwaway EC key: the client secret is signed locally, never sent anywhere.
const ecKey = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto') as typeof crypto;
  return nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
});

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();
  return {
    ...actual,
    requireAppleRevocationConfig: () => ({ teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: ecKey, clientId: 'com.quranheals.app' }),
  };
});

import { APPLE_REQUEST_TIMEOUT_MS, HttpAppleRevocationClient } from '../../src/auth/appleRevocationClient';
import { findAuthConfigProblems, assertAuthConfig, type AuthConfigInput } from '../../src/config/authConfig';

const GOOGLE_IDS = ['111111111111-iosclientabc.apps.googleusercontent.com', '111111111111-androidclientabc.apps.googleusercontent.com'];
const validApple: AuthConfigInput = {
  GOOGLE_CLIENT_IDS: GOOGLE_IDS,
  APPLE_AUDIENCE_IDS: ['com.quranheals.app'],
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_KEY_ID: 'KEY1234567',
  APPLE_PRIVATE_KEY: ecKey.replace(/\n/g, '\\n'), // single-line env form
  APPLE_CLIENT_ID: 'com.quranheals.app',
  APPLE_REFRESH_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
};

describe('production sign-in configuration', () => {
  it('7. accepts a complete Google + Apple configuration', () => {
    expect(findAuthConfigProblems(validApple, { production: true })).toEqual([]);
    expect(() => assertAuthConfig(validApple, { production: true })).not.toThrow();
  });

  it.each(['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID', 'APPLE_REFRESH_TOKEN_ENCRYPTION_KEY'] as const)(
    '8. Apple enabled but %s missing → fails clearly, naming the variable',
    (name) => {
      const problems = findAuthConfigProblems({ ...validApple, [name]: undefined }, { production: true });
      expect(problems.some((problem) => problem.startsWith(`${name} is required`))).toBe(true);
    },
  );

  it('8. rejects malformed Apple values without echoing them', () => {
    const secretish = 'not-a-key-SECRET-VALUE';
    const problems = findAuthConfigProblems(
      { ...validApple, APPLE_PRIVATE_KEY: secretish, APPLE_TEAM_ID: 'short', APPLE_REFRESH_TOKEN_ENCRYPTION_KEY: 'c2hvcnQ=', APPLE_CLIENT_ID: 'com.other.app' },
      { production: true },
    );
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).not.toContain(secretish);
    expect(problems.join(' ')).not.toContain('com.other.app');
  });

  it('rejects an RSA key where the Apple EC .p8 key is expected', () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(findAuthConfigProblems({ ...validApple, APPLE_PRIVATE_KEY: rsa }, { production: true })).toEqual([
      'APPLE_PRIVATE_KEY must be the Sign in with Apple (.p8, EC) private key.',
    ]);
  });

  it('6. production with no provider configured fails; a malformed Google client ID fails', () => {
    expect(() => assertAuthConfig({ GOOGLE_CLIENT_IDS: [], APPLE_AUDIENCE_IDS: [] }, { production: true })).toThrow(/No sign-in provider is configured/);
    expect(findAuthConfigProblems({ GOOGLE_CLIENT_IDS: ['my-client-id'], APPLE_AUDIENCE_IDS: [] }, { production: true })).toEqual([
      'GOOGLE_CLIENT_IDS must contain only Google OAuth client IDs (…apps.googleusercontent.com), comma-separated.',
    ]);
  });

  it('Google-only production (Apple not enabled) is valid; development tolerates no providers', () => {
    expect(findAuthConfigProblems({ GOOGLE_CLIENT_IDS: GOOGLE_IDS, APPLE_AUDIENCE_IDS: [] }, { production: true })).toEqual([]);
    expect(findAuthConfigProblems({ GOOGLE_CLIENT_IDS: [], APPLE_AUDIENCE_IDS: [] }, { production: false })).toEqual([]);
  });
});

/** A fetch that never answers on its own; it only settles when the request's signal aborts. */
function hangingFetch() {
  const signals: AbortSignal[] = [];
  const impl = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal!;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(signal.reason));
    })) as unknown as typeof fetch;
  return { impl, signals };
}

describe('Apple HTTP timeouts', () => {
  it('9. a hanging authorization-code exchange becomes a controlled 502 after the timeout', async () => {
    const { impl, signals } = hangingFetch();
    const client = new HttpAppleRevocationClient({ fetch: impl, timeoutMs: 50 });
    const started = Date.now();
    await expect(client.exchangeAuthorizationCode('code')).rejects.toMatchObject({ statusCode: 502, message: 'Account deletion could not be completed. Please try again.' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(signals[0].aborted).toBe(true);
  });

  it('9. a per-call budget (sign-in capture) overrides the default', async () => {
    const { impl } = hangingFetch();
    const client = new HttpAppleRevocationClient({ fetch: impl, timeoutMs: 60_000 });
    const started = Date.now();
    await expect(client.exchangeAuthorizationCode('code', { timeoutMs: 50 })).rejects.toMatchObject({ statusCode: 502 });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('10. a hanging revocation becomes a controlled 502 after the timeout', async () => {
    const { impl, signals } = hangingFetch();
    const client = new HttpAppleRevocationClient({ fetch: impl, timeoutMs: 50 });
    await expect(client.revokeRefreshToken('refresh')).rejects.toMatchObject({ statusCode: 502 });
    expect(signals[0].aborted).toBe(true);
  });

  it('a response body that stalls after headers is bounded by the same timeout', async () => {
    const impl = ((_url: string, init: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
      })) as unknown as typeof fetch;
    const client = new HttpAppleRevocationClient({ fetch: impl, timeoutMs: 50 });
    await expect(client.exchangeAuthorizationCode('code')).rejects.toMatchObject({ statusCode: 502 });
  });

  it('defaults to a 10s per-request budget, sends a signed client secret and never the raw key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ refresh_token: 'apple-refresh' }) };
    }) as unknown as typeof fetch;
    const client = new HttpAppleRevocationClient({ fetch: impl });
    await expect(client.exchangeAuthorizationCode('code')).resolves.toEqual({ refreshToken: 'apple-refresh' });
    expect(calls[0].url).toBe('https://appleid.apple.com/auth/token');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(String(calls[0].init.body)).not.toContain('PRIVATE KEY');
    expect(APPLE_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('an already-revoked token still counts as revoked (idempotent retry)', async () => {
    const impl = (async () => ({ ok: false, json: async () => ({ error: 'invalid_token' }) })) as unknown as typeof fetch;
    await expect(new HttpAppleRevocationClient({ fetch: impl }).revokeRefreshToken('old')).resolves.toBeUndefined();
  });
});
