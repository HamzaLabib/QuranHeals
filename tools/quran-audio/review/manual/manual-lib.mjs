// Manual ayah timing (Phase 4.6A): the rules shared by the review server (server.mjs), the exporter and the tests.
//
// A person places every ayah start by ear. Nothing here places, moves or approves a boundary:
//   - validation refuses invalid ayah numbers, times outside the audio and starts out of order;
//   - two reviewers work blind to each other (the server never shows one reviewer's markers to the other before both
//     have submitted); a reviewer can never be their own second reviewer;
//   - a start counts as verified only if both reviewers confirmed it within AGREE_MS of each other, or a disagreement
//     was resolved by one reviewer proposing a time and the OTHER accepting it after listening;
//   - repeated passages are documented by the reviewers. The app has one start per ayah, so only an ayah repeated in
//     place (both recitations inside that ayah's own span) keeps highlighting and seeking truthful; a return to
//     earlier ayahs leaves the recording unresolved (no timing is exported for it).
// State is never stored directly: it is rebuilt by replaying the recording's append-only, hash-chained event log
// (events.jsonl), so every change after a submission stays visible.
import crypto from 'node:crypto';

import { effectiveStartMs, openingOf, OPENING_RULE } from './opening.mjs';

/** Two placements of the same ayah start agree when they are this close (ms). */
export const AGREE_MS = 250;
export const MARKER_STATUS = ['confirmed', 'uncertain', 'rejected'];
export const FLAG_KINDS = ['repetition', 'missing-passage', 'background-noise', 'interruption', 'other'];
/** What a repetition means for one-start-per-ayah timing (a reviewer's judgement, recorded with the flag). */
export const REPETITION_IMPLICATIONS = {
  'within-one-ayah': 'the same ayah is recited again in place; both recitations lie inside its own span, so highlighting and seeking stay truthful',
  'returns-to-earlier-ayahs': 'the reciter goes back to earlier ayahs; one start per ayah would highlight the wrong ayah during the repeat',
  unsure: 'not yet decided',
};
/**
 * Whole-recording questions every reviewer answers by listening from beginning to end. The page names the session's
 * reciter in the identity question. Phase 4.8 added `playback` (the brief: content, identity AND playback must pass);
 * a "no" or "unsure" to it leaves the recording unresolved, never invalid.
 */
export const CHECKS = {
  identity: 'The voice is the named reciter throughout (as far as you can judge)',
  surah: 'It is this surah',
  complete: 'Every ayah of the surah is recited (no omission)',
  order: 'The ayahs are recited in the canonical order (repetitions documented as flags)',
  extraAudio: 'Any non-recitation audio (introduction, audience, announcer, music) is documented as a flag',
  playback: 'Seeking to each agreed start plays that ayah from its first sound: nothing cut off, no lag, no skips',
};
export const CHECK_ANSWERS = ['yes', 'no', 'unsure'];
/**
 * Phase 4.8.9: the per-start Yes / No questions of a manual review. They default to Yes; each answer is stored on the
 * reviewer's marker as { v: 'yes' | 'no', confirmed } (confirmed: chosen by the reviewer, not the default), so a default
 * Yes is never mistaken for a confirmation after listening. A No means the start is not right: it cannot be confirmed
 * (reject it). Answers of a submitted start are frozen with it (a change is a correction, with its reason). Work saved
 * before Phase 4.8.9 has no answers and is valid as it was.
 */
export const QUESTIONS = {
  complete: 'Is the ayah complete (nothing cut off at its beginning or end)?',
  order: 'Is the ayah in the correct order?',
  overlap: 'Is there no incorrect overlap with the neighbouring ayahs?',
  timestamp: 'Is the timestamp correct?',
  aligned: 'Is the recitation aligned correctly?',
};
export const ANSWERS = ['yes', 'no'];
const sameAnswers = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const ROLES = [1, 2];

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * Problems with one reviewer's placements (empty when valid). `full` also requires every ayah, the recitation end and
 * every check (a submission); a draft may be partial but never invalid.
 */
