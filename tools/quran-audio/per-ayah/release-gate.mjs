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
//   (overrides: an owner override no longer blocks the whole recording: its SURAH is excluded from the release
//    (excludedSurahs in the result) and named; the ledger must be readable and agree with the dashboard. An owner
//    RELEASE override (owner-release-decisions.json releaseOverrides: recording, surah, ayah — owner 2026-10-25, Jaber
//    88:14) keeps exactly that start's surah in the release (includedOverrides), reported as the owner's override:
//    the start stays unverified, and integrity and complete-ayah checks still apply to the surah.
//    devices also pass on the owner's risk acceptance of 2026-10-25 (waives: ["device-evidence"]), reported as shipping
//    WITHOUT device evidence, never as a test result.)
//   (rights and provider also pass on the owner's decision of 2026-10-25 to proceed WITHOUT verified rights
//    documentation for per-ayah:<id> (development/owner-release-decisions.json): reported as that decision, never as
//    a permission. Every other gate is unchanged.)
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
/** The owner's decision to proceed without verified rights documentation for this per-ayah recording, or undefined. */
const validDecisions = (decisions, recordingId) => (decisions?.kind === 'owner-release-decisions' && Array.isArray(decisions.decisions) ? decisions.decisions : [])
  .filter((d) => Array.isArray(d?.layers) && d.layers.includes(`per-ayah:${recordingId}`) && String(d.id ?? '').trim() && /^\d{4}-\d\d-\d\d$/.test(d.decidedOn ?? ''));

/** The owner's decision to proceed without rights documentation (or, with `waives`, the waiver of that evidence). */
export function ownerDecisionFor(decisions, recordingId, waives = null) {
  return validDecisions(decisions, recordingId).find((d) => !Array.isArray(d.releaseOverrides)
    && (waives ? Array.isArray(d.waives) && d.waives.includes(waives) : !Array.isArray(d.waives)));
}

/** The owner's release override of one overridden start (exact recording, surah and ayah), or undefined. */
export function ownerReleaseOverrideFor(decisions, recordingId, surah, ayah) {
  return validDecisions(decisions, recordingId).find((d) => Array.isArray(d.releaseOverrides)
    && d.releaseOverrides.some((o) => o?.recording === recordingId && o.surah === surah && o.ayah === ayah));
}
const decisionsFile = path.join(here, '..', 'development', 'owner-release-decisions.json');

export async function releaseGate({ recordingId, config, risk = null, dashboardUrl = 'http://127.0.0.1:8765', fetchJson = defaultFetch, cache = path.join(process.env.LOCALAPPDATA ?? '.', 'QuranHeals', 'per-ayah-cache'),
  providers = PROVIDERS, credits = null, deviceDir = path.join(here, 'device-tests'), ownerDecisions = fs.existsSync(decisionsFile) ? JSON.parse(fs.readFileSync(decisionsFile, 'utf8')) : null }) {
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
  // Each overridden start excludes its whole surah (a per-ayah surah plays only complete); the other surahs go on. A
  // start the owner released by name (releaseOverrides) keeps its surah in, unless another start of it is overridden.
  const released = mine.filter((e) => ownerReleaseOverrideFor(ownerDecisions, recordingId, e.surah, e.ayah));
  const held = mine.filter((e) => !released.includes(e));
  const excludedSurahs = [...new Set(held.map((e) => e.surah))].sort((a, b) => a - b);
  const includedOverrides = released.filter((e) => !excludedSurahs.includes(e.surah)).map((e) => ({ surah: e.surah, ayah: e.ayah, decision: ownerReleaseOverrideFor(ownerDecisions, recordingId, e.surah, e.ayah).id }));
  const agrees = !dash || shown === mine.length;
  const ref = (e) => `${e.surah}:${e.ayah}`;
  const said = [
    excludedSurahs.length ? `surah(s) ${excludedSurahs.join(', ')} EXCLUDED: ${held.map(ref).join(', ')} accepted by owner override, unverified (unresolved)` : '',
    includedOverrides.length ? `surah(s) ${includedOverrides.map((x) => x.surah).join(', ')} INCLUDED on the owner's release override: ${includedOverrides.map((x) => `${x.surah}:${x.ayah} (${x.decision})`).join(', ')}, accepted by owner override, unverified — not verification or a listening test` : '',
  ].filter(Boolean).join('; ');
  g('overrides', !ov.problem && agrees, ov.problem ? `owner-override ledger unreadable: ${ov.problem}` : !agrees ? `the dashboard reports ${shown} owner override(s), the ledger ${mine.length}` : said || 'no owner override');

  // rights
  const decisions = fs.existsSync(cfg.rightsDir) ? fs.readdirSync(cfg.rightsDir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(cfg.rightsDir, f), 'utf8')); } catch { return null; } }).filter(Boolean) : [];
  const d = decisions.find((x) => x.kind === 'owner-per-ayah-rights-decision' && x.recording === recordingId && x.provider === rec.provider && x.folder === rec.folder && x.cleared === true && String(x.basis ?? '').trim() && String(x.decidedBy ?? '').trim() && /^\d{4}-\d\d-\d\d$/.test(x.decidedOn ?? ''));
  const owner = ownerDecisionFor(ownerDecisions, recordingId);
  const proceed = owner ? `owner decision ${owner.id} (${owner.decidedOn}): proceed without verified rights documentation (not a permission)` : null;
  g('rights', d || owner, d ? `cleared by ${d.decidedBy} on ${d.decidedOn}: ${d.basis}` : proceed ?? `no owner rights decision for ${rec.provider}/${rec.folder} (${rec.rights.evidence})`);
  const p = providers.find((x) => x.id === rec.provider);
  const providerOk = p?.streaming?.permitted === true && String(p.streaming.evidence ?? '').trim();
  g('provider', providerOk || owner, providerOk ? `streaming permitted: ${p.streaming.evidence}` : proceed ?? (p ? `streaming not permitted: ${p.streaming.evidence}` : `${rec.provider} is not in tools/quran-audio/providers.mjs`));
  const creditsText = credits ?? fs.readFileSync(path.join(REPO, 'mobile', 'src', 'constants', 'quranSources.ts'), 'utf8');
  const listed = new RegExp(`key: '${rec.provider}'`).test(creditsText);
  g('attribution', listed, `Quran Sources & Credits ${listed ? 'list' : 'do not list'} ${rec.provider}`);
  const devFile = path.join(deviceDir, `${recordingId}.json`);
  let dev = null;
  try { dev = JSON.parse(fs.readFileSync(devFile, 'utf8')); } catch { /* none */ }
  const okDev = (x) => x?.passed === true && x?.background === true && String(x?.device ?? '').trim() && /^\d{4}-\d\d-\d\d$/.test(x?.testedOn ?? '');
  const tested = dev?.kind === 'per-ayah-device-tests' && okDev(dev.android) && okDev(dev.ios);
  const evidence = dev ? `android ${okDev(dev.android) ? 'passed' : 'not passed'}, ios ${okDev(dev.ios) ? 'passed' : 'not passed'}` : `no record of physical-device tests (${path.relative(REPO, devFile).replaceAll('\\', '/')})`;
  const waiver = tested ? null : ownerDecisionFor(ownerDecisions, recordingId, 'device-evidence');
  g('devices', tested || waiver, waiver ? `shipped without device evidence: owner risk acceptance ${waiver.id} (${waiver.decidedOn}), not testing | ${evidence}` : evidence);
  return { id: recordingId, gates, pass: gates.every((x) => x.pass), excludedSurahs, includedOverrides };
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
