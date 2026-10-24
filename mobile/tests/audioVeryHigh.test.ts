import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

// Phase 4.8.9: Very High Risk detection, policy auto-accept-v2 and the per-start Yes / No answers. SYNTHETIC data only.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const vh = await imp('review/manual/very-high.mjs');
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const auto = await imp('review/dashboard/auto-accept.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');

type J = any;
const syn = makeSynthetic({ surah: 112, key: 'syn-112' });
const STARTS = syn.truth.starts as number[];
const b = (ayah: number, flags: string[], extra: J = {}) => ({ ayah, ms: STARTS[ayah - 1], flags, priority: 1, ...extra });
const session = (boundaries: J[] = [], extra: J = {}) => ({ ...syn.session, synthetic: false, evidence: null, concerns: [], proposal: { source: 'aligned', fingerprint: 'fp', starts: Object.fromEntries(STARTS.map((ms, i) => [i + 1, ms])), endMs: syn.truth.endMs, boundaries: [{ ayah: 1, ms: STARTS[0], flags: [], priority: 3, opening: true }, ...boundaries], worklist: [], completeness: { collapsed_runs: [], missing_in_alignment: [] } }, ...extra });
const sweep = (from: number, to: number) => ({ sweep: { nearRatio: 0.5, atRatio: 9, nearestPauseRelativeMs: [from, to] } });