export function validateWork(session, work, { full = false } = {}) {
  const problems = [];
  const n = session.ayahCount;
  const dur = session.durationMs;
  const markers = work.markers ?? {};
  for (const [k, m] of Object.entries(markers)) {
    const a = Number(k);
    if (!Number.isInteger(a) || a < 1 || a > n) { problems.push(`ayah ${k} does not exist in surah ${session.surah} (1-${n})`); continue; }
    if (!Number.isFinite(m?.ms) || m.ms < 0 || m.ms >= dur) problems.push(`ayah ${a}: ${m?.ms} ms is outside the audio (0-${dur} ms)`);
    if (!MARKER_STATUS.includes(m?.status)) problems.push(`ayah ${a}: status ${m?.status} is not one of ${MARKER_STATUS.join(', ')}`);
    if (m?.answers !== undefined) {
      const ans = m.answers;
      if (!ans || typeof ans !== 'object') { problems.push(`ayah ${a}: answers must be an object`); continue; }
      for (const [q, x] of Object.entries(ans)) {
        if (!(q in QUESTIONS)) problems.push(`ayah ${a}: unknown question ${q}`);
        else if (!ANSWERS.includes(x?.v) || typeof x?.confirmed !== 'boolean') problems.push(`ayah ${a}: answer to "${QUESTIONS[q]}" must be yes or no, default or confirmed`);
        else if (x.v === 'no' && m.status === 'confirmed') problems.push(`ayah ${a}: answered No to "${QUESTIONS[q]}" but confirmed: reject it instead`);
      }
    }
  }
  const placed = Object.entries(markers).map(([k, m]) => [Number(k), m.ms]).filter(([a, ms]) => Number.isInteger(a) && Number.isFinite(ms)).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < placed.length; i++) {
    if (!(placed[i][1] > placed[i - 1][1])) problems.push(`ayah ${placed[i][0]} starts at ${placed[i][1]} ms, not after ayah ${placed[i - 1][0]} (${placed[i - 1][1]} ms)`);
  }
  const end = work.end;
  if (end) {
    if (!Number.isFinite(end.ms) || end.ms <= 0 || end.ms > dur) problems.push(`recitation end ${end.ms} ms is outside the audio (0-${dur} ms)`);
    else if (placed.length && !(end.ms > placed.at(-1)[1])) problems.push(`recitation end ${end.ms} ms is not after the last placed start (${placed.at(-1)[1]} ms)`);
    if (!MARKER_STATUS.includes(end.status)) problems.push(`recitation end: status ${end.status} is not one of ${MARKER_STATUS.join(', ')}`);
  }
  for (const [i, f] of (work.flags ?? []).entries()) {
    const at = `flag ${i + 1} (${f?.kind})`;
    if (!FLAG_KINDS.includes(f?.kind)) problems.push(`${at}: unknown kind`);
    if (!(Number.isFinite(f?.fromMs) && Number.isFinite(f?.toMs) && f.fromMs >= 0 && f.toMs > f.fromMs && f.toMs <= dur)) problems.push(`${at}: time range ${f?.fromMs}-${f?.toMs} ms is not inside the audio`);
    if (f?.ayahs) {
      const [a, b] = f.ayahs;
      if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= n)) problems.push(`${at}: ayahs ${f.ayahs.join('-')} are not a valid range of 1-${n}`);
    }
    if (f?.kind === 'repetition') {
      if (!f.ayahs) problems.push(`${at}: a repetition must name the repeated ayahs`);
      if (!(f.implication in REPETITION_IMPLICATIONS)) problems.push(`${at}: choose what the repetition means for timing`);
      else if (f.implication === 'within-one-ayah' && f.ayahs && f.ayahs[0] !== f.ayahs[1]) problems.push(`${at}: "within one ayah" cannot cover ayahs ${f.ayahs.join('-')}`);
    }
  }
  if (full) {
    const scope = scopeOf(session);
    for (const a of scope ?? Array.from({ length: n }, (_, i) => i + 1)) if (!markers[a]) problems.push(`ayah ${a}: no start placed`);
    if (!scope && !end) problems.push('the recitation end (end of the last ayah) is not placed');
    for (const k of requiredChecks(session)) if (!CHECK_ANSWERS.includes(work.checks?.[k])) problems.push(`check "${CHECKS[k]}" is not answered`);
  }
  return problems;
}

/**
 * Phase 4.8: a boundary check of a recording that is already in PRODUCTION covers only the starts listed in
 * `session.scope` (boundaries the source audit flagged for listening). Only those starts are placed and compared, no
 * recitation end, and only the playback check is asked; the result is a list of findings for the owner, never timing.
 */
export const scopeOf = (session) => (Array.isArray(session?.scope) && session.scope.length ? session.scope : null);
export const requiredChecks = (session) => (scopeOf(session) ? ['playback'] : Object.keys(CHECKS));

// ---------------------------------------------------------------- per-ayah submission (Phase 4.8.1)
//
// A reviewer may submit starts in batches (any ayahs, in any order) without finishing the surah. Each submitted
// start is frozen in `submitted` (a snapshot: time, judgement, note, when, revision); later changes are corrections
// with a reason (`revisions`), never silent edits. Blindness is per start: the other reviewer's time for a start is
// shown only once BOTH have submitted that start. A start changed after its other placement was shown can count only
// through a resolution (proposal + acceptance), never as automatic agreement. The recording is verified only after
// both reviewers have submitted everything, recitation end and whole-recording checks included (`submit`).

/** Every boundary a review covers, in order: the scope, or every ayah start and the recitation end. */
export const keysOf = (session) => (scopeOf(session) ? [...scopeOf(session)] : [...Array.from({ length: session.ayahCount }, (_, i) => i + 1), 'end']);
/** The judgements a reviewer may submit in a batch (an "uncertain" start must be judged first). */
export const SUBMITTABLE = ['confirmed', 'rejected'];
/**
 * Phase 4.8.4.1 bulk decisions over unsubmitted starts:
 *   accept-proposed  the automatic proposal is right (confirmed at the proposed time)
 *   reject-proposed  the automatic proposal is wrong (rejected, the proposed time kept; nothing invented)
 *   accept-edited    the reviewer's own adjusted times are right (confirmed at those times)
 * Only starts nobody has judged yet are eligible: an explicit judgement (confirmed, rejected, marked uncertain) and an
 * own edit are never overwritten by a proposal, and a submitted start changes only by a correction.
 */
