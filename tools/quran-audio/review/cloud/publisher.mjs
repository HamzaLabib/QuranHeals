// Phase 4.8.3: the publication worker of the cloud review service. It turns a recording that two reviewers verified
// into a published, immutable timing version for BOTH app environments, with no person or tool in between, and only
// when every check of publication-rules.mjs passes.
//
// Durable and idempotent:
//   - every accepted review event queues the recording (publication_jobs, keyed by the review recording, with the log's
//     head hash); a periodic sweep queues every recording again (rights, sources and files can change), and jobs left
//     "running" by a stopped server are taken again after their lease (locked_until) expires: a restart resumes;
//   - jobs are claimed with FOR UPDATE SKIP LOCKED: two server instances never process one recording at once;
//   - the version id is derived from the recording and its timing: processing the same review twice, or a duplicate
//     completion event, reuses the version and changes no pointer (nothing is published twice);
//   - both environments are pointed at the version in ONE transaction (registry.publishVersion): they cannot be left
//     half-updated by an interruption; a temporary failure (provider unreachable, database error) is retried with
//     back-off and shown, never reported as success.
// Modes (PUBLICATION_MODE, set by the administrator in the service configuration; default 'off'):
//   off      every recording is evaluated and its status shown; NOTHING is written to the registry;
//   enabled  eligible recordings are published to the configured environments (default both); a published recording
//            whose review or authorization no longer holds (an amendment reopened a dispute, an authorization was
//            revoked, the provider now serves another file) is withdrawn from them, logged.
import { DEFAULT_APP_CAPABILITIES, definitiveFailure, ENVIRONMENTS, evaluatePublication, recordingIdOf } from './publication-rules.mjs';
import { activeOthers, isBlocked, listAuthorizations, listSeekVerifications, logRow, publishVersion, setActivation } from './registry.mjs';
import { tx } from './db.mjs';

export const PUBLICATION_MODES = ['off', 'enabled'];
const LEASE = "interval '5 minutes'";
const backoffMs = (attempts) => Math.min(6 * 3600e3, 60e3 * 2 ** Math.min(attempts, 9));

