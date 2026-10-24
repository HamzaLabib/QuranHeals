// Reviewer accounts and sign-in for the cloud dashboard (Phase 4.8.2).
//
// Identity comes from Google Sign-In: the browser obtains a Google ID token and the server verifies it with Google's
// official google-auth-library (signature, audience, issuer, expiry), as the Quran Heals backend already does. No
// password is ever stored or checked here. Only an account the administrator created (by e-mail) can sign in, and only
// while it is active; the first sign-in binds the account to the Google subject, which must never change afterwards.
//
// Sessions: a random 256-bit token in an HttpOnly, Secure, SameSite=Lax cookie; the database stores only its SHA-256.
// A session ends at sign-out, after 12 h without use, after 7 days, or at once when the account is deactivated.
//
// The reviewer NAME written into review events comes only from the signed-in account (never from the browser). A name
// already written in review logs before sign-in existed (e.g. "Hamza") is reserved: an account receives it only through
// an explicit identity link that records the evidence (recordings, event counts, head hashes); events are never
// rewritten.
import crypto from 'node:crypto';

import { OAuth2Client } from 'google-auth-library';

import { tx } from './db.mjs';

export const SESSION_COOKIE = 'qhr_session';
export const IDLE_MS = 12 * 3600 * 1000;
export const MAX_MS = 7 * 24 * 3600 * 1000;
export const ROLES = ['admin', 'reviewer'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const NAME = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .'-]{0,59}$/u;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** The legacy reviewer names in the logs: names on events written without an account. */
export async function legacyNames(db) {
  const r = await db.query(`select lower(reviewer) as ci, min(reviewer) as name, count(*)::int as events, count(distinct recording_key)::int as recordings
    from review_events where account_id is null group by lower(reviewer) order by 1`);
  return r.rows;
}

export function createAuth({ pool, googleClientId, cookieSecure = true, verifier = null, now = () => Date.now() }) {
  const google = new OAuth2Client();
  async function verify(credential) {
    if (verifier) return verifier(credential);
    if (!googleClientId) throw new Error('GOOGLE_CLIENT_ID is not configured');
    let ticket;
    try { ticket = await google.verifyIdToken({ idToken: String(credential ?? ''), audience: googleClientId }); } catch { throw Object.assign(new Error('Google sign-in could not be verified'), { status: 401 }); }
    const p = ticket.getPayload();
    if (!p?.sub) throw Object.assign(new Error('Google sign-in could not be verified'), { status: 401 });
    return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true };
  }

  /** Signs in a verified identity; returns { token, account } or throws (401/403). */
  async function login(credential, userAgent = '') {
    const id = await verify(credential);
    if (!id.email || !id.emailVerified) throw Object.assign(new Error('this Google account has no verified e-mail address'), { status: 403 });
    return tx(pool, async (c) => {
      const r = await c.query('select * from accounts where google_sub = $1 or (google_sub is null and lower(email) = lower($2)) for update', [id.sub, id.email]);
      const acc = r.rows.find((a) => a.google_sub === id.sub) ?? r.rows[0];
      if (!acc) throw Object.assign(new Error('this account is not authorised for the audio review dashboard: ask the administrator'), { status: 403 });
      if (acc.google_sub && acc.google_sub !== id.sub) throw Object.assign(new Error('this e-mail address belongs to another Google account'), { status: 403 });
      if (!acc.active) throw Object.assign(new Error('this account has been deactivated'), { status: 403 });
      if (!acc.google_sub) await c.query('update accounts set google_sub = $1 where id = $2', [id.sub, acc.id]);
      const token = crypto.randomBytes(32).toString('base64url');
      await c.query('insert into auth_sessions (token_hash, account_id, expires_at, user_agent) values ($1, $2, $3, $4)', [sha(token), acc.id, new Date(now() + MAX_MS), String(userAgent).slice(0, 200)]);
      return { token, account: publicAccount(acc) };
    });
  }

  /** The signed-in account of a request, or null. */
  async function accountOf(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token || token.length > 100) return null;
    const r = await pool.query('select s.token_hash, s.last_seen, s.expires_at, a.* from auth_sessions s join accounts a on a.id = s.account_id where s.token_hash = $1', [sha(token)]);
    const s = r.rows[0];
    if (!s || !s.active) return null;
    const t = now();
    if (new Date(s.expires_at).getTime() <= t || new Date(s.last_seen).getTime() + IDLE_MS <= t) {
      await pool.query('delete from auth_sessions where token_hash = $1', [s.token_hash]);
      return null;
    }
    if (t - new Date(s.last_seen).getTime() > 60000) await pool.query('update auth_sessions set last_seen = $1 where token_hash = $2', [new Date(t), s.token_hash]);
    return publicAccount(s);
  }

  async function logout(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await pool.query('delete from auth_sessions where token_hash = $1', [sha(token)]);
  }

  const cookie = (token) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_MS / 1000}${cookieSecure ? '; Secure' : ''}`;
  const clearCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure ? '; Secure' : ''}`;
  return { login, accountOf, logout, cookie, clearCookie, verify };
}

