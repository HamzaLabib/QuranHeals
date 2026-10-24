// The machine-readable record of a manual-timing review (Phase 4.6A), and, ONLY for a recording verified by two
// independent reviewers, the package + review pair the existing process reads (development/apply-review.mjs, source
// 'manual'). Nothing is approved here: the pair carries the reviewers' own decisions, and a package of a recording
// whose rights are not cleared stays blocked, so apply-review refuses it.
//
// Phase 4.8 (review/dashboard): a session with an automatic proposal (an aligned or development review package) is
// exported as the pair for ITS OWN source: the original package, read back and checked against the SHA-256 recorded
// at import (so its fingerprint, worklist and blocks are exactly what was reviewed), and a version-3 review naming both
// reviewers, with every start's original (proposed) and final (agreed) time. apply-review takes ayah 1's start and the
// last ayah's end from the package; when the reviewers agreed other times for those, the export says so (caveats).
import crypto from 'node:crypto';
import fs from 'node:fs';

import { timingFingerprint } from '../../fingerprint.mjs';
import { AGREE_MS, finalTiming, openingOnset, recordingStatus, reviewedStarts, summary } from './manual-lib.mjs';
import { openingOf, OPENING_RULE } from './opening.mjs';

export function buildExport(session, state, events, { exportedAt = new Date().toISOString(), readPackage = null } = {}) {
  const st = recordingStatus(session, state);
  const timing = finalTiming(session, state);
  const fingerprint = timing ? timingFingerprint(timing.map(([startMs, endMs], k) => ({ ayah: k + 1, startMs, endMs }))) : null;
  const reviewers = [1, 2].map((k) => state.reviewers[k]).filter(Boolean);
  const record = {
    kind: 'manual-ayah-timing-review', version: 1, exportedAt, synthetic: session.synthetic === true,
    reviewType: session.reviewType ?? 'manual-timing',
    recording: { reciterId: session.reciterId, surah: session.surah, surahEn: session.surahEn, surahAr: session.surahAr, url: session.url, bytes: session.bytes, sha256: session.sha256, durationMs: session.durationMs, timeline: session.timeline },
    textSource: session.textSource, evidenceInput: session.evidence?.source ?? null, rights: session.rights,
    automaticProposal: session.proposal ? { source: session.proposal.source, fingerprint: session.proposal.fingerprint, package: session.provenance?.packageFile ?? null, packageSha256: session.provenance?.packageSha256 ?? null } : null,
    agreementMs: AGREE_MS,
    reviewers: reviewers.map((r) => ({ role: r.role, name: r.name, joinedAt: r.joinedAt, submittedAt: r.submittedAt, work: r.work, amendments: r.amendments, submitted: r.submitted ?? {}, revisions: r.revisions ?? [] })),
    // Phase 4.8.1: complete only when both reviewers have submitted the whole review; partial records never carry a pair.
    complete: !!(state.reviewers[1]?.submittedAt && state.reviewers[2]?.submittedAt),
    comparison: st.comparison, proposals: state.proposals, resolutions: state.resolutions, unresolvable: state.unresolvable, comments: state.comments,
    status: st.status, reasons: st.reasons, summary: summary(session, state),
    // Phase 4.8.6: single-review completion (one accepted submission per start), over the state this export may show.
    singleReview: (() => { const r = reviewedStarts(session, state); return { starts: r.starts, reviewed: r.reviewed.length, pending: r.pending.length, complete: r.complete, note: 'review completion only: not independent verification, not publication' }; })(),
    ...(session.scope ? { scope: session.scope, findings: st.findings ?? null, findingsNote: 'production boundary check: findings for the owner; no timing is exported or applied' } : {}),
    log: { events: events.length, headHash: events.at(-1)?.hash ?? null },
    // Phase 4.8.8: the timing below is EFFECTIVE: ayah 1 starts at 0 (opening rule); its onset is for highlighting.
    opening: (() => { const o = openingOf(session); const on = openingOnset(session, state); return { rule: OPENING_RULE.id, status: o.status, applies: o.applies, startMs: o.applies ? OPENING_RULE.startMs : null, onsetMs: on?.ms ?? null, onsetSource: on?.source ?? null, proposalFirstMs: o.onsetMs, exceptions: o.exceptions, ...(o.applies ? {} : { reason: o.reason }) }; })(),
    timing, fingerprint,
    package: null, review: null,
  };
  if (!timing) return record;
  const [r1, r2] = [state.reviewers[1], state.reviewers[2]];
  const lastSubmit = [r1.submittedAt, r2.submittedAt].sort().at(-1).slice(0, 10);
  if (session.proposal) return proposalPair(record, session, st, timing, r1, r2, lastSubmit, readPackage);
  const blocked = session.rights?.cleared === true ? [] : [`permissions: ${session.rights?.reason ?? 'not cleared'}`];
  record.package = {
    kind: 'ayah-timing-review-package', version: 1, source: 'manual', createdOn: exportedAt.slice(0, 10), synthetic: record.synthetic,
    reciterId: session.reciterId, reciterEn: session.reciterEn, recording: session.recording,
    surah: session.surah, surahAr: session.surahAr, surahEn: session.surahEn, ayahCount: session.ayahCount,
    url: session.url, bytes: session.bytes, sha256: session.sha256, textSource: session.textSource,
    status: 'manual timing verified by two independent reviewers (plays nowhere until applied by the owner)',
    candidateFingerprint: null, durationMs: session.durationMs,
    // Package convention (make-packages.mjs): ayah 1's startMs is its onset; `opening` declares playback from 0.
    basmala: session.basmala, ayahs: session.ayahs.map((a, k) => ({ ayah: a.ayah, startMs: k === 0 && record.opening.applies ? Math.min(record.opening.onsetMs ?? 0, timing[0][1] - 1) : timing[k][0], endMs: timing[k][1], text: a.text })),
    ...(record.opening.applies ? { opening: { rule: OPENING_RULE.id, startMs: OPENING_RULE.startMs, onsetMs: Math.min(record.opening.onsetMs ?? 0, timing[0][1] - 1) } } : {}),
    boundaries: st.comparison.filter((c) => c.key !== 'end').map((c) => ({ ayah: c.key, ms: Math.round(c.finalMs), flags: c.outcome === 'resolved' ? ['resolved-disagreement'] : [], priority: 1 })),
    worklist: session.ayahs.map((a) => a.ayah), worklistRule: 'every ayah start, placed by ear by two independent reviewers',
    manual: { reviewers: [r1.name, r2.name], logHeadHash: record.log.headHash, agreementMs: AGREE_MS },
    ...(blocked.length ? { blocked } : {}),
  };
  // The package's own fingerprint: over its ayahs as written (ayah 1 at its onset), so the package validates itself.
  record.package.candidateFingerprint = timingFingerprint(record.package.ayahs.map((a) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs })));
  record.review = {
    kind: 'ayah-timing-review', version: 3, source: 'manual',
    reciterId: session.reciterId, surah: session.surah, url: session.url, bytes: session.bytes, candidateFingerprint: record.package.candidateFingerprint,
    reviewer: r1.name, secondReviewer: r2.name, reviewedOn: lastSubmit,
    approved: true, approvedBy: `${r1.name} and ${r2.name} (independent two-reviewer verification)`, approvedOn: lastSubmit,
    notes: `manual timing; ${record.summary.agreed} boundaries agreed within ${AGREE_MS} ms, ${record.summary.resolved} resolved by listening; log ${record.log.headHash}`,
    worklist: record.package.worklist,
    decisions: st.comparison.filter((c) => c.key !== 'end').map((c) => ({
      ayah: c.key, original: Math.round(c.finalMs), final: Math.round(c.finalMs), verdict: 'correct',
      note: c.outcome === 'resolved' ? `resolved: proposed by ${c.resolution.proposedBy}, accepted by ${c.resolution.acceptedBy}` : `agreed: Reviewer 1 ${c.r1.ms} ms, Reviewer 2 ${c.r2.ms} ms`,
    })),
  };
  return record;
}

