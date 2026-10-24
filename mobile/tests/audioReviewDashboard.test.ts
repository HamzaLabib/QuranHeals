import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 4.8: the unified audio review dashboard (tools/quran-audio/review/dashboard). Every test runs in a temporary
// workspace on SYNTHETIC audio (tone bursts) and hand-made packages; reviewer names are test names. No real review
// database, registry, package folder or development timing is read for writing or written.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const lib = await imp('review/dashboard/dashboard-lib.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const { buildExport } = await imp('review/manual/export.mjs');
const { createDashboard } = await imp('review/dashboard/server.mjs');
const backup = await imp('review/dashboard/backup.mjs');
const { lockDataDir } = await imp('review/manual/log-store.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');
const { timingFingerprint } = await imp('fingerprint.mjs');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-dashboard-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const ws = join(work, 'ws');
const pkgsA = join(work, 'packages-a');
const pkgsB = join(work, 'packages-b');
const scan = join(work, 'scan');
const localAudio = join(work, 'local-audio');
const manualWs = join(work, 'manual');
const PY = process.env.QH_PYTHON ?? 'python';
const pythonOk = spawnSync(PY, ['-I', '-c', `import sys; sys.path.insert(0, r'${join(tools, 'pylib')}'); import numpy, miniaudio`]).status === 0;

