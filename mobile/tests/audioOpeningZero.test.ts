import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getReciter, surahAudioUrl } from '@/audio/reciters';
import { ayahAt, ayahStartMs } from '@/audio/timing';
import { verifyVersion, type VerifiedEntry } from '@/audio/verifiedTiming';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

// Phase 4.8.8: the opening rule. Ayah 1 of every complete surah recording plays from 0:00.000; nothing else moves; the
// original first timestamp is kept as the ayah-1 onset (highlighting). SYNTHETIC recordings and TEST reviewer names
// only, in temporary workspaces.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const opening = await imp('review/manual/opening.mjs');
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const auto = await imp('review/dashboard/auto-accept.mjs');
const { createDashboard } = await imp('review/dashboard/server.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');
const { timingFingerprint } = await imp('fingerprint.mjs');
const { buildExport } = await imp('review/manual/export.mjs');
const rules = await imp('review/cloud/publication-rules.mjs');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-opening-'));
afterAll(() => { try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp only */ } });

const syn = makeSynthetic({ surah: 112, key: 'syn-112' });
const ONSET = syn.truth.starts[0]; // 2000 ms: the synthetic "Basmala" comes first
const { text } = lib.canon();
const BAS = text.get('1:1');
function pkg(reciterId: string, surah: number, extra: J = {}) {
  const n = lib.canon().meta.get(surah).ayahs;
  const starts = syn.truth.starts.slice(0, n);
  const ayahs = Array.from({ length: n }, (_, k) => { const t = text.get(`${surah}:${k + 1}`) as string; return { ayah: k + 1, startMs: starts[k], endMs: k + 1 < n ? starts[k + 1] : syn.truth.endMs, text: k === 0 ? t.split(' ').slice(BAS.split(' ').length).join(' ') : t }; });
  const p: J = { kind: 'ayah-timing-review-package', version: 1, source: 'aligned', createdOn: '2026-10-23', reciterId, reciterEn: 'x', reciterAr: 'x', recording: 'test', surah, surahAr: 'x', surahEn: `S${surah}`, ayahCount: n,
    url: `https://cdn.mp3quran.net/audio/test-${reciterId}/${surah}.mp3`, bytes: syn.wav.length, format: { kbps: 128, mode: 'cbr', durationMs: syn.session.durationMs }, textSource: 't', status: 's', durationMs: syn.session.durationMs, intro: [100, ONSET], basmala: BAS, ayahs,
    boundaries: ayahs.slice(1).map((a) => ({ ayah: a.ayah, ms: a.startMs, flags: [], priority: 3, pauseMs: null })), worklist: [2], structure: { ok: true, problems: [] },
    completeness: { collapsed: 0, collapsed_runs: [], missing_in_alignment: [] }, ...extra };
  p.candidateFingerprint = timingFingerprint([{ ayah: 0, startMs: 100, endMs: ONSET }, ...p.ayahs.map((a: J) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs }))]);
  return p;
}
/** A non-synthetic session with a proposal (what the dashboard registers from a package). */
const session = (extra: J = {}) => ({ ...syn.session, synthetic: false, evidence: null, proposal: { source: 'aligned', fingerprint: 'fp', starts: Object.fromEntries(syn.truth.starts.map((ms: number, i: number) => [i + 1, ms])), endMs: syn.truth.endMs, intro: [100, ONSET], boundaries: [{ ayah: 1, ms: ONSET, flags: [], priority: 3, opening: true }], worklist: [], completeness: { collapsed_runs: [], missing_in_alignment: [] } }, ...extra });
const full = (n: number, f: (a: number) => J = () => ({})) => ({ markers: Object.fromEntries(syn.truth.starts.slice(0, n).map((ms: number, i: number) => [i + 1, { ms, status: 'confirmed', ...f(i + 1) }])), end: { ms: syn.truth.endMs, status: 'confirmed' }, flags: [], checks: Object.fromEntries(Object.keys(manual.CHECKS).map((k) => [k, 'yes'])), comments: '' });