export const BULK_ACTIONS = ['accept-proposed', 'reject-proposed', 'accept-edited'];
const proposedAt = (session, key) => { const p = session.proposal; if (!p) return null; const ms = String(key) === 'end' ? p.endMs : p.starts?.[key]; return Number.isFinite(ms) ? ms : null; };
/** Why a start cannot take a bulk action, or null when it can (the page shows the same reasons in its preview). */
export function bulkExclusion(session, mine, key, action) {
  key = String(key);
  if (mine.submitted?.[key]) return 'already submitted (change it with Correct)';
  const m = markerAt(mine.work, key);
  const pm = proposedAt(session, key);
  if (action === 'accept-edited') {
    if (!m) return 'no boundary of yours';
    if (pm != null && m.ms === pm) return 'not edited (the proposed time)';
    if (m.status === 'confirmed') return 'already confirmed';
    if (m.status === 'rejected') return 'rejected by you';
    if (m.markedUncertain) return 'marked uncertain by you';
    return null;
  }
  if (pm == null) return 'no proposed time';
  if (!(pm >= 0 && pm <= session.durationMs)) return 'proposed time outside the recording';
  if (m && m.ms !== pm) return 'your own edited boundary is kept';
  if (m?.status === 'confirmed') return action === 'accept-proposed' ? 'already confirmed' : 'confirmed by you';
  if (m?.status === 'rejected') return action === 'reject-proposed' ? 'already rejected' : 'rejected by you';
  if (m?.markedUncertain) return 'marked uncertain by you';
  return null;
}
const markerAt = (work, key) => (String(key) === 'end' ? work.end : work.markers[key]);
const label = (key) => (String(key) === 'end' ? 'the recitation end' : `ayah ${key}`);
const snapshot = (m, ev) => ({ ms: m.ms, status: m.status, note: m.note ?? '', ...(m.origin ? { origin: m.origin } : {}), ...(m.answers ? { answers: structuredClone(m.answers) } : {}), at: ev.at, rev: 1, ...(ev.seq ? { event: ev.seq } : {}) });
/** Both reviewers have submitted this start: its two placements may be shown and compared. */
export const revealed = (state, key) => !!(state.reviewers[1]?.submitted?.[key] && state.reviewers[2]?.submitted?.[key]);
function revise(state, mine, key, m, ev, reason) {
  const old = mine.submitted[key];
  const afterReveal = revealed(state, key);
  mine.revisions.push({ key, at: ev.at, reason, before: old, after: { ms: m.ms, status: m.status, note: m.note ?? '', ...(m.answers ? { answers: structuredClone(m.answers) } : {}) }, afterReveal });
  mine.submitted[key] = { ...snapshot(m, ev), rev: (old.rev ?? 1) + 1, ...(afterReveal || old.revisedAfterReveal ? { revisedAfterReveal: true } : {}) };
  const k = key === 'end' ? 'end' : Number(key);
  state.resolutions = state.resolutions.filter((x) => x.ayah !== k);
  state.proposals = state.proposals.filter((x) => x.ayah !== k);
  state.unresolvable = state.unresolvable.filter((x) => x.ayah !== k);
}

// ---------------------------------------------------------------- event log

/** The hash of an event: SHA-256 over the previous hash and the event without its own hash. */
export function eventHash(prev, event) {
  const { hash, ...rest } = event;
  return crypto.createHash('sha256').update(`${prev}\n${JSON.stringify(rest)}`).digest('hex');
}

/** Checks the chain; returns the index of the first broken event, or -1. */
export function verifyChain(events) {
  let prev = 'genesis';
  for (let i = 0; i < events.length; i++) {
    if (events[i].seq !== i + 1 || events[i].prev !== prev || events[i].hash !== eventHash(prev, events[i])) return i;
    prev = events[i].hash;
  }
  return -1;
}

/**
 * Applies one new event to the replayed state, or throws the reason it is refused. The same function rebuilds state
 * on load, so a refused event can never enter the log.
 */
