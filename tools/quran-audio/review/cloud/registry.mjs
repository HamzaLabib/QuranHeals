// Phase 4.8.3: the verified audio registry, in the review service's own PostgreSQL (db.mjs), kept apart from the
// review log (review_events is never read or written here except through the store).
//
//   verified_recordings      one row per EXACT recording (reciter, surah, provider, URL, size, SHA-256): two
//                            recordings of one surah are two rows, so one can never overwrite the other;
//   timing_versions          immutable (a trigger refuses UPDATE/DELETE/TRUNCATE): one published timing document per
//                            version, numbered per recording, with its review evidence beside it;
//   environment_activations  the pointer per environment (development, production) and recording: which version the
//                            app of that environment plays, or none (withdrawn). Both environments are set in ONE
//                            transaction, so they cannot drift apart by an interruption;
//   publication_log          append-only (trigger): every creation, activation, withdrawal, rollback, hold,
//                            authorization and recovery, with who did it;
//   publication_jobs         the durable work queue of the publication worker (publisher.mjs);
//   source_authorizations    the administrator's recorded permissions (provider, reciter, exact file), with evidence.
import crypto from 'node:crypto';

import { tx } from './db.mjs';
import { ENVIRONMENTS, PLATFORMS, SEEK_TOLERANCE_MS } from './publication-rules.mjs';

export const REGISTRY_SCHEMA = `
create table if not exists verified_recordings (
  recording_id text primary key,
  reciter_id text not null,
  surah int not null check (surah between 1 and 114),
  identity_json text not null,
  review_key text not null,
  hold_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists verified_recordings_surah on verified_recordings (reciter_id, surah);

create table if not exists timing_versions (
  version_id text primary key,
  recording_id text not null references verified_recordings(recording_id),
  version_no int not null,
  content_json text not null,
  content_sha256 text not null,
  timing_fingerprint text not null,
  review_head text not null,
  evidence_json text not null,
  created_at timestamptz not null default now(),
  unique (recording_id, version_no)
);

create table if not exists environment_activations (
  environment text not null check (environment in ('development', 'production')),
  recording_id text not null references verified_recordings(recording_id),
  version_id text references timing_versions(version_id),
  changed_at timestamptz not null default now(),
  changed_by text not null,
  primary key (environment, recording_id)
);

create table if not exists publication_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  action text not null,
  recording_id text,
  version_id text,
  environment text,
  actor text not null,
  detail jsonb not null
);

create table if not exists publication_jobs (
  review_key text primary key,
  head text not null,
  state text not null,
  attempts int not null default 0,
  next_run_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  evaluation jsonb,
  updated_at timestamptz not null default now()
);

-- The SHA-256 of a provider's file, hashed by this server (streamed, not kept): recording identity evidence.
create table if not exists source_hashes (
  key text primary key,
  url text not null,
  bytes bigint not null,
  sha256 text not null,
  format jsonb,
  hashed_at timestamptz not null default now()
);
alter table source_hashes add column if not exists format jsonb;

-- Phase 4.8.5: a measured seek accuracy of one exact file on one platform (a real device), recorded by an administrator.
create table if not exists seek_verifications (
  id text primary key,
  recording_sha256 text not null,
  platform text not null check (platform in ('android', 'ios')),
  method text not null,
  app_build text not null,
  device text not null,
  samples int not null,
  max_abs_error_ms numeric not null,
  passed boolean not null,
  evidence text not null,
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text
);

create table if not exists source_authorizations (
  id text primary key,
  provider text not null,
  reciter_id text,
  recording_sha256 text,
  riwayah text not null,
  acknowledges_notice boolean not null default false,
  evidence text not null,
  attribution text,
  decided_by text not null,
  decided_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text
);

create or replace function qh_immutable() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only / immutable', tg_table_name;
end $$;
drop trigger if exists timing_versions_immutable on timing_versions;
create trigger timing_versions_immutable before update or delete on timing_versions for each row execute function qh_immutable();
drop trigger if exists timing_versions_no_truncate on timing_versions;
create trigger timing_versions_no_truncate before truncate on timing_versions for each statement execute function qh_immutable();
drop trigger if exists publication_log_append_only on publication_log;
create trigger publication_log_append_only before update or delete on publication_log for each row execute function qh_immutable();
drop trigger if exists publication_log_no_truncate on publication_log;
create trigger publication_log_no_truncate before truncate on publication_log for each statement execute function qh_immutable();
`;

