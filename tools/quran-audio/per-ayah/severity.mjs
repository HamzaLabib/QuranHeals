// Unified severity of a per-ayah recording (owner, 2026-10-23: "serious problems only"), the same rules for every
// per-ayah reciter (Mohamed Gebril, Ali Abdullah Jaber, ...). Input: the classify.mjs risk report (scan, text and
// identity evidence) and boundary_check.py (each file's words at both edges, against the neighbouring ayahs). Output: a
// risk report of the same kind, every file with a dashboard tier and the exact reason codes, their evidence, the
// adjacent ayahs involved, the confidence and the limits of the analysis.
//
// Tiers (the dashboard's, review/manual/very-high.mjs; policy auto-accept-v2):
//   veryhigh   credible evidence of a serious recitation problem: a person must listen
//   exception  the file cannot be assessed reliably (missing, unreadable, its text not confirmed at all, two methods
//              in unresolved conflict, an identity that cannot be established): blocked, never accepted automatically
//   high / medium / check   uncertainty without evidence of a serious problem: accepted automatically when every
//              integrity, mapping, identity and structural check passes (administrative: never a verification)
//   low        no automated reason to listen (routine)
// No automated check proves that every word is recited: "low" is never "verified".
//
// Very high only with CORROBORATION, never a single speech-recognition score:
//   CUT_START       the first word(s) squeezed into almost no audio at a voiced file start, or the previous file ends
//                   with this ayah's first words while this file lacks them
//   CUT_END         the same at the end (or the next file begins with this ayah's last words while this one lacks them)
//   AYAH_OVERLAP    a file begins with the previous ayah's last words (or ends with the next ayah's first words) that the
//                   neighbouring file also holds complete: duplicated recitation across the boundary
//   AYAH_SEQUENCE   the whole previous ayah recited again in the file; the whole next ayah run on into it; the text
//                   scoring and the transcription BOTH preferring a neighbouring ayah (whose text differs); the same
//                   audio under two names
//   WRONG_AYAH      the text scoring and the transcription both preferring a far ayah (whose text differs)
//   MISSING_CONTENT two or more consecutive words (or 30 %) of the ayah squeezed into almost no audio inside the file
//   EXTRA_AYAH      substantial voiced audio (>= 3 s) outside the ayah's words that is not the Basmala / isti'adha
//   WRONG_RECITER   the file's own tags name another reciter
//   INCORRECT_MAPPING a mis-named or replaced file whose text also points elsewhere
// NOT on their own: weak or ambiguous text scores, transcription weakness, pauses, breathing, silences, clipping,
// another encoding, abnormal length, an internal silence, a broken MP3 stream, metadata — they stay high / medium / check
// unless the boundary evidence above corroborates a structural problem. Near-identical neighbour texts (94:5/94:6,
// 78:4/78:5, a refrain) cannot be told apart by text scoring: never evidence of a wrong mapping.
//
// usage: node tools/quran-audio/per-ayah/severity.mjs --risk <classify report> --boundary <boundary_check.json>
//          [--calibration <list.json>] [--clearance <clearance.py output>] --out <severity report>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEVERITY = { id: 'per-ayah-severity-v1', decidedBy: 'owner', decidedOn: '2026-10-23' };
export const LABELS = {
  CUT_START: 'Cut Beginning', CUT_END: 'Cut Ending', AYAH_OVERLAP: 'Ayah Overlap', AYAH_SEQUENCE: 'Incorrect Ayah Sequence',
  MISSING_CONTENT: 'Missing Quran Content', WRONG_AYAH: 'Wrong Ayah', INCORRECT_MAPPING: 'Wrong Ayah (incorrect mapping)',
  WRONG_RECITER: 'Wrong Reciter / Riwayah', WRONG_RIWAYAH: 'Wrong Reciter / Riwayah', EXTRA_AYAH: 'Other Critical Structural Error (extra recitation)',
  OTHER_STRUCTURAL: 'Other Critical Structural Error',
  FILE_UNAVAILABLE: 'Unresolved: file missing or unreadable', TEXT_UNCONFIRMED: 'Unresolved: ayah text not confirmed', TEXT_CONFLICT: 'Unresolved: methods disagree',
  IDENTITY_UNRESOLVED: 'Unresolved: reciter identity not established', CHECK_MISSING: 'Unresolved: structural check not available', EXTRA_UNRESOLVED: 'Unresolved: audio outside the ayah not explained',
};
const VERY_HIGH_CODES = new Set(['CUT_START', 'CUT_END', 'AYAH_OVERLAP', 'AYAH_SEQUENCE', 'MISSING_CONTENT', 'WRONG_AYAH', 'INCORRECT_MAPPING', 'WRONG_RECITER', 'WRONG_RIWAYAH', 'EXTRA_AYAH', 'OTHER_STRUCTURAL']);
const TIER_RANK = ['veryhigh', 'exception', 'high', 'medium', 'check', 'low'];

