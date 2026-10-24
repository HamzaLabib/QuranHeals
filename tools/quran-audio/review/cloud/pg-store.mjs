// The review logs and recordings of the cloud dashboard, in PostgreSQL (db.mjs), with the same rules as the local
// log store (review/manual/log-store.mjs): state is only ever rebuilt by replaying a recording's hash-chained log
// through manual-lib's applyEvent, and a refused event never reaches the log.
//
// Reads are served from an in-memory copy (the dashboard's views are synchronous). Every append is atomic:
//   - a transaction holds pg_advisory_xact_lock(<recording>), so appends to one recording are serialised across
//     connections, requests and server instances;
//   - inside it, the last stored event is compared with the copy; if anything else wrote meanwhile, the log is
//     re-read and replayed before the new event is checked;
//   - the primary key (recording, seq) and the unique hash refuse a duplicate even if the lock were bypassed.
// So two reviewers saving at the same moment never overwrite each other (each event changes only its author's
// work), and a double-clicked submission is refused by the review rules.
import { applyEvent, eventHash, replay } from '../manual/manual-lib.mjs';
import { tx } from './db.mjs';

export function createPgStore({ pool, now = () => new Date().toISOString() }) {
  const recs = new Map(); // key -> { sessionJson, session, task, events: [], state }
  const tasks = new Map();
  let inventory = null;

  async function init() {
    recs.clear(); tasks.clear();
    const r = await pool.query('select key, session_json, task_json from recordings order by key');
    for (const row of r.rows) {
      const task = JSON.parse(row.task_json);
      recs.set(row.key, { sessionJson: row.session_json, session: null, task, events: [], state: null });
      tasks.set(row.key, task);
    }
    const e = await pool.query('select recording_key, line from review_events order by recording_key, seq');
    for (const row of e.rows) recs.get(row.recording_key)?.events.push(JSON.parse(row.line));
    const inv = await pool.query('select json from inventory where id = 1');
    inventory = inv.rows[0] ? JSON.parse(inv.rows[0].json) : { blocked: [], superseded: [], problems: [], sources: [], totals: {}, createdAt: null };
    // Every log is verified now: a chain that does not replay stops the server instead of serving wrong state.
    for (const [key, rec] of recs) if (rec.events.length) { rec.session = JSON.parse(rec.sessionJson); rec.state = replay(rec.session, rec.events); }
  }

  function load(key) {
    const rec = recs.get(key);
    if (!rec) throw new Error(`unknown recording ${key}`);
    if (!rec.session) rec.session = JSON.parse(rec.sessionJson);
    if (!rec.state) rec.state = replay(rec.session, rec.events);
    return { session: rec.session, events: rec.events, state: rec.state };
  }

  async function append(key, input, { accountId = null } = {}) {
    if (!recs.has(key)) throw new Error(`unknown recording ${key}`);
    return tx(pool, async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [key]);
      let rec = recs.get(key);
      const last = await c.query('select seq, hash from review_events where recording_key = $1 order by seq desc limit 1', [key]);
      const dbSeq = last.rows[0]?.seq ?? 0;
      if (dbSeq !== rec.events.length || (dbSeq && last.rows[0].hash !== rec.events.at(-1).hash)) {
        // Written elsewhere since we read it: start again from the database (replay re-checks the chain).
        const all = await c.query('select line from review_events where recording_key = $1 order by seq', [key]);
        rec.events = all.rows.map((x) => JSON.parse(x.line));
        rec.session ??= JSON.parse(rec.sessionJson);
        rec.state = replay(rec.session, rec.events);
      }
      const { session, state } = load(key);
      rec = recs.get(key);
      const prev = rec.events.at(-1)?.hash ?? 'genesis';
      const ev = { seq: rec.events.length + 1, at: now(), reviewer: String(input.reviewer ?? '').trim(), ...(accountId ? { accountId } : {}), role: input.role ?? null, type: input.type, payload: input.payload ?? {}, prev };
      const trial = structuredClone(state);
      applyEvent(session, trial, ev); // throws the reason it is refused: nothing is written
      ev.hash = eventHash(prev, ev);
      await c.query('insert into review_events (recording_key, seq, line, hash, prev, reviewer, account_id, type, at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [key, ev.seq, JSON.stringify(ev), ev.hash, prev, ev.reviewer, accountId, ev.type, ev.at]);
      // Applied to the copy only after the insert is part of the transaction; on a failed commit init() re-reads.
      rec.events.push(ev);
      rec.state = trial;
      return { session, state: trial, events: rec.events };
    }).catch(async (error) => {
      // Whatever failed (a refused event, a lost connection, a failed commit), the copy is re-read from the database,
      // so it can never hold an event the database does not.
      await reload(key).catch(() => {});
      if (/duplicate key|unique/i.test(error.message)) throw new Error('another change to this recording was saved at the same moment: reload and try again');
      throw error;
    });
  }

  /** Re-reads one recording's log from the database (after a failed transaction). */
  async function reload(key) {
    const rec = recs.get(key);
    const all = await pool.query('select line from review_events where recording_key = $1 order by seq', [key]);
    rec.events = all.rows.map((x) => JSON.parse(x.line));
    rec.session ??= JSON.parse(rec.sessionJson);
    rec.state = replay(rec.session, rec.events);
  }

  return {
    init, load, append, reload,
    tasks: () => tasks,
    inventory: () => inventory,
    hasLog: (key) => (recs.get(key)?.events.length ?? 0) > 0,
    async packageRaw(key) { const r = await pool.query('select package_raw from recordings where key = $1', [key]); return r.rows[0]?.package_raw ?? null; },
  };
}
