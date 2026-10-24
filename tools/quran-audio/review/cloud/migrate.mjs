// Migration and operations CLI of the cloud audio review dashboard (Phase 4.8.2). Run from tools/quran-audio on the
// owner's computer. DATABASE_URL is the Render database's EXTERNAL URL (never printed); ADMIN_TOKEN for the API.
//
//   bundle   --config <local dashboard.config.json> --out <file>     the local dashboard -> one sanitised bundle
//            (every recording + original package, every review log byte for byte, local waveforms, the inventory)
//            with a SHA-256 manifest. Reads only; refuses a broken chain or a package that changed since import.
//   plan     --bundle <file>                                          dry run against DATABASE_URL: what would be
//            added, kept, appended; conflicts; writes nothing
//   apply    --bundle <file>                                          the import (one transaction; idempotent:
//            already-present events are recognised byte for byte, never duplicated)
//   verify   --bundle <file>                                          every bundled log is in the database exactly
//            (same lines, same head hash) and replays to the same status
//   create-account --email <e> --name <reviewer name> [--display <d>] [--roles admin,reviewer]
//   link-identity  --legacy <name> --email <account e-mail>          the explicit, evidenced identity link
//   backup   --out <file> [--waveforms]                               a verified logical backup (NDJSON + .sha256)
//   restore  --from <file>                                            into an EMPTY database only, verified
//   source-check --bundle <file> [--out <report>]                     which recordings their providers still serve
//   push-packages --config <local cfg> --url <https://service> (ADMIN_TOKEN)   new or changed recordings (no events)
//   pull-events --config <local cfg>                                  rollback: cloud reviews -> the local logs (exact
//            prefix rule; only missing lines appended; refused while the local dashboard runs)
//   cutover  --config <local cfg> --url <https://service>             make the LOCAL dashboard read-only
//   rollback-cutover --config <local cfg>                             make it writable again (only after the cloud was
//            set read-only and its data brought back: see README "Rollback")
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readConfig } from '../dashboard/dashboard-lib.mjs';
import { recordingStatus, replay, verifyChain } from '../manual/manual-lib.mjs';
import { createAccount, linkLegacyIdentity } from './auth.mjs';
import { exportBackup, restoreBackup, verifyBackup } from './backup.mjs';
import { createPool, migrate } from './db.mjs';
import { BUNDLE_KIND, importBundle, LOCAL_PATH } from './import.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** Replaces every absolute local path in a string by its last two components (no Windows path leaves the computer). */
const PATHS = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^"'\n\r,;)]*|\\\\[^"'\n\r,;)]*/g;
const tail = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2).join('/');
export function sanitize(value) {
  if (typeof value === 'string') return value.replace(PATHS, (m) => `…/${tail(m)}`);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  return value;
}

/**
 * The migration bundle of a local dashboard. `events: false` leaves the review logs out (package pushes).
 * Throws on a broken chain, an unreadable session or a package that changed since it was imported.
 */