export function applyEvent(session, state, ev) {
  const r = ev.reviewer?.trim();
  if (!r) throw new Error('every event needs a reviewer name');
  const role = ev.role;
  const mine = state.reviewers[role];
  switch (ev.type) {
    case 'join': {
      if (!ROLES.includes(role)) throw new Error('role must be 1 or 2');
      if (mine && !sameName(mine.name, r)) throw new Error(`Reviewer ${role} is already ${mine.name}`);
      const other = state.reviewers[role === 1 ? 2 : 1];
      if (other && sameName(other.name, r)) throw new Error(`${r} is Reviewer ${role === 1 ? 2 : 1}; nobody can be both reviewers of one recording`);
      if (role === 2 && !state.reviewers[1]) throw new Error('Reviewer 1 must start before Reviewer 2 joins');
      if (!mine) state.reviewers[role] = { name: r, role, joinedAt: ev.at, work: { markers: {}, end: null, flags: [], checks: {}, comments: '' }, submittedAt: null, amendments: [], submitted: {}, revisions: [] };
      return;
    }
    case 'draft':
    case 'amend': {
      if (!mine || !sameName(mine.name, r)) throw new Error(`${r} is not Reviewer ${role} of this recording`);
      if (ev.type === 'draft' && mine.submittedAt) throw new Error('already submitted: changes now are amendments, with a reason');
      if (ev.type === 'amend') {
        if (!mine.submittedAt) throw new Error('nothing submitted to amend');
        if (!ev.payload?.reason?.trim()) throw new Error('an amendment needs a reason');
      }
      const work = ev.payload.work;
      const problems = validateWork(session, work, { full: ev.type === 'amend' });
      if (problems.length) throw new Error(problems.join('; '));
      if (ev.type === 'draft') {
        // Phase 4.8.1: a submitted start is frozen; a draft may never change or drop it (that is a correction, with a reason).
        for (const [k, s] of Object.entries(mine.submitted)) {
          const m = markerAt(work, k);
          if (!m || m.ms !== s.ms || m.status !== s.status || !sameAnswers(m.answers, s.answers)) throw new Error(`${label(k)} was submitted: change it with a correction (and its reason), not a draft`);
        }
      }
      if (ev.type === 'amend') {
        mine.amendments.push({ at: ev.at, reason: ev.payload.reason, before: mine.work });
        // An amendment withdraws every resolution that involved a changed start: it must be agreed again.
        state.resolutions = state.resolutions.filter((x) => JSON.stringify(work.markers[x.ayah] ?? work.end) === JSON.stringify(mine.work.markers[x.ayah] ?? mine.work.end));
        // ...and every changed submitted start becomes a new revision (the earlier submission stays in the history).
        for (const k of keysOf(session).map(String)) {
          const s = mine.submitted[k];
          const m = markerAt(work, k);
          if (s && m && (m.ms !== s.ms || m.status !== s.status)) revise(state, mine, k, m, ev, ev.payload.reason);
        }
      }
      mine.work = work;
      return;
    }
    case 'submit-ayahs': {
      // Phase 4.8.1: a batch of starts the reviewer has judged; the rest stay pending. (No playback evidence is
      // required or recorded: Phase 4.8.4.1 removed the page's listening gate; the judgement is the reviewer's.)
      if (!mine || !sameName(mine.name, r)) throw new Error(`${r} is not Reviewer ${role} of this recording`);
      const keys = ev.payload?.keys;
      if (!Array.isArray(keys) || !keys.length) throw new Error('choose the ayahs to submit');
      const valid = new Set(keysOf(session).map(String));
      const seen = new Set();
      for (const key of keys.map(String)) {
        if (!valid.has(key)) throw new Error(`${label(key)} is not a start of this ${scopeOf(session) ? 'check' : 'recording'}`);
        if (seen.has(key)) throw new Error(`${label(key)} is listed twice`);
        seen.add(key);
        if (mine.submitted[key]) throw new Error(`${label(key)} is already submitted (${mine.submitted[key].at}): a change is a correction, with a reason`);
        const m = markerAt(mine.work, key);
        if (!m) throw new Error(`${label(key)}: no start placed`);
        if (!SUBMITTABLE.includes(m.status)) throw new Error(`${label(key)} is marked ${m.status}: judge it confirmed (or rejected) before submitting it`);
      }
      const problems = validateWork(session, mine.work);
      if (problems.length) throw new Error(problems.join('; '));
      for (const key of seen) mine.submitted[key] = snapshot(markerAt(mine.work, key), ev);
      return;
    }
    case 'bulk': {
      // Phase 4.8.4.1: one audited decision over many unsubmitted starts (the reviewer's judgement, never evidence of
      // listening). Each listed start is checked against the SAVED work and the session's proposal; any ineligible
      // start refuses the whole request, so nothing is applied twice and nothing is applied in part.
      if (!mine || !sameName(mine.name, r)) throw new Error(`${r} is not Reviewer ${role} of this recording`);
      if (mine.submittedAt) throw new Error('already submitted: changes now are amendments, with a reason');
      const action = ev.payload?.action;
      if (!BULK_ACTIONS.includes(action)) throw new Error(`unknown bulk action ${action}`);
      const keys = ev.payload?.keys;
      if (!Array.isArray(keys) || !keys.length) throw new Error('choose the ayahs');
      const valid = new Set(keysOf(session).map(String));
      const work = structuredClone(mine.work);
      const seen = new Set();
      for (const key of keys.map(String)) {
        if (!valid.has(key)) throw new Error(`${label(key)} is not a start of this ${scopeOf(session) ? 'check' : 'recording'}`);
        if (seen.has(key)) throw new Error(`${label(key)} is listed twice`);
        seen.add(key);
        const why = bulkExclusion(session, mine, key, action);
        if (why) throw new Error(`${label(key)}: ${why} (nothing was applied)`);
        const m = markerAt(work, key);
        const pm = proposedAt(session, key);
        const nm = action === 'accept-edited' ? { ...m, status: 'confirmed' } : { ms: pm, status: action === 'accept-proposed' ? 'confirmed' : 'rejected', note: m?.note ?? '', origin: 'proposal' };
        delete nm.markedUncertain;
        if (key === 'end') work.end = nm; else work.markers[key] = nm;
      }
      const problems = validateWork(session, work);
      if (problems.length) throw new Error(`${problems.join('; ')} (nothing was applied)`);
      mine.work = work;
      return;
    }
    case 'revise': {
      // Phase 4.8.1: a correction of one submitted start, with its reason; the earlier submission stays in the history.
      if (!mine || !sameName(mine.name, r)) throw new Error(`${r} is not Reviewer ${role} of this recording`);
      const key = String(ev.payload?.key);
      if (!mine.submitted[key]) throw new Error(`${label(key)} is not submitted: change it and save it, then submit it`);
      if (!ev.payload?.reason?.trim()) throw new Error('a correction needs a reason');
      const m = ev.payload?.marker;
      const work = structuredClone(mine.work);
      if (key === 'end') work.end = m; else work.markers[key] = m;
      const problems = validateWork(session, work, { full: !!mine.submittedAt });
      if (problems.length) throw new Error(problems.join('; '));
      if (m.ms === mine.submitted[key].ms && m.status === mine.submitted[key].status && sameAnswers(m.answers, mine.submitted[key].answers)) throw new Error(`${label(key)}: nothing changed`);
      revise(state, mine, key, m, ev, ev.payload.reason);
      mine.work = work;
      return;
    }
    case 'submit': {
      if (!mine || !sameName(mine.name, r)) throw new Error(`${r} is not Reviewer ${role} of this recording`);
      if (mine.submittedAt) throw new Error('already submitted');
      const problems = validateWork(session, mine.work, { full: true });
      if (problems.length) throw new Error(`cannot submit: ${problems.join('; ')}`);
      // Completion gate (also checked objectively, Phase 4.8.4): every submitted start must still be the saved one.
      for (const [k, s] of Object.entries(mine.submitted)) { const m = markerAt(mine.work, k); if (!m || m.ms !== s.ms || m.status !== s.status) throw new Error(`cannot submit: ${label(k)} differs from its submitted judgement`); }
      // The whole review: every start not yet submitted is submitted with it, and the recording-level checks.
      for (const key of keysOf(session).map(String)) if (!mine.submitted[key]) mine.submitted[key] = snapshot(markerAt(mine.work, key), ev);
      mine.submittedAt = ev.at;
      return;
    }
    case 'resolve-propose':
    case 'resolve-accept':
    case 'resolve-unresolvable': {
      if (!mine || !sameName(mine.name, r)) throw new Error(`${r} is not Reviewer ${role} of this recording`);
      const key = ev.payload?.ayah; // an ayah number, or 'end'
      if (!(key === 'end' || (Number.isInteger(key) && key >= 1 && key <= session.ayahCount))) throw new Error(`no such boundary: ${key}`);
      // Phase 4.8.1: per boundary, as soon as BOTH reviewers have submitted it (no need to wait for the whole surah).
      if (!revealed(state, String(key))) throw new Error(`both reviewers must submit ${label(String(key))} before a disagreement about it is resolved`);
      if (!ev.payload?.note?.trim()) throw new Error('a resolution needs a note saying what was heard');
      if (ev.type === 'resolve-propose') {
        const ms = ev.payload.ms;
        if (!Number.isFinite(ms) || ms < 0 || ms > session.durationMs) throw new Error(`${ms} ms is outside the audio`);
        state.proposals = state.proposals.filter((p) => p.ayah !== key);
        state.proposals.push({ ayah: key, ms, proposedBy: r, proposedRole: role, at: ev.at, note: ev.payload.note });
      } else if (ev.type === 'resolve-accept') {
        const p = state.proposals.find((x) => x.ayah === key);
        if (!p) throw new Error(`no proposal for ${key} to accept`);
        if (p.proposedRole === role) throw new Error('the other reviewer must accept a proposal (nobody confirms their own)');
        state.resolutions = state.resolutions.filter((x) => x.ayah !== key);
        state.resolutions.push({ ayah: key, ms: p.ms, proposedBy: p.proposedBy, acceptedBy: r, at: ev.at, proposalNote: p.note, acceptNote: ev.payload.note });
        state.proposals = state.proposals.filter((x) => x.ayah !== key);
      } else {
        state.unresolvable = state.unresolvable.filter((x) => x.ayah !== key);
        state.unresolvable.push({ ayah: key, by: r, at: ev.at, note: ev.payload.note });
      }
      return;
    }
    case 'comment':
      if (!ev.payload?.text?.trim()) throw new Error('empty comment');
      state.comments.push({ by: r, role: role ?? null, at: ev.at, text: ev.payload.text });
      return;
    default:
      throw new Error(`unknown event ${ev.type}`);
  }
}