const logRow = (c, action, { recordingId = null, versionId = null, environment = null, actor, detail = {} }) =>
  c.query('insert into publication_log (action, recording_id, version_id, environment, actor, detail) values ($1,$2,$3,$4,$5,$6)', [action, recordingId, versionId, environment, actor, detail]);

class Blocked extends Error {}
export const isBlocked = (e) => e instanceof Blocked;

/** Other recordings of this reciter and surah with an active version in some environment. */
export async function activeOthers(q, { reciterId, surah, recordingId }) {
  const r = await q.query(`select a.recording_id, a.environment from environment_activations a join verified_recordings v using (recording_id)
    where v.reciter_id = $1 and v.surah = $2 and a.version_id is not null and a.recording_id <> $3 order by a.environment`, [reciterId, surah, recordingId]);
  return r.rows.map((x) => ({ recordingId: x.recording_id, environment: x.environment }));
}

/**
 * Creates (or reuses: the same recording and timing are the same version) the immutable version, then points every
 * listed environment at it, in one transaction. Refused (Blocked) when another recording of the surah is active or the
 * recording is held by an administrator. Returns { versionId, versionNo, created, activated: [environment] }.
 */
export async function publishVersion(pool, { content, evidence, reviewKey, reviewHead, environments = ENVIRONMENTS, actor = 'publisher' }) {
  const id = content.body.recording;
  return tx(pool, async (c) => {
    // Serialised per surah (two recordings of one surah never race) and per recording.
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`publish:${id.reciterId}:${id.surah}`]);
    const others = await activeOthers(c, { reciterId: id.reciterId, surah: id.surah, recordingId: content.recordingId });
    if (others.length) throw new Blocked(`another recording of ${id.reciterId} ${id.surah} is active (${others.map((o) => `${o.recordingId} in ${o.environment}`).join(', ')})`);
    const rec = await c.query('select hold_json from verified_recordings where recording_id = $1', [content.recordingId]);
    if (rec.rows[0]?.hold_json) throw new Blocked(`held by an administrator: ${rec.rows[0].hold_json.reason ?? ''}`);
    if (!rec.rowCount) {
      await c.query('insert into verified_recordings (recording_id, reciter_id, surah, identity_json, review_key) values ($1,$2,$3,$4,$5)', [content.recordingId, id.reciterId, id.surah, JSON.stringify(id), reviewKey]);
      await logRow(c, 'recording-created', { recordingId: content.recordingId, actor, detail: { reviewKey, identity: id } });
    }
    let created = false;
    let row = (await c.query('select version_id, version_no from timing_versions where version_id = $1', [content.versionId])).rows[0];
    if (!row) {
      const n = (await c.query('select coalesce(max(version_no), 0) + 1 as n from timing_versions where recording_id = $1', [content.recordingId])).rows[0].n;
      await c.query('insert into timing_versions (version_id, recording_id, version_no, content_json, content_sha256, timing_fingerprint, review_head, evidence_json) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [content.versionId, content.recordingId, n, JSON.stringify(content.body), content.contentSha256, content.fingerprint, reviewHead, JSON.stringify(evidence)]);
      await logRow(c, 'version-created', { recordingId: content.recordingId, versionId: content.versionId, actor, detail: { versionNo: n, fingerprint: content.fingerprint, reviewHead } });
      row = { version_id: content.versionId, version_no: n };
      created = true;
    }
    const activated = [];
    for (const env of environments) {
      const cur = (await c.query('select version_id from environment_activations where environment = $1 and recording_id = $2 for update', [env, content.recordingId])).rows[0];
      if (cur?.version_id === content.versionId) continue;
      await c.query(`insert into environment_activations (environment, recording_id, version_id, changed_at, changed_by) values ($1,$2,$3,now(),$4)
        on conflict (environment, recording_id) do update set version_id = excluded.version_id, changed_at = now(), changed_by = excluded.changed_by`, [env, content.recordingId, content.versionId, actor]);
      await logRow(c, 'activated', { recordingId: content.recordingId, versionId: content.versionId, environment: env, actor, detail: { previous: cur?.version_id ?? null } });
      activated.push(env);
    }
    return { versionId: row.version_id, versionNo: row.version_no, created, activated };
  });
}

/**
 * Points environments of one recording at a version of THAT recording, or at none (withdrawn); one transaction.
 * `hold`: also hold the recording, so the worker does not re-activate a newer version (a rollback).
 */
