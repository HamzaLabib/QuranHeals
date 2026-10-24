import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 4.8.7: automatic acceptance by risk tier (check / routine accepted, medium / high left to a person).
// SYNTHETIC recordings and test reviewer names only; temporary workspaces, ledgers and backups.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const auto = await imp('review/dashboard/auto-accept.mjs');
const { createDashboard } = await imp('review/dashboard/server.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');
const { timingFingerprint } = await imp('fingerprint.mjs');
const { buildExport } = await imp('review/manual/export.mjs');
const rules = await imp('review/cloud/publication-rules.mjs');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-auto-'));
afterAll(() => { try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp only */ } });

// ================================================================ synthetic packages with every tier
const syn = makeSynthetic({ surah: 112, key: 'syn-112' });
const { text } = lib.canon();
const BAS = text.get('1:1');
/** A package of surah 112 (4 ayahs) or 108 (3 ayahs); `prio` gives each boundary's priority (ayah 2..n). */
function pkg(reciterId: string, surah: number, prio: number[], { reorder, ...extra }: J = {}) {
  const n = lib.canon().meta.get(surah).ayahs;
  const starts = syn.truth.starts.slice(0, n);
  const ayahs = Array.from({ length: n }, (_, k) => { const t = text.get(`${surah}:${k + 1}`) as string; return { ayah: k + 1, startMs: starts[k], endMs: k + 1 < n ? starts[k + 1] : syn.truth.endMs, text: k === 0 ? t.split(' ').slice(BAS.split(' ').length).join(' ') : t }; });
  const p: J = { kind: 'ayah-timing-review-package', version: 1, source: 'aligned', createdOn: '2026-10-20', reciterId, reciterEn: 'x', reciterAr: 'x', recording: 'test', surah, surahAr: 'x', surahEn: `S${surah}`, ayahCount: n,
    url: `https://cdn.mp3quran.net/audio/test-${reciterId}/${surah}.mp3`, bytes: syn.wav.length, format: { kbps: 128, mode: 'cbr', durationMs: syn.session.durationMs }, textSource: 't', status: 's', durationMs: syn.session.durationMs, intro: null, basmala: BAS, ayahs,
    boundaries: ayahs.slice(1).map((a, k) => ({ ayah: a.ayah, ms: a.startMs, flags: prio[k] === 1 ? ['no-pause'] : prio[k] === 2 ? ['low-score'] : [], priority: prio[k], pauseMs: null })), worklist: [2], structure: { ok: true, problems: [] },
    completeness: { collapsed: 0, collapsed_runs: [], missing_in_alignment: [] }, ...extra };
  // Phase 4.8.9: a boundary the aligner had out of order (repaired by rule): very high risk evidence.
  if (reorder) p.boundaries.find((b: J) => b.ayah === reorder).flags = ['reordered'];
  p.candidateFingerprint = timingFingerprint(p.ayahs.map((a: J) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs })));
  return p;
}
// risk of surah 112 (4 ayahs) with prio [3,3,3]: 1 check (opening), 2 check (worklist), 3-4 routine
const PACKAGES: [string, number, number[], J?][] = [
  ['sufi', 112, [3, 3, 3]], // only check/routine: completes automatically
  ['sufi', 108, [3, 3]],
  ['maher', 112, [3, 2, 3]], // ayah 3 medium: Maher cannot complete
  ['banna', 112, [1, 3, 3]], // ayah 2 high
  ['banna', 108, [3, 3], { completeness: { collapsed: 1, collapsed_runs: ['1'], missing_in_alignment: [] } }], // ayah 1 collapsed: blocked
  ['ajmi', 112, [3, 3, 3]], // a reviewer will reject / edit / mark uncertain some starts first
  ['yasser-salama', 112, [3, 1, 3], { reorder: 3 }], // ayah 3: very high risk (reordered): never accepted automatically
];
function writePackages(dir: string, list: typeof PACKAGES) {
  for (const [r] of list) mkdirSync(join(dir, 'aligned', r), { recursive: true });
  for (const [r, s, p, x] of list) writeFileSync(join(dir, 'aligned', r, `${s}.json`), JSON.stringify(pkg(r, s, p, x)));
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ kind: 'ayah-timing-review-index', packages: list.map(([r, s]) => ({ file: `aligned/${r}/${s}.json` })) }));
}
function workspace() {
  writePackages(join(work, 'packages'), PACKAGES);
  const ws = join(work, 'ws');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'dashboard.config.json'), JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: 'backups', python: 'python',
    sources: [{ id: 'pk', kind: 'review-packages', phase: 'T', dir: '../packages' }] }));
  return join(ws, 'dashboard.config.json');
}
const CFG = workspace();
const DATA = join(work, 'ws', 'data');
const LEDGER = auto.ledgerFile(DATA);
const readLedger = () => readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const logsSnapshot = () => Object.fromEntries(readdirSync(DATA).filter((k) => existsSync(join(DATA, k, 'events.jsonl'))).map((k) => [k, readFileSync(join(DATA, k, 'events.jsonl'), 'utf8')]));
const full = (n: number, f: (a: number) => J = () => ({})) => ({ markers: Object.fromEntries(syn.truth.starts.slice(0, n).map((ms: number, i: number) => [i + 1, { ms, status: 'confirmed', ...f(i + 1) }])), end: null, flags: [], checks: {}, comments: '' });