export const emptyState = () => ({ reviewers: {}, proposals: [], resolutions: [], unresolvable: [], comments: [] });

/** Rebuilds state from a log (throws if the chain is broken or an event is invalid). */
export function replay(session, events) {
  const broken = verifyChain(events);
  if (broken >= 0) throw new Error(`event log broken at event ${broken + 1}: it was edited outside the tool`);
  const state = emptyState();
  for (const ev of events) applyEvent(session, state, ev);
  return state;
}

// ---------------------------------------------------------------- comparison and status

/** Per boundary (every ayah start and the recitation end): both placements, the difference and the outcome. */
export function compare(session, state) {
  if (!state.reviewers[1]?.submittedAt || !state.reviewers[2]?.submittedAt) return null;
  return compareKeys(session, state, keysOf(session));
}

/** Phase 4.8.1: the comparison of the starts BOTH reviewers have submitted so far (in order). */
export function partialComparison(session, state) {
  return compareKeys(session, state, keysOf(session).filter((k) => revealed(state, String(k))));
}

function compareKeys(session, state, keys) {
  const r1 = state.reviewers[1];
  const r2 = state.reviewers[2];
  const opening = openingOf(session);
  return keys.map((key) => {
    // The submitted snapshots (identical to the work for a whole submission; corrections update both).
    let a = r1.submitted?.[key] ?? markerAt(r1.work, key);
    let b = r2.submitted?.[key] ?? markerAt(r2.work, key);
    // Phase 4.8.8: the opening ayah's effective start is 0 (opening.mjs); what each reviewer placed is kept as placedMs.
    const isOpening = String(key) === '1' && opening.applies;
    if (isOpening) { a = { ...a, ms: OPENING_RULE.startMs, placedMs: a.ms }; b = { ...b, ms: OPENING_RULE.startMs, placedMs: b.ms }; }
    const delta = Math.round(b.ms - a.ms);
    const resolution = state.resolutions.find((x) => x.ayah === key) ?? null;
    const unresolvable = state.unresolvable.find((x) => x.ayah === key) ?? null;
    const afterReveal = !!(a.revisedAfterReveal || b.revisedAfterReveal);
    let outcome;
    let finalMs = null;
    if (unresolvable) outcome = 'unresolved';
    else if (resolution) { outcome = 'resolved'; finalMs = isOpening ? OPENING_RULE.startMs : resolution.ms; }
    else if (a.status === 'confirmed' && b.status === 'confirmed' && Math.abs(delta) <= AGREE_MS && !afterReveal) { outcome = 'agreed'; finalMs = a.ms; }
    else outcome = 'disputed';
    const why = outcome === 'disputed' ? [a.status !== 'confirmed' ? `Reviewer 1 marked it ${a.status}` : null, b.status !== 'confirmed' ? `Reviewer 2 marked it ${b.status}` : null, Math.abs(delta) > AGREE_MS ? `${Math.abs(delta)} ms apart (agreement needs ≤ ${AGREE_MS} ms)` : null, afterReveal ? 'changed after the other placement was shown: no longer independent, so it needs a proposal and acceptance' : null].filter(Boolean) : [];
    return { key, r1: a, r2: b, deltaMs: delta, outcome, finalMs, why, resolution, unresolvable, proposal: state.proposals.find((x) => x.ayah === key) ?? null, ...(isOpening ? { opening: OPENING_RULE.id } : {}) };
  });
}

/** Per-start progress of a recording (no times: safe to show to anyone). */
export function progress(session, state) {
  const keys = keysOf(session).map(String);
  const starts = keys.filter((k) => k !== 'end');
  const r1 = state.reviewers[1];
  const r2 = state.reviewers[2];
  const sub = (r, ks) => (r ? ks.filter((k) => r.submitted?.[k]).length : 0);
  const outcomes = Object.fromEntries((compare(session, state) ?? partialComparison(session, state)).map((c) => [String(c.key), c.outcome]));
  const n = (o) => starts.filter((k) => outcomes[k] === o).length;
  const verified = n('agreed') + n('resolved');
  return {
    starts: starts.length, hasEnd: keys.includes('end'),
    submitted1: sub(r1, starts), submitted2: sub(r2, starts), complete1: !!r1?.submittedAt, complete2: !!r2?.submittedAt,
    pending: starts.filter((k) => !r1?.submitted?.[k] && !r2?.submitted?.[k]).length,
    verified, disputed: n('disputed') + n('unresolved'), remaining: starts.length - verified, outcomes,
  };
}