export async function setActivation(pool, { recordingId, versionId = null, environments = ENVIRONMENTS, actor, reason, hold = false, action = 'activated' }) {
  return tx(pool, async (c) => {
    const rec = (await c.query('select reciter_id, surah from verified_recordings where recording_id = $1 for update', [recordingId])).rows[0];
    if (!rec) throw new Error(`no recording ${recordingId}`);
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`publish:${rec.reciter_id}:${rec.surah}`]);
    if (versionId) {
      const v = (await c.query('select recording_id from timing_versions where version_id = $1', [versionId])).rows[0];
      if (!v || v.recording_id !== recordingId) throw new Error(`${versionId} is not a version of ${recordingId}`);
      const others = await activeOthers(c, { reciterId: rec.reciter_id, surah: rec.surah, recordingId });
      if (others.length) throw new Error(`another recording of this surah is active (${others.map((o) => `${o.recordingId} in ${o.environment}`).join(', ')}): withdraw it first`);
    }
    for (const env of environments) {
      if (!ENVIRONMENTS.includes(env)) throw new Error(`unknown environment ${env}`);
      const cur = (await c.query('select version_id from environment_activations where environment = $1 and recording_id = $2 for update', [env, recordingId])).rows[0];
      await c.query(`insert into environment_activations (environment, recording_id, version_id, changed_at, changed_by) values ($1,$2,$3,now(),$4)
        on conflict (environment, recording_id) do update set version_id = excluded.version_id, changed_at = now(), changed_by = excluded.changed_by`, [env, recordingId, versionId, actor]);
      await logRow(c, versionId ? action : 'withdrawn', { recordingId, versionId, environment: env, actor, detail: { previous: cur?.version_id ?? null, reason: reason ?? null } });
    }
    if (hold) {
      await c.query('update verified_recordings set hold_json = $2 where recording_id = $1', [recordingId, { by: actor, at: new Date().toISOString(), reason: reason ?? 'held', versionId }]);
      await logRow(c, 'held', { recordingId, versionId, actor, detail: { reason: reason ?? null } });
    }
    return { recordingId, versionId, environments };
  });
}

export async function releaseHold(pool, { recordingId, actor }) {
  return tx(pool, async (c) => {
    const r = await c.query('update verified_recordings set hold_json = null where recording_id = $1 and hold_json is not null returning review_key', [recordingId]);
    if (!r.rowCount) throw new Error(`${recordingId} is not held`);
    await logRow(c, 'hold-released', { recordingId, actor, detail: {} });
    return { recordingId, reviewKey: r.rows[0].review_key };
  });
}

/** The published manifest of one environment: every active version, with the exact recording to play. */
export async function manifest(pool, environment) {
  const r = await pool.query(`select a.recording_id, a.version_id, a.changed_at, v.version_no, v.timing_fingerprint, v.content_sha256, v.content_json, s.attribution
    from environment_activations a join timing_versions v using (version_id)
    left join lateral (select attribution from source_authorizations x where x.revoked_at is null and x.provider = (v.content_json::jsonb #>> '{recording,provider}') order by x.decided_at desc limit 1) s on true
    where a.environment = $1 and a.version_id is not null order by a.recording_id`, [environment]);
  const entries = r.rows.map((x) => {
    const body = JSON.parse(x.content_json);
    const id = body.recording;
    return { recordingId: x.recording_id, versionId: x.version_id, versionNo: x.version_no, reciterId: id.reciterId, surah: id.surah, ayahCount: body.timing.entries.length, timingFingerprint: x.timing_fingerprint, contentSha256: x.content_sha256,
      playback: body.playback ?? { method: 'cbr-exact', platforms: ['android', 'ios'] },
      audio: { provider: id.provider, url: id.url, bytes: id.bytes, sha256: id.sha256, durationMs: id.durationMs, format: id.format }, attribution: x.attribution ?? null, activatedAt: new Date(x.changed_at).toISOString() };
  });
  return { kind: 'quran-heals-verified-timing-manifest', format: 1, environment, entries };
}

