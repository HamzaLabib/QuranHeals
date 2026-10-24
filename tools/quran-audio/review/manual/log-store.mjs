// The review logs on disk, shared by the manual-timing server (server.mjs) and the unified dashboard
// (review/dashboard/server.mjs). One append-only, hash-chained events.jsonl per recording; state is always rebuilt by
// replaying it (manual-lib.mjs), so nothing but the log is ever written.
//
// Two safeguards keep a review database single-writer:
//   - a lock file in each data folder: a second server (of either kind) refuses to start on a folder a live server
//     already holds, so there are never two writable copies of one active database;
//   - before every append the log's size on disk is compared with what this process last read or wrote; if anything
//     else changed it, the log is re-read and re-validated before the new event is checked against it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyEvent, eventHash, replay } from './manual-lib.mjs';

export const LOCK_FILE = '.review-server.lock';

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

/**
 * Takes the data folder for this process, or throws if a live process holds it. A lock left by a process that no
 * longer runs (a crash, a power cut) is taken over. Returns a function that releases it.
 */
export function lockDataDir(dir, { label = 'review server' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LOCK_FILE);
  const me = { pid: process.pid, host: os.hostname(), label, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(me), { flag: 'wx' });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try { if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid) fs.unlinkSync(file); } catch { /* already gone */ }
      };
      process.once('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* unreadable: treat as stale */ }
      if (held && held.pid !== process.pid && held.host === os.hostname() && alive(held.pid)) {
        throw new Error(`${dir} is in use by another ${held.label ?? 'review server'} (process ${held.pid}, since ${held.startedAt}). Stop it first: one review database must never have two writers.`);
      }
      fs.rmSync(file, { force: true }); // stale lock
    }
  }
  throw new Error(`could not lock ${dir}`);
}

/** Opens a log for appending; retries briefly while a sync client (OneDrive) holds the file. */
function openForAppend(file) {
  for (let attempt = 0; ; attempt++) {
    try { return fs.openSync(file, 'a'); } catch (error) {
      if (attempt >= 20 || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/**
 * Logs of many recordings. `locate(key)` returns { sessionFile, dataDir } (or null for an unknown key);
 * `readSession(key, file)` may decorate the session (the dashboard adds waveform data); it is read once per key.
 */
export function createLogStore({ locate, readSession = (key, file) => JSON.parse(fs.readFileSync(file, 'utf8')), now = () => new Date().toISOString() }) {
  const cache = new Map(); // key -> { session, events, state, file, size }
  const logFile = (key) => path.join(locate(key).dataDir, key, 'events.jsonl');
  const readLog = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const sizeOf = (file) => (fs.existsSync(file) ? fs.statSync(file).size : 0);

  function load(key) {
    if (!cache.has(key)) {
      const where = locate(key);
      if (!where) throw new Error(`unknown recording ${key}`);
      const session = readSession(key, where.sessionFile);
      const file = logFile(key);
      const events = readLog(file);
      cache.set(key, { session, events, state: replay(session, events), file, size: sizeOf(file) });
    }
    return cache.get(key);
  }
  /** Events only (no session decoration): for queue summaries, cheap when the recording has no log yet. */
  function hasLog(key) {
    const where = locate(key);
    return !!where && fs.existsSync(path.join(where.dataDir, key, 'events.jsonl'));
  }
  function append(key, input) {
    let rec = load(key);
    if (sizeOf(rec.file) !== rec.size) {
      // Written by something else since we read it: start again from the disk (replay re-checks the chain).
      cache.delete(key);
      rec = load(key);
    }
    const prev = rec.events.at(-1)?.hash ?? 'genesis';
    const ev = { seq: rec.events.length + 1, at: now(), reviewer: String(input.reviewer ?? '').trim(), role: input.role ?? null, type: input.type, payload: input.payload ?? {}, prev };
    // Validate on a copy first: a refused event never reaches the log.
    const trial = structuredClone(rec.state);
    applyEvent(rec.session, trial, ev);
    ev.hash = eventHash(prev, ev);
    fs.mkdirSync(path.dirname(rec.file), { recursive: true });
    const fd = openForAppend(rec.file);
    try { fs.writeSync(fd, JSON.stringify(ev) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    rec.events.push(ev);
    rec.state = trial;
    rec.size = sizeOf(rec.file);
    return rec;
  }
  /** Forgets a cached recording (its session file was replaced by an import; its log is untouched). */
  const forget = (key) => cache.delete(key);
  return { load, append, hasLog, forget };
}
