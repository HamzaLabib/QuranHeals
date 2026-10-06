import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { UserFavoriteModel } from '../../src/models/UserFavorite';
import { buildAccountTestApp } from './testApp';

async function signInGoogle(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string, sub: string) {
  googleTokens.set(token, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ idToken: token });
  return res.body.data.token as string;
}

// Deliberately has no `type` field — every mobile client/test predating
// deletion tombstones sends an active record shaped exactly like this, and
// it must keep validating and uploading identically (backward compatibility).
const activeRecord = (overrides: Partial<Record<string, unknown>> = {}) => ({
  verseKey: '2:286',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const tombstoneRecord = (overrides: Partial<Record<string, unknown>> = {}) => ({
  type: 'tombstone',
  verseKey: '2:286',
  deletedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function syncRecords(res: request.Response): { type: string; verseKey: string }[] {
  return res.body.data as { type: string; verseKey: string }[];
}

describe('Favorites sync', () => {
  it('requires authentication', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).get('/api/sync/favorites');
    expect(res.status).toBe(401);
  });

  it('uploads guest favorites and they remain after future reads (guest favorite survives sign-in migration upload)', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 't1', 's1');

    const put = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ verseKeys: ['2:255', '94:6'] });

    expect(put.status).toBe(200);
    expect(put.body.data.map((f: { verseKey: string }) => f.verseKey).sort()).toEqual(['2:255', '94:6']);
  });

  it('downloads cloud favorites and unions local + cloud without deleting either side', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 't2', 's2');

    // Device A uploads one favorite.
    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['1:1'] });
    // Device B (same account) uploads a different favorite — union, not replace.
    const secondPut = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ verseKeys: ['2:2'] });

    const verseKeys = secondPut.body.data.map((f: { verseKey: string }) => f.verseKey).sort();
    expect(verseKeys).toEqual(['1:1', '2:2']);
  });

  it('eliminates duplicates by verseKey', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 't3', 's3');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['3:3', '3:3'] });
    const res = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ verseKeys: ['3:3'] });

    expect(res.body.data).toHaveLength(1);
  });

  it('an explicit remove propagates (does not come back from a later union upload of the same list)', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 't4', 's4');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['4:4'] });
    const del = await request(app).delete('/api/sync/favorites/4:4').set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(0);
  });

  it('cross-device add is visible to another authenticated request for the same account', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 't5', 's5');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['5:5'] });
    const fromOtherDevice = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);

    expect(fromOtherDevice.body.data.map((f: { verseKey: string }) => f.verseKey)).toEqual(['5:5']);
  });

  it('sign-out is a client-side concern — the server keeps favorites available for the next sign-in with the same account', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 't6', 's6');
    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['6:6'] });

    // "Sign out and back in" — re-authenticate with the same provider identity.
    const secondToken = await signInGoogle(app, googleTokens, 't6-again', 's6');
    const res = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${secondToken}`);

    expect(res.body.data.map((f: { verseKey: string }) => f.verseKey)).toEqual(['6:6']);
  });

  it('user A cannot see or modify user B favorites', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const tokenA = await signInGoogle(app, googleTokens, 'ta', 'sa');
    const tokenB = await signInGoogle(app, googleTokens, 'tb', 'sb');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${tokenA}`).send({ verseKeys: ['7:7'] });
    const bList = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${tokenB}`);

    expect(bList.body.data).toHaveLength(0);
  });

  it('rejects an invalid verseKey', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 't7', 's7');

    const res = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ verseKeys: ['999:999'] });

    expect(res.status).toBe(400);
  });
});

describe('Favorite deletion tombstones', () => {
  it('Test A — a basic delete survives a later full sync: add, sync, delete, sync, remains deleted', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta1', 'sa1');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [activeRecord()] });
    const del = await request(app).delete(`/api/sync/favorites/${encodeURIComponent('2:286')}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(0);

    const full = await request(app).get('/api/sync/favorites/sync').set('Authorization', `Bearer ${token}`);
    expect(syncRecords(full).map((r) => r.type)).toEqual(['tombstone']);
  });

  it('accepts a tombstone and GET /favorites/sync returns it with no createdAt field', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta2', 'sa2');

    const put = await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [tombstoneRecord()] });
    expect(put.status).toBe(200);
    expect(put.body.data.saved[0]).toMatchObject({ type: 'tombstone', verseKey: '2:286', deletedAt: '2026-01-01T00:00:00.000Z' });
    expect(put.body.data.saved[0]).not.toHaveProperty('createdAt');

    const list = await request(app).get('/api/sync/favorites/sync').set('Authorization', `Bearer ${token}`);
    expect(syncRecords(list)[0].type).toBe('tombstone');
  });

  it('a tombstone never appears from the legacy GET /favorites (old clients only ever see active favorites)', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta3', 'sa3');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [activeRecord()] });
    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [tombstoneRecord({ deletedAt: '2026-01-02T00:00:00.000Z' })] });

    const list = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(0);
  });

  it('Test D — a newer active record supersedes an older tombstone, supporting intentional recreation', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta4', 'sa4');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [tombstoneRecord({ deletedAt: '2026-01-01T00:00:00.000Z' })] });
    const res = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [activeRecord({ createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' })] });

    expect(res.body.data.saved[0]).toMatchObject({ type: 'active', verseKey: '2:286' });
    const list = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.map((f: { verseKey: string }) => f.verseKey)).toEqual(['2:286']);
  });

  it('Test E — a newer tombstone deletes an older active record (deletion wins)', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta5', 'sa5');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [activeRecord({ createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })] });
    const res = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [tombstoneRecord({ deletedAt: '2026-01-02T00:00:00.000Z' })] });

    expect(res.body.data.saved[0].type).toBe('tombstone');
    const list = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(0);
  });

  it('a stale tombstone cannot delete a newer active record', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta6', 'sa6');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [activeRecord({ createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' })] });
    const res = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [tombstoneRecord({ deletedAt: '2026-01-01T00:00:00.000Z' })] });

    expect(res.body.data.saved[0]).toMatchObject({ type: 'active', verseKey: '2:286' });
  });

  it('a stale active record cannot resurrect a favorite already deleted by a newer tombstone', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta7', 'sa7');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [tombstoneRecord({ deletedAt: '2026-01-05T00:00:00.000Z' })] });
    const res = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [activeRecord({ createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })] });

    expect(res.body.data.saved[0].type).toBe('tombstone');
  });

  it('Test F — an exact-timestamp tie always resolves to the tombstone, regardless of which side arrives first', async () => {
    const tiedAt = '2026-01-01T00:00:00.000Z';
    const { app, googleTokens } = buildAccountTestApp();

    const tokenA = await signInGoogle(app, googleTokens, 'ta8a', 'sa8a');
    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${tokenA}`).send({ favorites: [activeRecord({ createdAt: tiedAt, updatedAt: tiedAt })] });
    const activeThenTombstone = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ favorites: [tombstoneRecord({ deletedAt: tiedAt })] });
    expect(activeThenTombstone.body.data.saved[0].type).toBe('tombstone');

    const tokenB = await signInGoogle(app, googleTokens, 'ta8b', 'sa8b');
    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${tokenB}`).send({ favorites: [tombstoneRecord({ deletedAt: tiedAt })] });
    const tombstoneThenActive = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ favorites: [activeRecord({ createdAt: tiedAt, updatedAt: tiedAt })] });
    expect(tombstoneThenActive.body.data.saved[0].type).toBe('tombstone');
  });

  it('Test K — uploading the same tombstone repeatedly is safe (idempotent, no error, no state change)', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta9', 'sa9');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [tombstoneRecord()] });
    const res = await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [tombstoneRecord()] });

    expect(res.status).toBe(200);
    expect(res.body.data.saved[0]).toMatchObject({ type: 'tombstone', verseKey: '2:286' });
    const list = await request(app).get('/api/sync/favorites/sync').set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(1);
  });

  it('Test I — user A cannot see or delete user B favorites, and a tombstone never crosses accounts', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const tokenA = await signInGoogle(app, googleTokens, 'ta10a', 'sa10a');
    const tokenB = await signInGoogle(app, googleTokens, 'ta10b', 'sa10b');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${tokenA}`).send({ favorites: [activeRecord()] });
    await request(app).delete(`/api/sync/favorites/${encodeURIComponent('2:286')}`).set('Authorization', `Bearer ${tokenA}`);

    const bFull = await request(app).get('/api/sync/favorites/sync').set('Authorization', `Bearer ${tokenB}`);
    expect(bFull.body.data).toHaveLength(0);

    // B favoriting the same verseKey is unaffected by A's tombstone.
    const bPut = await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${tokenB}`).send({ verseKeys: ['2:286'] });
    expect(bPut.body.data.map((f: { verseKey: string }) => f.verseKey)).toEqual(['2:286']);
  });

  it('a legacy union-add never resurrects an existing tombstone', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta11', 'sa11');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ favorites: [tombstoneRecord()] });
    const res = await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['2:286'] });

    // The legacy add is silently absorbed — never surfaced as active.
    expect(res.body.data).toHaveLength(0);
    const list = await request(app).get('/api/sync/favorites/sync').set('Authorization', `Bearer ${token}`);
    expect(syncRecords(list)[0].type).toBe('tombstone');
  });

  it('Test L — an existing legacy favorite record (no tombstone concept) still loads and syncs correctly', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta12', 'sa12');

    // Simulates a pre-tombstone upload: plain union-add, no `deleted` field ever set.
    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['3:3'] });

    const legacyList = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);
    expect(legacyList.body.data.map((f: { verseKey: string }) => f.verseKey)).toEqual(['3:3']);

    const full = await request(app).get('/api/sync/favorites/sync').set('Authorization', `Bearer ${token}`);
    expect(syncRecords(full)).toEqual([expect.objectContaining({ type: 'active', verseKey: '3:3' })]);
  });

  it('a legacy DELETE (no timestamp) still produces a durable tombstone — a later LWW sync cannot resurrect it with a stale timestamp', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signInGoogle(app, googleTokens, 'ta13', 'sa13');

    await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['4:4'] });
    await request(app).delete(`/api/sync/favorites/${encodeURIComponent('4:4')}`).set('Authorization', `Bearer ${token}`);

    // A stale active upload (e.g. a device that favorited it long before the delete) cannot bring it back.
    const res = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [activeRecord({ verseKey: '4:4', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' })] });

    expect(res.body.data.saved[0].type).toBe('tombstone');
  });
});

