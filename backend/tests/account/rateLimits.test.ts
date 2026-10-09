import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_RATE_LIMITS, RATE_LIMITED_MESSAGE } from '../../src/middleware/rateLimits';
import { buildAccountTestApp } from './testApp';

/**
 * D7: endpoint-specific rate limits. Small limits are injected so each test
 * needs only a few requests; the production thresholds are pinned separately.
 * Client IPs are set with X-Forwarded-For, which the app trusts for exactly
 * one proxy hop (Render).
 */

const WINDOW = 60_000;
const report = { category: 'other', comment: 'Something looks wrong.' };

describe('production thresholds', () => {
  it('are pinned and sized for shared IPs rather than single devices', () => {
    expect(DEFAULT_RATE_LIMITS).toEqual({
      global: { windowMs: 60_000, limit: 120 },
      issueReports: { windowMs: 60 * 60_000, limit: 10 },
      signIn: { windowMs: 15 * 60_000, limit: 30 },
      sessionRefresh: { windowMs: 15 * 60_000, limit: 120 },
      accountReauth: { windowMs: 60 * 60_000, limit: 10 },
    });
  });
});

describe('issue reports', () => {
  it('returns 429 with the standard error shape once an IP exceeds its limit, without storing the extra reports', async () => {
    const { app, issueReportRepository } = buildAccountTestApp({ rateLimits: { issueReports: { windowMs: WINDOW, limit: 3 } } });
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/issues').set('X-Forwarded-For', '203.0.113.5').send(report).expect(201);
    }

    const limited = await request(app).post('/api/issues').set('X-Forwarded-For', '203.0.113.5').send(report);

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ success: false, message: RATE_LIMITED_MESSAGE });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers.ratelimit ?? limited.headers['ratelimit-limit']).toBeDefined();
    expect(issueReportRepository.created).toHaveLength(3);
  });

  it('keeps other IPs and other endpoints usable while one IP is limited', async () => {
    const { app } = buildAccountTestApp({ rateLimits: { issueReports: { windowMs: WINDOW, limit: 1 } } });
    await request(app).post('/api/issues').set('X-Forwarded-For', '203.0.113.5').send(report).expect(201);
    await request(app).post('/api/issues').set('X-Forwarded-For', '203.0.113.5').send(report).expect(429);

    await request(app).post('/api/issues').set('X-Forwarded-For', '198.51.100.7').send(report).expect(201);
    await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.5').expect(200);
  });

  it('groups IPv6 clients by /56, so rotating addresses inside one allocation does not evade the limit', async () => {
    const { app } = buildAccountTestApp({ rateLimits: { issueReports: { windowMs: WINDOW, limit: 1 } } });
    await request(app).post('/api/issues').set('X-Forwarded-For', '2001:db8:0:1::1').send(report).expect(201);
    await request(app).post('/api/issues').set('X-Forwarded-For', '2001:db8:0:2::99').send(report).expect(429);
    await request(app).post('/api/issues').set('X-Forwarded-For', '2001:db8:0:100::1').send(report).expect(201);
  });
});

describe('sign-in and session refresh', () => {
  it('Google and Apple sign-in share one per-IP budget', async () => {
    const { app, googleTokens } = buildAccountTestApp({ rateLimits: { signIn: { windowMs: WINDOW, limit: 2 } } });
    googleTokens.set('valid', { providerSubject: 'sub-1' });
    await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'valid' }).expect(200);
    await request(app).post('/api/auth/apple').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'bad' }).expect(401);

    const limited = await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'valid' });
    expect(limited.status).toBe(429);
    expect(limited.body.message).toBe(RATE_LIMITED_MESSAGE);
  });

  it('exhausting sign-in never blocks session refresh, the authenticated API or guest browsing', async () => {
    const { app, googleTokens } = buildAccountTestApp({ rateLimits: { signIn: { windowMs: WINDOW, limit: 1 } } });
    googleTokens.set('valid', { providerSubject: 'sub-1' });
    const { token, refreshToken } = (await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'valid' }).expect(200)).body.data;
    await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'valid' }).expect(429);

    await request(app).post('/api/auth/refresh').send({ refreshToken }).expect(200);
    await request(app).get('/api/auth/session').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/health').expect(200);
  });

  it('limits refresh and logout together per IP, separately from sign-in', async () => {
    const { app, googleTokens } = buildAccountTestApp({ rateLimits: { sessionRefresh: { windowMs: WINDOW, limit: 2 } } });
    googleTokens.set('valid', { providerSubject: 'sub-1' });
    await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-token' }).expect(401);
    await request(app).post('/api/auth/logout').send({ refreshToken: 'not-a-token' });

    await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-token' }).expect(429);
    await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'valid' }).expect(200);
  });

  it('a refresh token from another IP is unaffected (households/carrier NAT get separate budgets per address)', async () => {
    const { app } = buildAccountTestApp({ rateLimits: { sessionRefresh: { windowMs: WINDOW, limit: 1 } } });
    await request(app).post('/api/auth/refresh').set('X-Forwarded-For', '203.0.113.5').send({ refreshToken: 'x' }).expect(401);
    await request(app).post('/api/auth/refresh').set('X-Forwarded-For', '203.0.113.5').send({ refreshToken: 'x' }).expect(429);
    await request(app).post('/api/auth/refresh').set('X-Forwarded-For', '198.51.100.7').send({ refreshToken: 'x' }).expect(401);
  });
});

