// Applies an APPROVED listening review (review/review.html export) to DEVELOPMENT-ONLY timing
// (development/development-timing.json). Nothing here touches production timing; promotion to production is a separate,
// explicit owner decision that no tool makes.
//
// Owner policy 2026-10-24: Reviewer 2 is no longer required. Review-dashboard packages (Reviewer 1 and the automatic
// acceptance policy) reach development builds through development/generate-reviewed-timing.mjs instead; this tool
// stays for review exports that already carry two reviewers (it never asks for a second review).
//
// The first file is what was reviewed:
//   - a review package (review/make-packages.mjs): 'aligned' (a candidate from alignment/run-batch.mjs) or
//     'development' (measured timing already in development-timing.json);
//   - or, for reviews made before Phase 4.1, the candidate's <surah>.flags.json itself.
// Refuses unless:
//   - the review is of exactly this timing (reciter, surah, URL, size, timing fingerprint) and names a reviewer and date;
//   - (Phase 4.1 reviews) the reviewer approved the whole surah, and every worklist boundary is marked 'correct';
//   - no boundary is marked 'needs-correction', 'unresolved' or (older reviews) 'wrong', and none is undecided;
//   - the package is not blocked (structure, VBR, completeness) nor playback-blocked (Phase 4.3: a recovered VBR file
//     whose seekable copy is not hosted yet), the corrected timing keeps every ayah in order with a
//     positive length, and the recording is in the catalogue at the audited size with no production timing;
//   - 'development': the development timing is still the one that was reviewed (same fingerprint).
//   - 'manual' (Phase 4.6, review/manual): timing placed by ear. Also refused unless the review (version 3) names two
//     different reviewers who match the package's independent reviewers, every ayah is decided, and the package is
//     not synthetic test data. Its package is blocked while the recording's rights are not cleared.
//
// usage: node development/apply-review.mjs <package.json | flags.json> <review.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timingFingerprint } from '../fingerprint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [reviewedFile, reviewFile] = process.argv.slice(2);
if (!reviewedFile || !reviewFile) throw new Error('usage: node development/apply-review.mjs <package.json | flags.json> <review.json>');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const reviewed = readJson(reviewedFile);
const review = readJson(reviewFile);
const results = readJson(path.join(here, '..', 'audit-results.json'));
const counts = readJson(path.join(here, '..', 'audit-data', 'ayah-counts.json'));
const refuse = (why) => { throw new Error(`refused: ${why}`); };

// One shape for both inputs: { source, reciterId, surah, url, bytes, fingerprint, worklist, starts: Map ayah->ms, lastEnd, blocked }.
let item;
if (reviewed.kind === 'ayah-timing-review-package') {
  item = {
    source: reviewed.source, reciterId: reviewed.reciterId, surah: reviewed.surah, url: reviewed.url, bytes: reviewed.bytes,
    fingerprint: reviewed.candidateFingerprint, worklist: reviewed.worklist, blocked: reviewed.blocked ?? [], playbackBlocked: reviewed.playbackBlocked ?? [],
    structureOk: reviewed.source === 'development' || reviewed.source === 'manual' || reviewed.structure?.ok === true,
    ayahs: reviewed.ayahs.map((a) => [a.ayah, a.startMs, a.endMs]),
    manual: reviewed.source === 'manual' ? { ...reviewed.manual, synthetic: reviewed.synthetic === true } : null,
  };
} else if (reviewed.candidate && reviewed.boundaries) {
  const flagged = reviewed.boundaries.filter((b) => b.flags.length).map((b) => b.ayah);
  item = {
    source: 'aligned', reciterId: reviewed.reciterId, surah: reviewed.surah, url: reviewed.url, bytes: reviewed.bytes,
    fingerprint: reviewed.candidate.fingerprint, worklist: [...new Set([...flagged, reviewed.boundaries[0].ayah, reviewed.boundaries.at(-1).ayah])],
    blocked: reviewed.structure.ok ? [] : reviewed.structure.problems, structureOk: reviewed.structure.ok,
    ayahs: reviewed.candidate.entries.filter(([a]) => a > 0),
  };
} else refuse('the first file is neither a review package nor a flags file');

