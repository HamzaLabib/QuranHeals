import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildAccountTestApp } from './testApp';

/**
 * Phase B4: deleting an Apple-authenticated Quran Heals account must also
 * revoke this app's Apple authorization for that account. See
 * accountController.deleteAccount for the exact ordering (revoke, THEN
 * delete — never the other way around) and auth/appleRevocationClient.ts
 * for why an already-revoked token is treated as success.
 */

type Built = ReturnType<typeof buildAccountTestApp>;

async function signInApple(built: Built, idToken: string, providerSubject: string, authorizationCode?: string) {
  built.appleTokens.set(idToken, { providerSubject });
  const res = await request(built.app).post('/api/auth/apple').send({ idToken, ...(authorizationCode ? { authorizationCode } : {}) });
  return { token: res.body.data.token as string, userId: res.body.data.user.id as string, res };
}

async function signInGoogle(built: Built, idToken: string, providerSubject: string) {
  built.googleTokens.set(idToken, { providerSubject });
  const res = await request(built.app).post('/api/auth/google').send({ idToken });
  return { token: res.body.data.token as string, userId: res.body.data.user.id as string };
}

function deleteAccount(built: Built, token: string, body?: object) {
  const req = request(built.app).delete('/api/account').set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}

describe('Apple account deletion: revocation', () => {
  it('Test A — a stored revocation credential is revoked, then the account is deleted', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('code-a', 'refresh-a');
    const { token } = await signInApple(built, 'id-a', 'sub-a', 'code-a');

    const res = await deleteAccount(built, token);

    expect(res.status).toBe(200);
    expect(built.appleRevocationClient.revokedTokens).toEqual(['refresh-a']);
    const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(401);
  });

  it('Test B — an existing Apple user with no stored credential is asked to re-authenticate, then deletion proceeds', async () => {
    const built = buildAccountTestApp();
    // Signed in WITHOUT an authorization code — mirrors a pre-B4 account, or sign-in's own best-effort capture simply never ran.
    const { token } = await signInApple(built, 'id-b', 'sub-b');

    const firstAttempt = await deleteAccount(built, token);
    expect(firstAttempt.status).toBe(428);
    expect(built.appleRevocationClient.revokedTokens).toEqual([]);

    built.appleTokens.set('fresh-id-b', { providerSubject: 'sub-b' });
    built.appleRevocationClient.codesToRefreshTokens.set('fresh-code-b', 'refresh-b');
    const retry = await deleteAccount(built, token, { provider: 'apple', idToken: 'fresh-id-b', authorizationCode: 'fresh-code-b' });

    expect(retry.status).toBe(200);
    expect(built.appleRevocationClient.revokedTokens).toEqual(['refresh-b']);
  });

  it('Test C — a re-authentication credential for a different Apple identity is rejected, and nothing is deleted', async () => {
    const built = buildAccountTestApp();
    const { token } = await signInApple(built, 'id-c', 'sub-c');
    built.appleTokens.set('impostor-id', { providerSubject: 'sub-impostor' });

    const res = await deleteAccount(built, token, { provider: 'apple', idToken: 'impostor-id', authorizationCode: 'any-code' });

    expect(res.status).toBe(403);
    expect(built.appleRevocationClient.exchangedCodes).toEqual([]);
    const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(200);
  });

  it('Test D — a revocation failure aborts deletion entirely; the account remains fully intact and retryable', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('code-d', 'refresh-d');
    built.appleRevocationClient.failingTokens.add('refresh-d');
    const { token } = await signInApple(built, 'id-d', 'sub-d', 'code-d');

    const failed = await deleteAccount(built, token);
    expect(failed.status).toBe(502);

    const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(200); // nothing was deleted

    // The stored credential survived the failed attempt, so retrying needs no re-authentication.
    built.appleRevocationClient.failingTokens.delete('refresh-d');
    const retried = await deleteAccount(built, token);
    expect(retried.status).toBe(200);
  });

  it('Test E — an already-revoked Apple token is treated as success (idempotent), and deletion proceeds', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('code-e', 'refresh-e');
    built.appleRevocationClient.alreadyRevokedTokens.add('refresh-e');
    const { token } = await signInApple(built, 'id-e', 'sub-e', 'code-e');

    const res = await deleteAccount(built, token);

    expect(res.status).toBe(200);
    const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(401);
  });

  it('Test F — repeating the delete request after success is rejected by B2, never attempting Apple revocation again', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('code-f', 'refresh-f');
    const { token } = await signInApple(built, 'id-f', 'sub-f', 'code-f');

    expect((await deleteAccount(built, token)).status).toBe(200);
    expect(built.appleRevocationClient.revokedTokens).toEqual(['refresh-f']);

    const second = await deleteAccount(built, token);
    expect(second.status).toBe(401); // requireAuth itself rejects the now-stale token (B2)
    expect(built.appleRevocationClient.revokedTokens).toEqual(['refresh-f']); // not called again
  });

  it('Test G — a Google account needs a fresh Google sign-in to delete, and never calls Apple', async () => {
    const built = buildAccountTestApp();
    const { token } = await signInGoogle(built, 'id-google', 'sub-google');

    expect((await deleteAccount(built, token)).status).toBe(428);
    const res = await deleteAccount(built, token, { provider: 'google', idToken: 'id-google' });

    expect(res.status).toBe(200);
    expect(built.appleRevocationClient.revokedTokens).toEqual([]);
    expect(built.appleRevocationClient.exchangedCodes).toEqual([]);
  });

  it('Test H — account A deleting itself never touches account B’s stored credential or session', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('code-h-a', 'refresh-h-a');
    built.appleRevocationClient.codesToRefreshTokens.set('code-h-b', 'refresh-h-b');
    const a = await signInApple(built, 'id-h-a', 'sub-h-a', 'code-h-a');
    const b = await signInApple(built, 'id-h-b', 'sub-h-b', 'code-h-b');

    const res = await deleteAccount(built, a.token);

    expect(res.status).toBe(200);
    expect(built.appleRevocationClient.revokedTokens).toEqual(['refresh-h-a']); // never B's token
    expect(await built.appleCredentialRepository.get(b.userId)).toBe('refresh-h-b'); // B's credential untouched
    const bSession = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${b.token}`);
    expect(bSession.status).toBe(200);
  });

  it('Test I — no raw Apple secret ever appears in a response body', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('super-secret-code', 'super-secret-refresh-token');
    const { token } = await signInApple(built, 'id-i', 'sub-i', 'super-secret-code');

    const signInBody = JSON.stringify((await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`)).body);
    expect(signInBody).not.toContain('super-secret-refresh-token');
    expect(signInBody).not.toContain('super-secret-code');

    const deleteRes = await deleteAccount(built, token);
    const deleteBody = JSON.stringify(deleteRes.body);
    expect(deleteBody).not.toContain('super-secret-refresh-token');
    expect(deleteBody).not.toContain('super-secret-code');
  });

  it('Test J — after a successful Apple deletion, old access tokens are rejected (B2) and sync writes recreate nothing (B3)', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('code-j', 'refresh-j');
    const { token, userId } = await signInApple(built, 'id-j', 'sub-j', 'code-j');

    expect((await deleteAccount(built, token)).status).toBe(200);

    const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(401);

    const put = await request(built.app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['1:1'] });
    expect(put.status).toBe(401);
    expect(await built.syncRepository.listFavorites(userId)).toEqual([]);
  });
});