const LETTER = /[ء-يٱ]/g;
const bare = (t) => (t.match(LETTER) ?? []).join('');
/** Letter-sequence similarity 0..1 (Levenshtein ratio) of two texts. */
export function textSimilarity(a, b) {
  a = bare(a); b = bare(b);
  if (!a.length && !b.length) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
const q = (xs, p) => { const a = [...xs].filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))] : NaN; };
const median = (xs) => q(xs, 0.5);

/**
 * Thresholds from the recording itself: what "not there" looks like (the far-ayah words added at an edge), the pace of
 * real words, and the wrong-text controls of classify.mjs.
 */
export function calibrate(report, boundary) {
  const files = Object.values(boundary.files ?? {});
  const ctrl = files.flatMap((f) => ['ctrlTail', 'ctrlHead'].map((k) => f[k]?.added?.prob)).filter(Number.isFinite);
  const control = Object.fromEntries(report.calibration?.controlScore ?? []);
  return {
    // A neighbour's words are FOUND at an edge only clearly above the far-ayah words (which are not there).
    foundProb: Math.max(0.35, Math.round((q(ctrl, 0.99) + 0.05) * 100) / 100),
    foundVoiced: 0.6,
    foundPace: 0.5, // at least half the file's own time per letter: real words take real time
    // A word is ABSENT when squeezed below this share of the file's pace with a probability below absentProb.
    squeezePace: 0.35,
    absentProb: 0.15,
    // The expected text below the median wrong-text control: the automated check did not find the ayah at all.
    unconfirmedScore: control[0.5] ?? 0.2,
    minScore: report.thresholds?.minScore ?? 0.4,
    minMargin: report.thresholds?.minMargin ?? 0.08,
    nearIdentical: 0.75,
    extraMs: 3000,
    // Recitation outside the ayah's words, measured by classify.mjs (verify_text), that corroborates a neighbour's words.
    outsideMs: 800,
    clearMargin: 0.05,
    edgeVoiced: 0.5,
    ctrlAddedQ99: Math.round(q(ctrl, 0.99) * 1000) / 1000,
    ctrlFiles: files.length,
  };
}

const paceOf = (words) => median((words ?? []).filter((w) => w[3] > 0 && w[0] >= 0.3).map((w) => (w[2] - w[1]) / w[3]));
const absent = (w, pace, C) => w[0] < C.absentProb && Number.isFinite(pace) && (w[2] - w[1]) / Math.max(1, w[3]) < C.squeezePace * pace;
/** The neighbour's words at an edge are really recited there. */
const found = (run, pace, C) => !!run?.added && run.added.prob >= C.foundProb && run.added.voiced >= C.foundVoiced && (!Number.isFinite(pace) || run.added.msPerLetter >= C.foundPace * pace);
/** ... and BEFORE the ayah's own words (they take audio of their own, not the ayah's first words). */
const beforeOwn = (run, words) => !!run?.added && !!words?.length && run.added.endMs <= words[0][1] + 150 && (run.expected?.startMs ?? Infinity) >= words[0][1] - 150;
/** ... and AFTER the ayah's own words. */
const afterOwn = (run, words) => !!run?.added && !!words?.length && run.added.startMs >= words.at(-1)[2] - 150 && (run.expected?.endMs ?? -Infinity) <= words.at(-1)[2] + 150;
/** Words that occur inside a text anyway (a shared phrase, a refrain, a parallel ayah) prove nothing when found. */
export const contained = (words, inText) => { const w = bare(words ?? ''); const t = bare(inText ?? ''); return !!w && (t.includes(w) || textSimilarity(w, t.slice(0, w.length)) >= 0.75 || textSimilarity(w, t.slice(-w.length)) >= 0.75); };

/**
 * Severity of one file. ctx: { item, prevItem, nextItem, b (this file's boundary evidence), bPrev, bNext, C, texts:
 * { expected, prev, next, control } (canonical texts), identity: { otherPerformance, sampleAyah } }.
 * Returns { tier, codes: [{ code, tier, label, why, adjacent, evidence }], confidence, limitations, autoEligible, dependsOn }.
 */
