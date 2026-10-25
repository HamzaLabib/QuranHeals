import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 4.8.6: the single-review workflow of the dashboard (one accepted submission takes a start out of the pending
// queue). SYNTHETIC recordings and test reviewer names only; temporary workspaces and databases.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const { createDashboard } = await imp('review/dashboard/server.mjs');
const { makeViews } = await imp('review/dashboard/views.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');
const { timingFingerprint } = await imp('fingerprint.mjs');
const rules = await imp('review/cloud/publication-rules.mjs');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-single-'));
afterAll(() => { try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp only */ } });
const ALL_YES = Object.fromEntries(Object.keys(manual.CHECKS).map((k) => [k, 'yes']));

// ================================================================ the rule (pure)
const syn98 = makeSynthetic({ surah: 98, key: 'syn-98' });
const S = syn98.session;
const T = syn98.truth;
class Log {
  events: J[] = []; state = manual.emptyState(); prev = 'genesis';
  add(reviewer: string, role: number, type: string, payload: J = {}) {
    const ev: J = { seq: this.events.length + 1, at: `2026-10-19T10:${String(this.events.length).padStart(2, '0')}:00Z`, reviewer, role, type, payload, prev: this.prev };
    manual.applyEvent(S, this.state, ev); ev.hash = manual.eventHash(this.prev, ev); this.prev = ev.hash; this.events.push(ev); return this;
  }
}
const work98 = (status: (a: number) => string = () => 'confirmed', only?: number[]) => ({ markers: Object.fromEntries(T.starts.map((ms: number, i: number) => [i + 1, { ms, status: status(i + 1) }]).filter(([a]: J) => !only || only.includes(a))), end: null, flags: [], checks: {}, comments: '' });
const rs = (L: Log, role: number | null = null) => manual.reviewedStarts(S, L.state, role);

