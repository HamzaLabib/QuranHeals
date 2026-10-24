import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 4.8.2: the cloud audio review dashboard, against a REAL PostgreSQL (embedded-postgres, temporary), with
// SYNTHETIC recordings (tone bursts), test accounts and a fake provider. No real review, no real database, no network.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const cloud = (p: string) => imp(`review/cloud/${p}`);
const { default: EmbeddedPostgres } = await import(pathToFileURL(join(tools, 'review/cloud/node_modules/embedded-postgres/dist/index.js')).href);
const db = await cloud('db.mjs');
const { createCloudServer } = await cloud('server.mjs');
const auth = await cloud('auth.mjs');
const { importBundle } = await cloud('import.mjs');
const backup = await cloud('backup.mjs');
const { buildBundle } = await cloud('migrate.mjs');
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');
const { timingFingerprint } = await imp('fingerprint.mjs');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-cloud-'));
const PY = process.env.QH_PYTHON ?? 'python';
const freePort = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
let pg: J;
const PGPORT = await freePort();
const url = (dbname: string) => `postgres://qh:qh-test@127.0.0.1:${PGPORT}/${dbname}`;
async function newDb(name: string) {
  const admin = db.createPool(url('postgres'), { ssl: false, max: 1 });
  await admin.query(`create database ${name} encoding 'UTF8' template template0`);
  await admin.end();
  return db.createPool(url(name), { ssl: false });
}
const pools: J[] = [];
beforeAll(async () => {
  pg = new EmbeddedPostgres({ databaseDir: join(work, 'pg'), user: 'qh', password: 'qh-test', port: PGPORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
}, 120000);
afterAll(async () => {
  for (const p of pools) await p.end().catch(() => {});
  await pg?.stop().catch(() => {});
  // Windows: the stopped server can hold its files for a moment (EPERM under load); retry, then leave the temp folder
  try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* temp folder only */ }
}, 60000);

// ---------------------------------------------------------------- a synthetic local workspace
const syn = makeSynthetic({ surah: 112, key: 'syn-112' });
const syn98 = makeSynthetic({ surah: 98, key: 'syn-98' });
const { text } = lib.canon();
const BAS = text.get('1:1');
function pkg(surah: number, mode = 'cbr') {
  const n = lib.canon().meta.get(surah).ayahs;
  const starts = syn.truth.starts.slice(0, n);
  const ayahs = Array.from({ length: n }, (_, k) => { const t = text.get(`${surah}:${k + 1}`) as string; return { ayah: k + 1, startMs: starts[k], endMs: k + 1 < n ? starts[k + 1] : syn.truth.endMs, text: k === 0 ? t.split(' ').slice(BAS.split(' ').length).join(' ') : t }; });
  const p: J = { kind: 'ayah-timing-review-package', version: 1, source: 'aligned', createdOn: '2026-10-19', reciterId: 'banna', reciterEn: 'x', reciterAr: 'x', recording: 'test', surah, surahAr: 'x', surahEn: `S${surah}`, ayahCount: n,
    url: `https://cdn.mp3quran.net/audio/test/${surah}.wav`, bytes: syn.wav.length, format: { kbps: 128, mode, durationMs: syn.session.durationMs }, textSource: 't', status: 's', durationMs: syn.session.durationMs, intro: null, basmala: BAS, ayahs,
    boundaries: ayahs.slice(1).map((a, k) => ({ ayah: a.ayah, ms: a.startMs, flags: k === 0 ? ['no-pause'] : [], priority: k === 0 ? 1 : 3, pauseMs: null })), worklist: [2], structure: { ok: true, problems: [] } };
  p.candidateFingerprint = timingFingerprint(p.ayahs.map((a: J) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs })));
  return p;
}
const ws = join(work, 'ws');
const man = join(work, 'manual');
function workspace() {
  for (const d of ['sessions', 'audio', 'data']) mkdirSync(join(man, d), { recursive: true });
  writeFileSync(join(man, 'sessions', 'syn-98.json'), JSON.stringify(syn98.session));
  writeFileSync(join(man, 'audio', 'syn-98.wav'), syn98.wav);
  const pk = join(work, 'packages');
  const entries = [];
  for (const [s, mode] of [[112, 'cbr'], [108, 'vbr']] as const) {
    mkdirSync(join(pk, 'aligned', 'banna'), { recursive: true });
    writeFileSync(join(pk, 'aligned', 'banna', `${s}.json`), JSON.stringify(pkg(s, mode)));
    entries.push({ file: `aligned/banna/${s}.json` });
  }
  writeFileSync(join(pk, 'index.json'), JSON.stringify({ kind: 'ayah-timing-review-index', packages: entries }));
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'dashboard.config.json'), JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: 'backups',
    sources: [{ id: 'syn', kind: 'manual-sessions', sessions: '../manual/sessions', audio: '../manual/audio', data: '../manual/data' }, { id: 'pk', kind: 'review-packages', phase: 'T', dir: '../packages' }] }));
  const cfg = lib.readConfig(join(ws, 'dashboard.config.json'));
  lib.importAll(cfg);
  // A LEGACY review (written before accounts existed), by a synthetic name, on the synthetic recording.
  let st = manual.emptyState(); let prev = 'genesis'; const lines: string[] = [];
  const draft = { markers: { 1: { ms: syn98.truth.starts[0], status: 'confirmed' }, 2: { ms: syn98.truth.starts[1], status: 'confirmed' } }, end: null, flags: [], checks: {}, comments: '' };
  for (const [type, payload] of [['join', {}], ['draft', { work: draft }], ['submit-ayahs', { keys: ['1'] }]] as const) {
    const ev: J = { seq: lines.length + 1, at: `2026-10-19T09:0${lines.length}:00.000Z`, reviewer: 'Legacy Tester', role: 1, type, payload, prev };
    manual.applyEvent(syn98.session, st, ev); ev.hash = manual.eventHash(prev, ev); prev = ev.hash; lines.push(JSON.stringify(ev));
  }
  mkdirSync(join(man, 'data', 'syn-98'), { recursive: true });
  writeFileSync(join(man, 'data', 'syn-98', 'events.jsonl'), lines.join('\n') + '\n');
  st = null;
  return { cfgFile: join(ws, 'dashboard.config.json'), legacyLines: lines };
}
const W = workspace();

