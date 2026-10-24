import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// Phase 4.8.10: the unified per-ayah severity (Mohamed Gebril, Ali Abdullah Jaber, any per-ayah reciter): Very High only
// on corroborated evidence of a serious recitation problem, exceptions for what cannot be assessed, everything else
// accepted automatically when eligible. SYNTHETIC evidence only.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const sev = await imp('per-ayah/severity.mjs');
const auto = await imp('review/dashboard/auto-accept.mjs');
const vh = await imp('review/manual/very-high.mjs');
const manual = await imp('review/manual/manual-lib.mjs');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-severity-'));
afterAll(() => { try { rmSync(work, { recursive: true, force: true }); } catch { /* temp only */ } });

const C = { foundProb: 0.4, foundVoiced: 0.6, foundPace: 0.5, squeezePace: 0.35, absentProb: 0.15, unconfirmedScore: 0.21, minScore: 0.4, minMargin: 0.08, nearIdentical: 0.75, extraMs: 3000, edgeVoiced: 0.5, outsideMs: 800, clearMargin: 0.05 };
// A word: [probability, startMs, endMs, letters, voiced]; real words take ~80 ms per letter.
const W = (p: number, st: number, letters = 5, ms = 80 * letters): number[] => [p, st, st + ms, letters, 1];
const ABSENT = (st: number, letters = 5): number[] => [0.05, st, st + 20, letters, 1];
/** A clean 6-word file of 3 s, starting after 300 ms of silence. */
const clean = (over: J = {}) => ({ durationMs: 3200, voicedFirst100: 0, voicedLast100: 0, expected: [W(0.8, 300), W(0.8, 700), W(0.8, 1100), W(0.8, 1500), W(0.8, 1900), W(0.8, 2300)], ...over });
const run = (prob: number, over: J = {}, expected: J = {}) => ({ added: { prob, startMs: 300, endMs: 1100, msPerLetter: 80, voiced: 1, minWordProb: prob, ...over }, expected: { startMs: 1200, endMs: 3600, ...expected } });
/** A file that BEGINS with 1.2 s of other recitation (its own words from 1200 ms), and its evidence of voiced audio there. */
const shifted = (over: J = {}) => clean({ expected: [W(0.8, 1200), W(0.8, 1600), W(0.8, 2000), W(0.8, 2400)], ...over });
/** A file that ENDS with other recitation after its own words (which end at 1900 ms). */
const tailing = (over: J = {}) => clean({ expected: [W(0.8, 300), W(0.8, 700), W(0.8, 1100), W(0.8, 1500)], ...over });
const after = (prob: number) => ({ added: { prob, startMs: 2000, endMs: 2900, msPerLetter: 80, voiced: 1, minWordProb: prob }, expected: { startMs: 300, endMs: 1900 } });
const item = (over: J = {}) => ({ ref: '2:10', surah: 2, ayah: 10, file: '002010.mp3', risk: 'high', codes: [], reasons: [], evidence: { score: 0.7, margin: 0.3, similarity: 0.7, best: { text: 'next', score: 0.4 }, bestSimilarity: { text: 'next', similarity: 0.4 } }, ...over });
const TEXTS = { expected: 'فِى قُلُوبِهِم مَّرَضٌ فَزَادَهُمُ ٱللَّهُ مَرَضًا', prev: 'يُخَـٰدِعُونَ ٱللَّهَ وَٱلَّذِينَ ءَامَنُوا۟', next: 'وَإِذَا قِيلَ لَهُمْ لَا تُفْسِدُوا۟ فِى ٱلْأَرْضِ', control: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ', prevTailText: 'وَٱلَّذِينَ ءَامَنُوا۟ وَمَا', expectedHeadText: 'فِى قُلُوبِهِم مَّرَضٌ', nextHeadText: 'وَإِذَا قِيلَ لَهُمْ', expectedTailText: 'ٱللَّهُ مَرَضًا وَلَهُمْ' };
const S = (over: J = {}) => sev.severityOf({ item: item(over.item ?? {}), prevItem: over.prevItem ?? null, nextItem: over.nextItem ?? null, b: over.b === undefined ? clean() : over.b, bPrev: over.bPrev ?? clean(), bNext: over.bNext ?? clean(), C, texts: { ...TEXTS, ...(over.texts ?? {}) }, identity: { checked: true, ...(over.identity ?? {}) }, formatRun: over.formatRun ?? null });
const codes = (r: J) => r.codes.map((x: J) => x.code);

describe('serious risks: Very High only with corroboration', () => {
  it('ayah cut at its beginning: the first word squeezed at a voiced file start', () => {
    const r = S({ b: clean({ voicedFirst100: 1, expected: [ABSENT(0), W(0.8, 40), W(0.8, 440), W(0.8, 840)] }) });
    expect(r.tier).toBe('veryhigh');
    expect(r.codes[0]).toMatchObject({ code: 'CUT_START', label: 'Cut Beginning', locationMs: [0, 400] });
    expect(r.autoEligible).toBe(false);
  });
  it('ayah cut at its end: the last word squeezed at a voiced file end', () => {
    const r = S({ b: clean({ voicedLast100: 1, expected: [W(0.8, 300), W(0.8, 700), W(0.8, 1100), ABSENT(3180)] }) });
    expect(codes(r)).toEqual(['CUT_END']);
    expect(r.codes[0].label).toBe('Cut Ending');
  });
  it('last words moved to the next file: this file lacks them and the next file begins with them', () => {
    const r = S({ b: clean({ expected: [W(0.8, 300), W(0.8, 700), W(0.8, 1100), ABSENT(1500)] }), bNext: shifted({ prevTail: run(0.75) }), nextItem: { evidence: { voicedBeforeMs: 1200 } } });
    expect(r.codes[0]).toMatchObject({ code: 'CUT_END', adjacent: ['2:11'] });
  });
  it('first words attached to the previous file: this file lacks them and the previous file ends with them', () => {
    const r = S({ b: clean({ expected: [ABSENT(300), W(0.8, 320), W(0.8, 720)] }), bPrev: tailing({ nextHead: after(0.7) }), prevItem: { evidence: { voicedAfterMs: 1000 } } });
    expect(r.codes[0]).toMatchObject({ code: 'CUT_START', adjacent: ['2:9'] });
  });
  it('overlapping neighbouring files: the file begins with the previous ayah\'s end, which the previous file also holds', () => {
    const r = S({ b: shifted({ prevTail: run(0.72) }), item: { evidence: { score: 0.7, margin: 0.3, similarity: 0.7, voicedBeforeMs: 1100, best: { text: 'next', score: 0.3 } } } });
    expect(r.codes[0]).toMatchObject({ code: 'AYAH_OVERLAP', label: 'Ayah Overlap', adjacent: ['2:9'] });
    const tail = S({ b: tailing({ nextHead: after(0.7) }), item: { evidence: { score: 0.7, margin: 0.3, similarity: 0.7, voicedAfterMs: 1000, best: { text: 'next', score: 0.3 } } } });
    expect(tail.codes[0]).toMatchObject({ code: 'AYAH_OVERLAP', adjacent: ['2:11'] });
  });
  it('shared or parallel words are not enough: no overlap without audio of their own outside the ayah', () => {
    const ev = { score: 0.7, margin: 0.3, similarity: 0.7, voicedBeforeMs: 1100, best: { text: 'next', score: 0.3 } };
    // the neighbour's last words also occur in this ayah's own text (94:5 / 94:6, a refrain)
    expect(S({ b: shifted({ prevTail: run(0.72) }), item: { evidence: ev }, texts: { prevTailText: 'مَرَضٌ فَزَادَهُمُ ٱللَّهُ' } }).tier).not.toBe('veryhigh');
    // found, but on the ayah's own first words (no audio of their own before them)
    expect(S({ b: clean({ prevTail: run(0.72, { startMs: 300, endMs: 1100 }, { startMs: 300 }) }), item: { evidence: ev } }).tier).not.toBe('veryhigh');
    // found before the words, but the scan measured no voiced audio there
    expect(S({ b: shifted({ prevTail: run(0.72) }), item: { evidence: { ...ev, voicedBeforeMs: 100 } } }).tier).not.toBe('veryhigh');
  });
  it('the previous ayah repeated in the file, or the next one run on into it', () => {
    const ev = { score: 0.7, margin: 0.3, similarity: 0.7, voicedBeforeMs: 1100, voicedAfterMs: 1000, best: { text: 'next', score: 0.3 } };
    expect(S({ b: shifted({ prevFull: run(0.7, { minWordProb: 0.5 }) }), item: { evidence: ev } }).codes[0]).toMatchObject({ code: 'AYAH_SEQUENCE', label: 'Incorrect Ayah Sequence' });
    expect(S({ b: tailing({ nextFull: after(0.7) }), item: { evidence: ev } }).codes[0]).toMatchObject({ code: 'AYAH_SEQUENCE', adjacent: ['2:11'] });
  });
  it('word-level claims need the present words clearly recognised (a weakly matched file is not "cut")', () => {
    const weak = clean({ voicedLast100: 1, expected: [W(0.3, 300), W(0.3, 700), W(0.3, 1100), ABSENT(3180)] });
    expect(codes(S({ b: weak, item: { codes: ['text-weak'], evidence: { score: 0.3, margin: 0.2, similarity: 0.4, best: { text: 'next', score: 0.1 } } } }))).not.toContain('CUT_END');
  });
  it('missing content: two consecutive words squeezed inside the file', () => {
    const r = S({ b: clean({ expected: [W(0.8, 300), ABSENT(700), ABSENT(720), W(0.8, 740), W(0.8, 1140)] }) });
    expect(codes(r)).toEqual(['MISSING_CONTENT']);
    expect(r.codes[0].label).toBe('Missing Quran Content');
  });
  it('incorrect verse order: the text alignment (clearly) AND the transcription both prefer the next ayah (different text)', () => {
    const r = S({ item: { codes: ['text-mismatch', 'transcript-mismatch'], evidence: { score: 0.5, margin: -0.05, similarity: 0.4, best: { text: 'next', score: 0.55 }, bestSimilarity: { text: 'next', similarity: 0.5 } } } });
    expect(r.codes[0]).toMatchObject({ code: 'AYAH_SEQUENCE', adjacent: ['2:11'] });
    // a tie at noise level is not a finding: unresolved, never accepted automatically
    const tie = S({ item: { codes: ['text-mismatch', 'transcript-mismatch'], evidence: { score: 0.25, margin: -0.01, similarity: 0.3, best: { text: 'next', score: 0.26 }, bestSimilarity: { text: 'next', similarity: 0.33 } } } });
    expect(tie.codes[0]).toMatchObject({ code: 'TEXT_CONFLICT', tier: 'exception' });
    // the correct ayah only slightly ahead of a neighbour: high, not very high
    expect(S({ item: { codes: ['text-ambiguous', 'transcript-mismatch'], evidence: { score: 0.5, margin: 0.02, similarity: 0.4, best: { text: 'next', score: 0.48 }, bestSimilarity: { text: 'next', similarity: 0.45 } } } }).tier).toBe('high');
  });
  it('the same audio under two names: unresolved where this file\'s own text is not found, a note where it is', () => {
    const nd = { codes: ['near-duplicate'], reasons: ['near-duplicate: 44:1: audio almost identical to 68:27'] };
    expect(S({ item: { ...nd, evidence: { score: 0.28, margin: 0.2, similarity: 0.3, best: { text: 'next', score: 0.1 } } } }).codes[0]).toMatchObject({ code: 'TEXT_CONFLICT', tier: 'exception' });
    expect(S({ item: { ...nd, evidence: { score: 0.63, margin: 0.3, similarity: 0.6, best: { text: 'next', score: 0.1 } } } }).tier).toBe('high');
  });
  it('extra recitation: very high when the file\'s length is abnormal too; unresolved when the two measurements disagree', () => {
    const ev = { score: 0.6, margin: 0.3, similarity: 0.6, voicedBeforeMs: 6000, best: { text: 'next', score: 0.1 } };
    expect(S({ item: { codes: ['extra-before', 'duration'], reasons: ['extra-before: 6 s', 'duration: much longer'], evidence: ev } }).codes[0]).toMatchObject({ code: 'EXTRA_AYAH', tier: 'veryhigh' });
    expect(S({ item: { codes: ['extra-before'], reasons: ['extra-before: 6 s'], evidence: ev } }).codes[0]).toMatchObject({ code: 'EXTRA_UNRESOLVED', tier: 'exception' });
  });
  it('an incorrect ayah assigned to the file name: both methods prefer a far ayah; with a mis-named file, incorrect mapping', () => {
    const ev = { score: 0.5, margin: -0.1, similarity: 0.3, best: { text: 'control 112:1', score: 0.6 }, bestSimilarity: { text: 'control', similarity: 0.5 } };
    expect(S({ item: { codes: ['text-mismatch', 'transcript-mismatch'], evidence: ev } }).codes[0]).toMatchObject({ code: 'WRONG_AYAH', label: 'Wrong Ayah' });
    expect(codes(S({ item: { codes: ['text-mismatch', 'transcript-mismatch', 'stray-name'], reasons: ['stray-name: x'], evidence: ev } }))).toContain('INCORRECT_MAPPING');
  });
  it('wrong reciter: the file\'s own tags name another reciter', () => {
    const r = S({ item: { codes: ['tag-artist'], reasons: ['tag-artist: artist tag "Sudais"'] } });
    expect(r.codes[0]).toMatchObject({ code: 'WRONG_RECITER', label: 'Wrong Reciter / Riwayah' });
  });
  it('an unknown scan reason is treated as serious, never silently downgraded', () => {
    expect(S({ item: { codes: ['something-new'] } }).codes[0]).toMatchObject({ code: 'OTHER_STRUCTURAL', tier: 'veryhigh' });
  });
});

describe('not serious on their own', () => {
  it('a valid intentional repetition inside one ayah: a longer file, every word present, no neighbour content', () => {
    const r = S({ item: { codes: ['duration', 'extra-after'], reasons: ['duration: much longer', 'extra-after: 2.0 s'], evidence: { score: 0.7, margin: 0.3, similarity: 0.7, voicedAfterMs: 2000, best: { text: 'next', score: 0.3 } } } });
    expect(r.tier).toBe('high');
    expect(codes(r)).toEqual(['EXTRA_AUDIO', 'ABNORMAL_LENGTH']);
    expect(r.autoEligible).toBe(true);
  });
  it('normal pauses and breathing: silences and a long internal pause with every word present', () => {
    const r = S({ item: { codes: ['lead-silence', 'internal-silence'], reasons: ['lead-silence: 3.4 s', 'internal-silence: 3.8 s'] } });
    expect(r.tier).toBe('high');
    expect(r.codes.every((x: J) => x.tier !== 'veryhigh')).toBe(true);
    expect(S({ item: { codes: ['lead-silence', 'clipping'], reasons: [] } }).tier).toBe('medium');
  });
  it('weak text alone (low ASR confidence) is high and eligible; near-identical neighbour texts are no evidence of a wrong file', () => {
    expect(S({ item: { codes: ['text-weak', 'transcript-weak', 'text-part'], evidence: { score: 0.33, margin: 0.2, similarity: 0.3, best: { text: 'next', score: 0.1 } } } })).toMatchObject({ tier: 'high', autoEligible: true });
    const twin = S({ item: { codes: ['text-mismatch', 'transcript-mismatch'], evidence: { score: 0.6, margin: -0.02, similarity: 0.6, best: { text: 'next', score: 0.62 }, bestSimilarity: { text: 'next', similarity: 0.65 } } }, texts: { next: TEXTS.expected } });
    expect(twin.codes[0].code).toBe('NEAR_IDENTICAL_TEXT');
    expect(twin.tier).toBe('high');
  });
  it('harmless differences between authentic performances: another encoding or performance waits for one voice check', () => {
    const run3 = { from: '4:60', to: '4:62', size: 3, sample: 60, format: '11025 Hz mono' };
    const sample = S({ item: { ayah: 60, codes: ['format'], reasons: ['format: 11025 Hz'] }, formatRun: run3 });
    expect(sample.codes[0]).toMatchObject({ code: 'IDENTITY_UNRESOLVED', tier: 'exception' });
    const member = S({ item: { ayah: 61, codes: ['format'], reasons: ['format: 11025 Hz'] }, formatRun: run3 });
    expect(member).toMatchObject({ tier: 'high', dependsOn: 60, autoEligible: false });
    expect(S({ item: { ayah: 7, codes: ['identity-surah'] }, identity: { sampleAyah: 1 } })).toMatchObject({ tier: 'high', dependsOn: 1 });
  });
});

describe('unresolved exceptions', () => {
  it('missing or unreadable files, an unconfirmed text, two methods in conflict, a check that could not run', () => {
    expect(S({ item: { codes: ['decode'], reasons: ['decode: cannot be read'] } }).codes[0]).toMatchObject({ code: 'FILE_UNAVAILABLE', tier: 'exception' });
    expect(S({ item: { codes: ['text-weak'], evidence: { score: 0.12, margin: 0.01, similarity: 0.2, best: { text: 'next', score: 0.11 } } } }).codes[0]).toMatchObject({ code: 'TEXT_UNCONFIRMED', tier: 'exception' });
    expect(S({ item: { codes: ['text-mismatch'], evidence: { score: 0.5, margin: -0.03, similarity: 0.6, best: { text: 'next', score: 0.53 }, bestSimilarity: { text: 'prev', similarity: 0.3 } } } }).codes[0]).toMatchObject({ code: 'TEXT_CONFLICT', tier: 'exception' });
    expect(S({ b: null, item: { codes: ['text-weak'] } }).codes[0]).toMatchObject({ code: 'CHECK_MISSING', tier: 'exception' });
  });
});

describe('the policy in the dashboard (auto-accept-v2 with per-ayah severity)', () => {
  const risk = { 2: { risk: 'high', tier: 'veryhigh', reasons: ['CUT_START'], severity: { codes: [{ code: 'CUT_START', tier: 'veryhigh', label: 'Cut Beginning', why: 'first word squeezed' }] } }, 3: { risk: 'high', tier: 'high', reasons: ['WEAK_TEXT'] }, 4: { risk: 'high', tier: 'medium', reasons: ['SILENCE'] }, 5: { risk: 'high', tier: 'check', reasons: ['METADATA'] }, 6: { risk: 'low', tier: 'low', reasons: [] }, 7: { risk: 'high', tier: 'exception', reasons: ['TEXT_UNCONFIRMED'], severity: { codes: [{ code: 'TEXT_UNCONFIRMED', tier: 'exception', label: 'Unresolved: ayah text not confirmed', why: 'not found' }] } }, 8: { risk: 'high', tier: 'high', reasons: ['OTHER_SOURCE'], severity: { codes: [], dependsOn: 5 } } };
  const starts = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, 1000 * (i + 1)]));
  const session = { surah: 110, ayahCount: 8, durationMs: 10000, synthetic: false, proposal: { source: 'per-ayah', fingerprint: 'fp', starts, endMs: 9500, boundaries: [], worklist: [], completeness: { collapsed_runs: [], missing_in_alignment: [] }, perAyah: { risk } } };
  const task = { key: 'k', reciterId: 'gebril', surah: 110, risk: [['check', ''], ['veryhigh', ''], ['high', ''], ['medium', ''], ['check', ''], ['routine', ''], ['high', ''], ['high', '']], proposal: { fingerprint: 'fp' } };
  const st = manual.emptyState();

  it('very high is never accepted; high, medium, check, routine are; exceptions and unmet voice checks stay blocked', () => {
    const c = auto.classify(task, session, st);
    expect(c.map((x: J) => [x.ayah, x.decision])).toEqual([[1, 'eligible'], [2, 'manual'], [3, 'eligible'], [4, 'eligible'], [5, 'eligible'], [6, 'eligible'], [7, 'blocked'], [8, 'blocked']]);
    expect(c[1].why).toMatch(/Cut Beginning: first word squeezed/);
    expect(c[6].why).toMatch(/^unresolved exception: Unresolved: ayah text not confirmed/);
    expect(c[7].why).toMatch(/waits for a person to confirm the voice at ayah 5/);
  });

  it('a person\'s acceptance of the sample releases the files that depend on it; automatic acceptance never counts as that', () => {
    const s2 = manual.emptyState();
    manual.applyEvent(session, s2, { reviewer: 'TEST One', role: 1, type: 'join', payload: {}, at: 'x' });
    manual.applyEvent(session, s2, { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: { markers: { 5: { ms: 5000, status: 'confirmed' } }, end: null, flags: [], checks: {}, comments: '' } }, at: 'x' });
    manual.applyEvent(session, s2, { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['5'] }, at: 'x' });
    expect(auto.classify(task, session, s2).find((x: J) => x.ayah === 8).decision).toBe('eligible');
    const autoOnly = auto.effectiveAccepted(session, st, [{ type: 'auto-accept', ayah: 5, tier: 'check', fingerprint: 'fp', proposedMs: 5000 }]);
    expect(autoOnly.has('5')).toBe(true);
    expect(auto.classify(task, session, st).find((x: J) => x.ayah === 8).decision).toBe('blocked'); // still waiting
  });

  it('an older acceptance that no longer applies gets ONE withdrawal record; the acceptance itself stays', () => {
    const L = auto.openLedger(join(work, 'ledger.jsonl'));
    L.append([2, 3, 7].map((a) => ({ type: 'auto-accept', policy: 'auto-accept-v1', key: 'k', ayah: a, tier: 'routine', fingerprint: 'fp', proposedMs: starts[a] })));
    const before = L.entries().map((e: J) => JSON.stringify(e));
    const w = auto.planWithdrawals({ tasks: [task], load: () => ({ session, state: st }), ledger: L, run: 'r' });
    expect(w.map((e: J) => [e.ref, e.ayah])).toEqual([[1, 2], [3, 7]]);
    expect(w[0].why).toMatch(/^very high risk: Cut Beginning/);
    L.append(w);
    expect(L.entries().slice(0, 3).map((e: J) => JSON.stringify(e))).toEqual(before); // history untouched
    expect(auto.planWithdrawals({ tasks: [task], load: () => ({ session, state: st }), ledger: L, run: 'r2' })).toEqual([]); // once only
    expect(L.append(w)).toEqual([]); // and never written twice
    expect(manual.verifyChain(L.entries())).toBe(-1);
    expect([...auto.effectiveAccepted(session, st, L.entries()).keys()]).toEqual(['3']);
  });

  it('the very high reason names the exact problem', () => {
    expect(vh.staticVeryHigh(session).starts.get(2)).toBe('Cut Beginning: first word squeezed');
    expect(vh.perAyahBlock(session, 3)).toBeNull();
  });
});
