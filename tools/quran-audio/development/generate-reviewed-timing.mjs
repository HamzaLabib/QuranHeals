// Writes mobile/src/audio/generated/reviewedTiming.ts: DEVELOPMENT-PREVIEW ayah timing for MP3Quran catalogue surahs
// whose aligned timing has cleared the review dashboard's queue (owner policy, 2026-10-24: Reviewer 2 is no longer
// required; one reviewer's listening decisions and the automatic acceptance policy are the review). The app loads it
// in development builds only (audio/reciters.ts, __DEV__), labelled "Development preview"; a release never plays it.
//
// It reads the dashboard's evidence and never writes it (inventory, review logs, the automatic-acceptance and
// owner-override ledgers). A surah is listed only when ALL of these hold:
//   - an aligned review package (reviewType alignment-verification) of the catalogue's own MP3Quran file: the same URL
//     and the audited size (audit-results.json), with no production timing and no development measured timing;
//   - the recording is registered, valid and not blocked (structure ok, no ayah missing from the alignment), not
//     playback-blocked (a VBR file the app cannot seek in), CBR;
//   - EVERY ayah start is accepted, by Reviewer 1 (a confirmed submission or a resolution) or by the automatic policy
//     (auto-accept.mjs effectiveAccepted); nothing very high risk, disputed, rejected, uncertain or owner-overridden
//     (an owner override is unverified and never plays);
//   - the timing is the canonical ayah count, in order, every ayah of positive length, inside the file.
// The timing is the accepted one: Reviewer 1's confirmed time where a person reviewed the start (corrections
// included), the proposed time where it was accepted automatically; ayah 1 keeps the proposal's onset (it plays from
// 0:00.000 under the opening rule; the onset is for highlighting). Each surah records how its starts were accepted, so
// automatic acceptance is never presented as listening.
//
// usage (from tools/quran-audio):
//   node development/generate-reviewed-timing.mjs --config <dashboard.config.json> [--out <file.ts>] [--report <file.json>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timingFingerprint } from '../fingerprint.mjs';
import { PROVIDERS } from '../providers.mjs';
import { classify, ledgerFile, openLedger, recordingBlock } from '../review/dashboard/auto-accept.mjs';
import { readConfig } from '../review/dashboard/dashboard-lib.mjs';
import { effectiveOverrides, openOverrides, overrideFile } from '../review/dashboard/owner-override.mjs';
import { createLogStore } from '../review/manual/log-store.mjs';
import { openingOf } from '../review/manual/opening.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const REPO = path.join(tools, '..', '..');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** The accepted timing of one recording: [{ ayah, startMs, endMs }] and how each start was accepted, or { why }. */
export function acceptedTiming(task, session, state, ledgerEntries, overrideEntries, ayahCount) {
  const block = recordingBlock(task, session);
  if (block) return { why: block };
  if (task.playbackBlocked?.length) return { why: `playback-blocked: ${task.playbackBlocked.join('; ')}` };
  if (session.format?.mode !== 'cbr') return { why: `not CBR (${session.format?.mode ?? 'unknown'}): no exact seeking` };
  if (effectiveOverrides(session, state, overrideEntries).size) return { why: 'an owner override (unverified) applies: never played' };
  const decisions = classify(task, session, state, ledgerEntries);
  const open = decisions.filter((c) => c.decision !== 'human-reviewed' && c.decision !== 'auto-accepted');
  if (open.length) return { why: `${open.length} start(s) not accepted (${[...new Set(open.map((c) => c.decision))].join(', ')}): ${open[0].why}` };
  if (decisions.length !== ayahCount) return { why: `${decisions.length} starts classified for ${ayahCount} ayahs` };
  const r1 = state.reviewers?.[1] ?? null;
  const confirmed = (k) => { const s = r1?.submitted?.[k]; return s?.status === 'confirmed' && Number.isFinite(s.ms) ? s.ms : null; };
  const resolution = (k) => (state.resolutions ?? []).find((x) => String(x.ayah) === String(k))?.ms ?? null;
  const o = openingOf(session);
  const starts = [];
  const how = { reviewer1: 0, automatic: 0 };
  for (const c of decisions) {
    const k = String(c.ayah);
    const human = c.decision === 'human-reviewed';
    how[human ? 'reviewer1' : 'automatic']++;
    if (c.ayah === 1) { starts.push(o.applies ? o.onsetMs : session.proposal.starts[1]); continue; }
    starts.push(human ? (resolution(k) ?? confirmed(k) ?? session.proposal.starts[k]) : session.proposal.starts[k]);
  }
  // The proposal's ayah-1 onset can lie after a start Reviewer 1 moved earlier (the aligner collapsed ayah 1, or
  // misplaced it after a lead-in): then Reviewer 1's own confirmed ayah-1 time is used (0:00.000 under the opening
  // rule), never a repaired guess. Without a person's ayah-1 decision the surah stays unavailable (checked below).
  if (starts.length > 1 && !(starts[0] < starts[1])) {
    const own = decisions[0].decision === 'human-reviewed' ? confirmed('1') : null;
    if (own != null && own < starts[1]) starts[0] = own;
  }
  const endConfirmed = confirmed('end');
  const end = endConfirmed != null && endConfirmed > starts.at(-1) ? endConfirmed : (session.proposal.endMs ?? session.durationMs);
  const entries = starts.map((s, i) => ({ ayah: i + 1, startMs: Math.round(s), endMs: Math.round(i + 1 < starts.length ? starts[i + 1] : end) }));
  for (const e of entries) {
    if (!Number.isFinite(e.startMs) || !(e.endMs > e.startMs)) return { why: `ayah ${e.ayah}: no positive length (${e.startMs}-${e.endMs} ms)` };
    if (e.startMs < 0 || e.endMs > session.durationMs + 50) return { why: `ayah ${e.ayah}: outside the recording (0-${session.durationMs} ms)` };
  }
  return { entries, how };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  if (!opt('--config')) throw new Error('usage: node development/generate-reviewed-timing.mjs --config <dashboard.config.json> [--out <file.ts>] [--report <file.json>]');
  const cfg = readConfig(opt('--config'));
  const OUT = opt('--out') ? path.resolve(opt('--out')) : path.join(REPO, 'mobile', 'src', 'audio', 'generated', 'reviewedTiming.ts');
  const audit = new Map(readJson(path.join(tools, 'audit-results.json')).reciters.map((r) => [r.id, r]));
  const counts = readJson(path.join(tools, 'audit-data', 'ayah-counts.json'));
  const ayahCountOf = (s) => (Array.isArray(counts) ? counts[s - 1] : counts[s] ?? counts.counts?.[s - 1]);
  const devMeasured = readJson(path.join(here, 'development-timing.json')).reciters ?? {};
  const inv = readJson(path.join(cfg.registryDir, 'inventory.json'));
  const tasks = new Map(inv.tasks.map((t) => [t.key, t]));
  const store = createLogStore({ locate: (k) => tasks.get(k) ?? null });
  const ledger = openLedger(ledgerFile(cfg.dataDir));
  if (ledger.problem) throw new Error(ledger.problem);
  const overrides = openOverrides(overrideFile(cfg.dataDir));
  if (overrides.problem) throw new Error(overrides.problem);
  const mp3quran = PROVIDERS.find((p) => p.id === 'mp3quran');
  const credits = fs.readFileSync(path.join(REPO, 'mobile', 'src', 'constants', 'quranSources.ts'), 'utf8');
  const devices = fs.existsSync(path.join(here, 'device-tests.json')) ? readJson(path.join(here, 'device-tests.json')) : null;

  const out = {};
  const report = { kind: 'reviewed-timing-report', createdAt: new Date().toISOString(), inventoryCreatedAt: inv.createdAt, policy: 'owner 2026-10-24: Reviewer 2 not required; Reviewer 1 listening decisions + automatic acceptance (auto-accept-v2)', reciters: {} };
  for (const t of [...tasks.values()].filter((x) => x.reviewType === 'alignment-verification').sort((x, y) => x.reciterId.localeCompare(y.reciterId) || x.surah - y.surah)) {
    const rr = (report.reciters[t.reciterId] ??= { enabled: {}, unavailable: {} });
    const no = (why) => { rr.unavailable[t.surah] = { key: t.key, provider: t.provider, why }; };
    const aud = audit.get(t.reciterId);
    const s = t.surah;
    const file = aud?.server ? `${aud.server}${String(s).padStart(3, '0')}.mp3` : null;
    if (!aud || t.provider !== 'mp3quran' || t.url !== file) { no(`not the catalogue's MP3Quran recording (${t.provider} ${t.url}): the app has no per-surah source for it`); continue; }
    if (aud.timed?.[s]) { no('production timing exists (the catalogue plays it)'); continue; }
    if (devMeasured[t.reciterId]?.surahs?.[s]) { no('development measured timing exists (already playable in development builds)'); continue; }
    if (!aud.surahs.includes(s)) { no('MP3Quran does not list this surah for the recording'); continue; }
    if (t.bytes !== aud.bytes[s]) { no(`file size ${t.bytes} is not the audited ${aud.bytes[s]}`); continue; }
    const { session, state } = store.load(t.key);
    const n = ayahCountOf(s);
    const r = acceptedTiming(t, session, state, ledger.forKey(t.key), overrides.forKey(t.key), n);
    if (r.why) { no(r.why); continue; }
    if (r.entries.length !== n) { no(`${r.entries.length} ayahs, canonical ${n}`); continue; }
    const fingerprint = timingFingerprint(r.entries);
    const points = [...r.entries.map((e) => e.startMs), r.entries.at(-1).endMs];
    (out[t.reciterId] ??= {})[s] = { fingerprint, bytes: t.bytes, reviewer1: r.how.reviewer1, automatic: r.how.automatic, deltas: points.map((p, k) => (k === 0 ? p : p - points[k - 1])) };
    // Production consideration (report only; nothing is promoted by a tool): every independent release requirement.
    const production = [
      ['review', true, `every start accepted (Reviewer 1: ${r.how.reviewer1}, automatic: ${r.how.automatic})`],
      ['integrity', true, `the audited MP3Quran file (${t.bytes} bytes, CBR), canonical ${n} ayahs, in order`],
      ['permission', mp3quran?.streaming?.permitted === true, mp3quran?.streaming?.evidence ?? 'mp3quran not in providers.mjs'],
      ['attribution', /key: 'mp3quran'/.test(credits), 'Quran Sources & Credits list MP3Quran'],
      ['devices', !!devices?.passed?.includes?.(`${t.reciterId}:${s}`), devices ? 'physical-device record' : 'no physical-device test record (development/device-tests.json)'],
    ].map(([gate, pass, why]) => ({ gate, pass, why }));
    rr.enabled[s] = { key: t.key, fingerprint, reviewer1: r.how.reviewer1, automatic: r.how.automatic, basis: r.how.automatic === 0 ? 'reviewer-1' : r.how.reviewer1 === 0 ? 'automatic' : 'reviewer-1 + automatic', production, productionEligible: production.every((g) => g.pass) };
  }

  const lines = [
    '// GENERATED by tools/quran-audio/development/generate-reviewed-timing.mjs from the review dashboard. Do not edit.',
    '/**',
    ' * DEVELOPMENT PREVIEW ONLY: ayah timing for MP3Quran catalogue surahs whose aligned timing cleared the review queue',
    ' * (owner policy 2026-10-24: Reviewer 1 listening decisions and the automatic acceptance policy; Reviewer 2 not',
    ' * required). Loaded only when __DEV__ is true (audio/reciters.ts) and labelled "Development preview": never in a',
    ' * release. Per surah: the timing fingerprint, the audited file size, how many starts Reviewer 1 accepted and how',
    ' * many the automatic policy accepted (automatic acceptance is not listening), and the timing delta-encoded (ayah 1\'s',
    ' * start, then each ayah\'s length).',
    ' */',
    `export const REVIEWED_TIMING_GENERATED_ON = '${report.createdAt.slice(0, 10)}';`,
    'export const REVIEWED_TIMING: Readonly<Record<string, Readonly<Record<number, { fingerprint: string; bytes: number; reviewer1: number; automatic: number; deltas: readonly number[] }>>>> = {',
  ];
  for (const [id, surahs] of Object.entries(out)) {
    lines.push(`  '${id}': {`);
    for (const [s, x] of Object.entries(surahs)) lines.push(`    ${s}: { fingerprint: '${x.fingerprint}', bytes: ${x.bytes}, reviewer1: ${x.reviewer1}, automatic: ${x.automatic}, deltas: [${x.deltas.join(', ')}] },`);
    lines.push('  },');
  }
  lines.push('};', '');
  fs.writeFileSync(OUT, lines.join('\n'));
  if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 1));
  for (const [id, r] of Object.entries(report.reciters)) console.log(`${id}: ${Object.keys(r.enabled).length} enabled, ${Object.keys(r.unavailable).length} not`);
  console.log(`${path.relative(REPO, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}