/** One version's document, only if it has ever been activated somewhere (an unpublished version is never served). */
export async function versionDocument(pool, versionId) {
  const r = await pool.query(`select v.version_id, v.version_no, v.content_json, v.created_at from timing_versions v
    where v.version_id = $1 and exists (select 1 from publication_log l where l.version_id = v.version_id and l.action in ('activated', 'rolled-back', 'aligned'))`, [versionId]);
  if (!r.rowCount) return null;
  const x = r.rows[0];
  return { ...JSON.parse(x.content_json), versionId: x.version_id, versionNo: x.version_no, createdAt: new Date(x.created_at).toISOString() };
}

/** Every registry recording with its versions, activations, hold and recent log (for the dashboard). */
export async function registryOverview(pool) {
  const recs = (await pool.query('select recording_id, reciter_id, surah, identity_json, review_key, hold_json, created_at from verified_recordings order by reciter_id, surah')).rows;
  const vers = (await pool.query('select version_id, recording_id, version_no, timing_fingerprint, review_head, created_at from timing_versions order by recording_id, version_no')).rows;
  const acts = (await pool.query('select environment, recording_id, version_id, changed_at, changed_by from environment_activations')).rows;
  const logs = (await pool.query('select id, at, action, recording_id, version_id, environment, actor, detail from publication_log order by id desc limit 500')).rows;
  return recs.map((r) => ({
    recordingId: r.recording_id, reciterId: r.reciter_id, surah: r.surah, identity: JSON.parse(r.identity_json), reviewKey: r.review_key, hold: r.hold_json, createdAt: r.created_at,
    versions: vers.filter((v) => v.recording_id === r.recording_id).map((v) => ({ versionId: v.version_id, versionNo: v.version_no, fingerprint: v.timing_fingerprint, reviewHead: v.review_head, createdAt: v.created_at })),
    active: Object.fromEntries(ENVIRONMENTS.map((e) => { const a = acts.find((x) => x.environment === e && x.recording_id === r.recording_id); return [e, a ? { versionId: a.version_id, changedAt: a.changed_at, changedBy: a.changed_by } : null]; })),
    log: logs.filter((l) => l.recording_id === r.recording_id).slice(0, 30),
  }));
}

/** Recordings whose environments point at different versions (or one at none): detectable, then recoverable (align). */
export async function mismatches(pool) {
  const r = await pool.query(`select recording_id, array_agg(environment order by environment) envs, array_agg(coalesce(version_id, '') order by environment) versions
    from environment_activations group by recording_id`);
  return r.rows.filter((x) => new Set(ENVIRONMENTS.map((e) => x.versions[x.envs.indexOf(e)] ?? '')).size > 1).map((x) => ({ recordingId: x.recording_id, ...Object.fromEntries(ENVIRONMENTS.map((e) => [e, x.versions[x.envs.indexOf(e)] || null])) }));
}

// ---------------------------------------------------------------- source authorizations (administrator)

