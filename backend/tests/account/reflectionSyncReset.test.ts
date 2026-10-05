import mongoose from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserReflectionModel } from '../../src/models/UserReflection';
import { UserSyncKeyModel } from '../../src/models/UserSyncKey';
import { MongooseSyncRepository } from '../../src/services/MongooseSyncRepository';
import { buildAccountTestApp } from './testApp';

/**
 * Forgotten sync password recovery (backend side): POST
 * /api/sync/reflections/reset discards ONLY the caller's encrypted
 * reflection sync state, and a master-key fingerprint stops ciphertext
 * under a replaced key from ever coming back.
 */

type App = ReturnType<typeof buildAccountTestApp>;

async function signIn({ app, googleTokens }: App, idToken: string, subject: string) {
  googleTokens.set(idToken, { providerSubject: subject });
  const res = await request(app).post('/api/auth/google').send({ idToken });
  // A fresh Google ID token for the same identity, as the reset now requires.
  googleTokens.set(`reauth-${subject}`, { providerSubject: subject });
  const credential = { provider: 'google', idToken: `reauth-${subject}` };
  return { ...(res.body.data as { token: string; refreshToken: string; user: { id: string } }), credential };
}

const syncKey = (keyFingerprint?: string) => ({
  wrappedKey: 'd3JhcHBlZA==',
  nonce: 'bm9uY2U=',
  salt: 'c2FsdA==',
  kdfIterations: 210_000,
  encryptionVersion: 2,
  ...(keyFingerprint ? { keyFingerprint } : {}),
});

const active = (verseKey: string, overrides: Record<string, unknown> = {}) => ({
  type: 'active',
  verseKey,
  ciphertext: `Y2lwaGVy-${verseKey}`,
  nonce: 'bm9uY2U=',
  encryptionVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const tombstone = (verseKey: string) => ({ type: 'tombstone', verseKey, deletedAt: '2026-01-02T00:00:00.000Z' });

function api(app: App['app'], token: string, credential?: object) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    putKey: (body: unknown) => request(app).put('/api/sync/key').set(auth).send(body as object),
    getKey: () => request(app).get('/api/sync/key').set(auth),
    patchKey: (body: unknown) => request(app).patch('/api/sync/key').set(auth).send(body as object),
    putReflections: (reflections: unknown[]) => request(app).put('/api/sync/reflections').set(auth).send({ reflections }),
    getReflections: () => request(app).get('/api/sync/reflections').set(auth),
    reset: (body: object | undefined = credential) => request(app).post('/api/sync/reflections/reset').set(auth).send(body ?? {}),
    putFavorites: (verseKeys: string[]) => request(app).put('/api/sync/favorites').set(auth).send({ verseKeys }),
    getFavorites: () => request(app).get('/api/sync/favorites').set(auth),
    putPreferences: (body: object) => request(app).put('/api/sync/preferences').set(auth).send(body),
    getPreferences: () => request(app).get('/api/sync/preferences').set(auth),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/sync/reflections/reset', () => {
  it('requires authentication', async () => {
    const { app } = buildAccountTestApp();
    expect((await request(app).post('/api/sync/reflections/reset')).status).toBe(401);
  });

  it('deletes the sync key and every reflection record — and nothing else (favorites, preferences, account, session survive)', async () => {
    const built = buildAccountTestApp();
    const { token, refreshToken, credential } = await signIn(built, 'id-a', 'sub-a');
    const a = api(built.app, token, credential);
    await a.putKey(syncKey('fp-old'));
    await a.putReflections([active('1:1', { keyFingerprint: 'fp-old' }), tombstone('1:2')]);
    await a.putFavorites(['2:255']);
    await a.putPreferences({ locale: 'ar', translationDisplayMode: 'off', updatedAt: '2026-03-01T00:00:00.000Z' });

    expect((await a.reset()).status).toBe(200);

    expect((await a.getKey()).body.data).toBeNull();
    expect((await a.getReflections()).body.data).toEqual([]);
    expect((await a.getFavorites()).body.data.map((f: { verseKey: string }) => f.verseKey)).toEqual(['2:255']);
    expect((await a.getPreferences()).body.data).toMatchObject({ locale: 'ar', translationDisplayMode: 'off' });
    expect((await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(built.app).post('/api/auth/refresh').send({ refreshToken })).status).toBe(200);
  });

  it('is idempotent: a second reset, or a reset with nothing to delete, succeeds and changes nothing', async () => {
    const built = buildAccountTestApp();
    const { token, credential } = await signIn(built, 'id-a', 'sub-a');
    const a = api(built.app, token, credential);

    expect((await a.reset()).status).toBe(200); // nothing exists yet
    await a.putKey(syncKey('fp-1'));
    expect((await a.reset()).status).toBe(200);
    expect((await a.reset()).status).toBe(200);
    expect((await a.getKey()).body.data).toBeNull();
    // A fresh key can be created afterwards.
    expect((await a.putKey(syncKey('fp-2'))).status).toBe(200);
  });

  it('only ever resets the signed-in account: B resetting never touches A, and naming A in the body is refused outright', async () => {
    const built = buildAccountTestApp();
    const userA = await signIn(built, 'id-a', 'sub-a');
    const userB = await signIn(built, 'id-b', 'sub-b');
    const a = api(built.app, userA.token, userA.credential);
    const b = api(built.app, userB.token, userB.credential);
    await a.putKey(syncKey('fp-a'));
    await a.putReflections([active('3:1', { keyFingerprint: 'fp-a' })]);
    await b.putKey(syncKey('fp-b'));
    await b.putReflections([active('3:2', { keyFingerprint: 'fp-b' })]);

    expect((await b.reset({ ...userB.credential, userId: userA.user.id })).status).toBe(400);
    expect((await b.getKey()).body.data).toMatchObject({ keyFingerprint: 'fp-b' }); // refused: nothing reset
    expect((await b.reset()).status).toBe(200);

    expect((await a.getKey()).body.data).toMatchObject({ keyFingerprint: 'fp-a' });
    expect((await a.getReflections()).body.data.map((r: { verseKey: string }) => r.verseKey)).toEqual(['3:1']);
    expect((await b.getKey()).body.data).toBeNull();
    expect((await b.getReflections()).body.data).toEqual([]);
  });
});