/**
 * Phase 4.8.6: the dashboard's single-review workflow. An ayah start is REVIEWED (it leaves the pending queue) when a
 * reviewer's CURRENT submission of it is an accepted judgement ('confirmed', including after a correction), or when a
 * disagreement about it was formally resolved. Saved-but-unsubmitted, uncertain and rejected starts stay pending. Each
 * start counts once (unique keys of the replayed state, never events). This is review COMPLETION only: independent
 * verification (two reviewers agreeing or resolving), publication eligibility and publication stay separate.
 *   viewerRole: the asking reviewer's role. While that reviewer works blind (the two reviews not both complete), the
 *   other reviewer's judgements count only for starts both have submitted (already revealed): a blind reviewer never
 *   learns which of the other's starts were accepted. null: everyone's (no review of the viewer's own is at stake).
 */
export function reviewedStarts(session, state, viewerRole = null) {
  const starts = keysOf(session).map(String).filter((k) => k !== 'end');
  const both = !!(state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt);
  const blindTo = viewerRole && !both ? (viewerRole === 1 ? 2 : 1) : null;
  const resolved = new Set(state.resolutions.map((x) => String(x.ayah)));
  const accepted = (role, k) => state.reviewers[role]?.submitted?.[k]?.status === 'confirmed';
  const reviewed = starts.filter((k) => resolved.has(k) || [1, 2].some((role) => accepted(role, k) && (role !== blindTo || revealed(state, k))));
  const set = new Set(reviewed);
  return { starts: starts.length, reviewed, pending: starts.filter((k) => !set.has(k)), complete: reviewed.length === starts.length && starts.length > 0 };
}

/**
 * The recording's verification status, in the report's terms, with every reason. Rights are never cleared here:
 * `rights` comes from the session (the owner's decision is recorded outside the tool).
 *   awaiting-review   a reviewer has not submitted
 *   invalid           a reviewer heard the wrong surah, an omission or another voice
 *   unresolved        a repetition the one-start-per-ayah model cannot represent, or a boundary declared unresolvable
 *   disputed          a boundary neither agreed nor resolved
 *   verified          every boundary agreed or resolved by both reviewers, every check answered yes by both
 * then, for a verified recording: blocked-by-permissions until the session records cleared rights, else
 * approved-for-development-consideration (still not active: activation is a separate owner step).
 */
export function recordingStatus(session, state) {
  const reasons = [];
  const r1 = state.reviewers[1];
  const r2 = state.reviewers[2];
  const submitted = [r1, r2].filter((r) => r?.submittedAt).length;
  if (submitted < 2) {
    // Phase 4.8.1: partial submissions never verify a recording; it stays partially reviewed until both are complete.
    const p = progress(session, state);
    const any = Object.keys(r1?.submitted ?? {}).length + Object.keys(r2?.submitted ?? {}).length > 0;
    const of = (r, k, n, done) => (!r ? null : `Reviewer ${k} (${r.name}): ${done ? 'complete' : `${n} of ${p.starts} starts submitted${p.hasEnd && r.submitted?.end ? ' + end' : ''}, recording checks not submitted`}`);
    reasons.push(!r1 ? 'no Reviewer 1 yet' : any ? of(r1, 1, p.submitted1, p.complete1) : !r1.submittedAt ? `Reviewer 1 (${r1.name}) has not submitted` : null);
    reasons.push(!r2 ? 'no independent Reviewer 2 yet' : any ? of(r2, 2, p.submitted2, p.complete2) : !r2.submittedAt ? `Reviewer 2 (${r2.name}) has not submitted` : null);
    if (any) reasons.push(`${p.verified} of ${p.starts} starts independently verified so far, ${p.disputed} disputed`);
    return { status: any ? 'partially-reviewed' : 'awaiting-review', reasons: reasons.filter(Boolean), comparison: null, partial: any ? partialComparison(session, state) : [] };
  }
  for (const r of [r1, r2]) {
    for (const k of ['identity', 'surah', 'complete', 'order']) {
      if (r.work.checks[k] === 'no') reasons.push(`Reviewer ${r.role} (${r.name}) answered no: ${CHECKS[k]}`);
    }
  }
  if (reasons.length) return { status: 'invalid', reasons, comparison: compare(session, state) };
  const comparison = compare(session, state);
  for (const r of [r1, r2]) {
    for (const f of r.work.flags) {
      if (f.kind === 'repetition' && f.implication !== 'within-one-ayah') reasons.push(`Reviewer ${r.role}: repetition of ${f.ayahs.join('-')} (${f.implication}) — one start per ayah cannot represent it`);
      if (f.kind === 'missing-passage') reasons.push(`Reviewer ${r.role}: missing passage flagged (${f.note || 'no note'})`);
    }
    for (const k of requiredChecks(session)) if (r.work.checks[k] !== 'yes') reasons.push(`Reviewer ${r.role} answered ${r.work.checks[k]}: ${CHECKS[k]}`);
  }
  // A repetition inside one ayah is acceptable only if the agreed start of the next ayah lies after it.
  for (const r of [r1, r2]) {
    for (const f of r.work.flags.filter((x) => x.kind === 'repetition' && x.implication === 'within-one-ayah')) {
      const next = comparison.find((c) => c.key === f.ayahs[0] + 1) ?? comparison.find((c) => c.key === 'end');
      const start = comparison.find((c) => c.key === f.ayahs[0]);
      if (start?.finalMs != null && next?.finalMs != null && !(start.finalMs <= f.fromMs && f.toMs <= next.finalMs)) reasons.push(`Reviewer ${r.role}: the repetition of ayah ${f.ayahs[0]} (${f.fromMs}-${f.toMs} ms) is not inside that ayah's agreed span`);
    }
  }
  const unresolved = comparison.filter((c) => c.outcome === 'unresolved');
  if (unresolved.length) reasons.push(`declared unresolvable: ${unresolved.map((c) => c.key).join(', ')}`);
  if (reasons.length) return { status: 'unresolved', reasons, comparison };
  const disputed = comparison.filter((c) => c.outcome === 'disputed');
  if (disputed.length) return { status: 'disputed', reasons: disputed.map((c) => `${c.key === 'end' ? 'recitation end' : `ayah ${c.key}`}: ${c.why.join('; ')}`), comparison };
  const final = comparison.map((c) => c.finalMs);
  for (let i = 1; i < final.length; i++) if (!(final[i] > final[i - 1])) reasons.push(`agreed times out of order at ${comparison[i].key}`);
  if (reasons.length) return { status: 'disputed', reasons, comparison };
  if (scopeOf(session)) {
    // A production boundary check: verified when every listed start is agreed; what it found goes to the owner.
    const findings = productionFindings(session, comparison);
    return { status: 'boundaries-verified', reasons: findings.length ? findings : ['every checked production start agrees with the reviewers (within the agreement threshold)'], comparison, verified: true, production: true, findings };
  }
  if (session.rights?.cleared !== true) return { status: 'blocked-by-permissions', reasons: [session.rights?.reason ?? 'usage rights for this recording are not cleared'], comparison, verified: true };
  return { status: 'approved-for-development-consideration', reasons: ['verified by two independent reviewers; rights cleared; activation still needs the owner'], comparison, verified: true };
}