describe('a start is reviewed by ONE accepted submission (pure rule)', () => {
  it('1/8. one accepted submission reviews that start; ayah 1 included; the rest stay pending', () => {
    const L = new Log().add('TEST One', 1, 'join').add('TEST One', 1, 'draft', { work: work98() }).add('TEST One', 1, 'submit-ayahs', { keys: ['1'] });
    expect(rs(L)).toMatchObject({ starts: 8, reviewed: ['1'], complete: false });
    expect(rs(L).pending).toEqual(['2', '3', '4', '5', '6', '7', '8']);
  });

  it('2. a missing Reviewer 2 does not keep a submitted start pending; all submitted = complete', () => {
    const L = new Log().add('TEST One', 1, 'join').add('TEST One', 1, 'draft', { work: work98() }).add('TEST One', 1, 'submit-ayahs', { keys: ['1', '2', '3', '4', '5', '6', '7', '8'] });
    expect(rs(L)).toMatchObject({ complete: true, pending: [] });
  });

  it('3/4. saved but unsubmitted, uncertain and rejected starts stay pending', () => {
    const L = new Log().add('TEST One', 1, 'join').add('TEST One', 1, 'draft', { work: work98((a) => (a === 3 ? 'rejected' : a === 4 ? 'uncertain' : 'confirmed')) });
    expect(rs(L).reviewed).toEqual([]); // saved only
    L.add('TEST One', 1, 'submit-ayahs', { keys: ['1', '2', '3'] }); // 3 submitted as rejected
    expect(rs(L).reviewed).toEqual(['1', '2']);
    expect(rs(L).pending).toContain('3');
    expect(rs(L).pending).toContain('4');
  });

  it('12/13. bulk acceptance counts only once submitted, and once; corrections change the effective status', () => {
    const L = new Log().add('TEST One', 1, 'join').add('TEST One', 1, 'draft', { work: work98(() => 'uncertain', [2]) });
    const P = { ...S, proposal: { starts: Object.fromEntries(T.starts.map((ms: number, i: number) => [i + 1, ms])), endMs: T.endMs, boundaries: [], worklist: [] } };
    const st = L.state;
    // bulk events need a proposal: replay the same log on a session that has one
    const ev = { seq: 3, at: 'x', reviewer: 'TEST One', role: 1, type: 'bulk', payload: { action: 'accept-proposed', keys: ['1', '3', '4'] } };
    manual.applyEvent(P, st, ev);
    expect(manual.reviewedStarts(P, st).reviewed).toEqual([]); // accepted in bulk, not submitted
    manual.applyEvent(P, st, { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['1', '3', '4'] }, at: 'y' });
    manual.applyEvent(P, st, { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: st.reviewers[1].work }, at: 'z' }); // a retry/save: no double count
    expect(manual.reviewedStarts(P, st).reviewed).toEqual(['1', '3', '4']);
    manual.applyEvent(P, st, { reviewer: 'TEST One', role: 1, type: 'revise', payload: { key: '3', marker: { ms: T.starts[2], status: 'rejected' }, reason: 'TEST' }, at: 'w' });
    expect(manual.reviewedStarts(P, st).reviewed).toEqual(['1', '4']); // corrected to rejected: pending again
    manual.applyEvent(P, st, { reviewer: 'TEST One', role: 1, type: 'revise', payload: { key: '3', marker: { ms: T.starts[2] + 20, status: 'confirmed' }, reason: 'TEST' }, at: 'v' });
    expect(manual.reviewedStarts(P, st).reviewed).toEqual(['1', '3', '4']);
  });

  it('10/11. Reviewer 2\'s submissions count once; a BLIND reviewer only sees the other\'s acceptances for revealed starts', () => {
    const L = new Log().add('TEST One', 1, 'join').add('TEST One', 1, 'draft', { work: work98() }).add('TEST One', 1, 'submit-ayahs', { keys: ['1', '2', '3'] })
      .add('TEST Two', 2, 'join').add('TEST Two', 2, 'draft', { work: work98() }).add('TEST Two', 2, 'submit-ayahs', { keys: ['1', '5'] });
    expect(rs(L).reviewed).toEqual(['1', '2', '3', '5']); // unique starts, 1 counted once
    expect(rs(L, 2).reviewed).toEqual(['1', '5']); // Reviewer 2: own + revealed (1) only; never R1's 2 and 3
    expect(rs(L, 1).reviewed).toEqual(['1', '2', '3']); // Reviewer 1: own + revealed
    const v2 = manual.viewFor(S, L.state, 'TEST Two');
    expect(v2.review.reviewedKeys).toEqual(['1', '5']);
    expect(manual.viewFor(S, L.state, 'Somebody else').review.reviewedKeys).toBeNull(); // not a reviewer: counts only
    expect(manual.progress(S, L.state).verified).toBe(1); // independent verification: only the start both reviewed
  });

  it('17. publication eligibility is not weakened: one reviewer\'s complete review is never "ready"', () => {
    const L = new Log().add('TEST One', 1, 'join').add('TEST One', 1, 'draft', { work: { ...work98(), end: { ms: T.endMs, status: 'confirmed' }, checks: ALL_YES } }).add('TEST One', 1, 'submit');
    expect(rs(L).complete).toBe(true);
    const ev = rules.evaluatePublication({ session: { ...S, provider: 'mp3quran', url: 'https://x.test/98.mp3', format: { mode: 'cbr' }, timeline: 'decoded audio (miniaudio)' }, state: L.state, events: L.events, evidence: {}, authorizations: [], allowSynthetic: true });
    expect(ev.eligible).toBe(false);
    expect(ev.stage).toBe('reviewer-1-complete');
  });
});

