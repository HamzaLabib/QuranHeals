import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// Phase 4.6A: the manual ayah-timing tool (tools/quran-audio/review/manual). Every test runs on SYNTHETIC data
// (tone bursts) or hand-made sessions; no real recording is reviewed and no real data directory is touched.
const tools = resolve(__dirname, '../../tools/quran-audio');
const lib = await import(pathToFileURL(join(tools, 'review/manual/manual-lib.mjs')).href);
const { buildExport } = await import(pathToFileURL(join(tools, 'review/manual/export.mjs')).href);
const { createServer } = await import(pathToFileURL(join(tools, 'review/manual/server.mjs')).href);
const { makeSynthetic } = await import(pathToFileURL(join(tools, 'review/manual/synthetic.mjs')).href);
const work = mkdtempSync(join(tmpdir(), 'qh-manual-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

type Marker = { ms: number; status: string; note?: string };
type Work = { markers: Record<number, Marker>; end: Marker | null; flags: object[]; checks: Record<string, string>; comments: string };
const { session: synthetic, truth } = makeSynthetic({ surah: 98 });
const YES = { identity: 'yes', surah: 'yes', complete: 'yes', order: 'yes', extraAudio: 'yes', playback: 'yes' }; // playback: Phase 4.8
/** A complete, valid placement: the synthetic starts shifted by `shift` ms, all confirmed. */
function full(shift = 0, patch: Partial<Work> = {}): Work {
  const markers: Record<number, Marker> = {};
  truth.starts.forEach((s: number, k: number) => (markers[k + 1] = { ms: s + shift, status: 'confirmed' }));
  return { markers, end: { ms: truth.endMs + shift, status: 'confirmed' }, flags: [], checks: { ...YES }, comments: '', ...patch };
}
/** Builds a log through applyEvent, as the server does (hash chain included). */
function logOf(session: object, steps: [string, number | null, string, object?][]) {
  const events: Record<string, unknown>[] = [];
  const state = lib.emptyState();
  let prev = 'genesis';
  for (const [reviewer, role, type, payload = {}] of steps) {
    const ev: Record<string, unknown> = { seq: events.length + 1, at: `2026-10-18T10:00:${String(events.length).padStart(2, '0')}Z`, reviewer, role, type, payload, prev };
    lib.applyEvent(session, state, ev);
    ev.hash = lib.eventHash(prev, ev);
    prev = ev.hash as string;
    events.push(ev);
  }
  return { events, state };
}
const twoReviews = (w1: Work, w2: Work): [string, number | null, string, object?][] => [
  ['Amina', 1, 'join'], ['Amina', 1, 'draft', { work: w1 }], ['Amina', 1, 'submit'],
  ['Bilal', 2, 'join'], ['Bilal', 2, 'draft', { work: w2 }], ['Bilal', 2, 'submit'],
];

describe('manual timing: what a placement may be', () => {
  it('refuses invalid ayah numbers, times outside the audio and starts out of order', () => {
    const p = (w: Partial<Work>) => lib.validateWork(synthetic, { markers: {}, end: null, flags: [], checks: {}, ...w });
    expect(p({ markers: { 9: { ms: 1000, status: 'confirmed' } } })[0]).toMatch(/ayah 9 does not exist in surah 98 \(1-8\)/);
    expect(p({ markers: { 0: { ms: 1000, status: 'confirmed' } } })[0]).toMatch(/ayah 0 does not exist/);
    expect(p({ markers: { 1: { ms: -5, status: 'confirmed' } } })[0]).toMatch(/outside the audio/);
    expect(p({ markers: { 1: { ms: synthetic.durationMs, status: 'confirmed' } } })[0]).toMatch(/outside the audio/);
    expect(p({ markers: { 1: { ms: 5000, status: 'confirmed' }, 2: { ms: 5000, status: 'confirmed' } } })[0]).toMatch(/ayah 2 starts at 5000 ms, not after ayah 1/);
    expect(p({ markers: { 2: { ms: 9000, status: 'confirmed' }, 5: { ms: 8000, status: 'confirmed' } } })[0]).toMatch(/ayah 5 .* not after ayah 2/);
    expect(p({ markers: { 1: { ms: 5000, status: 'maybe' } } })[0]).toMatch(/status maybe/);
    expect(p({ markers: { 1: { ms: 5000, status: 'confirmed' } }, end: { ms: 4000, status: 'confirmed' } })[0]).toMatch(/not after the last placed start/);
    expect(p({ markers: { 1: { ms: 2000, status: 'confirmed' }, 3: { ms: 9000, status: 'uncertain' } } })).toEqual([]); // a draft may be partial
  });

  it('requires every ayah, the recitation end and every check for a submission', () => {
    const w = full();
    expect(lib.validateWork(synthetic, w, { full: true })).toEqual([]);
    delete w.markers[4];
    w.checks = { ...YES, complete: '' } as Record<string, string>;
    const problems = lib.validateWork(synthetic, { ...w, end: null }, { full: true }).join('\n');
    expect(problems).toMatch(/ayah 4: no start placed/);
    expect(problems).toMatch(/recitation end .* not placed/);
    expect(problems).toMatch(/Every ayah of the surah is recited/);
  });

  it('requires a repetition to name its ayahs and its timing implication; "within one ayah" means one ayah', () => {
    const f = (flag: object) => lib.validateWork(synthetic, { ...full(), flags: [flag] }).join('\n');
    expect(f({ kind: 'repetition', fromMs: 1000, toMs: 3000 })).toMatch(/must name the repeated ayahs[\s\S]*choose what the repetition means/);
    expect(f({ kind: 'repetition', fromMs: 1000, toMs: 3000, ayahs: [2, 4], implication: 'within-one-ayah' })).toMatch(/cannot cover ayahs 2-4/);
    expect(f({ kind: 'repetition', fromMs: 1000, toMs: 3000, ayahs: [2, 9], implication: 'unsure' })).toMatch(/not a valid range of 1-8/);
    expect(f({ kind: 'interruption', fromMs: 3000, toMs: 1000 })).toMatch(/not inside the audio/);
    expect(f({ kind: 'repetition', fromMs: 1000, toMs: 3000, ayahs: [2, 4], implication: 'returns-to-earlier-ayahs' })).toBe('');
  });
});

describe('manual timing: two independent reviewers', () => {
  it('keeps Reviewer 2 blind to Reviewer 1 until both have submitted', () => {
    const { state } = logOf(synthetic, [['Amina', 1, 'join'], ['Amina', 1, 'draft', { work: full() }], ['Amina', 1, 'submit'], ['Bilal', 2, 'join'], ['Bilal', 2, 'draft', { work: full(40) }]]);
    const v2 = lib.viewFor(synthetic, state, 'Bilal');
    expect(v2.blind).toBe(true);
    expect(v2.reviewers[1].work).toBeUndefined();
    expect(v2.reviewers[1].hidden).toMatch(/hidden until both reviewers have submitted/);
    expect(v2.reviewers[1].submittedAt).toBeTruthy();
    expect(v2.reviewers[2].work.markers[1].ms).toBe(truth.starts[0] + 40);
    expect(lib.viewFor(synthetic, state, 'Amina').reviewers[2].work).toBeUndefined(); // and the other way round
    expect(v2.status.comparison).toBeNull();
    lib.applyEvent(synthetic, state, { reviewer: 'Bilal', role: 2, type: 'submit', at: 'x' });
    const after = lib.viewFor(synthetic, state, 'Bilal');
    expect(after.blind).toBe(false);
    expect(after.reviewers[1].work.markers[1].ms).toBe(truth.starts[0]);
  });

  it('never lets a reviewer confirm their own work', () => {
    const { state } = logOf(synthetic, [['Amina', 1, 'join']]);
    expect(() => lib.applyEvent(synthetic, state, { reviewer: ' amina ', role: 2, type: 'join', at: 'x' })).toThrow(/nobody can be both reviewers/);
    expect(() => lib.applyEvent(synthetic, lib.emptyState(), { reviewer: 'Bilal', role: 2, type: 'join', at: 'x' })).toThrow(/Reviewer 1 must start before Reviewer 2/);
    expect(() => lib.applyEvent(synthetic, state, { reviewer: 'Bilal', role: 1, type: 'join', at: 'x' })).toThrow(/Reviewer 1 is already Amina/);
    expect(() => lib.applyEvent(synthetic, state, { reviewer: 'Bilal', role: 1, type: 'draft', at: 'x', payload: { work: full() } })).toThrow(/not Reviewer 1/);
  });

  it('agrees within 250 ms; a disagreement needs a proposal by one reviewer and acceptance by the other', () => {
    const w2 = full(120);
    w2.markers[3] = { ms: truth.starts[2] + 900, status: 'confirmed' };
    w2.markers[6] = { ms: truth.starts[5] + 50, status: 'uncertain' };
    const { state } = logOf(synthetic, twoReviews(full(), w2));
    let st = lib.recordingStatus(synthetic, state);
    expect(st.status).toBe('disputed');
    expect(st.reasons.join('\n')).toMatch(/ayah 3: 900 ms apart/);
    expect(st.reasons.join('\n')).toMatch(/ayah 6: Reviewer 2 marked it uncertain/);
    expect(lib.summary(synthetic, state)).toMatchObject({ agreed: 7, disputed: 2, total: 9 });
    const at = 'x';
    expect(() => lib.applyEvent(synthetic, state, { reviewer: 'Amina', role: 1, type: 'resolve-propose', at, payload: { ayah: 3, ms: truth.starts[2] + 300 } })).toThrow(/needs a note/);
    lib.applyEvent(synthetic, state, { reviewer: 'Amina', role: 1, type: 'resolve-propose', at, payload: { ayah: 3, ms: truth.starts[2] + 300, note: 'onset of the first letter' } });
    expect(() => lib.applyEvent(synthetic, state, { reviewer: 'Amina', role: 1, type: 'resolve-accept', at, payload: { ayah: 3, note: 'ok' } })).toThrow(/the other reviewer must accept/);
    lib.applyEvent(synthetic, state, { reviewer: 'Bilal', role: 2, type: 'resolve-accept', at, payload: { ayah: 3, note: 'heard it again: agreed' } });
    lib.applyEvent(synthetic, state, { reviewer: 'Bilal', role: 2, type: 'resolve-propose', at, payload: { ayah: 6, ms: truth.starts[5] + 20, note: 'breath before the ayah' } });
    lib.applyEvent(synthetic, state, { reviewer: 'Amina', role: 1, type: 'resolve-accept', at, payload: { ayah: 6, note: 'agreed' } });
    st = lib.recordingStatus(synthetic, state);
    // Verified by two reviewers, but synthetic sessions (like every Rifaat session) have no cleared rights.
    expect(st.status).toBe('blocked-by-permissions');
    expect(st.verified).toBe(true);
    const timing = lib.finalTiming(synthetic, state);
    expect(timing[2][0]).toBe(truth.starts[2] + 300); // the accepted proposal
    expect(timing[0][0]).toBe(truth.starts[0]); // agreed: Reviewer 1's placement
    expect(timing[1][1]).toBe(timing[2][0]); // each ayah ends where the next starts
    expect(timing.at(-1)[1]).toBe(truth.endMs);
  });

  it('records a boundary nobody can place truthfully as unresolved', () => {
    const { state } = logOf(synthetic, [...twoReviews(full(), full(30)), ['Bilal', 2, 'resolve-unresolvable', { ayah: 5, note: 'the reciter restarts the ayah mid-word' }]]);
    const st = lib.recordingStatus(synthetic, state);
    expect(st.status).toBe('unresolved');
    expect(lib.finalTiming(synthetic, state)).toBeNull();
  });

  it('keeps an amendment after submission auditable: it needs a reason and keeps the previous placements', () => {
    const { state } = logOf(synthetic, twoReviews(full(), full(30)));
    expect(() => lib.applyEvent(synthetic, state, { reviewer: 'Amina', role: 1, type: 'draft', at: 'x', payload: { work: full(60) } })).toThrow(/already submitted: changes now are amendments/);
    expect(() => lib.applyEvent(synthetic, state, { reviewer: 'Amina', role: 1, type: 'amend', at: 'x', payload: { work: full(60) } })).toThrow(/needs a reason/);
    lib.applyEvent(synthetic, state, { reviewer: 'Amina', role: 1, type: 'amend', at: 'x', payload: { work: full(60), reason: 'heard the onsets again' } });
    expect(state.reviewers[1].amendments).toHaveLength(1);
    expect(state.reviewers[1].amendments[0].before.markers[1].ms).toBe(truth.starts[0]);
    expect(state.reviewers[1].work.markers[1].ms).toBe(truth.starts[0] + 60);
  });

  it('detects a log edited outside the tool', () => {
    const { events } = logOf(synthetic, twoReviews(full(), full(30)));
    expect(lib.verifyChain(events)).toBe(-1);
    const forged = structuredClone(events);
    (forged[1].payload as { work: Work }).work.markers[1].ms += 500;
    expect(lib.verifyChain(forged)).toBe(1);
    expect(() => lib.replay(synthetic, forged)).toThrow(/event log broken at event 2/);
  });
});

describe('manual timing: what the recording status means', () => {
  it('is invalid when a reviewer hears an omission, unresolved for a return to earlier ayahs', () => {
    const omission = logOf(synthetic, twoReviews(full(), full(10, { checks: { ...YES, complete: 'no' } })));
    expect(lib.recordingStatus(synthetic, omission.state).status).toBe('invalid');
    const rep = { kind: 'repetition', fromMs: truth.starts[4], toMs: truth.starts[4] + 3000, ayahs: [2, 5], implication: 'returns-to-earlier-ayahs', note: 'goes back to 2' };
    const back = logOf(synthetic, twoReviews(full(0, { flags: [rep] }), full(10)));
    const st = lib.recordingStatus(synthetic, back.state);
    expect(st.status).toBe('unresolved');
    expect(st.reasons[0]).toMatch(/repetition of 2-5 .* one start per ayah cannot represent it/);
    expect(lib.finalTiming(synthetic, back.state)).toBeNull();
  });

  it('accepts an ayah repeated in place only inside that ayah\'s agreed span', () => {
    const inside = { kind: 'repetition', fromMs: truth.starts[2] + 500, toMs: truth.starts[2] + 3500, ayahs: [3, 3], implication: 'within-one-ayah' };
    expect(lib.recordingStatus(synthetic, logOf(synthetic, twoReviews(full(0, { flags: [inside] }), full(10))).state).status).toBe('blocked-by-permissions');
    const outside = { ...inside, toMs: truth.starts[3] + 1000 };
    const st = lib.recordingStatus(synthetic, logOf(synthetic, twoReviews(full(0, { flags: [outside] }), full(10))).state);
    expect(st.status).toBe('unresolved');
    expect(st.reasons[0]).toMatch(/not inside that ayah's agreed span/);
  });

  it('says approved for development consideration only for verified timing with cleared rights (never set by the tool)', () => {
    const cleared = { ...synthetic, rights: { cleared: true } };
    const { state } = logOf(cleared, twoReviews(full(), full(30)));
    expect(lib.recordingStatus(cleared, state).status).toBe('approved-for-development-consideration');
    expect(lib.recordingStatus(synthetic, state).status).toBe('blocked-by-permissions');
  });
});

describe('manual timing: server, persistence and export', () => {
  const sessions = join(work, 'sessions');
  const audio = join(work, 'audio');
  const data = join(work, 'data');
  mkdirSync(sessions, { recursive: true });
  mkdirSync(audio, { recursive: true });
  const { session, wav } = makeSynthetic({ surah: 98, key: 'synthetic-98' });
  writeFileSync(join(sessions, 'synthetic-98.json'), JSON.stringify(session));
  writeFileSync(join(audio, 'synthetic-98.wav'), wav);
  async function start() {
    const server = createServer({ sessions, audio, data });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (body: object) => { const r = await fetch(`${base}/api/event/synthetic-98`, { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
    return { server, base, post, stop: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it('saves every change, refuses invalid ones, and restores everything after a restart', async () => {
    const a = await start();
    expect((await a.post({ reviewer: 'Amina', role: 1, type: 'join' })).status).toBe(200);
    const bad = await a.post({ reviewer: 'Amina', role: 1, type: 'draft', payload: { work: { ...full(), markers: { 1: { ms: 9000, status: 'confirmed' }, 2: { ms: 8000, status: 'confirmed' } } } } });
    expect(bad.status).toBe(409);
    expect(bad.json.error).toMatch(/ayah 2 .* not after ayah 1/);
    const partial = { ...full(), markers: { 1: { ms: truth.starts[0], status: 'confirmed' } } };
    expect((await a.post({ reviewer: 'Amina', role: 1, type: 'draft', payload: { work: partial } })).status).toBe(200);
    await a.stop();
    const log = readFileSync(join(data, 'synthetic-98', 'events.jsonl'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(2); // join + one draft: the refused draft never reached the log
    const b = await start();
    const v = await (await fetch(`${b.base}/api/view/synthetic-98?name=Amina`)).json();
    expect(v.me).toBe(1);
    expect(v.reviewers[1].work.markers[1].ms).toBe(truth.starts[0]);
    await b.stop();
  });

  it('serves byte ranges of the unmodified audio (seeking)', async () => {
    const a = await start();
    const r = await fetch(`${a.base}/audio/synthetic-98`, { headers: { Range: 'bytes=44-1043' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe(`bytes 44-1043/${wav.length}`);
    expect(Buffer.from(await r.arrayBuffer()).equals(wav.subarray(44, 1044))).toBe(true);
    await a.stop();
  });

  it('exports only the caller\'s own work before both submit, and the full record (and apply-review pair) after', async () => {
    const a = await start();
    await a.post({ reviewer: 'Amina', role: 1, type: 'draft', payload: { work: full() } });
    await a.post({ reviewer: 'Amina', role: 1, type: 'submit' });
    expect((await a.post({ reviewer: 'amina', role: 2, type: 'join' })).json.error).toMatch(/nobody can be both reviewers/);
    await a.post({ reviewer: 'Bilal', role: 2, type: 'join' });
    await a.post({ reviewer: 'Bilal', role: 2, type: 'draft', payload: { work: full(80) } });
    const early = await (await fetch(`${a.base}/api/export/synthetic-98?name=Bilal`)).json();
    expect(early.partial).toMatch(/only your own work/);
    expect(early.reviewers.map((r: { name: string }) => r.name)).toEqual(['Bilal']);
    await a.post({ reviewer: 'Bilal', role: 2, type: 'submit' });
    const done = await (await fetch(`${a.base}/api/export/synthetic-98?name=Bilal`)).json();
    expect(done.synthetic).toBe(true);
    expect(done.status).toBe('blocked-by-permissions');
    expect(done.reviewers.map((r: { name: string }) => r.name)).toEqual(['Amina', 'Bilal']);
    expect(done.summary).toMatchObject({ agreed: 9, disputed: 0 });
    expect(done.log.events).toBe(7);
    expect(done.package.source).toBe('manual');
    expect(done.package.blocked[0]).toMatch(/^permissions:/);
    expect(done.review.secondReviewer).toBe('Bilal');
    await a.stop();
  });
});

describe('manual timing: compatibility with development/apply-review.mjs', () => {
  // A hand-made session with Rifaat 98's catalogue identity, so apply-review's catalogue checks run; the timing is
  // synthetic and the output goes to a temporary file (QH_DEVELOPMENT_TIMING), never to development-timing.json.
  const audit = JSON.parse(readFileSync(join(tools, 'audit-results.json'), 'utf8')).reciters.find((r: { id: string }) => r.id === 'rifaat');
  const base = {
    ...synthetic, reciterId: 'rifaat', url: `${audit.server}098.mp3`, bytes: audit.bytes[98], synthetic: false,
    rights: { cleared: false, reason: 'usage rights not cleared: the file reserves the recording rights to a third party (Reserved For KFGQPC)' },
  };
  const dev = JSON.parse(readFileSync(join(tools, 'development/development-timing.json'), 'utf8'));
  let n = 0;
  function apply(session: typeof base, steps = twoReviews(full(), full(30)), mutate?: (rec: { package: Record<string, unknown>; review: Record<string, unknown> }) => void) {
    const { events, state } = logOf(session, steps);
    const rec = buildExport(session, state, events, { exportedAt: '2026-10-18T12:00:00Z' });
    if (!rec.package) return { ok: false as const, why: `no package (${rec.status})`, rec };
    mutate?.(rec);
    const p = join(work, `mpkg-${++n}.json`);
    const rv = join(work, `mreview-${n}.json`);
    const out = join(work, `mdev-${n}.json`);
    writeFileSync(p, JSON.stringify(rec.package));
    writeFileSync(rv, JSON.stringify(rec.review));
    writeFileSync(out, JSON.stringify(dev));
    try {
      execFileSync('node', [join(tools, 'development/apply-review.mjs'), p, rv], { env: { ...process.env, QH_DEVELOPMENT_TIMING: out }, stdio: 'pipe' });
      return { ok: true as const, dev: JSON.parse(readFileSync(out, 'utf8')), rec };
    } catch (error) {
      expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(dev); // nothing written on refusal
      return { ok: false as const, why: String((error as { stderr?: Buffer }).stderr).match(/Error: (refused: [^\r\n]*)/)?.[1], rec };
    }
  }

  it('refuses while the rights are not cleared (every Rifaat session today)', () => {
    const r = apply(base);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/refused: blocked: permissions: .*not cleared/);
  });

  it('refuses synthetic data, a single reviewer, and reviewers other than the package\'s', () => {
    const cleared = { ...base, rights: { cleared: true } };
    expect(apply({ ...cleared, synthetic: true }).why).toMatch(/synthetic test data is never applied/);
    expect(apply(cleared, undefined, (rec) => { rec.review.secondReviewer = 'amina'; }).why).toMatch(/second, different reviewer/);
    expect(apply(cleared, undefined, (rec) => { rec.review.secondReviewer = 'Someone Else'; }).why).toMatch(/not the package's independent reviewers/);
    expect(apply(cleared, undefined, (rec) => { rec.review.version = 2; }).why).toMatch(/two-reviewer review \(version 3\)/);
  });

  it('produces no package at all for disputed or unresolved timing', () => {
    const w2 = full(30);
    w2.markers[4] = { ms: truth.starts[3] + 2000, status: 'confirmed' };
    expect(apply({ ...base, rights: { cleared: true } }, twoReviews(full(), w2)).why).toBe('no package (disputed)');
  });

  it('writes verified two-reviewer timing, in the existing format, once rights are cleared (temporary file only)', () => {
    const r = apply({ ...base, rights: { cleared: true } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.dev.reciters.rifaat.surahs['98'];
    expect(t).toHaveLength(8);
    expect(t[0]).toEqual([truth.starts[0], truth.starts[1]]);
    expect(t[7][1]).toBe(truth.endMs);
    expect(r.dev.reciters.rifaat.evidence['98'].manual).toMatch(/placed by ear by Amina and independently by Bilal/);
    // Phase 4.8.8: development timing keeps ayah 1's onset (the app plays it from 0 and highlights from the onset), so
    // its evidence carries the package's fingerprint; the record's own timing is the effective one, from 0.
    expect(r.dev.reciters.rifaat.evidence['98'].fingerprint).toBe(r.rec.package.candidateFingerprint);
    expect(r.rec.timing[0][0]).toBe(0);
    expect(r.rec.package.opening).toEqual({ rule: 'opening-zero-v1', startMs: 0, onsetMs: truth.starts[0] });
  });
});
