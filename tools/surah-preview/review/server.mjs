#!/usr/bin/env node
/**
 * The Surah Preview scholarly review dashboard: local only (127.0.0.1), for a qualified human reviewer.
 *
 *   node tools/surah-preview/review/server.mjs [--port 8772] [--data <dir>]   → http://127.0.0.1:8772
 *
 * Shows all 114 Surahs (data.mjs) and records each decision the reviewer makes in review/data/decisions.jsonl
 * (store.mjs: append-only, hash-chained, synced to disk). It changes nothing else: the app's data changes only when
 * someone runs review/apply.mjs --write and import.mjs afterwards.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REVIEW_DIR } from './apply.mjs';
import { loadRecords } from './data.mjs';
import { invalidDecision, openStore } from './store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const portArg = process.argv.indexOf('--port');
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) : 8772;
const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;

const { records, missing } = loadRecords();
// --data <dir>: another log (tests, rehearsals); the real one is review/data/.
const dataArg = process.argv.indexOf('--data');
const store = openStore(dataArg > 0 ? process.argv[dataArg + 1] : REVIEW_DIR);

function state() {
  let entries = [];
  let logError = null;
  try {
    entries = store.entries();
  } catch (error) {
    logError = error.message;
  }
  // `latest`: the decision in force per Surah (skips leave it as it was, as apply.mjs does); `history`: every entry.
  const latest = {};
  const history = {};
  for (const entry of entries) {
    if (entry.action !== 'skip') latest[entry.surah] = entry;
    (history[entry.surah] ??= []).push(entry);
  }
  // Decided = a decision in force, made on the topics as they are now.
  const decided = records.filter((r) => latest[r.surah] && latest[r.surah].reviewedSha === r.currentSha).length;
  return { records, latest, history, progress: { decided, total: records.length, decisions: entries.length }, missing, logError, logFile: store.file };
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};

const server = createServer((req, res) => {
  // Only this machine's dashboard: the Host must be ours (no DNS rebinding), and writes need the dashboard's own header.
  if (req.headers.host !== `${HOST}:${PORT}` && req.headers.host !== `localhost:${PORT}`) return send(res, 403, { error: 'Forbidden host.' });
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync(join(here, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state());
  if (req.method === 'POST' && url.pathname === '/api/decisions') {
    if (req.headers['x-review-client'] !== 'surah-preview-dashboard' || !String(req.headers['content-type']).startsWith('application/json')) {
      return send(res, 403, { error: 'Decisions are accepted from the dashboard only.' });
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      let decision;
      try {
        decision = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, { error: 'Not JSON.' });
      }
      const record = records[(decision?.surah ?? 0) - 1];
      if (!record) return send(res, 400, { error: 'Unknown Surah.' });
      const problem = invalidDecision(decision, record);
      if (problem) return send(res, 400, { error: problem });
      try {
        const entry = store.append(decision);
        return send(res, 200, { entry, progress: state().progress });
      } catch (error) {
        return send(res, 409, { error: error.message });
      }
    });
    return undefined;
  }
  return send(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  const s = state();
  console.log(`Surah Preview review dashboard: http://${HOST}:${PORT}  (${s.records.length} Surahs; ${s.progress.decided} decided; log ${s.logFile})`);
  if (missing.length) console.log(`Missing source caches (run import.mjs first): ${missing.join(', ')}`);
  if (s.logError) console.log(`WARNING: ${s.logError}`);
});
