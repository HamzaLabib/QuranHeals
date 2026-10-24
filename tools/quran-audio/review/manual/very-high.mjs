// Phase 4.8.9: Very High Risk (owner, 2026-10-23), the tier above high. A start (or a whole recording) is Very High Risk
// only on credible evidence of a serious STRUCTURAL problem: an ayah cut off at its beginning, a truncated or missing
// ayah, an overlap of adjacent ayahs, ayahs in the wrong order, or a repetition that breaks one-start-per-ayah timing.
// Very High Risk starts always need a person; nothing here accepts or rejects anything.
//
// What counts as evidence (and what does not):
//   automatic, per start
//     displaced         the boundary sweep measured a production / measured start inside recitation with a clear pause
//                       nearby: >= 300 ms late (the ayah's first words are skipped) or early (the previous ayah's end
//                       plays first, an overlap). An acoustic measurement, not proof: the reason says so.
//     reordered         the aligner put very short ayahs out of order; a rule repaired the boundary (a guess)
//     past-own-end      the aligner snapped a start past the previous ayah's own end (an overlap); repaired by rule
//     opening-squeezed  the aligner found almost no audio for ayah 1 (collapsed): ayah 1 may be missing or truncated
//   automatic, whole recording (every start not yet accepted by a person)
//     a documented 'repetition' concern (known-issues.json) or a Phase 4.5 verdict "with repeated passages": the
//     reciter returns to earlier ayahs (often intentional in live recitation, but one start per ayah cannot number it)
//   human, whole recording (from the review log)
//     a reviewer answered No to "this surah", "every ayah recited" or "canonical order", or flagged a missing passage
//     or a repetition that returns to earlier ayahs
// NOT Very High Risk on their own: silence, pauses, the Basmala, isti'adha, introductions, an extra sound in a pause,
// two alignment runs disagreeing, a weak text score, MP3Quran disagreeing, or any other ordinary timing uncertainty
// (they keep their high / medium / check tier). A Quranic refrain (e.g. Ar-Rahman) is not a recitation problem, and
// Phase 4.5 "conflict" evidence alone is not one either. Structural checks never prove that every word is present.

export const VERY_HIGH = { id: 'very-high-v1', decidedBy: 'owner', decidedOn: '2026-10-23', minDisplacedMs: 300 };

/** How far (ms) a swept start lies from the nearest pause, and on which side: { ms, side: 'late' | 'early' } or null. */
function displacement(b) {
  const w = b?.sweep?.nearestPauseRelativeMs;
  if (!Array.isArray(w)) return null;
  if (w[1] <= 0) return { ms: -w[1], side: 'late' };
  if (w[0] >= 0) return { ms: w[0], side: 'early' };
  return null; // the pause straddles the start: not displaced
}

const fmt = (ms) => `${(ms / 1000).toFixed(2)} s`;

/**
 * The automatic Very High Risk evidence of a session (no review log needed):
 * { starts: Map(ayah -> reason), recording: reason | null }. Ayah 1 under the opening rule plays from 0:00.000, so a
 * start-level finding never applies to it (its first words cannot be cut); a whole-recording finding does, and so does
 * a per-ayah file finding (the ayah's own audio).
 */