/** Where the agreed start of a checked production boundary differs from production by more than AGREE_MS. */
export function productionFindings(session, comparison) {
  const out = [];
  for (const c of comparison) {
    const prod = effectiveStartMs(session, c.key, session.proposal?.starts?.[c.key]);
    if (prod == null || c.finalMs == null) continue;
    const d = Math.round(c.finalMs - prod);
    if (Math.abs(d) > AGREE_MS) out.push(`ayah ${c.key}: the production start (${prod} ms) is ${Math.abs(d)} ms ${d > 0 ? 'early' : 'late'}; the reviewers agreed ${Math.round(c.finalMs)} ms`);
  }
  return out;
}

/**
 * Phase 4.8.8: where ayah 1's words begin (for highlighting only; playback of ayah 1 always starts at 0): the time both
 * reviewers placed for it when they agree (within AGREE_MS), else the proposal's first timestamp, else 0.
 * Returns { ms, source }; null when the opening rule does not apply.
 */
export function openingOnset(session, state) {
  const o = openingOf(session);
  if (!o.applies) return null;
  const c = state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt ? compare(session, state)?.find((x) => String(x.key) === '1') : null;
  const a = c?.r1?.placedMs, b = c?.r2?.placedMs;
  if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && Math.abs(a - b) <= AGREE_MS) return { ms: Math.round(a), source: 'both reviewers' };
  if (o.onsetMs > 0) return { ms: o.onsetMs, source: `automatic proposal (${session.proposal?.source ?? 'unknown'})` };
  return { ms: 0, source: 'none: ayah 1 is highlighted from the start' };
}

/** The verified timing ([startMs, endMs] per ayah), only for a two-reviewer verified recording; else null. */
export function finalTiming(session, state) {
  if (scopeOf(session)) return null; // a production boundary check yields findings, never timing
  const st = recordingStatus(session, state);
  if (!st.verified) return null;
  const f = st.comparison.map((c) => Math.round(c.finalMs));
  return f.slice(0, -1).map((start, k) => [start, f[k + 1]]);
}

/**
 * What one person may see. Before BOTH reviewers have submitted, each sees only their own work: the other's markers,
 * flags, checks and comments stay hidden (only the other's name and whether they submitted are shown), so the
 * second review is independent. Afterwards both see everything, with the comparison.
 */
export function viewFor(session, state, name) {
  const me = [1, 2].map((k) => state.reviewers[k]).find((r) => r && sameName(r.name, name)) ?? null;
  const both = !!(state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt);
  const reviewers = {};
  for (const k of [1, 2]) {
    const r = state.reviewers[k];
    if (!r) continue;
    // Which starts the other has submitted (never their times) is shown, so each knows what can be compared.
    reviewers[k] = both || r === me ? r : { name: r.name, role: r.role, joinedAt: r.joinedAt, submittedAt: r.submittedAt, submittedKeys: Object.keys(r.submitted ?? {}), hidden: 'hidden until both reviewers have submitted (each start is shown once both have submitted it)' };
  }
  // Per start: the two placements of every start BOTH have submitted (nothing else of the other's work).
  const shown = new Set(partialComparison(session, state).map((c) => c.key));
  const visible = (x) => both || shown.has(x.ayah);
  return {
    me: me ? me.role : null, reviewers, blind: !both,
    revealed: both ? [] : partialComparison(session, state),
    proposals: state.proposals.filter(visible), resolutions: state.resolutions.filter(visible), unresolvable: state.unresolvable.filter(visible),
    comments: both ? state.comments : state.comments.filter((c) => sameName(c.by, name)),
    status: recordingStatus(session, state), summary: summary(session, state), progress: progress(session, state),
    // Phase 4.8.6: single-review completion. Per-start keys only for the recording's own reviewers (from their point of
    // view) or once both reviews are complete; anyone else sees counts only.
    review: (() => { const r = reviewedStarts(session, state, me?.role ?? null); return { starts: r.starts, reviewedCount: r.reviewed.length, pendingCount: r.pending.length, complete: r.complete, reviewedKeys: me || both ? r.reviewed : null }; })(),
  };
}

