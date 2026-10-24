// Phase 4.8.9 (owner policy auto-accept-v2, 2026-10-23): high and medium risk starts are now accepted like check and
// routine; only VERY HIGH risk starts (very-high.mjs: credible structural evidence) need a person. Acceptances made
// under v1 stay valid (their tier is still accepted) unless the start has since become very high risk.
//
// Phase 4.8.7: automatic acceptance by risk tier (owner policy, 2026-10-20). Manual listening is kept for the
// HIGH and MEDIUM risk starts only:
//   check, routine  -> accepted automatically at the proposed start, when it passes every structural and alignment
//                      validation below and no reviewer has judged it otherwise
//   medium, high    -> manual review required (never accepted here)
//   anything else   -> not accepted; reported apart
//
// An automatic acceptance is NOT a review. It is written to its own append-only, hash-chained ledger
// (<dataDir>/_auto-acceptance/ledger.jsonl), never into a recording's review log: no reviewer is created, nothing is
// submitted for anyone, and the two-reviewer verification, the export and the publication rules (which read the
// review logs only) are unchanged. It only takes a start out of the single-review pending queue (Phase 4.8.6).
//
// Human decisions win: a start a reviewer rejected (now or at any point in its history), marked uncertain, edited
// to another time, declared unresolvable or is resolving is never accepted; and a reviewer's later rejection of an
// accepted start returns it to the queue (the ledger entry stays as history). An acceptance is tied to the exact
// proposal (fingerprint + proposed time): if the package changes, it no longer applies.
//
// usage (from tools/quran-audio):
//   node review/dashboard/auto-accept.mjs --config <dashboard.config.json>            dry run: what would be accepted
//   node review/dashboard/auto-accept.mjs --config <cfg> --apply [--out report.json]  back up, then append to the ledger
// Safe to rerun: an acceptance already in the ledger is never written twice.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { eventHash, verifyChain } from '../manual/manual-lib.mjs';
import { openingOf, OPENING_RULE } from '../manual/opening.mjs';
import { perAyahBlock, veryHighOf } from '../manual/very-high.mjs';

export const POLICY = {
  id: 'auto-accept-v2', decidedBy: 'owner', decidedOn: '2026-10-23', previous: 'auto-accept-v1 (2026-10-20): check and routine only',
  auto: ['high', 'medium', 'check', 'routine'], manual: ['veryhigh'],
  rule: 'high, medium, check and routine starts are accepted automatically at the proposed start when they pass structural and alignment validation, carry no very high risk evidence (very-high.mjs, run first) and no reviewer judged them otherwise; very high risk starts need a manual review; any other classification is not accepted. An automatic acceptance is administrative: never a human listening verification',
};
export const BY = 'automatic acceptance policy (not a reviewer)';
export const LEDGER_DIR = '_auto-acceptance';
export const ledgerFile = (dataDir) => path.join(dataDir, LEDGER_DIR, 'ledger.jsonl');
/** Phase 4.8.8: the opening rule's own append-only amendment ledger (same chain format, beside the acceptances). */
export const AMENDMENT_DIR = '_opening-rule';
export const amendmentFile = (dataDir) => path.join(dataDir, AMENDMENT_DIR, 'ledger.jsonl');

// ---------------------------------------------------------------- the ledger

// The same chain as a review log (manual-lib): SHA-256 over the previous hash and the entry; seq 1..n from 'genesis'.
export const entryHash = eventHash;
/** Index of the first broken entry, or -1. */
export const verifyLedger = verifyChain;
const identityOf = (e) => (e.type === 'auto-accept' ? `${e.key}|${e.ayah}|${e.fingerprint}|${e.proposedMs}` : e.type === 'auto-accept-withdrawn' ? `withdrawn|${e.ref}` : null);
const readEntries = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * The ledger of one data folder. A broken chain (edited outside the tool) disables it: no acceptance is used and
 * nothing is appended, so every start goes back to the queue until the owner restores a backup.
 */
