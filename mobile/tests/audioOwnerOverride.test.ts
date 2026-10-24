import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

// The owner override (tools/quran-audio/review/dashboard/owner-override.mjs; owner, 2026-10-24: Ali Abdullah Jaber
// 88:14): an owner-authorized, UNVERIFIED acceptance, kept apart from reviews and automatic acceptances.
// SYNTHETIC sessions only: nothing here reads or writes the real review data.
const tools = path.resolve(__dirname, '../../tools/quran-audio');
const imp = (p: string) => import(pathToFileURL(path.join(tools, p)).href);
const ov = await imp('review/dashboard/owner-override.mjs');
const auto = await imp('review/dashboard/auto-accept.mjs');
const manual = await imp('review/manual/manual-lib.mjs');
const { makeViews } = await imp('review/dashboard/views.mjs');
type J = any;

const EXCEPTION = { risk: 'high', tier: 'exception', reasons: ['IDENTITY_UNRESOLVED: x'], severity: { codes: [{ code: 'IDENTITY_UNRESOLVED', tier: 'exception', label: 'Unresolved: reciter identity not established', why: 'only partly found' }] } };
/** A per-ayah session of 4 ayahs; ayah 3 is an unresolved exception. */
const session = (patch: J = {}): J => ({
  sha256: 'a'.repeat(64), durationMs: 20000, provenance: { packageSha256: 'p'.repeat(64) },
  proposal: {
    fingerprint: 'f0f0f0f0', starts: { 1: 0, 2: 5000, 3: 10000, 4: 15000 }, endMs: 19900, structure: { ok: true, problems: [] }, completeness: { missing_in_alignment: [], collapsed_runs: [] }, boundaries: [2, 3, 4].map((ayah) => ({ ayah, ms: ayah * 5000 - 5000, flags: [] })),
    perAyah: { files: [0, 1, 2, 3, 4].map((a) => ({ name: `088${String(a).padStart(3, '0')}.mp3`, bytes: 1000 + a, sha256: String(a).repeat(64) })), risk: { 3: EXCEPTION } },
    ...patch,
  },
});
const task: J = {
  key: 'jaber-88-everyayah', reciterId: 'jaber', reciterEn: 'Ali Abdullah Jaber', reciterAr: 'علي عبد الله جابر', surah: 88, surahEn: 'Al-Ghaashiya', surahAr: 'الغاشية',
  reviewType: 'per-ayah-verification', ayahCount: 4, url: 'https://everyayah.com/data/Ali_Jaber_64kbps/#088', provider: 'everyayah', phase: 'per-ayah',
  risk: [['check', ''], ['high', ''], ['high', 'IDENTITY_UNRESOLVED: x'], ['high', '']], counts: { starts: 4, high: 3 }, priority: { label: 'high', rank: 1, reasons: [] }, rights: { cleared: false, reason: 'pending' },
};
const entryFor = (s: J) => ({ seq: 1, ...ov.overrideEntry({ task, session: s, ayah: 3, authorizedBy: 'owner (TEST)', authorizedOn: '2026-10-24', instruction: 'TEST' }) });

