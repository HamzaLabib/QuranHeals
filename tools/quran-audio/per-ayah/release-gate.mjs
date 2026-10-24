// The PRODUCTION gate of a per-ayah recording (owner, 2026-10-24: Ali Abdullah Jaber). It only reads, and fails closed:
// anything it cannot establish is a blocker. generate-preview.mjs --release refuses to write a release catalogue unless
// every gate passes; the owner's explicit approval is still needed before anything is built or published.
//
//   on-hold      the recording is not on hold (recordings.mjs onHold) and is a release candidate (releaseCandidate)
//   integrity    every ayah and Basmala file present, readable, of the listed size, matching the folder's checksums
//   review       the review dashboard shows every start accepted (Reviewer 1 or the automatic policy): nothing open,
//                no Very High Risk start, no exception, nothing disputed. Owner policy 2026-10-24: Reviewer 2 is NOT
//                required (the former 'reviewers' gate is removed); one reviewer's decisions and the automatic
//                acceptance policy are the review, and are reported apart, never as independent verification
//   overrides    no owner override (review/dashboard/owner-override.mjs): an owner-authorized, UNVERIFIED acceptance
//                takes a start out of the review queue but never clears it for release
//   rights       an owner rights decision for this recording (<rightsDecisions>/*.json, kind owner-per-ayah-rights-decision:
//                recording id, provider, folder, cleared: true, basis, decidedBy, decidedOn)
//   provider     ../providers.mjs lists the provider with streaming permitted, on recorded evidence
//   attribution  the app's Quran Sources & Credits list the provider (mobile/src/constants/quranSources.ts)
//   devices      an owner record of physical-device tests (per-ayah/device-tests/<id>.json, kind per-ayah-device-tests:
//                android and ios entries, each passed: true, with background playback across ayah files)
//
// usage: node tools/quran-audio/per-ayah/release-gate.mjs --recording jaber --config <dashboard.config.json>
//          [--risk <severity report>] [--dashboard http://127.0.0.1:8765] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDERS } from '../providers.mjs';
import { readConfig } from '../review/dashboard/dashboard-lib.mjs';
import { openOverrides, overrideFile } from '../review/dashboard/owner-override.mjs';
import { PER_AYAH_RECORDINGS } from './recordings.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..', '..');