/** A fake provider: serves the synthetic tones at the package URLs, with ranges. `down` makes it fail. */
const provider = { down: new Set<string>(), served: 0 };
const fakeFetch = async (u: string, opts: J = {}) => {
  const path = new URL(u).pathname;
  if (provider.down.has(path)) return new Response('gone', { status: 404 });
  provider.served++;
  const m = /bytes=(\d+)-(\d+)/.exec(opts.headers?.Range ?? '');
  if (m) { const a = Number(m[1]), b = Number(m[2]); return new Response(syn.wav.subarray(a, b + 1), { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${syn.wav.length}` } }); }
  return new Response(syn.wav, { status: 200, headers: { 'content-length': String(syn.wav.length) } });
};

// ---------------------------------------------------------------- an HTTP client with its own cookie
function client(base: string) {
  let cookie = '';
  const req = async (method: string, p: string, body?: J, headers: J = {}) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json', origin: base } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const t = await r.text();
    let json: J = null; try { json = JSON.parse(t); } catch { /* html */ }
    return { status: r.status, json, text: t, headers: r.headers };
  };
  return { req, get: (p: string) => req('GET', p), post: (p: string, b: J = {}, h: J = {}) => req('POST', p, b, h), login: (email: string) => req('POST', '/auth/google', { credential: `test:${email}` }), cookie: () => cookie };
}
const verifier = async (c: string) => { const m = /^test:(.+)$/.exec(c); if (!m) throw Object.assign(new Error('bad'), { status: 401 }); return { sub: `sub-${m[1]}`, email: m[1], emailVerified: true }; };
const ADMIN_TOKEN = 'qh-test-admin-token-0123456789abcdefghijklmnop';
const sha = async (s: string) => (await import('node:crypto')).createHash('sha256').update(s).digest('hex');

async function start(pool: J, extra: J = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const d = await createCloudServer({ pool, publicUrl: base, cookieSecure: false, verifier, adminTokenSha256: await sha(ADMIN_TOKEN), scratchDir: join(work, `scratch-${port}`), python: PY, fetchImpl: fakeFetch, ...extra });
  await new Promise<void>((r) => d.server.listen(port, '127.0.0.1', () => r()));
  return { ...d, base, stop: () => new Promise<void>((r) => d.server.close(() => r())) };
}

describe('cloud: migration of a local dashboard (synthetic)', () => {
  let pool: J;
  let bundle: J;
  beforeAll(async () => { pool = await newDb('mig'); pools.push(pool); await db.migrate(pool); bundle = buildBundle(W.cfgFile).bundle; }, 60000);

  it('bundles every recording, review log (byte for byte) and the inventory, without any local path', () => {
    expect(bundle.recordings.map((r: J) => r.key).sort()).toEqual(['banna-108', 'banna-112', 'syn-98']);
    expect(bundle.events['syn-98']).toEqual(W.legacyLines);
    const json = JSON.stringify(bundle);
    expect(json).not.toMatch(/[A-Za-z]:\\\\|\/Users\/|AppData/);
    expect(bundle.recordings.find((r: J) => r.key === 'banna-112').session.provenance.packageFile).toBe('package:banna-112');
  });

  it('dry run writes nothing; apply is atomic and idempotent; the log is stored line for line', async () => {
    const dry = await importBundle(pool, bundle, { allowEvents: true, dryRun: true, by: 't' });
    expect(dry).toMatchObject({ dryRun: true, eventsAppended: { 'syn-98': 3 } });
    expect((await pool.query('select count(*)::int n from recordings')).rows[0].n).toBe(0);
    const r = await importBundle(pool, bundle, { allowEvents: true, by: 't' });
    expect(r.added).toHaveLength(3);
    const lines = (await pool.query("select line from review_events where recording_key = 'syn-98' order by seq")).rows.map((x: J) => x.line);
    expect(lines).toEqual(W.legacyLines);
    const again = await importBundle(pool, bundle, { allowEvents: true, by: 't' });
    expect(again).toMatchObject({ eventsAppended: { 'syn-98': 0 }, eventsAlreadyPresent: { 'syn-98': 3 } }); // duplicates recognised, never doubled
    expect((await pool.query('select count(*)::int n from review_events')).rows[0].n).toBe(3);
  });

  it('refuses a diverged log, a tampered package, and review events through a package import', async () => {
    const forked = structuredClone(bundle);
    const ev = JSON.parse(forked.events['syn-98'][2]); ev.payload.keys = ['2']; forked.events['syn-98'][2] = JSON.stringify(ev);
    await expect(importBundle(pool, forked, { allowEvents: true, by: 't' })).rejects.toThrow(/hash chain broken|differs from the database/);
    const tampered = structuredClone(bundle);
    tampered.recordings.find((r: J) => r.key === 'banna-112').session.ayahs[1].text += 'ـ';
    await expect(importBundle(pool, { ...tampered, events: undefined }, { by: 't' })).rejects.toThrow(/text differs/);
    await expect(importBundle(pool, bundle, { by: 't' })).rejects.toThrow(/only be imported by the migration/);
  });

  it('never rewrites history: review_events is append-only in the database itself', async () => {
    await expect(pool.query("update review_events set reviewer = 'X'")).rejects.toThrow(/append-only/);
    await expect(pool.query('delete from review_events')).rejects.toThrow(/append-only/);
    await expect(pool.query('truncate review_events')).rejects.toThrow(/append-only/);
  });

  it('links the legacy name to an account only explicitly, with evidence; the account then continues the review', async () => {
    await expect(auth.createAccount(pool, { email: 'legacy@test.example', reviewerName: 'Legacy Tester', by: 't' })).rejects.toThrow(/already appears in review logs/);
    const acc = await auth.createAccount(pool, { email: 'legacy@test.example', reviewerName: 'Owner T', roles: ['admin', 'reviewer'], by: 't' });
    await expect(auth.linkLegacyIdentity(pool, { legacyName: 'Legacy Tester', accountId: acc.id, by: 't', confirmation: 'yes' })).rejects.toThrow(/to confirm/);
    const link = await auth.linkLegacyIdentity(pool, { legacyName: 'Legacy Tester', accountId: acc.id, by: 't', confirmation: 'link Legacy Tester' });
    expect(link.evidence.recordings).toEqual([expect.objectContaining({ key: 'syn-98', events: 3, headSeq: 3 })]);
    expect((await pool.query("select reviewer, account_id from review_events where recording_key = 'syn-98'")).rows.every((x: J) => x.reviewer === 'Legacy Tester' && x.account_id === null)); // unchanged
    const s = await start(pool);
    const c = client(s.base);
    expect((await c.login('legacy@test.example')).status).toBe(200);
    const v = await c.get('/api/view/syn-98');
    expect(v.json.me).toBe(1); // the account IS Reviewer 1 of the legacy review
    expect(Object.keys(v.json.reviewers[1].submitted)).toEqual(['1']);
    const d2 = await c.post('/api/event/syn-98', { role: 1, type: 'submit-ayahs', payload: { keys: ['2'] } });
    expect(d2.status).toBe(200);
    const last = JSON.parse((await pool.query("select line from review_events where recording_key = 'syn-98' order by seq desc limit 1")).rows[0].line);
    expect(last).toMatchObject({ reviewer: 'Legacy Tester', accountId: acc.id, type: 'submit-ayahs' });
    expect(manual.verifyChain((await pool.query("select line from review_events where recording_key = 'syn-98' order by seq")).rows.map((x: J) => JSON.parse(x.line)))).toBe(-1);
    await s.stop();
  });

  it('cutover makes the local dashboard read-only; rollback pulls cloud reviews back, exact-prefix only', async () => {
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const cli = (args: string[]) => execFileSync('node', [join(tools, 'review/cloud/migrate.mjs'), ...args], { env: { ...process.env, DATABASE_URL: url('mig'), DATABASE_SSL: 'off' }, encoding: 'utf8' });
    const { createDashboard } = await imp('review/dashboard/server.mjs');
    cli(['cutover', '--config', W.cfgFile, '--url', 'https://example.invalid']);
    const d = createDashboard({ config: W.cfgFile, autoBackup: false });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(d.server.address() as J).port}`;
    const r = await fetch(`${base}/api/event/syn-98`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewer: 'X', role: 1, type: 'comment', payload: { text: 'x' } }) });
    expect(r.status).toBe(423);
    await new Promise<void>((res) => d.server.close(() => res()));
    // the cloud has one event more than the local log (the account's submission above): pull it back
    const out = JSON.parse(cli(['pull-events', '--config', W.cfgFile]));
    expect(out['syn-98']).toEqual({ local: 3, cloud: 4, appended: 1 });
    const local = readFileSync(join(man, 'data', 'syn-98', 'events.jsonl'), 'utf8').trim().split('\n');
    const cloudLines = (await pool.query("select line from review_events where recording_key = 'syn-98' order by seq")).rows.map((x: J) => x.line);
    expect(local).toEqual(cloudLines);
    expect(JSON.parse(cli(['pull-events', '--config', W.cfgFile]))['syn-98'].appended).toBe(0); // idempotent
    cli(['rollback-cutover', '--config', W.cfgFile]);
    expect(lib.readConfig(W.cfgFile).raw.readOnly).toBeUndefined();
  }, 60000);
});

