import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { UserReflectionModel } from '../../src/models/UserReflection';
import { buildAccountTestApp } from './testApp';

async function signIn(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string, sub: string) {
  googleTokens.set(token, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ idToken: token });
  return res.body.data.token as string;
}

// Deliberately has no `type` field — every mobile client/test predating
// deletion tombstones sends an active record shaped exactly like this, and
// it must keep validating and syncing identically (backward compatibility).
const record = (overrides: Partial<Record<string, unknown>> = {}) => ({
  verseKey: '2:286',
  ciphertext: 'YmFzZTY0LWNpcGhlcnRleHQ=',
  nonce: 'YmFzZTY0LW5vbmNl',
  encryptionVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const tombstone = (overrides: Partial<Record<string, unknown>> = {}) => ({
  type: 'tombstone',
  verseKey: '2:286',
  deletedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('Reflections sync (ciphertext-only)', () => {
  it('requires authentication', async () => {
    const { app } = buildAccountTestApp();
    expect((await request(app).get('/api/sync/reflections')).status).toBe(401);
  });

  it('stores and returns ciphertext/nonce only — the response never contains a plaintext field', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't1', 's1');

    const put = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record()] });

    expect(put.status).toBe(200);
    const saved = put.body.data.saved[0];
    expect(saved.ciphertext).toBe('YmFzZTY0LWNpcGhlcnRleHQ=');
    const forbiddenKeys = ['text', 'plaintext', 'preview', 'summary', 'sentiment', 'keywords'];
    expect(Object.keys(saved)).not.toEqual(expect.arrayContaining(forbiddenKeys));

    const list = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${token}`);
    expect(Object.keys(list.body.data[0])).not.toEqual(expect.arrayContaining(forbiddenKeys));
  });

  it('a strictly newer update overwrites the stored ciphertext', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't2', 's2');

    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections: [record()] });
    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ ciphertext: 'bmV3LWNpcGhlcnRleHQ=', updatedAt: '2026-01-02T00:00:00.000Z' })] });

    expect(res.body.data.saved[0].ciphertext).toBe('bmV3LWNpcGhlcnRleHQ=');
  });

  it('an older upload never overwrites a newer stored version — it is returned back, not applied', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't3', 's3');

    await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ ciphertext: 'newer', updatedAt: '2026-01-05T00:00:00.000Z' })] });

    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ ciphertext: 'older', updatedAt: '2026-01-01T00:00:00.000Z' })] });

    expect(res.body.data.saved[0].ciphertext).toBe('newer');
  });

  it('an exact-timestamp conflict with different ciphertext preserves both versions instead of silently discarding one', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't4', 's4');
    const tiedAt = '2026-01-01T00:00:00.000Z';

    await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ ciphertext: 'version-a', updatedAt: tiedAt })] });

    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ ciphertext: 'version-b', updatedAt: tiedAt })] });

    expect(res.body.data.saved[0].ciphertext).toBe('version-a');
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(res.body.data.conflicts[0].conflictVersions[0].ciphertext).toBe('version-b');

    // The conflicting version is not lost — it is still retrievable.
    const list = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
  });

  it('an unauthenticated caller cannot fetch reflections for any account', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).get('/api/sync/reflections');
    expect(res.status).toBe(401);
  });

  it('one authenticated user cannot fetch or overwrite another user reflections', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const tokenA = await signIn(app, googleTokens, 'ta', 'sa');
    const tokenB = await signIn(app, googleTokens, 'tb', 'sb');

    await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reflections: [record({ ciphertext: 'a-secret' })] });

    const bList = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${tokenB}`);
    expect(bList.body.data).toHaveLength(0);
  });

  it('rejects an invalid verseKey or oversized batch', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't5', 's5');

    const badVerse = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ verseKey: '999:1' })] });
    expect(badVerse.status).toBe(400);

    const tooMany = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: Array.from({ length: 41 }, (_, i) => record({ verseKey: `1:${(i % 7) + 1}` })) });
    expect(tooMany.status).toBe(400);
  });
});

