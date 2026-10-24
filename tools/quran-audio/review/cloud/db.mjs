// Durable storage of the cloud audio review dashboard (Phase 4.8.2): one PostgreSQL database, separate from every
// production database.
//
// The review log keeps the local tool's exact semantics. Each event is stored as the exact JSON line the tool hashed
// (so the hash chain can always be re-verified byte for byte); a trigger makes the table append-only for every
// database user, and appends to one recording are serialised by a transaction-scoped advisory lock. Accounts,
// identity links, sessions, recordings (sessions + inventory rows + original packages), waveforms, the inventory,
// imports, admin actions and backup records complete the schema.
import pg from 'pg';

import { REGISTRY_SCHEMA } from './registry.mjs';

// 2: Phase 4.8.3 verified audio registry (registry.mjs).
export const SCHEMA_VERSION = 2;

const SCHEMA = `
create table if not exists schema_version (version int primary key, applied_at timestamptz not null default now());

create table if not exists accounts (
  id text primary key,
  email text not null unique,
  google_sub text unique,
  display_name text not null,
  reviewer_name text not null,
  roles text[] not null default '{reviewer}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null,
  deactivated_at timestamptz
);
create unique index if not exists accounts_reviewer_name_ci on accounts (lower(reviewer_name));

-- An explicit, auditable association of a name written in review logs before authentication existed with the
-- account that owns it. Historical events are never rewritten.
create table if not exists identity_links (
  legacy_name_ci text primary key,
  legacy_name text not null,
  account_id text not null references accounts(id),
  linked_by text not null,
  linked_at timestamptz not null default now(),
  evidence jsonb not null
);

create table if not exists auth_sessions (
  token_hash text primary key,
  account_id text not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index if not exists auth_sessions_account on auth_sessions (account_id);

create table if not exists recordings (
  key text primary key,
  session_json text not null,
  session_sha256 text not null,
  task_json text not null,
  package_raw text,
  import_id bigint,
  imported_at timestamptz not null default now()
);

create table if not exists review_events (
  recording_key text not null,
  seq int not null,
  line text not null,
  hash text not null unique,
  prev text not null,
  reviewer text not null,
  account_id text,
  type text not null,
  at text not null,
  primary key (recording_key, seq)
);

create table if not exists waveforms (
  key text primary key,
  json text not null,
  bytes bigint not null,
  sha256 text,
  duration_ms int,
  computed_at timestamptz not null default now()
);

create table if not exists inventory (id int primary key default 1 check (id = 1), json text not null, updated_at timestamptz not null default now());
create table if not exists imports (id bigserial primary key, at timestamptz not null default now(), by_account text not null, kind text not null, bundle_sha256 text, summary jsonb not null);
create table if not exists admin_log (id bigserial primary key, at timestamptz not null default now(), by_account text not null, action text not null, detail jsonb not null);
create table if not exists backups (id bigserial primary key, at timestamptz not null default now(), kind text not null, sha256 text, bytes bigint, detail jsonb not null);
create table if not exists settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());

create or replace function qh_review_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'review_events is append-only: an event can never be changed or removed';
end $$;
drop trigger if exists review_events_append_only on review_events;
create trigger review_events_append_only before update or delete on review_events for each row execute function qh_review_events_append_only();
drop trigger if exists review_events_no_truncate on review_events;
create trigger review_events_no_truncate before truncate on review_events for each statement execute function qh_review_events_append_only();
`;

/**
 * A connection pool. `DATABASE_URL` (Render's internal URL inside Render; the external URL with TLS from a computer).
 * `ssl`: true verifies the server certificate; 'no-verify' encrypts without verifying (only if verification fails
 * against a managed database whose CA is not in Node's store); false for a local test database.
 */
export function createPool(url, { ssl = undefined, max = 10 } = {}) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  const sslOpt = ssl === undefined ? (local ? false : { rejectUnauthorized: true }) : ssl === 'no-verify' ? { rejectUnauthorized: false } : ssl ? { rejectUnauthorized: true } : false;
  return new pg.Pool({ connectionString: url, ssl: sslOpt, max, idleTimeoutMillis: 30000 });
}

export async function migrate(pool) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select pg_advisory_xact_lock(4801)');
    // Arabic text must round-trip exactly: refuse a database that is not UTF-8 (Render's are).
    const enc = (await c.query('select pg_encoding_to_char(encoding) as e from pg_database where datname = current_database()')).rows[0].e;
    if (enc !== 'UTF8') throw new Error(`the database encoding is ${enc}; the review database must be UTF8`);
    await c.query(SCHEMA);
    await c.query(REGISTRY_SCHEMA);
    await c.query('insert into schema_version (version) values ($1) on conflict do nothing', [SCHEMA_VERSION]);
    await c.query('commit');
  } catch (error) {
    await c.query('rollback').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}

/** Runs fn(client) in one transaction. */
export async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (error) {
    await c.query('rollback').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}

/** Whether the database holds no recordings, events or accounts (restores go only into an empty database). */
export async function isEmpty(pool) {
  const r = await pool.query(`select (select count(*) from recordings) + (select count(*) from review_events) + (select count(*) from accounts) as n`);
  return Number(r.rows[0].n) === 0;
}
