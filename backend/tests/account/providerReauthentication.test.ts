import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The real verifiers read their audiences from the environment (see env.ts).
vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_IDS = 'test-google-client';
  process.env.APPLE_AUDIENCE_IDS = 'com.quranheals.app';
});

import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

import { AppleJwksVerifier } from '../../src/auth/appleTokenVerifier';
import { GoogleAuthLibraryVerifier } from '../../src/auth/googleTokenVerifier';
import { REAUTH_MAX_AGE_MS } from '../../src/auth/providerReauthentication';
import { UserModel } from '../../src/models/User';
import { UserSyncKeyModel } from '../../src/models/UserSyncKey';
import { MongooseSyncRepository } from '../../src/services/MongooseSyncRepository';
import { MongooseUserRepository } from '../../src/services/MongooseUserRepository';
import { buildAccountTestApp } from './testApp';

/**
 * Resetting encrypted reflection sync (forgotten sync password) requires a
 * FRESH Apple/Google ID token for the identity that owns the signed-in Quran
 * Heals account — a valid Quran Heals session alone is not enough.
 */

type Provider = 'apple' | 'google';
type Built = ReturnType<typeof buildAccountTestApp>;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function registerToken(built: Built, provider: Provider, idToken: string, identity: { providerSubject: string; issuedAt?: number }) {
  (provider === 'apple' ? built.appleTokens : built.googleTokens).set(idToken, identity as never);
}

/** Signs in with `provider`/`subject` and gives the account a sync key, a reflection, a favorite and preferences. */
async function accountWithSyncData(built: Built, provider: Provider, subject: string) {
  registerToken(built, provider, `signin-${subject}`, { providerSubject: subject });
  const signIn = await request(built.app).post(`/api/auth/${provider}`).send({ idToken: `signin-${subject}` });
  const token = signIn.body.data.token as string;
  const auth = { Authorization: `Bearer ${token}` };
  await request(built.app).put('/api/sync/key').set(auth).send({
    wrappedKey: 'd3JhcHBlZA==', nonce: 'bm9uY2U=', salt: 'c2FsdA==', kdfIterations: 210_000, encryptionVersion: 2, keyFingerprint: `fp-${subject}`,
  });
  await request(built.app).put('/api/sync/reflections').set(auth).send({ reflections: [{
    type: 'active', verseKey: '1:1', ciphertext: 'Y2lwaGVy', nonce: 'bm9uY2U=', encryptionVersion: 1, keyFingerprint: `fp-${subject}`,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }] });
  await request(built.app).put('/api/sync/favorites').set(auth).send({ verseKeys: ['2:255'] });
  await request(built.app).put('/api/sync/preferences').set(auth).send({ locale: 'ar', translationDisplayMode: 'off', updatedAt: '2026-03-01T00:00:00.000Z' });

  const reset = (body: object) => request(built.app).post('/api/sync/reflections/reset').set(auth).send(body);
  const state = async () => ({
    key: (await request(built.app).get('/api/sync/key').set(auth)).body.data,
    reflections: (await request(built.app).get('/api/sync/reflections').set(auth)).body.data as unknown[],
    favorites: ((await request(built.app).get('/api/sync/favorites').set(auth)).body.data as { verseKey: string }[]).map((f) => f.verseKey),
    preferences: (await request(built.app).get('/api/sync/preferences').set(auth)).body.data,
  });
  return { token, auth, reset, state, userId: signIn.body.data.user.id as string };
}

