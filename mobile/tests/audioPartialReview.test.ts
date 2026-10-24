import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 4.8.1: partial (batch) submission of ayah starts, and resuming. SYNTHETIC data only (tone bursts laid out on
// Surah 18's 110 ayahs), test reviewer names, temporary folders; no real review database is touched.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const lib = await imp('review/manual/manual-lib.mjs');
const { buildExport } = await imp('review/manual/export.mjs');
const { createDashboard } = await imp('review/dashboard/server.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-partial-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const { session, truth, wav } = makeSynthetic({ surah: 18, key: 'syn-18', burstMs: 500, gapMs: 300 });
const N = session.ayahCount; // 110
const YES = Object.fromEntries(Object.keys(lib.CHECKS).map((k) => [k, 'yes']));
const marker = (a: number, shift = 0, status = 'confirmed') => ({ ms: truth.starts[a - 1] + shift, status });
/** A draft with the given ayahs placed (shifted), others unplaced. */
const draft = (ayahs: number[], shift = 0, extra: J = {}) => ({ markers: Object.fromEntries(ayahs.map((a) => [a, marker(a, shift)])), end: null, flags: [], checks: {}, comments: '', ...extra });
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

class Log {
  events: J[] = [];
  state = lib.emptyState();
  prev = 'genesis';
  constructor(public s: J = session) {}
  add(reviewer: string, role: number, type: string, payload: J = {}) {
    const ev: J = { seq: this.events.length + 1, at: `2026-10-19T10:${String(this.events.length).padStart(2, '0')}:00Z`, reviewer, role, type, payload, prev: this.prev };
    lib.applyEvent(this.s, this.state, ev);
    ev.hash = lib.eventHash(this.prev, ev);
    this.prev = ev.hash;
    this.events.push(ev);
    return this;
  }
  /** Tries an event; returns the refusal message or '' (a refused event never enters the log). */
  try(reviewer: string, role: number, type: string, payload: J = {}) {
    try { this.add(reviewer, role, type, payload); return ''; } catch (e) { return (e as Error).message; }
  }
}

describe('partial submission: one reviewer', () => {
  it('submits 5 ayahs of a 110-ayah surah; the other 105 stay pending; nothing is verified', () => {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft(range(1, 5)) }).add('TEST A', 1, 'submit-ayahs', { keys: ['1', '2', '3', '4', '5'] });
    const p = lib.progress(session, L.state);
    expect(p).toMatchObject({ starts: N, submitted1: 5, submitted2: 0, pending: N - 5, verified: 0, remaining: N });
    const st = lib.recordingStatus(session, L.state);
    expect(st.status).toBe('partially-reviewed');
    expect(st.verified).toBeUndefined();
    expect(st.reasons.join('\n')).toMatch(/Reviewer 1 \(TEST A\): 5 of 110 starts submitted/);
    expect(lib.finalTiming(session, L.state)).toBeNull();
  });

  it('accepts nonconsecutive batches, returns later for more, and keeps every earlier submission', () => {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft([...range(1, 10), ...range(25, 30)]) });
    L.add('TEST A', 1, 'submit-ayahs', { keys: [...range(1, 10), ...range(25, 30)].map(String) });
    const first = structuredClone(L.state.reviewers[1].submitted);
    // later: more placements, another batch
    L.add('TEST A', 1, 'draft', { work: draft([...range(1, 10), ...range(25, 30), ...range(11, 15)]) });
    L.add('TEST A', 1, 'submit-ayahs', { keys: range(11, 15).map(String) });
    const sub = L.state.reviewers[1].submitted;
    expect(Object.keys(sub)).toHaveLength(21);
    for (const [k, v] of Object.entries(first)) expect(sub[k]).toEqual(v); // earlier submissions untouched
    expect(lib.progress(session, L.state).pending).toBe(N - 21);
  });

  it('refuses duplicate, unjudged, unplaced and unknown submissions without changing the log', () => {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: { ...draft(range(1, 3)), markers: { ...draft(range(1, 3)).markers, 4: marker(4, 0, 'uncertain') } } });
    L.add('TEST A', 1, 'submit-ayahs', { keys: ['1', '2'] });
    const n = L.events.length;
    expect(L.try('TEST A', 1, 'submit-ayahs', { keys: ['2'] })).toMatch(/ayah 2 is already submitted/);
    expect(L.try('TEST A', 1, 'submit-ayahs', { keys: ['3', '3'] })).toMatch(/listed twice/);
    expect(L.try('TEST A', 1, 'submit-ayahs', { keys: ['4'] })).toMatch(/marked uncertain: judge it confirmed/);
    expect(L.try('TEST A', 1, 'submit-ayahs', { keys: ['7'] })).toMatch(/ayah 7: no start placed/);
    expect(L.try('TEST A', 1, 'submit-ayahs', { keys: ['111'] })).toMatch(/not a start of this recording/);
    expect(L.try('TEST A', 1, 'submit-ayahs', { keys: [] })).toMatch(/choose the ayahs/);
    expect(L.events).toHaveLength(n);
    expect(Object.keys(L.state.reviewers[1].submitted)).toEqual(['1', '2']);
  });

  it('freezes submitted starts: a draft cannot change them; a correction needs a reason and keeps the history', () => {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft(range(1, 5)) }).add('TEST A', 1, 'submit-ayahs', { keys: ['1', '2', '3', '4', '5'] });
    expect(L.try('TEST A', 1, 'draft', { work: draft(range(1, 5), 40) })).toMatch(/ayah 1 was submitted: change it with a correction/);
    expect(L.try('TEST A', 1, 'draft', { work: draft(range(2, 5)) })).toMatch(/ayah 1 was submitted/); // nor drop it
    expect(L.try('TEST A', 1, 'revise', { key: '3', marker: marker(3, 120) })).toMatch(/needs a reason/);
    expect(L.try('TEST A', 1, 'revise', { key: '9', marker: marker(9), reason: 'x' })).toMatch(/ayah 9 is not submitted/);
    L.add('TEST A', 1, 'revise', { key: '3', marker: marker(3, 120), reason: 'heard the hamza onset later' });
    const r = L.state.reviewers[1];
    expect(r.submitted['3']).toMatchObject({ ms: truth.starts[2] + 120, rev: 2 });
    expect(r.revisions).toHaveLength(1);
    expect(r.revisions[0]).toMatchObject({ key: '3', reason: 'heard the hamza onset later', before: { ms: truth.starts[2], rev: 1 }, afterReveal: false });
    expect(r.work.markers[3].ms).toBe(truth.starts[2] + 120);
    expect(lib.verifyChain(L.events)).toBe(-1);
    const forged = structuredClone(L.events);
    forged.at(-1).payload.marker.ms += 1;
    expect(lib.verifyChain(forged)).toBe(L.events.length - 1);
  });
});