// ---------------------------------------------------------------- fixtures
const syn112 = makeSynthetic({ surah: 112, key: 'syn-112' });
const { text } = lib.canon();
const BASMALA = text.get('1:1');
/** A review package as make-packages.mjs writes it, on the synthetic 112 timeline. */
function pkg112({ reciterId = 'banna', surah = 112, url, bytes = syn112.wav.length, shift = 0, mutate }: { reciterId?: string; surah?: number; url?: string; bytes?: number; shift?: number; mutate?: (p: J) => void } = {}): J {
  url ??= `https://cdn.mp3quran.net/audio/test/${String(surah).padStart(3, '0')}.mp3`;
  const n = lib.canon().meta.get(surah).ayahs;
  const starts = syn112.truth.starts.slice(0, n).map((s: number) => s + shift);
  const ayahs = Array.from({ length: n }, (_, k) => {
    const t = text.get(`${surah}:${k + 1}`) as string;
    return { ayah: k + 1, startMs: starts[k], endMs: k + 1 < n ? starts[k + 1] : syn112.truth.endMs, text: k === 0 ? t.split(' ').slice(BASMALA.split(' ').length).join(' ') : t };
  });
  const p: J = {
    kind: 'ayah-timing-review-package', version: 1, source: 'aligned', createdOn: '2026-10-19', reciterId, reciterEn: 'x', reciterAr: 'x', recording: 'test',
    surah, surahAr: 'x', surahEn: `Surah ${surah}`, ayahCount: n, url, bytes, format: { kbps: 128, mode: 'cbr', durationMs: syn112.session.durationMs },
    textSource: 'tools/quran-verification/input/quran-uthmani.txt', status: 'experimental candidate (plays nowhere)',
    durationMs: syn112.session.durationMs, intro: null, basmala: BASMALA, ayahs,
    boundaries: ayahs.slice(1).map((a, k) => ({ ayah: a.ayah, ms: a.startMs, flags: k === 0 ? ['no-pause', 'configs-disagree'] : k === 1 ? ['short-pause'] : [], priority: k === 0 ? 1 : k === 1 ? 2 : 3, pauseMs: [a.startMs - 1200, a.startMs - 100] })),
    worklist: [2, 3, 4].filter((a) => a <= n), structure: { ok: true, problems: [] },
  };
  mutate?.(p);
  p.candidateFingerprint = timingFingerprint(p.ayahs.map((a: J) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs })));
  return p;
}
function writeIndex(dir: string, packages: J[], extra: J = {}) {
  mkdirSync(dir, { recursive: true });
  const entries = packages.map((p, i) => {
    const file = `aligned/${p.reciterId}/${p.surah}${i ? `-${i}` : ''}.json`;
    mkdirSync(join(dir, 'aligned', p.reciterId), { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(p));
    return { file, source: p.source, reciterId: p.reciterId, surah: p.surah };
  });
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ kind: 'ayah-timing-review-index', createdOn: '2026-10-19', packages: entries, ...extra }));
}
function setup() {
  // manual-timing source (synthetic 98), with one excluded recording
  const syn98 = makeSynthetic({ surah: 98, key: 'syn-98' });
  for (const d of ['sessions', 'audio', 'data']) mkdirSync(join(manualWs, d), { recursive: true });
  writeFileSync(join(manualWs, 'sessions', 'syn-98.json'), JSON.stringify(syn98.session));
  writeFileSync(join(manualWs, 'audio', 'syn-98.wav'), syn98.wav);
  writeFileSync(join(manualWs, 'sessions', 'queue.json'), JSON.stringify({ kind: 'manual-timing-queue', items: [{ key: 'syn-98', group: 'pilot', note: 'synthetic' }], excluded: { 'excerpts (unavailable)': [10] } }));
  // package source A: valid, text-tampered, timing-tampered (fingerprint), non-https, blocked
  const tamperedText = pkg112({ surah: 113, mutate: (p) => { p.ayahs[1].text += 'ـ'; } });
  const tamperedTiming = pkg112({ surah: 114 });
  tamperedTiming.ayahs[2].startMs += 5;
  writeIndex(pkgsA, [
    pkg112(), tamperedText, tamperedTiming,
    pkg112({ surah: 111, url: 'http://example.com/111.mp3' }),
    pkg112({ surah: 110, mutate: (p) => { p.blocked = ['structure failed: test']; } }),
  ]);
  // package source B: the same recording as A's valid package (a duplicate)
  writeIndex(pkgsB, [pkg112()]);
  // local audio: the synthetic tones, named as the Phase 4.1 cache names files
  mkdirSync(localAudio, { recursive: true });
  writeFileSync(join(localAudio, 'banna_112.wav'), syn112.wav);
  mkdirSync(join(scan, 'later'), { recursive: true });
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'dashboard.config.json'), JSON.stringify({
    kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: '../backups', rightsDecisions: 'rights', python: PY,
    sources: [
      { id: 'manual', kind: 'manual-sessions', phase: 'T0', sessions: '../manual/sessions', audio: '../manual/audio', data: '../manual/data' },
      { id: 'a', kind: 'review-packages', phase: 'T1', dir: '../packages-a' },
      { id: 'b', kind: 'review-packages', phase: 'T2', dir: '../packages-b' },
    ],
    scanRoots: ['../scan'], localAudio: [{ dir: '../local-audio', naming: '{reciterId}_{surah}.wav' }],
  }));
  return lib.readConfig(join(ws, 'dashboard.config.json'));
}
const cfg = setup();
const issues = join(work, 'issues.json');
writeFileSync(issues, JSON.stringify({ kind: 'audio-review-known-issues', startHere: { keys: ['banna-112'] }, concerns: [{ reciterId: 'banna', surahs: [112], provider: 'mp3quran', kind: 'content', text: 'test concern', source: 'test' }], notReviewable: [] }));