if (review.kind !== 'ayah-timing-review') refuse('not a review export');
// Phase 4.8: synthetic test data (the dashboard's practice sessions and test fixtures) is refused for every source.
if (reviewed.synthetic === true || review.synthetic === true) refuse('synthetic test data is never applied');
for (const k of ['reciterId', 'surah', 'url', 'bytes']) if (review[k] !== item[k]) refuse(`review ${k} ${review[k]} ≠ reviewed ${item[k]}`);
if (review.candidateFingerprint !== item.fingerprint) refuse('the review is of other timing (fingerprint)');
if (review.source && review.source !== item.source) refuse(`review of ${review.source} timing, package is ${item.source}`);
if (!review.reviewer || !/^\d{4}-\d\d-\d\d$/.test(review.reviewedOn ?? '')) refuse('no reviewer / date');
if (review.version >= 2 && !(review.approved === true && review.approvedBy && /^\d{4}-\d\d-\d\d$/.test(review.approvedOn ?? ''))) refuse('the surah was not approved as a whole by the reviewer');
if (item.source === 'manual') {
  // Timing placed by ear: valid only as the agreement of two independent people.
  if (item.manual?.synthetic) refuse('synthetic test data is never applied');
  if (review.version !== 3) refuse('manual timing needs a two-reviewer review (version 3)');
  const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  if (!review.secondReviewer || same(review.reviewer, review.secondReviewer)) refuse('manual timing needs a second, different reviewer');
  const names = item.manual?.reviewers ?? [];
  if (names.length !== 2 || !same(names[0], review.reviewer) || !same(names[1], review.secondReviewer)) refuse('the review\'s reviewers are not the package\'s independent reviewers');
  for (const [a] of item.ayahs) if (!review.decisions.some((d) => d.ayah === a)) refuse(`manual timing: ayah ${a} not decided`);
}
if (!item.structureOk) refuse('candidate structure failed');
if (item.blocked.length) refuse(`blocked: ${item.blocked.join('; ')}`);
// Phase 4.3: timing may be heard and approved, but it must not reach the app while the app could not play it accurately.
if (item.playbackBlocked?.length) refuse(`not playable in the app yet: ${item.playbackBlocked.join('; ')}`);
const s = item.surah;
const entry = results.reciters.find((r) => r.id === item.reciterId);
if (!entry?.surahs.includes(s)) refuse('surah not listed for this recording');
if (entry.bytes[s] !== item.bytes) refuse('file size differs from the audit');
if (entry.timed[s]) refuse('this surah has production timing');

const decisions = new Map(review.decisions.map((d) => [d.ayah, d]));
for (const a of item.worklist) if (!decisions.get(a)?.verdict) refuse(`boundary ${s}:${a} not reviewed`);
const notOk = review.decisions.filter((d) => d.verdict !== 'correct');
if (notOk.length) refuse(`boundaries not marked correct: ${notOk.map((d) => `${s}:${d.ayah} (${d.verdict ?? 'undecided'})`).join(', ')}`);

// The reviewed timing: ayah k starts at its (corrected) boundary and ends where the next starts; ayah 1 as proposed.
const entries = item.ayahs;
if (entries.length !== counts[s - 1]) refuse(`expected ${counts[s - 1]} ayahs, the timing has ${entries.length}`);
const starts = entries.map(([a, start], k) => (k === 0 ? start : decisions.get(a)?.final ?? start));
const timing = starts.map((st, k) => [Math.round(st), Math.round(k + 1 < starts.length ? starts[k + 1] : entries.at(-1)[2])]);
if (timing.some(([a, b], k) => !(b > a) || (k > 0 && a < timing[k - 1][0]))) refuse('corrected timing is out of order');
const fingerprint = timingFingerprint(timing.map(([startMs, endMs], k) => ({ ayah: k + 1, startMs, endMs })));
const moved = review.decisions.filter((d) => d.final !== d.original).length;
const listening = `${review.reviewer}, ${review.reviewedOn}${review.approvedBy ? ` (approved by ${review.approvedBy}, ${review.approvedOn})` : ''}: ${review.decisions.length} boundaries heard, all correct, ${moved} moved${review.notes ? `; ${review.notes}` : ''}`;

// QH_DEVELOPMENT_TIMING: another output file (tests), so a trial never touches the real development data.
const devFile = process.env.QH_DEVELOPMENT_TIMING ?? path.join(here, 'development-timing.json');
const dev = fs.existsSync(devFile) ? readJson(devFile) : { stage: 'development', generatedOn: review.reviewedOn, reciters: {} };
const r = (dev.reciters[item.reciterId] ??= { audio: entry.server, reference: null, surahs: {}, evidence: {}, review: {}, excluded: {} });
if (item.source === 'development') {
  if (r.evidence[s]?.fingerprint !== item.fingerprint) refuse('the development timing changed since this package was made');
  r.surahs[s] = timing;
  r.evidence[s] = { ...r.evidence[s], ...(moved ? { fingerprint, correctedFrom: item.fingerprint } : {}), listening };
} else {
  r.surahs[s] = timing;
  r.evidence[s] = {
    fingerprint, bytes: entry.bytes[s],
    ...(item.source === 'manual'
      ? { manual: `review/manual: every start placed by ear by ${review.reviewer} and independently by ${review.secondReviewer}; log ${item.manual.logHeadHash}` }
      : { aligned: `alignment/align_mms.py (no-star primary, star comparison) + flag_boundaries.py; candidate ${item.fingerprint}` }),
    listening,
  };
}
delete r.excluded[s];
fs.writeFileSync(devFile, JSON.stringify(dev) + '\n');
console.log(`${item.reciterId} ${s}: development timing ${item.source === 'development' && !moved ? 'confirmed by listening' : 'written'} (fingerprint ${moved || item.source !== 'development' ? fingerprint : item.fingerprint}); run generate-catalog.mjs`);
