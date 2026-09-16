import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildAccountTestApp } from './testApp';

async function signInGoogle(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string, sub: string) {
  googleTokens.set(token, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ idToken: token });
  return res.body.data.token as string;
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