describe('cloud: access, identity, blind review, concurrency', () => {
  let pool: J;
  let s: J;
  let amina: J; let bilal: J; let anon: J;
  beforeAll(async () => {
    pool = await newDb('app'); pools.push(pool); await db.migrate(pool);
    await importBundle(pool, { ...buildBundle(W.cfgFile).bundle, events: undefined }, { by: 't' });
    await auth.createAccount(pool, { email: 'amina@test.example', reviewerName: 'TEST Amina', roles: ['admin', 'reviewer'], by: 't' });
    await auth.createAccount(pool, { email: 'bilal@test.example', reviewerName: 'TEST Bilal', by: 't' });
    s = await start(pool, { limits: { perIp: 5000, perAccount: 5000, writes: 5000 } });
    amina = client(s.base); bilal = client(s.base); anon = client(s.base);
    await amina.login('amina@test.example'); await bilal.login('bilal@test.example');
  }, 60000);
  afterAll(() => s.stop());

  it('lets nobody in without signing in (pages, API, audio, administration); the health check says only ok', async () => {
    expect((await anon.get('/')).status).toBe(302);
    expect((await anon.get('/review?rec=banna-112')).headers.get('location')).toBe('/login');
    for (const p of ['/api/dashboard', '/api/session/banna-112', '/api/view/banna-112', '/api/export/banna-112', '/audio/banna-112', '/api/admin/accounts', '/api/inventory', '/api/queue']) expect((await anon.get(p)).status).toBe(401);
    expect((await anon.post('/api/event/banna-112', { role: 1, type: 'join' })).status).toBe(401);
    expect((await anon.get('/healthz')).json).toEqual({ ok: true });
    const login = await anon.get('/login');
    expect(login.status).toBe(200);
    expect(login.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-[^']+' https:\/\/accounts\.google\.com\/gsi\/client/);
    expect(login.text).not.toMatch(/<script>(?!\s*<\/)/); // every inline script carries the nonce
  });

  it('admits only registered, active accounts; sessions are HttpOnly, end at sign-out and at deactivation', async () => {
    const x = client(s.base);
    expect((await x.login('stranger@test.example')).status).toBe(403);
    const t = client(s.base);
    await auth.createAccount(pool, { email: 'temp@test.example', reviewerName: 'TEST Temp', by: 't' });
    const r = await t.login('temp@test.example');
    expect(r.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax/);
    expect((await t.get('/api/info')).json.account.reviewerName).toBe('TEST Temp');
    const id = (await pool.query("select id from accounts where email = 'temp@test.example'")).rows[0].id;
    expect((await bilal.post(`/api/admin/accounts/${id}`, { active: false })).status).toBe(403); // reviewers cannot administer
    expect((await amina.post(`/api/admin/accounts/${id}`, { active: false })).status).toBe(200);
    expect((await t.get('/api/info')).status).toBe(401); // revoked at once
    expect((await t.login('temp@test.example')).status).toBe(403);
    const u = client(s.base);
    await u.login('bilal@test.example');
    await u.post('/auth/logout');
    expect((await u.get('/api/info')).status).toBe(401);
  });

  it('refuses cross-site writes, other hosts and non-JSON bodies', async () => {
    expect((await bilal.req('POST', '/api/event/banna-112', { role: 1, type: 'join' }, { origin: 'https://evil.example' })).status).toBe(403);
    const r = await fetch(`${s.base}/api/event/banna-112`, { method: 'POST', headers: { cookie: bilal.cookie(), origin: s.base, 'content-type': 'text/plain' }, body: '{}' });
    expect(r.status).toBe(415);
    const status = await new Promise<number>((res) => { const u = new URL(s.base); http.get({ host: u.hostname, port: u.port, path: '/api/info', headers: { host: 'evil.example', cookie: bilal.cookie() } }, (x) => { x.resume(); res(x.statusCode ?? 0); }); });
    expect(status).toBe(421);
  });

  it('records the signed-in reviewer, whatever name the browser sends', async () => {
    const r = await bilal.post('/api/event/banna-112', { reviewer: 'TEST Amina', role: 1, type: 'join' });
    expect(r.status).toBe(200);
    const ev = JSON.parse((await pool.query("select line from review_events where recording_key = 'banna-112' order by seq limit 1")).rows[0].line);
    expect(ev.reviewer).toBe('TEST Bilal');
    expect(ev.accountId).toMatch(/^acc_/);
  });

  it('keeps Reviewer 2 blind per ayah, with partial submissions, across separate sessions', async () => {
    const S = syn.truth.starts;
    const w = (shift: number) => ({ markers: Object.fromEntries(S.slice(0, 4).map((ms: number, k: number) => [k + 1, { ms: ms + shift, status: 'confirmed' }])), end: null, flags: [], checks: {}, comments: '' });
    await bilal.post('/api/event/banna-112', { role: 1, type: 'draft', payload: { work: w(0) } });
    await bilal.post('/api/event/banna-112', { role: 1, type: 'submit-ayahs', payload: { keys: ['1', '2', '3'] } });
    expect((await amina.post('/api/event/banna-112', { role: 2, type: 'join' })).status).toBe(200);
    let v = await amina.get('/api/view/banna-112');
    expect(v.text).not.toContain(`"ms":${S[1]}`);
    expect(v.json.reviewers[1].submittedKeys).toEqual(['1', '2', '3']);
    await amina.post('/api/event/banna-112', { role: 2, type: 'draft', payload: { work: w(40) } });
    await amina.post('/api/event/banna-112', { role: 2, type: 'submit-ayahs', payload: { keys: ['1'] } });
    v = await amina.get('/api/view/banna-112');
    expect(v.json.revealed.map((c: J) => c.key)).toEqual([1]);
    expect(v.text).not.toContain(`"ms":${S[1]},`); // ayah 2: Amina has not submitted it
    const dash = await amina.get('/api/dashboard');
    expect(dash.json.rows.find((r: J) => r.key === 'banna-112').progress).toMatchObject({ submitted1: 3, submitted2: 1, verified: 1 });
  });

  it('serialises simultaneous writes: no lost update, no duplicate submission, an intact chain', async () => {
    const before = (await pool.query("select count(*)::int n from review_events where recording_key = 'banna-112'")).rows[0].n;
    const S = syn.truth.starts;
    const drafts = Array.from({ length: 12 }, (_, i) => [bilal, amina][i % 2].post('/api/event/banna-112', { role: (i % 2) + 1, type: 'draft', payload: { work: { markers: Object.fromEntries(S.slice(0, 4).map((ms: number, k: number) => [k + 1, { ms: ms + (i % 2) * 40, status: 'confirmed', note: `n${i}` }])), end: null, flags: [], checks: {}, comments: `c${i}` } } }));
    const dup = Array.from({ length: 6 }, () => amina.post('/api/event/banna-112', { role: 2, type: 'submit-ayahs', payload: { keys: ['2'] } }));
    const res = await Promise.all([...drafts, ...dup]);
    const okDup = res.slice(12).filter((r) => r.status === 200).length;
    expect(okDup).toBe(1);
    expect(res.slice(12).filter((r) => r.status === 409).every((r) => /already submitted/.test(r.json.error))).toBe(true);
    expect(res.slice(0, 12).every((r) => r.status === 200)).toBe(true);
    const rows = (await pool.query("select line from review_events where recording_key = 'banna-112' order by seq")).rows.map((x: J) => JSON.parse(x.line));
    expect(rows.length).toBe(before + 13);
    expect(manual.verifyChain(rows)).toBe(-1);
    const state = manual.replay(s.store.load('banna-112').session, rows);
    expect(state.reviewers[1].work.comments).toMatch(/^c\d+$/); // each reviewer kept their own latest draft
    expect(state.reviewers[2].work.comments).toMatch(/^c\d+$/);
  });

  it('Phase 4.8.4.1: a bulk decision is one audited event; duplicates are refused, nothing applied twice', async () => {
    const before = (await pool.query("select count(*)::int n from review_events where recording_key = 'banna-112'")).rows[0].n;
    const dup = Array.from({ length: 6 }, () => bilal.post('/api/event/banna-112', { role: 1, type: 'bulk', payload: { action: 'accept-proposed', keys: ['end'] } }));
    const res = await Promise.all(dup);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status !== 200).every((r) => /already confirmed \(nothing was applied\)/.test(r.json.error))).toBe(true);
    const rows = (await pool.query("select line from review_events where recording_key = 'banna-112' order by seq")).rows.map((x: J) => JSON.parse(x.line));
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toMatchObject({ type: 'bulk', reviewer: 'TEST Bilal', payload: { action: 'accept-proposed', keys: ['end'] } });
    expect(manual.verifyChain(rows)).toBe(-1);
    const v = await bilal.get('/api/view/banna-112');
    expect(v.json.reviewers[1].work.end).toMatchObject({ status: 'confirmed', origin: 'proposal' });
    // the other reviewer's work is untouchable from this account
    expect((await bilal.post('/api/event/banna-112', { role: 2, type: 'bulk', payload: { action: 'accept-proposed', keys: ['end'] } })).status).not.toBe(200);
  });

  it('restores everything after a restart (state rebuilt from the database)', async () => {
    const before = (await amina.get('/api/view/banna-112')).json;
    await s.stop();
    s = await start(pool, { limits: { perIp: 5000, perAccount: 5000, writes: 5000 } });
    const a2 = client(s.base); await a2.login('amina@test.example');
    amina = a2; const b2 = client(s.base); await b2.login('bilal@test.example'); bilal = b2;
    anon = client(s.base);
    const after = (await amina.get('/api/view/banna-112')).json;
    expect(after.reviewers[2].submitted).toEqual(before.reviewers[2].submitted);
    expect(after.progress).toEqual(before.progress);
  });

  it('checks the source and draws the waveform from the provider; plays directly (redirect) or decoded (VBR)', async () => {
    expect((await amina.get('/audio/banna-112')).status).toBe(409); // not prepared: the source is not yet checked
    await amina.post('/api/prepare/banna-112', {});
    let st: J;
    for (let i = 0; i < 100; i++) { st = (await amina.get('/api/prepare/banna-112')).json; if (st.state !== 'working') break; await new Promise((r) => setTimeout(r, 100)); }
    expect(st.state, st.error).toBe('ready');
    const sess = (await amina.get('/api/session/banna-112')).json;
    expect(sess.peaks.binMs).toBe(5);
    // Phase 4.8.8: the same effective opening as the local dashboard: ayah 1 proposed at 0:00.000, its onset kept apart.
    expect(sess.opening).toMatchObject({ rule: 'opening-zero-v1', applies: true, startMs: 0 });
    expect(sess.proposal.starts['1']).toBe(0);
    expect(sess.proposal.openingOnsetMs).toBe(sess.opening.onsetMs);
    expect(sess.proposal.boundaries.find((b: J) => b.ayah === 1)).toMatchObject({ ms: 0, onsetMs: sess.opening.onsetMs });
    const pending = (await amina.get('/api/session/banna-108')).json; // not prepared yet: the rule applies as well
    expect(pending.proposal.starts['1']).toBe(0);
    expect((await pool.query("select count(*)::int n from waveforms where key = 'banna-112'")).rows[0].n).toBe(1);
    const a = await amina.get('/audio/banna-112');
    expect(a.status).toBe(302);
    expect(a.headers.get('location')).toBe('https://cdn.mp3quran.net/audio/test/112.wav'); // the original, nothing mirrored
    await amina.post('/api/prepare/banna-108', {});
    for (let i = 0; i < 100; i++) { st = (await amina.get('/api/prepare/banna-108')).json; if (st.state !== 'working') break; await new Promise((r) => setTimeout(r, 100)); }
    expect(st.state, st.error).toBe('ready');
    const r = await fetch(`${s.base}/audio/banna-108`, { headers: { cookie: amina.cookie(), Range: 'bytes=44-1043' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-type')).toBe('audio/wav');
    expect((await anon.get('/audio/banna-108')).status).toBe(401);
  });

  it('keeps a task listed when its source fails, with the reason', async () => {
    provider.down.add('/audio/test/108.wav');
    const c = client(s.base); await c.login('bilal@test.example');
    // a fresh server has no cached source check: it must ask the provider again
    const s2 = await start(pool); const c2 = client(s2.base); await c2.login('bilal@test.example');
    await c2.post('/api/prepare/banna-108', {});
    let st: J;
    for (let i = 0; i < 50; i++) { st = (await c2.get('/api/prepare/banna-108')).json; if (st.state !== 'working') break; await new Promise((r) => setTimeout(r, 100)); }
    expect(st.state).toBe('error');
    expect(st.error).toMatch(/HTTP 404/);
    expect((await c2.get('/audio/banna-108')).status).toBe(409);
    expect((await c2.get('/api/dashboard')).json.rows.some((r: J) => r.key === 'banna-108')).toBe(true);
    await s2.stop();
    provider.down.clear();
    expect((await c.get('/audio/syn-98')).status).toBe(404); // a synthetic recording has no provider: unavailable
  });

  it('never exposes a local path, refuses path tricks, oversized bodies and floods', async () => {
    for (const p of ['/api/dashboard', '/api/session/banna-112', '/api/inventory', '/api/queue', '/api/info']) expect((await amina.get(p)).text).not.toMatch(/[A-Za-z]:\\\\|\\\\Users|\/Users\/|AppData/);
    expect((await amina.get('/api/session/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await amina.get('/audio/..%5C..%5Cwindows')).status).toBe(404);
    const big = await amina.post('/api/event/banna-112', { role: 2, type: 'comment', payload: { text: 'x'.repeat(3 * 1024 * 1024) } });
    expect(big.status).toBe(413);
    const s3 = await start(pool, { limits: { perIp: 5 } });
    const c = client(s3.base);
    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await c.get('/api/info')).status);
    expect(codes).toContain(429);
    await s3.stop();
  });

  it('administration: imports by token or administrator only, never review events; read-only stops every write', async () => {
    expect((await bilal.post('/api/admin/import', { bundle: {} })).status).toBe(403);
    const bad = await fetch(`${s.base}/api/admin/status`, { headers: { authorization: 'Bearer wrong-token-wrong-token-wrong-token-xx' } });
    expect(bad.status).toBe(401);
    const st = await fetch(`${s.base}/api/admin/status`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    expect((await st.json()).recordings).toBe(3);
    const withEvents = await fetch(`${s.base}/api/admin/import`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ bundle: buildBundle(W.cfgFile).bundle }) });
    expect(withEvents.status).toBe(403);
    const ok = await fetch(`${s.base}/api/admin/import`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ bundle: { ...buildBundle(W.cfgFile).bundle, events: undefined } }) });
    const j = await ok.json();
    expect(j.keptInReview).toEqual([]);
    expect(j.unchanged).toHaveLength(3); // nothing duplicated
    expect((await amina.post('/api/admin/read-only', { readOnly: true, reason: 'test maintenance' })).status).toBe(200);
    expect((await bilal.post('/api/event/banna-112', { role: 1, type: 'comment', payload: { text: 'x' } })).status).toBe(423);
    await amina.post('/api/admin/read-only', { readOnly: false });
    expect((await bilal.post('/api/event/banna-112', { role: 1, type: 'comment', payload: { text: 'x' } })).status).toBe(200);
  }, 30000);
});