export const publicAccount = (a) => ({ id: a.id, email: a.email, displayName: a.display_name, reviewerName: a.reviewer_name, roles: a.roles, active: a.active });

// ---------------------------------------------------------------- administration (accounts, identity links)

async function reservedBy(c, nameCi) {
  const legacy = await c.query('select 1 from review_events where account_id is null and lower(reviewer) = $1 limit 1', [nameCi]);
  const link = await c.query('select account_id from identity_links where legacy_name_ci = $1', [nameCi]);
  return { legacy: legacy.rowCount > 0, linkedTo: link.rows[0]?.account_id ?? null };
}

export async function createAccount(pool, { email, displayName, reviewerName, roles = ['reviewer'], by }) {
  email = String(email ?? '').trim().toLowerCase();
  reviewerName = String(reviewerName ?? displayName ?? '').trim();
  displayName = String(displayName ?? reviewerName).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('a valid e-mail address is required'), { status: 400 });
  if (!NAME.test(reviewerName)) throw Object.assign(new Error('the reviewer name must be 1-60 letters, digits, spaces or . \' -'), { status: 400 });
  if (!roles.length || roles.some((r) => !ROLES.includes(r))) throw Object.assign(new Error(`roles must be among ${ROLES.join(', ')}`), { status: 400 });
  return tx(pool, async (c) => {
    const res = await reservedBy(c, reviewerName.toLowerCase());
    if (res.legacy || res.linkedTo) throw Object.assign(new Error(`the name "${reviewerName}" already appears in review logs: give it to an account only through an identity link`), { status: 409 });
    const id = `acc_${crypto.randomBytes(9).toString('base64url')}`;
    try {
      await c.query('insert into accounts (id, email, display_name, reviewer_name, roles, created_by) values ($1,$2,$3,$4,$5,$6)', [id, email, displayName, reviewerName, roles, by]);
    } catch (error) {
      throw Object.assign(new Error(/reviewer_name/.test(error.message) ? `the reviewer name "${reviewerName}" is taken` : `an account for ${email} exists`), { status: 409 });
    }
    await c.query('insert into admin_log (by_account, action, detail) values ($1, $2, $3)', [by, 'create-account', { id, email, reviewerName, roles }]);
    return { id, email, displayName, reviewerName, roles, active: true };
  });
}

export async function setActive(pool, { accountId, active, by }) {
  return tx(pool, async (c) => {
    const r = await c.query('update accounts set active = $1, deactivated_at = $2 where id = $3 returning *', [active, active ? null : new Date(), accountId]);
    if (!r.rowCount) throw Object.assign(new Error('no such account'), { status: 404 });
    if (!active) await c.query('delete from auth_sessions where account_id = $1', [accountId]); // revoked at once
    await c.query('insert into admin_log (by_account, action, detail) values ($1, $2, $3)', [by, active ? 'activate-account' : 'deactivate-account', { accountId }]);
    return publicAccount(r.rows[0]);
  });
}

