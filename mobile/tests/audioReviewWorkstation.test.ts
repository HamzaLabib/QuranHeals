import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// Phase 4.8.4: the review workstation's automatic (objective) checks and the completion gate. SYNTHETIC data only
// (tone bursts on Surah 98's layout), test reviewer names, temporary folders.
const tools = resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const lib = await imp('review/manual/manual-lib.mjs');
const { createDashboard } = await imp('review/dashboard/server.mjs');
const { makeSynthetic } = await imp('review/manual/synthetic.mjs');

type J = any;
const work = mkdtempSync(join(tmpdir(), 'qh-ws-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const { session, truth, wav } = makeSynthetic({ surah: 98, key: 'syn-98' });
const S = { ...session, sha256: 'a'.repeat(64) };
const draft = (ayahs: number[], shift = 0, extra: J = {}) => ({ markers: Object.fromEntries(ayahs.map((a) => [a, { ms: truth.starts[a - 1] + shift, status: 'confirmed' }])), end: null, flags: [], checks: {}, comments: '', ...extra });
class Log {
  events: J[] = []; state = lib.emptyState(); prev = 'genesis';
  constructor(public s: J = S) {}
  add(reviewer: string, role: number, type: string, payload: J = {}) {
    const ev: J = { seq: this.events.length + 1, at: `2026-10-19T10:${String(this.events.length).padStart(2, '0')}:00Z`, reviewer, role, type, payload, prev: this.prev };
    lib.applyEvent(this.s, this.state, ev); ev.hash = lib.eventHash(this.prev, ev); this.prev = ev.hash; this.events.push(ev); return this;
  }
}
const res = (checks: J[], id: string) => checks.find((c) => c.id === id);

describe('objective checks: YES only with evidence, NO only on a detected error, otherwise Needs Review', () => {
  it('a fresh recording: text YES; identity, timings, submission and audit Need Review', () => {
    const c = lib.objectiveChecks(S, lib.emptyState(), [], 'TEST A', null);
    expect(res(c, 'text').result).toBe('yes');
    for (const id of ['identity', 'timings-complete', 'timings-valid', 'submission', 'audit']) expect(res(c, id).result).toBe('unknown');
  });

  it('identity: YES when size and SHA-256 match; NO on a mismatch; Needs Review without a hash or on a network failure', () => {
    const st = lib.emptyState();
    expect(res(lib.objectiveChecks(S, st, [], 'x', { bytes: S.bytes, sha256: S.sha256 }), 'identity').result).toBe('yes');
    expect(res(lib.objectiveChecks(S, st, [], 'x', { bytes: S.bytes, sha256: 'b'.repeat(64) }), 'identity').result).toBe('no');
    expect(res(lib.objectiveChecks(S, st, [], 'x', { bytes: S.bytes + 1, sha256: S.sha256 }), 'identity').result).toBe('no');
    expect(res(lib.objectiveChecks(S, st, [], 'x', { bytes: S.bytes, sha256: null }), 'identity').result).toBe('unknown');
    const net = res(lib.objectiveChecks(S, st, [], 'x', { problem: 'the provider could not be reached (ECONNRESET)', network: true }), 'identity');
    expect(net.result).toBe('unknown'); // an outage is not a validation failure
    expect(net.detail).toMatch(/could not be checked/);
    expect(res(lib.objectiveChecks(S, st, [], 'x', { problem: 'the provider now serves 12 bytes', network: false }), 'identity').result).toBe('no');
  });

  it('timings: incomplete work Needs Review, complete valid work YES; recalculated after a correction', () => {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft([1, 2, 3]) });
    let c = lib.objectiveChecks(S, L.state, L.events, 'TEST A', null);
    expect(res(c, 'timings-complete').result).toBe('unknown');
    expect(res(c, 'timings-valid').result).toBe('yes');
    L.add('TEST A', 1, 'draft', { work: { ...draft([1, 2, 3, 4, 5, 6, 7, 8]), end: { ms: truth.endMs, status: 'confirmed' } } });
    L.add('TEST A', 1, 'submit-ayahs', { keys: ['1', '2'] });
    c = lib.objectiveChecks(S, L.state, L.events, 'TEST A', null);
    expect(res(c, 'timings-complete').result).toBe('yes');
    expect(res(c, 'submission').result).toBe('yes');
    L.add('TEST A', 1, 'revise', { key: '2', marker: { ms: truth.starts[1] + 90, status: 'confirmed' }, reason: 'heard again' });
    c = lib.objectiveChecks(S, L.state, L.events, 'TEST A', null);
    expect(res(c, 'submission').result).toBe('yes'); // the correction updated both the snapshot and the work
    expect(res(c, 'audit').result).toBe('yes');
  });

  it('detects real errors as NO: invalid timestamps, a submission differing from the work, a broken audit chain', () => {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft([1, 2]) }).add('TEST A', 1, 'submit-ayahs', { keys: ['1'] });
    const bad = structuredClone(L.state);
    bad.reviewers[1].work.markers[2].ms = 1; // before ayah 1: out of order (only possible by tampering)
    expect(res(lib.objectiveChecks(S, bad, L.events, 'TEST A', null), 'timings-valid').result).toBe('no');
    const bad2 = structuredClone(L.state);
    bad2.reviewers[1].work.markers[1].ms += 500;
    expect(res(lib.objectiveChecks(S, bad2, L.events, 'TEST A', null), 'submission').result).toBe('no');
    const forged = structuredClone(L.events); forged[1].payload.work.markers[1].ms += 1;
    expect(res(lib.objectiveChecks(S, L.state, forged, 'TEST A', null), 'audit').result).toBe('no');
  });

  it('never answers or changes a human question, and never reveals the other reviewer', () => {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: draft([1, 2, 3], 0, { checks: { identity: 'no' } }) }).add('TEST A', 1, 'submit-ayahs', { keys: ['1', '2', '3'] });
    L.add('TEST B', 2, 'join');
    const before = JSON.stringify(L.state);
    const c = lib.objectiveChecks(S, L.state, L.events, 'TEST B', { bytes: S.bytes, sha256: S.sha256 });
    expect(JSON.stringify(L.state)).toBe(before); // pure: nothing written
    expect(c.map((x: J) => x.id)).not.toContain('identity-voice');
    expect(L.state.reviewers[1].work.checks.identity).toBe('no'); // the human answer is untouched
    for (const ms of truth.starts.slice(0, 3)) expect(JSON.stringify(c)).not.toContain(String(ms)); // blind to Reviewer 1
  });

  it('the completion gate: a final submission is refused while a submitted start differs from the work, and while a human check is unanswered', () => {
    const L = new Log().add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: { ...draft([1, 2, 3, 4, 5, 6, 7, 8]), end: { ms: truth.endMs, status: 'confirmed' } } });
    expect(() => L.add('TEST A', 1, 'submit')).toThrow(/check .* is not answered/);
    L.add('TEST A', 1, 'submit-ayahs', { keys: ['1'] });
    const tampered = structuredClone(L.state);
    tampered.reviewers[1].work = { ...tampered.reviewers[1].work, checks: Object.fromEntries(Object.keys(lib.CHECKS).map((k) => [k, 'yes'])) };
    tampered.reviewers[1].work.markers[1].ms += 300;
    expect(() => lib.applyEvent(S, tampered, { reviewer: 'TEST A', role: 1, type: 'submit', at: 'x' })).toThrow(/differs from its submitted judgement/);
  });
});

