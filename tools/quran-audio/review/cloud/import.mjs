// Validated import of review work into the cloud database (Phase 4.8.2): the migration from the local dashboard,
// and every later review package (administrator only). One function, one set of rules:
//   - every recording: a known reciter (or synthetic practice), the canonical ayah count, the Arabic text verbatim
//     from the app's runtime text, an https URL of a known provider, a consistent task row, and no local file path
//     anywhere; a package recording also brings its original package, whose SHA-256 and fingerprint must match;
//   - one task per recording (reciter, surah, URL, size): another key for the same recording is refused;
//   - a recording whose review has begun keeps its session (a changed package is reported, never applied);
//   - review events (migration only): every log's chain and replay are verified first; a log already in the database
//     must be an exact prefix of the imported one (the same lines, byte for byte), and only the missing events are
//     appended; anything else is a conflict and the whole import is refused. Event lines are stored exactly as written.
// Everything happens in one transaction: an import is applied completely or not at all.
import crypto from 'node:crypto';

import { packageProblems, providerOf, RECITER, textProblems, canon } from '../dashboard/dashboard-lib.mjs';
import { replay, verifyChain } from '../manual/manual-lib.mjs';
import { tx } from './db.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// A drive letter not preceded by a letter or digit (so the "s:" of "https://" is not one), a UNC path, a home folder.
export const LOCAL_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|\\Users\\/;
const KEY = /^[a-z0-9-]{1,80}$/;
const identity = (s) => `${s.reciterId}|${s.surah}|${s.url}|${s.bytes}`;

export const BUNDLE_KIND = 'audio-review-bundle';

/** Problems with one recording of a bundle (empty when valid). */
export function recordingProblems(r) {
  const p = [];
  if (!KEY.test(r?.key ?? '')) return [`key ${r?.key}: a-z, 0-9 and - only`];
  const s = r.session;
  const t = r.task;
  if (s?.kind !== 'manual-timing-session') return [`${r.key}: not a manual-timing-session`];
  if (!t || t.key !== r.key) p.push(`${r.key}: the task row is missing or names another key`);
  const synthetic = s.synthetic === true;
  if (!RECITER.has(s.reciterId) && !synthetic) p.push(`${r.key}: unknown reciter ${s.reciterId}`);
  const m = canon().meta.get(s.surah);
  if (!m || m.ayahs !== s.ayahCount || s.ayahs?.length !== s.ayahCount) p.push(`${r.key}: ayah count differs from the canonical count`);
  else p.push(...textProblems(s.surah, s.basmala, s.ayahs).map((x) => `${r.key}: ${x}`));
  if (!synthetic && !providerOf(s.url)) p.push(`${r.key}: ${s.url} is not an https URL of a known provider`);
  if (!(Number.isInteger(s.bytes) && s.bytes > 0) || !(s.durationMs > 0)) p.push(`${r.key}: size or duration missing`);
  if (t && (t.reciterId !== s.reciterId || t.surah !== s.surah || t.url !== s.url || t.bytes !== s.bytes)) p.push(`${r.key}: the task row is of another recording`);
  if (Array.isArray(s.scope) && s.scope.some((a) => !Number.isInteger(a) || a < 1 || a > s.ayahCount)) p.push(`${r.key}: scope outside the surah`);
  const text = JSON.stringify([s.provenance ?? null, s.audioFile ?? null, t]);
  if (LOCAL_PATH.test(text)) p.push(`${r.key}: a local file path is in the session or task (sanitise the bundle)`);
  if (s.proposal && s.provenance?.packageSha256 && s.reviewType !== 'production-boundary-check') {
    if (typeof r.packageRaw !== 'string') p.push(`${r.key}: the original package is missing`);
    else {
      if (sha(r.packageRaw) !== s.provenance.packageSha256) p.push(`${r.key}: the package is not the one the session was made from (SHA-256)`);
      let pkg = null;
      try { pkg = JSON.parse(r.packageRaw); } catch { p.push(`${r.key}: the package is not JSON`); }
      if (pkg) {
        p.push(...packageProblems(pkg).map((x) => `${r.key}: package: ${x}`));
        if (pkg.candidateFingerprint !== s.proposal.fingerprint) p.push(`${r.key}: the session's proposal is not the package's timing`);
        if (pkg.url !== s.url || pkg.bytes !== s.bytes || pkg.surah !== s.surah || pkg.reciterId !== s.reciterId) p.push(`${r.key}: the package is of another recording`);
      }
    }
  }
  return p;
}