/** Every gate for one recording: { id, gates: [{ gate, pass, why }], pass }. Never throws for a missing input: it fails. */
export async function releaseGate({ recordingId, config, risk = null, dashboardUrl = 'http://127.0.0.1:8765', fetchJson = defaultFetch, cache = path.join(process.env.LOCALAPPDATA ?? '.', 'QuranHeals', 'per-ayah-cache'),
  providers = PROVIDERS, credits = null, deviceDir = path.join(here, 'device-tests') }) {
  const gates = [];
  const g = (gate, pass, why) => gates.push({ gate, pass: !!pass, why });
  const rec = PER_AYAH_RECORDINGS.find((r) => r.id === recordingId);
  if (!rec) return { id: recordingId, gates: [{ gate: 'recording', pass: false, why: 'unknown per-ayah recording' }], pass: false };
  g('on-hold', !rec.onHold && rec.releaseCandidate === true, rec.onHold ? `on hold (${rec.onHold}): never released` : rec.releaseCandidate ? 'a release candidate, not on hold' : 'not marked as a release candidate');

  // integrity
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(cache, rec.folder, 'fetch-manifest.json'), 'utf8'));
    const report = risk ?? null;
    const items = report?.items ?? [];
    const bad = items.filter((x) => !x.playable || !manifest.files[x.file]?.ok || manifest.files[x.file]?.md5Match === false);
    g('integrity', report && items.length === 6236 + 112 && bad.length === 0, report ? `${items.length} files in the report; ${bad.length} missing, unreadable or not matching their checksum${bad.length ? `: ${bad.slice(0, 5).map((x) => x.ref).join(', ')}` : ''}` : 'no risk report given (--risk)');
  } catch (e) { g('integrity', false, `cannot read the fetch manifest: ${e.message}`); }

  // review state (read-only API of the review dashboard)
  let dash = null;
  try { dash = await fetchJson(`${dashboardUrl}/api/dashboard?name=`); } catch (e) {
    g('review', false, `review dashboard unreachable (${e.message}): review state unknown`);
  }
  if (dash) {
    const r = dash.reciters?.find((x) => x.reciterId === recordingId);
    g('review', r && r.toReview === 0 && r.veryHighOpen === 0 && r.exceptionsOpen === 0 && r.disputed === 0, r ? `${r.toReview} start(s) open: ${r.veryHighOpen} very high risk and ${r.exceptionsOpen} exceptions, ${r.disputed} disputed (${r.reviewed} accepted by Reviewer 1, ${r.autoAccepted} accepted automatically; Reviewer 2 not required)` : 'the reciter is not in the dashboard');
  }

  // owner overrides: the ledger itself (fails closed if it cannot be read) and the dashboard's count
  const cfg = readConfig(config);
  const ov = openOverrides(overrideFile(cfg.dataDir));
  const mine = ov.problem ? [] : ov.entries().filter((e) => e.type === 'owner-override' && e.reciterId === recordingId);
  const shown = dash?.reciters?.find((x) => x.reciterId === recordingId)?.ownerOverride;
  g('overrides', !ov.problem && mine.length === 0 && (!dash || shown === 0), ov.problem ? `owner-override ledger unreadable: ${ov.problem}` : mine.length ? `${mine.length} start(s) accepted by owner override, unverified (${mine.map((e) => `${e.surah}:${e.ayah}`).join(', ')}): not cleared for release` : dash && shown !== 0 ? `the dashboard does not report its owner overrides (${shown})` : 'no owner override');

  // rights
  const decisions = fs.existsSync(cfg.rightsDir) ? fs.readdirSync(cfg.rightsDir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(cfg.rightsDir, f), 'utf8')); } catch { return null; } }).filter(Boolean) : [];
  const d = decisions.find((x) => x.kind === 'owner-per-ayah-rights-decision' && x.recording === recordingId && x.provider === rec.provider && x.folder === rec.folder && x.cleared === true && String(x.basis ?? '').trim() && String(x.decidedBy ?? '').trim() && /^\d{4}-\d\d-\d\d$/.test(x.decidedOn ?? ''));
  g('rights', d, d ? `cleared by ${d.decidedBy} on ${d.decidedOn}: ${d.basis}` : `no owner rights decision for ${rec.provider}/${rec.folder} (${rec.rights.evidence})`);
  const p = providers.find((x) => x.id === rec.provider);
  g('provider', p?.streaming?.permitted === true && String(p.streaming.evidence ?? '').trim(), p ? `streaming ${p.streaming.permitted ? 'permitted' : 'not permitted'}: ${p.streaming.evidence}` : `${rec.provider} is not in tools/quran-audio/providers.mjs`);
  const creditsText = credits ?? fs.readFileSync(path.join(REPO, 'mobile', 'src', 'constants', 'quranSources.ts'), 'utf8');
  const listed = new RegExp(`key: '${rec.provider}'`).test(creditsText);
  g('attribution', listed, `Quran Sources & Credits ${listed ? 'list' : 'do not list'} ${rec.provider}`);
  const devFile = path.join(deviceDir, `${recordingId}.json`);
  let dev = null;
  try { dev = JSON.parse(fs.readFileSync(devFile, 'utf8')); } catch { /* none */ }
  const okDev = (x) => x?.passed === true && x?.background === true && String(x?.device ?? '').trim() && /^\d{4}-\d\d-\d\d$/.test(x?.testedOn ?? '');
  g('devices', dev?.kind === 'per-ayah-device-tests' && okDev(dev.android) && okDev(dev.ios), dev ? `android ${okDev(dev.android) ? 'passed' : 'not passed'}, ios ${okDev(dev.ios) ? 'passed' : 'not passed'}` : `no record of physical-device tests (${path.relative(REPO, devFile).replaceAll('\\', '/')})`);
  return { id: recordingId, gates, pass: gates.every((x) => x.pass) };
}

async function defaultFetch(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, all) => (x.startsWith('--') ? [...acc, [x.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
  const risk = a.risk ? JSON.parse(fs.readFileSync(a.risk, 'utf8')) : null;
  const r = await releaseGate({ recordingId: a.recording, config: a.config, risk, dashboardUrl: a.dashboard ?? 'http://127.0.0.1:8765' });
  if (a.json) console.log(JSON.stringify(r, null, 1));
  else { for (const x of r.gates) console.log(`${x.pass ? 'PASS   ' : 'BLOCKED'} ${x.gate.padEnd(12)} ${x.why}`); console.log(r.pass ? `\n${r.id}: every gate passes (the owner's approval is still required)` : `\n${r.id}: BLOCKED`); }
  process.exitCode = r.pass ? 0 : 1;
}