describe('stale ciphertext can never come back after a reset', () => {
  it('uploads under any other key (or with no key fingerprint) are refused once the account key has a fingerprint', async () => {
    const built = buildAccountTestApp();
    const { token, credential } = await signIn(built, 'id-a', 'sub-a');
    const a = api(built.app, token, credential);
    await a.putKey(syncKey('fp-new'));

    expect((await a.putReflections([active('4:1', { keyFingerprint: 'fp-old' })])).status).toBe(409);
    expect((await a.putReflections([active('4:2')])).status).toBe(409);
    expect((await a.getReflections()).body.data).toEqual([]);

    expect((await a.putReflections([active('4:3', { keyFingerprint: 'fp-new' })])).status).toBe(200);
    expect((await a.putReflections([tombstone('4:4')])).status).toBe(200); // deletion markers carry no ciphertext
  });

  it('ciphertext uploaded by another device between the reset and the new key is removed when the new key is created', async () => {
    const built = buildAccountTestApp();
    const { token, credential } = await signIn(built, 'id-a', 'sub-a');
    const a = api(built.app, token, credential);
    await a.putKey(syncKey('fp-old'));
    await a.reset();

    // A second device still holding the old key syncs in the gap.
    expect((await a.putReflections([active('5:1', { keyFingerprint: 'fp-old' }), tombstone('5:2')])).status).toBe(200);

    expect((await a.putKey(syncKey('fp-new'))).status).toBe(200);
    const remaining = (await a.getReflections()).body.data as { verseKey: string; type: string }[];
    expect(remaining.map((r) => r.verseKey)).toEqual(['5:2']);
    expect(remaining[0].type).toBe('tombstone');
  });

  it('a password change keeps the key fingerprint (same master key)', async () => {
    const built = buildAccountTestApp();
    const { token, credential } = await signIn(built, 'id-a', 'sub-a');
    const a = api(built.app, token, credential);
    const original = (await a.putKey(syncKey('fp-1'))).body.data;

    const replaced = await a.patchKey({ expected: original, replacement: { ...syncKey('fp-1'), salt: 'bmV3LXNhbHQ=' } });

    expect(replaced.status).toBe(200);
    expect((await a.getKey()).body.data).toMatchObject({ keyFingerprint: 'fp-1', salt: 'bmV3LXNhbHQ=' });
  });

  it('accounts whose key predates fingerprints keep syncing exactly as before', async () => {
    const built = buildAccountTestApp();
    const { token, credential } = await signIn(built, 'id-a', 'sub-a');
    const a = api(built.app, token, credential);
    await a.putKey(syncKey());

    expect((await a.getKey()).body.data).not.toHaveProperty('keyFingerprint');
    expect((await a.putReflections([active('6:1')])).status).toBe(200);
  });
});

describe('MongooseSyncRepository reset queries', () => {
  it('deletes only this user\'s reflections and sync key, inside one transaction', async () => {
    const calls: string[] = [];
    const session = {
      withTransaction: vi.fn(async (work: () => Promise<void>) => work()),
      endSession: vi.fn(async () => undefined),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const reflectionDelete = vi.spyOn(UserReflectionModel, 'deleteMany').mockImplementation(((filter: unknown) => {
      calls.push(`reflections ${JSON.stringify(filter)}`);
      return { session: vi.fn(async () => ({ deletedCount: 0 })) };
    }) as never);
    const keyDelete = vi.spyOn(UserSyncKeyModel, 'deleteMany').mockImplementation(((filter: unknown) => {
      calls.push(`key ${JSON.stringify(filter)}`);
      return { session: vi.fn(async () => ({ deletedCount: 0 })) };
    }) as never);

    await new MongooseSyncRepository().resetReflectionSync('user-1');

    expect(calls).toEqual(['reflections {"userId":"user-1"}', 'key {"userId":"user-1"}']);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(reflectionDelete).toHaveBeenCalledTimes(1);
    expect(keyDelete).toHaveBeenCalledTimes(1);
  });

  it('removes only active records under another key, never deletion markers or another user\'s data', async () => {
    const deleteMany = vi.spyOn(UserReflectionModel, 'deleteMany').mockResolvedValue({ deletedCount: 0 } as never);

    await new MongooseSyncRepository().deleteReflectionsNotEncryptedWith('user-1', 'fp-new');

    expect(deleteMany).toHaveBeenCalledWith({ userId: 'user-1', deleted: { $ne: true }, keyFingerprint: { $ne: 'fp-new' } });
  });
});