describe('Phase 4.8.4.1: bulk decisions and no listening requirement (synthetic proposal on Surah 98)', () => {
  const SP = { ...S, proposal: { starts: Object.fromEntries(truth.starts.map((ms: number, i: number) => [i + 1, ms])), endMs: truth.endMs, boundaries: [], worklist: [] } };
  const P = (a: number) => truth.starts[a - 1];
  const fresh = (markers: J = {}) => new Log(SP).add('TEST A', 1, 'join').add('TEST A', 1, 'draft', { work: { markers, end: null, flags: [], checks: {}, comments: '' } });
  const bulk = (L: Log, action: string, keys: (number | string)[]) => L.add('TEST A', 1, 'bulk', { action, keys: keys.map(String) });

  it('Accept All Proposed: confirms only undecided starts at the proposed time; edits and explicit judgements are kept', () => {
    const L = fresh({ 2: { ms: P(2) + 300, status: 'uncertain' }, 3: { ms: P(3), status: 'rejected' }, 4: { ms: P(4), status: 'uncertain', markedUncertain: true } });
    bulk(L, 'accept-proposed', [1, 5, 6, 7, 8, 'end']);
    const w = L.state.reviewers[1].work;
    for (const a of [1, 5, 6, 7, 8]) expect(w.markers[a]).toMatchObject({ ms: P(a), status: 'confirmed', origin: 'proposal' });
    expect(w.end).toMatchObject({ ms: truth.endMs, status: 'confirmed' });
    expect(w.markers[2]).toEqual({ ms: P(2) + 300, status: 'uncertain' });
    for (const [k, why] of [[2, /your own edited boundary is kept/], [3, /rejected by you/], [4, /marked uncertain by you/], [1, /already confirmed/]] as const) {
      const before = JSON.stringify(L.state);
      expect(() => bulk(L, 'accept-proposed', [k])).toThrow(why);
      expect(JSON.stringify(L.state)).toBe(before); // refused: nothing applied, no event
    }
    expect(L.events.filter((e) => e.type === 'bulk')).toHaveLength(1); // a repeat never applies twice
  });

  it('Reject All Proposed keeps the proposed time (nothing invented); Accept All Edited uses the edited time', () => {
    const L = fresh({ 2: { ms: P(2) + 300, status: 'uncertain' } });
    bulk(L, 'reject-proposed', [1, 3]);
    expect(L.state.reviewers[1].work.markers[1]).toMatchObject({ ms: P(1), status: 'rejected', origin: 'proposal' });
    expect(() => bulk(L, 'reject-proposed', [2])).toThrow(/your own edited boundary is kept/);
    bulk(L, 'accept-edited', [2]);
    expect(L.state.reviewers[1].work.markers[2]).toEqual({ ms: P(2) + 300, status: 'confirmed' });
    expect(() => bulk(L, 'accept-edited', [1])).toThrow(/not edited|rejected by you/);
    expect(() => bulk(L, 'accept-edited', [5])).toThrow(/no boundary of yours/);
    L.add('TEST A', 1, 'submit-ayahs', { keys: ['1', '2', '3'] }); // rejected and confirmed starts are submittable, with no playback record
    expect(Object.keys(L.state.reviewers[1].submitted)).toEqual(['1', '2', '3']);
    expect(() => bulk(L, 'accept-proposed', [1])).toThrow(/already submitted/); // submitted starts are locked
  });

  it('validates the whole request: atomic, in canonical order, by the reviewer themself, before the final submission only', () => {
    const L = fresh({ 6: { ms: P(5) - 100, status: 'uncertain' } }); // ayah 6 placed before ayah 5's proposal
    const before = JSON.stringify(L.state);
    expect(() => bulk(L, 'accept-proposed', [4, 5])).toThrow(/nothing was applied/); // 5 would come after 6: invalid order
    expect(() => bulk(L, 'accept-proposed', [1, 6])).toThrow(/ayah 6: your own edited boundary is kept/); // one ineligible start refuses all
    expect(JSON.stringify(L.state)).toBe(before);
    expect(() => bulk(L, 'accept-proposed', [1, 1])).toThrow(/listed twice/);
    expect(() => bulk(L, 'accept-proposed', [9])).toThrow(/not a start/);
    expect(() => bulk(L, 'approve-everything', [1])).toThrow(/unknown bulk action/);
    expect(() => L.add('TEST B', 1, 'bulk', { action: 'accept-proposed', keys: ['1'] })).toThrow(/not Reviewer 1/);
    expect(() => new Log(S).add('TEST A', 1, 'join').add('TEST A', 1, 'bulk', { action: 'accept-proposed', keys: ['1'] })).toThrow(/no proposed time/);
  });

  it('a whole review can be finished without any playback record; blindness, objective checks and the audit chain hold', () => {
    const L = fresh();
    bulk(L, 'accept-proposed', [1, 2, 3, 4, 5, 6, 7, 8, 'end']);
    L.add('TEST A', 1, 'submit-ayahs', { keys: ['1', '2', '3'] });
    L.add('TEST A', 1, 'draft', { work: { ...L.state.reviewers[1].work, checks: Object.fromEntries(Object.keys(lib.CHECKS).map((k) => [k, 'yes'])) } });
    L.add('TEST A', 1, 'submit');
    expect(L.state.reviewers[1].submittedAt).toBeTruthy();
    expect(JSON.stringify(L.events)).not.toMatch(/played|heard|listenedMs|playbackRanges/i);
    L.add('TEST B', 2, 'join');
    const v = lib.viewFor(SP, L.state, 'TEST B');
    expect(v.revealed).toEqual([]);
    expect(JSON.stringify(v)).not.toContain(`"ms":${P(4)}`); // Reviewer 1's times stay hidden
    const c = lib.objectiveChecks(SP, L.state, L.events, 'TEST A', null);
    expect(res(c, 'audit').result).toBe('yes');
    expect(res(c, 'submission').result).toBe('yes');
    expect(res(c, 'timings-complete').result).toBe('yes');
    expect(lib.verifyChain(L.events)).toBe(-1);
    const st = lib.recordingStatus(SP, L.state); // one reviewer's acceptance alone verifies nothing
    expect(st.status).toMatch(/^(awaiting-review|partially-reviewed)$/);
  });
});

