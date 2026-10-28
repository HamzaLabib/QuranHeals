import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { clientAddress, DEFAULT_RATE_LIMITS } from '../../src/middleware/rateLimits';
import { describeForwardingChain } from '../../src/middleware/clientIpDiagnostics';
import { buildAccountTestApp } from './testApp';

/**
 * CLIENT_IP_SOURCE=cf-connecting-ip (release audit B13, 2026-10-28): per-IP limits keyed on Cloudflare's
 * CF-Connecting-IP instead of a hop count. Every request below arrives the way it does on Render: through the same
 * proxy chain, so X-Forwarded-For ends in the same proxy address for everyone.
 */
const WINDOW = 60_000;
const report = { category: 'other', comment: 'Something looks wrong.' };
const PROXY_CHAIN = '10.0.0.2';
const viaRender = (client: string) => ({ 'CF-Connecting-IP': client, 'X-Forwarded-For': `${client}, ${PROXY_CHAIN}` });

const cfApp = (limit = 1, extra: Record<string, unknown> = {}) =>
  buildAccountTestApp({ rateLimits: { issueReports: { windowMs: WINDOW, limit } }, network: { clientIpSource: 'cf-connecting-ip', trustProxyHops: 1, ...extra } });

describe('client address source', () => {
  it('with CF-Connecting-IP, two clients behind the same proxy get separate buckets', async () => {
    const { app } = cfApp();
    await request(app).post('/api/issues').set(viaRender('203.0.113.5')).send(report).expect(201);
    await request(app).post('/api/issues').set(viaRender('198.51.100.7')).send(report).expect(201);
    await request(app).post('/api/issues').set(viaRender('203.0.113.5')).send(report).expect(429);
  });

  it('the same two clients share one bucket with source "request" and a too-low hop count (the risk being fixed)', async () => {
    const { app } = buildAccountTestApp({ rateLimits: { issueReports: { windowMs: WINDOW, limit: 1 } }, network: { clientIpSource: 'request', trustProxyHops: 1 } });
    await request(app).post('/api/issues').set(viaRender('203.0.113.5')).send(report).expect(201);
    await request(app).post('/api/issues').set(viaRender('198.51.100.7')).send(report).expect(429);
  });

  it('a forged X-Forwarded-For does not move a client out of its CF-Connecting-IP bucket', async () => {
    const { app } = cfApp();
    await request(app).post('/api/issues').set(viaRender('203.0.113.5')).send(report).expect(201);
    await request(app).post('/api/issues').set({ 'CF-Connecting-IP': '203.0.113.5', 'X-Forwarded-For': `192.0.2.99, 203.0.113.5, ${PROXY_CHAIN}` }).send(report).expect(429);
  });

  it('falls back to req.ip when the header is missing or not an address (local runs, tests)', () => {
    const req = (cf: string | undefined) => ({ ip: '198.51.100.9', get: (name: string) => (name.toLowerCase() === 'cf-connecting-ip' ? cf : undefined) }) as never;
    expect(clientAddress(req('203.0.113.5'), 'cf-connecting-ip')).toBe('203.0.113.5');
    expect(clientAddress(req(undefined), 'cf-connecting-ip')).toBe('198.51.100.9');
    expect(clientAddress(req('not-an-ip, 1.2.3.4'), 'cf-connecting-ip')).toBe('198.51.100.9');
    expect(clientAddress(req('203.0.113.5'), 'request')).toBe('198.51.100.9');
  });

  it('IPv6 clients are still grouped per /56 when keyed on CF-Connecting-IP', async () => {
    const { app } = cfApp();
    await request(app).post('/api/issues').set(viaRender('2001:db8:aa:bb00::1')).send(report).expect(201);
    await request(app).post('/api/issues').set(viaRender('2001:db8:aa:bbff::9')).send(report).expect(429);
    await request(app).post('/api/issues').set(viaRender('2001:db8:aa:cc00::1')).send(report).expect(201);
  });
});