describe('partial submission: two independent reviewers', () => {
  function both() {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft(range(1, 10)) }).add('TEST A', 1, 'submit-ayahs', { keys: range(1, 10).map(String) });
    L.add('TEST B', 2, 'join');
    return L;
  }

  it('lets Reviewer 2 review submitted ayahs incrementally, blind to Reviewer 1 until each start is submitted by both', () => {
    const L = both();
    let v2 = lib.viewFor(session, L.state, 'TEST B');
    expect(v2.reviewers[1].work).toBeUndefined();
    expect(v2.reviewers[1].submitted).toBeUndefined();
    expect(v2.reviewers[1].submittedKeys).toHaveLength(10); // which starts, never their times
    expect(v2.revealed).toEqual([]);
    expect(JSON.stringify(v2)).not.toContain(String(truth.starts[5])); // no Reviewer 1 time anywhere in the view
    L.add('TEST B', 2, 'draft', { work: draft(range(1, 6), 30) });
    expect(lib.viewFor(session, L.state, 'TEST B').revealed).toEqual([]); // saved is not submitted: still blind
    L.add('TEST B', 2, 'submit-ayahs', { keys: ['1', '2', '3'] });
    v2 = lib.viewFor(session, L.state, 'TEST B');
    expect(v2.revealed.map((c: J) => c.key)).toEqual([1, 2, 3]);
    expect(v2.revealed[0].r1.ms).toBe(truth.starts[0]);
    expect(JSON.stringify(v2)).not.toContain(String(truth.starts[4])); // ayah 5: Reviewer 2 has not submitted it
    expect(lib.viewFor(session, L.state, 'TEST A').revealed.map((c: J) => c.key)).toEqual([1, 2, 3]); // symmetric
    const p = lib.progress(session, L.state);
    expect(p).toMatchObject({ submitted1: 10, submitted2: 3, verified: 3, disputed: 0, remaining: N - 3 });
    expect(lib.recordingStatus(session, L.state).status).toBe('partially-reviewed');
  });

  it('resolves a disagreement per start as soon as both have submitted it, by proposal and acceptance', () => {
    const L = both();
    const w = draft(range(1, 3), 30);
    w.markers[2] = marker(2, 700);
    L.add('TEST B', 2, 'draft', { work: w }).add('TEST B', 2, 'submit-ayahs', { keys: ['1', '2', '3'] });
    expect(lib.progress(session, L.state)).toMatchObject({ verified: 2, disputed: 1 });
    expect(L.try('TEST A', 1, 'resolve-propose', { ayah: 5, ms: truth.starts[4], note: 'x' })).toMatch(/both reviewers must submit ayah 5/);
    L.add('TEST A', 1, 'resolve-propose', { ayah: 2, ms: truth.starts[1] + 350, note: 'the onset is the breath' });
    expect(L.try('TEST A', 1, 'resolve-accept', { ayah: 2, note: 'x' })).toMatch(/other reviewer must accept/);
    L.add('TEST B', 2, 'resolve-accept', { ayah: 2, note: 'heard it again: agreed' });
    expect(lib.progress(session, L.state)).toMatchObject({ verified: 3, disputed: 0 });
  });

  it('never counts a start changed after the other placement was shown as independent agreement', () => {
    const L = both();
    const w = draft(range(1, 3), 30);
    w.markers[2] = marker(2, 700);
    L.add('TEST B', 2, 'draft', { work: w }).add('TEST B', 2, 'submit-ayahs', { keys: ['1', '2', '3'] });
    // Reviewer 2 now sees Reviewer 1's time for ayah 2 and "corrects" towards it: logged, but not agreement.
    L.add('TEST B', 2, 'revise', { key: '2', marker: marker(2, 10), reason: 'listened again' });
    const c = lib.partialComparison(session, L.state).find((x: J) => x.key === 2);
    expect(c.outcome).toBe('disputed');
    expect(c.why.join()).toMatch(/changed after the other placement was shown/);
    expect(L.state.reviewers[2].revisions[0].afterReveal).toBe(true);
  });

  it('keeps a recording partially reviewed until both reviewers finish everything, then verifies it as before', () => {
    const L = new Log();
    L.add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft(range(1, N)) });
    for (let a = 1; a <= N; a += 20) L.add('TEST A', 1, 'submit-ayahs', { keys: range(a, Math.min(N, a + 19)).map(String) });
    L.add('TEST B', 2, 'join').add('TEST B', 2, 'draft', { work: draft(range(1, N), 40) }).add('TEST B', 2, 'submit-ayahs', { keys: range(1, N).map(String) });
    // every start submitted by both, but no recitation end and no whole-recording checks: not verified
    expect(lib.progress(session, L.state)).toMatchObject({ submitted1: N, submitted2: N, verified: N });
    expect(lib.recordingStatus(session, L.state).status).toBe('partially-reviewed');
    expect(lib.finalTiming(session, L.state)).toBeNull();
    const rec = buildExport(session, L.state, L.events);
    expect(rec.complete).toBe(false);
    expect(rec.package).toBeNull();
    expect(L.try('TEST A', 1, 'submit')).toMatch(/recitation end .* not placed/);
    for (const [name, role, shift] of [['TEST A', 1, 0], ['TEST B', 2, 40]] as const) {
      L.add(name, role, 'draft', { work: { ...draft(range(1, N), shift), end: { ms: truth.endMs + shift, status: 'confirmed' }, checks: YES } });
      L.add(name, role, 'submit');
    }
    const st = lib.recordingStatus(session, L.state);
    expect(st.status).toBe('blocked-by-permissions'); // verified; synthetic sessions have no cleared rights
    expect(st.verified).toBe(true);
    expect(buildExport(session, L.state, L.events).complete).toBe(true);
    expect(lib.finalTiming(session, L.state)).toHaveLength(N);
  });

  it('replays a Phase 4.6 log (whole-surah submissions, no batches) exactly as before', () => {
    const full = (shift: number) => ({ ...draft(range(1, N), shift), end: { ms: truth.endMs + shift, status: 'confirmed' }, checks: YES });
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: full(0) }).add('TEST A', 1, 'submit').add('TEST B', 2, 'join').add('TEST B', 2, 'draft', { work: full(30) }).add('TEST B', 2, 'submit');
    const again = lib.replay(session, L.events);
    expect(lib.recordingStatus(session, again).status).toBe('blocked-by-permissions');
    expect(lib.summary(session, again)).toMatchObject({ agreed: N + 1, total: N + 1, compared: true });
    expect(Object.keys(again.reviewers[1].submitted)).toHaveLength(N + 1); // the whole submission is recorded per start too
  });

  it('limits a production boundary check to its scope', () => {
    const scoped = { ...session, scope: [4, 9], reviewType: 'production-boundary-check' };
    const L = new Log(scoped).add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft([4, 9]) });
    expect(L.try('TEST A', 1, 'submit-ayahs', { keys: ['5'] })).toMatch(/not a start of this check/);
    L.add('TEST A', 1, 'submit-ayahs', { keys: ['4'] });
    expect(lib.progress(scoped, L.state)).toMatchObject({ starts: 2, submitted1: 1, pending: 1 });
  });
});