// ================================================================ the rule (pure)
describe('the opening rule (pure)', () => {
  it('applies to a complete recording: effective start 0, the first timestamp kept as the onset; later starts unchanged', () => {
    const o = opening.openingOf(session());
    expect(o).toMatchObject({ rule: 'opening-zero-v1', applies: true, status: 'applied', startMs: 0, onsetMs: ONSET, introMs: [100, ONSET] });
    expect(opening.effectiveStartMs(session(), 1, ONSET)).toBe(0);
    expect(opening.effectiveStartMs(session(), 2, 7500)).toBe(7500);
    expect(opening.effectiveStartMs(session(), '1', 9999)).toBe(0);
  });

  it('excludes (and says why) synthetic data, an excerpt, a partial file, an alignment without ayah 1; out of scope: a check without ayah 1', () => {
    expect(opening.openingOf({ ...session(), synthetic: true })).toMatchObject({ applies: false, status: 'excluded' });
    expect(opening.openingOf({ ...session(), excerpt: true })).toMatchObject({ applies: false, status: 'excluded', reason: expect.stringMatching(/excerpt/) });
    expect(opening.openingOf({ ...session(), partial: true })).toMatchObject({ applies: false, status: 'excluded' });
    const s = session(); s.proposal.completeness.missing_in_alignment = [1];
    expect(opening.openingOf(s)).toMatchObject({ applies: false, status: 'excluded', reason: expect.stringMatching(/no ayah 1/) });
    expect(opening.openingOf({ ...session(), scope: [3, 4] })).toMatchObject({ applies: false, status: 'out-of-scope' });
    expect(opening.openingOf({ ...session(), scope: [1, 4] })).toMatchObject({ applies: true });
    expect(opening.effectiveStartMs({ ...session(), scope: [3] }, 1, 1234)).toBe(1234);
  });

  it('reports exceptions instead of hiding them: collapsed onset, flags, Phase 4.5 evidence, a late ayah 1', () => {
    const s = session(); s.proposal.completeness.collapsed_runs = ['1-2'];
    expect(opening.openingOf(s).exceptions.map((x: J) => x.kind)).toEqual(['onset-uncertain', 'lead-in']);
    const p = session({ scope: [1, 3] }); p.proposal.boundaries = [{ ayah: 1, ms: 900, flags: ['displaced'], priority: 1 }]; p.proposal.starts[1] = 900;
    expect(opening.openingOf(p).exceptions.map((x: J) => x.kind)).toEqual(['flagged']);
    const r = { ...syn.session, synthetic: false, proposal: null, evidence: { starts: [{ ayah: 1, kind: 'unbracketed' }] } };
    expect(opening.openingOf(r)).toMatchObject({ applies: true, onsetMs: null, exceptions: [{ kind: 'evidence' }] });
  });

  it('risk: the opening is a check only, never high or medium on its own; every other start keeps its tier', () => {
    const r = { ...syn.session, synthetic: false, proposal: null, evidence: { starts: [{ ayah: 1, kind: 'unbracketed' }, { ayah: 2, kind: 'conflict' }] } };
    const risk = lib.riskOf(r);
    expect(risk[0][0]).toBe('check');
    expect(risk[0][1]).toMatch(/plays from 0:00\.000.*exception: Phase 4\.5 evidence for ayah 1: unbracketed/);
    expect(risk[1][0]).toBe('high'); // ayah 2: unchanged
    const p = session({ scope: [1, 3] }); p.proposal.boundaries = [{ ayah: 1, ms: 900, flags: ['displaced'], priority: 1 }, { ayah: 3, ms: 13000, flags: ['displaced'], priority: 1 }];
    expect(lib.riskOf(p).map((x: J) => x[0])).toEqual(['check', 'n/a', 'high', 'n/a']);
    expect(lib.riskOf({ ...p, scope: [3] })[0][0]).toBe('n/a');
  });

  it('a package that declares an opening above 0 is refused; a generated declaration is accepted', () => {
    expect(lib.packageProblems(pkg('sufi', 112))).toEqual([]);
    expect(lib.packageProblems(pkg('sufi', 112, { opening: { rule: 'opening-zero-v1', startMs: 0, onsetMs: ONSET } }))).toEqual([]);
    expect(lib.packageProblems(pkg('sufi', 112, { opening: { rule: 'opening-zero-v1', startMs: ONSET, onsetMs: ONSET } })).join()).toMatch(/must play from 0 ms/);
    expect(lib.packageProblems(pkg('sufi', 112, { opening: { rule: 'opening-zero-v1', startMs: 0, onsetMs: 5 } })).join()).toMatch(/must play from 0 ms/);
  });
});

