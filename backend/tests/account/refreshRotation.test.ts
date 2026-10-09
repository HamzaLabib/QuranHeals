import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REFRESH_RETRY_GRACE_MS, rotateRefreshToken } from '../../src/auth/refreshRotation';
import { hashRefreshToken, parseRefreshToken, verifySessionToken } from '../../src/auth/session';
import { SessionModel } from '../../src/models/Session';
import { mongooseRotationStore } from '../../src/services/MongooseSessionRepository';
import { InMemorySessionRepository } from './fakes';
import { buildAccountTestApp } from './testApp';

/**
 * Regression coverage for refresh-token rotation when a response is lost:
 * previously the server rotated, the client never saved the new token, and
 * its next refresh with the old token was treated as reuse — revoking the
 * session (an apparently random sign-out). These tests run the production
 * decision logic (rotateRefreshToken) against an in-memory store.
 */

const T0 = Date.now();
const SECOND = 1000;

async function newSession() {
  const repository = new InMemorySessionRepository();
  const { sessionId, refreshToken } = await repository.createSession('user-1');
  const rotate = (token: string, now: number) => rotateRefreshToken(repository.rotationStore, token, now);
  return { repository, sessionId, original: refreshToken, rotate };
}

async function expectRejected(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ statusCode: 401 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Test A — normal rotation', () => {
  it('the current token rotates, and the returned token works for the next rotation', async () => {
    const { rotate, original, repository, sessionId } = await newSession();

    const first = await rotate(original, T0);
    expect(first).toMatchObject({ sessionId, userId: 'user-1' });
    expect(first.refreshToken).not.toBe(original);
    expect(parseRefreshToken(first.refreshToken)?.sessionId).toBe(sessionId);

    const second = await rotate(first.refreshToken, T0 + 10 * SECOND);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(repository.getStoredSession(sessionId)?.revokedAt).toBeNull();
  });

  it('stores only hashes: neither the current nor the previous raw token is persisted', async () => {
    const { rotate, original, repository, sessionId } = await newSession();
    const { refreshToken } = await rotate(original, T0);

    const stored = repository.getStoredSession(sessionId)!;
    expect(stored.refreshTokenHash).toBe(hashRefreshToken(refreshToken));
    expect(stored.previousRefreshTokenHash).toBe(hashRefreshToken(original));
    expect(JSON.stringify(stored)).not.toContain(parseRefreshToken(refreshToken)!.secret);
    expect(JSON.stringify(stored)).not.toContain(parseRefreshToken(original)!.secret);
  });
});