export async function setRoles(pool, { accountId, roles, by }) {
  if (!roles.length || roles.some((r) => !ROLES.includes(r))) throw Object.assign(new Error(`roles must be among ${ROLES.join(', ')}`), { status: 400 });
  return tx(pool, async (c) => {
    const r = await c.query('update accounts set roles = $1 where id = $2 returning *', [roles, accountId]);
    if (!r.rowCount) throw Object.assign(new Error('no such account'), { status: 404 });
    await c.query('insert into admin_log (by_account, action, detail) values ($1, $2, $3)', [by, 'set-roles', { accountId, roles }]);
    return publicAccount(r.rows[0]);
  });
}

/**
 * Links a legacy reviewer name (events written without an account) to an account, after the owner has verified the
 * ownership. The account takes the name, so its new events continue those reviews as the same reviewer; old events
 * keep their author exactly as written. The evidence (every recording, its event count, first/last time and log
 * head hash) is stored with the link.
 */
export async function linkLegacyIdentity(pool, { legacyName, accountId, by, confirmation }) {
  const ci = String(legacyName ?? '').trim().toLowerCase();
  if (!ci) throw Object.assign(new Error('name the legacy reviewer'), { status: 400 });
  if (confirmation !== `link ${legacyName}`) throw Object.assign(new Error(`to confirm, send confirmation: "link ${legacyName}"`), { status: 400 });
  return tx(pool, async (c) => {
    const ev = await c.query(`select recording_key, count(*)::int as events, min(at) as first, max(at) as last, min(reviewer) as written
      from review_events where account_id is null and lower(reviewer) = $1 group by recording_key order by recording_key`, [ci]);
    if (!ev.rowCount) throw Object.assign(new Error(`no review event was written by "${legacyName}" without an account`), { status: 404 });
    const existing = await c.query('select account_id from identity_links where legacy_name_ci = $1', [ci]);
    if (existing.rowCount) throw Object.assign(new Error(`"${legacyName}" is already linked to ${existing.rows[0].account_id}`), { status: 409 });
    const acc = await c.query('select * from accounts where id = $1 for update', [accountId]);
    if (!acc.rowCount) throw Object.assign(new Error('no such account'), { status: 404 });
    const heads = await c.query(`select distinct on (recording_key) recording_key, seq, hash from review_events where recording_key = any($1) order by recording_key, seq desc`, [ev.rows.map((x) => x.recording_key)]);
    const evidence = {
      recordings: ev.rows.map((x) => ({ key: x.recording_key, events: x.events, first: x.first, last: x.last, headSeq: heads.rows.find((h) => h.recording_key === x.recording_key)?.seq, headHash: heads.rows.find((h) => h.recording_key === x.recording_key)?.hash })),
      writtenAs: [...new Set(ev.rows.map((x) => x.written))],
      note: 'events are unchanged; the account continues these reviews under the same reviewer name',
    };
    const clash = await c.query('select id from accounts where lower(reviewer_name) = $1 and id <> $2', [ci, accountId]);
    if (clash.rowCount) throw Object.assign(new Error(`another account already uses the name "${legacyName}"`), { status: 409 });
    await c.query('insert into identity_links (legacy_name_ci, legacy_name, account_id, linked_by, evidence) values ($1,$2,$3,$4,$5)', [ci, evidence.writtenAs[0], accountId, by, evidence]);
    await c.query('update accounts set reviewer_name = $1 where id = $2', [evidence.writtenAs[0], accountId]);
    await c.query('insert into admin_log (by_account, action, detail) values ($1, $2, $3)', [by, 'link-identity', { legacyName: evidence.writtenAs[0], accountId, recordings: evidence.recordings.length }]);
    return { legacyName: evidence.writtenAs[0], accountId, evidence };
  });
}

/** A CLI administrator token (Authorization: Bearer ...), checked against ADMIN_TOKEN_SHA256 in constant time. */
export function adminTokenOk(req, tokenSha256) {
  if (!tokenSha256 || !/^[0-9a-f]{64}$/.test(tokenSha256)) return false;
  const m = /^Bearer\s+(\S{32,200})$/.exec(req.headers.authorization ?? '');
  if (!m) return false;
  const a = Buffer.from(sha(m[1]), 'hex');
  const b = Buffer.from(tokenSha256, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