// ================================================================ the dashboard (local) and the cloud views
const syn112 = makeSynthetic({ surah: 112, key: 'syn-112' });
const { text } = lib.canon();
const BAS = text.get('1:1');
function pkg(reciterId: string, surah: number) {
  const n = lib.canon().meta.get(surah).ayahs;
  const starts = syn112.truth.starts.slice(0, n);
  const ayahs = Array.from({ length: n }, (_, k) => { const t = text.get(`${surah}:${k + 1}`) as string; return { ayah: k + 1, startMs: starts[k], endMs: k + 1 < n ? starts[k + 1] : syn112.truth.endMs, text: k === 0 ? t.split(' ').slice(BAS.split(' ').length).join(' ') : t }; });
  const p: J = { kind: 'ayah-timing-review-package', version: 1, source: 'aligned', createdOn: '2026-10-19', reciterId, reciterEn: 'x', reciterAr: 'x', recording: 'test', surah, surahAr: 'x', surahEn: `S${surah}`, ayahCount: n,
    url: `https://cdn.mp3quran.net/audio/test-${reciterId}/${surah}.mp3`, bytes: syn112.wav.length, format: { kbps: 128, mode: 'cbr', durationMs: syn112.session.durationMs }, textSource: 't', status: 's', durationMs: syn112.session.durationMs, intro: null, basmala: BAS, ayahs,
    // ayah 2 is high risk (priority 1)
    boundaries: ayahs.slice(1).map((a, k) => ({ ayah: a.ayah, ms: a.startMs, flags: k === 0 ? ['no-pause'] : [], priority: k === 0 ? 1 : 3, pauseMs: null })), worklist: [2], structure: { ok: true, problems: [] } };
  p.candidateFingerprint = timingFingerprint(p.ayahs.map((a: J) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs })));
  return p;
}
function workspace() {
  const pk = join(work, 'packages');
  const list = [['banna', 112], ['banna', 108], ['maher', 112], ['maher', 108]] as const;
  for (const [r] of list) mkdirSync(join(pk, 'aligned', r), { recursive: true });
  for (const [r, s] of list) writeFileSync(join(pk, 'aligned', r, `${s}.json`), JSON.stringify(pkg(r, s)));
  writeFileSync(join(pk, 'index.json'), JSON.stringify({ kind: 'ayah-timing-review-index', packages: list.map(([r, s]) => ({ file: `aligned/${r}/${s}.json` })) }));
  const man = join(work, 'manual');
  for (const d of ['sessions', 'audio', 'data']) mkdirSync(join(man, d), { recursive: true });
  writeFileSync(join(man, 'sessions', 'syn-98.json'), JSON.stringify(S));
  writeFileSync(join(man, 'audio', 'syn-98.wav'), syn98.wav);
  const ws = join(work, 'ws');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'dashboard.config.json'), JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: 'backups', python: process.env.QH_PYTHON ?? 'python',
    sources: [{ id: 'pk', kind: 'review-packages', phase: 'T', dir: '../packages' }, { id: 'syn', kind: 'manual-sessions', sessions: '../manual/sessions', audio: '../manual/audio', data: '../manual/data' }] }));
  return join(ws, 'dashboard.config.json');
}
const CFG = workspace();
const n112 = 4; const n113 = 3; // surah 108 (the synthetic timeline has 4 starts)
const full = (n: number, status: (a: number) => string = () => 'confirmed') => ({ markers: Object.fromEntries(syn112.truth.starts.slice(0, n).map((ms: number, i: number) => [i + 1, { ms, status: status(i + 1) }])), end: null, flags: [], checks: {}, comments: '' });