// ================================================================ reviews: old values can never override the rule
describe('reviews and exports: the effective opening is 0', () => {
  const S = session();
  const both = (r1Ms: number, r2Ms: number) => {
    const s = manual.emptyState();
    const ev = (role: number, type: string, payload: J = {}) => manual.applyEvent(S, s, { reviewer: `TEST ${role}`, role, type, payload, at: `2026-10-23T00:00:0${role}Z` });
    ev(1, 'join'); ev(2, 'join');
    ev(1, 'draft', { work: full(4, (a) => (a === 1 ? { ms: r1Ms } : {})) }); ev(2, 'draft', { work: full(4, (a) => (a === 1 ? { ms: r2Ms } : {})) });
    ev(1, 'submit'); ev(2, 'submit');
    return { s, ev };
  };

  it('two reviewers who placed ayah 1 far apart (and above 0) agree on 0; their placements are kept; ayah 2 is unchanged', () => {
    const { s } = both(3000, 3900);
    const c = manual.compare(S, s);
    expect(c[0]).toMatchObject({ key: 1, outcome: 'agreed', finalMs: 0, deltaMs: 0, opening: 'opening-zero-v1', r1: { ms: 0, placedMs: 3000 }, r2: { ms: 0, placedMs: 3900 } });
    expect(c[1]).toMatchObject({ key: 2, finalMs: syn.truth.starts[1] });
    const t = manual.finalTiming(S, s);
    expect(t[0][0]).toBe(0);
    expect(t[0][1]).toBe(syn.truth.starts[1]); // ayah 1 still ends where ayah 2 begins
    expect(t.slice(1).map((x: number[]) => x[0])).toEqual(syn.truth.starts.slice(1));
  });

  it('a later correction or resolution of ayah 1 to another time still plays from 0', () => {
    const { s, ev } = both(3000, 3100);
    ev(1, 'revise', { key: '1', marker: { ms: 5000, status: 'confirmed' }, reason: 'TEST' });
    const c = manual.compare(S, s);
    expect(c[0]).toMatchObject({ finalMs: null, outcome: 'disputed' }); // changed after reveal: a person must resolve it
    ev(1, 'resolve-propose', { ayah: 1, ms: 6000, note: 'TEST' }); ev(2, 'resolve-accept', { ayah: 1, note: 'TEST' });
    expect(manual.compare(S, s)[0]).toMatchObject({ outcome: 'resolved', finalMs: 0 });
    expect(manual.finalTiming(S, s)[0][0]).toBe(0);
  });

  it('the export: effective timing from 0, the onset for highlighting, the reviewers\' times untouched', () => {
    const { s } = both(2100, 2200);
    const rec = buildExport(S, s, [], { exportedAt: '2026-10-23T00:00:00.000Z' });
    expect(rec.timing[0][0]).toBe(0);
    expect(rec.opening).toMatchObject({ rule: 'opening-zero-v1', applies: true, startMs: 0, onsetMs: 2100, onsetSource: 'both reviewers', proposalFirstMs: ONSET });
    expect(rec.reviewers[0].submitted['1'].ms).toBe(2100);
    expect(manual.openingOnset(S, both(3000, 3900).s)).toEqual({ ms: ONSET, source: 'automatic proposal (aligned)' });
  });

  it('the objective checks say so', () => {
    const { s } = both(3000, 3100);
    const o = manual.objectiveChecks(S, s, [], 'TEST 1').find((x: J) => x.id === 'opening');
    expect(o).toMatchObject({ result: 'yes', detail: expect.stringMatching(/0:00\.000.*2\.000 s/) });
    expect(manual.objectiveChecks({ ...S, scope: [3] }, s, [], 'TEST 1').some((x: J) => x.id === 'opening')).toBe(false);
  });
});