export function severityOf(ctx) {
  const { item, b, bPrev, bNext, C, texts } = ctx;
  const ev = item.evidence ?? {};
  const has = (c) => item.codes?.includes(c);
  const out = [];
  const add = (code, tier, why, extra = {}) => out.push({ code, tier, label: LABELS[code] ?? code, why, ...extra });
  const s = item.surah, a = item.ayah;
  const ref = (x) => `${s}:${x}`;
  // ---- unavailable / unreadable: an exception, never accepted
  for (const c of ['missing', 'not-fetched', 'redirect', 'decode', 'too-short']) if (has(c)) add('FILE_UNAVAILABLE', 'exception', item.reasons.find((r) => r.startsWith(c)) ?? c);
  if (has('text-unverified')) add('TEXT_UNCONFIRMED', 'exception', item.reasons.find((r) => r.startsWith('text-unverified')) ?? 'no text evidence');
  // ---- tags naming another reciter
  if (has('tag-artist')) add('WRONG_RECITER', 'veryhigh', item.reasons.find((r) => r.startsWith('tag-artist')), { evidence: 'ID3 artist tag' });
  // ---- boundary evidence (the Basmala file is scored on its own words only)
  const words = Array.isArray(b?.expected) ? b.expected : null;
  const pace = paceOf(words);
  if (a >= 1 && item.risk === 'high' && (!b || b.error || !words)) add('CHECK_MISSING', 'exception', `the boundary check could not run on this file${b?.error ? ` (${b.error})` : b?.expected?.error ? ` (${b.expected.error})` : ''}`);
  if (words && a >= 1) {
    const ab = words.map((w) => absent(w, pace, C));
    const lead = (() => { let k = 0; while (k < ab.length && ab[k]) k++; return k; })();
    const trail = (() => { let k = 0; while (k < ab.length && ab[ab.length - 1 - k]) k++; return k; })();
    // inner runs of absent words
    let run = 0, maxRun = 0;
    for (let i = lead; i < ab.length - trail; i++) { run = ab[i] ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
    const share = ab.filter(Boolean).length / ab.length;
    const prevEndsWithMine = found(bPrev?.nextHead, paceOf(bPrev?.expected), C) && afterOwn(bPrev?.nextHead, bPrev?.expected) && (ctx.prevItem?.evidence?.voicedAfterMs ?? 0) >= C.outsideMs && !contained(texts.expectedHeadText, texts.prev);
    const nextBeginsWithMine = found(bNext?.prevTail, paceOf(bNext?.expected), C) && beforeOwn(bNext?.prevTail, bNext?.expected) && (ctx.nextItem?.evidence?.voicedBeforeMs ?? 0) >= C.outsideMs && !contained(texts.expectedTailText, texts.next);
    // Squeezed words mean something only when the words that ARE there are clearly recognised.
    const present = words.filter((w, i) => !ab[i]);
    const presentProb = present.length ? present.reduce((x, w) => x + w[0], 0) / present.length : 0;
    if (share >= 0.8 || presentProb < C.minScore || (Number.isFinite(ev.score) && ev.score < C.unconfirmedScore)) {
      // Almost nothing of the ayah is recognised: no word-level claim (the text check decides: unconfirmed or weak).
    } else {
      if (lead > 0 && (lead >= 2 || b.voicedFirst100 >= C.edgeVoiced || prevEndsWithMine)) add('CUT_START', 'veryhigh', `the first ${lead === 1 ? 'word is' : `${lead} words are`} squeezed into almost no audio at a file start that is already voiced${prevEndsWithMine ? `, and ${ref(a - 1)}'s file ends with this ayah's first words` : ''}: the beginning of the ayah is missing from this file`, { adjacent: prevEndsWithMine ? [ref(a - 1)] : [], locationMs: [0, Math.max(400, words[lead]?.[1] ?? 400)] });
      else if (prevEndsWithMine && lead === 0 && words[0][0] >= C.foundProb) add('AYAH_OVERLAP', 'veryhigh', `${ref(a - 1)}'s file ends with this ayah's first words (${bPrev.nextHead.added.prob} probability, ${Math.round(bPrev.nextHead.added.voiced * 100)} % voiced), and this file also begins with them: recited twice across the boundary`, { adjacent: [ref(a - 1)], locationMs: [0, words[Math.min(2, words.length - 1)][2]] });
      if (trail > 0 && (trail >= 2 || b.voicedLast100 >= C.edgeVoiced || nextBeginsWithMine)) add('CUT_END', 'veryhigh', `the last ${trail === 1 ? 'word is' : `${trail} words are`} squeezed into almost no audio at a file end that is still voiced${nextBeginsWithMine ? `, and ${ref(a + 1)}'s file begins with this ayah's last words` : ''}: the ending of the ayah is missing from this file`, { adjacent: nextBeginsWithMine ? [ref(a + 1)] : [], locationMs: [Math.max(0, (words[words.length - 1 - trail]?.[2] ?? b.durationMs) - 200), b.durationMs] });
      if (maxRun >= 2 || (share >= 0.3 && ab.length >= 4)) add('MISSING_CONTENT', 'veryhigh', `${maxRun >= 2 ? `${maxRun} consecutive words` : `${Math.round(share * 100)} % of the words`} of the ayah are squeezed into almost no audio inside the file: words may be missing`, { locationMs: (() => { const i = ab.findIndex((x, k) => x && k >= lead); return i >= 0 ? [Math.max(0, words[i][1] - 500), words[i][2] + 500] : null; })() });
    }
    // Duplicated recitation: this file begins with the previous ayah's end (which the previous file also holds), or
    // ends with the next ayah's beginning (which the next file also holds).
    const mine = (x) => texts[x] ?? '';
    if (a > 1 && found(b.prevTail, pace, C) && beforeOwn(b.prevTail, words) && (ev.voicedBeforeMs ?? 0) >= C.outsideMs && !contained(mine('prevTailText'), texts.expected)) {
      const prevComplete = bPrev && Array.isArray(bPrev.expected) && !absent(bPrev.expected.at(-1), paceOf(bPrev.expected), C);
      add(prevComplete ? 'AYAH_OVERLAP' : 'CUT_END', 'veryhigh', prevComplete ? `this file begins with the last words of ${ref(a - 1)} (${b.prevTail.added.prob} probability), which ${ref(a - 1)}'s own file also ends with: recited twice across the boundary` : `this file begins with the last words of ${ref(a - 1)} (${b.prevTail.added.prob}), missing from the end of ${ref(a - 1)}'s own file: the ending of ${ref(a - 1)} was attached to this file`, { adjacent: [ref(a - 1)], locationMs: [b.prevTail.added.startMs, b.prevTail.added.endMs] });
    }
    if (b.nextHead && found(b.nextHead, pace, C) && afterOwn(b.nextHead, words) && (ev.voicedAfterMs ?? 0) >= C.outsideMs && !contained(mine('nextHeadText'), texts.expected)) {
      const nextComplete = bNext && Array.isArray(bNext.expected) && !absent(bNext.expected[0], paceOf(bNext.expected), C);
      add(nextComplete ? 'AYAH_OVERLAP' : 'CUT_START', 'veryhigh', nextComplete ? `this file ends with the first words of ${ref(a + 1)} (${b.nextHead.added.prob} probability), which ${ref(a + 1)}'s own file also begins with: recited twice across the boundary` : `this file ends with the first words of ${ref(a + 1)} (${b.nextHead.added.prob}), missing from the beginning of ${ref(a + 1)}'s own file`, { adjacent: [ref(a + 1)], locationMs: [b.nextHead.added.startMs, b.nextHead.added.endMs] });
    }
    // The whole previous ayah recited again here; the whole next ayah run on into this file.
    if (a > 1 && found(b.prevFull, pace, C) && beforeOwn(b.prevFull, words) && (ev.voicedBeforeMs ?? 0) >= C.outsideMs && b.prevFull.added.minWordProb >= C.absentProb && textSimilarity(texts.prev ?? '', texts.expected ?? '') < C.nearIdentical) add('AYAH_SEQUENCE', 'veryhigh', `the whole of ${ref(a - 1)} is recited in this file before ${ref(a)} (${b.prevFull.added.prob} probability over every word): a repetition that breaks the file mapping`, { adjacent: [ref(a - 1)], locationMs: [b.prevFull.added.startMs, b.prevFull.added.endMs] });
    if (b.nextFull && found(b.nextFull, pace, C) && afterOwn(b.nextFull, words) && (ev.voicedAfterMs ?? 0) >= C.outsideMs && b.nextFull.added.minWordProb >= C.absentProb && textSimilarity(texts.next ?? '', texts.expected ?? '') < C.nearIdentical) add('AYAH_SEQUENCE', 'veryhigh', `the whole of ${ref(a + 1)} is recited in this file after ${ref(a)} (${b.nextFull.added.prob} probability over every word): the file runs on into the next ayah`, { adjacent: [ref(a + 1)], locationMs: [b.nextFull.added.startMs, b.nextFull.added.endMs] });
  }
  // ---- text scoring: only with corroboration
  if (a >= 1 && Number.isFinite(ev.score)) {
    const alt = ev.best?.text ?? '';
    const altKey = alt === 'prev' ? 'prev' : alt === 'next' ? 'next' : alt.startsWith('control') ? 'control' : null;
    const altText = altKey ? texts[altKey] ?? '' : '';
    const nearIdentical = altKey && textSimilarity(altText, texts.expected ?? '') >= C.nearIdentical;
    const transcriptAgrees = altKey && ev.bestSimilarity?.text && (ev.bestSimilarity.text === altKey || (altKey === 'control' && ev.bestSimilarity.text === 'control')) && ev.bestSimilarity.similarity + 0.03 > (ev.similarity ?? 0);
    const altAdj = altKey === 'prev' ? [ref(a - 1)] : altKey === 'next' ? [ref(a + 1)] : altKey === 'control' ? [String(alt).replace('control ', '')] : [];
    const preferred = Number.isFinite(ev.margin) && ev.margin <= 0;
    const ambiguous = Number.isFinite(ev.margin) && ev.margin > 0 && ev.margin < C.minMargin;
    // Clear: the other text wins by a margin, at a level where scores mean something (above the confirmation threshold).
    const clear = preferred && -ev.margin >= C.clearMargin && (ev.best?.score ?? 0) >= C.minScore;
    if (ev.score < C.unconfirmedScore && !out.some((o) => o.tier === 'veryhigh')) add('TEXT_UNCONFIRMED', 'exception', `the expected text scores ${ev.score}, below the median wrong-text control (${C.unconfirmedScore}): the automated check did not find this ayah in the file at all`);
    else if (nearIdentical && (preferred || ambiguous)) add('NEAR_IDENTICAL_TEXT', 'high', `${ref(a)} and ${altAdj[0]} have near-identical texts: text scoring cannot tell them apart (not evidence of a wrong file)`, { adjacent: altAdj });
    else if (clear && transcriptAgrees && altKey !== 'control') add('AYAH_SEQUENCE', 'veryhigh', `both the text alignment (${alt} ${ev.best.score} vs ${ev.score}) and the transcription (${ev.bestSimilarity.similarity} vs ${ev.similarity}) prefer ${altAdj[0]} to ${ref(a)}: the file may hold the neighbouring ayah`, { adjacent: altAdj });
    else if (clear && transcriptAgrees && altKey === 'control') add('WRONG_AYAH', 'veryhigh', `both the text alignment and the transcription prefer another ayah (${altAdj[0]}) to ${ref(a)}`, { adjacent: altAdj });
    else if (preferred) add('TEXT_CONFLICT', 'exception', `the text alignment prefers ${altAdj[0] ?? alt} (${ev.best.score} vs ${ev.score})${transcriptAgrees ? ' by too little, at too low a level, to be sure' : ', but the transcription does not'}: not resolved automatically`, { adjacent: altAdj });
  }
  // The same audio under two names: this file holds the other ayah only if its own text is NOT clearly found.
  if (has('near-duplicate')) {
    const nd = item.reasons.find((r) => r.startsWith('near-duplicate'));
    if (Number.isFinite(ev.score) && ev.score >= C.minScore) add('DUPLICATE_NOTE', 'high', `${nd}; this file's own text is clearly found (${ev.score}): the concern is the other file`);
    else add('TEXT_CONFLICT', 'exception', `${nd}; this file's own text is not clearly found (${ev.score}): which ayah it holds is not resolved automatically`);
  }
  if (has('stray-name') && out.some((o) => ['AYAH_SEQUENCE', 'WRONG_AYAH', 'TEXT_CONFLICT'].includes(o.code))) add('INCORRECT_MAPPING', 'veryhigh', item.reasons.find((r) => r.startsWith('stray-name')));
  if ((has('extra-before') || has('extra-after')) && !out.some((o) => ['AYAH_OVERLAP', 'AYAH_SEQUENCE', 'CUT_START', 'CUT_END'].includes(o.code))) {
    const ms = Math.max(ev.voicedBeforeMs ?? 0, ev.voicedAfterMs ?? 0);
    if (ms >= C.extraMs && !has('duration')) add('EXTRA_UNRESOLVED', 'exception', `${(ms / 1000).toFixed(1)} s of voiced audio outside the aligned words, but the file's length fits the ayah: either something else is recited or the alignment is wrong; not resolved automatically`);
    else if (ms >= C.extraMs) add('EXTRA_AYAH', 'veryhigh', `${(ms / 1000).toFixed(1)} s of voiced audio ${ev.voicedBeforeMs >= ev.voicedAfterMs ? 'before' : 'after'} the ayah's words that is not a neighbouring ayah: something else is recited in this file`, { locationMs: ev.voicedBeforeMs >= ev.voicedAfterMs ? [0, Math.max(500, (words?.[0]?.[1] ?? ev.voicedBeforeMs))] : [Math.max(0, (words?.at(-1)?.[2] ?? 0)), b?.durationMs ?? null] });
    else add('EXTRA_AUDIO', 'high', `${(ms / 1000).toFixed(1)} s of voiced audio outside the ayah's words (under ${C.extraMs / 1000} s and not a neighbouring ayah: a long madd, a breath or an echo)`);
  }
  // ---- identity
  const id = ctx.identity ?? {};
  if (has('identity')) add('IDENTITY_UNRESOLVED', 'exception', `${item.reasons.find((r) => r.startsWith('identity:'))?.replace(/^identity: /, '') ?? 'not found in the reference recording'}: an isolated file of another performance; that it is this reciter is not established`);
  if (has('identity-sample')) add('IDENTITY_UNRESOLVED', 'exception', 'this surah is another performance than the reference recording: confirm by ear that the voice is the reciter (this ayah stands for the surah)');
  const dependsOn = has('identity-surah') && id.sampleAyah ? id.sampleAyah : ctx.formatRun?.sample && ctx.formatRun.sample !== a ? ctx.formatRun.sample : null;
  if (has('identity-surah')) add('IDENTITY_OF_SURAH', 'high', `this surah is another performance than the reference recording: accepted automatically only once ayah ${id.sampleAyah ?? 1}'s voice is confirmed by a person`);
  if (ctx.formatRun) {
    if (ctx.formatRun.sample === a) add('IDENTITY_UNRESOLVED', 'exception', `${ctx.formatRun.size} consecutive files (${ctx.formatRun.from}–${ctx.formatRun.to}) are another encoding than the rest of the recording (${ctx.formatRun.format}): another source; confirm by ear that the voice is the reciter (this file stands for the run)`, { adjacent: [ctx.formatRun.from, ctx.formatRun.to] });
    else add('OTHER_SOURCE', 'high', `one of ${ctx.formatRun.size} files from another source (${ctx.formatRun.from}–${ctx.formatRun.to}): accepted automatically only once ${ref(ctx.formatRun.sample)}'s voice is confirmed by a person`);
  }
  // ---- everything else: uncertainty, not evidence of a serious problem
  const weak = ['text-weak', 'text-part', 'transcript-weak', 'text-ambiguous', 'transcript-mismatch'].filter(has);
  if (weak.length && !out.some((o) => o.tier === 'veryhigh' || o.code === 'TEXT_UNCONFIRMED' || o.code === 'TEXT_CONFLICT')) add('WEAK_TEXT', 'high', `weak or uncertain text evidence (${weak.join(', ')}): the boundary check found no missing words, cut edge, overlap or sequence problem`);
  for (const [c, code, tier] of [['duration', 'ABNORMAL_LENGTH', 'high'], ['internal-silence', 'LONG_SILENCE', 'high'], ['splice', 'STREAM_BREAK', 'high'], ['format', 'OTHER_ENCODING', 'check'], ['batch', 'OTHER_ENCODING', 'check'], ['cut-start', 'LOUD_EDGE', 'medium'], ['cut-end', 'LOUD_EDGE', 'medium'], ['lead-silence', 'SILENCE', 'medium'], ['trail-silence', 'SILENCE', 'medium'], ['clipping', 'CLIPPING', 'medium'], ['checksum', 'METADATA', 'check'], ['mistakes-folder', 'METADATA', 'check'], ['stray-name', 'METADATA', 'check'], ['tag-album', 'METADATA', 'check'], ['content-type', 'METADATA', 'check'], ['basmala-inside', 'BASMALA_TWICE', 'high']]) {
    if (has(c) && !(code === 'OTHER_ENCODING' && ctx.formatRun)) add(code, tier, `${item.reasons.find((r) => r.startsWith(c)) ?? c}: not a serious problem on its own (no corroborating boundary evidence)`);
  }
  // Every reason code the scan raised must be accounted for: an unknown one is treated as the most serious.
  const known = new Set(['missing', 'not-fetched', 'redirect', 'decode', 'too-short', 'text-unverified', 'tag-artist', 'text-mismatch', 'near-duplicate', 'stray-name', 'extra-before', 'extra-after', 'identity', 'identity-sample', 'identity-surah', 'text-weak', 'text-part', 'transcript-weak', 'text-ambiguous', 'transcript-mismatch', 'duration', 'internal-silence', 'splice', 'format', 'batch', 'cut-start', 'cut-end', 'lead-silence', 'trail-silence', 'clipping', 'checksum', 'mistakes-folder', 'tag-album', 'content-type', 'basmala-inside']);
  for (const c of item.codes ?? []) if (!known.has(c)) add('OTHER_STRUCTURAL', 'veryhigh', `unclassified scan reason ${c}: treated as serious until a rule exists`);
  if (has('text-mismatch') && !out.some((o) => ['AYAH_SEQUENCE', 'WRONG_AYAH', 'TEXT_CONFLICT', 'NEAR_IDENTICAL_TEXT', 'TEXT_UNCONFIRMED'].includes(o.code))) add('TEXT_CONFLICT', 'exception', item.reasons.find((r) => r.startsWith('text-mismatch')));
  // Second, independent evidence (clearance.py, --clearance): an EXCEPTION is resolved only when that evidence is clear
  //   TEXT_UNCONFIRMED, EXTRA_UNRESOLVED  the ayah's words aligned in context (previous + this + next file) inside this
  //                                       file, covering its voiced audio, above far wrong-text controls
  //   IDENTITY_UNRESOLVED (an isolated file of another performance)  that, AND the voice inside the reciter's own range
  // Never a Very High code, never a whole-surah voice sample or an encoding run (a person confirms those), never when
  // Very High evidence exists. The resolved code stays in the record, as high, with the evidence: administrative only.
  const cl = ctx.clearance;
  if (cl && !out.some((o) => o.tier === 'veryhigh')) {
    const ctxOk = cl.context?.cleared === true;
    const why = `cleared by independent evidence (per-ayah/clearance.py): in context (${cl.context?.neighbours?.join(', ')}) this ayah's words lie inside its file (${cl.context?.alignedMs?.join('–')} ms of ${cl.context?.fileMs?.join('–')}), cover ${Math.round((cl.context?.voicedCovered ?? 0) * 100)} % of its voiced audio and score ${cl.context?.score} against far controls ≤ ${Math.max(...(cl.context?.controls ?? [0]))}`;
    for (const o of out) {
      if (o.tier !== 'exception') continue;
      const isolatedIdentity = o.code === 'IDENTITY_UNRESOLVED' && has('identity') && !has('identity-sample') && !(ctx.formatRun?.sample === a);
      const ok = (o.code === 'TEXT_UNCONFIRMED' || o.code === 'EXTRA_UNRESOLVED') ? ctxOk : isolatedIdentity ? ctxOk && cl.voice?.cleared === true : false;
      if (!ok) continue;
      o.resolved = { by: 'clearance.py', previousTier: 'exception', evidence: { context: cl.context, ...(o.code === 'IDENTITY_UNRESOLVED' ? { voice: cl.voice } : {}) } };
      o.why = `${o.why} — ${why}${o.code === 'IDENTITY_UNRESOLVED' ? `; voice similarity ${cl.voice.similarity} to the reciter's located files (cleared at ≥ ${cl.voice.clearAt}: his own 1st percentile; other reciters far below)` : ''}`;
      o.tier = 'high';
    }
  }
  // one entry per code (the first, most specific)
  const seen = new Set();
  const codes = out.filter((o) => (seen.has(o.code) ? false : seen.add(o.code)));
  const tier = codes.length ? TIER_RANK.find((t) => codes.some((o) => o.tier === t)) : 'low';
  const limitations = ['automated: forced alignment (MMS_FA) and greedy transcription cannot prove that every word is recited correctly', ...(words ? [] : ['no word-level boundary evidence for this file (only neighbours of flagged files were checked)']), ...(ctx.identity?.checked ? [] : ['no full-surah reference recording to confirm the reciter'])];
  return {
    tier, codes, dependsOn: dependsOn ?? null,
    autoEligible: !['veryhigh', 'exception'].includes(tier) && !dependsOn,
    confidence: tier === 'veryhigh' ? (codes.some((o) => o.adjacent?.length) ? 'corroborated by the neighbouring file' : 'corroborated by two measurements of this file') : tier === 'exception' ? 'not assessable automatically' : tier === 'low' ? 'no automated reason to listen (not a verification)' : 'uncertain without evidence of a serious problem',
    limitations,
  };
}

/** The severity report: the classify.mjs report with every item's unified tier, codes and evidence. */
export function severityReport({ report, boundary, text, clearance = null, now = new Date().toISOString() }) {
  const C = calibrate(report, boundary);
  const items = report.items;
  const by = new Map(items.map((x) => [`${x.surah}:${x.ayah}`, x]));
  const bOf = (s, a) => boundary.files?.[`${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}`] ?? null;
  const words = (t) => (t ?? '').split(' ');
  // Runs of files of another encoding (scan 'format'), consecutive in one surah: one identity question per run.
  const runs = new Map();
  for (const s of new Set(items.map((x) => x.surah))) {
    const own = items.filter((x) => x.surah === s && x.ayah >= 1).sort((x, y) => x.ayah - y.ayah);
    let cur = [];
    const flush = () => { if (cur.length >= 3) { const r = { from: `${s}:${cur[0].ayah}`, to: `${s}:${cur.at(-1).ayah}`, size: cur.length, sample: cur[0].ayah, format: cur[0].reasons.find((x) => x.startsWith('format'))?.split(':').slice(1).join(':').trim().split(':')[0] ?? 'another format' }; for (const x of cur) runs.set(`${s}:${x.ayah}`, r); } cur = []; };
    for (const x of own) { if (x.codes?.includes('format')) { if (cur.length && cur.at(-1).ayah !== x.ayah - 1) flush(); cur.push(x); } else flush(); }
    flush();
  }
  const otherPerf = new Set(report.identity?.otherPerformanceSurahs ?? []);
  const out = items.map((item) => {
    const s = item.surah, a = item.ayah;
    const exp = text(s, a), prev = a > 1 ? text(s, a - 1) : '', next = text(s, a + 1) ?? '';
    const ctrlRef = item.evidence?.best?.text?.startsWith('control') ? item.evidence.best.text.replace('control ', '') : null;
    const [cs, ca] = ctrlRef ? ctrlRef.split(':').map(Number) : [];
    const sev = severityOf({
      item, prevItem: by.get(`${s}:${a - 1}`), nextItem: by.get(`${s}:${a + 1}`), b: bOf(s, a), bPrev: a > 1 ? bOf(s, a - 1) : null, bNext: bOf(s, a + 1), C,
      texts: { expected: exp, prev, next, control: ctrlRef ? text(cs, ca) : '', prevTailText: words(prev).slice(-3).join(' '), expectedHeadText: words(exp).slice(0, 3).join(' '), nextHeadText: words(next).slice(0, 3).join(' '), expectedTailText: words(exp).slice(-3).join(' ') },
      identity: { checked: !!report.identity, otherPerformance: otherPerf.has(s), sampleAyah: otherPerf.has(s) ? 1 : null }, formatRun: runs.get(`${s}:${a}`) ?? null,
      clearance: clearance?.items?.[`${s}:${a}`] ?? null,
    });
    const flagged = sev.tier !== 'low';
    return {
      ...item, risk: flagged ? 'high' : 'low', tier: sev.tier,
      reasons: sev.codes.map((o) => `${o.code} (${o.label}): ${o.why}`), codes: [...item.codes],
      severity: { rule: SEVERITY.id, ...sev, previous: { risk: item.risk, tier: item.tier ?? (item.risk === 'high' ? 'veryhigh (ungraded)' : 'low') } },
    };
  });
  const count = (f) => out.filter(f).length;
  const ayahs = out.filter((x) => x.ayah >= 1);
  const byCode = {};
  for (const x of out) for (const o of x.severity.codes) byCode[o.code] = (byCode[o.code] ?? 0) + 1;
  return {
    ...report, kind: 'per-ayah-risk', version: 2, createdOn: now.slice(0, 10), severity: { ...SEVERITY, createdAt: now, calibration: C, sourceReport: report.createdOn, ...(clearance ? { clearance: { voice: clearance.voice, items: Object.keys(clearance.items) } } : {}) },
    rule: 'unified per-ayah severity (per-ayah/severity.mjs): Very High only on corroborated evidence of a serious recitation problem; files that cannot be assessed are exceptions; weak or uncertain evidence alone is high / medium / check. Low is never a verification.',
    totals: {
      ...report.totals, low: count((x) => x.tier === 'low'), high: count((x) => x.risk === 'high'), byCode,
      byTier: Object.fromEntries(TIER_RANK.map((t) => [t, count((x) => x.tier === t)])), ayahsByTier: Object.fromEntries(TIER_RANK.map((t) => [t, ayahs.filter((x) => x.tier === t).length])),
    },
    items: out,
  };
}

// ---------------------------------------------------------------- command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
  if (!args.risk || !args.boundary || !args.out) throw new Error('usage: severity.mjs --risk <report> --boundary <boundary.json> --out <report>');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const T = new Map();
  for (const line of fs.readFileSync(path.join(here, '..', '..', 'quran-verification', 'input', 'quran-uthmani.txt'), 'utf8').split(/\r?\n/)) { const p = line.split('|'); if (p.length === 3 && /^\d+$/.test(p[0])) T.set(`${p[0]}:${p[1]}`, p[2]); }
  const B = T.get('1:1');
  const text = (s, a) => { const t = T.get(`${s}:${a}`); if (t == null) return null; if (a !== 1 || s === 1 || s === 9) return t; const ws = t.split(' '); return ws.slice(0, 4).map(bare).join(' ') === B.split(' ').map(bare).join(' ') ? ws.slice(4).join(' ') : t; };
  const clearance = args.clearance ? JSON.parse(fs.readFileSync(args.clearance, 'utf8')) : null;
  const rep = severityReport({ report: JSON.parse(fs.readFileSync(args.risk, 'utf8')), boundary: JSON.parse(fs.readFileSync(args.boundary, 'utf8')), text, clearance });
  fs.writeFileSync(args.out, JSON.stringify(rep));
  console.log(JSON.stringify({ out: args.out, calibration: rep.severity.calibration, ayahsByTier: rep.totals.ayahsByTier, byCode: rep.totals.byCode }, null, 1));
}