/**
 * Imports a bundle: { kind, version, recordings: [{ key, session, task, packageRaw? }], waveforms?: [{ key, json }],
 * inventory?, events?: { <key>: [line, ...] } }. Options: allowEvents (migration only), dryRun (validate and report,
 * write nothing), by (who). Returns the report; throws (and writes nothing) on any refusal.
 */
export async function importBundle(pool, bundle, { allowEvents = false, dryRun = false, by, kind = 'import' } = {}) {
  if (bundle?.kind !== BUNDLE_KIND || bundle.version !== 1 || !Array.isArray(bundle.recordings)) throw Object.assign(new Error(`not an ${BUNDLE_KIND} (version 1)`), { status: 400 });
  if (bundle.events && !allowEvents) throw Object.assign(new Error('review events can only be imported by the migration (never by a package import)'), { status: 403 });
  const problems = [];
  const keys = new Set();
  const ids = new Map();
  for (const r of bundle.recordings) {
    problems.push(...recordingProblems(r));
    if (keys.has(r.key)) problems.push(`${r.key}: listed twice`);
    keys.add(r.key);
    if (r.session) { const id = identity(r.session); if (ids.has(id)) problems.push(`${r.key}: the same recording as ${ids.get(id)}`); ids.set(id, r.key); }
  }
  // Review logs: chain + replay against their session, before anything is written.
  const logs = new Map();
  for (const [key, lines] of Object.entries(bundle.events ?? {})) {
    const rec = bundle.recordings.find((r) => r.key === key);
    if (!rec) { problems.push(`events for ${key}: no such recording in the bundle`); continue; }
    let events;
    try { events = lines.map((l) => JSON.parse(l)); } catch { problems.push(`events for ${key}: unreadable line`); continue; }
    const broken = verifyChain(events);
    if (broken >= 0) { problems.push(`events for ${key}: hash chain broken at event ${broken + 1}`); continue; }
    try { replay(rec.session, events); } catch (error) { problems.push(`events for ${key}: ${error.message}`); continue; }
    logs.set(key, { lines, events });
  }
  if (problems.length) throw Object.assign(new Error(`import refused:\n${problems.join('\n')}`), { status: 422, problems });

  const run = async (c) => {
    // A name written without an account must not silently become an existing account's: only an identity link may.
    const legacy = new Set();
    for (const { events } of logs.values()) for (const e of events) if (!e.accountId) legacy.add(String(e.reviewer).trim().toLowerCase());
    if (legacy.size) {
      const clash = await c.query('select a.id, a.reviewer_name, l.account_id as linked from accounts a left join identity_links l on l.legacy_name_ci = lower(a.reviewer_name) where lower(a.reviewer_name) = any($1)', [[...legacy]]);
      for (const x of clash.rows) if (x.linked !== x.id) throw Object.assign(new Error(`import refused: account ${x.id} is named "${x.reviewer_name}", a name written in the imported logs without an account; rename it, or link the name to it explicitly first`), { status: 409 });
    }
    const report = { added: [], updated: [], unchanged: [], keptInReview: [], eventsAppended: {}, eventsAlreadyPresent: {}, waveforms: 0, inventory: false };
    const existing = new Map((await c.query('select key, session_sha256 from recordings')).rows.map((x) => [x.key, x.session_sha256]));
    const withEvents = new Set((await c.query('select distinct recording_key from review_events')).rows.map((x) => x.recording_key));
    const dbIds = new Map();
    for (const x of (await c.query('select key, session_json from recordings')).rows) { const s = JSON.parse(x.session_json); dbIds.set(identity(s), x.key); }
    for (const r of bundle.recordings) {
      const other = dbIds.get(identity(r.session));
      if (other && other !== r.key) throw Object.assign(new Error(`import refused: ${r.key} is the same recording as ${other}, already in the database`), { status: 409 });
      const json = JSON.stringify(r.session);
      const h = sha(json);
      if (!existing.has(r.key)) {
        await c.query('insert into recordings (key, session_json, session_sha256, task_json, package_raw) values ($1,$2,$3,$4,$5)', [r.key, json, h, JSON.stringify(r.task), r.packageRaw ?? null]);
        report.added.push(r.key);
      } else if (existing.get(r.key) === h) {
        await c.query('update recordings set task_json = $2 where key = $1', [r.key, JSON.stringify(r.task)]);
        report.unchanged.push(r.key);
      } else if (withEvents.has(r.key)) {
        report.keptInReview.push(r.key); // a review has begun: it keeps the session it started on
      } else {
        await c.query('update recordings set session_json = $2, session_sha256 = $3, task_json = $4, package_raw = $5, imported_at = now() where key = $1', [r.key, json, h, JSON.stringify(r.task), r.packageRaw ?? null]);
        report.updated.push(r.key);
      }
    }
    for (const [key, { lines, events }] of logs) {
      if (existing.has(key) && existing.get(key) !== sha(JSON.stringify(bundle.recordings.find((r) => r.key === key).session)) && withEvents.has(key)) throw Object.assign(new Error(`import refused: the database holds another session for ${key}, with a review in progress`), { status: 409 });
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [key]);
      const db = (await c.query('select line from review_events where recording_key = $1 order by seq', [key])).rows.map((x) => x.line);
      for (let i = 0; i < db.length; i++) if (db[i] !== lines[i]) throw Object.assign(new Error(`import refused: the review log of ${key} differs from the database at event ${i + 1} (the two have diverged; nothing was imported)`), { status: 409 });
      for (let i = db.length; i < lines.length; i++) {
        const e = events[i];
        await c.query('insert into review_events (recording_key, seq, line, hash, prev, reviewer, account_id, type, at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [key, e.seq, lines[i], e.hash, e.prev, e.reviewer, e.accountId ?? null, e.type, e.at]);
      }
      report.eventsAppended[key] = lines.length - db.length;
      report.eventsAlreadyPresent[key] = db.length;
    }
    for (const w of bundle.waveforms ?? []) {
      const r = bundle.recordings.find((x) => x.key === w.key) ?? null;
      let s = r?.session ?? null;
      if (!s) { const q = await c.query('select session_json from recordings where key = $1', [w.key]); s = q.rows[0] ? JSON.parse(q.rows[0].session_json) : null; }
      const p = JSON.parse(w.json);
      if (!s || p.bytes !== s.bytes || (s.sha256 && p.sha256 !== s.sha256)) throw Object.assign(new Error(`import refused: the waveform of ${w.key} is not of its recording`), { status: 422 });
      await c.query('insert into waveforms (key, json, bytes, sha256, duration_ms) values ($1,$2,$3,$4,$5) on conflict (key) do update set json = excluded.json, bytes = excluded.bytes, sha256 = excluded.sha256, duration_ms = excluded.duration_ms, computed_at = now()', [w.key, w.json, p.bytes, p.sha256 ?? null, p.durationMs ?? null]);
      report.waveforms++;
    }
    if (bundle.inventory) {
      if (LOCAL_PATH.test(JSON.stringify(bundle.inventory))) throw Object.assign(new Error('import refused: a local file path is in the inventory (sanitise the bundle)'), { status: 422 });
      await c.query('insert into inventory (id, json) values (1, $1) on conflict (id) do update set json = excluded.json, updated_at = now()', [JSON.stringify(bundle.inventory)]);
      report.inventory = true;
    }
    await c.query('insert into imports (by_account, kind, bundle_sha256, summary) values ($1,$2,$3,$4)', [by, kind, sha(JSON.stringify(bundle)), { added: report.added.length, updated: report.updated.length, unchanged: report.unchanged.length, keptInReview: report.keptInReview, eventsAppended: report.eventsAppended, waveforms: report.waveforms }]);
    if (dryRun) throw Object.assign(new Error('dry run'), { dryRunReport: report });
    return report;
  };
  try {
    return await tx(pool, run);
  } catch (error) {
    if (error.dryRunReport) return { dryRun: true, ...error.dryRunReport };
    throw error;
  }
}