async function expectUntouched(account: Awaited<ReturnType<typeof accountWithSyncData>>, subject: string) {
  const current = await account.state();
  expect(current.key).toMatchObject({ keyFingerprint: `fp-${subject}` });
  expect(current.reflections).toHaveLength(1);
  expect(current.favorites).toEqual(['2:255']);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(['apple', 'google'] as const)('%s account', (provider) => {
  const subject = `${provider}-user-a`;

  it(`correct ${provider} identity → reset allowed; favorites and preferences unaffected`, async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, provider, subject);
    registerToken(built, provider, 'fresh', { providerSubject: subject });

    const res = await account.reset({ provider, idToken: 'fresh' });

    expect(res.status).toBe(200);
    const after = await account.state();
    expect(after.key).toBeNull();
    expect(after.reflections).toEqual([]);
    expect(after.favorites).toEqual(['2:255']);
    expect(after.preferences).toMatchObject({ locale: 'ar', translationDisplayMode: 'off' });
  });

  it(`different ${provider} account → rejected, nothing reset`, async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, provider, subject);
    registerToken(built, provider, 'someone-else', { providerSubject: `${provider}-user-b` });

    expect((await account.reset({ provider, idToken: 'someone-else' })).status).toBe(403);
    await expectUntouched(account, subject);
  });

  it(`a valid ${provider} token belonging to ANOTHER Quran Heals user → rejected`, async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, provider, subject);
    const other = await accountWithSyncData(built, provider, `${provider}-user-b`);
    registerToken(built, provider, 'other-users-token', { providerSubject: `${provider}-user-b` });

    expect((await account.reset({ provider, idToken: 'other-users-token' })).status).toBe(403);
    await expectUntouched(account, subject);
    await expectUntouched(other, `${provider}-user-b`);
  });

  it(`invalid / expired ${provider} token → rejected`, async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, provider, subject);

    expect((await account.reset({ provider, idToken: 'not-a-valid-token' })).status).toBe(403);
    await expectUntouched(account, subject);
  });

  it(`missing ${provider} credential → rejected (a Quran Heals session alone is not enough)`, async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, provider, subject);

    expect((await account.reset({})).status).toBe(400);
    expect((await account.reset({ provider })).status).toBe(400);
    expect((await account.reset({ provider, idToken: '' })).status).toBe(400);
    await expectUntouched(account, subject);
  });

  it(`a forged identity claim without a valid ${provider} token → rejected`, async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, provider, subject);

    // Extra identity fields are refused outright (strict body)…
    expect((await account.reset({ provider, idToken: 'forged', providerSubject: subject, userId: account.userId })).status).toBe(400);
    // …and a made-up token is rejected by the provider verifier.
    expect((await account.reset({ provider, idToken: `forged-${subject}` })).status).toBe(403);
    await expectUntouched(account, subject);
  });

  it(`a stale ${provider} token (older than the freshness window), or one dated in the future, or without an issue time → rejected`, async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, provider, subject);
    registerToken(built, provider, 'stale', { providerSubject: subject, issuedAt: nowSeconds() - REAUTH_MAX_AGE_MS / 1000 - 5 });
    registerToken(built, provider, 'future', { providerSubject: subject, issuedAt: nowSeconds() + 600 });
    registerToken(built, provider, 'no-iat', { providerSubject: subject, issuedAt: undefined });

    for (const idToken of ['stale', 'future', 'no-iat']) {
      expect((await account.reset({ provider, idToken })).status).toBe(403);
    }
    await expectUntouched(account, subject);
  });
});

describe('cross-provider', () => {
  it('an Apple-only account cannot be confirmed with Google — even a valid Google token for the same person', async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, 'apple', 'shared-person');
    registerToken(built, 'google', 'google-token', { providerSubject: 'shared-person' });

    expect((await account.reset({ provider: 'google', idToken: 'google-token' })).status).toBe(403);
    expect((await account.reset({ provider: 'apple', idToken: 'google-token' })).status).toBe(403);
    await expectUntouched(account, 'shared-person');
  });

  it('a Google-only account cannot be confirmed with Apple', async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, 'google', 'shared-person');
    registerToken(built, 'apple', 'apple-token', { providerSubject: 'shared-person' });

    expect((await account.reset({ provider: 'apple', idToken: 'apple-token' })).status).toBe(403);
    expect((await account.reset({ provider: 'google', idToken: 'apple-token' })).status).toBe(403);
    await expectUntouched(account, 'shared-person');
  });
});