describe('the owner override (an owner-authorized, unverified acceptance)', () => {
  it('records what it is NOT: not listened, identity and text not confirmed, not verified, blocked from release', () => {
    const e = entryFor(session());
    expect(e).toMatchObject({ type: 'owner-override', key: task.key, ayah: 3, verified: false, listened: false, identityConfirmed: false, textConfirmed: false, releaseBlocked: true, fingerprint: 'f0f0f0f0', audioSha256: 'a'.repeat(64), file: { name: '088003.mp3', bytes: 1003, sha256: '3'.repeat(64) } });
    expect(e.openConcerns).toEqual([{ code: 'IDENTITY_UNRESOLVED', tier: 'exception', label: 'Unresolved: reciter identity not established', why: 'only partly found' }]);
    expect(e.note).toMatch(/UNVERIFIED/);
    expect(e.type).not.toBe('auto-accept'); // never an automatic acceptance: the policy and its counts are unchanged
    // A surah without a Basmala file (At-Tawbah): the file is found by its name, not its place in the list.
    const noBasmala = session();
    noBasmala.proposal.perAyah.files = [1, 2, 3, 4].map((a) => ({ name: `009${String(a).padStart(3, '0')}.mp3`, bytes: 2000 + a, sha256: String(a + 4).repeat(64) }));
    expect(entryFor(noBasmala).file).toEqual({ name: '009003.mp3', bytes: 2003, sha256: '7'.repeat(64) });
  });

  it('applies to the exact package, audio and per-ayah file only; a reviewer\'s judgement and very high risk always win', () => {
    const s = session();
    const st = manual.emptyState();
    expect([...ov.effectiveOverrides(s, st, [entryFor(s)]).keys()]).toEqual(['3']);
    expect(ov.effectiveOverrides(session({ fingerprint: 'changed0' }), st, [entryFor(s)]).size).toBe(0);
    expect(ov.effectiveOverrides({ ...s, sha256: 'b'.repeat(64) }, st, [entryFor(s)]).size).toBe(0);
    const otherFile = session();
    otherFile.proposal.perAyah.files[3].sha256 = 'c'.repeat(64);
    expect(ov.effectiveOverrides(otherFile, st, [entryFor(s)]).size).toBe(0);
    const rejected = { ...st, reviewers: { 1: { role: 1, name: 'R', submitted: { 3: { status: 'rejected' } }, revisions: [], work: { markers: {} } } } };
    expect(ov.effectiveOverrides(s, rejected, [entryFor(s)]).size).toBe(0);
    const vh = session();
    vh.proposal.perAyah.risk[3] = { risk: 'high', tier: 'veryhigh', reasons: ['cut-end: y'] };
    expect(ov.overrideBlock(vh, st, 3)).toMatch(/very high risk/);
    expect(ov.effectiveOverrides(vh, st, [entryFor(vh)]).size).toBe(0);
  });

  it('the automatic policy still does not accept the start: an override is the only decision recorded for it', () => {
    const s = session();
    const c = auto.classify(task, s, manual.emptyState(), []);
    expect(c.find((x: J) => x.ayah === 3)).toMatchObject({ decision: 'blocked', why: expect.stringMatching(/unresolved exception/) });
  });

  it('the dashboard: out of the queue, counted apart (not reviewed, not automatic), status says so, no completion date', () => {
    const s = session();
    const make = (overridden: boolean) => makeViews({
      tasks: () => new Map([[task.key, task]]), inventory: () => ({ blocked: [], superseded: [], problems: [], sources: [], totals: {}, createdAt: 'x' }),
      load: () => ({ session: s, state: manual.emptyState(), events: [] }), hasLog: () => false, audioInfo: () => ({ local: true }),
      autoAccepted: () => new Set(['1', '2', '4']), ownerOverridden: () => new Set(overridden ? ov.effectiveOverrides(s, manual.emptyState(), [entryFor(s)]).keys() : []),
      milestone: () => null,
    });
    const before = make(false).dashboard('').reciters[0];
    expect(before).toMatchObject({ toReview: 1, autoAccepted: 3, ownerOverride: 0, reviewed: 0, completed: false, status: 'unresolved exceptions' });
    const v = make(true);
    const after = v.dashboard('');
    expect(after.reciters[0]).toMatchObject({ toReview: 0, autoAccepted: 3, ownerOverride: 1, reviewed: 0, exceptionsOpen: 0, completed: true, status: 'completed with owner override (unverified)', completedAt: null });
    expect(after.metrics.startsOwnerOverride).toBe(1);
    expect(after.rows[0].reviewState).toMatch(/1 by owner override \(unverified\)/);
    expect(v.attention(new URLSearchParams()).rows).toEqual([]); // nothing left in the queue
    const all = v.attention(new URLSearchParams('show=all&tiers=check,high')).rows.find((r: J) => r.ayah === 3);
    expect(all).toMatchObject({ ownerOverride: true, auto: false, exception: false, reason: expect.stringMatching(/^owner override \(UNVERIFIED/) });
  });

  it('the ledger: chained, written once per start (a rerun writes nothing)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-owner-override-'));
    const l = ov.openOverrides(ov.overrideFile(dir));
    const { seq: _seq, ...e } = entryFor(session());
    expect(l.append([e])).toHaveLength(1);
    expect(l.append([e])).toHaveLength(0);
    expect(auto.verifyLedger(l.entries())).toBe(-1);
    expect(l.entries()).toHaveLength(1);
    expect(l.problem).toBeNull();
    // What the dashboard reads (server.mjs): the recording's overrides, through the ledger, applied to its session.
    expect(l.forKey(task.key)).toHaveLength(1);
    expect(l.forKey('another-key')).toHaveLength(0);
    expect([...ov.effectiveOverrides(session(), manual.emptyState(), l.forKey(task.key)).keys()]).toEqual(['3']);
  });
});
