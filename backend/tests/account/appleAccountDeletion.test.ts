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
  const res = await request(built.app).post('/api/auth/apple').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken, ...(authorizationCode ? { authorizationCode } : {}) });
  return { token: res.body.data.token as string, userId: res.body.data.user.id as string, res };
}

async function signInGoogle(built: Built, idToken: string, providerSubject: string) {
  built.googleTokens.set(idToken, { providerSubject });
  const res = await request(built.app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken });
  return { token: res.body.data.token as string, userId: res.body.data.user.id as string };
}

function deleteAccount(built: Built, token: string, body?: object) {
  const req = request(built.app).delete('/api/account').set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}

describe('Apple account deletion: revocation', () => {
  it('Test A — a stored revocation credential is revoked, then the account is deleted', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('code-a', { refreshToken: 'refresh-a', subject: 'sub-a' });
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
    built.appleRevocationClient.codesToRefreshTokens.set('fresh-code-b', { refreshToken: 'refresh-b', subject: 'sub-b' });
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
    built.appleRevocationClient.codesToRefreshTokens.set('code-d', { refreshToken: 'refresh-d', subject: 'sub-d' });
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
    built.appleRevocationClient.codesToRefreshTokens.set('code-e', { refreshToken: 'refresh-e', subject: 'sub-e' });
    built.appleRevocationClient.alreadyRevokedTokens.add('refresh-e');
    const { token } = await signInApple(built, 'id-e', 'sub-e', 'code-e');

    const res = await deleteAccount(built, token);

    expect(res.status).toBe(200);
    const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(401);
  });

  it('Test F — repeating the delete request after success is rejected by B2, never attempting Apple revocation again', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('code-f', { refreshToken: 'refresh-f', subject: 'sub-f' });
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
    built.appleRevocationClient.codesToRefreshTokens.set('code-h-a', { refreshToken: 'refresh-h-a', subject: 'sub-h-a' });
    built.appleRevocationClient.codesToRefreshTokens.set('code-h-b', { refreshToken: 'refresh-h-b', subject: 'sub-h-b' });
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
    built.appleRevocationClient.codesToRefreshTokens.set('super-secret-code', { refreshToken: 'super-secret-refresh-token', subject: 'sub-i' });
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
    built.appleRevocationClient.codesToRefreshTokens.set('code-j', { refreshToken: 'refresh-j', subject: 'sub-j' });
    const { token, userId } = await signInApple(built, 'id-j', 'sub-j', 'code-j');

    expect((await deleteAccount(built, token)).status).toBe(200);

    const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(401);

    const put = await request(built.app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['1:1'] });
    expect(put.status).toBe(401);
    expect(await built.syncRepository.listFavorites(userId)).toEqual([]);
  });
});

describe('Apple authorization codes are bound to the verified Apple ID', () => {
  it('sign-in stores no credential from a code issued to a different Apple ID, and still signs in', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('other-code', { refreshToken: 'other-refresh', subject: 'sub-other' });
    const { userId, res } = await signInApple(built, 'id-k', 'sub-k', 'other-code');

    expect(res.status).toBe(200);
    expect(await built.appleCredentialRepository.get(userId)).toBeNull();
  });

  it('sign-in stores no credential when Apple names no subject', async () => {
    const built = buildAccountTestApp();
    built.appleRevocationClient.codesToRefreshTokens.set('anon-code', { refreshToken: 'anon-refresh', subject: null });
    const { userId, res } = await signInApple(built, 'id-l', 'sub-l', 'anon-code');

    expect(res.status).toBe(200);
    expect(await built.appleCredentialRepository.get(userId)).toBeNull();
  });

  it('deletion refuses a re-authentication code issued to a different Apple ID: nothing revoked, stored or deleted', async () => {
    const built = buildAccountTestApp();
    const { token, userId } = await signInApple(built, 'id-m', 'sub-m');
    built.appleTokens.set('fresh-id-m', { providerSubject: 'sub-m' });
    built.appleRevocationClient.codesToRefreshTokens.set('other-code-m', { refreshToken: 'other-refresh-m', subject: 'sub-other' });

    const res = await deleteAccount(built, token, { provider: 'apple', idToken: 'fresh-id-m', authorizationCode: 'other-code-m' });

    expect(res.status).toBe(502);
    expect(built.appleRevocationClient.revokedTokens).toEqual([]);
    expect(await built.appleCredentialRepository.get(userId)).toBeNull();
    const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(200);
  });

  it('deletion still proceeds if Apple names no subject for the code (never blocked on a missing id_token)', async () => {
    const built = buildAccountTestApp();
    const { token } = await signInApple(built, 'id-n', 'sub-n');
    built.appleTokens.set('fresh-id-n', { providerSubject: 'sub-n' });
    built.appleRevocationClient.codesToRefreshTokens.set('code-n', { refreshToken: 'refresh-n', subject: null });

    const res = await deleteAccount(built, token, { provider: 'apple', idToken: 'fresh-id-n', authorizationCode: 'code-n' });

    expect(res.status).toBe(200);
    expect(built.appleRevocationClient.revokedTokens).toEqual(['refresh-n']);
  });
});
