// Logical backups of the cloud review database (Phase 4.8.2), in addition to Render's own managed backups.
//
// A backup is NDJSON: a manifest line, one line per row ({"t": table, "row": {...}}), and a final line with the
// SHA-256 of every row line. Review events keep their exact stored line, so a restored log has the same hash chain.
// Sign-in sessions are never backed up (they are credentials). Waveforms are derived data and optional.
// A restore goes only into an EMPTY database, checks the SHA-256, re-verifies every review log's chain, and compares
// the row counts with the manifest.
//
// The owner runs both from a computer (node review/cloud/migrate.mjs backup|restore); the server records each
// download in the backups table.
import crypto from 'node:crypto';

import { verifyChain } from '../manual/manual-lib.mjs';
import { isEmpty, migrate, tx } from './db.mjs';

export const TABLES = {
  accounts: ['id', 'email', 'google_sub', 'display_name', 'reviewer_name', 'roles', 'active', 'created_at', 'created_by', 'deactivated_at'],
  identity_links: ['legacy_name_ci', 'legacy_name', 'account_id', 'linked_by', 'linked_at', 'evidence'],
  recordings: ['key', 'session_json', 'session_sha256', 'task_json', 'package_raw', 'import_id', 'imported_at'],
  review_events: ['recording_key', 'seq', 'line', 'hash', 'prev', 'reviewer', 'account_id', 'type', 'at'],
  waveforms: ['key', 'json', 'bytes', 'sha256', 'duration_ms', 'computed_at'],
  inventory: ['id', 'json', 'updated_at'],
  imports: ['id', 'at', 'by_account', 'kind', 'bundle_sha256', 'summary'],
  admin_log: ['id', 'at', 'by_account', 'action', 'detail'],
  backups: ['id', 'at', 'kind', 'sha256', 'bytes', 'detail'],
  settings: ['key', 'value', 'updated_at'],
  // Phase 4.8.3: the verified audio registry (parents before children: restored in this order).
  verified_recordings: ['recording_id', 'reciter_id', 'surah', 'identity_json', 'review_key', 'hold_json', 'created_at'],
  timing_versions: ['version_id', 'recording_id', 'version_no', 'content_json', 'content_sha256', 'timing_fingerprint', 'review_head', 'evidence_json', 'created_at'],
  environment_activations: ['environment', 'recording_id', 'version_id', 'changed_at', 'changed_by'],
  source_authorizations: ['id', 'provider', 'reciter_id', 'recording_sha256', 'riwayah', 'acknowledges_notice', 'evidence', 'attribution', 'decided_by', 'decided_at', 'revoked_at', 'revoked_by', 'revoke_reason'],
  seek_verifications: ['id', 'recording_sha256', 'platform', 'method', 'app_build', 'device', 'samples', 'max_abs_error_ms', 'passed', 'evidence', 'recorded_by', 'recorded_at', 'revoked_at', 'revoked_by'],
  publication_log: ['id', 'at', 'action', 'recording_id', 'version_id', 'environment', 'actor', 'detail'],
  source_hashes: ['key', 'url', 'bytes', 'sha256', 'format', 'hashed_at'],
  publication_jobs: ['review_key', 'head', 'state', 'attempts', 'next_run_at', 'locked_until', 'last_error', 'evaluation', 'updated_at'],
};
const ORDER = { accounts: 'id', identity_links: 'legacy_name_ci', recordings: 'key', review_events: 'recording_key, seq', waveforms: 'key', inventory: 'id', imports: 'id', admin_log: 'id', backups: 'id', settings: 'key', verified_recordings: 'recording_id', timing_versions: 'recording_id, version_no', environment_activations: 'environment, recording_id', source_authorizations: 'id', publication_log: 'id', publication_jobs: 'review_key', source_hashes: 'key', seek_verifications: 'id' };
const JSONB = new Set(['evidence', 'summary', 'detail', 'value', 'hold_json', 'evaluation', 'format']);

function chainsOf(eventRows) {
  const by = new Map();
  for (const r of eventRows) { if (!by.has(r.recording_key)) by.set(r.recording_key, []); by.get(r.recording_key).push(JSON.parse(r.line)); }
  const problems = [];
  const heads = {};
  for (const [k, ev] of by) {
    const b = verifyChain(ev);
    if (b >= 0) problems.push(`${k}: chain broken at event ${b + 1}`);
    heads[k] = { events: ev.length, head: ev.at(-1).hash };
  }
  return { problems, heads };
}

