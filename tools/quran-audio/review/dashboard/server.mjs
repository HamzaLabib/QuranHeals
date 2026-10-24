// The unified audio review dashboard (Phase 4.8): one local web page for every pending listening review of the
// project. Binds to 127.0.0.1 only. Built on the manual-timing tool (review/manual): the same blind two-reviewer rules,
// the same append-only hash-chained logs (log-store.mjs), the same review page and export.
//
//   GET  /                         the dashboard (dashboard.html): totals, filters, recordings, Needs Attention
//   GET  /review?rec=<key>         the review page (review/manual/index.html) for one recording
//   GET  /api/dashboard?name=      totals and one row per recording (statuses, progress, problems)
//   GET  /api/attention?name=&...  outstanding ayah starts, by risk (filters: tiers, reciter, type, phase, surah, todo)
//   GET  /api/inventory            the full inventory (tasks, blocked, superseded, import problems)
//   POST /api/refresh              re-discovers and re-validates every configured source (new packages appear)
//   POST /api/backup               snapshot of every review database now (backup.mjs)
//   GET  /api/queue, /api/session/<key>, /api/view/<key>, POST /api/event/<key>, GET /api/export/<key>, GET /audio/<key>
//                                  as review/manual/server.mjs, for every registered recording
//   POST /api/prepare/<key>        gets the recording ready: a validated local copy (or a download from its original URL
//                                  into the local cache, size and hash checked) and its waveform; GET returns progress
//
// Nothing here approves, activates or changes timing. Review data: the dashboard's data folder, and each manual-timing
// source's own data folder (the Rifaat database stays where it is). Every data folder is locked while the dashboard
// runs (a second dashboard or the manual server refuses to start on it). Backups: automatic snapshots on start, after
// milestones (submissions, amendments, resolutions) and every few minutes while reviews change.
//
// usage: node review/dashboard/server.mjs --config <dashboard.config.json> [--port 8765]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { buildExport } from '../manual/export.mjs';
import { createLogStore, lockDataDir } from '../manual/log-store.mjs';
import crypto from 'node:crypto';

import { emptyState, MARKER_STATUS, objectiveChecks, viewFor } from '../manual/manual-lib.mjs';
import { effectiveSession, OPENING_RULE } from '../manual/opening.mjs';
import { amendmentFile, classify as classifyStarts, effectiveAccepted, ledgerFile, openAmendments, openLedger, plan as planAutoAccept, planOpening, planWithdrawals, POLICY as AUTO_POLICY } from './auto-accept.mjs';
import { dataState, list as listBackups, prune, snapshot } from './backup.mjs';
import { importAll, providerOf, readConfig } from './dashboard-lib.mjs';
import { effectiveOverrides, openOverrides, overrideFile } from './owner-override.mjs';
import { makeViews } from './views.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/**
 * Phase 4.8.8: this installation's default reviewer (dashboard.config.json `localReviewer`: { name, role: 1 }). The page
 * starts as this reviewer when the browser has no choice of its own; only Reviewer 1 can be remembered, never 2.
 */
const localReviewer = (cfg) => { const r = cfg.raw.localReviewer; return r && String(r.name ?? '').trim() && r.role === 1 ? { name: String(r.name).trim(), role: 1 } : null; };