/**
 * Phase 4.8.4: the objectively verifiable recording checks, computed by software from actual evidence. Each is
 * { id, label, result: 'yes' | 'no' | 'unknown', detail }: 'yes' only with evidence, 'no' only when a validation
 * found an error, 'unknown' (shown as Needs Review) when the evidence is missing or incomplete. None of them is a
 * listening judgment and none answers a human question. They use only the caller's own work, the session and the
 * log's integrity (a yes/no verdict), never another reviewer's placements.
 *   audio: { bytes, sha256, verifiedAt, how } evidence of the file served for review, from the server, or null.
 */
export function objectiveChecks(session, state, events, name, audio = null) {
  const me = [1, 2].map((k) => state.reviewers[k]).find((r) => r && sameName(r.name, name)) ?? null;
  const keys = keysOf(session).map(String);
  const out = [];
  const add = (id, label, result, detail) => out.push({ id, label, result, detail });
  const textOk = Array.isArray(session.ayahs) && session.ayahs.length === session.ayahCount && session.ayahs.every((a, i) => a.ayah === i + 1 && typeof a.text === 'string' && a.text.length > 0);
  add('text', 'The canonical Arabic text has every ayah of the surah', textOk ? 'yes' : 'no', textOk ? `${session.ayahCount} ayahs, ${session.textSource ? 'verbatim from the runtime text (checked at import)' : 'present'}` : `the session holds ${session.ayahs?.length ?? 0} of ${session.ayahCount} ayahs`);
  const ID = 'The recording is the reviewed file (size and SHA-256)';
  if (!audio) add('identity', ID, 'unknown', 'no evidence yet: the file is checked when the recording is prepared');
  else if (audio.problem) add('identity', ID, audio.network ? 'unknown' : 'no', audio.network ? `could not be checked: ${audio.problem}` : audio.problem);
  else if (audio.bytes !== session.bytes) add('identity', ID, 'no', `the file is ${audio.bytes} bytes; the recording under review is ${session.bytes} bytes`);
  else if (audio.sha256 && session.sha256) add('identity', ID, audio.sha256 === session.sha256 ? 'yes' : 'no', audio.sha256 === session.sha256 ? `${audio.bytes} bytes, SHA-256 ${audio.sha256.slice(0, 12)}… (${audio.how ?? 'checked'})` : `SHA-256 ${audio.sha256.slice(0, 12)}… is not the reviewed recording's ${session.sha256.slice(0, 12)}…`);
  else add('identity', ID, 'unknown', `the size matches (${audio.bytes} bytes)${audio.how ? ` (${audio.how})` : ''}, but no SHA-256 was ${session.sha256 ? 'computed in this check' : 'recorded for this recording'}`);
  if (!me) {
    for (const [id, label] of [['timings-complete', 'Every required start has your timestamp'], ['timings-valid', 'Your timestamps are finite, in order and inside the recording'], ['submission', 'Your submitted ayahs match your saved review']]) add(id, label, 'unknown', 'you are not a reviewer of this recording');
  } else {
    const placed = keys.filter((k) => markerAt(me.work, k));
    add('timings-complete', 'Every required start has your timestamp', placed.length === keys.length ? 'yes' : 'unknown', `${placed.length} of ${keys.length} placed${scopeOf(session) ? '' : ' (the recitation end included)'}`);
    const problems = validateWork(session, me.work);
    add('timings-valid', 'Your timestamps are finite, in order and inside the recording', !placed.length ? 'unknown' : problems.length ? 'no' : 'yes', !placed.length ? 'nothing placed yet' : problems.length ? problems.slice(0, 3).join('; ') : `${placed.length} timestamps checked: no overlap, all inside 0-${session.durationMs} ms`);
    const sub = Object.entries(me.submitted ?? {});
    const bad = sub.filter(([k, s]) => { const m = markerAt(me.work, k); return !m || m.ms !== s.ms || m.status !== s.status || !keys.includes(k); });
    add('submission', 'Your submitted ayahs match your saved review', !sub.length ? 'unknown' : bad.length ? 'no' : 'yes', !sub.length ? 'nothing submitted yet' : bad.length ? `${bad.length} submitted start(s) differ from the saved work: ${bad.map(([k]) => k).join(', ')}` : `${sub.length} submitted, each identical to the saved work`);
  }
  const o = openingOf(session);
  if (o.status !== 'out-of-scope') add('opening', 'The opening ayah plays from 0:00.000', o.applies ? 'yes' : 'unknown', o.applies ? `${OPENING_RULE.id}: ayah 1 starts at 0:00.000 for playback${o.onsetMs > 0 ? `; its recitation is heard from ${(o.onsetMs / 1000).toFixed(3)} s (kept for highlighting)` : ''}` : `${o.reason}: the rule is not applied (reported as an exception)`);
  const broken = events.length ? verifyChain(events) : -2;
  add('audit', 'The audit history of this review is intact (hash chain)', broken === -2 ? 'unknown' : broken === -1 ? 'yes' : 'no', broken === -2 ? 'no review event yet' : broken === -1 ? `${events.length} events, every hash verified` : `the chain breaks at event ${broken + 1}`);
  return out;
}

/** Counts for the summary bar. */
export function summary(session, state) {
  const c = compare(session, state);
  if (!c) {
    const p = partialComparison(session, state);
    const n = (o) => p.filter((x) => x.outcome === o).length;
    return { agreed: n('agreed'), resolved: n('resolved'), disputed: n('disputed'), unresolved: n('unresolved'), total: keysOf(session).length, compared: false, comparedSoFar: p.length };
  }
  const n = (o) => c.filter((x) => x.outcome === o).length;
  return { agreed: n('agreed'), resolved: n('resolved'), disputed: n('disputed'), unresolved: n('unresolved'), total: c.length, compared: true };
}