/** The apply-review pair of a verified session that started from an aligned or development package (see the header). */
function proposalPair(record, session, st, timing, r1, r2, lastSubmit, readPackage) {
  const file = session.provenance?.packageFile;
  let raw = null;
  // Phase 4.8.2: the cloud server keeps the original package in its database (readPackage); locally it is a file.
  try { raw = readPackage ? readPackage(file) : fs.readFileSync(file, 'utf8'); } catch { /* reported below */ }
  if (!raw || crypto.createHash('sha256').update(raw).digest('hex') !== session.provenance?.packageSha256) {
    record.pairUnavailable = `the original package ${file ?? '(unknown)'} is missing or changed since it was imported; no apply-review pair is produced`;
    return record;
  }
  const pkg = JSON.parse(raw);
  if (pkg.candidateFingerprint !== session.proposal.fingerprint) {
    record.pairUnavailable = 'the package on disk is not the reviewed proposal (fingerprint)';
    return record;
  }
  const agreed = st.comparison.map((c) => Math.round(c.finalMs));
  const caveats = [];
  if (record.opening.applies) caveats.push(`opening rule ${OPENING_RULE.id}: ayah 1 plays from 0 ms; the package's first timestamp (${pkg.ayahs[0].startMs} ms) is kept as its onset (highlighting), as apply-review and the app already treat it`);
  else if (agreed[0] !== pkg.ayahs[0].startMs) caveats.push(`apply-review keeps the package's ayah 1 start (${pkg.ayahs[0].startMs} ms); the reviewers agreed ${agreed[0]} ms`);
  if (agreed.at(-1) !== pkg.ayahs.at(-1).endMs) caveats.push(`apply-review keeps the package's last ayah end (${pkg.ayahs.at(-1).endMs} ms); the reviewers agreed ${agreed.at(-1)} ms`);
  if (caveats.length) record.caveats = caveats;
  // As for manual timing: while the recording's rights are not cleared, the package is blocked (apply-review refuses it).
  const rightsBlock = session.rights?.cleared === true ? [] : [`permissions: ${session.rights?.reason ?? 'not cleared'}`];
  record.package = { ...pkg, ...(record.synthetic ? { synthetic: true } : {}), ...(rightsBlock.length ? { blocked: [...(pkg.blocked ?? []), ...rightsBlock] } : {}) };
  const moved = st.comparison.filter((c) => c.key !== 'end' && c.key > 1 && Math.round(c.finalMs) !== session.proposal.starts[c.key]).length;
  record.review = {
    kind: 'ayah-timing-review', version: 3, source: pkg.source, ...(record.synthetic ? { synthetic: true } : {}),
    reciterId: pkg.reciterId, surah: pkg.surah, url: pkg.url, bytes: pkg.bytes, candidateFingerprint: pkg.candidateFingerprint,
    reviewer: r1.name, secondReviewer: r2.name, reviewedOn: lastSubmit,
    approved: true, approvedBy: `${r1.name} and ${r2.name} (independent two-reviewer verification of every start)`, approvedOn: lastSubmit,
    notes: `review/dashboard: every ayah start confirmed by two independent reviewers (${record.summary.agreed} agreed within ${AGREE_MS} ms, ${record.summary.resolved} resolved by listening; ${moved} moved from the proposal); log ${record.log.headHash}`,
    worklist: pkg.worklist,
    decisions: st.comparison.filter((c) => c.key !== 'end' && c.key > 1).map((c) => ({
      ayah: c.key, original: session.proposal.starts[c.key], final: Math.round(c.finalMs), verdict: 'correct',
      note: c.outcome === 'resolved' ? `resolved: proposed by ${c.resolution.proposedBy}, accepted by ${c.resolution.acceptedBy}` : `agreed: Reviewer 1 ${c.r1.ms} ms, Reviewer 2 ${c.r2.ms} ms`,
    })),
  };
  return record;
}