// ================================================================ the rule (pure)
describe('the policy, start by start (pure)', () => {
  const t = (risk: J[]) => ({ key: 'k', reciterId: 'sufi', surah: 112, risk, proposal: { fingerprint: 'fp' } });
  const session = { durationMs: 20000, proposal: { fingerprint: 'fp', starts: { 1: 1000, 2: 5000, 3: 9000, 4: 13000 }, endMs: 17000, completeness: { collapsed_runs: [] } } };
  const st = manual.emptyState();

  it('policy v2: high, medium, check and routine are eligible; very high needs a person; an unknown class is reported, never accepted', () => {
    expect(auto.POLICY).toMatchObject({ id: 'auto-accept-v2', auto: ['high', 'medium', 'check', 'routine'], manual: ['veryhigh'] });
    const c = auto.classify(t([['check', 'o'], ['routine', ''], ['medium', 'm'], ['strange', 'x']]), session, st);
    expect(c.map((x: J) => x.decision)).toEqual(['eligible', 'eligible', 'eligible', 'other']);
    // Phase 4.8.8: ayah 1 is the opening (plays from 0:00.000): a check whatever the registry said.
    expect(auto.classify(t([['high', 'h'], ['veryhigh', 'v'], ['n/a', ''], ['high', '']]), session, st).map((x: J) => [x.ayah, x.decision])).toEqual([[1, 'eligible'], [2, 'manual'], [4, 'eligible']]);
  });

  it('structural and alignment validation: no proposal, a changed package, a collapsed ayah, a start out of order or outside the audio', () => {
    const risk = [['check', ''], ['routine', ''], ['routine', ''], ['routine', '']];
    // manual timing: no proposed start to accept, except the opening, which is 0 by rule (Phase 4.8.8)
    expect(auto.classify(t(risk), { ...session, proposal: null }, st)[1]).toMatchObject({ decision: 'blocked', why: expect.stringContaining('manual timing') });
    expect(auto.classify(t(risk), { ...session, proposal: null }, st)[0]).toMatchObject({ decision: 'eligible', proposedMs: 0, opening: true });
    expect(auto.classify({ ...t(risk), proposal: { fingerprint: 'new' } }, session, st)[1].why).toMatch(/package changed/);
    expect(auto.classify(t(risk), { ...session, proposal: { ...session.proposal, structure: { ok: false, problems: ['x'] } } }, st)[2].why).toMatch(/structure/);
    const collapsed = auto.classify(t(risk), { ...session, proposal: { ...session.proposal, completeness: { collapsed_runs: ['1'] } } }, st);
    // a collapsed ayah 1 no longer blocks its playback start (0 by rule); the onset doubt is reported (opening.mjs)
    expect(collapsed.map((x: J) => x.decision)).toEqual(['eligible', 'eligible', 'eligible', 'eligible']);
    const bad = auto.classify(t(risk), { ...session, proposal: { ...session.proposal, starts: { 1: 1000, 2: 900, 3: 9000, 4: 25000 } } }, st);
    expect(bad.map((x: J) => x.decision)).toEqual(['eligible', 'blocked', 'eligible', 'blocked']);
  });

  it('human decisions win: rejected (now or in the history), uncertain, edited; a confirmed start is a person\'s review', () => {
    const S = { ...syn.session, synthetic: false, proposal: { fingerprint: 'fp', starts: Object.fromEntries(syn.truth.starts.map((ms: number, i: number) => [i + 1, ms])), endMs: syn.truth.endMs } };
    const s = manual.emptyState();
    const ev = (type: string, payload: J = {}) => manual.applyEvent(S, s, { reviewer: 'TEST One', role: 1, type, payload, at: 'x' });
    ev('join');
    ev('draft', { work: full(4, (a) => (a === 2 ? { status: 'rejected' } : a === 3 ? { status: 'uncertain', markedUncertain: true } : {})) });
    const risk = Array.from({ length: syn.session.ayahCount }, () => ['routine', '']);
    const task = { key: 'syn', risk, proposal: { fingerprint: 'fp' } };
    expect(auto.classify(task, { ...S, synthetic: true }, s)[0].why).toBe('synthetic practice data'); // never accepted
    let c = auto.classify(task, S, s);
    expect(c.slice(0, 4).map((x: J) => x.why)).toEqual(['opening rule opening-zero-v1: plays from 0:00.000', 'rejected by Reviewer 1 (saved, not submitted)', 'marked uncertain by Reviewer 1', 'passes every check']);
    ev('submit-ayahs', { keys: ['1', '2'] });
    c = auto.classify(task, S, s);
    expect(c[0].decision).toBe('human-reviewed');
    expect(c[1].why).toBe('rejected by Reviewer 1 (the human decision is kept)');
    ev('revise', { key: '2', marker: { ms: syn.truth.starts[1], status: 'confirmed' }, reason: 'TEST' });
    expect(auto.classify(task, S, s)[1].decision).toBe('human-reviewed'); // a person accepted it after all
    // an edited (moved) start keeps the reviewer's time and is left to them
    const s2 = manual.emptyState();
    manual.applyEvent(S, s2, { reviewer: 'TEST One', role: 1, type: 'join', payload: {}, at: 'x' });
    manual.applyEvent(S, s2, { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: { ...full(1), markers: { 1: { ms: syn.truth.starts[0] + 100, status: 'confirmed' }, 2: { ms: syn.truth.starts[1] + 100, status: 'confirmed' } } } }, at: 'x' });
    expect(auto.classify(task, S, s2)[1].why).toMatch(/edited by Reviewer 1/);
    expect(auto.classify(task, S, s2)[0].decision).toBe('eligible'); // a moved opening still plays from 0 (Phase 4.8.8)
    // the rejection history of a start that was corrected to rejected and back to uncertain stays a block
    const s3 = manual.emptyState();
    const e3 = (type: string, payload: J = {}) => manual.applyEvent(S, s3, { reviewer: 'TEST One', role: 1, type, payload, at: 'x' });
    e3('join'); e3('draft', { work: full(4) }); e3('submit-ayahs', { keys: ['4'] });
    e3('revise', { key: '4', marker: { ms: syn.truth.starts[3], status: 'rejected' }, reason: 'TEST' });
    expect(auto.classify(task, S, s3)[3].why).toMatch(/rejected by Reviewer 1/);
  });
});

