import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 4.8.3: automatic publication of two-reviewer verified timing to the app's environments. SYNTHETIC recordings
// (tone bursts), test accounts, a fake provider and a temporary PostgreSQL (embedded-postgres): no real review, no real
// database, no network, and never the real registry.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const cloud = (p: string) => imp(`review/cloud/${p}`);
const { default: EmbeddedPostgres } = await import(pathToFileURL(join(tools, 'review/cloud/node_modules/embedded-postgres/dist/index.js')).href);
const db = await cloud('db.mjs');
const { createCloudServer } = await cloud('server.mjs');
const auth = await cloud('auth.mjs');
const { importBundle } = await cloud('import.mjs');
const backup = await cloud('backup.mjs');
const registry = await cloud('registry.mjs');
const rules = await cloud('publication-rules.mjs');
const { buildBundle } = await cloud('migrate.mjs');
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');
const { timingFingerprint } = await imp('fingerprint.mjs');
const nodeCrypto = await import('node:crypto');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-pub-'));
const sha = (b: string | Buffer) => nodeCrypto.createHash('sha256').update(b).digest('hex');
const ALL_YES = Object.fromEntries(Object.keys(manual.CHECKS).map((k) => [k, 'yes']));

// ================================================================ the rules (pure)
const syn98 = makeSynthetic({ surah: 98, key: 'syn-98' });
const S98 = { ...syn98.session, reciterId: 'banna', provider: 'mp3quran', url: 'https://cdn.mp3quran.net/audio/test/098.mp3', format: { mode: 'cbr', kbps: 128 }, sha256: sha(syn98.wav), synthetic: true, timeline: 'decoded audio (miniaudio; synthetic test tones)', rights: { cleared: false, reason: 'test' } };
const T = syn98.truth;
const work98 = (shift: (k: number) => number = () => 0, checks: J = ALL_YES) => ({ markers: Object.fromEntries(T.starts.map((ms: number, i: number) => [i + 1, { ms: ms + shift(i + 1), status: 'confirmed' }])), end: { ms: T.endMs, status: 'confirmed' }, flags: [], checks, comments: '' });
class Log {
  events: J[] = []; state = manual.emptyState(); prev = 'genesis';
  constructor(public s: J = S98) {}
  add(reviewer: string, role: number, type: string, payload: J = {}, accountId?: string) {
    const ev: J = { seq: this.events.length + 1, at: `2026-10-19T10:${String(this.events.length).padStart(2, '0')}:00.000Z`, reviewer, ...(accountId ? { accountId } : {}), role, type, payload, prev: this.prev };
    manual.applyEvent(this.s, this.state, ev); ev.hash = manual.eventHash(this.prev, ev); this.prev = ev.hash; this.events.push(ev); return this;
  }
}
const both = (r2shift: (k: number) => number = () => 0, r2checks: J = ALL_YES, s: J = S98) => new Log(s)
  .add('TEST One', 1, 'join', {}, 'acc_one').add('TEST One', 1, 'draft', { work: work98() }).add('TEST One', 1, 'submit')
  .add('TEST Two', 2, 'join', {}, 'acc_two').add('TEST Two', 2, 'draft', { work: work98(r2shift, r2checks) }).add('TEST Two', 2, 'submit');
const AUTH = { id: 'auth_test', provider: 'mp3quran', reciterId: null, recordingSha256: null, riwayah: 'hafs', acknowledgesNotice: false, evidence: 'test grant', decidedBy: 'acc_admin', decidedAt: '2026-10-19T00:00:00.000Z', revokedAt: null };
const EVID = { waveform: { bytes: S98.bytes, sha256: S98.sha256 }, source: { ok: true, rangeRequests: true, at: 'now' } };
const evaluate = (L: Log, extra: J = {}) => rules.evaluatePublication({ session: L.s, state: L.state, events: L.events, evidence: EVID, authorizations: [AUTH], accounts: { 1: 'acc_one', 2: 'acc_two' }, allowSynthetic: true, ...extra });
const check = (ev: J, id: string) => ev.checks.find((c: J) => c.id === id);

