import { BlockList, isIP } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';

/**
 * Privacy-preserving check of how the app sees client IPs behind Render's
 * proxies (D7). It never logs a real address. Each address in the forwarding
 * chain is shown only as its kind plus a short keyed hash (HMAC with a
 * random key created per process, so hashes cannot be reversed or linked
 * across restarts); only RFC 5737/3849 documentation addresses — which the
 * operator sends deliberately as a marker — are shown as written.
 *
 * Procedure (docs/backend-operations.md "Client IPs on Render"): send
 * `X-Forwarded-For: 192.0.2.1` with `X-Quran-Heals-IP-Check: 1`. Whatever
 * the proxies append after the last documentation address starts with the address they saw
 * connecting, i.e. the client, so the correct hop count is the number of
 * entries from just after the marker to the end of the chain — no one has
 * to know or compare the client's real IP.
 */

export const DIAGNOSTIC_MARKER = '192.0.2.1';

const PRIVATE = new BlockList();
for (const [network, prefix] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['169.254.0.0', 16]] as const) PRIVATE.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['fc00::', 7], ['fe80::', 10]] as const) PRIVATE.addSubnet(network, prefix, 'ipv6');
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');
const DOCUMENTATION = new BlockList();
for (const [network, prefix] of [['192.0.2.0', 24], ['198.51.100.0', 24], ['203.0.113.0', 24]] as const) DOCUMENTATION.addSubnet(network, prefix, 'ipv4');
DOCUMENTATION.addSubnet('2001:db8::', 32, 'ipv6');

export type AddressKind = 'documentation' | 'loopback' | 'private' | 'public' | 'invalid';

/** "::ffff:10.0.0.1" → "10.0.0.1"; trims and drops IPv6 brackets/zone. */
function normalise(address: string): string {
  const trimmed = address.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  return /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(trimmed) ? trimmed.slice(7) : trimmed;
}

export function classifyAddress(raw: string): { kind: AddressKind; address: string } {
  const address = normalise(raw);
  const family = isIP(address);
  if (family === 0) return { kind: 'invalid', address };
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (DOCUMENTATION.check(address, type)) return { kind: 'documentation', address };
  if (LOOPBACK.check(address, type)) return { kind: 'loopback', address };
  if (PRIVATE.check(address, type)) return { kind: 'private', address };
  return { kind: 'public', address };
}

export type ChainAssessment = 'correct' | 'too-low (req.ip is a proxy address; users would share buckets)' | 'too-high (req.ip comes from the client-supplied part; spoofable)' | 'no-marker (send X-Forwarded-For: 192.0.2.1)';

export type ChainReport = {
  entries: number;
  chain: string[];
  socket: string;
  markerIndex: number;
  suggestedTrustProxyHops: number | null;
  trustProxyHops: number;
  reqIp: string;
  assessment: ChainAssessment;
};

/** Pure: everything the log line shows, with real addresses replaced by kind + keyed hash. */
export function describeForwardingChain(input: { forwardedFor: string; socket: string; reqIp: string; trustProxyHops: number; key: Buffer }): ChainReport {
  const label = (raw: string) => {
    const { kind, address } = classifyAddress(raw);
    if (kind === 'documentation') return `doc:${address}`;
    if (kind === 'invalid') return 'invalid';
    return `${kind}#${createHmac('sha256', input.key).update(address).digest('hex').slice(0, 8)}`;
  };
  const entries = input.forwardedFor.split(',').map((entry) => entry.trim()).filter(Boolean);
  const chain = entries.map(label);
  // The client-supplied part ends at the last documentation address (the
  // marker, plus any extra fake entries a spoofing test adds before it).
  const markerIndex = entries.map((entry) => classifyAddress(entry).kind).lastIndexOf('documentation');
  const suggestedTrustProxyHops = markerIndex === -1 ? null : entries.length - markerIndex - 1;
  const reqIp = label(input.reqIp);

  let assessment: ChainAssessment;
  if (markerIndex === -1) {
    assessment = 'no-marker (send X-Forwarded-For: 192.0.2.1)';
  } else {
    // Express resolves req.ip from the right: with N trusted hops it is the
    // N-th entry from the end of the chain (the socket counting as hop 1).
    const clientIndex = markerIndex + 1;
    const resolvedIndex = entries.length - input.trustProxyHops;
    assessment = resolvedIndex === clientIndex
      ? 'correct'
      : resolvedIndex > clientIndex
        ? 'too-low (req.ip is a proxy address; users would share buckets)'
        : 'too-high (req.ip comes from the client-supplied part; spoofable)';
  }
  return { entries: entries.length, chain, socket: label(input.socket), markerIndex, suggestedTrustProxyHops, trustProxyHops: input.trustProxyHops, reqIp, assessment };
}

export function formatChainReport(report: ChainReport): string {
  return [
    '[client-ip-check]',
    `assessment=${report.assessment}`,
    `trustProxyHops=${report.trustProxyHops}`,
    `suggestedTrustProxyHops=${report.suggestedTrustProxyHops ?? 'unknown'}`,
    `entries=${report.entries}`,
    `chain=[${report.chain.join(', ')}]`,
    `socket=${report.socket}`,
    `req.ip=${report.reqIp}`,
  ].join(' ');
}

/** A fresh random key per process: hashes are only comparable within one running instance. */
export function createDiagnosticKey(): Buffer {
  return randomBytes(32);
}
