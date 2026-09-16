import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { verifySessionToken } from '../../src/auth/session';
import { buildAccountTestApp } from './testApp';

describe('POST /api/auth/google', () => {
  it('signs in successfully with a verified Google identity and issues a session token', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('valid-google-token', { providerSubject: 'google-sub-1', email: 'a@example.com', emailVerified: true });

    const res = await request(app).post('/api/auth/google').send({ idToken: 'valid-google-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.user).toMatchObject({ provider: 'google', email: 'a@example.com' });
    expect(verifySessionToken(res.body.data.token).userId).toBe(res.body.data.user.id);
  });

  it('rejects an unverifiable Google token and never issues a session', async () => {
    const { app } = buildAccountTestApp();

    const res = await request(app).post('/api/auth/google').send({ idToken: 'not-a-real-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
  });

  it('ignores any client-supplied userId/account fields — identity comes only from the verified token', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('valid-google-token', { providerSubject: 'google-sub-2' });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'valid-google-token', userId: 'attacker-controlled-id', id: 'also-attacker-controlled' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).not.toBe('attacker-controlled-id');
  });
});

describe('POST /api/auth/apple', () => {
  it('signs in successfully with a verified Apple identity, including a private-relay email', async () => {
    const { app, appleTokens } = buildAccountTestApp();
    appleTokens.set('valid-apple-token', {
      providerSubject: 'apple-sub-1',
      email: 'abc123@privaterelay.appleid.com',
      emailVerified: true,
    });

    const res = await request(app).post('/api/auth/apple').send({ idToken: 'valid-apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ provider: 'apple', email: 'abc123@privaterelay.appleid.com' });
  });

  it('rejects an unverifiable Apple token and leaves guest usage unaffected (no session issued)', async () => {
    const { app } = buildAccountTestApp();

    const res = await request(app).post('/api/auth/apple').send({ idToken: 'garbage' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('does not automatically link an Apple sign-in to an existing Google account with the same email', async () => {
    const { app, googleTokens, appleTokens } = buildAccountTestApp();
    googleTokens.set('g-token', { providerSubject: 'g-sub', email: 'same@example.com' });
    appleTokens.set('a-token', { providerSubject: 'a-sub', email: 'same@example.com' });

    const googleRes = await request(app).post('/api/auth/google').send({ idToken: 'g-token' });
    const appleRes = await request(app).post('/api/auth/apple').send({ idToken: 'a-token' });

    expect(googleRes.body.data.user.id).not.toBe(appleRes.body.data.user.id);
  });
});

describe('GET /api/auth/session and session-protected routes', () => {
  it('rejects requests with no Authorization header', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(401);
  });

  it('rejects a tampered/invalid session token', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).get('/api/auth/session').set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('an arbitrary client-chosen userId cannot spoof another account on a sync route', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('victim-token', { providerSubject: 'victim-sub' });
    const signIn = await request(app).post('/api/auth/google').send({ idToken: 'victim-token' });
    const victimId = signIn.body.data.user.id;

    // No token at all, just a body claiming to be the victim.
    const spoofed = await request(app).get('/api/sync/favorites').send({ userId: victimId });
    expect(spoofed.status).toBe(401);
  });

  it('accepts a valid session token and resolves it back to the correct account', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    googleTokens.set('valid-token', { providerSubject: 'sub-x' });
    const signIn = await request(app).post('/api/auth/google').send({ idToken: 'valid-token' });
    const { token, user } = signIn.body.data;

    const res = await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(user.id);
  });
});

describe('Guest usage is never blocked by auth failures', () => {
  it('a failed sign-in does not prevent using the Quran/emotion API as a guest', async () => {
    const { app } = buildAccountTestApp();
    await request(app).post('/api/auth/google').send({ idToken: 'bad' });

    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
  });
});
