// The dashboard's views (Phase 4.8.2: shared by the local server and the cloud server): per-recording statuses,
// rows, totals and the Needs Attention list. Nothing here writes; data comes from the caller:
//   tasks()      Map key -> task (inventory rows)       inventory()  { blocked, superseded, problems, sources, totals }
//   load(key)    { session, state, events } (synchronous, from the caller's cache)
//   hasLog(t)    whether the recording has any review event
//   audioInfo(t) { local, how, problem, vbr } for the row
// Blindness is that of manual-lib's viewFor: rows carry counts only, never another reviewer's times.
//   autoAccepted(t, state)  Phase 4.8.7 (optional): the starts accepted by the automatic risk policy that still apply
//                (a Set of ayah keys; auto-accept.mjs effectiveAccepted). They leave the pending queue but are never
//                counted as reviewed by a person. Without it (the cloud server) nothing is accepted automatically.
//   ownerOverridden(t, state)  (optional, owner-override.mjs): starts the owner took out of the queue UNVERIFIED (a Set
//                of ayah keys). Counted apart (ownerOverride), never as reviewed or accepted automatically. Without it
//                (the cloud server) there are none.
//   milestone(reciterId)    Phase 4.8.7 (optional): the ledger's last reciter-completed / reciter-reopened entry.
//   exceptionWhy(t, state)  Phase 4.8.9 (optional): Map ayah -> why the policy did not accept a start (auto-accept.mjs
//                classify). Very high risk starts and the exceptions the policy could not accept form the queue.
import { emptyState, reviewedStarts, viewFor } from '../manual/manual-lib.mjs';
import { effectiveStartMs, openingOf } from '../manual/opening.mjs';
import { humanVeryHigh } from '../manual/very-high.mjs';
import { TIERS } from './dashboard-lib.mjs';