describe('session and replay', () => {
  it('requires the Quran Heals session too: a valid provider token without it → 401', async () => {
    const built = buildAccountTestApp();
    await accountWithSyncData(built, 'google', 'g-a');
    registerToken(built, 'google', 'fresh', { providerSubject: 'g-a' });

    const res = await request(built.app).post('/api/sync/reflections/reset').send({ provider: 'google', idToken: 'fresh' });
    expect(res.status).toBe(401);
  });

  it('a deleted account cannot be reset — its old access token is rejected by requireAuth before reauthentication is even checked', async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, 'google', 'g-a');
    registerToken(built, 'google', 'fresh', { providerSubject: 'g-a' });
    expect((await request(built.app).delete('/api/account').set(account.auth).send({ provider: 'google', idToken: 'fresh' })).status).toBe(200);

    // The deleted account's own (still cryptographically valid) access
    // token no longer authorizes any protected request at all — 401, not
    // the reauthentication-mismatch 403 this would have hit previously.
    expect((await account.reset({ provider: 'google', idToken: 'fresh' })).status).toBe(401);
  });

  it('one provider token can never be replayed to delete a sync key created after it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, 'google', 'g-a'); // old key created at `start`

    vi.setSystemTime(start + 2 * 60 * 1000);
    registerToken(built, 'google', 'fresh', { providerSubject: 'g-a', issuedAt: nowSeconds() - 30 });
    expect((await account.reset({ provider: 'google', idToken: 'fresh' })).status).toBe(200);

    vi.setSystemTime(start + 3 * 60 * 1000); // the user creates a new password/key
    await request(built.app).put('/api/sync/key').set(account.auth).send({
      wrappedKey: 'bmV3', nonce: 'bm9uY2U=', salt: 'c2FsdA==', kdfIterations: 210_000, encryptionVersion: 2, keyFingerprint: 'fp-new',
    });

    vi.setSystemTime(start + 4 * 60 * 1000); // still inside the freshness window
    expect((await account.reset({ provider: 'google', idToken: 'fresh' })).status).toBe(403);
    expect((await account.state()).key).toMatchObject({ keyFingerprint: 'fp-new' });
  });

  it('a token issued in the same second the key was created is still accepted (whole-second iat)', async () => {
    const built = buildAccountTestApp();
    const account = await accountWithSyncData(built, 'google', 'g-a');
    registerToken(built, 'google', 'fresh', { providerSubject: 'g-a', issuedAt: nowSeconds() });

    expect((await account.reset({ provider: 'google', idToken: 'fresh' })).status).toBe(200);
  });
});

describe('real provider verifiers report the token issue time', () => {
  it('Google: issuedAt comes from the verified payload', async () => {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ sub: 'g-sub', iat: 1_700_000_000, email: 'a@example.com', email_verified: true }),
    } as never);
    await expect(new GoogleAuthLibraryVerifier().verifyIdToken('token')).resolves.toMatchObject({ providerSubject: 'g-sub', issuedAt: 1_700_000_000 });
  });

  it('Apple: issuedAt comes from the verified payload', async () => {
    vi.spyOn(jwt, 'verify').mockImplementation(((_token: string, _key: unknown, _options: unknown, callback: (error: null, decoded: object) => void) => {
      callback(null, { sub: 'a-sub', iat: 1_700_000_001 });
    }) as never);
    await expect(new AppleJwksVerifier().verifyIdToken('token')).resolves.toMatchObject({ providerSubject: 'a-sub', issuedAt: 1_700_000_001 });
  });
});

describe('MongoDB lookups', () => {
  it('the account identity comes from the stored user document, by session user id', async () => {
    const lean = vi.fn().mockResolvedValue({ provider: 'apple', providerSubject: 'apple-sub', email: 'x@privaterelay.appleid.com' });
    const findById = vi.spyOn(UserModel, 'findById').mockReturnValue({ lean } as never);

    await expect(new MongooseUserRepository().findProviderIdentity('64b7f0c2a1b2c3d4e5f60718'))
      .resolves.toEqual({ provider: 'apple', providerSubject: 'apple-sub' });
    expect(findById).toHaveBeenCalledWith('64b7f0c2a1b2c3d4e5f60718');
  });

  it('the sync key creation time is read for this user only', async () => {
    const createdAt = new Date('2026-05-01T00:00:00.000Z');
    const lean = vi.fn().mockResolvedValue({ createdAt });
    const findOne = vi.spyOn(UserSyncKeyModel, 'findOne').mockReturnValue({ select: () => ({ lean }) } as never);

    await expect(new MongooseSyncRepository().getSyncKeyCreatedAt('user-1')).resolves.toEqual(createdAt);
    expect(findOne).toHaveBeenCalledWith({ userId: 'user-1' });
  });
});
