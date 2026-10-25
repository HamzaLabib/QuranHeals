import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PER_AYAH_RELEASE } from '@/audio/generated/perAyahRelease';

// The production gate of per-ayah recordings (tools/quran-audio/per-ayah/release-gate.mjs, owner 2026-10-24: Ali
// Abdullah Jaber). SYNTHETIC inputs in temporary folders. The real gate passes on the owner's decisions of 2026-10-25
// (development/owner-release-decisions.json: no rights documents and no device tests — decisions, not evidence).
const tools = path.resolve(__dirname, '../../tools/quran-audio');
const { releaseGate } = await import(pathToFileURL(path.join(tools, 'per-ayah/release-gate.mjs')).href);
const { eventHash } = await import(pathToFileURL(path.join(tools, 'review/manual/manual-lib.mjs')).href);
type J = any;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-release-gate-'));
  const cache = path.join(dir, 'cache');
  fs.mkdirSync(path.join(cache, 'Ali_Jaber_64kbps'), { recursive: true });
  const items: J[] = [];
  const files: J = {};
  for (let i = 0; i < 6236 + 112; i++) { const file = `f${i}.mp3`; items.push({ ref: `x:${i}`, file, playable: true }); files[file] = { ok: true, md5Match: true }; }
  fs.writeFileSync(path.join(cache, 'Ali_Jaber_64kbps', 'fetch-manifest.json'), JSON.stringify({ files }));
  const rights = path.join(dir, 'rights');
  fs.mkdirSync(rights);
  fs.writeFileSync(path.join(dir, 'dashboard.config.json'), JSON.stringify({ kind: 'audio-review-dashboard-config', version: 1, rightsDecisions: 'rights' }));
  const devices = path.join(dir, 'devices');
  fs.mkdirSync(devices);
  const rows = Array.from({ length: 114 }, (_, i) => ({ reciterId: 'jaber', key: `jaber-${i + 1}-everyayah`, reviewers: [{ role: 1, submitted: false }] })); // Reviewer 1 only (Reviewer 2 not required)
  const dash = { reciters: [{ reciterId: 'jaber', toReview: 0, veryHighOpen: 0, exceptionsOpen: 0, disputed: 0, reviewed: 6236, autoAccepted: 0, ownerOverride: 0 }], rows };
  const ok = {
    config: path.join(dir, 'dashboard.config.json'), cache, deviceDir: devices, risk: { items },
    fetchJson: async () => dash,
    providers: [{ id: 'everyayah', streaming: { permitted: true, evidence: 'written permission, ref. TEST' } }],
    credits: "key: 'everyayah'",
    // Synthetic: never the repository's own owner decisions (development/owner-release-decisions.json).
    ownerDecisions: null,
  };
  const grantRights = () => fs.writeFileSync(path.join(rights, 'jaber.json'), JSON.stringify({ kind: 'owner-per-ayah-rights-decision', recording: 'jaber', provider: 'everyayah', folder: 'Ali_Jaber_64kbps', cleared: true, basis: 'TEST', decidedBy: 'TEST', decidedOn: '2026-10-24' }));
  const recordDevices = () => fs.writeFileSync(path.join(devices, 'jaber.json'), JSON.stringify({ kind: 'per-ayah-device-tests', android: { passed: true, background: true, device: 'TEST', testedOn: '2026-10-24' }, ios: { passed: true, background: true, device: 'TEST', testedOn: '2026-10-24' } }));
  const override = () => {
    fs.mkdirSync(path.join(dir, 'data', '_owner-override'), { recursive: true });
    const e: J = { seq: 1, at: '2026-10-24T00:00:00.000Z', type: 'owner-override', key: 'jaber-88-everyayah', reciterId: 'jaber', surah: 88, ayah: 14, verified: false, prev: 'genesis' };
    e.hash = eventHash('genesis', e);
    fs.writeFileSync(path.join(dir, 'data', '_owner-override', 'ledger.jsonl'), `${JSON.stringify(e)}\n`);
  };
  return { dash, ok, grantRights, recordDevices, override };
}
const blocked = (r: J) => r.gates.filter((g: J) => !g.pass).map((g: J) => g.gate);

