import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildAccountTestApp } from './testApp';

/**
 * D5: GET /api/sync/reflections/conflicts exposes the ciphertext versions
 * the backend already preserves on an exact-timestamp conflict, so the
 * owning user's device can decrypt and offer them for recovery. Read-only,
 * ciphertext-only, per account.
 */

async function signIn(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string) {
  googleTokens.set(token, { providerSubject: `sub-${token}` });
  return (await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: token })).body.data.token as string;
}

const active = (ciphertext: string, nonce: string, updatedAt = '2026-01-01T00:00:00.000Z') => ({
  type: 'active',
  verseKey: '2:286',
  ciphertext,
  nonce,
  encryptionVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
});

describe('GET /api/sync/reflections/conflicts', () => {
  it('requires authentication', async () => {
    const { app } = buildAccountTestApp();
    await request(app).get('/api/sync/reflections/conflicts').expect(401);
  });

  it('is empty when nothing conflicted', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'a');
    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections: [active('Y2lwaGVyLWE=', 'bm9uY2UtYQ==')] });
    const res = await request(app).get('/api/sync/reflections/conflicts').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('returns every preserved version (ciphertext only) after same-timestamp conflicts, without changing the current record', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'a');
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).put('/api/sync/reflections').set(auth).send({ reflections: [active('Y2lwaGVyLWE=', 'bm9uY2UtYQ==')] });
    await request(app).put('/api/sync/reflections').set(auth).send({ reflections: [active('Y2lwaGVyLWI=', 'bm9uY2UtYg==')] });
    // A duplicate of an already-preserved upload is reported again by the
    // server; the client de-duplicates by content.
    await request(app).put('/api/sync/reflections').set(auth).send({ reflections: [active('Y2lwaGVyLWM=', 'bm9uY2UtYw==')] });

    const res = await request(app).get('/api/sync/reflections/conflicts').set(auth).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].verseKey).toBe('2:286');
    expect(res.body.data[0].conflictVersions.map((version: { nonce: string }) => version.nonce)).toEqual(['bm9uY2UtYg==', 'bm9uY2UtYw==']);
    expect(Object.keys(res.body.data[0].conflictVersions[0]).sort()).toEqual(['ciphertext', 'createdAt', 'encryptionVersion', 'nonce']);

    const current = await request(app).get('/api/sync/reflections').set(auth).expect(200);
    expect(current.body.data[0].ciphertext).toBe('Y2lwaGVyLWE=');
  });

  it('never returns another account\'s conflicts', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const alice = await signIn(app, googleTokens, 'alice');
    const bob = await signIn(app, googleTokens, 'bob');
    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${alice}`).send({ reflections: [active('Y2lwaGVyLWE=', 'bm9uY2UtYQ==')] });
    await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${alice}`).send({ reflections: [active('Y2lwaGVyLWI=', 'bm9uY2UtYg==')] });

    const res = await request(app).get('/api/sync/reflections/conflicts').set('Authorization', `Bearer ${bob}`).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('leaves out a verse whose reflection was later deleted', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'a');
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).put('/api/sync/reflections').set(auth).send({ reflections: [active('Y2lwaGVyLWE=', 'bm9uY2UtYQ==')] });
    await request(app).put('/api/sync/reflections').set(auth).send({ reflections: [active('Y2lwaGVyLWI=', 'bm9uY2UtYg==')] });
    await request(app).put('/api/sync/reflections').set(auth).send({ reflections: [{ type: 'tombstone', verseKey: '2:286', deletedAt: '2026-02-01T00:00:00.000Z' }] });

    const res = await request(app).get('/api/sync/reflections/conflicts').set(auth).expect(200);
    expect(res.body.data).toEqual([]);
  });
});