// ================================================================ the app: publication format and playback
describe('the app: plays ayah 1 from 0 and highlights from its onset', () => {
  const maher = getReciter('maher')!;
  const surah = Number(Object.keys(maher.timed).find((x) => SURAH_AYAH_COUNTS[Number(x) - 1] <= 8));
  const n = SURAH_AYAH_COUNTS[surah - 1];
  const identity = { reciterId: 'maher', surah, provider: 'mp3quran', url: surahAudioUrl(maher, surah), bytes: maher.timed[surah][1], sha256: 'a'.repeat(64), durationMs: 4000 + n * 10000 + 1000, format: { mode: 'cbr', kbps: 128 } };
  const entries = Array.from({ length: n }, (_, i) => ({ ayah: i + 1, verse: `${surah}:${i + 1}`, startMs: i === 0 ? 0 : 4000 + i * 10000, endMs: 4000 + (i + 1) * 10000 }));
  const publish = (introEndMs?: number) => {
    const c = rules.timingContent(identity, entries, undefined, { introEndMs });
    const entry = { recordingId: c.recordingId, versionId: c.versionId, versionNo: 1, reciterId: 'maher', surah, ayahCount: n, timingFingerprint: c.fingerprint, contentSha256: c.contentSha256, playback: c.body.playback, audio: { provider: 'mp3quran', url: identity.url, bytes: identity.bytes, sha256: identity.sha256, durationMs: identity.durationMs, format: identity.format } };
    return { c, entry, text: JSON.stringify({ ...c.body, versionId: c.versionId, versionNo: 1, createdAt: '2026-10-23T00:00:00.000Z' }) };
  };

  it('a published version starts at 0 and carries the onset; the app plays from 0 and highlights from the onset', () => {
    const { c, entry, text: doc } = publish(4000);
    expect(c.body.timing.entries[0].startMs).toBe(0);
    expect(c.body.timing.introEndMs).toBe(4000);
    const timing = verifyVersion(doc, entry as unknown as VerifiedEntry)!;
    expect(timing).not.toBeNull();
    expect(timing.introEndMs).toBe(4000);
    expect(ayahStartMs(timing, 1)).toBe(0);
    expect(ayahAt(timing, 3999)).toBe(0); // the opening before ayah 1's words: nothing highlighted
    expect(ayahAt(timing, 4000)).toBe(1);
  });

  it('an onset outside ayah 1 is refused by the service (falls back to 0) and by the app', () => {
    expect(publish(entries[0].endMs).c.body.timing.introEndMs).toBe(0);
    const { entry, text: doc } = publish(4000);
    const bad = (v: number) => { const d = JSON.parse(doc); d.timing.introEndMs = v; return verifyVersion(JSON.stringify(d), entry as unknown as VerifiedEntry); };
    expect(bad(entries[0].endMs)).toBeNull();
    expect(bad(-1)).toBeNull();
    expect(bad(4000.5)).toBeNull();
  });

  it('every catalogue timing plays ayah 1 from 0, whatever its first timestamp', () => {
    const timing = { reciterId: 'x', surah: 2, introEndMs: 18920, ayahs: [{ startMs: 18920, endMs: 30000 }, { startMs: 30000, endMs: 40000 }] };
    expect(ayahStartMs(timing, 1)).toBe(0);
    expect(ayahStartMs(timing, 2)).toBe(30000);
  });
});