// autoAccept: Phase 4.8.7 automatic acceptance (auto-accept.mjs). The ledger is always READ (so its acceptances show
// whenever it exists); passes that WRITE to it run only when autoAccept is true (the command line turns it on).
export function createDashboard({ config, now = () => new Date().toISOString(), log = () => {}, autoBackup = true, port = 8765, autoAccept = false }) {
  const cfg = typeof config === 'string' ? readConfig(config) : config;
  for (const d of [cfg.dataDir, cfg.registryDir, cfg.cacheDir]) fs.mkdirSync(d, { recursive: true });
  const ledger = openLedger(ledgerFile(cfg.dataDir), { now });
  const amendments = openAmendments(amendmentFile(cfg.dataDir), { now });
  // Owner overrides (owner-override.mjs): read only here; written by its own command after a backup.
  const overrides = openOverrides(overrideFile(cfg.dataDir), { now });
  let inv = null;
  let tasks = new Map();
  const store = createLogStore({ locate: (k) => { const t = tasks.get(k); return t ? { sessionFile: t.sessionFile, dataDir: t.dataDir } : null; }, now });
  const logFile = (t) => path.join(t.dataDir, t.key, 'events.jsonl');
  const hasLog = (t) => fs.existsSync(logFile(t));

  function refresh() {
    const before = new Set(tasks.keys());
    inv = importAll(cfg, { now, hasLog: (key, dir) => fs.existsSync(path.join(dir, key, 'events.jsonl')), log });
    tasks = new Map(inv.tasks.map((t) => [t.key, t]));
    for (const k of new Set([...before, ...tasks.keys()])) store.forget(k);
    // A review log whose recording is no longer registered is kept (never deleted) and reported.
    const dataDirs = new Set([cfg.dataDir, ...cfg.sources.filter((s) => s.data).map((s) => s.data)]);
    for (const d of dataDirs) {
      if (!fs.existsSync(d)) continue;
      for (const k of fs.readdirSync(d)) if (fs.existsSync(path.join(d, k, 'events.jsonl')) && !tasks.has(k)) inv.problems.push({ source: d, key: k, problem: `review log for ${k} exists but the recording is no longer registered (kept untouched)` });
    }
    inv.totals.problems = inv.problems.length;
    return { added: [...tasks.keys()].filter((k) => !before.has(k)), removed: [...before].filter((k) => !tasks.has(k)), problems: inv.problems, totals: inv.totals, createdAt: inv.createdAt };
  }
  refresh();

  // ---------------------------------------------------------------- audio and waveform
  const jobs = new Map(); // key -> { state, done, total, error }
  const waveCache = new Map();
  const isVbr = (t) => t.format?.mode === 'vbr';
  const cached = (t) => path.join(cfg.cacheDir, 'audio', `${t.key}.mp3`);
  const waveFile = (t) => path.join(cfg.cacheDir, 'peaks', `${t.key}.json`);
  const pcmFile = (t) => path.join(cfg.cacheDir, 'pcm', `${t.key}.wav`);
  function audioPath(t) {
    for (const f of [t.audioFile, cached(t)]) if (f && fs.existsSync(f) && fs.statSync(f).size === t.bytes) return f;
    return null;
  }
  function wave(t) {
    if (t.sourceKind === 'manual-sessions') return 'embedded';
    const f = waveFile(t);
    if (!fs.existsSync(f)) return null;
    const mt = fs.statSync(f).mtimeMs;
    if (waveCache.get(t.key)?.mt !== mt) waveCache.set(t.key, { mt, w: readJson(f) });
    const { w } = waveCache.get(t.key);
    if (w.bytes !== t.bytes || (t.sha256 && w.sha256 !== t.sha256)) return null;
    if (isVbr(t) && !fs.existsSync(pcmFile(t))) return null;
    return w;
  }
  async function download(t, job) {
    // A per-ayah recording's URL is its folder: its review copy is made locally (per-ayah/make-review-packages.mjs).
    if (t.perAyah) throw new Error(t.audioProblem ?? 'the per-ayah review copy is missing: re-run per-ayah/make-review-packages.mjs');
    if (!providerOf(t.url)) throw new Error(`${t.url}: not an https URL of a known provider`);
    const res = await fetch(t.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${t.url}: HTTP ${res.status}`);
    const part = `${cached(t)}.part`;
    fs.mkdirSync(path.dirname(part), { recursive: true });
    job.total = t.bytes; job.done = 0;
    const counter = new TransformStream({ transform(chunk, c) { job.done += chunk.byteLength; c.enqueue(chunk); } });
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part));
    const size = fs.statSync(part).size;
    if (size !== t.bytes) { fs.rmSync(part, { force: true }); throw new Error(`downloaded ${size} bytes, the package says ${t.bytes}: not the reviewed recording (the provider may have changed it, or returned an error page)`); }
    fs.renameSync(part, cached(t));
    fs.writeFileSync(`${cached(t)}.json`, JSON.stringify({ url: t.url, bytes: size, fetchedAt: now(), note: 'private local copy for listening review; never published' }));
    return cached(t);
  }
  function runPython(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(cfg.python, ['-I', '-X', 'utf8', path.join(here, 'peaks.py'), ...args], { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => reject(new Error(`could not run ${cfg.python}: ${e.message} (set "python" in the configuration to a Python 3.12)`)));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`waveform failed (${code}): ${err.trim().split('\n').at(-1)}`))));
    });
  }
  function prepare(key) {
    const t = tasks.get(key);
    if (jobs.get(key)?.state === 'working') return jobs.get(key);
    const job = { state: 'working', step: 'checking', done: 0, total: 0, error: null };
    jobs.set(key, job);
    (async () => {
      let file = audioPath(t);
      if (!file) { job.step = 'downloading from the original URL'; file = await download(t, job); }
      if (!wave(t)) {
        job.step = isVbr(t) ? 'drawing the waveform and decoding the VBR file for exact seeking' : 'drawing the waveform';
        fs.mkdirSync(path.dirname(waveFile(t)), { recursive: true });
        if (isVbr(t)) fs.mkdirSync(path.dirname(pcmFile(t)), { recursive: true });
        await runPython([file, waveFile(t), ...(isVbr(t) ? ['--pcm', pcmFile(t)] : [])]);
        const w = readJson(waveFile(t));
        if (w.bytes !== t.bytes) throw new Error(`the audio file is ${w.bytes} bytes, the package says ${t.bytes}`);
        if (t.sha256 && w.sha256 !== t.sha256) { fs.rmSync(waveFile(t)); throw new Error(`the audio file's SHA-256 ${w.sha256.slice(0, 12)}… is not the reviewed recording's ${t.sha256.slice(0, 12)}…`); }
      }
      job.state = 'ready'; job.step = 'ready';
    })().catch((e) => { job.state = 'error'; job.error = e.message; });
    return job;
  }
  // Phase 4.8.4: evidence for the objective identity check: the file served for review, hashed (cached by mtime).
  const shaCache = new Map();
  function audioEvidence(t) {
    if (t.sourceKind === 'manual-sessions') {
      const f = audioPath(t);
      if (!f) return { problem: 'no local copy of the recording of the reviewed size', network: false };
      const st = fs.statSync(f);
      if (shaCache.get(t.key)?.mt !== st.mtimeMs) shaCache.set(t.key, { mt: st.mtimeMs, sha: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') });
      return { bytes: st.size, sha256: shaCache.get(t.key).sha, how: 'the local copy, hashed by this server' };
    }
    const w = wave(t);
    if (!w || w === 'embedded') return null;
    return { bytes: w.bytes, sha256: w.sha256, how: 'hashed when its waveform was drawn from the served file' };
  }
  // Phase 4.8.7: the automatic acceptances that still apply to a recording (a later human rejection wins).
  const autoAccepted = (t, state) => (ledger.problem ? null : new Set(effectiveAccepted(store.load(t.key).session, state, ledger.forKey(t.key)).keys()));
  // Owner overrides that still apply: out of the queue, counted apart, never a review or an automatic acceptance.
  const ownerOverridden = (t, state) => (overrides.problem ? null : new Set(effectiveOverrides(store.load(t.key).session, state, overrides.forKey(t.key)).keys()));
  const withChecks = (t, session, state, events, name) => {
    const v = viewFor(session, state, name);
    const auto = [...(autoAccepted(t, state) ?? [])].filter((k) => !(v.review.reviewedKeys ?? []).includes(k));
    // The review page leaves these out of its Pending list and labels them; they are never a reviewer's submission.
    if (auto.length) v.review = { ...v.review, autoAcceptedKeys: auto, autoPolicy: AUTO_POLICY.id, pendingCount: Math.max(0, v.review.pendingCount - auto.length), complete: v.review.pendingCount - auto.length <= 0 };
    return { ...v, objective: objectiveChecks(session, state, events, name, audioEvidence(t)) };
  };
  const prepState = (t) => (audioPath(t) && wave(t) ? { state: 'ready' } : jobs.get(t.key) ?? { state: 'not-prepared', step: audioPath(t) ? 'the waveform has not been drawn yet' : 'no local copy yet: it will be downloaded from the original URL' });

  // ---------------------------------------------------------------- statuses (views.mjs, shared with the cloud server)
  const { summarize, row, dashboard, attention } = makeViews({
    tasks: () => tasks, inventory: () => inv, load: (k) => store.load(k), hasLog, now, autoAccepted, ownerOverridden, milestone: (id) => ledger.milestone(id),
    // Phase 4.8.9: why a start the policy could otherwise accept is still open (shown in the queue).
    exceptionWhy: (t, state) => (ledger.problem ? null : new Map(classifyStarts(t, store.load(t.key).session, state, ledger.forKey(t.key)).filter((c) => !['human-reviewed', 'auto-accepted'].includes(c.decision)).map((c) => [c.ayah, c.decision === 'eligible' ? 'eligible: accepted at the next automatic pass' : c.why]))),
    audioInfo: (t) => ({ local: !!audioPath(t), how: t.audioHow ?? (t.audioFile ? 'local copy' : null), problem: audioPath(t) ? null : t.audioProblem, vbr: isVbr(t) }),
  });

  // ---------------------------------------------------------------- backups
  const stateFile = path.join(cfg.cacheDir, 'backup-state.json');
  let backupTimer = null;
  let lastBackup = fs.existsSync(stateFile) ? readJson(stateFile) : null;
  function backupNow(label = 'auto') {
    const st = dataState(cfg);
    if (label === 'auto' && lastBackup?.state === st) return { skipped: 'nothing changed since the last snapshot', last: lastBackup };
    const r = snapshot(cfg, { label });
    lastBackup = { state: st, dir: r.dir, at: now(), files: r.files, chainProblems: r.chainProblems };
    fs.writeFileSync(stateFile, JSON.stringify(lastBackup));
    prune(cfg, cfg.keepBackups);
    log(`backup ${r.dir} (${r.files} files)`);
    return lastBackup;
  }
  const milestone = () => { clearTimeout(backupTimer); backupTimer = setTimeout(() => { try { backupNow(); } catch (e) { log(`BACKUP FAILED: ${e.message}`); } }, 3000); };
  let interval = null;
  if (autoBackup) {
    try { backupNow(); } catch (e) { log(`BACKUP FAILED: ${e.message}`); }
    interval = setInterval(() => { try { backupNow(); } catch (e) { log(`BACKUP FAILED: ${e.message}`); } }, cfg.backupEveryMinutes * 60000);
    interval.unref();
  }

  // ---------------------------------------------------------------- Phase 4.8.7: automatic acceptance
  // One pass over every registered recording: eligible check/routine starts are appended to the ledger (after a
  // backup), and reciters that became (or stopped being) complete get a milestone. Runs on start, after every
  // refresh (so new review batches are covered) and a few seconds after review events. Safe to rerun.
  let lastAuto = null;
  let lastOpening = null;
  function autoPass(reason) {
    if (!autoAccept || cfg.raw.readOnly) return null;
    if (ledger.problem) { log(`AUTOMATIC ACCEPTANCE DISABLED: ${ledger.problem}`); return { error: ledger.problem }; }
    if (amendments.problem) { log(`OPENING AMENDMENTS DISABLED: ${amendments.problem}`); return { error: amendments.problem }; }
    const run = now();
    // Phase 4.8.8: first record every first timestamp above 0 the opening rule overrides (append-only amendments),
    // then the acceptances (the opening start is accepted at 0 as a check).
    const op = planOpening({ tasks: [...tasks.values()], load: (k) => store.load(k), ledger, amendments, run });
    const p = planAutoAccept({ tasks: [...tasks.values()], load: (k) => store.load(k), ledger, run, blocked: inv.blocked, unavailable: (t) => row(t, '').unavailable });
    let backup = null;
    // Phase 4.8.10: acceptances that no longer apply get an explicit withdrawal record (the acceptance stays).
    const wd = planWithdrawals({ tasks: [...tasks.values()], load: (k) => store.load(k), ledger, run });
    if (p.accept.length || op.amend.length || wd.length) backup = backupNow(op.amend.length ? 'pre-opening-rule' : 'pre-auto-accept').dir; // throws (nothing written) if the backup fails
    const amended = amendments.append(op.amend);
    if (amended.length) log(`opening rule (${reason}): ${amended.length} recording(s) amended to play ayah 1 from 0:00.000${backup ? ` (backup ${backup})` : ''}`);
    lastOpening = { run, reason, applied: op.applied, unchanged: op.unchanged, amended: amended.length, excluded: op.excluded.length };
    const withdrawn = ledger.append(wd);
    if (withdrawn.length) log(`automatic acceptance (${reason}): ${withdrawn.length} earlier acceptance(s) withdrawn (recorded, not deleted)`);
    const written = ledger.append([...p.accept, ...p.milestones]);
    if (written.length) log(`automatic acceptance (${reason}): ${p.accept.length} starts accepted, ${p.milestones.length} reciter milestones${backup ? ` (backup ${backup})` : ''}`);
    lastAuto = { run, reason, accepted: p.accept.length, withdrawn: withdrawn.length, milestones: p.milestones.map((m) => `${m.reciterId}: ${m.type}`), backup, policy: AUTO_POLICY };
    return lastAuto;
  }
  let autoTimer = null;
  const autoSoon = () => { if (!autoAccept) return; clearTimeout(autoTimer); autoTimer = setTimeout(() => { try { autoPass('after review activity'); } catch (e) { log(`AUTOMATIC ACCEPTANCE FAILED: ${e.message}`); } }, 5000); };
  try { autoPass('start'); } catch (e) { log(`AUTOMATIC ACCEPTANCE FAILED: ${e.message}`); }

  // ---------------------------------------------------------------- HTTP
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const sendFile = (req, res, file, type) => {
    const size = fs.statSync(file).size;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (m) {
      const start = m[1] ? Number(m[1]) : size - Number(m[2]);
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    return fs.createReadStream(file).pipe(res);
  };
  // Only this page may use the API: refuse other hosts (DNS rebinding) and cross-site requests.
  const local = (req) => {
    const host = String(req.headers.host ?? '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
    const origin = req.headers.origin;
    return !origin || origin === `http://${host}`;
  };
  // Phase 4.8.8: the page is served the EFFECTIVE opening (opening.mjs effectiveSession); the stored session is unchanged.
  const sessionFor = (t) => {
    const session = effectiveSession(store.load(t.key).session);
    const w = wave(t);
    const extra = {
      dashboard: {
        key: t.key, reviewType: t.reviewType, phase: t.phase, sourceId: t.sourceId, priority: t.priority, concerns: t.concerns, group: t.group, note: t.note, risk: t.risk,
        provenance: t.provenance, rights: t.rights, activeInDevelopment: t.activeInDevelopment, playbackBlocked: t.playbackBlocked,
        audio: { prepared: prepState(t), vbr: isVbr(t), how: t.audioHow ?? null, url: t.url, provider: t.provider, pcm: isVbr(t) && !!w },
        reciterEn: t.reciterEn, reciterAr: t.reciterAr,
      },
    };
    if (w === 'embedded') return { ...session, ...extra, reciterEn: t.reciterEn, reciterAr: t.reciterAr };
    if (!w) return { ...session, ...extra, waveformPending: true };
    const drift = Math.abs(w.durationMs - session.durationMs);
    if (drift > 50) extra.dashboard.timelineWarning = `the decoded audio is ${w.durationMs} ms, the package says ${session.durationMs} ms (${drift} ms apart)`;
    return { ...session, ...extra, peaks: w.peaks, quiet: w.quiet, quietRule: w.quietRule };
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (!local(req)) return send(res, 403, { error: 'this dashboard only answers its own page on 127.0.0.1' });
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const name = url.searchParams.get('name') ?? '';
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) return send(res, 200, fs.readFileSync(path.join(here, 'dashboard.html')), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/review') return send(res, 200, fs.readFileSync(path.join(here, '..', 'manual', 'index.html')), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/info') return send(res, 200, { mode: 'dashboard', readOnly: cfg.raw.readOnly ?? null, config: cfg.file, dataDir: cfg.dataDir, sourceDataDirs: cfg.sources.filter((s) => s.data).map((s) => s.data), backupDir: cfg.backupDir, lastBackup, inventoryCreatedAt: inv.createdAt, markerStatus: MARKER_STATUS, autoAccept: { enabled: autoAccept && !cfg.raw.readOnly, policy: AUTO_POLICY, ledger: ledger.file, entries: ledger.entries().length, problem: ledger.problem, last: lastAuto }, ownerOverride: { ledger: overrides.file, entries: overrides.entries().length, problem: overrides.problem },
        opening: { rule: OPENING_RULE, ledger: amendments.file, amendments: amendments.entries().length, problem: amendments.problem, last: lastOpening, totals: inv.totals.opening },
        localReviewer: localReviewer(cfg) });
      if (req.method === 'GET' && url.pathname === '/api/dashboard') return send(res, 200, dashboard(name));
      if (req.method === 'GET' && url.pathname === '/api/attention') return send(res, 200, attention(url.searchParams));
      if (req.method === 'GET' && url.pathname === '/api/inventory') return send(res, 200, inv);
      if (req.method === 'GET' && url.pathname === '/api/queue') {
        return send(res, 200, [...tasks.values()].map((t) => { const r = row(t, ''); return { key: t.key, surah: t.surah, surahEn: t.surahEn, surahAr: t.surahAr, ayahCount: t.ayahCount, durationMs: t.durationMs, synthetic: t.synthetic, group: t.group, note: t.note, status: r.status, reviewers: r.reviewers, reciterId: t.reciterId, reciterEn: t.reciterEn, reciterAr: t.reciterAr, reviewType: t.reviewType, priority: t.priority.label }; }));
      }
      if (req.method === 'POST' && url.pathname === '/api/refresh') {
        if (cfg.raw.readOnly) return send(res, 423, { error: `read-only since ${cfg.raw.readOnly.since}: ${cfg.raw.readOnly.reason}` });
        if (!/application\/json/.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'JSON only' });
        const r = refresh();
        return send(res, 200, { ...r, autoAccept: autoPass('refresh') });
      }
      if (req.method === 'POST' && url.pathname === '/api/backup') {
        if (!/application\/json/.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'JSON only' });
        return send(res, 200, backupNow('manual'));
      }
      const key = parts[2] ?? parts[1];
      const t = key && tasks.get(key);
      if (parts[0] === 'api' && parts[1] === 'prepare' && t) return send(res, 200, req.method === 'POST' ? prepare(key) : prepState(t));
      if (parts[0] === 'api' && parts[1] === 'session' && t) return send(res, 200, sessionFor(t));
      if (parts[0] === 'audio' && t) {
        if (isVbr(t) && wave(t) && fs.existsSync(pcmFile(t))) return sendFile(req, res, pcmFile(t), 'audio/wav');
        const f = audioPath(t);
        if (!f) return send(res, 404, { error: `no local copy of ${t.url} yet: prepare the recording first` });
        return sendFile(req, res, f, f.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
      }
      if (parts[0] === 'api' && parts[1] === 'view' && t) {
        if (!hasLog(t)) return send(res, 200, withChecks(t, store.load(key).session, emptyState(), [], name));
        const { session, state, events } = store.load(key);
        return send(res, 200, withChecks(t, session, state, events, name));
      }
      // Phase 4.8.2: after the cutover to the cloud dashboard, this one accepts no change (one source of truth).
      if (cfg.raw.readOnly && req.method === 'POST' && (parts[1] === 'event' || url.pathname === '/api/refresh')) return send(res, 423, { error: `read-only since ${cfg.raw.readOnly.since}: ${cfg.raw.readOnly.reason} (${cfg.raw.readOnly.cloudUrl ?? 'the cloud dashboard'})` });
      if (parts[0] === 'api' && parts[1] === 'event' && t && req.method === 'POST') {
        if (!/application\/json/.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'JSON only' });
        let body = '';
        for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        try {
          const { session, state, events } = store.append(key, input);
          if (['submit', 'amend', 'resolve-accept', 'resolve-unresolvable'].includes(input.type)) milestone();
          autoSoon();
          return send(res, 200, withChecks(t, session, state, events, input.reviewer));
        } catch (error) {
          return send(res, 409, { error: error.message });
        }
      }
      if (parts[0] === 'api' && parts[1] === 'export' && t) {
        const { session, state, events } = store.load(key);
        const both = state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt;
        const visible = both ? state : { ...emptyState(), reviewers: Object.fromEntries(Object.entries(state.reviewers).filter(([, r]) => sameName(r.name, name))) };
        const record = buildExport(session, visible, both ? events : [], { exportedAt: now() });
        if (!both) record.partial = 'exported before both reviewers submitted: only your own work is included, and the status is not final';
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${key}-review.json"` });
        return res.end(JSON.stringify(record, null, 1));
      }
      send(res, 404, { error: 'not found' });
    } catch (error) {
      send(res, 500, { error: error.message });
    }
  });
  server.on('close', () => { clearInterval(interval); clearTimeout(backupTimer); clearTimeout(autoTimer); });
  return { server, refresh, inventory: () => inv, backupNow, autoPass, ledger, amendments, cfg, port };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  const file = opt('--config');
  if (!file) throw new Error('usage: node review/dashboard/server.mjs --config <dashboard.config.json> [--port 8765]');
  const port = Number(opt('--port') ?? 8765);
  const cfg = readConfig(file);
  // One writer per review database: lock the dashboard's data folder and every manual source's data folder.
  try {
    for (const d of [cfg.dataDir, ...cfg.sources.filter((s) => s.kind === 'manual-sessions' && s.data).map((s) => s.data)]) lockDataDir(d, { label: 'audio review dashboard' });
  } catch (error) {
    console.error(`\n  NOT STARTED: ${error.message}\n`);
    process.exit(1);
  }
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => process.exit(0));
  const log = (m) => console.log(`${new Date().toLocaleTimeString()}  ${m}`);
  log('discovering and validating review packages…');
  const d = createDashboard({ config: cfg, log, port, autoAccept: !a.includes('--no-auto-accept') });
  const t = d.inventory().totals;
  d.server.listen(port, '127.0.0.1', () => {
    log(`${t.recordings} recordings to review (${t.ayahStarts} ayah starts; ${t.high} high risk), ${t.blocked} blocked, ${t.superseded} superseded, ${t.problems} import problems`);
    const b = listBackups(cfg).at(-1);
    log(`latest backup: ${b ? b.dir : 'none'}`);
    console.log(`\n  Quran Heals audio review dashboard:  http://127.0.0.1:${port}/\n  (this computer only; stop with Ctrl+C - every change is already saved)\n`);
  });
}