describe('the publication gate (pure rules, synthetic reviews)', () => {
  it('1. one reviewer complete: no publication', () => {
    const L = new Log().add('TEST One', 1, 'join').add('TEST One', 1, 'draft', { work: work98() }).add('TEST One', 1, 'submit');
    const ev = evaluate(L);
    expect(ev.stage).toBe('reviewer-1-complete');
    expect(ev.eligible).toBe(false);
    expect(ev.content).toBeNull();
  });

  it('2/11. two independent, agreeing complete reviews with every check: eligible, the canonical verse ids, the exact recording', () => {
    const ev = evaluate(both((k) => (k === 3 ? 100 : 0)));
    expect(ev.stage).toBe('ready-for-publication');
    expect(ev.content.body.timing.entries.map((e: J) => e.verse)).toEqual(Array.from({ length: 8 }, (_, i) => `98:${i + 1}`));
    expect(ev.content.body.recording).toMatchObject({ reciterId: 'banna', surah: 98, url: S98.url, bytes: S98.bytes, sha256: S98.sha256 });
    expect(ev.content.versionId).toMatch(/^tv_[0-9a-f]{24}$/);
    expect(ev.content.fingerprint).toBe(timingFingerprint(ev.content.body.timing.entries));
    expect(rules.evaluatePublication({ session: S98, state: both().state, events: both().events, evidence: EVID, authorizations: [AUTH], allowSynthetic: true }).content.versionId).toBe(evaluate(both()).content.versionId); // same input, same version
  });

  it('3. partial ayah submissions never publish', () => {
    const L = new Log().add('TEST One', 1, 'join').add('TEST One', 1, 'draft', { work: work98() }).add('TEST One', 1, 'submit')
      .add('TEST Two', 2, 'join').add('TEST Two', 2, 'draft', { work: work98() }).add('TEST Two', 2, 'submit-ayahs', { keys: ['1', '2', '3', '4', '5', '6', '7', '8'] });
    expect(evaluate(L)).toMatchObject({ stage: 'reviewer-1-complete', eligible: false });
  });

  it('4/5. an outstanding dispute blocks; once formally resolved it is eligible (with the resolved time)', () => {
    const L = both((k) => (k === 4 ? 900 : 0));
    expect(evaluate(L)).toMatchObject({ stage: 'disputed', eligible: false });
    L.add('TEST Two', 2, 'resolve-propose', { ayah: 4, ms: T.starts[3] + 450, note: 'in my judgement here' }).add('TEST One', 1, 'resolve-accept', { ayah: 4, note: 'agreed' });
    const ev = evaluate(L);
    expect(ev.stage).toBe('ready-for-publication');
    expect(ev.entries[3].startMs).toBe(T.starts[3] + 450);
  });

  it('6. a whole-recording question not answered "yes" blocks', () => {
    const ev = evaluate(both(() => 0, { ...ALL_YES, order: 'unsure' }));
    expect(ev.eligible).toBe(false);
    expect(ev.stage).toBe('publication-blocked');
  });

  it('7/8/9. a wrong ayah count, another file (size or SHA-256), a time past the end: blocked', () => {
    const L = both();
    expect(check(rules.evaluatePublication({ session: { ...S98, ayahCount: 7 }, state: L.state, events: L.events, evidence: EVID, authorizations: [AUTH], allowSynthetic: true }), 'canonical-count').result).toBe('fail');
    expect(check(evaluate(L, { evidence: { ...EVID, waveform: { bytes: S98.bytes, sha256: 'c'.repeat(64) } } }), 'identity-hash').result).toBe('fail');
    expect(check(evaluate(L, { evidence: { ...EVID, waveform: { bytes: S98.bytes + 1, sha256: S98.sha256 } } }), 'identity-hash').result).toBe('fail');
    expect(check(evaluate(L, { evidence: { ...EVID, source: { ok: false, problem: 'the provider now serves 12 bytes' } } }), 'source-live').result).toBe('fail');
    const short = { ...S98, durationMs: T.endMs - 1 };
    expect(check(rules.evaluatePublication({ session: short, state: L.state, events: L.events, evidence: EVID, authorizations: [AUTH], allowSynthetic: true }), 'timing-valid').result).toBe('fail');
    expect(rules.timingProblems([{ ayah: 1, verse: '98:1', startMs: 10, endMs: 5 }], { surah: 98, durationMs: 100, ayahCount: 1 })).toEqual(['98:1 has no positive length']);
  });

  it('10. no authorization, a revoked one, a rights notice not acknowledged for the exact file, another riwayah: blocked', () => {
    const L = both();
    expect(evaluate(L, { authorizations: [] })).toMatchObject({ eligible: false, stage: 'publication-blocked' });
    expect(evaluate(L, { authorizations: [{ ...AUTH, revokedAt: 'x' }] }).eligible).toBe(false);
    expect(evaluate(L, { authorizations: [{ ...AUTH, provider: 'archive' }] }).eligible).toBe(false); // a working URL is not permission
    expect(check(evaluate(L, { authorizations: [{ ...AUTH, riwayah: 'warsh' }] }), 'riwayah').result).toBe('fail');
    const noticed = { ...S98, rights: { cleared: false, reason: 'tag', id3Copyright: 'Reserved For KFGQPC' } };
    const L2 = both(() => 0, ALL_YES, noticed);
    const ev = (a: J) => rules.evaluatePublication({ session: noticed, state: L2.state, events: L2.events, evidence: EVID, authorizations: [a], allowSynthetic: true });
    expect(check(ev(AUTH), 'rights-notice').result).toBe('fail');
    expect(check(ev({ ...AUTH, recordingSha256: S98.sha256 }), 'rights-notice').result).toBe('fail');
    expect(ev({ ...AUTH, recordingSha256: S98.sha256, acknowledgesNotice: true }).eligible).toBe(true);
  });

  it('VBR without a verified exact-seek method, a production boundary check, synthetic data in the real registry, one person in both roles: never published', () => {
    const L = both();
    const vbr = rules.evaluatePublication({ session: { ...S98, format: { mode: 'vbr' } }, state: L.state, events: L.events, evidence: EVID, authorizations: [AUTH], allowSynthetic: true });
    expect(check(vbr, 'playback-compatibility').result).toBe('pending'); // compatibility unknown: pending, never published
    expect(vbr.eligible).toBe(false);
    expect(check(evaluate(L, { allowSynthetic: false }), 'not-synthetic').result).toBe('fail');
    expect(check(evaluate(L, { accounts: { 1: 'acc_same', 2: 'acc_same' } }), 'independent-reviewers').result).toBe('fail');
    const scoped = { ...S98, scope: [2, 3] };
    const L3 = new Log(scoped).add('A', 1, 'join').add('A', 1, 'draft', { work: { markers: { 2: { ms: T.starts[1], status: 'confirmed' }, 3: { ms: T.starts[2], status: 'confirmed' } }, end: null, flags: [], checks: { playback: 'yes' }, comments: '' } }).add('A', 1, 'submit')
      .add('B', 2, 'join').add('B', 2, 'draft', { work: { markers: { 2: { ms: T.starts[1], status: 'confirmed' }, 3: { ms: T.starts[2], status: 'confirmed' } }, end: null, flags: [], checks: { playback: 'yes' }, comments: '' } }).add('B', 2, 'submit');
    expect(rules.evaluatePublication({ session: scoped, state: L3.state, events: L3.events, evidence: EVID, authorizations: [AUTH], allowSynthetic: true }).eligible).toBe(false);
  });

  it('a provider outage is pending (retried), never a pass; a tampered history fails', () => {
    const L = both();
    const ev = evaluate(L, { evidence: { ...EVID, source: { ok: false, network: true, problem: 'the provider could not be reached' } } });
    expect(ev.stage).toBe('technical-validation-pending');
    expect(rules.definitiveFailure(ev)).toBe(false);
    const forged = structuredClone(L.events); forged[1].payload.work.markers[1].ms += 1;
    expect(check(evaluate(L, { events: forged }), 'audit-chain').result).toBe('fail');
  });

  describe('Phase 4.8.5: playback compatibility per recording (not a blanket CBR rule)', () => {
    const VBR = { ...S98, format: { mode: 'vbr', kbps: null } };
    const L = both(() => 0, ALL_YES, VBR);
    const meas = (platform: string, maxAbsErrorMs: number, sha = S98.sha256, extra: J = {}) => ({ id: `seek_${platform}`, recordingSha256: sha, platform, method: 'vbr-mllt', appBuild: 'test build', device: 'test device', samples: 40, maxAbsErrorMs, passed: maxAbsErrorMs <= rules.SEEK_TOLERANCE_MS, evidence: 'TEST', at: '2026-10-19T12:00:00Z', revokedAt: null, ...extra });
    const ALL = { 'cbr-exact': ['android', 'ios'], 'vbr-mllt': ['android', 'ios'] };
    const ev = (extra: J = {}) => rules.evaluatePublication({ session: VBR, state: L.state, events: L.events, evidence: EVID, authorizations: [AUTH], allowSynthetic: true, ...extra });
    const compat = (e: J) => e.compatibility.status;

    it('an otherwise valid CBR recording stays eligible: CBR Compatible on both platforms', () => {
      const e = evaluate(both());
      expect(e.compatibility).toMatchObject({ status: 'cbr-compatible', method: 'cbr-exact', platforms: ['android', 'ios'] });
      expect(e.content.body.playback).toEqual({ method: 'cbr-exact', platforms: ['android', 'ios'] });
    });

    it('VBR in today\'s app (no exact-seek method shipped): VBR Compatibility Pending, even with device measurements', () => {
      expect(compat(ev())).toBe('vbr-compatibility-pending');
      const e = ev({ seekVerifications: [meas('android', 20), meas('ios', 22)] }); // measured, but the released app lacks the method
      expect(compat(e)).toBe('vbr-compatibility-pending');
      expect(e.eligible).toBe(false);
      expect(check(e, 'playback-compatibility').detail).toMatch(/native MLLT data source not built/);
    });

    it('the method shipped and measured on Android only: Android Verified / iOS Pending (never published to one platform)', () => {
      const e = ev({ appCapabilities: ALL, seekVerifications: [meas('android', 20)] });
      expect(compat(e)).toBe('vbr-android-verified-ios-pending');
      expect(e.stage).toBe('technical-validation-pending');
    });

    it('shipped on both platforms and measured within tolerance on both, for this exact file: VBR Compatibility Verified', () => {
      const e = ev({ appCapabilities: ALL, seekVerifications: [meas('android', 20), meas('ios', 31)] });
      expect(compat(e)).toBe('vbr-compatibility-verified');
      expect(e.eligible).toBe(true);
      expect(e.content.body.playback).toEqual({ method: 'vbr-mllt', platforms: ['android', 'ios'] });
    });

    it('measurements of another file, revoked ones or out-of-tolerance ones never count', () => {
      expect(compat(ev({ appCapabilities: ALL, seekVerifications: [meas('android', 20, 'f'.repeat(64)), meas('ios', 20, 'f'.repeat(64))] }))).toBe('vbr-compatibility-pending');
      expect(compat(ev({ appCapabilities: ALL, seekVerifications: [meas('android', 20), meas('ios', 20, S98.sha256, { revokedAt: 'x' })] }))).toBe('vbr-android-verified-ios-pending');
      const bad = ev({ appCapabilities: ALL, seekVerifications: [meas('android', 20), meas('ios', 900)] });
      expect(compat(bad)).toBe('unsupported');
      expect(bad.stage).toBe('publication-blocked');
    });

    it('a bitrate mode not yet read is pending; one that could not be established is unsupported', () => {
      const unk = { ...S98, format: null };
      const L2 = both(() => 0, ALL_YES, unk);
      const base = { state: L2.state, events: L2.events, authorizations: [AUTH], allowSynthetic: true };
      expect(rules.evaluatePublication({ ...base, session: unk, evidence: { ...EVID, waveform: { bytes: S98.bytes, sha256: S98.sha256 } } }).compatibility.status).toBe('compatibility-pending');
      expect(rules.evaluatePublication({ ...base, session: unk, evidence: { ...EVID, waveform: { bytes: S98.bytes, sha256: S98.sha256, format: { mode: null, evidence: 'no frame' } } } }).compatibility.status).toBe('unsupported');
    });

    it('timestamps not on the original file\'s decoded timeline block publication; so does a host without byte ranges', () => {
      const other = { ...S98, timeline: 'a re-encoded CBR copy (+25.06 ms)' };
      const L3 = both(() => 0, ALL_YES, other);
      expect(check(rules.evaluatePublication({ session: other, state: L3.state, events: L3.events, evidence: EVID, authorizations: [AUTH], allowSynthetic: true }), 'timing-coordinates').result).toBe('fail');
      expect(check(evaluate(both()), 'timing-coordinates').result).toBe('pass');
      expect(evaluate(both(), { evidence: { ...EVID, source: { ok: true, rangeRequests: false } } }).compatibility.status).toBe('unsupported');
    });
  });

  it('the file format is read from the encoder frame (Info = CBR, Xing = VBR), never guessed', async () => {
    const { mp3Format } = await cloud('audio.mjs');
    const frame = (tag: string | null, id3 = 0, mono = false) => {
      const b = Buffer.alloc(id3 + 300);
      if (id3) { b.write('ID3', 0, 'latin1'); b[3] = 3; b[9] = id3 - 10; }
      b[id3] = 0xff; b[id3 + 1] = 0xfb; b[id3 + 2] = 0x90; b[id3 + 3] = mono ? 0xc0 : 0x00; // MPEG-1 Layer III, 128 kbps
      if (tag) b.write(tag, id3 + 4 + (mono ? 17 : 32), 'latin1');
      return b;
    };
    expect(mp3Format(frame('Info'))).toMatchObject({ mode: 'cbr', kbps: 128 });
    expect(mp3Format(frame('Xing', 40))).toMatchObject({ mode: 'vbr' });
    expect(mp3Format(frame('Info', 0, true))).toMatchObject({ mode: 'cbr' });
    expect(mp3Format(frame(null)).mode).toBeNull(); // no encoder frame: not established
    expect(mp3Format(Buffer.from('RIFF....WAVEfmt '))).toBeNull(); // not an MP3
  });

  it('bulk acceptance and missing playback telemetry are not listening evidence: nothing in the published version claims listening', () => {
    const ev = evaluate(both());
    expect(JSON.stringify(ev.content.body)).not.toMatch(/listen|heard|played/i);
  });
});

