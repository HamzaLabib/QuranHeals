import { createHash } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { bindSignIn, candidateHashes, CHALLENGE_RETENTION_MS, CHALLENGE_TTL_MS, issueSignInChallenge, UNUSED_CHALLENGE_GRACE_MS } from '../../src/auth/signInChallenge';
import { InMemoryAuthChallengeRepository } from '../account/fakes';
import { buildAccountTestApp } from '../account/testApp';

const DECLARATION = { accountAgeConfirmation: { policyVersion: 1 } };
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

async function challenge(built: ReturnType<typeof buildAccountTestApp>) {
  const res = await request(built.app).post('/api/auth/challenge').send({});
  expect(res.status).toBe(200);
  return res.body.data as { nonce: string; expiresAt: string };
}

describe('sign-in request binding (single-use server challenges)', () => {
  it('a challenge is a fresh 256-bit nonce, stored only as its SHA-256, valid for 10 minutes', async () => {
    const built = buildAccountTestApp();
    const a = await challenge(built);
    const b = await challenge(built);
    expect(a.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(a.nonce).not.toBe(b.nonce);
    expect([...built.authChallengeRepository.challenges.keys()]).toEqual([sha256(a.nonce), sha256(b.nonce)]);
    const left = new Date(a.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(CHALLENGE_TTL_MS - 5000);
    expect(left).toBeLessThanOrEqual(CHALLENGE_TTL_MS);
    expect(CHALLENGE_RETENTION_MS).toBeGreaterThan(60 * 60 * 1000); // past the providers' 1-hour ID tokens
  });

  it.each(['apple', 'google'] as const)('%s: a token bound to a challenge signs in once; the same token again is refused', async (provider) => {
    const built = buildAccountTestApp();
    const { nonce } = await challenge(built);
    (provider === 'apple' ? built.appleTokens : built.googleTokens).set('bound', { providerSubject: `${provider}-1`, nonce });
    const first = await request(built.app).post(`/api/auth/${provider}`).send({ idToken: 'bound', ...DECLARATION });
    expect(first.status).toBe(200);
    const replay = await request(built.app).post(`/api/auth/${provider}`).send({ idToken: 'bound', ...DECLARATION });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ success: false, message: 'Sign-in could not be verified. Please try again.' });
    expect(built.sessionRepository.sessionCount).toBe(1);
    expect(built.authChallengeRepository.challenges.get(sha256(nonce))?.consumedForm).toBe('raw');
  });

  it('a provider that signs the nonce\'s SHA-256 instead is bound the same way', async () => {
    const built = buildAccountTestApp();
    const { nonce } = await challenge(built);
    built.appleTokens.set('hashed', { providerSubject: 'apple-h', nonce: sha256(nonce) });
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'hashed', ...DECLARATION })).status).toBe(200);
    expect(built.authChallengeRepository.challenges.get(sha256(nonce))?.consumedForm).toBe('sha256');
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'hashed', ...DECLARATION })).status).toBe(401);
  });

  it('a failed sign-in still uses up its challenge: a retry needs a new challenge and a new provider token', async () => {
    const built = buildAccountTestApp();
    const { nonce } = await challenge(built);
    built.appleTokens.set('no-declaration', { providerSubject: 'apple-new', nonce });
    // A new account without the age declaration is refused (403) after the token verified and bound.
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'no-declaration' })).status).toBe(403);
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'no-declaration', ...DECLARATION })).status).toBe(401);
    const fresh = await challenge(built);
    built.appleTokens.set('retry', { providerSubject: 'apple-new', nonce: fresh.nonce });
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'retry', ...DECLARATION })).status).toBe(200);
  });

  it('an unverifiable token never touches the challenges', async () => {
    const built = buildAccountTestApp();
    const { nonce } = await challenge(built);
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'not-a-known-token', ...DECLARATION })).status).toBe(401);
    expect(built.authChallengeRepository.challenges.get(sha256(nonce))?.consumedAt).toBeNull();
  });

  it('an expired challenge counts as unbound while binding is not required, and is refused once it is; it is never consumed', async () => {
    const repo = new InMemoryAuthChallengeRepository();
    const issued = new Date('2026-10-24T12:00:00Z');
    const late = new Date(issued.getTime() + CHALLENGE_TTL_MS + 1);
    const { nonce } = await issueSignInChallenge(repo, issued);
    await expect(bindSignIn(repo, nonce, { required: false, now: late })).resolves.toEqual({ bound: false });
    await expect(bindSignIn(repo, nonce, { required: true, now: late })).rejects.toMatchObject({ statusCode: 401 });
    expect(repo.challenges.get(sha256(nonce))?.consumedAt).toBeNull();
  });

  it('an unused challenge is purged soon after it expires; a consumed one is kept two hours for replay detection', async () => {
    const repo = new InMemoryAuthChallengeRepository();
    const issued = new Date('2026-10-24T12:00:00Z');
    const { nonce } = await issueSignInChallenge(repo, issued);
    expect(repo.challenges.get(sha256(nonce))?.purgeAt.getTime()).toBe(issued.getTime() + CHALLENGE_TTL_MS + UNUSED_CHALLENGE_GRACE_MS);
    const used = new Date(issued.getTime() + 60_000);
    await expect(bindSignIn(repo, nonce, { required: false, now: used })).resolves.toEqual({ bound: true, form: 'raw' });
    expect(repo.challenges.get(sha256(nonce))?.purgeAt.getTime()).toBe(used.getTime() + CHALLENGE_RETENTION_MS);
    await expect(bindSignIn(repo, nonce, { required: false, now: new Date(used.getTime() + 60 * 60 * 1000) })).rejects.toMatchObject({ statusCode: 401 });
  });

  it('while AUTH_NONCE_REQUIRED is off: tokens with no nonce or a nonce this server never issued still sign in (older builds)', async () => {
    const built = buildAccountTestApp();
    built.appleTokens.set('legacy', { providerSubject: 'apple-l' });
    built.googleTokens.set('own-nonce', { providerSubject: 'google-o', nonce: 'made-up-by-the-client' });
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'legacy', ...DECLARATION })).status).toBe(200);
    expect((await request(built.app).post('/api/auth/google').send({ idToken: 'own-nonce', ...DECLARATION })).status).toBe(200);
  });

  it('with AUTH_NONCE_REQUIRED on: only bound tokens sign in', async () => {
    const built = buildAccountTestApp({ nonceRequired: true });
    built.appleTokens.set('legacy', { providerSubject: 'apple-l' });
    built.googleTokens.set('own-nonce', { providerSubject: 'google-o', nonce: 'made-up-by-the-client' });
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'legacy', ...DECLARATION })).status).toBe(401);
    expect((await request(built.app).post('/api/auth/google').send({ idToken: 'own-nonce', ...DECLARATION })).status).toBe(401);
    const { nonce } = await challenge(built);
    built.appleTokens.set('bound', { providerSubject: 'apple-b', nonce });
    expect((await request(built.app).post('/api/auth/apple').send({ idToken: 'bound', ...DECLARATION })).status).toBe(200);
    expect(built.userRepository.size).toBe(1);
  });

  it('candidate hashes: the nonce\'s SHA-256 (raw form), and the claim itself when it already looks like one (sha256 form)', () => {
    expect(candidateHashes('abc')).toEqual([{ hash: sha256('abc'), form: 'raw' }]);
    const h = sha256('abc');
    expect(candidateHashes(h)).toEqual([{ hash: sha256(h), form: 'raw' }, { hash: h, form: 'sha256' }]);
  });
});
