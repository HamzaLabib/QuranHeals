import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PER_AYAH_RELEASE } from '@/audio/generated/perAyahRelease';

// The production gate of per-ayah recordings (tools/quran-audio/per-ayah/release-gate.mjs, owner 2026-10-24: Ali
// Abdullah Jaber). SYNTHETIC inputs in temporary folders; the real gate is closed (no rights, reviewers or device tests).
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
    // An owner override (owner, 2026-10-24: 88:14, unverified) never clears a recording for release.
    t.override();
    const ov = await releaseGate({ recordingId: 'jaber', ...t.ok });
    expect(blocked(ov)).toEqual(['overrides']);
    expect(ov.gates.find((g: J) => g.gate === 'overrides').why).toMatch(/88:14.*not cleared for release/);
    t.dash.reciters[0].ownerOverride = 1;
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok }))).toEqual(['overrides']);
    const risk = { items: t.ok.risk.items.map((x: J, i: number) => (i === 7 ? { ...x, playable: false } : x)) };
    expect(blocked(await releaseGate({ recordingId: 'jaber', ...t.ok, risk }))).toContain('integrity');
  });

  it('never releases a reciter on hold (Mohamed Gebril), whatever else passes', async () => {
    const t = setup();
    const r = await releaseGate({ recordingId: 'gebril', ...t.ok });
    expect(r.pass).toBe(false);
    expect(r.gates.find((g: J) => g.gate === 'on-hold')).toMatchObject({ pass: false, why: expect.stringMatching(/on hold/) });
  });

  it('the real gate is closed today, and the release catalogue is empty (release builds play no per-ayah recording)', async () => {
    expect(PER_AYAH_RELEASE).toEqual([]);
    const providers = fs.readFileSync(path.join(tools, 'providers.mjs'), 'utf8');
    expect(providers).not.toMatch(/id: 'everyayah'/); // no permission recorded: the provider gate stays closed
  });
});