describe('diagnostic line for CF-Connecting-IP (no real address is ever printed)', () => {
  const key = Buffer.alloc(32, 7);
  const base = { forwardedFor: `192.0.2.1, 81.2.69.160, ${PROXY_CHAIN}`, socket: '10.0.0.3', reqIp: PROXY_CHAIN, trustProxyHops: 1, key };

  it('Cloudflare replaced the header with the real client: matches-client', () => {
    const line = describeForwardingChain({ ...base, cfConnectingIp: '81.2.69.160', rateLimitKey: '81.2.69.160', clientIpSource: 'cf-connecting-ip' });
    expect(line.cfAssessment).toBe('matches-client');
    expect(line.cf).toBe(line.chain[1]);
    expect(line.rateLimitKey).toBe(line.chain[1]);
    expect(JSON.stringify(line)).not.toMatch(/81\.2\.69\.160|10\.0\.0\./);
  });

  it('a forged value got through: caller-controlled', () => {
    expect(describeForwardingChain({ ...base, cfConnectingIp: '192.0.2.2' }).cfAssessment).toBe('caller-controlled (forged value passed through; do not use)');
  });

  it('absent header', () => {
    expect(describeForwardingChain(base).cfAssessment).toBe('absent');
  });
});

describe('shared Wi-Fi: normal sign-in and sync keep working (production thresholds, endpoint limits on)', () => {
  it('30 people on one address each open the app, sign in, sync and refresh within a few minutes without a 429', async () => {
    const { app, googleTokens } = buildAccountTestApp({
      rateLimits: DEFAULT_RATE_LIMITS,
      network: { clientIpSource: 'cf-connecting-ip', trustProxyHops: 1, endpointRateLimits: true },
    });
    const wifi = viaRender('203.0.113.50');
    const statuses: number[] = [];
    const track = (status: number) => statuses.push(status);
    for (let person = 0; person < 30; person++) {
      googleTokens.set(`token-${person}`, { providerSubject: `sub-${person}` });
      track((await request(app).get('/api/health').set(wifi)).status);
      track((await request(app).post('/api/auth/challenge').set(wifi).send({})).status);
      const signIn = await request(app).post('/api/auth/google').set(wifi).send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: `token-${person}` });
      track(signIn.status);
      const { token, refreshToken } = signIn.body.data;
      const auth = { ...wifi, Authorization: `Bearer ${token}` };
      for (const path of ['/api/auth/session', '/api/sync/favorites/sync', '/api/sync/preferences', '/api/sync/reflections', '/api/sync/reading', '/api/sync/key']) {
        track((await request(app).get(path).set(auth)).status);
      }
      track((await request(app).post('/api/auth/refresh').set(wifi).send({ refreshToken })).status);
    }
    expect(statuses.filter((status) => status === 429)).toEqual([]);
    expect(statuses.length).toBe(30 * 10);
  });

  it('…while one address flooding sign-in is still stopped, and other addresses are unaffected', async () => {
    const { app, googleTokens } = buildAccountTestApp({ rateLimits: DEFAULT_RATE_LIMITS, network: { clientIpSource: 'cf-connecting-ip', endpointRateLimits: true } });
    googleTokens.set('valid', { providerSubject: 'sub-x' });
    const attacker = viaRender('198.51.100.66');
    let limitedAt = 0;
    for (let i = 1; i <= DEFAULT_RATE_LIMITS.signIn.limit + 1; i++) {
      const res = await request(app).post('/api/auth/google').set(attacker).send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'forged' });
      if (res.status === 429) { limitedAt = i; break; }
    }
    expect(limitedAt).toBe(DEFAULT_RATE_LIMITS.signIn.limit + 1);
    await request(app).post('/api/auth/google').set(viaRender('203.0.113.51')).send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'valid' }).expect(200);
  });
});

describe('diagnostic wiring', () => {
  it('logs cf and the rate-limit key as hashes when enabled', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { app } = buildAccountTestApp({ network: { clientIpDiagnostics: true, trustProxyHops: 1, clientIpSource: 'cf-connecting-ip' } });
      await request(app).get('/api/health').set({ 'X-Quran-Heals-IP-Check': '1', 'X-Forwarded-For': `192.0.2.1, 81.2.69.160, ${PROXY_CHAIN}`, 'CF-Connecting-IP': '81.2.69.160' }).expect(200);
      const line = String(log.mock.calls[0][0]);
      expect(line).toMatch(/cfAssessment=matches-client clientIpSource=cf-connecting-ip rateLimitKey=public#[0-9a-f]{8}/);
      expect(line).not.toMatch(/81\.2\.69\.160/);
    } finally {
      log.mockRestore();
    }
  });
});