// The server reads the default known-issues file; the import tests pass the fixture one.
describe('dashboard: discovery, validation and the inventory', () => {
  let inv: J;
  beforeAll(() => { inv = lib.importAll(cfg, { issuesFile: issues }); });

  it('registers one task per recording: the manual session and the valid package, never the duplicate', () => {
    expect(inv.tasks.map((t: J) => t.key).sort()).toEqual(['banna-112', 'syn-98']);
    const dup = inv.superseded.find((s: J) => s.source === 'b');
    expect(dup.by).toBe('banna-112');
    expect(dup.reason).toMatch(/same candidate/);
    expect(new Set(inv.tasks.map((t: J) => `${t.url}|${t.bytes}`)).size).toBe(inv.tasks.length);
    expect(inv.totals.recordings).toBe(2);
    expect(inv.totals.ayahStarts).toBe(8 + 4);
  });

  it('refuses tampered text, tampered timing (fingerprint) and non-https sources, and lists blocked packages apart', () => {
    const why = (s: number) => inv.problems.find((p: J) => p.surah === s)?.problem ?? '';
    expect(why(113)).toMatch(/ayah 2: the text differs/);
    expect(why(114)).toMatch(/fingerprint .* does not match/);
    expect(why(111)).toMatch(/not https/);
    expect(inv.blocked.map((b: J) => b.key)).toEqual(expect.arrayContaining(['banna-110', 'syn-10']));
    expect(inv.tasks.some((t: J) => [110, 111, 113, 114].includes(t.surah))).toBe(false);
  });

  it('keeps the proposal read-only, ranks risk, and records provenance, audio identity and rights', () => {
    const t = inv.tasks.find((x: J) => x.key === 'banna-112');
    expect(t.reviewType).toBe('alignment-verification');
    expect(t.risk.map((r: J) => r[0])).toEqual(['check', 'high', 'medium', 'check']);
    expect(t.priority.label).toBe('start here');
    expect(t.concerns[0].text).toBe('test concern');
    expect(t.audioFile).toMatch(/banna_112\.wav$/);
    expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(t.rights.cleared).toBe(false);
    const s = JSON.parse(readFileSync(t.sessionFile, 'utf8'));
    expect(s.proposal.starts['3']).toBe(syn112.truth.starts[2]);
    expect(s.provenance.packageFile).toBe(join(pkgsA, 'aligned', 'banna', '112.json'));
    const m = inv.tasks.find((x: J) => x.key === 'syn-98');
    expect(m.reviewType).toBe('synthetic-practice');
    expect(m.dataDir).toBe(cfg.sources[0].data); // the manual source's own database, used in place
  });

  it('discovers a new package folder under a scan root (a future phase) without any code change', () => {
    writeIndex(join(scan, 'later'), [pkg112({ surah: 106, bytes: 1234 })], { phase: '9.9' });
    const again = lib.importAll(cfg, { issuesFile: issues });
    const t = again.tasks.find((x: J) => x.key === 'banna-106');
    expect(t.phase).toBe('9.9');
    expect(again.sources.some((s: J) => s.discovered && s.packages === 1)).toBe(true);
    rmSync(join(scan, 'later'), { recursive: true });
  });

  it('maps Phase 4.5 evidence kinds to risk tiers for manual timing', () => {
    const s = { ayahCount: 4, evidence: { starts: [{ ayah: 1, kind: 'unbracketed' }, { ayah: 2, kind: 'conflict' }, { ayah: 3, kind: 'single pause' }, { ayah: 4, kind: 'unbracketed' }] } };
    // Phase 4.8.8: ayah 1 is the opening (plays from 0:00.000): a check, its evidence kept in the reason.
    expect(lib.riskOf(s).map((r: J) => r[0])).toEqual(['check', 'high', 'check', 'high']);
    expect(lib.riskOf(s)[0][1]).toMatch(/unbracketed/);
  });
});