describe('very high risk: automatic evidence (pure)', () => {
  it('a displaced production start: >= 300 ms late (cut-off beginning) or early (overlap); closer or straddling is not', () => {
    const s = session([b(2, ['displaced'], sweep(-1200, -400)), b(3, ['displaced'], sweep(450, 900)), b(4, ['displaced'], sweep(-500, -200))]);
    const r = vh.staticVeryHigh(s);
    expect([...r.starts.keys()]).toEqual([2, 3]);
    expect(r.starts.get(2)).toMatch(/0\.40 s after the end of the pause: the beginning of ayah 2 may be cut off \(boundary sweep, an acoustic measurement\)/);
    expect(r.starts.get(3)).toMatch(/overlap/);
    expect(vh.staticVeryHigh(session([b(2, ['displaced'], sweep(-300, 300))])).starts.size).toBe(0); // straddles the start
  });

  it('reordered, past-own-end, opening-squeezed and sweep-displaced are very high; ordinary timing uncertainty is not', () => {
    const r = vh.staticVeryHigh(session([b(2, ['reordered'], { repairedFromMs: 4000 }), b(3, ['past-own-end']), b(4, ['opening-squeezed'])]));
    expect([...r.starts.keys()]).toEqual([2, 3, 4]);
    expect(r.starts.get(2)).toMatch(/out of order.*repaired by rule \(from 4\.00 s\), not heard/);
    expect(r.starts.get(3)).toMatch(/overlap/);
    expect(r.starts.get(4)).toMatch(/ayah 1 collapsed.*missing or truncated/);
    for (const f of ['no-pause', 'configs-disagree', 'shallow-pause', 'competing-pause', 'extra-audio', 'anchored', 'low-score', 'short-pause', 'snap-far', 'mp3quran-differs', 'unconfirmed', 'sweep-unconfirmed', 'listening-check']) expect(vh.staticVeryHigh(session([b(2, [f])])).starts.size, f).toBe(0);
  });

  it('whole recording: a documented repetition, or a Phase 4.5 verdict with repeated passages; not a single pass with conflicts', () => {
    expect(vh.staticVeryHigh(session([], { concerns: [{ kind: 'repetition', text: 'listen for a repetition' }] })).recording).toMatch(/documented repetition concern/);
    expect(vh.staticVeryHigh(session([], { concerns: [{ kind: 'content', text: 'extra audio after the last ayah' }] })).recording).toBeNull();
    const rifaat = (verdict: string, starts: J[] = []) => ({ ...syn.session, synthetic: false, proposal: null, evidence: { verdict, starts } });
    expect(vh.staticVeryHigh(rifaat('in order with repeated passages')).recording).toMatch(/returns to earlier ayahs/);
    expect(vh.staticVeryHigh(rifaat('in order, single pass', [{ ayah: 2, kind: 'conflict' }])).recording).toBeNull(); // e.g. a Quranic refrain
    expect(vh.staticVeryHigh(rifaat('weak evidence')).recording).toBeNull(); // inconclusive: not invented
  });

  it('risk tiers: very high replaces the tier (the old one kept in the reason); a whole-recording finding spares the opening', () => {
    const risk = lib.riskOf(session([b(2, ['reordered']), { ayah: 3, ms: STARTS[2], flags: ['no-pause'], priority: 1 }]));
    expect(risk.map((x: J) => x[0])).toEqual(['check', 'veryhigh', 'high', 'routine']);
    expect(risk[1][1]).toMatch(/^very high risk: the aligner put these very short ayahs out of order.*\(was high: /);
    expect(lib.riskOf(session([], { concerns: [{ kind: 'repetition', text: 'x' }] })).map((x: J) => x[0])).toEqual(['check', 'veryhigh', 'veryhigh', 'veryhigh']);
    expect(lib.riskOf(session([b(3, ['reordered'])], { scope: [2, 4] })).map((x: J) => x[0])).toEqual(['n/a', 'routine', 'n/a', 'routine']);
    expect(lib.TIERS[0]).toBe('veryhigh');
  });
});

describe('very high risk: the reviewers\' own findings', () => {
  const S = session();
  const st = () => { const s = manual.emptyState(); manual.applyEvent(S, s, { reviewer: 'TEST One', role: 1, type: 'join', payload: {}, at: 'x' }); return s; };
  it('No to this surah / every ayah / canonical order, a missing passage, a repetition returning to earlier ayahs', () => {
    const s = st();
    s.reviewers[1].work.checks = { order: 'no', extraAudio: 'no', playback: 'no' };
    s.reviewers[1].work.flags = [{ kind: 'missing-passage', fromMs: 1, toMs: 2, ayahs: [2, 3] }, { kind: 'repetition', implication: 'within-one-ayah', ayahs: [2, 2], fromMs: 1, toMs: 2 }];
    expect(vh.humanVeryHigh(s)).toEqual(['Reviewer 1 (TEST One) answered No: the ayahs are in canonical order', 'Reviewer 1 (TEST One) flagged a missing passage (2-3)']);
  });
  it('makes every start not yet accepted by a person manual (very high); a person\'s acceptance and rejection both stand', () => {
    const s = st();
    manual.applyEvent(S, s, { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: { markers: { 2: { ms: STARTS[1], status: 'confirmed' }, 3: { ms: STARTS[2], status: 'rejected' } }, end: null, flags: [], checks: { order: 'no' }, comments: '' } }, at: 'x' });
    manual.applyEvent(S, s, { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['2', '3'] }, at: 'x' });
    const task = { key: 'k', risk: [['check', ''], ['routine', ''], ['routine', ''], ['high', '']], proposal: { fingerprint: 'fp' } };
    const c = auto.classify(task, S, s);
    expect(c.map((x: J) => [x.ayah, x.decision, x.tier])).toEqual([[1, 'eligible', 'check'], [2, 'human-reviewed', 'routine'], [3, 'manual', 'veryhigh'], [4, 'manual', 'veryhigh']]);
    expect(c[3].why).toMatch(/whole recording: Reviewer 1 \(TEST One\) answered No: the ayahs are in canonical order/);
  });
});

describe('policy v2 and the ledger', () => {
  it('an earlier acceptance stops applying when its start becomes very high risk (the entry stays as history)', () => {
    const S = session([b(3, ['reordered'])]);
    const e = (ayah: number, tier: string, policy = 'auto-accept-v1') => ({ type: 'auto-accept', policy, key: 'k', ayah, tier, fingerprint: 'fp', proposedMs: STARTS[ayah - 1] });
    const eff = auto.effectiveAccepted(S, manual.emptyState(), [e(2, 'routine'), e(3, 'routine'), e(4, 'medium', 'auto-accept-v2')]);
    expect([...eff.keys()]).toEqual(['2', '4']);
    const rep = auto.effectiveAccepted(session([], { concerns: [{ kind: 'repetition', text: 'x' }] }), manual.emptyState(), [e(2, 'check'), { type: 'auto-accept', key: 'k', ayah: 1, tier: 'check', fingerprint: 'fp', proposedMs: 0, rule: 'opening-zero-v1' }]);
    expect([...rep.keys()]).toEqual(['1']); // the opening stays accepted; the rest needs a person
  });
});