describe('provider-reauthenticated account actions (per account)', () => {
  async function signIn(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, idToken: string) {
    googleTokens.set(idToken, { providerSubject: `sub-${idToken}` });
    return (await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken }).expect(200)).body.data.token as string;
  }

  it('limits account deletion attempts per account, not per IP', async () => {
    const { app, googleTokens } = buildAccountTestApp({ rateLimits: { accountReauth: { windowMs: WINDOW, limit: 2 } } });
    const alice = await signIn(app, googleTokens, 'alice');
    const bob = await signIn(app, googleTokens, 'bob');

    await request(app).delete('/api/account').set('Authorization', `Bearer ${alice}`).expect(428);
    await request(app).delete('/api/account').set('Authorization', `Bearer ${alice}`).expect(428);
    await request(app).delete('/api/account').set('Authorization', `Bearer ${alice}`).expect(429);

    // Same IP, different account: unaffected.
    await request(app).delete('/api/account').set('Authorization', `Bearer ${bob}`).expect(428);
  });

  it('shares the budget with the forgotten-password reflection reset, and never counts unauthenticated calls', async () => {
    const { app, googleTokens } = buildAccountTestApp({ rateLimits: { accountReauth: { windowMs: WINDOW, limit: 1 } } });
    const alice = await signIn(app, googleTokens, 'alice');
    for (let i = 0; i < 3; i++) await request(app).delete('/api/account').expect(401);

    const reset = await request(app).post('/api/sync/reflections/reset').set('Authorization', `Bearer ${alice}`).send({});
    expect(reset.status).not.toBe(429); // reached the controller (which rejects the missing credential)
    await request(app).delete('/api/account').set('Authorization', `Bearer ${alice}`).expect(429);
  });
});

describe('client IP behind proxies (TRUST_PROXY_HOPS)', () => {
  const limited = (network: { trustProxyHops?: number; endpointRateLimits?: boolean; clientIpDiagnostics?: boolean }) =>
    buildAccountTestApp({ rateLimits: { issueReports: { windowMs: WINDOW, limit: 1 } }, network }).app;

  it('with one trusted hop, a client cannot escape its bucket by prepending fake X-Forwarded-For entries', async () => {
    const app = limited({ trustProxyHops: 1 });
    await request(app).post('/api/issues').set('X-Forwarded-For', '198.51.100.1, 203.0.113.5').send(report).expect(201);
    await request(app).post('/api/issues').set('X-Forwarded-For', '198.51.100.2, 203.0.113.5').send(report).expect(429);
  });

  it("a hop count lower than the real chain makes different clients share the proxy's bucket (why it must be verified)", async () => {
    // Chain as seen behind one extra internal proxy: "<client>, <internal proxy>".
    const tooLow = limited({ trustProxyHops: 1 });
    await request(tooLow).post('/api/issues').set('X-Forwarded-For', '203.0.113.5, 10.0.0.2').send(report).expect(201);
    await request(tooLow).post('/api/issues').set('X-Forwarded-For', '198.51.100.7, 10.0.0.2').send(report).expect(429);

    const correct = limited({ trustProxyHops: 2 });
    await request(correct).post('/api/issues').set('X-Forwarded-For', '203.0.113.5, 10.0.0.2').send(report).expect(201);
    await request(correct).post('/api/issues').set('X-Forwarded-For', '198.51.100.7, 10.0.0.2').send(report).expect(201);
    // ...and with the correct count, a spoofed prefix still lands in the real client's bucket.
    await request(correct).post('/api/issues').set('X-Forwarded-For', '192.0.2.99, 203.0.113.5, 10.0.0.2').send(report).expect(429);
  });

  it('ENDPOINT_RATE_LIMITS=off disables only the endpoint limits; the global limit still applies', async () => {
    const { app } = buildAccountTestApp({ rateLimits: { issueReports: { windowMs: WINDOW, limit: 1 }, global: { windowMs: WINDOW, limit: 3 } }, network: { endpointRateLimits: false } });
    await request(app).post('/api/issues').send(report).expect(201);
    await request(app).post('/api/issues').send(report).expect(201);
    await request(app).post('/api/issues').send(report).expect(201);
    await request(app).post('/api/issues').send(report).expect(429);
  });

  it('the client-IP diagnostic logs only header-tagged health checks, never a real address', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { app } = buildAccountTestApp({ network: { clientIpDiagnostics: true, trustProxyHops: 2 } });
      await request(app).get('/api/health').set('X-Forwarded-For', '192.0.2.1, 81.2.69.160, 10.0.0.2').expect(200);
      expect(log).not.toHaveBeenCalled();
      await request(app).get('/api/health').set('X-Forwarded-For', '192.0.2.1, 81.2.69.160, 10.0.0.2').set('X-Quran-Heals-IP-Check', '1').expect(200);
      expect(log).toHaveBeenCalledOnce();
      const line = String(log.mock.calls[0][0]);
      expect(line).toMatch(/assessment=correct trustProxyHops=2 suggestedTrustProxyHops=2 entries=3 chain=\[doc:192\.0\.2\.1, public#[0-9a-f]{8}, private#[0-9a-f]{8}\]/);
      expect(line).not.toMatch(/81\.2\.69\.160|10\.0\.0\.2|127\.0\.0\.1/);
    } finally {
      log.mockRestore();
    }
  });

  it('the diagnostic is off unless enabled', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { app } = buildAccountTestApp();
      await request(app).get('/api/health').set('X-Quran-Heals-IP-Check', '1').expect(200);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('endpoint limits are off unless explicitly enabled', () => {
  it('with ENDPOINT_RATE_LIMITS unset, only the global limit applies (safe default until the proxy is verified)', async () => {
    const { app } = buildAccountTestApp({ rateLimits: { issueReports: { windowMs: WINDOW, limit: 1 } }, network: { endpointRateLimits: undefined } });
    await request(app).post('/api/issues').send(report).expect(201);
    await request(app).post('/api/issues').send(report).expect(201);
  });
});