describe('the per-ayah release gate', () => {
  it('passes only when every gate passes: integrity, review (Reviewer 1 and the automatic policy; no Reviewer 2), no owner override, rights, provider, attribution, devices', async () => {
    const t = setup();
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok }))).toEqual(['rights', 'devices']);
    t.grantRights();
    t.recordDevices();
    const r = await releaseGate({ recordingId: 'jaber', ...t.ok });
    expect(r.pass).toBe(true);
    expect(r.gates.map((g: J) => g.gate)).toEqual(['on-hold', 'integrity', 'review', 'overrides', 'rights', 'provider', 'attribution', 'devices']);
  });

  it('the owner decision to proceed without verified rights documentation passes rights and provider for its recording only, labelled as a decision', async () => {
    const t = setup();
    const decision = { kind: 'owner-release-decisions', decisions: [{ id: 'owner-test', decidedOn: '2026-10-25', layers: ['per-ayah:jaber'] }] };
    const noProvider = { ...t.ok, providers: [] };
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...noProvider }))).toEqual(['rights', 'provider', 'devices']);
    const r = await releaseGate({ recordingId: 'jaber', ...noProvider, ownerDecisions: decision });
    expect(blocked(r)).toEqual(['devices']); // still needs physical-device evidence
    for (const gate of ['rights', 'provider']) expect(r.gates.find((g: J) => g.gate === gate).why).toMatch(/proceed without verified rights documentation \(not a permission\)/);
    const other = { kind: 'owner-release-decisions', decisions: [{ id: 'owner-test', decidedOn: '2026-10-25', layers: ['per-ayah:gebril'] }] };
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...noProvider, ownerDecisions: other }))).toEqual(['rights', 'provider', 'devices']);
    t.override();
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...noProvider, ownerDecisions: decision }))).toEqual(['overrides', 'devices']); // never clears an override
  });

  it('fails closed: an open start or exception, an unreachable dashboard, a damaged file; never asks for Reviewer 2', async () => {
    const t = setup();
    t.grantRights();
    t.recordDevices();
    t.dash.reciters[0].exceptionsOpen = 1;
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok }))).toEqual(['review']);
    t.dash.reciters[0].exceptionsOpen = 0;
    t.dash.reciters[0].toReview = 3;
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok }))).toEqual(['review']);
    t.dash.reciters[0].toReview = 0;
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok, fetchJson: async () => { throw new Error('down'); } }))).toEqual(['review']);
    // Owner policy 2026-10-24: no Reviewer 2 anywhere, and no gate asks for one.
    expect((await releaseGate({ recordingId: 'jaber', ...t.ok })).gates.map((g: J) => g.gate)).not.toContain('reviewers');
    // An owner override (owner, 2026-10-24: 88:14, unverified) is never cleared: its surah is left out of the release,
    // named, without blocking the recording's other surahs. A ledger the dashboard disagrees with blocks everything.
    t.override();
    const ov = await releaseGate({ recordingId: 'jaber', ...t.ok });
    expect(blocked(ov)).toEqual(['overrides']);
    expect(ov.gates.find((g: J) => g.gate === 'overrides').why).toMatch(/the dashboard reports 0 owner override\(s\), the ledger 1/);
    t.dash.reciters[0].ownerOverride = 1;
    const ex = await releaseGate({ recordingId: 'jaber', ...t.ok });
    expect(ex.pass).toBe(true);
    expect(ex.excludedSurahs).toEqual([88]);
    expect(ex.gates.find((g: J) => g.gate === 'overrides').why).toMatch(/surah\(s\) 88 EXCLUDED: 88:14 accepted by owner override, unverified \(unresolved\)/);
    fs.writeFileSync(path.join(path.dirname(t.ok.config), 'data', '_owner-override', 'ledger.jsonl'), '{not json\n');
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok }))).toEqual(['overrides']); // unreadable ledger
    const risk = { items: t.ok.risk.items.map((x: J, i: number) => (i === 7 ? { ...x, playable: false } : x)) };
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok, risk }))).toContain('integrity');
  });

  it('the owner risk acceptance passes the device gate for its recording only, labelled as shipped without evidence', async () => {
    const t = setup();
    t.grantRights();
    const waiver = { kind: 'owner-release-decisions', decisions: [{ id: 'owner-waiver', decidedOn: '2026-10-25', waives: ['device-evidence'], layers: ['per-ayah:jaber'] }] };
    const r = await releaseGate({ recordingId: 'jaber', ...t.ok, ownerDecisions: waiver });
    expect(r.pass).toBe(true);
    expect(r.gates.find((g: J) => g.gate === 'devices').why).toMatch(/shipped without device evidence/);
    // A waiver is not a rights decision, and covers no other recording.
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...setup().ok, ownerDecisions: waiver }))).toEqual(['rights']);
    const other = { kind: 'owner-release-decisions', decisions: [{ ...waiver.decisions[0], layers: ['per-ayah:gebril'] }] };
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok, ownerDecisions: other }))).toEqual(['devices']);
  });

  it('an owner release override keeps exactly its start\'s surah, labelled unverified; another overridden start still excludes its surah', async () => {
    const t = setup();
    t.grantRights();
    t.recordDevices();
    t.override(); // 88:14
    t.dash.reciters[0].ownerOverride = 1;
    const release = (releaseOverrides: unknown[]) => ({ kind: 'owner-release-decisions', decisions: [{ id: 'owner-include', decidedOn: '2026-10-25', layers: ['per-ayah:jaber'], releaseOverrides }] });
    const r = await releaseGate({ recordingId: 'jaber', ...t.ok, ownerDecisions: release([{ recording: 'jaber', surah: 88, ayah: 14 }]) });
    expect(r.pass).toBe(true);
    expect(r.excludedSurahs).toEqual([]);
    expect(r.includedOverrides).toEqual([{ surah: 88, ayah: 14, decision: 'owner-include' }]);
    expect(r.gates.find((g: J) => g.gate === 'overrides').why).toMatch(/88 INCLUDED on the owner's release override: 88:14 \(owner-include\), accepted by owner override, unverified — not verification or a listening test/);
    // Another start, another recording or no ayah: the surah stays out.
    for (const o of [{ recording: 'jaber', surah: 88, ayah: 13 }, { recording: 'gebril', surah: 88, ayah: 14 }, { recording: 'jaber', surah: 88 }]) {
      expect((await releaseGate({ recordingId: 'jaber', ...t.ok, ownerDecisions: release([o]) })).excludedSurahs, JSON.stringify(o)).toEqual([88]);
    }
    // A release override is not a rights decision: alone, it leaves the rights gate as it was.
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...setup().ok, ownerDecisions: release([{ recording: 'jaber', surah: 88, ayah: 14 }]) }))).toEqual(['rights', 'devices']);
    // Integrity still applies whatever the override.
    const risk = { items: t.ok.risk.items.map((x: J, i: number) => (i === 7 ? { ...x, playable: false } : x)) };
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok, risk, ownerDecisions: release([{ recording: 'jaber', surah: 88, ayah: 14 }]) }))).toContain('integrity');
  });

  it('never releases a reciter on hold (Mohamed Gebril), whatever else passes', async () => {
    const t = setup();
    const r = await releaseGate({ recordingId: 'gebril', ...t.ok });
    expect(r.pass).toBe(false);
    expect(r.gates.find((g: J) => g.gate === 'on-hold')).toMatchObject({ pass: false, why: expect.stringMatching(/on hold/) });
  });

  it('the release catalogue: Ali Jaber only (Gebril on hold), all 114 surahs — 88 on the owner\'s release override of 88:14 (unverified) — on the owner decisions, not a permission', async () => {
    expect(PER_AYAH_RELEASE.map((r) => r.reciterId)).toEqual(['jaber']);
    const surahs = Object.keys(PER_AYAH_RELEASE[0].surahs).map(Number);
    expect(surahs).toEqual(Array.from({ length: 114 }, (_, i) => i + 1));
    // Every surah complete: a file for each canonical ayah.
    const counts = JSON.parse(fs.readFileSync(path.join(tools, 'audit-data', 'ayah-counts.json'), 'utf8')) as number[];
    for (const s of surahs) expect(PER_AYAH_RELEASE[0].surahs[s].ayahs, String(s)).toHaveLength(counts[s - 1]);
    const file = fs.readFileSync(path.resolve(__dirname, '../src/audio/generated/perAyahRelease.ts'), 'utf8');
    expect(file).toMatch(/jaber 88: included on the owner's release override owner-2026-10-25-include-jaber-88-override; its start 88:14 is accepted\n \* by owner override only, UNVERIFIED/);
    const decisions = JSON.parse(fs.readFileSync(path.join(tools, 'development', 'owner-release-decisions.json'), 'utf8')) as { decisions: { id: string; releaseOverrides?: unknown; meaning: string; statement: string }[] };
    const d = decisions.decisions.find((x) => x.id === 'owner-2026-10-25-include-jaber-88-override')!;
    expect(d.releaseOverrides).toEqual([{ recording: 'jaber', surah: 88, ayah: 14 }]);
    expect(d.statement).toMatch(/^Include Ali Jaber surah 88 in the next production build using the existing owner-approved 88:14 boundary\./);
    expect(d.meaning).toMatch(/not independent verification, not a listening test/);
    const providers = fs.readFileSync(path.join(tools, 'providers.mjs'), 'utf8');
    expect(providers).not.toMatch(/id: 'everyayah'/); // still no permission recorded: the provider gate passes on the owner decision only
  });
});