export async function exportBackup(pool, { includeWaveforms = false, now = () => new Date().toISOString() } = {}) {
  const lines = [];
  const counts = {};
  let eventRows = [];
  for (const [t, cols] of Object.entries(TABLES)) {
    if (t === 'waveforms' && !includeWaveforms) continue;
    const r = await pool.query(`select ${cols.join(', ')} from ${t} order by ${ORDER[t]}`);
    counts[t] = r.rowCount;
    if (t === 'review_events') eventRows = r.rows;
    for (const row of r.rows) lines.push(JSON.stringify({ t, row }));
  }
  const chains = chainsOf(eventRows);
  const h = crypto.createHash('sha256');
  for (const l of lines) h.update(`${l}\n`);
  const manifest = { kind: 'audio-review-cloud-backup', version: 1, createdAt: now(), counts, includeWaveforms, logs: chains.heads, chainProblems: chains.problems, sha256: h.digest('hex') };
  const text = [JSON.stringify(manifest), ...lines, JSON.stringify({ t: 'end', sha256: manifest.sha256 })].join('\n') + '\n';
  return { manifest, text };
}

/** Problems with a backup text (empty when intact). */
export function verifyBackup(text) {
  const lines = text.split('\n').filter(Boolean);
  let manifest;
  try { manifest = JSON.parse(lines[0]); } catch { return ['no manifest']; }
  if (manifest.kind !== 'audio-review-cloud-backup') return ['not a cloud review backup'];
  const end = JSON.parse(lines.at(-1));
  const body = lines.slice(1, -1);
  const h = crypto.createHash('sha256');
  for (const l of body) h.update(`${l}\n`);
  const problems = [];
  if (end.t !== 'end' || end.sha256 !== manifest.sha256 || h.digest('hex') !== manifest.sha256) problems.push('the SHA-256 does not match: the backup is damaged or incomplete');
  const rows = body.map((l) => JSON.parse(l));
  const counts = {};
  for (const r of rows) counts[r.t] = (counts[r.t] ?? 0) + 1;
  for (const [t, n] of Object.entries(manifest.counts)) if ((counts[t] ?? 0) !== n) problems.push(`${t}: ${counts[t] ?? 0} rows, the manifest says ${n}`);
  problems.push(...chainsOf(rows.filter((r) => r.t === 'review_events').map((r) => r.row)).problems);
  return problems;
}

export async function restoreBackup(pool, text) {
  const problems = verifyBackup(text);
  if (problems.length) throw new Error(`backup refused: ${problems.join('; ')}`);
  await migrate(pool);
  if (!(await isEmpty(pool))) throw new Error('restore refused: the target database is not empty (a restore never overwrites)');
  const lines = text.split('\n').filter(Boolean);
  const manifest = JSON.parse(lines[0]);
  const rows = lines.slice(1, -1).map((l) => JSON.parse(l));
  await tx(pool, async (c) => {
    for (const t of Object.keys(TABLES)) {
      const cols = TABLES[t];
      for (const { row } of rows.filter((r) => r.t === t)) {
        const vals = cols.map((k) => (JSONB.has(k) && !(t === 'source_authorizations' && k === 'evidence') && row[k] != null ? JSON.stringify(row[k]) : row[k])); // source_authorizations.evidence is text
        await c.query(`insert into ${t} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
      }
    }
    for (const t of ['imports', 'admin_log', 'backups', 'publication_log']) await c.query(`select setval(pg_get_serial_sequence('${t}', 'id'), coalesce((select max(id) from ${t}), 0) + 1, false)`);
  });
  const after = await exportBackup(pool, { includeWaveforms: manifest.includeWaveforms });
  for (const [t, n] of Object.entries(manifest.counts)) if (after.manifest.counts[t] !== n) throw new Error(`restore check: ${t} has ${after.manifest.counts[t]} rows, expected ${n}`);
  for (const [k, h] of Object.entries(manifest.logs)) if (after.manifest.logs[k]?.head !== h.head) throw new Error(`restore check: the log of ${k} does not end at ${h.head}`);
  return { counts: after.manifest.counts, logs: Object.keys(after.manifest.logs).length };
}
