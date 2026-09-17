import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { signSessionToken, verifySessionToken } from '../../src/auth/session';
import { buildAccountTestApp } from './testApp';

describe('Multi-device sessions', () => {
  it('lets two devices sign in with the same account and both stay authenticated', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('device-a-token', { providerSubject: 'same-sub' });
    googleTokens.set('device-b-token', { providerSubject: 'same-sub' });

    const deviceA = await request(app).post('/api/auth/google').send({ idToken: 'device-a-token' });
    const deviceB = await request(app).post('/api/auth/google').send({ idToken: 'device-b-token' });

    expect(deviceA.body.data.user.id).toBe(deviceB.body.data.user.id);
    expect(deviceA.body.data.refreshToken).not.toBe(deviceB.body.data.refreshToken);

    const sessionA = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${deviceA.body.data.token}`);
    const sessionB = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${deviceB.body.data.token}`);
    expect(sessionA.status).toBe(200);
    expect(sessionB.status).toBe(200);
  });

  it('refreshing Device A does not invalidate Device B, and vice versa', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('a-token', { providerSubject: 'same-sub' });
    googleTokens.set('b-token', { providerSubject: 'same-sub' });

    const deviceA = await request(app).post('/api/auth/google').send({ idToken: 'a-token' });
    const deviceB = await request(app).post('/api/auth/google').send({ idToken: 'b-token' });

    const refreshedA = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: deviceA.body.data.refreshToken });
    expect(refreshedA.status).toBe(200);
    expect(typeof refreshedA.body.data.token).toBe('string');
    expect(refreshedA.body.data.refreshToken).not.toBe(deviceA.body.data.refreshToken);

    // Device B's original access token and refresh token both still work.
    const sessionB = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${deviceB.body.data.token}`);
    expect(sessionB.status).toBe(200);

    const refreshedB = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: deviceB.body.data.refreshToken });
    expect(refreshedB.status).toBe(200);

    // And refreshing B afterward still doesn't touch A's new (rotated) session.
    const secondRefreshA = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshedA.body.data.refreshToken });
    expect(secondRefreshA.status).toBe(200);
  });

  it('rotation issues an access token that resolves to the correct user', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('token', { providerSubject: 'sub-rotate' });
    const signIn = await request(app).post('/api/auth/google').send({ idToken: 'token' });

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: signIn.body.data.refreshToken });
    expect(verifySessionToken(refreshed.body.data.token).userId).toBe(signIn.body.data.user.id);
  });

  it('rejects an already-rotated (reused) refresh token and revokes that session entirely', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('token', { providerSubject: 'sub-reuse' });
    const signIn = await request(app).post('/api/auth/google').send({ idToken: 'token' });
    const originalRefreshToken = signIn.body.data.refreshToken;

    const firstRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: originalRefreshToken });
    expect(firstRefresh.status).toBe(200);

    // Reusing the now-superseded token must fail...
    const reused = await request(app).post('/api/auth/refresh').send({ refreshToken: originalRefreshToken });
    expect(reused.status).toBe(401);

    // ...and the reuse attempt must have revoked the session, so even the
    // legitimately-rotated token from the first refresh no longer works.
    const afterReuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: firstRefresh.body.data.refreshToken });
    expect(afterReuse.status).toBe(401);
  });

  it('rejects a malformed/unknown refresh token', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-real-refresh-token' });
    expect(res.status).toBe(401);
  });

  it('normal logout revokes only the current device session, not other devices', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('a-token', { providerSubject: 'same-sub' });
    googleTokens.set('b-token', { providerSubject: 'same-sub' });

    const deviceA = await request(app).post('/api/auth/google').send({ idToken: 'a-token' });
    const deviceB = await request(app).post('/api/auth/google').send({ idToken: 'b-token' });

    const logoutA = await request(app).post('/api/auth/logout').send({ refreshToken: deviceA.body.data.refreshToken });
    expect(logoutA.status).toBe(200);

    // Device A's refresh token is now revoked...
    const refreshA = await request(app).post('/api/auth/refresh').send({ refreshToken: deviceA.body.data.refreshToken });
    expect(refreshA.status).toBe(401);

    // ...but Device B is completely unaffected.
    const refreshB = await request(app).post('/api/auth/refresh').send({ refreshToken: deviceB.body.data.refreshToken });
    expect(refreshB.status).toBe(200);
    const sessionB = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${refreshB.body.data.token}`);
    expect(sessionB.status).toBe(200);
  });

  it('logging in again after logout re-establishes a fully working session', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('token', { providerSubject: 'sub-relogin' });

    const first = await request(app).post('/api/auth/google').send({ idToken: 'token' });
    await request(app).post('/api/auth/logout').send({ refreshToken: first.body.data.refreshToken });

    const second = await request(app).post('/api/auth/google').send({ idToken: 'token' });
    const session = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${second.body.data.token}`);
    expect(session.status).toBe(200);
    expect(session.body.data.id).toBe(first.body.data.user.id);
  });

  it('logout with no refresh token (e.g. an old pre-refresh-token client) still succeeds', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('a pre-existing (old-format) access token with no session id keeps working unaffected by the session system', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('token', { providerSubject: 'sub-legacy' });
    const signIn = await request(app).post('/api/auth/google').send({ idToken: 'token' });

    // Old clients never called /refresh or /logout — verifySessionToken must
    // still accept a token without a sid, and existing sync routes must
    // still resolve it to the right account.
    const legacyToken = signSessionToken(signIn.body.data.user.id);

    const res = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${legacyToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(signIn.body.data.user.id);
  });

  it('account sync (favorites) keeps working after refreshing the access token', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('token', { providerSubject: 'sub-sync' });
    const signIn = await request(app).post('/api/auth/google').send({ idToken: 'token' });

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: signIn.body.data.refreshToken });
    const newToken = refreshed.body.data.token;

    const putFavorite = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${newToken}`)
      .send({ verseKeys: ['1:1'] });
    expect(putFavorite.status).toBe(200);

    const getFavorites = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${newToken}`);
    expect(getFavorites.status).toBe(200);
    expect(getFavorites.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ verseKey: '1:1' })]));
  });
});
