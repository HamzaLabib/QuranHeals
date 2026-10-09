import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { REAUTH_MAX_AGE_MS } from '../../src/auth/providerReauthentication';
import { buildAccountTestApp } from './testApp';

type Built = ReturnType<typeof buildAccountTestApp>;

async function googleAccountWithData(built: Built, providerSubject: string) {
  built.googleTokens.set(`signin-${providerSubject}`, { providerSubject });
  const signIn = await request(built.app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: `signin-${providerSubject}` });
  const token = signIn.body.data.token as string;
  await request(built.app).put('/api/sync/favorites').set('Authorization', `Bearer ${token}`).send({ verseKeys: ['1:1'] });
  return { token, userId: signIn.body.data.user.id as string };
}

const deleteAccount = (built: Built, token: string, body?: object) => {
  const req = request(built.app).delete('/api/account').set('Authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
};

async function stillIntact(built: Built, token: string) {
  const session = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);
  const favorites = await request(built.app).get('/api/sync/favorites').set('Authorization', `Bearer ${token}`);
  return session.status === 200 && favorites.body.data.length === 1;
}

describe('Google account deletion requires fresh Google re-authentication', () => {
  it('without a credential: 428, and nothing is deleted', async () => {
    const built = buildAccountTestApp();
    const { token } = await googleAccountWithData(built, 'g-1');
    const res = await deleteAccount(built, token);
    expect(res.status).toBe(428);
    expect(await stillIntact(built, token)).toBe(true);
  });

  it('17. a fresh token for the same Google identity deletes the account', async () => {
    const built = buildAccountTestApp();
    const { token } = await googleAccountWithData(built, 'g-2');
    built.googleTokens.set('fresh-g-2', { providerSubject: 'g-2' });
    expect((await deleteAccount(built, token, { provider: 'google', idToken: 'fresh-g-2' })).status).toBe(200);
    expect((await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('18/20. a different Google identity is refused (403) and the account stays intact', async () => {
    const built = buildAccountTestApp();
    const { token } = await googleAccountWithData(built, 'g-3');
    built.googleTokens.set('someone-else', { providerSubject: 'g-other' });
    expect((await deleteAccount(built, token, { provider: 'google', idToken: 'someone-else' })).status).toBe(403);
    expect(await stillIntact(built, token)).toBe(true);
  });

  it('19/20. a stale Google token (issued over 10 minutes ago) is refused and nothing is deleted', async () => {
    const built = buildAccountTestApp();
    const { token } = await googleAccountWithData(built, 'g-4');
    const staleIssuedAt = Math.floor((Date.now() - REAUTH_MAX_AGE_MS - 60_000) / 1000);
    built.googleTokens.set('stale-g-4', { providerSubject: 'g-4', issuedAt: staleIssuedAt } as never);
    expect((await deleteAccount(built, token, { provider: 'google', idToken: 'stale-g-4' })).status).toBe(403);
    expect(await stillIntact(built, token)).toBe(true);
  });

  it('20. an unverifiable token, an Apple credential, or extra fields are refused and nothing is deleted', async () => {
    const built = buildAccountTestApp();
    const { token } = await googleAccountWithData(built, 'g-5');
    expect((await deleteAccount(built, token, { provider: 'google', idToken: 'never-issued' })).status).toBe(403);
    expect((await deleteAccount(built, token, { provider: 'apple', idToken: 'x', authorizationCode: 'y' })).status).toBe(428);
    built.googleTokens.set('fresh-g-5', { providerSubject: 'g-5' });
    expect((await deleteAccount(built, token, { provider: 'google', idToken: 'fresh-g-5', userId: 'victim' })).status).toBe(428);
    expect(await stillIntact(built, token)).toBe(true);
  });
});
