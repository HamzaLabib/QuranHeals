import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { REFRESH_RETRY_GRACE_MS } from '../../src/auth/refreshRotation';
import { parseRefreshToken, signAccessToken } from '../../src/auth/session';
import { buildAccountTestApp } from './testApp';

/**
 * requireAuth is now DB-authoritative (Phase B2): beyond the JWT's own
 * signature/expiry, it re-checks on every request that the session the
 * token names is still active and owned by that user, and that the user
 * still exists. These tests exercise that invariant directly — see
 * accountDeletion.test.ts, multiDeviceAuth.test.ts and
 * refreshRotation.test.ts for the broader, pre-existing surrounding
 * coverage this must not regress.
 */

type Built = ReturnType<typeof buildAccountTestApp>;

async function signIn(built: Built, idToken: string, providerSubject: string) {
  built.googleTokens.set(idToken, { providerSubject });
  const res = await request(built.app).post('/api/auth/google').send({ idToken });
  const { token, refreshToken, user } = res.body.data as { token: string; refreshToken: string; user: { id: string } };
  return { token, refreshToken, userId: user.id };
}

function protectedRequest(built: Built, token: string) {
  return request(built.app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);
}

describe('requireAuth: session/user authorization invariant', () => {
  it('Test A — a normal valid access token with an active session and an existing user is authorized', async () => {
    const built = buildAccountTestApp();
    const { token } = await signIn(built, 'a-token', 'sub-a');

    const res = await protectedRequest(built, token);
    expect(res.status).toBe(200);
  });

  it('Test B — logging out invalidates the current access token immediately, before its JWT expiry', async () => {
    const built = buildAccountTestApp();
    const { token, refreshToken } = await signIn(built, 'b-token', 'sub-b');
    expect((await protectedRequest(built, token)).status).toBe(200);

    const logout = await request(built.app).post('/api/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(200);

    // The access token's JWT signature/expiry are still perfectly valid —
    // only the DB-authoritative session check rejects it now.
    expect((await protectedRequest(built, token)).status).toBe(401);
  });

  it('Test C — a session revoked out-of-band (not via /logout) is rejected on its next use', async () => {
    const built = buildAccountTestApp();
    const { token, refreshToken } = await signIn(built, 'c-token', 'sub-c');
    expect((await protectedRequest(built, token)).status).toBe(200);

    await built.sessionRepository.revokeSession(refreshToken);

    expect((await protectedRequest(built, token)).status).toBe(401);
  });

  it('Test D — after account deletion, the old access token is rejected immediately', async () => {
    const built = buildAccountTestApp();
    const { token } = await signIn(built, 'd-token', 'sub-d');
    expect((await protectedRequest(built, token)).status).toBe(200);

    const del = await request(built.app).delete('/api/account').set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    expect((await protectedRequest(built, token)).status).toBe(401);
  });

  it('Test E — a session exists but its user record does not (defensive: deleted/inconsistent user) → 401', async () => {
    const built = buildAccountTestApp();
    const { token, userId } = await signIn(built, 'e-token', 'sub-e');

    // Simulates a user row disappearing independently of its sessions —
    // something the normal account-deletion transaction never does, but
    // the invariant is checked regardless of how the inconsistency arose.
    built.userRepository.deleteUser(userId);

    expect((await protectedRequest(built, token)).status).toBe(401);
  });

  it('Test F — the JWT is valid but its session record is missing entirely → 401', async () => {
    const built = buildAccountTestApp();
    const { token, userId } = await signIn(built, 'f-token', 'sub-f');

    // Removes the session row outright (not just revokedAt) while the user
    // row stays — distinct from Test C/D, which revoke rather than erase.
    built.sessionRepository.revokeAllSessionsForUser(userId);

    expect((await protectedRequest(built, token)).status).toBe(401);
  });

  it('Test G — a token naming one user but another user’s session is rejected (ownership mismatch)', async () => {
    const built = buildAccountTestApp();
    const userA = await signIn(built, 'g-token-a', 'sub-g-a');
    const userB = await signIn(built, 'g-token-b', 'sub-g-b');

    const parsedB = parseRefreshToken(userB.refreshToken);
    expect(parsedB).not.toBeNull();

    // A malformed/forged token: A's userId claim, but B's session id.
    // Normal token issuance can never produce this — enforced defensively.
    const forged = signAccessToken(userA.userId, parsedB!.sessionId);

    expect((await protectedRequest(built, forged)).status).toBe(401);
  });

  it('Test H — an expired access token is rejected normally', async () => {
    const built = buildAccountTestApp();
    const { token } = await signIn(built, 'h-token', 'sub-h');
    expect((await protectedRequest(built, token)).status).toBe(200);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 21 * 60 * 1000); // past the 20-minute access-token TTL
      expect((await protectedRequest(built, token)).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Test I — one device logging out never affects another device’s independent session', async () => {
    const built = buildAccountTestApp();
    const deviceA = await signIn(built, 'i-token-a', 'sub-i');
    const deviceB = await signIn(built, 'i-token-b', 'sub-i');

    await request(built.app).post('/api/auth/logout').send({ refreshToken: deviceA.refreshToken });

    expect((await protectedRequest(built, deviceA.token)).status).toBe(401);
    expect((await protectedRequest(built, deviceB.token)).status).toBe(200);
  });

  it('Test J — account deletion invalidates every device’s access token, not only the one that deleted it', async () => {
    const built = buildAccountTestApp();
    const deviceA = await signIn(built, 'j-token-a', 'sub-j');
    const deviceB = await signIn(built, 'j-token-b', 'sub-j');

    await request(built.app).delete('/api/account').set('Authorization', `Bearer ${deviceA.token}`);

    expect((await protectedRequest(built, deviceA.token)).status).toBe(401);
    expect((await protectedRequest(built, deviceB.token)).status).toBe(401);
  });

  it('Test K — a protected sync write attempted after account deletion is rejected and recreates nothing', async () => {
    const built = buildAccountTestApp();
    const { token, userId } = await signIn(built, 'k-token', 'sub-k');
    await request(built.app).delete('/api/account').set('Authorization', `Bearer ${token}`);

    const put = await request(built.app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ verseKeys: ['1:1'] });
    expect(put.status).toBe(401);

    // Directly inspecting storage (not through the now-unusable token)
    // confirms the rejected write never reached the repository at all.
    expect(await built.syncRepository.listFavorites(userId)).toEqual([]);
  });

  it('Test L — normal refresh and the R2 lost-response retry window both still work unaffected', async () => {
    const built = buildAccountTestApp();
    const { refreshToken } = await signIn(built, 'l-token', 'sub-l');

    const refreshed = await request(built.app).post('/api/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.data.token).toBe('string');

    // A lost-response retry: the immediately-previous refresh token is
    // presented again within the grace window and must still recover the
    // same new session, not be rejected as reuse.
    const retry = await request(built.app).post('/api/auth/refresh').send({ refreshToken });
    expect(retry.status).toBe(200);
    expect(retry.body.data.refreshToken).toBe(refreshed.body.data.refreshToken);

    // And the newly-rotated access token is itself fully authorized.
    expect((await protectedRequest(built, refreshed.body.data.token)).status).toBe(200);

    // Outside the grace window, the same stale token is rejected.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + REFRESH_RETRY_GRACE_MS + 1);
      const tooLate = await request(built.app).post('/api/auth/refresh').send({ refreshToken });
      expect(tooLate.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });
});
