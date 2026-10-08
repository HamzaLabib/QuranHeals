import { describe, expect, it } from 'vitest';

import { classifyAddress, createDiagnosticKey, describeForwardingChain, formatChainReport } from '../../src/middleware/clientIpDiagnostics';

/**
 * D7: the Render proxy check must find the right TRUST_PROXY_HOPS without any
 * real IP address reaching the logs. Real-looking public/private addresses
 * below must never appear in the output; only the 192.0.2.1 marker may.
 */

const key = Buffer.alloc(32, 7);
const CLIENT = '81.2.69.160';
const PROXY_PUBLIC = '172.67.1.1'; // a public (CDN-style) proxy address
const PROXY_PRIVATE = '10.20.30.40';
const SOCKET = '10.0.0.9';
const REAL = [CLIENT, PROXY_PUBLIC, PROXY_PRIVATE, SOCKET];

const describe1 = (forwardedFor: string, trustProxyHops: number, reqIp: string) =>
  describeForwardingChain({ forwardedFor, socket: SOCKET, reqIp, trustProxyHops, key });

describe('classifyAddress', () => {
  it.each([
    ['192.0.2.1', 'documentation'], ['2001:db8::1', 'documentation'], ['203.0.113.7', 'documentation'],
    ['127.0.0.1', 'loopback'], ['::1', 'loopback'],
    ['10.1.2.3', 'private'], ['172.16.0.1', 'private'], ['192.168.1.1', 'private'], ['100.64.0.1', 'private'], ['fd00::1', 'private'], ['::ffff:10.0.0.1', 'private'],
    ['81.2.69.160', 'public'], ['2a00:1450:4009:81f::200e', 'public'],
    ['not-an-ip', 'invalid'], ['', 'invalid'],
  ])('%s → %s', (address, kind) => {
    expect(classifyAddress(address).kind).toBe(kind);
  });
});

describe('describeForwardingChain', () => {
  it('one proxy hop, configured correctly', () => {
    const report = describe1(`192.0.2.1, ${CLIENT}`, 1, CLIENT);
    expect(report).toMatchObject({ assessment: 'correct', suggestedTrustProxyHops: 1, markerIndex: 0, entries: 2 });
  });

  it('Render-style chain with extra hops: hops=1 is too low (every user would share a proxy bucket)', () => {
    const forwardedFor = `192.0.2.1, ${CLIENT}, ${PROXY_PUBLIC}, ${PROXY_PRIVATE}`;
    const tooLow = describe1(forwardedFor, 1, PROXY_PRIVATE);
    expect(tooLow.assessment).toMatch(/^too-low/);
    expect(tooLow.suggestedTrustProxyHops).toBe(3);
    expect(describe1(forwardedFor, 3, CLIENT).assessment).toBe('correct');
  });

  it('a hop count above the real chain is reported as spoofable', () => {
    const report = describe1(`192.0.2.1, ${CLIENT}`, 2, '192.0.2.1');
    expect(report.assessment).toMatch(/^too-high/);
    expect(report.reqIp).toBe('doc:192.0.2.1');
  });

  it('trust proxy 0 resolves to the socket: too low', () => {
    expect(describe1(`192.0.2.1, ${CLIENT}`, 0, SOCKET).assessment).toMatch(/^too-low/);
  });

  it('a spoofing test with extra fake entries still finds the real client position', () => {
    const forwardedFor = `192.0.2.1, 198.51.100.7, ${CLIENT}, ${PROXY_PRIVATE}`;
    expect(describe1(forwardedFor, 2, CLIENT)).toMatchObject({ assessment: 'correct', suggestedTrustProxyHops: 2, markerIndex: 1 });
    expect(describe1(forwardedFor, 3, '198.51.100.7').assessment).toMatch(/^too-high/);
  });

  it('asks for the marker when it is missing', () => {
    const report = describe1(`${CLIENT}, ${PROXY_PRIVATE}`, 1, PROXY_PRIVATE);
    expect(report.assessment).toMatch(/^no-marker/);
    expect(report.suggestedTrustProxyHops).toBeNull();
  });

  it('never outputs a real address; equal addresses get equal hashes within one key, different ones across keys', () => {
    const line = formatChainReport(describe1(`192.0.2.1, ${CLIENT}, ${PROXY_PUBLIC}, ${PROXY_PRIVATE}`, 3, CLIENT));
    for (const address of REAL) expect(line).not.toContain(address);
    expect(line).toContain('doc:192.0.2.1');
    const report = describe1(`192.0.2.1, ${CLIENT}`, 1, CLIENT);
    expect(report.chain[1]).toBe(report.reqIp); // the client entry and req.ip are recognisably the same
    const otherKey = describeForwardingChain({ forwardedFor: `192.0.2.1, ${CLIENT}`, socket: SOCKET, reqIp: CLIENT, trustProxyHops: 1, key: createDiagnosticKey() });
    expect(otherKey.reqIp).not.toBe(report.reqIp);
  });

  it('handles IPv6 clients', () => {
    const report = describe1('192.0.2.1, 2a00:1450:4009:81f::200e', 1, '2a00:1450:4009:81f::200e');
    expect(report.assessment).toBe('correct');
    expect(report.reqIp).toMatch(/^public#[0-9a-f]{8}$/);
  });
});
