// The cloud audio review dashboard (Phase 4.8.2): the local dashboard (review/dashboard + review/manual: the same
// pages, the same review rules, the same views) served privately on the internet, with:
//   - Google Sign-In accounts (auth.mjs): every page and API needs a signed-in, active account; the reviewer name in
//     every event comes from that account, never from the browser;
//   - PostgreSQL storage (db.mjs, pg-store.mjs): append-only, hash-chained review logs, atomic appends;
//   - audio from the original providers (audio.mjs); nothing is mirrored;
//   - administrator functions: accounts, identity links, validated imports, read-only switch, backups (CLI token only);
//   - Phase 4.8.3: the verified audio registry (registry.mjs) and its publication worker (publisher.mjs), with a public,
//     read-only API for the app (/v1/audio-timing/...: only published timing, nothing about reviewers or accounts).
// Security: Host and Origin checks, JSON-only writes (CSRF), SameSite cookies, per-IP and per-account rate limits,
// request-size limits, a nonce Content-Security-Policy, HSTS, no file is ever served by a request path.
//
// usage (Render runs it from the Dockerfile): node review/cloud/server.mjs
//   env: DATABASE_URL, PUBLIC_URL (https://<service>.onrender.com), GOOGLE_CLIENT_ID, ADMIN_TOKEN_SHA256,
//        BOOTSTRAP_ADMIN_EMAIL (+ BOOTSTRAP_ADMIN_NAME) for the first administrator, PORT, SCRATCH_DIR, SCRATCH_LIMIT_MB
//        (VBR decode cache, default 1000), PYTHON,
//        PUBLICATION_MODE (off | enabled; default off), PUBLICATION_ENVIRONMENTS (default development,production).
//   local trial only: node review/cloud/server.mjs --local-test --database-url postgres://...@127.0.0.1/... (test
//   sign-in: refuses to start on Render or on any address but 127.0.0.1)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeViews } from '../dashboard/views.mjs';
import { buildExport } from '../manual/export.mjs';
import { emptyState, MARKER_STATUS, objectiveChecks, viewFor } from '../manual/manual-lib.mjs';
import { effectiveSession } from '../manual/opening.mjs';
import { createCloudAudio } from './audio.mjs';
import { adminTokenOk, createAccount, createAuth, legacyNames, linkLegacyIdentity, setActive, setRoles } from './auth.mjs';
import { exportBackup } from './backup.mjs';
import { createPool, migrate } from './db.mjs';
import { importBundle } from './import.mjs';
import { createPgStore } from './pg-store.mjs';
import { ENVIRONMENTS } from './publication-rules.mjs';
import { createPublisher } from './publisher.mjs';
import { addAuthorization, addSeekVerification, listSeekVerifications, revokeSeekVerification, listAuthorizations, manifest as registryManifest, mismatches, registryOverview, releaseHold, revokeAuthorization, setActivation, versionDocument } from './registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGES = {
  dashboard: path.join(here, '..', 'dashboard', 'dashboard.html'),
  review: path.join(here, '..', 'manual', 'index.html'),
  login: path.join(here, 'login.html'),
  admin: path.join(here, 'admin.html'),
};
const KEY = /^[a-z0-9-]{1,80}$/;
const EVENT_TYPES = new Set(['join', 'draft', 'submit-ayahs', 'bulk', 'revise', 'submit', 'amend', 'resolve-propose', 'resolve-accept', 'resolve-unresolvable', 'comment']);
const PROVIDER_MEDIA = ['https://cdn.mp3quran.net', 'https://*.mp3quran.net', 'https://archive.org', 'https://*.archive.org', 'https://media.way2quran.com'];

/** A fixed-window rate limiter per key. */
function limiter(limit, windowMs) {
  const hits = new Map();
  return (key, t = Date.now()) => {
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) { hits.set(key, { start: t, n: 1 }); if (hits.size > 50000) hits.clear(); return true; }
    h.n++;
    return h.n <= limit;
  };
}