describe('the dashboard: pending queue, reciter counts and every statistic (synthetic)', () => {
  let d: J; let base: string;
  const post = async (key: string, body: J) => { const r = await fetch(`${base}/api/event/${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (r.status !== 200) throw new Error(j.error); return j; };
  const dash = async (name = 'TEST One') => (await fetch(`${base}/api/dashboard?name=${encodeURIComponent(name)}`)).json();
  beforeAll(async () => {
    d = createDashboard({ config: CFG, autoBackup: false });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;
    // banna-112: nothing. banna-108: ayah 1 submitted, the rest saved. maher-112: every start by bulk + submit, with
    // corrections, and Reviewer 2's ayah 1. syn-98: 1-2 accepted, 3 submitted REJECTED, the rest saved.
    await post('banna-108', { reviewer: 'TEST One', role: 1, type: 'join' });
    await post('banna-108', { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: full(n113) } });
    await post('banna-108', { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['1'] } });
    await post('maher-112', { reviewer: 'TEST One', role: 1, type: 'join' });
    await post('maher-112', { reviewer: 'TEST One', role: 1, type: 'bulk', payload: { action: 'accept-proposed', keys: ['1', '2', '3', '4', 'end'] } });
    await post('maher-112', { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['1', '2', '3', '4'] } });
    await post('maher-112', { reviewer: 'TEST One', role: 1, type: 'revise', payload: { key: '2', marker: { ms: syn112.truth.starts[1], status: 'rejected' }, reason: 'TEST' } });
    await post('maher-112', { reviewer: 'TEST One', role: 1, type: 'revise', payload: { key: '2', marker: { ms: syn112.truth.starts[1] + 30, status: 'confirmed', origin: 'proposal' }, reason: 'TEST' } });
    await post('maher-112', { reviewer: 'TEST Two', role: 2, type: 'join' });
    await post('maher-112', { reviewer: 'TEST Two', role: 2, type: 'draft', payload: { work: full(n112) } });
    await post('maher-112', { reviewer: 'TEST Two', role: 2, type: 'submit-ayahs', payload: { keys: ['1'] } });
    await post('syn-98', { reviewer: 'TEST One', role: 1, type: 'join' });
    await post('syn-98', { reviewer: 'TEST One', role: 1, type: 'draft', payload: { work: work98((a) => (a === 3 ? 'rejected' : 'confirmed')) } });
    await post('syn-98', { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['1', '2', '3'] } });
  });
  afterAll(() => new Promise<void>((r) => d.server.close(() => r())));

  const TOTAL = n112 + n113 + n112 + n113 + 8; // banna 112, banna 113, maher 112, maher 113, syn-98: every start, ayah 1 included
  const REVIEWED = 0 + 1 + 4 + 0 + 2;

  it('15. every statistic, from the review state (owner\'s view)', async () => {
    const m = (await dash()).metrics;
    expect(m.recordings).toBe(5);
    expect(m.startsTotal).toBe(TOTAL);
    expect(m.startsReviewed).toBe(REVIEWED);
    expect(m.startsAwaiting).toBe(TOTAL - REVIEWED);
    expect(m.recordingsAwaiting).toBe(4); // maher-112 is complete
    expect(m.partiallyReviewed).toBe(2); // banna-108, syn-98
    expect(m.recordingsReviewComplete).toBe(1);
    expect(m.recordingsCompletedSingle).toBe(1); // not independently verified
    // high-risk starts, from the inventory: ayah 2 of each package plus the synthetic session's own
    const inv = JSON.parse(readFileSync(join(work, 'ws', 'registry', 'inventory.json'), 'utf8'));
    const REV: J = { 'banna-108': ['1'], 'maher-112': ['1', '2', '3', '4'], 'syn-98': ['1', '2'] };
    const high = (t: J) => t.risk.map(([tier]: J, i: number) => (tier === 'high' ? String(i + 1) : null)).filter(Boolean);
    expect(m.highTotal).toBe(inv.tasks.reduce((a: number, t: J) => a + high(t).length, 0));
    expect(m.highAwaiting).toBe(inv.tasks.reduce((a: number, t: J) => a + high(t).filter((k: string) => !(REV[t.key] ?? []).includes(k)).length, 0)); // 9
    expect(m.startsSubmitted1).toBe(1 + 4 + 3); // 10. syn-98's rejected 3 is submitted (but not reviewed)
    expect(m.startsSubmitted2).toBe(1);
    expect(m.startsVerified).toBe(1); // 11. only maher-112 ayah 1 (both reviewers)
    expect(m.verified).toBe(0);
    expect(m.manualTiming).toBe(0); // the synthetic manual session is typed synthetic-practice, not manual-timing
    expect(m.withProposals).toBe(4);
    expect(m.productionChecks).toBe(0);
    expect(m.unavailableRecordings).toBe(0);
    expect(m.importProblems).toBe(0);
  });

  it('5/6. rows: partial recordings keep their counts; the complete one is "review complete (one reviewer)"', async () => {
    const rows = (await dash()).rows;
    const r = (k: string) => rows.find((x: J) => x.key === k);
    expect(r('banna-112').progress).toMatchObject({ reviewed: 0, toReview: 4 });
    expect(r('banna-108').progress).toMatchObject({ reviewed: 1, toReview: 2 });
    expect(r('syn-98').progress).toMatchObject({ reviewed: 2, toReview: 6 });
    expect(r('maher-112')).toMatchObject({ reviewComplete: true, reviewState: 'review complete (one reviewer)', progress: { reviewed: 4, toReview: 0 } });
    expect(r('maher-112').stage).not.toBe('technical verification completed');
  });

  it('3/7. reciters with the starts left: a finished reciter stays, as (0), after those with work', async () => {
    const D = await dash();
    const left = Object.fromEntries(D.reciters.map((x: J) => [x.reciterId, x.toReview]));
    expect(left.banna).toBe(4 + 2); // banna-112: 4, banna-108: 2 (ayah 1 reviewed)
    expect(left[syn98.session.reciterId]).toBe(6); // syn-98: 2 reviewed, 3 rejected stays pending
    const maher = D.reciters.find((x: J) => x.reciterId === 'maher');
    expect(maher.toReview).toBe(n113); // maher-108 untouched
    // finish maher-108 and maher shows 0, still listed, after the reciters with work
    await post('maher-108', { reviewer: 'TEST One', role: 1, type: 'join' });
    await post('maher-108', { reviewer: 'TEST One', role: 1, type: 'bulk', payload: { action: 'accept-proposed', keys: ['1', '2', '3', 'end'] } });
    await post('maher-108', { reviewer: 'TEST One', role: 1, type: 'submit-ayahs', payload: { keys: ['1', '2', '3'] } });
    const D2 = await dash();
    const m2 = D2.reciters.find((x: J) => x.reciterId === 'maher');
    expect(m2).toMatchObject({ toReview: 0, recordings: 2, recordingsPending: 0 });
    expect(D2.reciters.at(-1).reciterId).toBe('maher');
    expect(D2.metrics.startsReviewed).toBe(REVIEWED + n113);
    expect(D2.metrics.recordingsAwaiting).toBe(3);
  });

  it('the Needs Attention list leaves out reviewed starts by default (Reviewed / All bring them back)', async () => {
    const q = (show: string) => fetch(`${base}/api/attention?name=TEST%20One&tiers=high,medium,check,routine&show=${show}&limit=5000`).then((r) => r.json());
    const pend = await q('pending');
    expect(pend.rows.some((x: J) => x.key === 'maher-112')).toBe(false);
    expect(pend.rows.some((x: J) => x.key === 'syn-98' && x.ayah === 3)).toBe(true); // rejected: pending
    const rev = await q('reviewed');
    expect(rev.rows.filter((x: J) => x.key === 'maher-112').map((x: J) => x.ayah).sort()).toEqual([1, 2, 3, 4]);
    expect((await q('all')).total).toBe(pend.total + rev.total);
  });

  it('a blind Reviewer 2 is never shown which of Reviewer 1\'s starts were accepted', async () => {
    const two = (await dash('TEST Two')).rows.find((x: J) => x.key === 'maher-112');
    expect(two.progress).toMatchObject({ reviewed: 1, toReview: 3 }); // own ayah 1 (revealed); R1's 2-4 are not disclosed
    const v = await (await fetch(`${base}/api/view/maher-112?name=TEST%20Two`)).json();
    expect(v.review.reviewedKeys).toEqual(['1']);
  });

  it('14/16. a reload (a new server on the same data) and the cloud views (migrated into PostgreSQL) give the same numbers', async () => {
    const before = (await dash()).metrics;
    await new Promise<void>((r) => d.server.close(() => r()));
    d = createDashboard({ config: CFG, autoBackup: false });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;
    const after = (await dash()).metrics;
    expect(after).toEqual(before);
    // cloud: migrate the same workspace into a temporary PostgreSQL and compute the cloud dashboard's views
    const { default: EmbeddedPostgres } = await import(pathToFileURL(join(tools, 'review/cloud/node_modules/embedded-postgres/dist/index.js')).href);
    const db = await imp('review/cloud/db.mjs');
    const { buildBundle } = await imp('review/cloud/migrate.mjs');
    const { importBundle } = await imp('review/cloud/import.mjs');
    const { createPgStore } = await imp('review/cloud/pg-store.mjs');
    const port = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
    const pg = new EmbeddedPostgres({ databaseDir: join(work, 'pg'), user: 'qh', password: 't', port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
    await pg.initialise(); await pg.start();
    // Connection errors the pools report fail this test (checked after the server has stopped).
    const poolErrors: string[] = [];
    const onPoolError = (e: Error & { code?: string }) => { poolErrors.push(`${e.code ?? 'no code'}: ${e.message}`); };
    let pool: J = null;
    try {
      const a = db.createPool(`postgres://qh:t@127.0.0.1:${port}/postgres`, { ssl: false, max: 1, onError: onPoolError });
      await a.query("create database single encoding 'UTF8' template template0"); await db.closePool(a);
      pool = db.createPool(`postgres://qh:t@127.0.0.1:${port}/single`, { ssl: false, onError: onPoolError });
      await db.migrate(pool);
      // the local dashboard holds the data folders: release them for the bundle reader by closing it first
      await new Promise<void>((r) => d.server.close(() => r()));
      await importBundle(pool, buildBundle(CFG).bundle, { allowEvents: true, by: 'test' });
      const store = createPgStore({ pool });
      await store.init();
      const views = makeViews({ tasks: store.tasks, inventory: store.inventory, load: (k: string) => store.load(k), hasLog: (t: J) => store.hasLog(t.key), audioInfo: () => ({ local: true, policy: 'direct' }) }); // reachable on both sides: compare the review arithmetic
      const cloud = views.dashboard('TEST One').metrics;
      for (const k of ['recordings', 'startsTotal', 'startsReviewed', 'startsAwaiting', 'recordingsAwaiting', 'partiallyReviewed', 'recordingsReviewComplete', 'recordingsCompletedSingle', 'highTotal', 'highAwaiting', 'startsSubmitted1', 'startsSubmitted2', 'startsVerified', 'verified', 'manualTiming', 'withProposals', 'productionChecks'])
        expect([k, cloud[k]]).toEqual([k, before[k]]);
    } finally {
      // Every connection really closed (also when an expectation failed), then the server stops.
      if (pool) await db.closePool(pool);
      await pg.stop();
      d = createDashboard({ config: CFG, autoBackup: false });
      await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    }
    await new Promise((r) => setTimeout(r, 250));
    expect(poolErrors).toEqual([]);
  }, 120000);
});