describe('Test B — lost response recovery', () => {
  it('re-presenting the previous token within the window returns the SAME current token; the session survives and the chain does not fork', async () => {
    const { rotate, original, repository, sessionId } = await newSession();

    // 1–3: the server accepts and rotates, but the client never receives/saves the response.
    const lost = await rotate(original, T0);
    const hashAfterLostRotation = repository.getStoredSession(sessionId)!.refreshTokenHash;

    // 4: the client retries with the token it still holds.
    const retried = await rotate(original, T0 + 30 * SECOND);

    expect(retried.refreshToken).toBe(lost.refreshToken);
    expect(retried.userId).toBe('user-1');
    const stored = repository.getStoredSession(sessionId)!;
    expect(stored.revokedAt).toBeNull();
    expect(stored.refreshTokenHash).toBe(hashAfterLostRotation); // the retry changed nothing
    // The recovered credential is usable and the chain continues normally.
    const next = await rotate(retried.refreshToken, T0 + 40 * SECOND);
    expect(next.refreshToken).not.toBe(retried.refreshToken);
  });

  it('several retries inside the window are idempotent', async () => {
    const { rotate, original } = await newSession();
    const lost = await rotate(original, T0);
    const results = [];
    for (const offset of [5, 20, 60, 119]) results.push((await rotate(original, T0 + offset * SECOND)).refreshToken);
    expect(new Set(results)).toEqual(new Set([lost.refreshToken]));
  });

  it('works end to end through POST /api/auth/refresh: the client is not signed out and receives a usable access + refresh token', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('token', { providerSubject: 'sub-lost-response' });
    const signIn = await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'token' });
    const heldByClient = signIn.body.data.refreshToken;

    const lostResponse = await request(app).post('/api/auth/refresh').send({ refreshToken: heldByClient });
    expect(lostResponse.status).toBe(200); // ...but the client never sees this body

    const retry = await request(app).post('/api/auth/refresh').send({ refreshToken: heldByClient });
    expect(retry.status).toBe(200);
    expect(retry.body.data.refreshToken).toBe(lostResponse.body.data.refreshToken);
    expect(verifySessionToken(retry.body.data.token).userId).toBe(signIn.body.data.user.id);

    const session = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${retry.body.data.token}`);
    expect(session.status).toBe(200);
    const nextRotation = await request(app).post('/api/auth/refresh').send({ refreshToken: retry.body.data.refreshToken });
    expect(nextRotation.status).toBe(200);
  });
});

describe('Test C — genuine reuse', () => {
  it('the previous token after the window is reuse: rejected and the whole session revoked', async () => {
    const { rotate, original, repository, sessionId } = await newSession();
    const { refreshToken: current } = await rotate(original, T0);

    await expectRejected(rotate(original, T0 + REFRESH_RETRY_GRACE_MS + 1));
    expect(repository.getStoredSession(sessionId)?.revokedAt).not.toBeNull();
    await expectRejected(rotate(current, T0 + REFRESH_RETRY_GRACE_MS + 2));
  });

  it('the previous token after its successor has been used is reuse, even inside the window', async () => {
    const { rotate, original, repository, sessionId } = await newSession();
    const first = await rotate(original, T0);
    const second = await rotate(first.refreshToken, T0 + 5 * SECOND);

    await expectRejected(rotate(original, T0 + 10 * SECOND));
    expect(repository.getStoredSession(sessionId)?.revokedAt).not.toBeNull();
    await expectRejected(rotate(second.refreshToken, T0 + 11 * SECOND));
  });

  it('a forged secret for a real session id is still treated as reuse (unchanged policy)', async () => {
    const { rotate, repository, sessionId } = await newSession();
    await expectRejected(rotate(`${sessionId}.forged-secret`, T0));
    expect(repository.getStoredSession(sessionId)?.revokedAt).not.toBeNull();
  });
});

describe('Test D — older than the previous token', () => {
  it('a token from two or more generations ago is rejected and revokes the session, even inside the window', async () => {
    const { rotate, original, repository, sessionId } = await newSession();
    const g1 = await rotate(original, T0);
    const g2 = await rotate(g1.refreshToken, T0 + 1 * SECOND);
    const g3 = await rotate(g2.refreshToken, T0 + 2 * SECOND);

    await expectRejected(rotate(g1.refreshToken, T0 + 3 * SECOND));
    expect(repository.getStoredSession(sessionId)?.revokedAt).not.toBeNull();
    await expectRejected(rotate(g3.refreshToken, T0 + 4 * SECOND));
  });
});

describe('Test E — concurrent refresh', () => {
  it('two simultaneous refreshes with the same token converge on one successor; no fork, no revocation', async () => {
    const { rotate, original, repository, sessionId } = await newSession();

    const [a, b] = await Promise.all([rotate(original, T0), rotate(original, T0)]);

    expect(a.refreshToken).toBe(b.refreshToken);
    const stored = repository.getStoredSession(sessionId)!;
    expect(stored.revokedAt).toBeNull();
    expect(stored.refreshTokenHash).toBe(hashRefreshToken(a.refreshToken));
    await expect(rotate(a.refreshToken, T0 + SECOND)).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('the MongoDB store rotates with a single conditional update on the expected current hash (atomic compare-and-set)', async () => {
    const lean = vi.fn().mockResolvedValue({ userId: 'user-1' });
    const findOneAndUpdate = vi.spyOn(SessionModel, 'findOneAndUpdate').mockReturnValue({ lean } as never);
    const sessionId = '64b7f0c2a1b2c3d4e5f60718';
    const update = { refreshTokenHash: 'next-hash', previousRefreshTokenHash: 'presented-hash', rotatedAt: T0, expiresAt: T0 + 1000 };

    await expect(mongooseRotationStore.compareAndRotate(sessionId, 'presented-hash', update, T0)).resolves.toBe('user-1');

    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, change] = findOneAndUpdate.mock.calls[0] as unknown as [Record<string, unknown>, { $set: Record<string, unknown> }];
    expect(filter).toEqual({
      _id: sessionId,
      refreshTokenHash: 'presented-hash',
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date(T0) },
    });
    expect(change.$set).toEqual({
      refreshTokenHash: 'next-hash',
      previousRefreshTokenHash: 'presented-hash',
      rotatedAt: new Date(T0),
      expiresAt: new Date(T0 + 1000),
    });
  });

  it('the MongoDB store reports "not applied" when the conditional update matches nothing, and never queries an invalid id', async () => {
    const findOneAndUpdate = vi.spyOn(SessionModel, 'findOneAndUpdate').mockReturnValue({ lean: vi.fn().mockResolvedValue(null) } as never);
    const update = { refreshTokenHash: 'n', previousRefreshTokenHash: 'p', rotatedAt: T0, expiresAt: T0 };

    await expect(mongooseRotationStore.compareAndRotate('64b7f0c2a1b2c3d4e5f60718', 'p', update, T0)).resolves.toBeNull();
    await expect(mongooseRotationStore.compareAndRotate('not-an-object-id', 'p', update, T0)).resolves.toBeNull();
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('Test F — expired session', () => {
  it('retry tolerance cannot revive an expired session', async () => {
    const { rotate, original, repository, sessionId } = await newSession();
    const { refreshToken: current } = await rotate(original, T0);
    repository.setExpiresAt(sessionId, T0 + 10 * SECOND);

    await expectRejected(rotate(original, T0 + 30 * SECOND));
    await expectRejected(rotate(current, T0 + 31 * SECOND));
  });
});

describe('Test G — revoked session', () => {
  it('retry tolerance cannot revive a revoked (logged-out) session', async () => {
    const { rotate, original, repository } = await newSession();
    const { refreshToken: current } = await rotate(original, T0);
    await repository.revokeSession(current);

    await expectRejected(rotate(original, T0 + 5 * SECOND));
    await expectRejected(rotate(current, T0 + 6 * SECOND));
  });

  it('retry tolerance cannot revive a deleted account session', async () => {
    const { rotate, original, repository } = await newSession();
    await rotate(original, T0);
    repository.revokeAllSessionsForUser('user-1');

    await expectRejected(rotate(original, T0 + 5 * SECOND));
  });
});