// ---------------------------------------------------------------- the dashboard server
describe('partial submission: dashboard server, restart and resume', () => {
  const ws = join(work, 'ws');
  const man = join(work, 'manual');
  let d: J;
  let base = '';
  async function start() {
    d = createDashboard({ config: join(ws, 'dashboard.config.json'), autoBackup: false });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;
  }
  const stop = () => new Promise<void>((r) => d.server.close(() => r()));
  const ev = async (body: J) => { const r = await fetch(`${base}/api/event/syn-18`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json();
  beforeAll(async () => {
    for (const x of ['sessions', 'audio', 'data']) mkdirSync(join(man, x), { recursive: true });
    writeFileSync(join(man, 'sessions', 'syn-18.json'), JSON.stringify(session));
    writeFileSync(join(man, 'audio', 'syn-18.wav'), wav);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'dashboard.config.json'), JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: 'backups',
      sources: [{ id: 'syn', kind: 'manual-sessions', sessions: '../manual/sessions', audio: '../manual/audio', data: '../manual/data' }] }));
    await start();
  });
  afterAll(stop);

  it('saves, submits a batch, survives a restart, and shows what remains', async () => {
    await ev({ reviewer: 'TEST A', role: 1, type: 'join' });
    expect((await ev({ reviewer: 'TEST A', role: 1, type: 'draft', payload: { work: draft(range(1, 18)) } })).status).toBe(200); // saved, 18 placed
    const r = await ev({ reviewer: 'TEST A', role: 1, type: 'submit-ayahs', payload: { keys: range(1, 15).map(String) } });
    expect(r.status).toBe(200);
    expect(r.json.progress).toMatchObject({ submitted1: 15, pending: N - 15 });
    expect((await ev({ reviewer: 'TEST A', role: 1, type: 'submit-ayahs', payload: { keys: ['15'] } })).json.error).toMatch(/already submitted/); // a double click
    await stop();
    await start(); // the dashboard restarts
    const v = await get('/api/view/syn-18?name=TEST%20A');
    expect(Object.keys(v.reviewers[1].submitted)).toHaveLength(15);
    expect(Object.keys(v.reviewers[1].work.markers)).toHaveLength(18); // saved but unsubmitted work survives too
    const dash = await get('/api/dashboard?name=TEST%20A');
    const row = dash.rows.find((x: J) => x.key === 'syn-18');
    expect(row.stage).toBe('partially reviewed');
    expect(row.activity).toBe('in progress');
    expect(row.progress).toMatchObject({ starts: N, submitted1: 15, submitted2: 0, verified: 0, remaining: N, savedMine: 3 });
    expect(row.mine).toMatchObject({ submittedStarts: 15, saved: 3 });
    expect(dash.metrics.partiallyReviewed).toBe(1);
    expect(dash.metrics.verified).toBe(0);
    // Needs attention, "not submitted by me": the 15 submitted starts are gone, the rest remain
    const att = await get('/api/attention?name=TEST%20A&key=syn-18&tiers=high,medium,check,routine&todo=1&limit=5000');
    expect(att.rows.some((x: J) => x.ayah <= 15)).toBe(false);
  });

  it('keeps Reviewer 2 blind on the server too, and exports incomplete records as incomplete', async () => {
    await ev({ reviewer: 'TEST B', role: 2, type: 'join' });
    const v = await get('/api/view/syn-18?name=TEST%20B');
    expect(JSON.stringify(v)).not.toContain(String(truth.starts[9]));
    const att = await get('/api/attention?name=TEST%20B&key=syn-18&tiers=high,medium,check,routine&limit=5000');
    expect(att.rows.every((x: J) => x.mine === null)).toBe(true);
    const exp = await get('/api/export/syn-18?name=TEST%20A');
    expect(exp.complete).toBe(false);
    expect(exp.package).toBeNull();
    expect(exp.reviewers.map((x: J) => x.name)).toEqual(['TEST A']);
    const log = readFileSync(join(man, 'data', 'syn-18', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lib.verifyChain(log)).toBe(-1);
  });
});