// ================================================================ the service (real PostgreSQL, synthetic recordings)
const freePort = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
let pg: J;
const PGPORT = await freePort();
const url = (name: string) => `postgres://qh:qh-test@127.0.0.1:${PGPORT}/${name}`;
const pools: J[] = [];
// Connection errors a pool reports (db.mjs createPool onError): recorded, and the suite fails on any (checked after
// teardown). Once teardown has finished, a late one is thrown again so it is never silently dropped.
const poolErrors: string[] = [];
let tornDown = false;
const onPoolError = (e: Error & { code?: string }) => { if (tornDown) throw e; poolErrors.push(`${e.code ?? 'no code'}: ${e.message}`); };
async function newDb(name: string) {
  const a = db.createPool(url('postgres'), { ssl: false, max: 1, onError: onPoolError });
  await a.query(`create database ${name} encoding 'UTF8' template template0`);
  await db.closePool(a);
  const p = db.createPool(url(name), { ssl: false, onError: onPoolError });
  pools.push(p);
  return p;
}
beforeAll(async () => {
  pg = new EmbeddedPostgres({ databaseDir: join(work, 'pg'), user: 'qh', password: 'qh-test', port: PGPORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
}, 120000);
afterAll(async () => {
  for (const p of pools) await db.closePool(p);
  await pg?.stop();
  try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* temp folder only */ }
  // Every connection is gone before PostgreSQL stops; then give any connection error a moment to arrive, and fail on it.
  await new Promise((r) => setTimeout(r, 250));
  tornDown = true;
  expect(poolErrors).toEqual([]);
}, 60000);

const syn = makeSynthetic({ surah: 112, key: 'syn-112' });
const { text } = lib.canon();
const BAS = text.get('1:1');
function pkg(urlOf: string) {
  const n = 4;
  const starts = syn.truth.starts.slice(0, n);
  const ayahs = Array.from({ length: n }, (_, k) => { const t = text.get(`112:${k + 1}`) as string; return { ayah: k + 1, startMs: starts[k], endMs: k + 1 < n ? starts[k + 1] : syn.truth.endMs, text: k === 0 ? t.split(' ').slice(BAS.split(' ').length).join(' ') : t }; });
  const p: J = { kind: 'ayah-timing-review-package', version: 1, source: 'aligned', createdOn: '2026-10-19', reciterId: 'banna', reciterEn: 'x', reciterAr: 'x', recording: 'test', surah: 112, surahAr: 'x', surahEn: 'S112', ayahCount: n,
    url: urlOf, bytes: syn.wav.length, format: { kbps: 128, mode: 'cbr', durationMs: syn.session.durationMs }, textSource: 't', status: 's', durationMs: syn.session.durationMs, intro: null, basmala: BAS, ayahs, synthetic: true,
    boundaries: ayahs.slice(1).map((a) => ({ ayah: a.ayah, ms: a.startMs, flags: [], priority: 3, pauseMs: null })), worklist: [2], structure: { ok: true, problems: [] } };
  p.candidateFingerprint = timingFingerprint(p.ayahs.map((a: J) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs })));
  return p;
}
function workspace() {
  const pk = join(work, 'packages');
  mkdirSync(join(pk, 'aligned', 'banna'), { recursive: true });
  writeFileSync(join(pk, 'aligned', 'banna', 'a.json'), JSON.stringify(pkg('https://cdn.mp3quran.net/audio/test/112.wav')));
  writeFileSync(join(pk, 'aligned', 'banna', 'b.json'), JSON.stringify(pkg('https://archive.org/download/test/112.wav')));
  writeFileSync(join(pk, 'index.json'), JSON.stringify({ kind: 'ayah-timing-review-index', packages: [{ file: 'aligned/banna/a.json' }, { file: 'aligned/banna/b.json' }] }));
  const ws = join(work, 'ws');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'dashboard.config.json'), JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: 'backups', sources: [{ id: 'pk', kind: 'review-packages', phase: 'T', dir: '../packages' }] }));
  lib.importAll(lib.readConfig(join(ws, 'dashboard.config.json')));
  return join(ws, 'dashboard.config.json');
}
const CFG = workspace();
const provider = { down: false, served: 0 };
const fakeFetch = async (u: string, opts: J = {}) => {
  if (provider.down) throw new Error('ECONNRESET');
  provider.served++;
  const m = /bytes=(\d+)-(\d+)/.exec(opts.headers?.Range ?? '');
  if (m) { const a = Number(m[1]), b = Number(m[2]); return new Response(syn.wav.subarray(a, b + 1), { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${syn.wav.length}` } }); }
  return new Response(syn.wav, { status: 200, headers: { 'content-length': String(syn.wav.length) } });
};
function client(base: string) {
  let cookie = '';
  const req = async (method: string, p: string, body?: J, headers: J = {}) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json', origin: base } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const t = await r.text();
    let json: J = null; try { json = JSON.parse(t); } catch { /* not json */ }
    return { status: r.status, json, text: t, headers: r.headers };
  };
  return { req, get: (p: string) => req('GET', p), post: (p: string, b: J = {}) => req('POST', p, b), login: (email: string) => req('POST', '/auth/google', { credential: `test:${email}` }) };
}
const verifier = async (c: string) => { const m = /^test:(.+)$/.exec(c); if (!m) throw Object.assign(new Error('bad'), { status: 401 }); return { sub: `sub-${m[1]}`, email: m[1], emailVerified: true }; };
async function start(pool: J, publication: J = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const d = await createCloudServer({ pool, publicUrl: base, cookieSecure: false, verifier, scratchDir: join(work, `scratch-${port}`), python: process.env.QH_PYTHON ?? 'python', fetchImpl: fakeFetch, limits: { perIp: 9000, perAccount: 9000, writes: 9000 },
    publication: { mode: 'enabled', allowSynthetic: true, autoStart: false, ...publication } });
  await new Promise<void>((r) => d.server.listen(port, '127.0.0.1', () => r()));
  return { ...d, base, stop: () => d.close() };
}
const fullWork = (shift: (k: number) => number = () => 0) => ({ markers: Object.fromEntries(syn.truth.starts.slice(0, 4).map((ms: number, i: number) => [i + 1, { ms: ms + shift(i + 1), status: 'confirmed' }])), end: { ms: syn.truth.endMs, status: 'confirmed' }, flags: [], checks: ALL_YES, comments: '' });

describe('the publication service (temporary PostgreSQL, synthetic recordings, test accounts)', () => {
  let pool: J; let s: J; let amina: J; let bilal: J; let anon: J;
  const A = 'banna-112';
  const B = 'banna-112-archive';
  const review = async (key: string, shift: (k: number) => number = () => 0) => {
    for (const [c, role, w] of [[amina, 1, fullWork()], [bilal, 2, fullWork(shift)]] as const) {
      expect((await c.post(`/api/event/${key}`, { role, type: 'join' })).status).toBe(200);
      expect((await c.post(`/api/event/${key}`, { role, type: 'draft', payload: { work: w } })).status).toBe(200);
      expect((await c.post(`/api/event/${key}`, { role, type: 'submit' })).status).toBe(200);
    }
  };
  // The server queues a recording just after answering its accepted event (server.mjs: `void publisher.notify(key)`), so
  // a tick can run before the job is written (seen on CI: 'queued' instead of 'blocked'). Wait until every review log's
  // current head is the head its job was queued with, then process; never longer than 10 s.
  const queued = async () => {
    for (let i = 0; i < 400; i++) {
      const heads = new Map((await pool.query('select review_key, head from publication_jobs')).rows.map((r: J) => [r.review_key, r.head]));
      const behind = [...s.store.tasks().keys()].filter((k: string) => s.store.hasLog(k) && heads.get(k) !== s.store.load(k).events.at(-1).hash);
      if (!behind.length) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('publication jobs never caught up with the review logs');
  };
  const drain = async () => { await queued(); for (let i = 0; i < 5 && (await s.publisher.tick()) > 0; i++); };
  const job = async (key: string) => (await pool.query('select * from publication_jobs where review_key = $1', [key])).rows[0];
  const manifestOf = async (env: string) => (await anon.get(`/v1/audio-timing/${env}/manifest`)).json;

  beforeAll(async () => {
    pool = await newDb('pub');
    await db.migrate(pool);
    await importBundle(pool, { ...buildBundle(CFG).bundle, events: undefined }, { by: 't' });
    await auth.createAccount(pool, { email: 'amina@test.example', reviewerName: 'TEST Amina', roles: ['admin', 'reviewer'], by: 't' });
    await auth.createAccount(pool, { email: 'bilal@test.example', reviewerName: 'TEST Bilal', by: 't' });
    s = await start(pool);
    amina = client(s.base); bilal = client(s.base); anon = client(s.base);
    await amina.login('amina@test.example'); await bilal.login('bilal@test.example');
  }, 120000);
  afterAll(() => s.stop());

  it('both reviews complete and verified, but no authorization: blocked, nothing published, the reason shown', async () => {
    await review(A);
    await drain();
    const j = await job(A);
    expect(j.state).toBe('blocked');
    expect(j.evaluation.stage).toBe('publication-blocked');
    expect(j.evaluation.blockers.join(' ')).toMatch(/no authorization recorded for mp3quran/);
    expect((await manifestOf('production')).entries).toEqual([]);
    expect((await pool.query('select count(*)::int n from timing_versions')).rows[0].n).toBe(0);
    const view = (await bilal.get('/api/publication')).json;
    expect(view.rows.find((r: J) => r.key === A).stage).toBe('publication-blocked');
  });

  it('only an administrator authorizes a source (with evidence and the riwayah); then it publishes to BOTH environments: one version', async () => {
    expect((await bilal.post('/api/admin/publication/authorizations', { provider: 'mp3quran', riwayah: 'hafs', evidence: 'x' })).status).toBe(403);
    expect((await amina.post('/api/admin/publication/authorizations', { provider: 'mp3quran', riwayah: 'warsh', evidence: 'x' })).status).toBe(409);
    expect((await amina.post('/api/admin/publication/authorizations', { provider: 'mp3quran', riwayah: 'hafs', evidence: 'TEST: written permission (synthetic)' })).status).toBe(200);
    await drain();
    expect((await job(A)).state).toBe('published');
    const dev = await manifestOf('development');
    const prod = await manifestOf('production');
    expect(dev.entries).toHaveLength(1);
    expect(prod.entries.map((e: J) => e.versionId)).toEqual(dev.entries.map((e: J) => e.versionId)); // the same version in both
    const e = prod.entries[0];
    expect(e).toMatchObject({ reciterId: 'banna', surah: 112, ayahCount: 4, versionNo: 1, audio: { url: 'https://cdn.mp3quran.net/audio/test/112.wav', bytes: syn.wav.length, sha256: sha(syn.wav), format: { mode: 'cbr' } } });
    const doc = await anon.get(`/v1/audio-timing/versions/${e.versionId}`);
    expect(doc.status).toBe(200);
    expect(doc.headers.get('cache-control')).toMatch(/immutable/);
    expect(doc.json.timing.fingerprint).toBe(e.timingFingerprint);
    expect(doc.json.timing.entries.map((x: J) => x.verse)).toEqual(['112:1', '112:2', '112:3', '112:4']);
    // public: published timing only (no reviewer, account or review log)
    for (const t of [JSON.stringify(prod), doc.text]) expect(t).not.toMatch(/TEST Amina|TEST Bilal|acc_|reviewHead|evidence/);
    const view = (await amina.get('/api/publication')).json;
    expect(view.rows.find((r: J) => r.key === A)).toMatchObject({ stage: 'published-both', published: 'published-both' });
  });

  it('12. a duplicate completion event (or the same review processed again) publishes nothing new', async () => {
    const logBefore = (await pool.query('select count(*)::int n from publication_log')).rows[0].n;
    await s.publisher.notify(A); await s.publisher.notify(A);
    await drain();
    expect((await pool.query('select count(*)::int n from timing_versions')).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int n from publication_log where action in ('activated', 'version-created')")).rows[0].n).toBe(3); // 1 created + 2 activations, once
    expect((await pool.query('select count(*)::int n from publication_log')).rows[0].n).toBe(logBefore);
    const etag = (await anon.get('/v1/audio-timing/production/manifest')).headers.get('etag');
    expect((await anon.req('GET', '/v1/audio-timing/production/manifest', undefined, { 'if-none-match': etag })).status).toBe(304);
  });

  it('13. the same reciter and surah, another recording: never overwrites the active one (blocked, an administrator chooses)', async () => {
    await review(B);
    await drain();
    // Archive is not authorized: blocked by authorization AND by the active other recording.
    let j = await job(B);
    expect(j.evaluation.blockers.join(' ')).toMatch(/no authorization recorded for archive/);
    await amina.post('/api/admin/publication/authorizations', { provider: 'archive', reciterId: 'banna', riwayah: 'hafs', evidence: 'TEST grant' });
    await drain();
    j = await job(B);
    expect(j.state).toBe('blocked');
    expect(j.evaluation.blockers.join(' ')).toMatch(/other recording of this reciter and surah is active/);
    const prod = await manifestOf('production');
    expect(prod.entries).toHaveLength(1);
    expect(prod.entries[0].audio.url).toBe('https://cdn.mp3quran.net/audio/test/112.wav');
  });

  it('a review that no longer holds (an amendment reopens a dispute) is withdrawn from both; its resolution publishes version 2', async () => {
    expect((await amina.post(`/api/event/${A}`, { role: 1, type: 'amend', payload: { work: fullWork((k) => (k === 3 ? 800 : 0)), reason: 'TEST: heard again' } })).status).toBe(200);
    await drain();
    expect((await manifestOf('production')).entries).toEqual([]);
    expect((await manifestOf('development')).entries).toEqual([]);
    expect((await pool.query("select count(*)::int n from publication_log where action = 'withdrawn'")).rows[0].n).toBe(2);
    expect((await bilal.post(`/api/event/${A}`, { role: 2, type: 'resolve-propose', payload: { ayah: 3, ms: syn.truth.starts[2] + 300, note: 'TEST' } })).status).toBe(200);
    expect((await amina.post(`/api/event/${A}`, { role: 1, type: 'resolve-accept', payload: { ayah: 3, note: 'TEST' } })).status).toBe(200);
    await drain();
    const prod = await manifestOf('production');
    expect(prod.entries[0].versionNo).toBe(2);
    expect((await manifestOf('development')).entries[0].versionId).toBe(prod.entries[0].versionId);
    const doc = (await anon.get(`/v1/audio-timing/versions/${prod.entries[0].versionId}`)).json;
    expect(doc.timing.entries[2].startMs).toBe(syn.truth.starts[2] + 300);
  });

  it('14. an interrupted publication leaves no partial state, is retried, and then completes', async () => {
    // Version 3 (another resolution); production refuses for a moment (the transaction fails half-way).
    await pool.query(`create or replace function qh_test_fail() returns trigger language plpgsql as $$ begin if new.environment = 'production' then raise exception 'TEST: production unavailable'; end if; return new; end $$`);
    await pool.query('create trigger qh_test_fail before insert or update on environment_activations for each row execute function qh_test_fail()');
    await bilal.post(`/api/event/${A}`, { role: 2, type: 'resolve-propose', payload: { ayah: 3, ms: syn.truth.starts[2] + 250, note: 'TEST' } });
    await amina.post(`/api/event/${A}`, { role: 1, type: 'resolve-accept', payload: { ayah: 3, note: 'TEST' } });
    await drain();
    const j = await job(A);
    expect(j.state).toBe('failed');
    expect(j.attempts).toBe(1);
    expect(j.last_error).toMatch(/production unavailable/);
    expect((await manifestOf('development')).entries[0].versionNo).toBe(2); // development NOT moved alone
    expect((await manifestOf('production')).entries[0].versionNo).toBe(2);
    expect((await pool.query('select count(*)::int n from timing_versions')).rows[0].n).toBe(2); // the version was rolled back too
    expect((await amina.get('/api/publication')).json.rows.find((r: J) => r.key === A).stage).toBe('publication-failed');
    await pool.query('drop trigger qh_test_fail on environment_activations');
    await pool.query("update publication_jobs set next_run_at = now() where review_key = $1", [A]);
    await drain();
    expect((await job(A)).state).toBe('published');
    expect((await manifestOf('production')).entries[0].versionNo).toBe(3);
    expect((await manifestOf('development')).entries[0].versionNo).toBe(3);
  });

  it('15/25. a rollback of one environment is a detectable mismatch; align recovers; a rollback holds the recording until released', async () => {
    const reg = (await amina.get('/api/publication')).json.rows.find((r: J) => r.key === A).registry[0];
    const v1 = reg.versions.find((v: J) => v.versionNo === 1).versionId;
    const v3 = reg.versions.find((v: J) => v.versionNo === 3).versionId;
    expect((await bilal.post('/api/admin/publication/rollback', { recordingId: reg.recordingId, versionId: v1, environments: ['production'], reason: 'x' })).status).toBe(403);
    expect((await amina.post('/api/admin/publication/rollback', { recordingId: reg.recordingId, versionId: v1, environments: ['production'], reason: 'TEST: production back to v1' })).status).toBe(200);
    let view = (await amina.get('/api/publication')).json;
    expect(view.mismatches).toEqual([{ recordingId: reg.recordingId, development: v3, production: v1 }]);
    expect(view.rows.find((r: J) => r.key === A).stage).toBe('published-both');
    // Held: the worker does not move it back on its own.
    await s.publisher.notify(A); await drain();
    expect((await manifestOf('production')).entries[0].versionId).toBe(v1);
    expect((await job(A)).evaluation.blockers.join(' ')).toMatch(/held by an administrator/);
    // 25. rollback of both environments to version 1
    await amina.post('/api/admin/publication/align', { recordingId: reg.recordingId, versionId: v1, reason: 'TEST: both on v1' });
    view = (await amina.get('/api/publication')).json;
    expect(view.mismatches).toEqual([]);
    expect((await manifestOf('development')).entries[0].versionId).toBe(v1);
    expect((await anon.get(`/v1/audio-timing/versions/${v3}`)).status).toBe(200); // an earlier published version stays retrievable
    expect((await amina.post('/api/admin/publication/release', { recordingId: reg.recordingId })).status).toBe(200);
    await drain();
    expect((await manifestOf('production')).entries[0].versionId).toBe(v3);
    expect((await manifestOf('development')).entries[0].versionId).toBe(v3);
  });

  it('a restart resumes: a job left running by a stopped server is taken again after its lease', async () => {
    await pool.query("update publication_jobs set state = 'running', locked_until = now() - interval '1 minute', next_run_at = now() where review_key = $1", [A]);
    await s.stop();
    s = await start(pool);
    amina = client(s.base); bilal = client(s.base); anon = client(s.base);
    await amina.login('amina@test.example'); await bilal.login('bilal@test.example');
    await drain();
    expect((await job(A)).state).toBe('published');
  });

  it('off (the default for the real service): evaluates and shows "ready", writes nothing to the registry', async () => {
    const off = await start(pool, { mode: 'off' });
    const before = (await pool.query('select count(*)::int n from publication_log')).rows[0].n;
    const r = await off.publisher.evaluate(A);
    expect(r.state).toBe('ready');
    expect((await pool.query('select count(*)::int n from publication_log')).rows[0].n).toBe(before);
    await off.stop();
  });

  it('security: the timing API is read-only and public; publication controls are for administrators; history is immutable', async () => {
    expect((await anon.get('/api/publication')).status).toBe(401);
    expect((await anon.req('POST', '/v1/audio-timing/production/manifest', {})).status).not.toBe(200);
    expect((await anon.get('/v1/audio-timing/staging/manifest')).status).toBe(404);
    expect((await anon.get(`/v1/audio-timing/versions/tv_${'0'.repeat(24)}`)).status).toBe(404);
    for (const p of ['retry', 'requeue-all', 'rollback', 'align', 'release', 'authorizations', 'authorizations/revoke']) expect((await bilal.post(`/api/admin/publication/${p}`, {})).status).toBe(403);
    await expect(pool.query("update timing_versions set content_json = '{}'")).rejects.toThrow(/immutable/);
    await expect(pool.query('delete from timing_versions')).rejects.toThrow(/immutable/);
    await expect(pool.query('delete from publication_log')).rejects.toThrow(/append-only/);
    const st = (await amina.get('/api/admin/status')).json;
    expect(st.publication).toMatchObject({ mode: 'enabled', environments: ['development', 'production'], mismatches: 0 });
  });

  it('a revoked authorization withdraws the recording from both environments (the other recording, verified and authorized on its own, may then take its place)', async () => {
    const auths = (await amina.get('/api/publication')).json.authorizations;
    const mp3 = auths.find((a: J) => a.provider === 'mp3quran' && !a.revokedAt);
    expect((await amina.post('/api/admin/publication/authorizations/revoke', { id: mp3.id, reason: 'TEST: permission withdrawn' })).status).toBe(200);
    await drain();
    for (const env of ['production', 'development']) {
      const m = await manifestOf(env);
      expect(m.entries.map((e: J) => e.audio.url)).toEqual(['https://archive.org/download/test/112.wav']); // never the revoked mp3quran file
    }
    expect((await job(A)).evaluation.blockers.join(' ')).toMatch(/no authorization recorded for mp3quran/);
    expect((await pool.query("select count(*)::int n from publication_log where action = 'withdrawn' and actor = 'publisher'")).rows[0].n).toBe(4);
  });

  it('4.8.5: device seek measurements are recorded by administrators only, validated, and judged by the server (not the caller)', async () => {
    const m = { recordingSha256: sha(syn.wav), platform: 'ios', method: 'vbr-mllt', appBuild: 'TEST 1.0 (1)', device: 'TEST iPhone', samples: 24, maxAbsErrorMs: 75, evidence: 'TEST measurement sheet', passed: true };
    expect((await bilal.post('/api/admin/publication/seek-verifications', m)).status).toBe(403);
    expect((await amina.post('/api/admin/publication/seek-verifications', { ...m, samples: 3 })).status).toBe(409);
    expect((await amina.post('/api/admin/publication/seek-verifications', { ...m, platform: 'web' })).status).toBe(409);
    const r = await amina.post('/api/admin/publication/seek-verifications', m);
    expect(r.status).toBe(200);
    expect(r.json.passed).toBe(false); // 75 ms is outside the tolerance, whatever the caller said
    const view = (await amina.get('/api/publication')).json;
    expect(view.seekVerifications.find((x: J) => x.id === r.json.id)).toMatchObject({ platform: 'ios', passed: false, maxAbsErrorMs: 75 });
    expect(view.appCapabilities).toEqual({ 'cbr-exact': ['android', 'ios'], 'vbr-mllt': [] });
    expect((await amina.post('/api/admin/publication/seek-verifications/revoke', { id: r.json.id })).status).toBe(200);
  });

  it('backups include the registry; a restore reproduces it exactly', async () => {
    const b = await backup.exportBackup(pool);
    expect(b.manifest.counts.timing_versions).toBe(4); // three of the mp3quran recording, one of the archive recording
    expect(backup.verifyBackup(b.text)).toEqual([]);
    const target = await newDb('pubrestore');
    await backup.restoreBackup(target, b.text);
    expect((await registry.registryOverview(target)).map((r: J) => r.versions.length)).toEqual((await registry.registryOverview(pool)).map((r: J) => r.versions.length));
    expect(await registry.listAuthorizations(target)).toEqual(await registry.listAuthorizations(pool));
  });
});