describe('per-start Yes / No answers (manual-lib)', () => {
  const S = session();
  const yes = (confirmed = false) => ({ v: 'yes', confirmed });
  const all = (over: J = {}) => ({ complete: yes(), order: yes(), overlap: yes(), timestamp: yes(), aligned: yes(), ...over });
  const work = (markers: J) => ({ markers, end: null, flags: [], checks: {}, comments: '' });
  const fresh = () => { const s = manual.emptyState(); manual.applyEvent(S, s, { reviewer: 'TEST One', role: 1, type: 'join', payload: {}, at: 'x' }); return s; };
  const ev = (s: J, type: string, payload: J) => manual.applyEvent(S, s, { reviewer: 'TEST One', role: 1, type, payload, at: 'x' });

  it('defaults and confirmed answers are stored apart; a No cannot be confirmed (it rejects the start); bad answers are refused', () => {
    expect(Object.keys(manual.QUESTIONS)).toEqual(['complete', 'order', 'overlap', 'timestamp', 'aligned']);
    expect(manual.validateWork(S, work({ 2: { ms: STARTS[1], status: 'confirmed', answers: all({ timestamp: yes(true) }) } }))).toEqual([]);
    expect(manual.validateWork(S, work({ 2: { ms: STARTS[1], status: 'confirmed', answers: all({ order: { v: 'no', confirmed: true } }) } })).join()).toMatch(/answered No to "Is the ayah in the correct order\?" but confirmed: reject it instead/);
    expect(manual.validateWork(S, work({ 2: { ms: STARTS[1], status: 'rejected', answers: all({ order: { v: 'no', confirmed: true } }) } }))).toEqual([]);
    expect(manual.validateWork(S, work({ 2: { ms: STARTS[1], status: 'confirmed', answers: { order: { v: 'maybe', confirmed: true } } } })).join()).toMatch(/must be yes or no/);
    expect(manual.validateWork(S, work({ 2: { ms: STARTS[1], status: 'confirmed', answers: { tempo: yes() } } })).join()).toMatch(/unknown question tempo/);
    expect(manual.validateWork(S, work({ 2: { ms: STARTS[1], status: 'confirmed' } }))).toEqual([]); // work from before Phase 4.8.9
  });

  it('nothing is submitted by answering; submitted answers are frozen with the start (changed only by a correction)', () => {
    const s = fresh();
    ev(s, 'draft', { work: work({ 2: { ms: STARTS[1], status: 'confirmed', answers: all({ complete: yes(true) }) } }) });
    expect(s.reviewers[1].submitted).toEqual({});
    ev(s, 'submit-ayahs', { keys: ['2'] });
    expect(s.reviewers[1].submitted['2'].answers.complete).toEqual({ v: 'yes', confirmed: true });
    expect(() => ev(s, 'draft', { work: work({ 2: { ms: STARTS[1], status: 'confirmed', answers: all() } }) })).toThrow(/was submitted: change it with a correction/);
    expect(() => ev(s, 'revise', { key: '2', marker: { ms: STARTS[1], status: 'confirmed', answers: all({ complete: yes(true) }) }, reason: 'TEST' })).toThrow(/nothing changed/);
    ev(s, 'revise', { key: '2', marker: { ms: STARTS[1], status: 'rejected', answers: all({ complete: { v: 'no', confirmed: true } }) }, reason: 'TEST heard a cut' });
    expect(s.reviewers[1].submitted['2']).toMatchObject({ status: 'rejected', rev: 2, answers: { complete: { v: 'no', confirmed: true } } });
    expect(s.reviewers[1].revisions[0].before.answers.complete).toEqual({ v: 'yes', confirmed: true });
  });
});