export function openLedger(file, { now = () => new Date().toISOString(), identity = identityOf } = {}) {
  let entries = [];
  let problem = null;
  let size = -1;
  const index = () => {
    const byKey = new Map();
    const milestones = new Map();
    for (const e of entries) {
      if (e.type === 'auto-accept') { if (!byKey.has(e.key)) byKey.set(e.key, []); byKey.get(e.key).push(e); }
      if (e.type === 'reciter-completed' || e.type === 'reciter-reopened') milestones.set(e.reciterId, e);
    }
    return { byKey, milestones, ids: new Set(entries.map(identity).filter(Boolean)) };
  };
  let ix = index();
  function reload() {
    // Size AND modification time: an edit that keeps the length (a digit changed) is noticed too.
    const s = fs.existsSync(file) ? (({ size: n, mtimeMs }) => `${n}:${mtimeMs}`)(fs.statSync(file)) : '0';
    if (s === size) return;
    try {
      const list = readEntries(file);
      const broken = verifyLedger(list);
      if (broken >= 0) { problem = `${file}: the hash chain breaks at entry ${broken + 1} (edited outside the tool): automatic acceptances are ignored until it is restored from a backup`; entries = []; }
      else { problem = null; entries = list; }
    } catch (error) { problem = `${file}: unreadable (${error.message}): automatic acceptances are ignored`; entries = []; }
    size = s;
    ix = index();
  }
  reload();
  /** Appends new entries under a cross-process lock; entries already in the ledger are skipped. Returns those written. */
  function append(list) {
    if (!list.length) return [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lock = `${file}.lock`;
    for (let i = 0; ; i++) {
      try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), at: now() }), { flag: 'wx' }); break; } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (i > 50) {
          // A lock left by a crashed process (or one older than a minute) is taken over.
          let held = null; try { held = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { /* unreadable */ }
          const alive = held && held.host === os.hostname() && (() => { try { process.kill(held.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } })();
          if (alive && Date.now() - Date.parse(held.at) < 60000) throw new Error(`${lock} is held by process ${held.pid}`);
          fs.rmSync(lock, { force: true });
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
    try {
      size = -1; reload();
      if (problem) throw new Error(problem);
      const written = [];
      const fd = fs.openSync(file, 'a');
      try {
        let prev = entries.at(-1)?.hash ?? 'genesis';
        for (const x of list) {
          const id = identity(x);
          if (id && ix.ids.has(id)) continue;
          const e = { seq: entries.length + 1, at: now(), ...x, prev };
          e.hash = entryHash(prev, e);
          fs.writeSync(fd, JSON.stringify(e) + '\n');
          entries.push(e); prev = e.hash; written.push(e);
          if (id) ix.ids.add(id);
        }
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      size = -1; reload();
      return written;
    } finally { fs.rmSync(lock, { force: true }); }
  }
  return {
    file, append, reload,
    get problem() { reload(); return problem; },
    entries: () => { reload(); return entries; },
    forKey: (key) => { reload(); return ix.byKey.get(key) ?? []; },
    milestone: (reciterId) => { reload(); return ix.milestones.get(reciterId) ?? null; },
  };
}

// ---------------------------------------------------------------- the rule (pure)

const proposedAt = (session, ayah) => { const ms = session.proposal?.starts?.[ayah]; return Number.isFinite(ms) ? ms : null; };
const reviewers = (state) => [1, 2].map((k) => state?.reviewers?.[k]).filter(Boolean);

/** A start a reviewer has accepted: a current 'confirmed' submission, or a formal resolution. */
export function humanReviewed(state, k) {
  k = String(k);
  return (state?.resolutions ?? []).some((x) => String(x.ayah) === k) || reviewers(state).some((r) => r.submitted?.[k]?.status === 'confirmed');
}
/** Why a reviewer's own judgement keeps this start from automatic acceptance, or null. */
export function humanBlock(session, state, k, { opening = false } = {}) {
  k = String(k);
  for (const r of reviewers(state)) {
    if (r.submitted?.[k]?.status === 'rejected') return `rejected by Reviewer ${r.role} (the human decision is kept)`;
    if ((r.revisions ?? []).some((v) => v.key === k && (v.before?.status === 'rejected' || v.after?.status === 'rejected'))) return `rejected earlier by Reviewer ${r.role} (rejection history kept)`;
    const m = r.work?.markers?.[k];
    if (m && !r.submitted?.[k]) {
      if (m.status === 'rejected') return `rejected by Reviewer ${r.role} (saved, not submitted)`;
      if (m.status === 'uncertain' || m.markedUncertain) return `marked uncertain by Reviewer ${r.role}`;
      // Phase 4.8.8: the opening plays from 0 whatever was placed, so a moved ayah-1 marker is not a disagreement.
      if (!opening && m.ms !== proposedAt(session, k)) return `edited by Reviewer ${r.role} to their own time (kept)`;
    }
  }
  if ((state?.unresolvable ?? []).some((x) => String(x.ayah) === k)) return 'declared unresolvable by the reviewers';
  if ((state?.proposals ?? []).some((x) => String(x.ayah) === k)) return 'a disagreement about it is being resolved';
  return null;
}
/** Why a whole recording cannot be accepted automatically (structural / alignment validation), or null. */
export function recordingBlock(task, session) {
  if (task.synthetic || session.synthetic) return 'synthetic practice data';
  if (!session.proposal) return 'manual timing: there is no proposed start to accept (every start is placed by ear)';
  if (task.proposal?.fingerprint && session.proposal.fingerprint !== task.proposal.fingerprint) return `the package changed after its review began (${session.proposal.fingerprint} → ${task.proposal.fingerprint}): import problem`;
  if (session.blocked?.length) return `blocked: ${session.blocked.join('; ')}`;
  if (session.proposal.structure && session.proposal.structure.ok !== true) return `alignment structure check failed: ${(session.proposal.structure.problems ?? []).join('; ') || 'not ok'}`;
  if (session.proposal.completeness?.missing_in_alignment?.length) return `alignment is missing ayahs ${session.proposal.completeness.missing_in_alignment.join(', ')}`;
  return null;
}
/** Why one start fails validation (its proposed time), or null. */
export function startBlock(session, ayah) {
  const ms = proposedAt(session, ayah);
  if (ms == null) return 'no proposed start';
  if (!(ms >= 0 && ms < session.durationMs)) return `proposed start ${ms} ms is outside the recording (0-${session.durationMs} ms)`;
  const runs = session.proposal.completeness?.collapsed_runs ?? [];
  if (runs.some((run) => String(run).split(/[-,–]/).map(Number).filter(Number.isFinite).some((a, _, xs) => (xs.length === 2 ? ayah >= xs[0] && ayah <= xs[1] : a === ayah)))) return 'the aligner collapsed this ayah (alignment validation)';
  const keys = Object.keys(session.proposal.starts).map(Number).sort((a, b) => a - b);
  const i = keys.indexOf(ayah);
  if (i > 0 && !(ms > session.proposal.starts[keys[i - 1]])) return `proposed start is not after ayah ${keys[i - 1]}'s`;
  if (i >= 0 && i < keys.length - 1 && !(ms < session.proposal.starts[keys[i + 1]])) return `proposed start is not before ayah ${keys[i + 1]}'s`;
  if (session.proposal.endMs != null && !(ms < session.proposal.endMs)) return 'proposed start is not before the recitation end';
  return null;
}

/**
 * Every start of a recording under the policy:
 *   { ayah, tier, reason, decision: 'human-reviewed' | 'auto-accepted' (in the ledger and still valid) |
 *     'eligible' (can be accepted now) | 'manual' (high/medium) | 'blocked' (check/routine that failed a check) |
 *     'other' (an unknown classification), why }
 */
export function classify(task, session, state, ledgerEntries = []) {
  const recBlock = recordingBlock(task, session);
  const valid = effectiveAccepted(session, state, ledgerEntries);
  const o = openingOf(session);
  const vh = veryHighOf(session, state); // Phase 4.8.9: the very high risk detection runs before any acceptance
  const out = [];
  task.risk.forEach(([tier, reason], i) => {
    if (tier === 'n/a') return;
    const ayah = i + 1;
    const k = String(ayah);
    // Ayah 1 under the opening rule, unless very high risk evidence concerns ayah 1 itself (a per-ayah file).
    if (ayah === 1 && o.applies && !vh.starts.has(1)) {
      // Phase 4.8.8: the opening start is 0 by rule, a check only (a registry imported by older code may say otherwise).
      // Accepted at 0 unless a reviewer judged it otherwise or the whole recording is blocked; there is no proposed
      // time to validate (a manual-timing recording has one too). Its onset exceptions stay in the task's report.
      const base = { ayah, tier: 'check', reason, opening: true };
      if (humanReviewed(state, k)) return out.push({ ...base, decision: 'human-reviewed', why: 'accepted by a reviewer' });
      if (valid.has(k)) return out.push({ ...base, decision: 'auto-accepted', why: 'accepted automatically (ledger)', entry: valid.get(k) });
      const why = (session.proposal ? recBlock : null) ?? humanBlock(session, state, k, { opening: true }) ?? perAyahBlock(session, ayah, (x) => humanReviewed(state, x));
      return out.push({ ...base, decision: why ? 'blocked' : 'eligible', why: why ?? `opening rule ${OPENING_RULE.id}: plays from 0:00.000`, proposedMs: OPENING_RULE.startMs, onsetMs: o.onsetMs });
    }
    const base = { ayah, tier, reason };
    if (humanReviewed(state, k)) return out.push({ ...base, decision: 'human-reviewed', why: 'accepted by a reviewer' });
    const vhWhy = [vh.starts.get(ayah), ...vh.recording.map((x) => `whole recording: ${x}`)].filter(Boolean);
    if (tier === 'veryhigh' || vhWhy.length) return out.push({ ...base, tier: 'veryhigh', decision: 'manual', why: `very high risk: manual review required${vhWhy.length ? ` (${vhWhy.join('; ')})` : ''}` });
    if (POLICY.manual.includes(tier)) return out.push({ ...base, decision: 'manual', why: `${tier} risk: manual review required` });
    if (!POLICY.auto.includes(tier)) return out.push({ ...base, decision: 'other', why: `classification "${tier}" is not covered by the policy` });
    if (valid.has(k)) return out.push({ ...base, decision: 'auto-accepted', why: 'accepted automatically (ledger)', entry: valid.get(k) });
    const why = recBlock ?? humanBlock(session, state, k) ?? perAyahBlock(session, ayah, (x) => humanReviewed(state, x)) ?? startBlock(session, ayah);
    out.push({ ...base, decision: why ? 'blocked' : 'eligible', why: why ?? 'passes every check', proposedMs: proposedAt(session, ayah) });
  });
  return out;
}

/**
 * The ledger's acceptances that still apply (Map ayah -> entry): same proposal fingerprint and proposed time, a tier
 * the policy accepts, and no current rejection by a reviewer (a later human rejection always wins).
 */
export function effectiveAccepted(session, state, ledgerEntries) {
  const out = new Map();
  const o = openingOf(session);
  const vh = veryHighOf(session, state);
  for (const e of ledgerEntries) {
    if (e.type !== 'auto-accept' || !POLICY.auto.includes(e.tier)) continue;
    // Phase 4.8.9: an acceptance stops applying once its start carries very high risk evidence (the entry stays).
    if (vh.starts.has(e.ayah) || (vh.recording.length && !(e.ayah === 1 && o.applies))) continue;
    // Phase 4.8.10: ... or once its per-ayah file is an unresolved exception, or waits for a voice check.
    if (perAyahBlock(session, e.ayah, (x) => humanReviewed(state, x))) continue;
    // Phase 4.8.8: an opening acceptance is tied to the rule and the proposal it was made on (null: manual timing).
    if (e.rule === OPENING_RULE.id) { if (!(e.ayah === 1 && o.applies && e.proposedMs === OPENING_RULE.startMs && e.fingerprint === (session.proposal?.fingerprint ?? null))) continue; }
    else if (!session.proposal || e.fingerprint !== session.proposal.fingerprint || e.proposedMs !== proposedAt(session, e.ayah)) continue;
    const k = String(e.ayah);
    if (reviewers(state).some((r) => r.submitted?.[k]?.status === 'rejected')) continue;
    out.set(k, e);
  }
  return out;
}

/** The ledger entry for an eligible start. */
export const acceptanceEntry = (task, session, c, run) => ({
  type: 'auto-accept', policy: POLICY.id, by: BY, run, key: task.key, reciterId: task.reciterId, surah: task.surah, reviewType: task.reviewType,
  ayah: c.ayah, tier: c.tier, reason: c.reason, proposedMs: c.proposedMs, fingerprint: session.proposal?.fingerprint ?? null,
  ...(c.opening ? { rule: OPENING_RULE.id, onsetMs: c.onsetMs ?? null } : {}),
  packageSha256: session.provenance?.packageSha256 ?? null, audioSha256: session.sha256 ?? null,
  note: c.opening
    ? `automatic acceptance of the opening start at 0:00.000 under the opening rule (${OPENING_RULE.id}) and the risk policy (check); administrative only: not a human listening review, not a reviewer, not verification or publication`
    : `automatic acceptance of the proposed start under the risk policy (${c.tier}); administrative only: not a human listening review, not a reviewer, not verification or publication`,
});

/**
 * One pass over every recording: what would be (or was) accepted, and each reciter's state afterwards.
 *   tasks: inventory tasks; load(key) -> { session, state }; ledger: openLedger(); unavailable(task) -> bool (optional)
 * Returns { accept: [ledger entries to write], milestones: [...], reciters: { id: counts }, items: [per-start rows] }.
 */
export function plan({ tasks, load, ledger, run = new Date().toISOString(), unavailable = () => false, blocked = [] }) {
  const accept = [];
  const reciters = {};
  const items = [];
  for (const t of tasks) {
    const { session, state } = load(t.key);
    const r = (reciters[t.reciterId] ??= { reciterId: t.reciterId, reciterEn: t.reciterEn, recordings: 0, starts: 0, humanReviewed: 0, autoAcceptedBefore: 0, autoAcceptedNow: 0, veryHighRemaining: 0, mediumRemaining: 0, highRemaining: 0, blocked: 0, other: 0, disputed: 0, unavailableRecordings: 0, blockedRecordings: 0 });
    r.recordings++;
    if (unavailable(t)) { r.unavailableRecordings++; }
    for (const c of classify(t, session, state, ledger.forKey(t.key))) {
      r.starts++;
      if (c.decision === 'human-reviewed') r.humanReviewed++;
      else if (c.decision === 'auto-accepted') r.autoAcceptedBefore++;
      else if (c.decision === 'eligible') { r.autoAcceptedNow++; accept.push(acceptanceEntry(t, session, c, run)); }
      else if (c.decision === 'manual') r[c.tier === 'veryhigh' ? 'veryHighRemaining' : c.tier === 'high' ? 'highRemaining' : 'mediumRemaining']++;
      else if (c.decision === 'blocked') r.blocked++;
      else r.other++;
      items.push({ key: t.key, reciterId: t.reciterId, surah: t.surah, reviewType: t.reviewType, ayah: c.ayah, tier: c.tier, decision: c.decision, why: c.why, reason: c.reason, ...(c.opening ? { opening: true } : {}) });
    }
    // Disputed starts (both reviewers submitted, not agreed) are never accepted here; they stay open.
    for (const k of Object.keys(state.reviewers?.[1]?.submitted ?? {})) if (k !== 'end' && state.reviewers[2]?.submitted?.[k] && !humanReviewed(state, k)) r.disputed++;
  }
  for (const b of blocked) if (reciters[b.reciterId]) reciters[b.reciterId].blockedRecordings++;
  const milestones = [];
  for (const r of Object.values(reciters)) {
    r.remaining = r.veryHighRemaining + r.mediumRemaining + r.highRemaining + r.blocked + r.other;
    r.completed = r.remaining === 0 && r.unavailableRecordings === 0 && r.recordings > 0;
    r.status = r.completed ? 'Completed' : r.veryHighRemaining + r.highRemaining + r.mediumRemaining ? 'Manual review required' : 'Unresolved items (not auto-acceptable)';
    const last = ledger.milestone(r.reciterId);
    const counts = { recordings: r.recordings, starts: r.starts, humanReviewed: r.humanReviewed, autoAccepted: r.autoAcceptedBefore + r.autoAcceptedNow };
    if (r.completed && last?.type !== 'reciter-completed') milestones.push({ type: 'reciter-completed', policy: POLICY.id, by: BY, run, reciterId: r.reciterId, counts, note: 'every registered start is accepted by a reviewer or by the automatic policy; no high, medium or unresolved start remains (review completion only: not verification or publication)' });
    if (!r.completed && last?.type === 'reciter-completed') milestones.push({ type: 'reciter-reopened', policy: POLICY.id, by: BY, run, reciterId: r.reciterId, counts: { ...counts, remaining: r.remaining }, note: 'new or reopened starts need review' });
  }
  return { accept, milestones, reciters, items };
}

// ---------------------------------------------------------------- Phase 4.8.10: withdrawn acceptances

/**
 * Acceptances in the ledger that no longer apply (effectiveAccepted leaves them out: very high risk evidence, an
 * unresolved exception, an identity that waits for a person, or a person's rejection) and have no withdrawal record yet.
 * The acceptance itself is never touched: a withdrawal is a new, chained entry naming it (ref = its seq) and why.
 * A withdrawal is final: if the start becomes acceptable again, a NEW acceptance is written.
 */
export function planWithdrawals({ tasks, load, ledger, run = new Date().toISOString() }) {
  const done = new Set(ledger.entries().filter((e) => e.type === 'auto-accept-withdrawn').map((e) => e.ref));
  const out = [];
  for (const t of tasks) {
    const entries = ledger.forKey(t.key);
    if (!entries.length) continue;
    const { session, state } = load(t.key);
    const live = new Set([...effectiveAccepted(session, state, entries).values()].map((e) => e.seq));
    const vh = veryHighOf(session, state);
    for (const e of entries) {
      if (e.type !== 'auto-accept' || live.has(e.seq) || done.has(e.seq)) continue;
      // Only a withdrawal for a reason of this phase's kind: an older proposal (another fingerprint or time) is already
      // superseded by the package change and needs no record.
      if (session.proposal && (e.fingerprint !== (e.rule ? (session.proposal?.fingerprint ?? null) : session.proposal.fingerprint))) continue;
      const k = String(e.ayah);
      const why = humanReviewed(state, k) ? null
        : vh.starts.get(e.ayah) ? `very high risk: ${vh.starts.get(e.ayah)}`
        : vh.recording.length && !(e.ayah === 1 && openingOf(session).applies) ? `very high risk (whole recording): ${vh.recording.join('; ')}`
        : perAyahBlock(session, e.ayah, (x) => humanReviewed(state, x))
        ?? ((state.reviewers?.[1]?.submitted?.[k]?.status === 'rejected' || state.reviewers?.[2]?.submitted?.[k]?.status === 'rejected') ? 'rejected by a reviewer' : null);
      if (!why) continue;
      out.push({ type: 'auto-accept-withdrawn', ref: e.seq, policy: POLICY.id, by: BY, run, key: t.key, reciterId: t.reciterId, surah: t.surah, ayah: e.ayah, tier: e.tier, why, note: 'the automatic acceptance (seq ref) no longer applies; the acceptance stays in the ledger as history. Not a review.' });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Phase 4.8.8: opening amendments

const AMEND_BY = 'opening rule (not a reviewer)';
/** One amendment per recording and set of earlier values: a new value above 0 (a later review) gets its own entry. */
export const amendmentIdentity = (e) => (e.type === 'opening-amendment' ? `${e.key}|${crypto.createHash('sha256').update(JSON.stringify(e.previous)).digest('hex').slice(0, 16)}` : null);
export const openAmendments = (file, opts = {}) => openLedger(file, { ...opts, identity: amendmentIdentity });

/**
 * Every first timestamp above 0 that the opening rule overrides, per recording: the proposal's, each reviewer's saved
 * and submitted ayah-1 start, an agreed resolution, and earlier automatic acceptances. Nothing is rewritten: the old
 * values stay where they were recorded and are listed here as `previous`; the effective start is 0 (opening.mjs).
 * Returns { amend: [ledger entries], excluded: [...], applied, unchanged } (`amend` only for values not yet amended).
 */
export function planOpening({ tasks, load, ledger, amendments, run = new Date().toISOString() }) {
  const amend = [];
  const excluded = [];
  let applied = 0;
  let unchanged = 0;
  const known = new Set(amendments.entries().map(amendmentIdentity).filter(Boolean));
  for (const t of tasks) {
    const { session, state } = load(t.key);
    const o = openingOf(session);
    if (o.status === 'excluded') { excluded.push({ key: t.key, reciterId: t.reciterId, surah: t.surah, reason: o.reason }); continue; }
    if (!o.applies) continue;
    applied++;
    const previous = [];
    if (o.onsetMs > 0) previous.push({ source: 'proposal', ms: o.onsetMs, fingerprint: session.proposal?.fingerprint ?? null, proposalSource: session.proposal?.source ?? null });
    for (const r of [1, 2].map((k) => state.reviewers?.[k]).filter(Boolean)) {
      const sub = r.submitted?.['1'];
      if (sub?.ms > 0) previous.push({ source: 'reviewer-submission', role: r.role, name: r.name, ms: sub.ms, status: sub.status, submittedAt: sub.at, rev: sub.rev ?? 1 });
      const m = r.work?.markers?.['1'];
      if (m?.ms > 0 && !(sub && sub.ms === m.ms && sub.status === m.status)) previous.push({ source: 'reviewer-saved', role: r.role, name: r.name, ms: m.ms, status: m.status });
    }
    for (const x of (state.resolutions ?? []).filter((y) => y.ayah === 1 && y.ms > 0)) previous.push({ source: 'resolution', ms: x.ms, proposedBy: x.proposedBy, acceptedBy: x.acceptedBy, at: x.at });
    for (const e of ledger.forKey(t.key).filter((y) => y.ayah === 1 && y.proposedMs > 0)) previous.push({ source: 'auto-accept', seq: e.seq, proposedMs: e.proposedMs, at: e.at });
    if (!previous.length) { unchanged++; continue; }
    const entry = {
      type: 'opening-amendment', rule: OPENING_RULE.id, by: AMEND_BY, run, key: t.key, reciterId: t.reciterId, surah: t.surah, reviewType: t.reviewType,
      ayah: 1, effectiveMs: OPENING_RULE.startMs, previous, onsetMs: o.onsetMs, introMs: o.introMs, exceptions: o.exceptions,
      note: "the effective (playback) start of ayah 1 is 0:00.000 under the owner's opening rule; the earlier values stay where they were recorded (package, review log, ledger) and are kept as the ayah-1 onset for highlighting; not a review, not a reviewer, no approval",
    };
    if (!known.has(amendmentIdentity(entry))) amend.push(entry);
  }
  return { amend, excluded, applied, unchanged };
}

// ---------------------------------------------------------------- command line

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  const file = opt('--config');
  if (!file) throw new Error('usage: node review/dashboard/auto-accept.mjs --config <dashboard.config.json> [--apply] [--out report.json]');
  const { readConfig } = await import('./dashboard-lib.mjs');
  const { createLogStore } = await import('../manual/log-store.mjs');
  const { snapshot, verify } = await import('./backup.mjs');
  const cfg = readConfig(file);
  if (cfg.raw.readOnly) throw new Error(`read-only since ${cfg.raw.readOnly.since}: nothing is accepted here`);
  // The registry the dashboard last imported (it validated every package); never re-imported here.
  const inv = JSON.parse(fs.readFileSync(path.join(cfg.registryDir, 'inventory.json'), 'utf8'));
  const tasks = new Map(inv.tasks.map((t) => [t.key, t]));
  const store = createLogStore({ locate: (k) => tasks.get(k) ?? null });
  const ledger = openLedger(ledgerFile(cfg.dataDir));
  if (ledger.problem) throw new Error(ledger.problem);
  const amendments = openAmendments(amendmentFile(cfg.dataDir));
  if (amendments.problem) throw new Error(amendments.problem);
  const run = new Date().toISOString();
  const p = plan({ tasks: inv.tasks, load: (k) => store.load(k), ledger, run, blocked: inv.blocked });
  const op = planOpening({ tasks: inv.tasks, load: (k) => store.load(k), ledger, amendments, run });
  const report = { kind: 'auto-acceptance-report', policy: POLICY, opening: { rule: OPENING_RULE, ledger: amendments.file, applied: op.applied, unchanged: op.unchanged, toAmend: op.amend.length, excluded: op.excluded, amendments: op.amend }, run, inventoryCreatedAt: inv.createdAt, applied: false, ledger: ledger.file, reciters: p.reciters, toAccept: p.accept.length, milestones: p.milestones, items: p.items };
  if (a.includes('--apply') && (p.accept.length || p.milestones.length || op.amend.length)) {
    const b = snapshot(cfg, { label: 'pre-auto-accept' }); // verified file by file against its manifest, or it throws
    const v = verify(b.dir);
    if (v.length) throw new Error(`backup ${b.dir} did not verify: ${v.join('; ')}`);
    if (b.chainProblems.length) throw new Error(`a review log is already damaged; nothing applied: ${b.chainProblems.join('; ')}`);
    report.backup = b.dir;
    // Amendments first: they record what the opening rule overrides before any acceptance relies on it.
    report.opening.written = amendments.append(op.amend).length;
    const before = ledger.entries().length;
    const written = ledger.append([...p.accept, ...p.milestones]);
    report.applied = true; report.written = written.length; report.ledgerBefore = before; report.ledgerAfter = ledger.entries().length;
  }
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(report, null, 1));
  console.table(Object.values(p.reciters).map((r) => ({ reciter: r.reciterId, autoBefore: r.autoAcceptedBefore, autoNow: r.autoAcceptedNow, human: r.humanReviewed, veryHigh: r.veryHighRemaining, medium: r.mediumRemaining, high: r.highRemaining, blocked: r.blocked, other: r.other, status: r.status })));
  console.log(`opening rule ${OPENING_RULE.id}: ${op.applied} recordings play ayah 1 from 0:00.000 (${op.unchanged} already at 0), ${op.excluded.length} excluded, ${op.amend.length} amendment(s) ${report.applied ? 'written' : 'to write'}`);
  console.log(report.applied ? `applied: ${report.written} ledger entries written (backup ${report.backup})` : a.includes('--apply') ? 'nothing to apply: every eligible start is already in the ledger (no backup taken, nothing written)' : `dry run: ${p.accept.length} starts would be accepted, ${p.milestones.length} milestones (add --apply)`);
}