const AUTH_PROVIDERS = /^[a-z0-9-]{2,40}$/;
export async function listAuthorizations(pool) {
  const r = await pool.query('select * from source_authorizations order by decided_at');
  return r.rows.map((x) => ({ id: x.id, provider: x.provider, reciterId: x.reciter_id, recordingSha256: x.recording_sha256, riwayah: x.riwayah, acknowledgesNotice: x.acknowledges_notice, evidence: x.evidence, attribution: x.attribution, decidedBy: x.decided_by, decidedAt: new Date(x.decided_at).toISOString(), revokedAt: x.revoked_at ? new Date(x.revoked_at).toISOString() : null, revokedBy: x.revoked_by, revokeReason: x.revoke_reason }));
}
export async function addAuthorization(pool, { provider, reciterId = null, recordingSha256 = null, riwayah, acknowledgesNotice = false, evidence, attribution = null, by }) {
  if (!AUTH_PROVIDERS.test(String(provider ?? ''))) throw new Error('provider: a provider id such as mp3quran or archive');
  if (reciterId != null && !/^[a-z0-9-]{2,40}$/.test(reciterId)) throw new Error('reciterId: a reciter id of the app');
  if (recordingSha256 != null && !/^[0-9a-f]{64}$/.test(recordingSha256)) throw new Error('recordingSha256: 64 hex characters');
  if (riwayah !== 'hafs') throw new Error('riwayah: only Hafs ʿan ʿĀṣim (hafs) is published in the app');
  if (!String(evidence ?? '').trim() || String(evidence).length > 2000) throw new Error('evidence: where the permission is written (a URL, a letter, a date), up to 2000 characters');
  if (acknowledgesNotice && !recordingSha256) throw new Error('a rights notice can only be acknowledged for one exact file (recordingSha256)');
  const id = `auth_${crypto.randomBytes(6).toString('hex')}`;
  return tx(pool, async (c) => {
    await c.query('insert into source_authorizations (id, provider, reciter_id, recording_sha256, riwayah, acknowledges_notice, evidence, attribution, decided_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, provider, reciterId, recordingSha256, riwayah, acknowledgesNotice === true, String(evidence).trim(), attribution ? String(attribution).slice(0, 300) : null, by]);
    await logRow(c, 'authorization-added', { actor: by, detail: { id, provider, reciterId, recordingSha256, riwayah, acknowledgesNotice, evidence } });
    return { id };
  });
}
export async function revokeAuthorization(pool, { id, by, reason }) {
  if (!String(reason ?? '').trim()) throw new Error('a revocation needs a reason');
  return tx(pool, async (c) => {
    const r = await c.query('update source_authorizations set revoked_at = now(), revoked_by = $2, revoke_reason = $3 where id = $1 and revoked_at is null returning provider', [id, by, String(reason).trim()]);
    if (!r.rowCount) throw new Error(`${id} is not an active authorization`);
    await logRow(c, 'authorization-revoked', { actor: by, detail: { id, reason } });
    return { id };
  });
}
// ---------------------------------------------------------------- device seek verifications (administrator; Phase 4.8.5)

const SEEK_METHODS = ['cbr-exact', 'vbr-mllt'];
export async function listSeekVerifications(pool, sha256 = null) {
  const r = await pool.query(`select * from seek_verifications ${sha256 ? 'where recording_sha256 = $1' : ''} order by recorded_at`, sha256 ? [sha256] : []);
  return r.rows.map((x) => ({ id: x.id, recordingSha256: x.recording_sha256, platform: x.platform, method: x.method, appBuild: x.app_build, device: x.device, samples: x.samples, maxAbsErrorMs: Number(x.max_abs_error_ms), passed: x.passed, evidence: x.evidence, recordedBy: x.recorded_by, at: new Date(x.recorded_at).toISOString(), revokedAt: x.revoked_at ? new Date(x.revoked_at).toISOString() : null }));
}
/** Records a device measurement; "passed" is decided here (every seek within the tolerance), never by the caller. */
export async function addSeekVerification(pool, { recordingSha256, platform, method, appBuild, device, samples, maxAbsErrorMs, evidence, by }) {
  if (!/^[0-9a-f]{64}$/.test(String(recordingSha256 ?? ''))) throw new Error('recordingSha256: the exact file (64 hex characters)');
  if (!PLATFORMS.includes(platform)) throw new Error('platform: android or ios');
  if (!SEEK_METHODS.includes(method)) throw new Error(`method: one of ${SEEK_METHODS.join(', ')}`);
  if (!String(appBuild ?? '').trim() || !String(device ?? '').trim()) throw new Error('appBuild and device: which build, on which physical device');
  if (!Number.isInteger(samples) || samples < 10) throw new Error('samples: at least 10 measured seeks');
  if (!Number.isFinite(maxAbsErrorMs) || maxAbsErrorMs < 0) throw new Error('maxAbsErrorMs: the largest measured seek error');
  if (!String(evidence ?? '').trim()) throw new Error('evidence: where the measurement is documented');
  const id = `seek_${crypto.randomBytes(6).toString('hex')}`;
  const passed = maxAbsErrorMs <= SEEK_TOLERANCE_MS;
  return tx(pool, async (c) => {
    await c.query('insert into seek_verifications (id, recording_sha256, platform, method, app_build, device, samples, max_abs_error_ms, passed, evidence, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, recordingSha256, platform, method, String(appBuild).trim(), String(device).trim(), samples, maxAbsErrorMs, passed, String(evidence).trim(), by]);
    await logRow(c, 'seek-verification-recorded', { actor: by, detail: { id, recordingSha256, platform, method, appBuild, device, samples, maxAbsErrorMs, passed } });
    return { id, passed };
  });
}
export async function revokeSeekVerification(pool, { id, by }) {
  return tx(pool, async (c) => {
    const r = await c.query('update seek_verifications set revoked_at = now(), revoked_by = $2 where id = $1 and revoked_at is null', [id, by]);
    if (!r.rowCount) throw new Error(`${id} is not an active measurement`);
    await logRow(c, 'seek-verification-revoked', { actor: by, detail: { id } });
    return { id };
  });
}
export { logRow };