export function staticVeryHigh(session) {
  const starts = new Map();
  const p = session?.proposal ?? null;
  for (const b of p?.boundaries ?? []) {
    if (!(b.ayah >= 2)) continue;
    const f = new Set(b.flags ?? []);
    const why = [];
    if (f.has('displaced')) {
      const d = displacement(b);
      if (d && d.ms >= VERY_HIGH.minDisplacedMs) why.push(d.side === 'late' ? `start ${fmt(d.ms)} after the end of the pause: the beginning of ayah ${b.ayah} may be cut off (boundary sweep, an acoustic measurement)` : `start ${fmt(d.ms)} before the pause: the end of ayah ${b.ayah - 1} plays into ayah ${b.ayah} (overlap; boundary sweep, an acoustic measurement)`);
    }
    if (f.has('sweep-displaced')) why.push(`measured start inside recitation with a pause close by: ayah ${b.ayah} may be cut off or overlap ayah ${b.ayah - 1} (boundary sweep)`);
    if (f.has('reordered')) why.push(`the aligner put these very short ayahs out of order; the boundary was repaired by rule${b.repairedFromMs != null ? ` (from ${fmt(b.repairedFromMs)})` : ''}, not heard`);
    if (f.has('past-own-end')) why.push(`the aligner placed this start past the end of ayah ${b.ayah - 1} (an overlap); repaired by rule${b.repairedFromMs != null ? ` (from ${fmt(b.repairedFromMs)})` : ''}, not heard`);
    // Suspected another voice (surah-sources/voice.py: this surah's speaker embedding far from the rest of the
    // recording's): one start stands for the surah, to confirm by ear who recites it.
    if (f.has('identity-sample')) why.push(`the voice of this surah differs from the rest of the recording${b.identity ? ` (${b.identity})` : ''}: listen to confirm it is the same reciter; this start stands for the surah`);
    if (f.has('opening-squeezed')) why.push('ayah 1 collapsed in the alignment (almost no audio found for it): it may be missing or truncated');
    if (why.length) starts.set(b.ayah, why.join('; '));
  }
  // Per-ayah recordings (per-ayah/classify.mjs): every ayah the automated scan could not clear is Very High Risk,
  // ayah 1 included. Its file (or its Basmala file) is the audio itself, not a start inside a longer recording, so the
  // opening rule's 0:00.000 does not settle it.
  // A graded package (per-ayah/classify.mjs `tier`) is Very High only for its 'veryhigh' ayahs; an ungraded one (the
  // first, Gebril's) for every flagged ayah.
  for (const [ayah, r] of Object.entries(p?.perAyah?.risk ?? {})) {
    const a = Number(ayah);
    if (!(a >= 1) || (r?.tier !== undefined ? r.tier !== 'veryhigh' : r?.risk !== 'high')) continue;
    // Phase 4.8.10 (per-ayah/severity.mjs): the exact problems (Cut Beginning, Ayah Overlap, ...) with their evidence.
    const what = r.severity?.codes?.filter((x) => x.tier === 'veryhigh').map((x) => `${x.label}: ${x.why}`) ?? [];
    starts.set(a, [starts.get(a), what.length ? what.join('; ') : `per-ayah file not cleared by the automated scan: ${(r.reasons ?? []).join('; ') || 'uncertain'}`].filter(Boolean).join('; '));
  }
  let recording = null;
  const rep = (session?.concerns ?? []).find((c) => c.kind === 'repetition');
  if (rep) recording = `documented repetition concern: ${rep.text}`;
  const verdict = session?.evidence?.verdict ?? '';
  if (/repeated passages/i.test(verdict)) recording = `Phase 4.5: ${verdict}: the reciter returns to earlier ayahs (a live recitation; one start per ayah cannot number the repeats)`;
  return { starts, recording };
}

/**
 * Phase 4.8.10: why a per-ayah start may not be accepted automatically although its tier allows it, or null:
 *   an unresolved exception (per-ayah/severity.mjs tier 'exception': a file that cannot be assessed reliably), or an
 *   identity that waits for a person (`dependsOn`: the ayah whose voice check stands for this file's surah or run).
 * isReviewed(key) tells whether a person accepted a start.
 */
export function perAyahBlock(session, ayah, isReviewed = () => false) {
  const r = session?.proposal?.perAyah?.risk?.[ayah];
  if (!r) return null;
  if (r.tier === 'exception') return `unresolved exception: ${r.severity?.codes?.filter((x) => x.tier === 'exception').map((x) => `${x.label}: ${x.why}`).join('; ') || (r.reasons ?? []).join('; ') || 'not assessable automatically'}`;
  const dep = r.severity?.dependsOn;
  if (dep && !isReviewed(String(dep))) return `waits for a person to confirm the voice at ayah ${dep} (identity of this file's surah or source run)`;
  return null;
}

const NO_CHECKS = { surah: 'it is this surah', complete: 'every ayah is recited', order: 'the ayahs are in canonical order' };
/** Whole-recording Very High Risk evidence from the reviewers' own work (current replayed state): reasons (may be empty). */
export function humanVeryHigh(state) {
  const out = [];
  for (const r of [1, 2].map((k) => state?.reviewers?.[k]).filter(Boolean)) {
    for (const [k, text] of Object.entries(NO_CHECKS)) if (r.work?.checks?.[k] === 'no') out.push(`Reviewer ${r.role} (${r.name}) answered No: ${text}`);
    for (const f of r.work?.flags ?? []) {
      if (f.kind === 'missing-passage') out.push(`Reviewer ${r.role} (${r.name}) flagged a missing passage${f.ayahs ? ` (${f.ayahs.join('-')})` : ''}`);
      if (f.kind === 'repetition' && f.implication === 'returns-to-earlier-ayahs') out.push(`Reviewer ${r.role} (${r.name}) flagged a repetition returning to earlier ayahs (${f.ayahs?.join('-') ?? '?'})`);
    }
  }
  return out;
}

/** Everything together: { starts: Map, recording: [reasons], any }. */
export function veryHighOf(session, state = null) {
  const s = staticVeryHigh(session);
  const recording = [...(s.recording ? [s.recording] : []), ...(state ? humanVeryHigh(state) : [])];
  return { starts: s.starts, recording, any: s.starts.size > 0 || recording.length > 0 };
}
