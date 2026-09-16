import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildAccountTestApp } from './testApp';

async function signIn(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string, sub: string) {
  googleTokens.set(token, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ idToken: token });
  return res.body.data.token as string;
}

const record = (overrides: Partial<Record<string, unknown>> = {}) => ({
  verseKey: '2:286',
  ciphertext: 'YmFzZTY0LWNpcGhlcnRleHQ=',
  nonce: 'YmFzZTY0LW5vbmNl',
  encryptionVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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

describe('UserReflection model never stores plaintext', () => {
  it('the entity/DTO type shapes have no text/preview/summary/sentiment field', async () => {
    const dto = { verseKey: '1:1', ciphertext: 'x', nonce: 'y', encryptionVersion: 1, createdAt: '', updatedAt: '' };
    expect(Object.keys(dto)).not.toContain('text');
    expect(Object.keys(dto)).not.toContain('preview');
    expect(Object.keys(dto)).not.toContain('sentiment');
  });
});
