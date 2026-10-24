// Local server for the manual ayah-timing review (Phase 4.6A). Binds to 127.0.0.1 only.
//
//   GET  /                      the review page (index.html)
//   GET  /api/queue             every prepared session, in queue order, with its status
//   GET  /api/session/<key>     the read-only session (text, waveform, Phase 4.5 evidence)
//   GET  /audio/<key>           the unmodified recording (local copy, HTTP Range for seeking)
//   GET  /api/view/<key>?name=  what this person may see (blind until both reviewers have submitted)
//   POST /api/event/<key>       {reviewer, role, type, payload}: validated, then appended to the log
//   GET  /api/export/<key>?name= the review record (manual-ayah-timing-review); before both submissions only the
//                               caller's own work is included
//
// Every change is an event appended to <data>/<key>/events.jsonl (hash-chained, fsynced) and the state is rebuilt by
// replaying the log, so progress survives a crash or restart and every change stays auditable. Sessions, audio and
// data live outside the repository; the Phase 4.5 evidence inside a session is never written to. The logs are kept by
// log-store.mjs, shared with the unified dashboard (review/dashboard): while this server runs its data folder is
// locked, so the two can never write one review database at the same time.
//
// usage: node review/manual/server.mjs --sessions <dir> --audio <dir> --data <dir> [--port 8765]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildExport } from './export.mjs';
import { createLogStore, lockDataDir } from './log-store.mjs';
import { emptyState, viewFor } from './manual-lib.mjs';
import { effectiveSession } from './opening.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createServer({ sessions, audio, data, now = () => new Date().toISOString() }) {
  fs.mkdirSync(data, { recursive: true });
  const keyOk = (k) => /^[a-z0-9-]+$/.test(k) && fs.existsSync(path.join(sessions, `${k}.json`));
  const { load, append } = createLogStore({ locate: (k) => (keyOk(k) ? { sessionFile: path.join(sessions, `${k}.json`), dataDir: data } : null), now });
  function queue() {
    const order = fs.existsSync(path.join(sessions, 'queue.json')) ? JSON.parse(fs.readFileSync(path.join(sessions, 'queue.json'), 'utf8')) : { items: [] };
    const keys = fs.readdirSync(sessions).filter((f) => f.endsWith('.json') && f !== 'queue.json').map((f) => f.slice(0, -5));
    const rank = (k) => { const i = order.items.findIndex((x) => x.key === k); return i < 0 ? 1e9 : i; };
    return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((k) => {
      const { session, state } = load(k);
      const v = viewFor(session, state, '');
      const meta = order.items.find((x) => x.key === k) ?? {};
      return { key: k, surah: session.surah, surahEn: session.surahEn, surahAr: session.surahAr, ayahCount: session.ayahCount, durationMs: session.durationMs, synthetic: session.synthetic === true,
        group: meta.group ?? null, note: meta.note ?? null, status: v.status.status, reviewers: Object.values(v.reviewers).map((r) => ({ role: r.role, name: r.name, submitted: !!r.submittedAt })) };
    });
  }
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, fs.readFileSync(path.join(here, 'index.html')), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/queue') return send(res, 200, queue());
      const key = parts[2] ?? parts[1];
      if (parts[0] === 'api' && parts[1] === 'session' && keyOk(parts[2])) return send(res, 200, effectiveSession(load(parts[2]).session)); // Phase 4.8.8: the page shows ayah 1 at 0:00.000
      if (parts[0] === 'audio' && keyOk(parts[1])) {
        const file = path.join(audio, load(parts[1]).session.audioFile);
        const size = fs.statSync(file).size;
        const type = file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
        if (m) {
          const start = m[1] ? Number(m[1]) : size - Number(m[2]);
          const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
          return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
        return fs.createReadStream(file).pipe(res);
      }
      if (parts[0] === 'api' && parts[1] === 'view' && keyOk(key)) {
        const { session, state } = load(key);
        return send(res, 200, viewFor(session, state, url.searchParams.get('name') ?? ''));
      }
      if (parts[0] === 'api' && parts[1] === 'event' && keyOk(key) && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const input = JSON.parse(body);
        try {
          const { session, state } = append(key, input);
          return send(res, 200, viewFor(session, state, input.reviewer));
        } catch (error) {
          return send(res, 409, { error: error.message });
        }
      }
      if (parts[0] === 'api' && parts[1] === 'export' && keyOk(key)) {
        const { session, state, events } = load(key);
        const name = url.searchParams.get('name') ?? '';
        const both = state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt;
        // Blind until both have submitted: an early export holds only the caller's own work.
        const visible = both ? state : { ...emptyState(), reviewers: Object.fromEntries(Object.entries(state.reviewers).filter(([, r]) => r.name.trim().toLowerCase() === name.trim().toLowerCase())) };
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  const [sessions, audio, data] = [opt('--sessions'), opt('--audio'), opt('--data')];
  if (!sessions || !audio || !data) throw new Error('usage: node review/manual/server.mjs --sessions <dir> --audio <dir> --data <dir> [--port 8765]');
  const port = Number(opt('--port') ?? 8765);
  try { lockDataDir(data, { label: 'manual timing server' }); } catch (error) { console.error(`\n  NOT STARTED: ${error.message}\n`); process.exit(1); }
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => process.exit(0));
  createServer({ sessions, audio, data }).listen(port, '127.0.0.1', () => console.log(`manual timing review: http://127.0.0.1:${port}/  (data: ${path.resolve(data)})`));
}