export function buildBundle(cfgFile, { events = true, keys = null, now = () => new Date().toISOString() } = {}) {
  const cfg = readConfig(cfgFile);
  const inv = readJson(path.join(cfg.registryDir, 'inventory.json'));
  const recordings = [];
  const logs = {};
  const waveforms = [];
  const manifestLogs = {};
  for (const t of inv.tasks) {
    if (keys && !keys.has(t.key)) continue;
    const session = readJson(t.sessionFile);
    let packageRaw = null;
    if (t.sourceKind === 'review-packages') {
      packageRaw = fs.readFileSync(session.provenance.packageFile, 'utf8');
      if (sha(packageRaw) !== session.provenance.packageSha256) throw new Error(`${t.key}: the package on disk changed since it was imported (${session.provenance.packageFile})`);
    }
    const s = structuredClone(session);
    if (s.provenance) {
      if (s.provenance.packageFile) s.provenance.packageFile = `package:${t.key}`;
      s.provenance = sanitize(s.provenance);
    }
    const { sessionFile, dataDir, audioFile, audioHow, audioProblem, ...rest } = t;
    const task = sanitize({ ...rest, provenance: { ...rest.provenance, ...(rest.provenance?.sessionFile ? { sessionFile: `session:${t.key}` } : {}), ...(rest.provenance?.packageFile ? { packageFile: `package:${t.key}` } : {}) } });
    recordings.push({ key: t.key, session: s, task, ...(packageRaw ? { packageRaw } : {}) });
    const log = path.join(t.dataDir, t.key, 'events.jsonl');
    if (events && fs.existsSync(log)) {
      const raw = fs.readFileSync(log, 'utf8');
      const lines = raw.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
      const ev = lines.map((l) => JSON.parse(l));
      const broken = verifyChain(ev);
      if (broken >= 0) throw new Error(`${t.key}: the local review log is broken at event ${broken + 1}`);
      const state = replay(session, ev);
      logs[t.key] = lines;
      manifestLogs[t.key] = { events: lines.length, fileSha256: sha(raw), headHash: ev.at(-1).hash, reviewers: [...new Set(ev.map((e) => e.reviewer))], status: recordingStatus(session, state).status };
    }
    const wf = path.join(cfg.cacheDir, 'peaks', `${t.key}.json`);
    if (fs.existsSync(wf)) {
      const json = fs.readFileSync(wf, 'utf8');
      const w = JSON.parse(json);
      if (w.bytes === session.bytes && (!session.sha256 || w.sha256 === session.sha256)) waveforms.push({ key: t.key, json });
    }
  }
  const { tasks, config, ...invRest } = inv;
  const bundle = { kind: BUNDLE_KIND, version: 1, createdAt: now(), source: 'local audio review dashboard', recordings, waveforms, inventory: sanitize(invRest), ...(events ? { events: logs } : {}) };
  if (LOCAL_PATH.test(JSON.stringify({ r: recordings.map((r) => [r.session.provenance, r.task]), i: bundle.inventory }))) throw new Error('a local path survived sanitising: not bundling');
  return { bundle, manifest: { recordings: recordings.length, waveforms: waveforms.length, logs: manifestLogs } };
}