export async function createCloudServer({
  pool, publicUrl, googleClientId = null, adminTokenSha256 = null, cookieSecure = true, verifier = null, scratchDir, python = 'python3',
  fetchImpl = fetch, allowUrl, bootstrapAdmin = null, maxScratchBytes = 1e9, now = () => new Date().toISOString(), log = () => {}, limits = {},
  publication = {},
}) {
  const origin = new URL(publicUrl).origin;
  const host = new URL(publicUrl).host;
  await migrate(pool);
  if (bootstrapAdmin?.email) {
    const admins = await pool.query("select count(*)::int as n from accounts where 'admin' = any(roles)");
    if (!admins.rows[0].n) { await createAccount(pool, { email: bootstrapAdmin.email, displayName: bootstrapAdmin.name ?? 'Administrator', reviewerName: bootstrapAdmin.name ?? 'Administrator', roles: ['admin', 'reviewer'], by: 'bootstrap' }); log(`bootstrap administrator created for ${bootstrapAdmin.email}`); }
  }
  const store = createPgStore({ pool, now });
  await store.init();
  const auth = createAuth({ pool, googleClientId, cookieSecure, verifier });
  const audio = createCloudAudio({ pool, scratchDir, python, fetchImpl, maxScratchBytes, ...(allowUrl ? { allowUrl } : {}), now });
  // Phase 4.8.3: the publication worker. Off unless the service configuration enables it; synthetic data only in tests.
  const publisher = createPublisher({ pool, store, audio, mode: publication.mode ?? 'off', environments: publication.environments ?? ENVIRONMENTS, allowSynthetic: publication.allowSynthetic === true, ...(publication.appCapabilities ? { appCapabilities: publication.appCapabilities } : {}), intervalMs: publication.intervalMs, sweepMs: publication.sweepMs, autoStart: publication.autoStart !== false, log });
  if (publication.autoStart !== false) publisher.start();
  const views = makeViews({ tasks: store.tasks, inventory: store.inventory, load: (k) => store.load(k), hasLog: (t) => store.hasLog(t.key), audioInfo: (t) => audio.info(t), now });
  const settings = async (k) => (await pool.query('select value from settings where key = $1', [k])).rows[0]?.value ?? null;
  let readOnly = await settings('read-only');

  const perIp = limiter(limits.perIp ?? 600, 60000);
  const perLogin = limiter(limits.login ?? 20, 60000);
  const perAccount = limiter(limits.perAccount ?? 1200, 60000);
  const perWrite = limiter(limits.writes ?? 300, 60000);

  const security = (res, nonce = null, page = 'app') => {
    const csp = [
      "default-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "img-src 'self' data:",
      `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}${page === 'login' ? ' https://accounts.google.com/gsi/client' : ''}`,
      `style-src 'self' 'unsafe-inline'${page === 'login' ? ' https://accounts.google.com/gsi/style' : ''}`,
      `connect-src 'self'${page === 'login' ? ' https://accounts.google.com/gsi/' : ''}`,
      `frame-src ${page === 'login' ? 'https://accounts.google.com/gsi/' : "'none'"}`,
      `media-src 'self' ${PROVIDER_MEDIA.join(' ')}`, "font-src 'self'",
    ].join('; ');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Opener-Policy', page === 'login' ? 'same-origin-allow-popups' : 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  };
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    if (!res.hasHeader('Content-Security-Policy')) security(res);
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const page = (res, file, kind = 'app', extra = (h) => h) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    security(res, nonce, kind);
    const html = extra(fs.readFileSync(file, 'utf8')).replace(/<script(?=[\s>])(?![^>]*\bsrc=)/g, `<script nonce="${nonce}"`).replace(/<script src=/g, `<script nonce="${nonce}" src=`);
    send(res, 200, html, 'text/html; charset=utf-8');
  };
  async function body(req, max) {
    let n = 0;
    let over = false;
    const chunks = [];
    for await (const ch of req) {
      n += ch.length;
      if (n > max) {
        // Too large: the rest is read and discarded so the 413 reaches the client; an abusive body is cut off.
        over = true;
        chunks.length = 0;
        if (n > max + 16 * 1024 * 1024) { req.socket.destroy(); throw Object.assign(new Error('request too large'), { status: 413 }); }
        continue;
      }
      chunks.push(ch);
    }
    if (over) throw Object.assign(new Error(`request larger than ${max} bytes`), { status: 413 });
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
  }
  const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean).at(-1) ?? req.socket.remoteAddress;
  const sessionFor = async (t) => {
    // Phase 4.8.8: the same effective opening as the local dashboard (ayah 1 at 0:00.000, onset kept); stored session unchanged.
    const session = effectiveSession(store.load(t.key).session);
    const w = await audio.waveform(t);
    const ready = await audio.ready(t);
    const extra = {
      dashboard: {
        key: t.key, reviewType: t.reviewType, phase: t.phase, sourceId: t.sourceId, priority: t.priority, concerns: t.concerns, group: t.group, note: t.note, risk: t.risk,
        rights: t.rights, activeInDevelopment: t.activeInDevelopment, playbackBlocked: t.playbackBlocked,
        audio: { prepared: await audio.state(t), vbr: audio.info(t).vbr, how: audio.info(t).how, url: t.url, provider: t.provider, pcm: audio.policy(t) === 'decoded' && ready },
        reciterEn: t.reciterEn, reciterAr: t.reciterAr,
      },
    };
    if (!ready) return { ...session, peaks: w === 'embedded' ? session.peaks : null, ...extra, waveformPending: true };
    if (w === 'embedded') return { ...session, ...extra };
    const drift = Math.abs(w.durationMs - session.durationMs);
    if (drift > 50) extra.dashboard.timelineWarning = `the decoded audio is ${w.durationMs} ms, the package says ${session.durationMs} ms (${drift} ms apart)`;
    return { ...session, ...extra, peaks: w.peaks, quiet: w.quiet, quietRule: w.quietRule };
  };
  // Phase 4.8.4: evidence for the objective identity check (the provider's size check, the waveform's SHA-256).
  async function audioEvidence(t) {
    const s = audio.sourceStatus(t);
    if (s && !s.ok) return { problem: s.problem, network: /could not be reached|HTTP 5\d\d/.test(s.problem) };
    if (!s) return null;
    const w = await audio.waveform(t);
    if (w && w !== 'embedded') return { bytes: w.bytes, sha256: w.sha256, how: 'hashed when its waveform was drawn from the provider\'s file; size re-checked at the provider' };
    return { bytes: t.bytes, sha256: null, how: 'size checked at the provider' };
  }
  const withChecks = async (t, session, state, events, name) => ({ ...viewFor(session, state, name), objective: objectiveChecks(session, state, events, name, await audioEvidence(t)) });
  const sendRange = (req, res, file, type) => {
    const size = fs.statSync(file).size;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    security(res);
    if (m) {
      const start = m[1] ? Number(m[1]) : size - Number(m[2]);
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Cache-Control': 'private, no-store' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size, 'Cache-Control': 'private, no-store' });
    return fs.createReadStream(file).pipe(res);
  };

  async function handle(req, res) {
    const url = new URL(req.url, origin);
    const p = url.pathname;
    // The health check reveals nothing and is answered for any host (Render's checker may use an internal address).
    if (p === '/healthz' && req.method === 'GET') {
      try { await pool.query('select 1'); return send(res, 200, { ok: true }); } catch { return send(res, 503, { ok: false }); }
    }
    // Only this service's own host (DNS rebinding), only same-origin writes (CSRF), only JSON writes.
    if (req.headers.host !== host) return send(res, 421, { error: 'wrong host' });
    if (!perIp(clientIp(req))) return send(res, 429, { error: 'too many requests: wait a minute' });
    // ---- Phase 4.8.3: the app's read-only timing API (public: published timing only; no reviewer, account or log data)
    const pub = /^\/v1\/audio-timing\/(?:(development|production)\/manifest|versions\/(tv_[0-9a-f]{24}))$/.exec(p);
    if (pub && req.method === 'GET') {
      const doc = pub[1] ? await registryManifest(pool, pub[1]) : await versionDocument(pool, pub[2]);
      if (!doc) return send(res, 404, { error: 'not found' });
      const text = JSON.stringify(doc);
      const etag = `"${crypto.createHash('sha256').update(text).digest('hex').slice(0, 32)}"`;
      security(res);
      const headers = { 'Content-Type': 'application/json; charset=utf-8', ETag: etag, 'Cache-Control': pub[1] ? 'public, max-age=300' : 'public, max-age=31536000, immutable' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, headers);
      return res.end(text);
    }
    if (p.startsWith('/v1/')) return send(res, 404, { error: 'not found' });
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const bearer = /^Bearer\s/.test(req.headers.authorization ?? '');
    if (write && !bearer) {
      if (req.headers.origin !== origin) return send(res, 403, { error: 'cross-site request refused' });
      if (!/^application\/json(;|$)/.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'JSON only' });
    }

    // ---- public
    if (p === '/login' && req.method === 'GET') return page(res, PAGES.login, 'login', (h) => h.replace('__GOOGLE_CLIENT_ID__', String(googleClientId ?? '').replace(/[^A-Za-z0-9.\-_]/g, '')).replace('__TEST_LOGIN__', verifier ? 'true' : 'false'));
    if (p === '/auth/google' && req.method === 'POST') {
      if (!perLogin(clientIp(req))) return send(res, 429, { error: 'too many sign-in attempts: wait a minute' });
      const b = await body(req, 16384);
      const { token, account } = await auth.login(b.credential, req.headers['user-agent']);
      res.setHeader('Set-Cookie', auth.cookie(token));
      log(`sign-in ${account.email}`);
      return send(res, 200, { ok: true, account });
    }
    if (p === '/auth/logout' && req.method === 'POST') { await auth.logout(req); res.setHeader('Set-Cookie', auth.clearCookie()); return send(res, 200, { ok: true }); }

    // ---- administrator CLI (bearer token): imports and backups only
    if (bearer) {
      if (!adminTokenOk(req, adminTokenSha256)) return send(res, 401, { error: 'invalid administrator token' });
      if (p === '/api/admin/import' && req.method === 'POST') { const b = await body(req, 200 * 1024 * 1024); const r = await importBundle(pool, b.bundle, { by: 'admin-cli', dryRun: b.dryRun === true, kind: 'package-import' }); if (!r.dryRun) await store.init(); return send(res, 200, r); }
      if (p === '/api/admin/backup' && req.method === 'GET') { const b = await exportBackup(pool); await pool.query('insert into backups (kind, sha256, bytes, detail) values ($1,$2,$3,$4)', ['download', b.manifest.sha256, b.text.length, { counts: b.manifest.counts }]); return send(res, 200, b.text, 'application/x-ndjson'); }
      if (p === '/api/admin/status' && req.method === 'GET') return send(res, 200, await status());
      return send(res, 404, { error: 'not found' });
    }

    // ---- everything else: a signed-in, active account
    const account = await auth.accountOf(req);
    if (!account) {
      if (req.method === 'GET' && !p.startsWith('/api/') && !p.startsWith('/audio/')) { res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' }); return res.end(); }
      return send(res, 401, { error: 'sign in first' });
    }
    if (!perAccount(account.id)) return send(res, 429, { error: 'too many requests: wait a minute' });
    const admin = account.roles.includes('admin');
    const name = account.reviewerName;

    if (req.method === 'GET' && (p === '/' || p === '/dashboard')) return page(res, PAGES.dashboard);
    if (req.method === 'GET' && p === '/review') return page(res, PAGES.review);
    if (req.method === 'GET' && p === '/admin') return admin ? page(res, PAGES.admin) : send(res, 403, { error: 'administrators only' });
    if (req.method === 'GET' && p === '/api/info') return send(res, 200, { mode: 'cloud', account, readOnly, inventoryCreatedAt: store.inventory().createdAt, markerStatus: MARKER_STATUS });
    if (req.method === 'GET' && p === '/api/dashboard') return send(res, 200, views.dashboard(name));
    if (req.method === 'GET' && p === '/api/attention') { url.searchParams.set('name', name); return send(res, 200, views.attention(url.searchParams)); }
    if (req.method === 'GET' && p === '/api/inventory') { const i = store.inventory(); return send(res, 200, { ...i, tasks: undefined }); }
    if (req.method === 'GET' && p === '/api/queue') {
      return send(res, 200, [...store.tasks().values()].map((t) => { const r = views.row(t, ''); return { key: t.key, surah: t.surah, surahEn: t.surahEn, surahAr: t.surahAr, ayahCount: t.ayahCount, durationMs: t.durationMs, synthetic: t.synthetic, group: t.group, note: t.note, status: r.status, reviewers: r.reviewers, reciterId: t.reciterId, reciterEn: t.reciterEn, reciterAr: t.reciterAr, reviewType: t.reviewType, priority: t.priority.label }; }));
    }
    if (req.method === 'GET' && p === '/api/publication') return send(res, 200, await publicationView(admin));
    if (p.startsWith('/api/admin/')) {
      if (!admin) return send(res, 403, { error: 'administrators only' });
      if (p.startsWith('/api/admin/publication/') && req.method === 'POST') {
        const b = await body(req, 16384);
        const done = async (action, detail, r) => { await pool.query('insert into admin_log (by_account, action, detail) values ($1,$2,$3)', [account.id, action, detail]); return send(res, 200, r); };
        try {
          if (p === '/api/admin/publication/retry') { if (!store.tasks().has(b.key)) return send(res, 404, { error: 'no such recording' }); return done('publication-retry', { key: b.key }, await publisher.notify(b.key, 'administrator')); }
          if (p === '/api/admin/publication/requeue-all') return done('publication-requeue-all', {}, { queued: await publisher.enqueueAll('administrator') });
          if (p === '/api/admin/publication/rollback') {
            if (!String(b.reason ?? '').trim()) return send(res, 400, { error: 'a rollback or withdrawal needs a reason' });
            const r = await setActivation(pool, { recordingId: b.recordingId, versionId: b.versionId ?? null, environments: b.environments ?? ENVIRONMENTS, actor: account.id, reason: b.reason, hold: true, action: 'rolled-back' });
            return done('publication-rollback', b, r);
          }
          if (p === '/api/admin/publication/align') {
            if (!b.versionId) return send(res, 400, { error: 'choose the version both environments should play' });
            const latest = (await pool.query('select version_id from timing_versions where recording_id = $1 order by version_no desc limit 1', [b.recordingId])).rows[0]?.version_id;
            const r = await setActivation(pool, { recordingId: b.recordingId, versionId: b.versionId, environments: ENVIRONMENTS, actor: account.id, reason: b.reason ?? 'align the environments', hold: b.versionId !== latest, action: 'aligned' });
            return done('publication-align', b, r);
          }
          if (p === '/api/admin/publication/release') { const r = await releaseHold(pool, { recordingId: b.recordingId, actor: account.id }); await publisher.notify(r.reviewKey, 'hold released'); return done('publication-release', b, r); }
          if (p === '/api/admin/publication/authorizations') { const r = await addAuthorization(pool, { ...b, by: account.id }); await publisher.enqueueAll('authorization added'); return done('publication-authorize', b, r); }
          // Phase 4.8.5: a DEVICE measurement of one exact file's seek accuracy (never an automated playback).
          if (p === '/api/admin/publication/seek-verifications') { const r = await addSeekVerification(pool, { ...b, by: account.id }); await publisher.enqueueAll('seek verification recorded'); return done('publication-seek-verification', b, r); }
          if (p === '/api/admin/publication/seek-verifications/revoke') { const r = await revokeSeekVerification(pool, { id: b.id, by: account.id }); await publisher.enqueueAll('seek verification revoked'); return done('publication-seek-verification-revoke', b, r); }
          if (p === '/api/admin/publication/authorizations/revoke') { const r = await revokeAuthorization(pool, { id: b.id, by: account.id, reason: b.reason }); await publisher.enqueueAll('authorization revoked'); return done('publication-revoke', b, r); }
        } catch (error) {
          return send(res, 409, { error: error.message });
        }
        return send(res, 404, { error: 'not found' });
      }
      if (p === '/api/admin/status' && req.method === 'GET') return send(res, 200, await status());
      if (p === '/api/admin/accounts' && req.method === 'GET') return send(res, 200, (await pool.query('select id, email, display_name, reviewer_name, roles, active, created_at, (google_sub is not null) as signed_in_once from accounts order by created_at')).rows);
      if (p === '/api/admin/accounts' && req.method === 'POST') { const b = await body(req, 16384); return send(res, 200, await createAccount(pool, { ...b, by: account.id })); }
      const am = /^\/api\/admin\/accounts\/(acc_[A-Za-z0-9_-]{8,20})$/.exec(p);
      if (am && req.method === 'POST') {
        const b = await body(req, 16384);
        if (am[1] === account.id && (b.active === false || (b.roles && !b.roles.includes('admin')))) return send(res, 409, { error: 'you cannot remove your own administrator access' });
        let r = null;
        if (typeof b.active === 'boolean') r = await setActive(pool, { accountId: am[1], active: b.active, by: account.id });
        if (Array.isArray(b.roles)) r = await setRoles(pool, { accountId: am[1], roles: b.roles, by: account.id });
        return send(res, 200, r ?? { error: 'nothing to change' });
      }
      if (p === '/api/admin/legacy-names' && req.method === 'GET') return send(res, 200, { names: await legacyNames(pool), links: (await pool.query('select legacy_name, account_id, linked_by, linked_at, evidence from identity_links order by linked_at')).rows });
      if (p === '/api/admin/identity-links' && req.method === 'POST') { const b = await body(req, 16384); const r = await linkLegacyIdentity(pool, { legacyName: b.legacyName, accountId: b.accountId, confirmation: b.confirmation, by: account.id }); return send(res, 200, r); }
      if (p === '/api/admin/import' && req.method === 'POST') { const b = await body(req, 200 * 1024 * 1024); const r = await importBundle(pool, b.bundle, { by: account.id, dryRun: b.dryRun === true, kind: 'package-import' }); if (!r.dryRun) await store.init(); return send(res, 200, r); }
      if (p === '/api/admin/read-only' && req.method === 'POST') {
        const b = await body(req, 4096);
        readOnly = b.readOnly ? { since: now(), reason: String(b.reason ?? '').slice(0, 300), by: account.id } : null;
        await pool.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()', ['read-only', JSON.stringify(readOnly)]);
        await pool.query('insert into admin_log (by_account, action, detail) values ($1,$2,$3)', [account.id, 'read-only', { readOnly }]);
        return send(res, 200, { readOnly });
      }
      return send(res, 404, { error: 'not found' });
    }
    if (p === '/api/refresh' && req.method === 'POST') { if (!admin) return send(res, 403, { error: 'administrators only' }); await store.init(); return send(res, 200, { added: [], removed: [], problems: store.inventory().problems ?? [], totals: store.inventory().totals, reloaded: true }); }
    if (p === '/api/backup' && req.method === 'POST') return send(res, 403, { error: 'backups of the cloud database run on the server and through the administrator CLI (node review/cloud/migrate.mjs backup)' });

    const parts = p.split('/').filter(Boolean);
    const key = parts[0] === 'audio' ? parts[1] : parts[2];
    if (!KEY.test(key ?? '')) return send(res, 404, { error: 'not found' });
    const t = store.tasks().get(key);
    if (!t) return send(res, 404, { error: 'not found' });
    if (parts[0] === 'api' && parts[1] === 'prepare') return send(res, 200, req.method === 'POST' ? audio.prepare(t) : await audio.state(t));
    if (parts[0] === 'api' && parts[1] === 'session' && req.method === 'GET') return send(res, 200, await sessionFor(t));
    if (parts[0] === 'audio' && req.method === 'GET') {
      const pol = audio.policy(t);
      if (pol === 'unavailable') return send(res, 404, { error: 'this recording has no reachable source' });
      if (!(await audio.ready(t))) return send(res, 409, { error: 'prepare the recording first (its source is checked at the provider)' });
      if (pol === 'direct') { security(res); res.writeHead(302, { Location: t.url, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }); return res.end(); }
      return sendRange(req, res, audio.pcmFile(t), 'audio/wav');
    }
    if (parts[0] === 'api' && parts[1] === 'view' && req.method === 'GET') {
      const { session, state, events } = store.hasLog(key) ? store.load(key) : { session: store.load(key).session, state: emptyState(), events: [] };
      return send(res, 200, await withChecks(t, session, state, events, name));
    }
    if (parts[0] === 'api' && parts[1] === 'event' && req.method === 'POST') {
      if (readOnly) return send(res, 423, { error: `the dashboard is read-only (${readOnly.reason || 'maintenance'}): nothing can be saved now` });
      if (!perWrite(account.id)) return send(res, 429, { error: 'too many changes in a minute: wait a moment' });
      const b = await body(req, 2 * 1024 * 1024);
      if (!EVENT_TYPES.has(b.type)) return send(res, 400, { error: `unknown event ${b.type}` });
      // The reviewer is the signed-in account, whatever the browser sends.
      try {
        const { session, state, events } = await store.append(key, { reviewer: name, role: b.role ?? null, type: b.type, payload: b.payload ?? {} }, { accountId: account.id });
        void publisher.notify(key).catch((e) => log(`publisher: ${e.message}`)); // Phase 4.8.3: re-evaluated for publication
        return send(res, 200, await withChecks(t, session, state, events, name));
      } catch (error) {
        return send(res, 409, { error: error.message });
      }
    }
    if (parts[0] === 'api' && parts[1] === 'export' && req.method === 'GET') {
      const { session, state, events } = store.hasLog(key) ? store.load(key) : { session: store.load(key).session, state: emptyState(), events: [] };
      const both = state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt;
      const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
      const visible = both ? state : { ...emptyState(), reviewers: Object.fromEntries(Object.entries(state.reviewers).filter(([, r]) => sameName(r.name, name))) };
      const raw = session.proposal ? await store.packageRaw(key) : null;
      const record = buildExport(session, visible, both ? events : [], { exportedAt: now(), readPackage: () => { if (raw == null) throw new Error('no package'); return raw; } });
      if (!both) record.partial = 'exported before both reviewers submitted: only your own work is included, and the status is not final';
      security(res);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${key}-review.json"`, 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(record, null, 1));
    }
    return send(res, 404, { error: 'not found' });
  }

  /** Phase 4.8.3: the publication status of every reviewed recording (what the dashboard's Publication tab shows). */
  async function publicationView(admin) {
    const jobs = new Map((await publisher.jobs()).map((j) => [j.review_key, j]));
    const regs = await registryOverview(pool);
    const rows = [];
    for (const [key, t] of store.tasks()) {
      const job = jobs.get(key);
      const reg = regs.filter((r) => r.reviewKey === key);
      if (!job && !reg.length && !store.hasLog(key)) continue;
      const envs = new Set(reg.flatMap((r) => ENVIRONMENTS.filter((e) => r.active[e]?.versionId)));
      const published = envs.size === ENVIRONMENTS.length ? 'published-both' : envs.has('development') ? 'published-development' : envs.has('production') ? 'published-production' : null;
      const stage = job?.state === 'failed' ? 'publication-failed' : published ?? job?.evaluation?.stage ?? 'human-review-pending';
      rows.push({ key, reciterId: t.reciterId, reciterEn: t.reciterEn, surah: t.surah, surahEn: t.surahEn, provider: t.provider, url: t.url, bytes: t.bytes, stage, published,
        job: job ? { state: job.state, attempts: job.attempts, nextRunAt: job.next_run_at, lastError: job.last_error, updatedAt: job.updated_at } : null,
        evaluation: job?.evaluation ?? null,
        registry: reg.map((r) => ({ recordingId: r.recordingId, identity: r.identity, active: r.active, versions: r.versions, hold: r.hold, log: admin ? r.log : r.log.map((l) => ({ at: l.at, action: l.action, environment: l.environment, versionId: l.version_id })) })) });
    }
    return { mode: publisher.mode, environments: publisher.environments, appCapabilities: publisher.appCapabilities, seekVerifications: await listSeekVerifications(pool), admin, rows, mismatches: await mismatches(pool), authorizations: await listAuthorizations(pool), unreviewed: store.tasks().size - rows.length };
  }

  async function status() {
    const q = async (sql) => (await pool.query(sql)).rows[0];
    const jobStates = Object.fromEntries((await pool.query('select state, count(*)::int n from publication_jobs group by state')).rows.map((x) => [x.state, x.n]));
    return {
      publication: { mode: publisher.mode, environments: publisher.environments, jobs: jobStates, mismatches: (await mismatches(pool)).length, lastFailure: (await q("select review_key, last_error, updated_at from publication_jobs where state = 'failed' order by updated_at desc limit 1")) ?? null },
      recordings: store.tasks().size, events: (await q('select count(*)::int as n from review_events')).n, accounts: (await q('select count(*)::int as n from accounts where active')).n,
      waveforms: (await q('select count(*)::int as n from waveforms')).n, lastImport: (await q('select at, kind, summary from imports order by id desc limit 1')) ?? null,
      lastBackup: (await q('select at, kind, sha256 from backups order by id desc limit 1')) ?? null, readOnly,
    };
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      const code = error.status ?? 500;
      if (code >= 500) log(`error ${req.method} ${req.url}: ${error.stack ?? error.message}`);
      // An unread request body (refused as too large) must not be parsed as the next request: close the connection.
      if (code === 413 && !res.headersSent) res.setHeader('Connection', 'close');
      if (!res.headersSent) send(res, code, { error: code >= 500 ? 'internal error' : error.message, ...(error.problems ? { problems: error.problems } : {}) });
      else res.end();
    });
  });
  server.headersTimeout = 30000;
  server.requestTimeout = 120000;
  server.on('close', () => { void publisher.stop(); });
  return { server, store, pool, publisher };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  const localTest = a.includes('--local-test');
  const env = process.env;
  if (localTest && (env.RENDER || env.NODE_ENV === 'production')) throw new Error('--local-test is refused on Render and in production');
  const port = Number(opt('--port') ?? env.PORT ?? 10000);
  const publicUrl = localTest ? `http://127.0.0.1:${port}` : env.PUBLIC_URL;
  if (!publicUrl) throw new Error('PUBLIC_URL is not set (https://<service>.onrender.com)');
  if (!localTest && !publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must be https');
  if (!localTest && !env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set');
  const pool = createPool(opt('--database-url') ?? env.DATABASE_URL, { ssl: env.DATABASE_SSL === 'no-verify' ? 'no-verify' : env.DATABASE_SSL === 'off' || localTest ? false : undefined });
  const log = (m) => console.log(`${new Date().toISOString()}  ${m}`);
  const d = await createCloudServer({
    pool, publicUrl, googleClientId: env.GOOGLE_CLIENT_ID ?? null, adminTokenSha256: env.ADMIN_TOKEN_SHA256 ?? null, cookieSecure: !localTest,
    verifier: localTest ? async (credential) => { const m = /^test:([^@\s]+@[^@\s]+)$/.exec(String(credential)); if (!m) throw Object.assign(new Error('local test sign-in: use test:<email>'), { status: 401 }); return { sub: `test-${m[1]}`, email: m[1], emailVerified: true }; } : null,
    scratchDir: env.SCRATCH_DIR ?? path.join(here, '.scratch'), python: env.PYTHON ?? 'python3', maxScratchBytes: Number(env.SCRATCH_LIMIT_MB ?? 1000) * 1e6,
    bootstrapAdmin: env.BOOTSTRAP_ADMIN_EMAIL ? { email: env.BOOTSTRAP_ADMIN_EMAIL, name: env.BOOTSTRAP_ADMIN_NAME } : null, log,
    // Phase 4.8.3: automatic publication stays OFF until the owner sets PUBLICATION_MODE=enabled. Synthetic data is never published here.
    // APP_AUDIO_CAPABILITIES: which exact-seek methods the RELEASED app ships, per platform (JSON); default: CBR on both, no VBR.
    publication: { appCapabilities: env.APP_AUDIO_CAPABILITIES ? JSON.parse(env.APP_AUDIO_CAPABILITIES) : undefined, mode: env.PUBLICATION_MODE ?? 'off', environments: env.PUBLICATION_ENVIRONMENTS ? env.PUBLICATION_ENVIRONMENTS.split(',').map((x) => x.trim()).filter(Boolean) : undefined, allowSynthetic: false },
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { d.server.close(); pool.end().finally(() => process.exit(0)); });
  d.server.listen(port, localTest ? '127.0.0.1' : '0.0.0.0', () => log(`audio review dashboard on ${publicUrl} (${d.store.tasks().size} recordings)`));
}