describe('cloud: backup and restore', () => {
  it('backs up with a manifest, restores only into an empty database, and detects damage', async () => {
    const src = await newDb('bsrc'); pools.push(src); await db.migrate(src);
    const bnd = buildBundle(W.cfgFile).bundle;
    await importBundle(src, bnd, { allowEvents: true, by: 't' });
    const b = await backup.exportBackup(src);
    expect(backup.verifyBackup(b.text)).toEqual([]);
    expect(b.text).not.toMatch(/token_hash/); // sign-in sessions are never backed up
    const dst = await newDb('bdst'); pools.push(dst);
    const r = await backup.restoreBackup(dst, b.text);
    expect(r.counts.review_events).toBe(bnd.events['syn-98'].length);
    const a = (await src.query('select line from review_events order by recording_key, seq')).rows.map((x: J) => x.line);
    const c = (await dst.query('select line from review_events order by recording_key, seq')).rows.map((x: J) => x.line);
    expect(c).toEqual(a);
    await expect(backup.restoreBackup(dst, b.text)).rejects.toThrow(/not empty/);
    const lines = b.text.split('\n');
    const i = lines.findIndex((l: string) => l.includes('"t":"review_events"'));
    lines[i] = lines[i].replace('Legacy Tester', 'Legacy Testex');
    expect(backup.verifyBackup(lines.join('\n')).join()).toMatch(/SHA-256 does not match/);
  });
});
