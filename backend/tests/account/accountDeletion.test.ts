import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildAccountTestApp } from './testApp';

async function signInAndSync(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, idToken: string, providerSubject: string) {
  googleTokens.set(idToken, { providerSubject });
  const signIn = await request(app).post('/api/auth/google').send({ idToken });
  const { token, refreshToken, user } = signIn.body.data as { token: string; refreshToken: string; user: { id: string } };

  await request(app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['1:1', '2:2'] });
  await request(app)
    .put('/api/sync/preferences')
    .set('Authorization', `Bearer ${token}`)
    .send({ locale: 'en', updatedAt: new Date().toISOString() });
  await request(app)
    .put('/api/sync/reflections')
    .set('Authorization', `Bearer ${token}`)
    .send({
      reflections: [
        {
          verseKey: '1:1',
          ciphertext: 'cipher-bytes',
          nonce: 'nonce-bytes',
          encryptionVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
  await request(app)
    .put('/api/sync/key')
    .set('Authorization', `Bearer ${token}`)
    .send({ wrappedKey: 'wrapped', nonce: 'nonce', salt: 'salt', kdfIterations: 210000, encryptionVersion: 1 });

  return { token, refreshToken, userId: user.id };
}

describe('DELETE /api/account', () => {
  it('rejects an unauthenticated request — no session, no deletion', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).delete('/api/account');
    expect(res.status).toBe(401);
  });

  it('a client cannot target another user — there is no :userId param at all, only the authenticated session', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const { token: victimToken, userId: victimId } = await signInAndSync(app, googleTokens, 'victim-token', 'victim-sub');
    const { token: attackerToken } = await signInAndSync(app, googleTokens, 'attacker-token', 'attacker-sub');

    // The attacker can only ever delete their own account — there is no
    // request field that could name the victim's account instead.
    await request(app).delete('/api/account').set('Authorization', `Bearer ${attackerToken}`).send({ userId: victimId });

    const victimSession = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${victimToken}`);
    expect(victimSession.status).toBe(200);
  });

  it('deletes the User record — GET /api/auth/session subsequently 404s even with a still-valid access token', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const { token } = await signInAndSync(app, googleTokens, 'token', 'sub-1');

    const del = await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const session = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(404);
  });

  it('revokes every session (all devices), not only the one that requested deletion', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('device-a', { providerSubject: 'sub-multi' });
    googleTokens.set('device-b', { providerSubject: 'sub-multi' });
    const deviceA = await request(app).post('/api/auth/google').send({ idToken: 'device-a' });
    const deviceB = await request(app).post('/api/auth/google').send({ idToken: 'device-b' });

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${deviceA.body.data.token}`);

    // Device B's refresh token — issued before deletion — must no longer work.
    const refreshB = await request(app).post('/api/auth/refresh').send({ refreshToken: deviceB.body.data.refreshToken });
    expect(refreshB.status).toBe(401);
  });

  it('deletes favorites, preferences, reflections, and the wrapped sync key', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const { token } = await signInAndSync(app, googleTokens, 'token', 'sub-data');

    await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`);

    // The access token is now orphaned (its userId no longer exists), so
    // re-signing in as the *same* provider identity proves this is a fresh
    // account with none of the old data, rather than reusing the deleted
    // one's records.
    googleTokens.set('token-again', { providerSubject: 'sub-data' });
    const again = await request(app).post('/api/auth/google').send({ idToken: 'token-again' });
    const newToken = again.body.data.token as string;

    const favorites = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${newToken}`);
    expect(favorites.body.data).toEqual([]);

    const preferences = await request(app).get('/api/sync/preferences').set('Authorization', `Bearer ${newToken}`);
    expect(preferences.body.data).toBeNull();

    const reflections = await request(app).get('/api/sync/reflections').set('Authorization', `Bearer ${newToken}`);
    expect(reflections.body.data).toEqual([]);

    const syncKey = await request(app).get('/api/sync/key').set('Authorization', `Bearer ${newToken}`);
    expect(syncKey.body.data).toBeNull();
  });

  it('does not touch other users’ data', async () => {
    const { app, googleTokens, syncRepository } = buildAccountTestApp();
    const { token: toDeleteToken } = await signInAndSync(app, googleTokens, 'to-delete', 'sub-delete');
    const { token: otherToken, userId: otherUserId } = await signInAndSync(app, googleTokens, 'other', 'sub-other');

    await request(app).delete('/api/account').set('Authorization', `Bearer ${toDeleteToken}`);

    const otherFavorites = await request(app).get('/api/sync/favorites').set('Authorization', `Bearer ${otherToken}`);
    expect(otherFavorites.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ verseKey: '1:1' })]));
    expect(await syncRepository.getPreferences(otherUserId)).not.toBeNull();
  });

  it('is idempotent — a repeated deletion request for an already-deleted session does not error or restore anything', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const { token } = await signInAndSync(app, googleTokens, 'token', 'sub-repeat');

    const first = await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    // The same (still cryptographically valid, not yet expired) access
    // token presented again — the account it names is already gone.
    const second = await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
  });

  it('never touches Quran/global data (no route exists for it to call, but assert the health/emotions surface is unaffected)', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const { token } = await signInAndSync(app, googleTokens, 'token', 'sub-global');
    await request(app).delete('/api/account').set('Authorization', `Bearer ${token}`);

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
  });
});