// ================================================================ the ledger
describe('the ledger: append-only, chained, idempotent', () => {
  it('rerunning writes nothing twice; a tampered ledger is refused', () => {
    const f = join(work, 'ledger-test', 'ledger.jsonl');
    const L = auto.openLedger(f);
    const e = { type: 'auto-accept', key: 'a', ayah: 1, fingerprint: 'fp', proposedMs: 10, tier: 'check' };
    expect(L.append([e, { ...e, ayah: 2 }])).toHaveLength(2);
    expect(L.append([e, { ...e, ayah: 2 }])).toHaveLength(0);
    expect(auto.openLedger(f).append([{ ...e, ayah: 2 }, { ...e, ayah: 3 }])).toHaveLength(1); // a new process: same rule
    expect(manual.verifyChain(readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))).toBe(-1);
    writeFileSync(f, readFileSync(f, 'utf8').replace('"ayah":2', '"ayah":7'));
    const T = auto.openLedger(f);
    expect(T.problem).toMatch(/hash chain breaks/);
    expect(T.forKey('a')).toEqual([]); // nothing used
    expect(() => T.append([{ ...e, ayah: 9 }])).toThrow(/hash chain/);
  });
});

// ================================================================ the dashboard
describe('the dashboard with automatic acceptance (synthetic)', () => {
  let d: J; let base: string;
  const post = async (key: string, body: J) => { const r = await fetch(`${base}/api/event/${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (r.status !== 200) throw new Error(j.error); return j; };
  const dash = async (name = 'TEST One') => (await fetch(`${base}/api/dashboard?name=${encodeURIComponent(name)}`)).json();
  const start = async (autoAccept: boolean) => {
    d = createDashboard({ config: CFG, autoBackup: false, autoAccept });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;
  };
  const stop = () => new Promise<void>((r) => d.server.close(() => r()));
  let logsBefore: J;

  beforeAll(async () => {
    // Human work BEFORE the policy runs (on a server without automatic acceptance): ajmi-112 ayah 1 accepted, ayah 2
    // submitted rejected, ayah 3 saved uncertain; sufi-112 ayah 1 accepted.
    await start(false);
    await post('ajmi-112', { reviewer: 'TEST One', role: 1, type: 'join' });
    await post('ajmi-112', { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: full(3, (a) => (a === 2 ? { status: 'rejected' } : a === 3 ? { status: 'uncertain', markedUncertain: true } : {})) } });
    await post('ajmi-112', { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['1', '2'] } });
    await post('sufi-112', { reviewer: 'TEST One', role: 1, type: 'join' });
    await post('sufi-112', { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: full(1) } });
    await post('sufi-112', { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['1'] } });
    expect(existsSync(LEDGER)).toBe(false);
    logsBefore = logsSnapshot();
    await stop();
    await start(true); // the pass runs on start
  });
  afterAll(stop);

  it('accepts exactly the eligible starts (policy v2: very high excepted), after a backup, and touches no review log', async () => {
    const L = readLedger();
    const acc = L.filter((e: J) => e.type === 'auto-accept').map((e: J) => `${e.key}:${e.ayah}`).sort();
    expect(acc).toEqual([
      'ajmi-112:4', // 1 human, 2 rejected, 3 uncertain
      'banna-108:1', 'banna-108:2', 'banna-108:3', // 1 collapsed: its playback start is 0 by the opening rule
      'banna-112:1', 'banna-112:2', 'banna-112:3', 'banna-112:4', // 2 high: accepted under v2
      'maher-112:1', 'maher-112:2', 'maher-112:3', 'maher-112:4', // 3 medium: accepted under v2
      'sufi-108:1', 'sufi-108:2', 'sufi-108:3',
      'sufi-112:2', 'sufi-112:3', 'sufi-112:4', // 1 human
      'yasser-salama-112:1', 'yasser-salama-112:2', 'yasser-salama-112:4', // 3 very high: manual
    ].sort());
    for (const e of L.filter((x: J) => x.type === 'auto-accept')) expect(e).toMatchObject({ policy: 'auto-accept-v2', by: auto.BY, fingerprint: expect.any(String), note: expect.stringMatching(/administrative only: not a human listening review/) });
    expect(L.find((e: J) => e.key === 'banna-112' && e.ayah === 2).tier).toBe('high');
    expect(L.find((e: J) => e.key === 'maher-112' && e.ayah === 3).tier).toBe('medium');
    expect(L.every((e: J) => e.reviewer === undefined && e.role === undefined)).toBe(true); // no reviewer is created
    expect(logsSnapshot()).toEqual(logsBefore); // review logs byte-identical
    const backups = readdirSync(join(work, 'ws', 'backups'));
    expect(backups.some((b) => /^pre-(auto-accept|opening-rule)-/.test(b))).toBe(true); // Phase 4.8.8: one backup before both
  });

  it('reruns are idempotent (restart, refresh)', async () => {
    const n = readLedger().length;
    expect(d.autoPass('test').accepted).toBe(0);
    const r = await (await fetch(`${base}/api/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    expect(r.autoAccept.accepted).toBe(0);
    await stop(); await start(true);
    expect(readLedger()).toHaveLength(n);
  });

  it('counters: only very high risk (and what the policy could not accept) stays in the queue; completion per reciter', async () => {
    const D = await dash();
    const m = D.metrics;
    expect(m.startsAutoAccepted).toBe(21);
    expect(m.startsReviewed).toBe(2);
    expect(m.veryHighAwaiting).toBe(1);
    expect(m.highAwaiting).toBe(0);
    expect(m.mediumAwaiting).toBe(0);
    expect(m.otherAwaiting).toBe(2); // ajmi 2 (rejected), ajmi 3 (uncertain)
    expect(m.exceptionsAwaiting).toBe(2);
    expect(m.startsAwaiting).toBe(1 + 2);
    const R = Object.fromEntries(D.reciters.map((x: J) => [x.reciterId, x]));
    expect(R.sufi).toMatchObject({ completed: true, status: 'completed', toReview: 0, autoAccepted: 6, reviewed: 1, completedAt: expect.any(String) });
    expect(R.maher).toMatchObject({ completed: true, status: 'completed', mediumOpen: 0 });
    expect(R.banna).toMatchObject({ completed: true, highOpen: 0, otherOpen: 0 });
    expect(R['yasser-salama']).toMatchObject({ completed: false, status: 'manual review required', veryHighOpen: 1 });
    expect(R.ajmi).toMatchObject({ completed: false, status: 'unresolved exceptions', otherOpen: 2, exceptionsOpen: 2 });
    expect(D.veryHighRecordings).toEqual([expect.objectContaining({ key: 'yasser-salama-112', open: 1, total: 1 })]);
    const sufi = D.rows.find((r: J) => r.key === 'sufi-108');
    expect(sufi).toMatchObject({ reviewComplete: true, reviewState: 'complete (automatic acceptance)', progress: { reviewed: 0, autoAccepted: 3, toReview: 0 } });
    expect(sufi.stage).toBe('human review pending'); // never "verified"
  });

  it('the default pending queue is very high risk and exceptions (with the reason); auto-accepted starts stay visible under Reviewed / All', async () => {
    const q = (qs: string) => fetch(`${base}/api/attention?name=TEST%20One&${qs}&limit=5000`).then((r) => r.json());
    const def = await q('');
    expect(def.rows.map((x: J) => `${x.key}:${x.ayah}:${x.tier}`).sort()).toEqual(['ajmi-112:2:check', 'ajmi-112:3:routine', 'yasser-salama-112:3:veryhigh']);
    expect(def.rows[0]).toMatchObject({ key: 'yasser-salama-112', tier: 'veryhigh', reason: expect.stringMatching(/very high risk: .*out of order/) }); // very high first
    expect(def.rows.find((x: J) => x.ayah === 2 && x.key === 'ajmi-112')).toMatchObject({ exception: true, reason: expect.stringMatching(/^exception: rejected by Reviewer 1/) });
    const hm = await q('tiers=high,medium&show=reviewed');
    expect(hm.rows.map((x: J) => `${x.key}:${x.ayah}:${x.tier}`).sort()).toEqual(['banna-112:2:high', 'maher-112:3:medium']); // accepted, still inspectable
    expect(hm.rows.every((x: J) => x.auto && /accepted automatically/.test(x.reason))).toBe(true);
    const rev = await q('tiers=high,medium,check,routine&show=reviewed');
    const sufi = rev.rows.filter((x: J) => x.key === 'sufi-108');
    expect(sufi).toHaveLength(3);
    expect(sufi.every((x: J) => x.auto && /accepted automatically/.test(x.reason))).toBe(true);
    const other = await q('tiers=check,routine');
    expect(other.rows.map((x: J) => `${x.key}:${x.ayah}`).sort()).toEqual(['ajmi-112:2', 'ajmi-112:3']);
    // the review page is told which starts were accepted automatically (never as a reviewer's)
    const v = await (await fetch(`${base}/api/view/sufi-108?name=TEST%20Two`)).json();
    expect(v.review.autoAcceptedKeys.sort()).toEqual(['1', '2', '3']);
    expect(v.reviewers).toEqual({});
  });

  it('two-reviewer verification, export and publication eligibility are unchanged', async () => {
    const st = (await (await fetch(`${base}/api/view/sufi-108?name=TEST%20One`)).json()).status;
    expect(st.status).toBe('awaiting-review');
    const ex = await (await fetch(`${base}/api/export/sufi-112?name=TEST%20One`)).json();
    expect(ex.singleReview.reviewed).toBe(1); // the person's start only
    const sess = JSON.parse(readFileSync(join(work, 'ws', 'registry', 'sessions', 'sufi-112.json'), 'utf8'));
    const events = readFileSync(join(DATA, 'sufi-112', 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const state = manual.replay(sess, events);
    expect(manual.recordingStatus(sess, state).verified).toBeFalsy();
    expect(manual.finalTiming(sess, state)).toBeNull();
    expect(buildExport(sess, state, events, { exportedAt: 'x' }).status).toBe('partially-reviewed');
    // a recording that is "complete" only through automatic acceptance is never eligible for publication
    const ev = rules.evaluatePublication({ session: { ...sess, sha256: 'a'.repeat(64) }, state, events, evidence: {}, authorizations: [] });
    expect(ev.eligible).toBe(false);
    expect(ev.stage).toBe('human-review-pending');
  });

  it('a later human rejection returns an accepted start to the queue; Completed is reopened, and recorded', async () => {
    await post('sufi-108', { reviewer: 'TEST One', role: 1, type: 'join' });
    await post('sufi-108', { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: full(1, () => ({ status: 'rejected' })) } });
    await post('sufi-108', { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['1'] } });
    let R = Object.fromEntries((await dash()).reciters.map((x: J) => [x.reciterId, x]));
    expect(R.sufi).toMatchObject({ completed: false, toReview: 1, otherOpen: 1 });
    expect(d.autoPass('test').milestones).toEqual(['sufi: reciter-reopened']);
    // the person corrects it to confirmed: complete again (by the person this time)
    await post('sufi-108', { reviewer: 'TEST One', role: 1, type: 'revise', payload: { key: '1', marker: { ms: syn.truth.starts[0], status: 'confirmed' }, reason: 'TEST' } });
    R = Object.fromEntries((await dash()).reciters.map((x: J) => [x.reciterId, x]));
    expect(R.sufi).toMatchObject({ completed: true, toReview: 0 });
    expect(d.autoPass('test').milestones).toEqual(['sufi: reciter-completed']);
  });

  it('Completed survives a restart, even of a server that does not run the policy', async () => {
    const before = (await dash()).reciters.find((x: J) => x.reciterId === 'sufi');
    await stop(); await start(false);
    const after = (await dash()).reciters.find((x: J) => x.reciterId === 'sufi');
    expect(after).toEqual(before);
    await stop(); await start(true);
  });

  it('a new review batch is covered by the next refresh', async () => {
    writePackages(join(work, 'packages'), [...PACKAGES, ['minshawi', 112, [3, 1, 3]]]);
    const r = await (await fetch(`${base}/api/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    expect(r.added).toEqual(['minshawi-112']);
    expect(r.autoAccept.accepted).toBe(4); // policy v2: the high start 3 too
    const R = (await dash()).reciters.find((x: J) => x.reciterId === 'minshawi');
    expect(R).toMatchObject({ autoAccepted: 4, highOpen: 0, toReview: 0, completed: true });
  });

  it('a package changed after acceptance: the old acceptances no longer apply', async () => {
    const p = pkg('minshawi', 112, [3, 1, 3]);
    p.ayahs[3].startMs += 40; p.boundaries[2].ms += 40;
    p.candidateFingerprint = timingFingerprint(p.ayahs.map((a: J) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs })));
    writeFileSync(join(work, 'packages', 'aligned', 'minshawi', '112.json'), JSON.stringify(p));
    d.refresh(); // no pass: the stale acceptances must already be ignored
    const R = (await dash()).reciters.find((x: J) => x.reciterId === 'minshawi');
    expect(R).toMatchObject({ autoAccepted: 0, toReview: 4 });
    expect(d.autoPass('test').accepted).toBe(4); // re-accepted against the new proposal
  });
});