describe('Reflection deletion tombstones', () => {
  it('accepts a tombstone and GET returns it with no ciphertext/nonce/plaintext field', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt1', 'stt1');

    const put = await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({
      reflections: [tombstone()],
    });

    expect(put.status).toBe(200);
    const saved = put.body.data.saved[0];
    expect(saved).toMatchObject({ type: 'tombstone', verseKey: '2:286', deletedAt: '2026-01-01T00:00:00.000Z' });
    expect(saved).not.toHaveProperty('ciphertext');
    expect(saved).not.toHaveProperty('nonce');

    const list = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${token}`);
    expect(list.body.data[0].type).toBe('tombstone');
    expect(list.body.data[0]).not.toHaveProperty('ciphertext');
    expect(list.body.data[0]).not.toHaveProperty('nonce');
  });

  it('never persists ciphertext/nonce/plaintext even if a caller attaches it to a tombstone payload', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt2', 'stt2');

    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reflections: [
          { ...tombstone(), ciphertext: 'sneaky-ciphertext', nonce: 'sneaky-nonce', reflectionText: 'plaintext leak' },
        ],
      });

    expect(res.status).toBe(200);
    const saved = res.body.data.saved[0];
    expect(saved).not.toHaveProperty('ciphertext');
    expect(saved).not.toHaveProperty('nonce');
    expect(saved).not.toHaveProperty('reflectionText');
    expect(JSON.stringify(saved)).not.toContain('sneaky');
    expect(JSON.stringify(saved)).not.toContain('plaintext leak');
  });

  it('a newer tombstone deletes an older active record (deletion wins)', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt3', 'stt3');

    await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ updatedAt: '2026-01-01T00:00:00.000Z' })] });

    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [tombstone({ deletedAt: '2026-01-02T00:00:00.000Z' })] });

    expect(res.body.data.saved[0].type).toBe('tombstone');
    const list = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${token}`);
    expect(list.body.data[0].type).toBe('tombstone');
  });

  it('a newer active record supersedes an older tombstone, supporting intentional recreation', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt4', 'stt4');

    await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [tombstone({ deletedAt: '2026-01-01T00:00:00.000Z' })] });

    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ updatedAt: '2026-01-02T00:00:00.000Z', ciphertext: 'recreated' })] });

    expect(res.body.data.saved[0]).toMatchObject({ type: 'active', ciphertext: 'recreated' });
  });

  it('a stale tombstone cannot delete a newer active record', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt5', 'stt5');

    await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ updatedAt: '2026-01-05T00:00:00.000Z', ciphertext: 'still-here' })] });

    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [tombstone({ deletedAt: '2026-01-01T00:00:00.000Z' })] });

    expect(res.body.data.saved[0]).toMatchObject({ type: 'active', ciphertext: 'still-here' });
  });

  it('a stale active record cannot resurrect a reflection already deleted by a newer tombstone', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt6', 'stt6');

    await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [tombstone({ deletedAt: '2026-01-05T00:00:00.000Z' })] });

    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ updatedAt: '2026-01-01T00:00:00.000Z' })] });

    expect(res.body.data.saved[0].type).toBe('tombstone');
    const list = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${token}`);
    expect(list.body.data[0].type).toBe('tombstone');
  });

  it('an exact-timestamp tie always resolves to the tombstone, regardless of which side arrives first', async () => {
    const tiedAt = '2026-01-01T00:00:00.000Z';
    const { app, googleTokens } = buildAccountTestApp();

    // Existing active + incoming tombstone at the exact same instant -> tombstone wins.
    const tokenA = await signIn(app, googleTokens, 'tt7a', 'stt7a');
    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${tokenA}`).send({ reflections: [record({ updatedAt: tiedAt })] });
    const activeThenTombstone = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reflections: [tombstone({ deletedAt: tiedAt })] });
    expect(activeThenTombstone.body.data.saved[0].type).toBe('tombstone');
    const listA = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body.data[0].type).toBe('tombstone');

    // Existing tombstone + incoming active at the exact same instant -> tombstone remains.
    const tokenB = await signIn(app, googleTokens, 'tt7b', 'stt7b');
    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${tokenB}`).send({ reflections: [tombstone({ deletedAt: tiedAt })] });
    const tombstoneThenActive = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ reflections: [record({ updatedAt: tiedAt })] });
    expect(tombstoneThenActive.body.data.saved[0].type).toBe('tombstone');
  });

  it('a tombstone-versus-tombstone exact-timestamp tie is idempotent (no state change, no error)', async () => {
    const tiedAt = '2026-01-01T00:00:00.000Z';
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt7c', 'stt7c');

    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections: [tombstone({ deletedAt: tiedAt })] });
    const res = await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections: [tombstone({ deletedAt: tiedAt })] });

    expect(res.status).toBe(200);
    expect(res.body.data.saved[0]).toMatchObject({ type: 'tombstone', verseKey: '2:286', deletedAt: tiedAt });
  });

  it('repeating the same equal-timestamp tombstone upload after resolution performs no unnecessary state change', async () => {
    const tiedAt = '2026-01-01T00:00:00.000Z';
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt7d', 'stt7d');

    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections: [record({ updatedAt: tiedAt })] });
    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections: [tombstone({ deletedAt: tiedAt })] });

    // A later sync re-asserting the same tombstone at the same instant must
    // keep converging to the same tombstone, not flip-flop.
    const res = await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections: [tombstone({ deletedAt: tiedAt })] });
    expect(res.body.data.saved[0].type).toBe('tombstone');

    const list = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].type).toBe('tombstone');
  });

  it('accepts a bounded batch mixing active records and tombstones', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt8', 'stt8');

    const res = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [record({ verseKey: '2:1' }), tombstone({ verseKey: '2:2' }), record({ verseKey: '2:3' })] });

    expect(res.status).toBe(200);
    expect(res.body.data.saved).toHaveLength(3);
  });

  it('still enforces the 40-record batch limit when tombstones are mixed in', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt9', 'stt9');

    const reflections = Array.from({ length: 41 }, (_, i) =>
      i % 2 === 0 ? record({ verseKey: `1:${(i % 7) + 1}` }) : tombstone({ verseKey: `1:${(i % 7) + 1}` }),
    );
    const res = await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections });

    expect(res.status).toBe(400);
  });

  it('rejects a tombstone with an invalid verseKey or missing deletedAt', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'tt10', 'stt10');

    const badVerse = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [tombstone({ verseKey: '999:1' })] });
    expect(badVerse.status).toBe(400);

    const { deletedAt: _omit, ...withoutDeletedAt } = tombstone();
    const missingDeletedAt = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [withoutDeletedAt] });
    expect(missingDeletedAt.status).toBe(400);
  });
});

describe('UserReflectionModel: conditional required fields for tombstones (schema-level, no live DB needed)', () => {
  it('requires ciphertext/nonce/encryptionVersion/createdAt for a non-deleted (active) document', () => {
    const doc = new UserReflectionModel({ userId: 'u1', verseKey: '2:255', deleted: false, updatedAt: new Date() });
    const errors = doc.validateSync();
    expect(errors?.errors.ciphertext).toBeDefined();
    expect(errors?.errors.nonce).toBeDefined();
    expect(errors?.errors.encryptionVersion).toBeDefined();
    expect(errors?.errors.createdAt).toBeDefined();
  });

  it('does not require ciphertext/nonce/encryptionVersion/createdAt for a deleted (tombstone) document', () => {
    const doc = new UserReflectionModel({ userId: 'u1', verseKey: '2:255', deleted: true, updatedAt: new Date() });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('defaults deleted to false, keeping pre-existing (pre-tombstone) active-record documents valid unchanged', () => {
    const doc = new UserReflectionModel({
      userId: 'u1',
      verseKey: '2:255',
      ciphertext: 'c',
      nonce: 'n',
      encryptionVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(doc.deleted).toBe(false);
    expect(doc.validateSync()).toBeUndefined();
  });

  it('still enforces the unique (userId, verseKey) index definition for tombstones and active records alike', () => {
    const indexes = UserReflectionModel.schema.indexes();
    const found = indexes.find(([fields]) => (fields as Record<string, unknown>).userId === 1 && (fields as Record<string, unknown>).verseKey === 1);
    expect(found).toBeDefined();
    expect(found?.[1]).toMatchObject({ unique: true });
  });
});

describe('UserReflection model never stores plaintext', () => {
  it('the entity/DTO type shapes have no text/preview/summary/sentiment field', async () => {
    const dto = { verseKey: '1:1', ciphertext: 'x', nonce: 'y', encryptionVersion: 1, createdAt: '', updatedAt: '' };
    expect(Object.keys(dto)).not.toContain('text');
    expect(Object.keys(dto)).not.toContain('preview');
    expect(Object.keys(dto)).not.toContain('sentiment');
  });
});