export function makeViews({ tasks: tasksOf, inventory, load, hasLog, audioInfo, now = () => new Date().toISOString(), autoAccepted = () => null, ownerOverridden = () => null, milestone = () => null, exceptionWhy = () => null }) {
  const store = { load };
  /** The ayah starts a task reviews (its scope, or every ayah: ayah 1 included); 'n/a' marks starts outside a check. */
  const startKeysOf = (t) => t.risk.map(([tier], i) => (tier === 'n/a' ? null : String(i + 1))).filter(Boolean);
  /** Phase 4.8.6: a recording that cannot be reviewed here (no reachable audio) is reported apart, never as pending work. */
  const unavailableOf = (t, audio) => audio?.policy === 'unavailable' || audio?.unavailable === true || (!audio?.local && !/^https:\/\//.test(t.url ?? ''));
  const STAGES = { pending: 'human review pending', partial: 'partially reviewed', first: 'first review completed', second: 'second review completed (not verified)', verified: 'technical verification completed' };
  /** Phase 4.8.9: the starts that are very high risk now (the registry's tier, or a reviewer's whole-recording finding). */
  function veryHighKeys(t, state) {
    const human = state ? humanVeryHigh(state) : [];
    const opening = human.length ? openingOf(store.load(t.key).session).applies : false;
    return { keys: new Set(t.risk.map(([tier], i) => (tier === 'veryhigh' || (human.length && tier !== 'n/a' && !(i === 0 && opening)) ? String(i + 1) : null)).filter(Boolean)), human };
  }
  /** The distinct automatic very high risk reasons of a task, per ayah (for the top of the dashboard). */
  function veryHighReasons(t) {
    const by = new Map();
    t.risk.forEach(([tier, why], i) => { if (tier !== 'veryhigh') return; const r = why.replace(/^very high risk: /, '').replace(/ \(was [a-z]+: .*\)$/, ''); if (!by.has(r)) by.set(r, []); by.get(r).push(i + 1); });
    return [...by].map(([r, ayahs]) => (r.startsWith('whole recording: ') ? r : `ayah ${ayahs.join(', ')}: ${r}`));
  }
  function summarize(t, name) {
    const keys = startKeysOf(t);
    const logged = hasLog(t);
    // Phase 4.8.7: starts accepted automatically (never a person's review) leave the queue too.
    const auto = autoAccepted(t, logged ? store.load(t.key).state : emptyState()) ?? new Set();
    const own = new Set([...(ownerOverridden(t, logged ? store.load(t.key).state : emptyState()) ?? [])].filter((k) => !auto.has(k)));
    const open = keys.filter((k) => !auto.has(k) && !own.has(k));
    const vh = veryHighKeys(t, logged ? store.load(t.key).state : null);
    const base = { veryHighKeys: vh.keys, veryHighFindings: vh.human, stage: STAGES.pending, status: 'awaiting-review', reasons: [], reviewers: [], mine: null, verifiedStarts: 0, outcomes: null, events: 0, activity: 'pending', pendingKeys: open, autoKeys: keys.filter((k) => auto.has(k)), ownerKeys: keys.filter((k) => own.has(k)), reviewComplete: keys.length > 0 && !open.length,
      progress: { starts: t.counts.starts, pending: t.counts.starts, reviewed: 0, autoAccepted: keys.filter((k) => auto.has(k)).length, ownerOverride: keys.filter((k) => own.has(k)).length, toReview: open.length, submitted1: 0, submitted2: 0, verified: 0, disputed: 0, remaining: t.counts.starts, savedMine: 0 } };
    if (!logged) return base;
    const { session, state, events } = store.load(t.key);
    const v = viewFor(session, state, name);
    const st = v.status;
    const both = !!(state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt);
    const me = v.me ? state.reviewers[v.me] : null;
    const out = {
      ...base, status: st.status, reasons: st.reasons, events: events.length,
      // Counts only (never times): how many starts each reviewer has submitted.
      reviewers: [1, 2].map((k) => state.reviewers[k]).filter(Boolean).map((r) => ({ role: r.role, name: r.name, submitted: !!r.submittedAt, submittedStarts: Object.keys(r.submitted ?? {}).filter((k) => k !== 'end').length })),
      mine: null,
    };
    const p = v.progress;
    const mySub = me?.submitted ?? {};
    const startKeys = new Set(Object.keys(t.risk).map((i) => String(Number(i) + 1)));
    if (me) {
      const placed = Object.keys(me.work.markers).filter((k) => startKeys.has(k));
      out.mine = { role: me.role, submitted: !!me.submittedAt, placed: placed.length, confirmed: placed.filter((k) => me.work.markers[k].status === 'confirmed').length,
        submittedStarts: Object.keys(mySub).filter((k) => k !== 'end').length, saved: placed.filter((k) => !mySub[k]).length, end: !!me.work.end };
      out.myMarkers = Object.fromEntries(Object.entries(me.work.markers).map(([a, m]) => [a, mySub[a] ? 'submitted' : m.status]));
    }
    const o = {};
    for (const [k, x] of Object.entries(p.outcomes)) if (k !== 'end') o[k] = x;
    out.outcomes = Object.keys(o).length ? o : null;
    out.verifiedStarts = p.verified;
    // Phase 4.8.6: one accepted submission is enough to leave the queue (from this viewer's blind-safe point of view).
    const rs = reviewedStarts(session, state, v.me);
    out.pendingKeys = rs.pending.filter((k) => !auto.has(k) && !own.has(k));
    out.ownerKeys = rs.pending.filter((k) => own.has(k));
    out.autoKeys = rs.pending.filter((k) => auto.has(k));
    out.reviewComplete = rs.starts > 0 && !out.pendingKeys.length;
    out.progress = { starts: p.starts, pending: p.pending, reviewed: rs.reviewed.length, autoAccepted: out.autoKeys.length, ownerOverride: out.ownerKeys.length, toReview: out.pendingKeys.length, submitted1: p.submitted1, submitted2: p.submitted2, verified: p.verified, disputed: p.disputed, remaining: p.remaining, savedMine: out.mine?.saved ?? 0 };
    const anySub = p.submitted1 + p.submitted2 > 0 || [1, 2].some((k) => state.reviewers[k]?.submitted?.end);
    out.stage = st.verified ? STAGES.verified : both ? STAGES.second : state.reviewers[1]?.submittedAt ? STAGES.first : anySub ? STAGES.partial : STAGES.pending;
    const placedAny = [1, 2].some((k) => Object.keys(state.reviewers[k]?.work.markers ?? {}).length);
    out.activity = st.verified ? 'verified' : p.disputed ? 'disputed' : p.submitted1 === p.starts && p.submitted2 === p.starts ? 'submitted' : anySub || placedAny ? 'in progress' : 'pending';
    return out;
  }
  function row(t, name) {
    const s = summarize(t, name);
    const { myMarkers, pendingKeys, autoKeys, ownerKeys, veryHighKeys: vhKeys, ...rest } = s;
    // Phase 4.8.6: a start is open until it is reviewed (one accepted submission) or accepted automatically.
    const pend = new Set(pendingKeys);
    // Phase 4.8.9: very high risk starts need a person; every other open start is an exception the policy could not
    // accept (blocked, rejected, uncertain, edited, manual timing...), counted by its tier.
    const veryHighOpen = [...vhKeys].filter((k) => pend.has(k)).length;
    const openOf = (want) => t.risk.filter(([tier], i) => want(tier) && pend.has(String(i + 1)) && !vhKeys.has(String(i + 1))).length;
    const highOpen = openOf((x) => x === 'high');
    const mediumOpen = openOf((x) => x === 'medium');
    const otherOpen = openOf((x) => x !== 'high' && x !== 'medium' && x !== 'n/a' && x !== 'veryhigh');
    const audio = audioInfo(t);
    const unavailable = unavailableOf(t, audio);
    const reviewState = s.stage === STAGES.verified ? 'independently verified' : s.reviewComplete ? (s.progress.autoAccepted ? (s.progress.reviewed ? 'review complete (one reviewer + automatic)' : 'complete (automatic acceptance)') : 'review complete (one reviewer)') : s.progress.reviewed || s.progress.autoAccepted ? 'partially reviewed' : 'pending';
    const reviewStateShown = s.progress.ownerOverride ? `${reviewState}; ${s.progress.ownerOverride} by owner override (unverified)` : reviewState;
    return {
      key: t.key, reviewType: t.reviewType, reciterId: t.reciterId, reciterEn: t.reciterEn, reciterAr: t.reciterAr, surah: t.surah, surahEn: t.surahEn, surahAr: t.surahAr,
      ayahCount: t.ayahCount, durationMs: t.durationMs, url: t.url, provider: t.provider, phase: t.phase, sourceId: t.sourceId, group: t.group, note: t.note,
      priority: t.priority, counts: t.counts, opening: t.opening ?? null, veryHighOpen, veryHighTotal: vhKeys.size, exceptionsOpen: highOpen + mediumOpen + otherOpen, highOpen, mediumOpen, otherOpen, concerns: t.concerns, playbackBlocked: t.playbackBlocked, synthetic: t.synthetic,
      rights: t.rights.cleared ? 'rights cleared' : 'rights pending', rightsReason: t.rights.reason,
      pipeline: t.reviewType === 'manual-timing' ? 'manual timing required' : t.reviewType === 'synthetic-practice' ? 'synthetic practice' : t.reviewType === 'production-boundary-check' ? 'in production: boundary check' : 'alignment completed',
      approvedForDevelopment: s.stage === STAGES.verified && t.rights.cleared === true,
      activeInDevelopment: t.activeInDevelopment ? 'active in development builds (measured timing, not yet listening-verified)' : 'not active',
      audio, unavailable, reviewState: reviewStateShown, highTotal: t.counts.high ?? 0,
      ...rest,
    };
  }
  function dashboard(name) {
    const rows = [...tasksOf().values()].map((t) => row(t, name));
    const verified = rows.filter((r) => r.stage === STAGES.verified);
    const actionable = rows.filter((r) => !r.unavailable);
    let disputed = 0;
    for (const r of rows) if (r.outcomes) disputed += Object.values(r.outcomes).filter((o) => o === 'disputed' || o === 'unresolved').length;
    const sum = (list, f) => list.reduce((a, r) => a + f(r), 0);
    // Phase 4.8.6: per reciter, the starts still awaiting their first accepted submission (0 stays listed).
    const byReciter = {};
    for (const r of actionable) { const x = (byReciter[r.reciterId] ??= { reciterId: r.reciterId, reciterEn: r.reciterEn, reciterAr: r.reciterAr, recordings: 0, toReview: 0, reviewed: 0, recordingsPending: 0, autoAccepted: 0, ownerOverride: 0, veryHighOpen: 0, exceptionsOpen: 0, highOpen: 0, mediumOpen: 0, otherOpen: 0, disputed: 0, unavailable: 0, veryHighFindings: 0 }); x.recordings++; x.toReview += r.progress.toReview; x.reviewed += r.progress.reviewed; x.autoAccepted += r.progress.autoAccepted ?? 0; x.ownerOverride += r.progress.ownerOverride ?? 0; x.veryHighOpen += r.veryHighOpen; x.exceptionsOpen += r.exceptionsOpen; x.highOpen += r.highOpen; x.mediumOpen += r.mediumOpen; x.otherOpen += r.otherOpen; x.disputed += r.progress.disputed; if (r.veryHighFindings?.length) x.veryHighFindings++; if (r.progress.toReview) x.recordingsPending++; }
    // Phase 4.8.7: Completed = every start of every reviewable recording accepted (by a person or the automatic policy),
    // nothing disputed and no registered recording without reachable audio. Derived from the logs and the ledger on
    // every request, so it survives restarts; the ledger also records when it was reached. Blocked recordings are
    // listed beside it (not reviewable here).
    for (const r of rows.filter((x) => x.unavailable)) if (byReciter[r.reciterId]) byReciter[r.reciterId].unavailable++;
    for (const x of Object.values(byReciter)) {
      x.blockedRecordings = inventory().blocked.filter((b) => b.reciterId === x.reciterId).length;
      x.completed = x.toReview === 0 && x.disputed === 0 && x.unavailable === 0;
      // Phase 4.8.9: only very high risk starts (and disputes) are manual review; anything else open is an exception.
      // An owner override is not a review: such a reciter is complete only with that said (and no completion milestone).
      x.status = x.completed ? (x.ownerOverride ? 'completed with owner override (unverified)' : 'completed') : x.veryHighOpen || x.disputed ? 'manual review required' : 'unresolved exceptions';
      const m = milestone(x.reciterId);
      x.completedAt = x.completed && m?.type === 'reciter-completed' ? m.at : null;
    }
    return {
      createdAt: now(), inventoryCreatedAt: inventory().createdAt,
      reciters: Object.values(byReciter).sort((a, b) => (b.toReview > 0) - (a.toReview > 0) || a.reciterEn.localeCompare(b.reciterEn)),
      metrics: {
        // Phase 4.8.6 definitions (single-review workflow): see docs/audio/single-review-workflow-phase-4-8-6.
        recordingsAwaiting: actionable.filter((r) => r.progress.toReview > 0).length, startsAwaiting: sum(actionable, (r) => r.progress.toReview), highAwaiting: sum(actionable, (r) => r.highOpen),
        veryHighAwaiting: sum(actionable, (r) => r.veryHighOpen), veryHighTotal: sum(rows, (r) => r.veryHighTotal), recordingsVeryHigh: rows.filter((r) => r.veryHighOpen > 0).length, exceptionsAwaiting: sum(actionable, (r) => r.exceptionsOpen),
        veryHighFindings: rows.filter((r) => r.veryHighFindings?.length).length,
        mediumAwaiting: sum(actionable, (r) => r.mediumOpen), otherAwaiting: sum(actionable, (r) => r.otherOpen), startsAutoAccepted: sum(rows, (r) => r.progress.autoAccepted ?? 0), startsOwnerOverride: sum(rows, (r) => r.progress.ownerOverride ?? 0),
        recitersCompleted: Object.values(byReciter).filter((x) => x.completed).length, reciters: Object.keys(byReciter).length,
        startsReviewed: sum(rows, (r) => r.progress.reviewed), startsTotal: sum(actionable, (r) => r.progress.starts), highTotal: sum(actionable, (r) => r.highTotal),
        recordingsReviewComplete: rows.filter((r) => r.reviewComplete).length, recordingsCompletedSingle: rows.filter((r) => r.reviewComplete && r.stage !== STAGES.verified).length,
        recordingsCompletedAutomatic: rows.filter((r) => r.reviewComplete && r.progress.autoAccepted > 0).length,
        unavailableRecordings: rows.length - actionable.length, startsUnavailable: sum(rows.filter((r) => r.unavailable), (r) => r.progress.toReview),
        manualTiming: rows.filter((r) => r.reviewType === 'manual-timing').length, withProposals: rows.filter((r) => r.reviewType === 'alignment-verification' || r.reviewType === 'development-verification').length, productionChecks: rows.filter((r) => r.reviewType === 'production-boundary-check').length,
        reviewer1Completed: rows.filter((r) => r.reviewers.some((x) => x.role === 1 && x.submitted)).length, reviewer2Completed: rows.filter((r) => r.reviewers.some((x) => x.role === 2 && x.submitted)).length,
        partiallyReviewed: rows.filter((r) => r.progress.reviewed > 0 && r.progress.toReview > 0).length, startsSubmitted1: rows.reduce((a, r) => a + r.progress.submitted1, 0), startsSubmitted2: rows.reduce((a, r) => a + r.progress.submitted2, 0), startsVerified: rows.reduce((a, r) => a + r.progress.verified, 0),
        disputedBoundaries: disputed, verified: verified.length, recordingsWithReviewActivity: rows.filter((r) => r.events > 0).length,
        blocked: inventory().blocked.length, superseded: inventory().superseded.length, importProblems: inventory().problems.length, recordings: rows.length,
      },
      // Per-ayah recordings (per-ayah/): every ayah scanned automatically; only the high-risk ones (very high risk
      // starts) wait for a person. Low risk = no automated reason to listen (accepted automatically, never a review).
      perAyah: Object.values(rows.filter((r) => r.reviewType === 'per-ayah-verification').reduce((acc, r) => {
        // high: the very high risk starts (manual); exceptions: open starts the policy could not accept.
        const x = (acc[r.reciterId] ??= { reciterId: r.reciterId, reciterEn: r.reciterEn, reciterAr: r.reciterAr, recordings: 0, scanned: 0, low: 0, high: 0, reviewed: 0, unresolved: 0, veryHighOpen: 0, exceptions: 0, autoAccepted: 0, ownerOverride: 0, byTier: {}, unavailable: 0 });
        x.recordings++; x.scanned += r.progress.starts; x.high += r.veryHighTotal; x.low += r.progress.starts - r.veryHighTotal;
        x.veryHighOpen += r.veryHighOpen; x.exceptions += r.exceptionsOpen; x.unresolved += r.veryHighOpen + r.exceptionsOpen;
        x.reviewed += r.progress.reviewed ?? 0; x.autoAccepted += r.progress.autoAccepted ?? 0; x.ownerOverride += r.progress.ownerOverride ?? 0; if (r.unavailable) x.unavailable++;
        for (const [t] of tasksOf().get(r.key)?.risk ?? []) x.byTier[t] = (x.byTier[t] ?? 0) + 1;
        return acc;
      }, {})),
      // Phase 4.8.9: whole-recording very high risk findings, for the top of the dashboard (reasons, never times).
      veryHighRecordings: rows.filter((r) => r.veryHighOpen || r.veryHighFindings?.length).map((r) => ({ key: r.key, reciterEn: r.reciterEn, surah: r.surah, surahEn: r.surahEn, open: r.veryHighOpen, total: r.veryHighTotal, findings: [...(r.veryHighFindings ?? []), ...veryHighReasons(tasksOf().get(r.key))], reviewState: r.reviewState })).sort((a, b) => b.open - a.open || a.key.localeCompare(b.key)),
      totals: inventory().totals, rows, blocked: inventory().blocked, problems: inventory().problems, sources: inventory().sources,
    };
  }
  function attention(q) {
    // Phase 4.8.9: the default queue is what still needs a person: disputed, very high risk, and the exceptions the
    // automatic policy could not accept (with the reason). Every tier stays available under Reviewed / All.
    const tiers = new Set((q.get('tiers') ?? 'disputed,veryhigh,exception').split(','));
    const name = q.get('name') ?? '';
    const f = { reciter: q.get('reciter'), type: q.get('type'), phase: q.get('phase'), surah: q.get('surah') ? Number(q.get('surah')) : null, key: q.get('key') };
    const todo = q.get('todo') === '1';
    const show = ['pending', 'reviewed', 'all'].includes(q.get('show')) ? q.get('show') : 'pending'; // Phase 4.8.6
    const rows = [];
    for (const t of tasksOf().values()) {
      if ((f.reciter && t.reciterId !== f.reciter) || (f.type && t.reviewType !== f.type) || (f.phase && t.phase !== f.phase) || (f.surah && t.surah !== f.surah) || (f.key && t.key !== f.key)) continue;
      const s = summarize(t, name);
      const pend = new Set(s.pendingKeys);
      const autoSet = new Set(s.autoKeys ?? []);
      const ownSet = new Set(s.ownerKeys ?? []);
      const vhSet = s.veryHighKeys;
      let why = null; // computed only when an exception is listed
      const whyOf = (a) => { if (why === null) why = exceptionWhy(t, hasLog(t) ? store.load(t.key).state : emptyState()) ?? new Map(); return why.get(a) ?? 'not accepted automatically'; };
      let proposal = null;
      if (t.sourceKind !== 'manual-sessions' && tiers.size) proposal = store.load(t.key).session.proposal;
      for (let a = 1; a <= t.ayahCount; a++) {
        const outcome = s.outcomes?.[a] ?? null;
        if ((outcome === 'agreed' || outcome === 'resolved') && show === 'pending') continue; // verified: listed under Reviewed / All
        const [regTier, reason] = t.risk[a - 1];
        const tier = vhSet.has(String(a)) ? 'veryhigh' : regTier;
        const shown = outcome === 'disputed' || outcome === 'unresolved' ? 'disputed' : tier;
        const exception = shown !== 'disputed' && shown !== 'veryhigh' && shown !== 'n/a' && pend.has(String(a)) && !autoSet.has(String(a)) && !ownSet.has(String(a));
        if (!tiers.has(shown) && !(exception && tiers.has('exception'))) continue;
        const mine = s.myMarkers?.[a] ?? null;
        if (show === 'pending' && !pend.has(String(a)) && shown !== 'disputed') continue;
        if (show === 'reviewed' && pend.has(String(a))) continue;
        if (todo && mine === 'submitted') continue; // Phase 4.8.1: 'not yet submitted by me'
        const b = proposal?.boundaries.find((x) => x.ayah === a);
        rows.push({ key: t.key, reciterEn: t.reciterEn, reciterAr: t.reciterAr, surah: t.surah, surahEn: t.surahEn, ayah: a, ayahCount: t.ayahCount, tier: shown, reviewed: !pend.has(String(a)), auto: autoSet.has(String(a)), ownerOverride: ownSet.has(String(a)), reason: outcome ? `${outcome} after both reviews` : ownSet.has(String(a)) ? `owner override (UNVERIFIED: not listened; reciter identity and text not confirmed; blocked from release)${reason ? `: ${reason}` : ''}` : autoSet.has(String(a)) ? `accepted automatically (${tier} policy, not a person's review)${reason ? `: ${reason}` : ''}` : tier === 'veryhigh' && regTier !== 'veryhigh' ? `very high risk: ${s.veryHighFindings.join('; ')}` : exception ? `exception: ${whyOf(a)}${reason ? ` (${tier}: ${reason})` : ''}` : reason, exception, flags: b?.flags ?? [], proposedMs: proposal ? effectiveStartMs(store.load(t.key).session, a, proposal.starts[a]) : null, ...(a === 1 && t.opening?.applies ? { opening: t.opening.rule, onsetMs: t.opening.onsetMs } : {}), reviewType: t.reviewType, mine, outcome, rank: t.priority.rank });
      }
    }
    const order = ['disputed', 'veryhigh', 'exception', ...TIERS.filter((x) => x !== 'veryhigh')];
    const rank = (r) => order.indexOf(r.tier === 'disputed' || r.tier === 'veryhigh' ? r.tier : r.exception ? 'exception' : r.tier);
    rows.sort((x, y) => rank(x) - rank(y) || x.rank - y.rank || x.key.localeCompare(y.key) || x.ayah - y.ayah);
    const limit = Math.min(Number(q.get('limit') ?? 300), 5000);
    const offset = Number(q.get('offset') ?? 0);
    const byTier = {};
    for (const r of rows) { const k = r.exception ? 'exception' : r.tier; byTier[k] = (byTier[k] ?? 0) + 1; } // an exception counts once, as an exception
    return { total: rows.length, byTier, offset, rows: rows.slice(offset, offset + limit) };
  }


  return { STAGES, summarize, row, dashboard, attention };
}