// ================================================================ the dashboard (synthetic workspace)
describe('the dashboard: amendments, protection, served session, remembered reviewer', () => {
  const PK: [string, number, J?][] = [['sufi', 112], ['maher', 112], ['banna', 108, { completeness: { collapsed: 1, collapsed_runs: ['1'], missing_in_alignment: [] } }]];
  const pk = join(work, 'packages');
  for (const [r, s, x] of PK) { mkdirSync(join(pk, 'aligned', r), { recursive: true }); writeFileSync(join(pk, 'aligned', r, `${s}.json`), JSON.stringify(pkg(r, s, x))); }
  mkdirSync(join(pk, 'aligned', 'ajmi'), { recursive: true });
  writeFileSync(join(pk, 'aligned', 'ajmi', '112.json'), JSON.stringify(pkg('ajmi', 112, { opening: { rule: 'opening-zero-v1', startMs: 1500, onsetMs: ONSET } })));
  writeFileSync(join(pk, 'index.json'), JSON.stringify({ kind: 'ayah-timing-review-index', packages: [...PK.map(([r, s]) => ({ file: `aligned/${r}/${s}.json` })), { file: 'aligned/ajmi/112.json' }] }));
  const ws = join(work, 'ws');
  mkdirSync(ws, { recursive: true });
  const CFG = join(ws, 'dashboard.config.json');
  writeFileSync(CFG, JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: 'backups', python: 'python', localReviewer: { name: 'TEST Hamza', role: 1 },
    sources: [{ id: 'pk', kind: 'review-packages', phase: 'T', dir: '../packages' }] }));
  const DATA = join(ws, 'data');
  const AMEND = auto.amendmentFile(DATA);
  const amends = () => readFileSync(AMEND, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const logs = () => Object.fromEntries(readdirSync(DATA).filter((k) => existsSync(join(DATA, k, 'events.jsonl'))).map((k) => [k, readFileSync(join(DATA, k, 'events.jsonl'), 'utf8')]));
  let d: J; let base: string;
  const start = async (autoAccept: boolean, config: J = CFG) => {
    d = createDashboard({ config, autoBackup: false, autoAccept });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;
  };
  const stop = () => new Promise<void>((r) => d.server.close(() => r()));
  const post = async (key: string, body: J) => { const r = await fetch(`${base}/api/event/${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (r.status !== 200) throw new Error(j.error); return j; };
  const get = (p: string) => fetch(`${base}${p}`).then((r) => r.json());
  let before: J;

  beforeAll(async () => {
    // A reviewer's earlier work, before the rule (a server without the automatic passes): ayah 1 submitted at its onset.
    await start(false);
    await post('sufi-112', { reviewer: 'TEST Hamza', role: 1, type: 'join' });
    await post('sufi-112', { reviewer: 'TEST Hamza', role: 1, type: 'draft', payload: { work: { ...full(2), end: null, checks: {} } } });
    await post('sufi-112', { reviewer: 'TEST Hamza', role: 1, type: 'submit-ayahs', payload: { keys: ['1', '2'] } });
    before = logs();
    await stop();
    await start(true);
  });
  afterAll(stop);

  it('records every first timestamp above 0 in an append-only, chained amendment ledger, after a backup; no review log changes', () => {
    const A = amends();
    expect(A.map((e: J) => e.key).sort()).toEqual(['banna-108', 'maher-112', 'sufi-112']);
    const s = A.find((e: J) => e.key === 'sufi-112');
    expect(s).toMatchObject({ type: 'opening-amendment', rule: 'opening-zero-v1', ayah: 1, effectiveMs: 0, onsetMs: ONSET, by: 'opening rule (not a reviewer)' });
    expect(s.previous.map((p: J) => p.source)).toEqual(['proposal', 'reviewer-submission']);
    expect(s.previous[1]).toMatchObject({ role: 1, name: 'TEST Hamza', ms: ONSET, status: 'confirmed' });
    expect(A.find((e: J) => e.key === 'banna-108').exceptions.map((x: J) => x.kind)).toContain('onset-uncertain');
    expect(A.every((e: J) => e.reviewer === undefined && e.role === undefined)).toBe(true);
    expect(manual.verifyChain(A)).toBe(-1);
    expect(logs()).toEqual(before);
    expect(readdirSync(join(ws, 'backups')).some((b) => b.startsWith('pre-opening-rule-'))).toBe(true);
    // the opening starts are accepted at 0 (a check), the collapsed one included; nothing for the reviewed one
    const acc = readFileSync(auto.ledgerFile(DATA), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e: J) => e.ayah === 1);
    expect(acc.map((e: J) => [e.key, e.proposedMs, e.rule]).sort()).toEqual([['banna-108', 0, 'opening-zero-v1'], ['maher-112', 0, 'opening-zero-v1']]);
  });

  it('a package that declares an opening above 0 is refused at import', async () => {
    const inv = await get('/api/inventory');
    expect(inv.tasks.map((t: J) => t.key)).not.toContain('ajmi-112');
    expect(inv.problems.some((p: J) => /must play from 0 ms/.test(p.problem))).toBe(true);
    expect(inv.totals.opening).toMatchObject({ rule: 'opening-zero-v1', applied: 3, excluded: 0 });
  });

  it('idempotent across restart and refresh; a NEW value above 0 (a later review) gets its own amendment', async () => {
    const n = amends().length;
    d.autoPass('test');
    await fetch(`${base}/api/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await stop(); await start(true);
    expect(amends()).toHaveLength(n);
    await post('maher-112', { reviewer: 'TEST Hamza', role: 1, type: 'join' });
    await post('maher-112', { reviewer: 'TEST Hamza', role: 1, type: 'draft', payload: { work: { ...full(1, () => ({ ms: 2500 })), end: null, checks: {} } } });
    await post('maher-112', { reviewer: 'TEST Hamza', role: 1, type: 'submit-ayahs', payload: { keys: ['1'] } });
    d.autoPass('test');
    const m = amends().filter((e: J) => e.key === 'maher-112');
    expect(m).toHaveLength(2);
    expect(m[1].previous.find((p: J) => p.source === 'reviewer-submission')).toMatchObject({ ms: 2500 });
    expect(manual.verifyChain(amends())).toBe(-1);
  });

  it('serves the effective opening: ayah 1 proposed at 0:00.000, the onset and the rule beside it; ayah 2 unchanged', async () => {
    const S = await get('/api/session/sufi-112');
    expect(S.proposal.starts['1']).toBe(0);
    expect(S.proposal.starts['2']).toBe(syn.truth.starts[1]);
    expect(S.proposal.openingOnsetMs).toBe(ONSET);
    expect(S.proposal.boundaries.find((b: J) => b.ayah === 1)).toMatchObject({ ms: 0, onsetMs: ONSET });
    expect(S.opening).toMatchObject({ applies: true, rule: 'opening-zero-v1', onsetMs: ONSET });
    // the stored session (what the logs replay against) is untouched
    const stored = JSON.parse(readFileSync(join(ws, 'registry', 'sessions', 'sufi-112.json'), 'utf8'));
    expect(stored.proposal.starts['1']).toBe(ONSET);
    // one shared function for every server (local, manual, cloud): the local page gets exactly effectiveSession(stored)
    const eff = opening.effectiveSession(stored);
    expect(S.proposal).toEqual(eff.proposal);
    expect(S.opening).toEqual(eff.opening);
    expect(stored.proposal.starts['1']).toBe(ONSET); // effectiveSession never mutates its input
    expect(opening.effectiveSession({ ...stored, scope: [3] }).proposal.starts['1']).toBe(ONSET); // out of scope: untouched
    const att = await get('/api/attention?tiers=check&show=all&limit=500');
    expect(att.rows.filter((r: J) => r.ayah === 1).every((r: J) => r.proposedMs === 0 && r.opening === 'opening-zero-v1')).toBe(true);
    const v = await get('/api/view/sufi-112?name=TEST%20Hamza');
    expect(v.objective.find((x: J) => x.id === 'opening')).toMatchObject({ result: 'yes' });
  });

  it('a tampered amendment ledger stops the passes (nothing written) until restored', async () => {
    // A same-length edit is noticed by its modification time; Windows file times tick every ~16 ms, so space the writes.
    const tick = () => new Promise((r) => setTimeout(r, 40));
    const good = readFileSync(AMEND, 'utf8');
    await tick(); writeFileSync(AMEND, good.replace('"effectiveMs":0', '"effectiveMs":7'));
    expect(d.autoPass('test')).toMatchObject({ error: expect.stringMatching(/hash chain/) });
    await tick(); writeFileSync(AMEND, good);
    const again = d.autoPass('test');
    expect(again.error, String(again.error)).toBeUndefined();
  });

  it('remembers only Reviewer 1 of this installation; Reviewer 2 can never be the default', async () => {
    expect((await get('/api/info')).localReviewer).toEqual({ name: 'TEST Hamza', role: 1 });
    await stop();
    const cfg = lib.readConfig(CFG);
    await start(false, { ...cfg, raw: { ...cfg.raw, localReviewer: { name: 'TEST Hamza', role: 2 } } });
    expect((await get('/api/info')).localReviewer).toBeNull();
    await stop();
    await start(false, { ...cfg, raw: { ...cfg.raw, localReviewer: undefined } });
    expect((await get('/api/info')).localReviewer).toBeNull();
    await stop();
    await start(true);
  });
});