// ---------------------------------------------------------------- server
const FULL_CHECKS = Object.fromEntries(Object.keys(manual.CHECKS).map((k) => [k, 'yes']));
function workFrom(starts: number[], endMs: number, patch: J = {}) {
  return { markers: Object.fromEntries(starts.map((ms, k) => [k + 1, { ms, status: 'confirmed', origin: 'proposal' }])), end: { ms: endMs, status: 'confirmed' }, flags: [], checks: { ...FULL_CHECKS }, comments: '', ...patch };
}
describe('dashboard: server, blind review, persistence', () => {
  let base = '';
  let d: J;
  const post = async (path: string, body: J) => { const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  const ev = (key: string, body: J) => post(`/api/event/${key}`, body);
  const get = async (path: string) => (await fetch(`${base}${path}`)).json();
  async function start() {
    d = createDashboard({ config: cfg, autoBackup: false });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;
  }
  const stop = () => new Promise<void>((r) => d.server.close(() => r()));
  beforeAll(start);
  afterAll(stop);
  const S = syn112.truth.starts.slice(0, 4);
  const END = syn112.truth.endMs;

  it('answers only its own page: other hosts, other origins and non-JSON writes are refused', async () => {
    const status = (headers: J, method = 'GET', path = '/api/dashboard') => new Promise<number>((r) => { const u = new URL(base); const q = http.request({ host: u.hostname, port: u.port, path, method, headers }, (res) => { res.resume(); r(res.statusCode ?? 0); }); q.end(method === 'POST' ? '{}' : undefined); });
    expect(await status({ Host: 'evil.example' })).toBe(403);
    expect(await status({ Origin: 'http://evil.example', 'Content-Type': 'application/json' }, 'POST', '/api/refresh')).toBe(403);
    expect(await status({ 'Content-Type': 'text/plain' }, 'POST', '/api/event/banna-112')).toBe(415);
  });

  it('lists every recording with separate statuses (nothing reviewed, rights pending, not activated)', async () => {
    const dash = await get('/api/dashboard');
    expect(dash.metrics).toMatchObject({ recordings: 2, recordingsAwaiting: 2, startsAwaiting: 12, manualTiming: 0, withProposals: 1, verified: 0, reviewer1Completed: 0 });
    const r = dash.rows.find((x: J) => x.key === 'banna-112');
    expect(r).toMatchObject({ stage: 'human review pending', pipeline: 'alignment completed', rights: 'rights pending', approvedForDevelopment: false, activeInDevelopment: 'not active' });
  });

  it.skipIf(!pythonOk)('prepares the audio: waveform and quiet regions on the decoded timeline, byte ranges for seeking', async () => {
    await post('/api/prepare/banna-112', {});
    let p: J;
    for (let i = 0; i < 100; i++) { p = await get('/api/prepare/banna-112'); if (p.state !== 'working') break; await new Promise((r) => setTimeout(r, 100)); }
    expect(p.state).toBe('ready');
    const s = await get('/api/session/banna-112');
    expect(s.peaks.binMs).toBe(5);
    // the synthetic gaps (1.5 s of digital silence before each burst) are found as quiet regions
    for (const st of S.slice(1)) expect(s.quiet.some((q: J) => Math.abs(q.toMs - st) <= 20)).toBe(true);
    const r = await fetch(`${base}/audio/banna-112`, { headers: { Range: 'bytes=44-1043' } });
    expect(r.status).toBe(206);
    expect(Buffer.from(await r.arrayBuffer()).equals(syn112.wav.subarray(44, 1044))).toBe(true);
  });

  it('keeps Reviewer 2 blind to Reviewer 1, and refuses one name in both roles', async () => {
    expect((await ev('banna-112', { reviewer: 'TEST Amina', role: 1, type: 'join' })).status).toBe(200);
    // never auto-confirmed: a join leaves every start unplaced
    expect(Object.keys((await get('/api/view/banna-112?name=TEST%20Amina')).reviewers[1].work.markers)).toHaveLength(0);
    expect((await ev('banna-112', { reviewer: 'TEST Amina', role: 1, type: 'draft', payload: { work: workFrom(S, END) } })).status).toBe(200);
    expect((await ev('banna-112', { reviewer: 'TEST Amina', role: 1, type: 'submit' })).status).toBe(200);
    expect((await ev('banna-112', { reviewer: 'test amina', role: 2, type: 'join' })).json.error).toMatch(/nobody can be both reviewers/);
    expect((await ev('banna-112', { reviewer: 'TEST Bilal', role: 2, type: 'join' })).status).toBe(200);
    const v = await get('/api/view/banna-112?name=TEST%20Bilal');
    expect(v.reviewers[1].hidden).toMatch(/hidden until both/);
    expect(v.reviewers[1].work).toBeUndefined();
    const att = await get('/api/attention?name=TEST%20Bilal&key=banna-112&tiers=high,medium,check,routine');
    expect(att.rows.every((r: J) => r.mine === null)).toBe(true); // Bilal sees only his own (none), never Amina's
    const dash = await get('/api/dashboard?name=TEST%20Bilal');
    expect(dash.metrics.reviewer1Completed).toBe(1);
    expect(dash.rows.find((x: J) => x.key === 'banna-112').stage).toBe('first review completed');
  });

  it('puts a disagreement first in Needs Attention, resolves it by listening, and still never clears rights', async () => {
    const moved = [...S];
    moved[2] += 600; // Bilal hears ayah 3 starting 600 ms later
    await ev('banna-112', { reviewer: 'TEST Bilal', role: 2, type: 'draft', payload: { work: workFrom(moved, END) } });
    await ev('banna-112', { reviewer: 'TEST Bilal', role: 2, type: 'submit' });
    let dash = await get('/api/dashboard');
    expect(dash.metrics.disputedBoundaries).toBe(1);
    const att = await get('/api/attention?tiers=disputed,high,medium,check');
    expect(att.rows[0]).toMatchObject({ key: 'banna-112', ayah: 3, tier: 'disputed' });
    expect((await ev('banna-112', { reviewer: 'TEST Bilal', role: 2, type: 'resolve-propose', payload: { ayah: 3, ms: moved[2], note: 'the hamza onset is here' } })).status).toBe(200);
    expect((await ev('banna-112', { reviewer: 'TEST Bilal', role: 2, type: 'resolve-accept', payload: { ayah: 3, note: 'x' } })).json.error).toMatch(/other reviewer must accept/);
    expect((await ev('banna-112', { reviewer: 'TEST Amina', role: 1, type: 'resolve-accept', payload: { ayah: 3, note: 'agreed after listening' } })).status).toBe(200);
    dash = await get('/api/dashboard');
    const r = dash.rows.find((x: J) => x.key === 'banna-112');
    expect(r.stage).toBe('technical verification completed');
    expect(r.status).toBe('blocked-by-permissions');
    expect(r.rights).toBe('rights pending');
    expect(r.approvedForDevelopment).toBe(false);
    expect(dash.metrics).toMatchObject({ verified: 1, reviewer2Completed: 1, disputedBoundaries: 0 });
    const exp = await get('/api/export/banna-112?name=TEST%20Amina');
    expect(exp.review.decisions.find((x: J) => x.ayah === 3)).toMatchObject({ original: S[2], final: moved[2], verdict: 'correct' });
    expect(exp.package.blocked.at(-1)).toMatch(/^permissions:/);
    expect(exp.package.candidateFingerprint).toBe(exp.automaticProposal.fingerprint);
  });

  it('restores every review after a restart, and never replaces a session whose review has begun', async () => {
    await stop();
    await start();
    const v = await get('/api/view/banna-112?name=TEST%20Amina');
    expect(v.status.status).toBe('blocked-by-permissions');
    // the package is re-aligned (new timing) after the review began: reported, and the review keeps its version
    writeIndex(pkgsA, [pkg112({ shift: 40 })]);
    const r = await post('/api/refresh', {});
    expect(r.json.problems.some((p: J) => /changed .* after the review of banna-112 began/.test(p.problem))).toBe(true);
    const s = await get('/api/session/banna-112');
    expect(s.proposal.starts['2']).toBe(S[1]);
    expect((await get('/api/view/banna-112?name=TEST%20Amina')).status.status).toBe('blocked-by-permissions');
  });

  it('shows a new review package after Refresh queue, in the list and in Needs Attention', async () => {
    writeIndex(join(scan, 'phase-9'), [pkg112({ surah: 108, bytes: 4321 })], { phase: '9' });
    const r = await post('/api/refresh', {});
    expect(r.json.added).toEqual(['banna-108']);
    const att = await get('/api/attention?key=banna-108&tiers=high,medium,check,routine');
    expect(att.total).toBe(3); // surah 108: ayah 1 (opening) to check, 2 high, 3 medium
    rmSync(join(scan, 'phase-9'), { recursive: true });
    await post('/api/refresh', {});
  });
});

// ---------------------------------------------------------------- apply-review compatibility
describe('dashboard: export compatible with development/apply-review.mjs', () => {
  // A package with the catalogue identity of a real untimed recording (Banna 112, no production timing), synthetic
  // timing; output to a temporary file only (QH_DEVELOPMENT_TIMING).
  const audit = JSON.parse(readFileSync(join(tools, 'audit-results.json'), 'utf8')).reciters.find((r: J) => r.id === 'banna');
  const dev = JSON.parse(readFileSync(join(tools, 'development/development-timing.json'), 'utf8'));
  const dir = join(work, 'apply');
  mkdirSync(dir, { recursive: true });
  const real = pkg112({ url: `${audit.server}112.mp3`, bytes: audit.bytes[112] });
  const pkgFile = join(dir, 'banna-112.json');
  writeFileSync(pkgFile, JSON.stringify(real));
  const raw = readFileSync(pkgFile, 'utf8');
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const session = (rights: J, synthetic = false) => ({ ...lib.sessionFromPackage(real, { key: 'banna-112', provider: 'mp3quran', sourceId: 't', phase: 'T', packageFile: pkgFile, packageSha256: sha(raw), issues: { rights: [] }, concerns: [], sha256: null }), rights, synthetic });
  let n = 0;
  function run(s: J, moved = 0) {
    const state = manual.emptyState();
    const events: J[] = [];
    let prev = 'genesis';
    const S = real.ayahs.map((a: J) => a.startMs);
    const w2 = [...S]; w2[1] += moved;
    for (const [reviewer, role, type, payload] of [['TEST Amina', 1, 'join', {}], ['TEST Amina', 1, 'draft', { work: workFrom(S, syn112.truth.endMs) }], ['TEST Amina', 1, 'submit', {}], ['TEST Bilal', 2, 'join', {}], ['TEST Bilal', 2, 'draft', { work: workFrom(w2, syn112.truth.endMs) }], ['TEST Bilal', 2, 'submit', {}]] as const) {
      const e: J = { seq: events.length + 1, at: '2026-10-19T10:00:00Z', reviewer, role, type, payload, prev };
      manual.applyEvent(s, state, e); e.hash = manual.eventHash(prev, e); prev = e.hash; events.push(e);
    }
    const rec = buildExport(s, state, events, { exportedAt: '2026-10-19T12:00:00Z' });
    const p = join(dir, `p${++n}.json`); const rv = join(dir, `r${n}.json`); const out = join(dir, `dev${n}.json`);
    writeFileSync(p, JSON.stringify(rec.package)); writeFileSync(rv, JSON.stringify(rec.review)); writeFileSync(out, JSON.stringify(dev));
    try {
      execFileSync('node', [join(tools, 'development/apply-review.mjs'), p, rv], { env: { ...process.env, QH_DEVELOPMENT_TIMING: out }, stdio: 'pipe' });
      return { ok: true, dev: JSON.parse(readFileSync(out, 'utf8')), rec };
    } catch (error) {
      expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(dev); // nothing written on refusal
      return { ok: false, why: String((error as { stderr?: Buffer }).stderr).match(/Error: (refused: [^\r\n]*)/)?.[1], rec };
    }
  }
  const cleared = { cleared: true, reason: 'test decision' };

  it('refuses while rights are pending, and refuses synthetic data', () => {
    expect(run(session({ cleared: false, reason: 'not established' })).why).toMatch(/refused: blocked: permissions: not established/);
    expect(run(session(cleared, true)).why).toMatch(/synthetic test data is never applied/);
  });

  it('applies verified two-reviewer timing in the aligned format once rights are cleared (temporary file only)', () => {
    const r = run(session(cleared), 120);
    expect(r.ok).toBe(true);
    const t = r.dev.reciters.banna.surahs['112'];
    expect(t[1][0]).toBe(real.ayahs[1].startMs); // ayah 2: 120 ms apart is within the 250 ms agreement; Reviewer 1's time stands
    expect(r.dev.reciters.banna.evidence['112'].listening).toMatch(/TEST Amina .*TEST Bilal/);
  });

  it('produces no pair when the package on disk is no longer the one reviewed', () => {
    const s = session(cleared);
    s.provenance.packageSha256 = '0'.repeat(64);
    expect(run(s).rec.pairUnavailable).toMatch(/missing or changed/);
  });
});

// ---------------------------------------------------------------- backups and single writer
describe('dashboard: backups and one writer per database', () => {
  it('snapshots every database with a manifest, verifies it, and restores only into an empty folder', () => {
    const b = backup.snapshot(cfg, { label: 'test', now: new Date('2026-10-19T10:00:00Z') });
    expect(b.chainProblems).toEqual([]);
    expect(backup.verify(b.dir)).toEqual([]);
    const m = JSON.parse(readFileSync(join(b.dir, 'manifest.json'), 'utf8'));
    expect(m.files.some((f: J) => f.path === 'dashboard-data/banna-112/events.jsonl')).toBe(true);
    const to = join(work, 'restored');
    const r = backup.restore(b.dir, to);
    expect(r.files).toBe(m.files.length);
    expect(readFileSync(join(to, 'dashboard-data/banna-112/events.jsonl'), 'utf8')).toBe(readFileSync(join(cfg.dataDir, 'banna-112', 'events.jsonl'), 'utf8'));
    expect(() => backup.restore(b.dir, to)).toThrow(/not empty/);
    // damage is detected: a changed byte in the snapshot, and a log edited outside the tool
    const f = join(b.dir, 'dashboard-data/banna-112/events.jsonl');
    const text = readFileSync(f, 'utf8');
    writeFileSync(f, text.replace('TEST Bilal', 'TEST Bilax'));
    expect(backup.verify(b.dir).join()).toMatch(/differs from the manifest/);
    const copy = join(work, 'edited');
    cpSync(cfg.dataDir, copy, { recursive: true });
    writeFileSync(join(copy, 'banna-112', 'events.jsonl'), text.replace('TEST Bilal', 'TEST Bilax'));
    const c2 = { ...cfg, dataDir: copy, backupDir: join(work, 'backups2') };
    expect(backup.snapshot(c2, { label: 'test' }).chainProblems.join()).toMatch(/hash chain broken/);
  });

  it('refuses a second writer (another process) on a locked data folder', () => {
    const dir = join(work, 'locked');
    const release = lockDataDir(dir, { label: 'test' });
    const child = spawnSync('node', ['--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(join(tools, 'review/manual/log-store.mjs')).href)}).then((m) => m.lockDataDir(${JSON.stringify(dir)})).then(() => console.log('LOCKED'), (e) => console.log(e.message))`], { encoding: 'utf8' });
    expect(child.stdout).toMatch(/in use by another test/);
    release();
    const again = spawnSync('node', ['--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(join(tools, 'review/manual/log-store.mjs')).href)}).then((m) => m.lockDataDir(${JSON.stringify(dir)})).then(() => console.log('LOCKED'), (e) => console.log(e.message))`], { encoding: 'utf8' });
    expect(again.stdout.trim()).toBe('LOCKED');
    expect(readdirSync(dir)).toEqual([]); // the child released its lock on exit
  });
});

// ---------------------------------------------------------------- production boundary checks
describe('dashboard: production boundary checks (documented starts of recordings already in the app)', () => {
  it('registers every boundary the source audit left for listening, and only those, as scoped checks', () => {
    const dir = join(work, 'prod');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'dashboard.config.json'), JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: 'backups', sources: [{ id: 'prod', kind: 'production-review', phase: 'source audit' }] }));
    const inv = lib.importAll(lib.readConfig(join(dir, 'dashboard.config.json')));
    const audit = JSON.parse(readFileSync(join(tools, 'audit-results.json'), 'utf8'));
    const flagged = audit.reciters.flatMap((r: J) => Object.entries(r.review ?? {}).flatMap(([s, l]: J) => l.map((x: string) => `${r.id}:${s}:${x.split(' ')[0].split(':')[1]}`)));
    const scoped = inv.tasks.flatMap((t: J) => JSON.parse(readFileSync(t.sessionFile, 'utf8')).scope.map((a: number) => `${t.reciterId}:${t.surah}:${a}`));
    for (const f of flagged) expect(scoped).toContain(f); // all 1,194 flagged starts, none lost
    expect(inv.problems).toEqual([]);
    for (const t of inv.tasks) {
      expect(t.reviewType).toBe('production-boundary-check');
      expect(audit.reciters.find((r: J) => r.id === t.reciterId).timed[t.surah]).toBeTruthy(); // only recordings in production
      expect(t.counts.starts).toBeLessThanOrEqual(t.ayahCount);
    }
    const s = JSON.parse(readFileSync(inv.tasks.find((t: J) => t.key === 'abdulbasit-2').sessionFile, 'utf8'));
    expect(s.scope).toEqual([29, 93, 193, 200]);
    expect(s.proposal.starts['29']).toBe(554796); // the production start the boundary sweep tested
  });

  it('reviews only the scoped starts, needs no recitation end, and yields findings, never timing', () => {
    const base = { ...syn112.session, synthetic: false, reviewType: 'production-boundary-check', scope: [2, 3], proposal: { source: 'production', starts: { 2: syn112.truth.starts[1], 3: syn112.truth.starts[2] - 900 }, boundaries: [] } };
    const st = manual.emptyState();
    const events: J[] = [];
    let prev = 'genesis';
    const w = (shift: number) => ({ markers: { 2: { ms: syn112.truth.starts[1], status: 'confirmed' }, 3: { ms: syn112.truth.starts[2] + shift, status: 'confirmed' } }, end: null, flags: [], checks: { playback: 'yes' }, comments: '' });
    expect(manual.validateWork(base, { ...w(0), markers: { 2: w(0).markers[2] } }, { full: true }).join()).toMatch(/ayah 3: no start placed/);
    expect(manual.validateWork(base, w(0), { full: true })).toEqual([]); // no end, no other check needed
    for (const [reviewer, role, type, payload] of [['TEST A', 1, 'join', {}], ['TEST A', 1, 'draft', { work: w(0) }], ['TEST A', 1, 'submit', {}], ['TEST B', 2, 'join', {}], ['TEST B', 2, 'draft', { work: w(60) }], ['TEST B', 2, 'submit', {}]] as const) {
      const e: J = { seq: events.length + 1, at: '2026-10-19T10:00:00Z', reviewer, role, type, payload, prev };
      manual.applyEvent(base, st, e); e.hash = manual.eventHash(prev, e); prev = e.hash; events.push(e);
    }
    const status = manual.recordingStatus(base, st);
    expect(status.status).toBe('boundaries-verified');
    expect(status.comparison.map((c: J) => c.key)).toEqual([2, 3]);
    expect(status.findings).toEqual([`ayah 3: the production start (${syn112.truth.starts[2] - 900} ms) is 900 ms early; the reviewers agreed ${syn112.truth.starts[2]} ms`]);
    expect(manual.finalTiming(base, st)).toBeNull();
    const rec = buildExport(base, st, events);
    expect(rec.package).toBeNull();
    expect(rec.findings).toHaveLength(1);
  });
});