describe('the servers report the objective checks with every view (synthetic recording)', () => {
  const PY = process.env.QH_PYTHON ?? 'python';
  it('local dashboard: identity hashed from the served file; the view and each event response carry the checks', async () => {
    const man = join(work, 'manual'); const ws = join(work, 'ws');
    for (const d of ['sessions', 'audio', 'data']) mkdirSync(join(man, d), { recursive: true });
    const crypto = await import('node:crypto');
    const sess = { ...session, sha256: crypto.createHash('sha256').update(wav).digest('hex') };
    writeFileSync(join(man, 'sessions', 'syn-98.json'), JSON.stringify(sess));
    writeFileSync(join(man, 'audio', 'syn-98.wav'), wav);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'dashboard.config.json'), JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, dataDir: 'data', registryDir: 'registry', cacheDir: 'cache', backupDir: 'backups', python: PY, sources: [{ id: 's', kind: 'manual-sessions', sessions: '../manual/sessions', audio: '../manual/audio', data: '../manual/data' }] }));
    const d = createDashboard({ config: join(ws, 'dashboard.config.json'), autoBackup: false });
    await new Promise<void>((r) => d.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(d.server.address() as AddressInfo).port}`;
    const v = await (await fetch(`${base}/api/view/syn-98?name=TEST%20A`)).json();
    expect(res(v.objective, 'identity').result).toBe('yes');
    expect(res(v.objective, 'identity').detail).toMatch(/hashed by this server/);
    const post = async (body: J) => (await fetch(`${base}/api/event/syn-98`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    await post({ reviewer: 'TEST A', role: 1, type: 'join' });
    const e = await post({ reviewer: 'TEST A', role: 1, type: 'draft', payload: { work: draft([1, 2]) } });
    expect(res(e.objective, 'timings-valid').result).toBe('yes');
    expect(res(e.objective, 'audit').result).toBe('yes');
    await new Promise<void>((r) => d.server.close(() => r()));
  });
});