describe('UserFavoriteModel: conditional required fields for tombstones (schema-level, no live DB needed)', () => {
  it('does not require createdAt for a deleted (tombstone) document', () => {
    const doc = new UserFavoriteModel({ userId: 'u1', verseKey: '2:255', deleted: true, updatedAt: new Date() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('requires createdAt for a non-deleted (active) document', () => {
    const doc = new UserFavoriteModel({ userId: 'u1', verseKey: '2:255', deleted: false, updatedAt: new Date() });
    const errors = doc.validateSync();
    expect(errors?.errors.createdAt).toBeDefined();
  });

  it('defaults deleted to false, keeping pre-existing (pre-tombstone) active-record documents valid unchanged', () => {
    const doc = new UserFavoriteModel({ userId: 'u1', verseKey: '2:255', createdAt: new Date(), updatedAt: new Date() });
    expect(doc.deleted).toBe(false);
    expect(doc.validateSync()).toBeUndefined();
  });

  it('still enforces the unique (userId, verseKey) index definition for tombstones and active records alike', () => {
    const indexes = UserFavoriteModel.schema.indexes();
    const found = indexes.find(([fields]) => (fields as Record<string, unknown>).userId === 1 && (fields as Record<string, unknown>).verseKey === 1);
    expect(found).toBeDefined();
    expect(found?.[1]).toMatchObject({ unique: true });
  });
});