export function createPublisher({ pool, store, audio, mode = 'off', environments = ENVIRONMENTS, allowSynthetic = false, appCapabilities = DEFAULT_APP_CAPABILITIES, intervalMs = 60e3, sweepMs = 6 * 3600e3, log = () => {}, autoStart = true }) {
  if (!PUBLICATION_MODES.includes(mode)) throw new Error(`PUBLICATION_MODE must be one of ${PUBLICATION_MODES.join(', ')}`);
  for (const e of environments) if (!ENVIRONMENTS.includes(e)) throw new Error(`unknown environment ${e}`);
  let timer = null;
  let sweeper = null;
  let running = null;

  const headOf = (key) => (store.hasLog(key) ? store.load(key).events.at(-1).hash : 'none');
  /** Queues a recording now (an accepted event, an administrator action, the sweep). */
  async function notify(key, reason = 'event') {
    await pool.query(`insert into publication_jobs (review_key, head, state, next_run_at, updated_at) values ($1, $2, 'queued', now(), now())
      on conflict (review_key) do update set head = excluded.head, state = case when publication_jobs.state = 'running' then 'running' else 'queued' end, next_run_at = now(), updated_at = now()`, [key, headOf(key)]);
    if (autoStart) setTimeout(() => void tick().catch((e) => log(`publisher: ${e.message}`)), 50);
    return { key, reason };
  }
  async function enqueueAll(reason = 'sweep') {
    let n = 0;
    for (const [key] of store.tasks()) if (store.hasLog(key)) { await notify(key, reason); n++; }
    return n;
  }

  /** Evidence of the exact file: the server's own hash of the provider's file (waveform drawn from it, or streamed). */
  async function fileEvidence(t, verified) {
    const w = await audio.waveform(t);
    if (w && w !== 'embedded') return { bytes: w.bytes, sha256: w.sha256, how: 'hashed while drawing its waveform from the provider\'s file' };
    const h = (await pool.query('select bytes, sha256, url, format from source_hashes where key = $1', [t.key])).rows[0];
    if (h && h.url === t.url) return { bytes: Number(h.bytes), sha256: h.sha256, format: h.format ?? null, how: 'streamed from the provider and hashed by this server' };
    if (!verified) return null; // never download a recording before two reviewers have verified it
    const x = await audio.hashSource(t);
    await pool.query('insert into source_hashes (key, url, bytes, sha256, format) values ($1,$2,$3,$4,$5) on conflict (key) do update set url = excluded.url, bytes = excluded.bytes, sha256 = excluded.sha256, format = excluded.format, hashed_at = now()', [t.key, t.url, x.bytes, x.sha256, x.format ?? null]);
    return { ...x, how: 'streamed from the provider and hashed by this server' };
  }

  const accountsOf = (events) => Object.fromEntries([1, 2].map((r) => [r, events.find((e) => e.type === 'join' && e.role === r)?.accountId ?? null]));

  /** Evaluates one recording (and, when enabled, publishes or withdraws it). Returns the job's new state. */
  async function evaluate(key) {
    const t = store.tasks().get(key);
    if (!t) return { state: 'done', evaluation: null, note: 'the recording is no longer in the dashboard' };
    const { session: stored, state, events } = store.hasLog(key) ? store.load(key) : { session: store.load(key).session, state: { reviewers: {}, proposals: [], resolutions: [], unresolvable: [], comments: [] }, events: [] };
    const both = !!(state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt);
    let waveform = null;
    let source = null;
    let transient = null;
    if (both) {
      try { waveform = await fileEvidence(t, true); } catch (e) { transient = `hashing the provider's file: ${e.message}`; }
      const s = await audio.checkSource(t);
      source = { ...s, network: !s.ok && /could not be reached|HTTP 5\d\d|HTTP 429/.test(s.problem ?? ''), at: new Date().toISOString() };
      if (source.network) transient = source.problem;
    } else waveform = await fileEvidence(t, false).catch(() => null);
    // The Phase 4.6 manual sessions keep their provider and rights on the task, and no format: the format is then the one
    // this server read from the file's own encoder frame (audio.mp3Format), never assumed.
    const session = {
      ...stored,
      provider: stored.provider ?? t.provider ?? null,
      rights: t.rights ?? stored.rights,
      format: stored.format?.mode ? stored.format : waveform?.format?.mode ? { mode: waveform.format.mode, kbps: waveform.format.kbps, evidence: waveform.format.evidence } : (stored.format ?? null),
    };
    const authorizations = await listAuthorizations(pool);
    const recordingId = waveform?.sha256 ? recordingIdOf({ reciterId: session.reciterId, surah: session.surah, provider: session.provider, url: session.url, bytes: session.bytes, sha256: waveform.sha256 }) : null;
    const others = recordingId ? await activeOthers(pool, { reciterId: session.reciterId, surah: session.surah, recordingId }) : [];
    const seekVerifications = waveform?.sha256 ? await listSeekVerifications(pool, waveform.sha256) : [];
    const ev = evaluatePublication({ session, state, events, evidence: { waveform, source }, authorizations, activeOthers: others, accounts: accountsOf(events), allowSynthetic, seekVerifications, appCapabilities });
    const summary = { compatibility: ev.compatibility, stage: ev.stage, eligible: ev.eligible, checks: ev.checks, blockers: ev.blockers, outstanding: ev.outstanding, recordingId, reviewStatus: ev.reviewStatus, evaluatedAt: new Date().toISOString(), mode };
    if (mode === 'off') return { state: ev.eligible ? 'ready' : transient ? 'retrying' : ev.blockers.length ? 'blocked' : 'waiting', evaluation: summary, transient };
    if (ev.eligible) {
      try {
        const evidence = { reviewKey: key, reviewHead: events.at(-1).hash, reviewEvents: events.length, reviewers: [1, 2].map((r) => ({ role: r, name: state.reviewers[r].name, accountId: accountsOf(events)[r], submittedAt: state.reviewers[r].submittedAt })), checks: ev.checks, file: waveform, source, evaluatedAt: summary.evaluatedAt };
        const r = await publishVersion(pool, { content: ev.content, evidence, reviewKey: key, reviewHead: events.at(-1).hash, environments, actor: 'publisher' });
        return { state: 'published', evaluation: { ...summary, published: r } };
      } catch (e) {
        if (isBlocked(e)) return { state: 'blocked', evaluation: { ...summary, stage: 'publication-blocked', blockers: [...summary.blockers, e.message] } };
        throw e;
      }
    }
    // Not eligible: a definitive failure withdraws whatever this review published before (never on a temporary one).
    if (definitiveFailure(ev) && !transient) {
      const active = (await pool.query(`select a.recording_id, array_agg(a.environment) envs from environment_activations a join verified_recordings v using (recording_id)
        where v.review_key = $1 and a.version_id is not null group by a.recording_id`, [key])).rows;
      for (const a of active) {
        await setActivation(pool, { recordingId: a.recording_id, versionId: null, environments: a.envs, actor: 'publisher', reason: `no longer publishable: ${ev.blockers.slice(0, 3).join('; ')}` });
        log(`publisher: withdrew ${a.recording_id} (${key}) from ${a.envs.join(', ')}`);
      }
      if (active.length) summary.withdrawn = active.map((a) => ({ recordingId: a.recording_id, environments: a.envs }));
    }
    return { state: transient ? 'retrying' : ev.blockers.length ? 'blocked' : 'waiting', evaluation: summary, transient };
  }

  /** Claims due jobs and processes them, one at a time. Returns how many were processed. */
  async function tick(limit = 10) {
    if (running) return running;
    running = (async () => {
      let n = 0;
      for (;;) {
        const claimed = await tx(pool, async (c) => (await c.query(`update publication_jobs set state = 'running', locked_until = now() + ${LEASE}, updated_at = now()
          where review_key = (select review_key from publication_jobs where next_run_at <= now() and (state <> 'running' or locked_until < now())
          order by next_run_at limit 1 for update skip locked) returning review_key, head, attempts`)).rows[0]);
        if (!claimed) break;
        try {
          const r = await evaluate(claimed.review_key);
          const retry = r.state === 'retrying';
          const attempts = retry ? claimed.attempts + 1 : 0;
          await pool.query(`update publication_jobs set state = $2, attempts = $3, next_run_at = now() + ($4 || ' milliseconds')::interval, locked_until = null, last_error = $5, evaluation = $6, updated_at = now() where review_key = $1`,
            [claimed.review_key, r.state, attempts, String(retry ? backoffMs(attempts) : 365 * 24 * 3600e3), retry ? r.transient : null, r.evaluation]);
        } catch (e) {
          const attempts = claimed.attempts + 1;
          log(`publisher: ${claimed.review_key} failed (${attempts}): ${e.message}`);
          await pool.query(`update publication_jobs set state = 'failed', attempts = $2, next_run_at = now() + ($3 || ' milliseconds')::interval, locked_until = null, last_error = $4, updated_at = now() where review_key = $1`,
            [claimed.review_key, attempts, String(backoffMs(attempts)), e.message.slice(0, 1000)]);
          await logRow(pool, 'job-failed', { actor: 'publisher', detail: { reviewKey: claimed.review_key, attempts, error: e.message.slice(0, 500) } }).catch(() => {});
        }
        if (++n >= limit) break;
      }
      return n;
    })().finally(() => { running = null; });
    return running;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => void tick().catch((e) => log(`publisher: ${e.message}`)), intervalMs);
    sweeper = setInterval(() => void enqueueAll('sweep').catch((e) => log(`publisher sweep: ${e.message}`)), sweepMs);
    timer.unref?.(); sweeper.unref?.();
    // A restart: everything is evaluated again (expired leases are taken by tick()).
    void enqueueAll('startup').catch((e) => log(`publisher startup: ${e.message}`));
  }
  function stop() { clearInterval(timer); clearInterval(sweeper); timer = null; sweeper = null; return running ?? Promise.resolve(0); }

  async function jobs() {
    return (await pool.query('select review_key, head, state, attempts, next_run_at, last_error, evaluation, updated_at from publication_jobs')).rows;
  }
  return { notify, enqueueAll, tick, evaluate, start, stop, jobs, mode, environments, appCapabilities };
}