async function main() {
  const a = process.argv.slice(2);
  const cmd = a[0];
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  const db = () => {
    const url = opt('--database-url') ?? process.env.DATABASE_URL;
    if (!url) throw new Error('set DATABASE_URL (the database\'s external URL) in the environment; it is never printed');
    return createPool(url, { ssl: process.env.DATABASE_SSL === 'no-verify' ? 'no-verify' : process.env.DATABASE_SSL === 'off' ? false : undefined, max: 4 });
  };
  const loadBundle = (f) => {
    const text = fs.readFileSync(f, 'utf8');
    const want = fs.existsSync(`${f}.sha256`) ? fs.readFileSync(`${f}.sha256`, 'utf8').trim().split(/\s+/)[0] : null;
    if (want && want !== sha(text)) throw new Error(`${f}: the SHA-256 does not match ${f}.sha256 (damaged?)`);
    return JSON.parse(text);
  };
  const out = (o) => console.log(JSON.stringify(o, null, 1));
  if (cmd === 'bundle') {
    const { bundle, manifest } = buildBundle(opt('--config'));
    const text = JSON.stringify(bundle);
    fs.writeFileSync(opt('--out'), text);
    fs.writeFileSync(`${opt('--out')}.sha256`, `${sha(text)}  ${path.basename(opt('--out'))}\n`);
    fs.writeFileSync(`${opt('--out')}.manifest.json`, JSON.stringify({ ...manifest, bundleSha256: sha(text), bytes: text.length }, null, 1));
    out({ written: opt('--out'), sha256: sha(text), bytes: text.length, recordings: manifest.recordings, waveforms: manifest.waveforms, logs: manifest.logs });
  } else if (cmd === 'plan' || cmd === 'apply') {
    const pool = db();
    await migrate(pool);
    const r = await importBundle(pool, loadBundle(opt('--bundle')), { allowEvents: true, dryRun: cmd === 'plan', by: 'migration-cli', kind: 'migration' });
    out({ ...r, added: r.added.length, updated: r.updated.length, unchanged: r.unchanged.length });
    await pool.end();
  } else if (cmd === 'verify') {
    const pool = db();
    const bundle = loadBundle(opt('--bundle'));
    const problems = [];
    const summary = {};
    for (const [key, lines] of Object.entries(bundle.events ?? {})) {
      const dbLines = (await pool.query('select line from review_events where recording_key = $1 order by seq', [key])).rows.map((x) => x.line);
      for (let i = 0; i < lines.length; i++) if (dbLines[i] !== lines[i]) { problems.push(`${key}: event ${i + 1} differs or is missing`); break; }
      const rec = bundle.recordings.find((x) => x.key === key);
      const dbSession = (await pool.query('select session_json from recordings where key = $1', [key])).rows[0];
      const ev = dbLines.map((l) => JSON.parse(l));
      const st = replay(JSON.parse(dbSession.session_json), ev);
      summary[key] = { bundleEvents: lines.length, databaseEvents: dbLines.length, head: ev.at(-1)?.hash, chain: verifyChain(ev) === -1 ? 'valid' : 'BROKEN', status: recordingStatus(rec.session, st).status, reviewers: Object.values(st.reviewers).map((r) => `R${r.role} ${r.name}${r.submittedAt ? ' (submitted)' : ''}`) };
    }
    const n = (await pool.query('select count(*)::int as n from recordings')).rows[0].n;
    if (n < bundle.recordings.length) problems.push(`the database has ${n} recordings, the bundle ${bundle.recordings.length}`);
    out({ ok: !problems.length, problems, recordings: n, logs: summary });
    await pool.end();
    if (problems.length) process.exit(1);
  } else if (cmd === 'create-account') {
    const pool = db();
    await migrate(pool);
    out(await createAccount(pool, { email: opt('--email'), reviewerName: opt('--name'), displayName: opt('--display') ?? opt('--name'), roles: (opt('--roles') ?? 'reviewer').split(','), by: 'cli' }));
    await pool.end();
  } else if (cmd === 'link-identity') {
    const pool = db();
    const acc = (await pool.query('select id from accounts where lower(email) = lower($1)', [opt('--email')])).rows[0];
    if (!acc) throw new Error(`no account for ${opt('--email')}`);
    out(await linkLegacyIdentity(pool, { legacyName: opt('--legacy'), accountId: acc.id, by: 'cli', confirmation: `link ${opt('--legacy')}` }));
    await pool.end();
  } else if (cmd === 'backup') {
    const pool = db();
    const b = await exportBackup(pool, { includeWaveforms: a.includes('--waveforms') });
    const problems = verifyBackup(b.text);
    if (problems.length) throw new Error(`the backup failed its own check: ${problems.join('; ')}`);
    fs.writeFileSync(opt('--out'), b.text);
    fs.writeFileSync(`${opt('--out')}.sha256`, `${sha(b.text)}  ${path.basename(opt('--out'))}\n`);
    await pool.query('insert into backups (kind, sha256, bytes, detail) values ($1,$2,$3,$4)', ['cli', b.manifest.sha256, b.text.length, { counts: b.manifest.counts }]);
    out({ written: opt('--out'), counts: b.manifest.counts, logs: Object.keys(b.manifest.logs).length, chainProblems: b.manifest.chainProblems });
    await pool.end();
  } else if (cmd === 'restore') {
    const pool = db();
    out(await restoreBackup(pool, fs.readFileSync(opt('--from'), 'utf8')));
    await pool.end();
  } else if (cmd === 'source-check') {
    const bundle = loadBundle(opt('--bundle'));
    const results = [];
    const queue = [...bundle.recordings];
    async function worker() {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const s = r.session;
        let res = null;
        try {
          const x = await fetch(s.url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
          const total = Number(/\/(\d+)$/.exec(x.headers.get('content-range') ?? '')?.[1] ?? NaN);
          try { await x.body?.cancel(); } catch { /* ignore */ }
          res = { status: x.status, ranges: x.status === 206, total, sizeOk: total === s.bytes, finalHost: new URL(x.url).host };
        } catch (error) { res = { error: error.message }; }
        results.push({ key: r.key, provider: s.provider ?? null, vbr: s.format?.mode === 'vbr', bytes: s.bytes, ...res });
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    const ok = results.filter((x) => x.sizeOk && x.ranges);
    const report = { checkedAt: new Date().toISOString(), recordings: results.length, directPlayable: ok.length, problems: results.filter((x) => !(x.sizeOk && x.ranges)), byProvider: Object.fromEntries([...new Set(results.map((x) => x.provider))].map((p) => [p, { total: results.filter((x) => x.provider === p).length, ok: ok.filter((x) => x.provider === p).length }])) };
    if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify({ ...report, results }, null, 1));
    out(report);
  } else if (cmd === 'push-packages') {
    const token = process.env.ADMIN_TOKEN;
    if (!token) throw new Error('set ADMIN_TOKEN in the environment');
    const { bundle } = buildBundle(opt('--config'), { events: false });
    const body = JSON.stringify({ bundle, dryRun: a.includes('--dry-run') });
    const r = await fetch(new URL('/api/admin/import', opt('--url')), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
    const j = await r.json();
    out({ status: r.status, ...j, added: j.added?.length ?? j.added, unchanged: j.unchanged?.length ?? j.unchanged });
  } else if (cmd === 'pull-events') {
    // Rollback: brings reviews made in the cloud back into the local logs. Each local log must be an exact prefix of the
    // cloud's (byte for byte); only the missing lines are appended. Refused while a local server holds a data folder.
    const cfg = readConfig(opt('--config'));
    const inv = readJson(path.join(cfg.registryDir, 'inventory.json'));
    const pool = db();
    const report = {};
    for (const t of inv.tasks) {
      const lock = path.join(t.dataDir, '.review-server.lock');
      if (fs.existsSync(lock)) throw new Error(`${t.dataDir} is locked by a running local dashboard: stop it first`);
      const lines = (await pool.query('select line from review_events where recording_key = $1 order by seq', [t.key])).rows.map((x) => x.line);
      if (!lines.length) continue;
      const file = path.join(t.dataDir, t.key, 'events.jsonl');
      const local = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean) : [];
      for (let i = 0; i < local.length; i++) if (local[i] !== lines[i]) throw new Error(`${t.key}: the local log differs from the cloud at event ${i + 1}: nothing pulled`);
      if (lines.length > local.length) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, lines.slice(local.length).map((l) => `${l}\n`).join(''));
      }
      report[t.key] = { local: local.length, cloud: lines.length, appended: lines.length - local.length };
    }
    out(report);
    await pool.end();
  } else if (cmd === 'cutover' || cmd === 'rollback-cutover') {
    const file = opt('--config');
    const raw = readJson(file);
    if (cmd === 'cutover') raw.readOnly = { since: new Date().toISOString(), cloudUrl: opt('--url'), reason: 'the cloud dashboard is the source of truth: review there' };
    else delete raw.readOnly;
    fs.copyFileSync(file, `${file}.before-${cmd}-${Date.now()}`);
    fs.writeFileSync(file, JSON.stringify(raw, null, 1));
    out({ config: path.basename(file), readOnly: raw.readOnly ?? null, note: 'restart the local dashboard for this to take effect' });
  } else {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'));
    process.exit(cmd ? 1 : 0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
