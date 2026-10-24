// Writes mobile/src/audio/generated/timedPreview.ts, the app's DEVELOPMENT-ONLY timing for whole-surah files outside the
// catalogue (mobile/src/audio/timedPreview.ts; loaded only when __DEV__): reciters with no recording of their own, and
// surahs a catalogue recording cannot play (not listed, or VBR) for which another file of the same reciter exists.
// The app adds a surah only where it has no other timing (reciters.ts withTimedPreview).
//
// Two inputs, one rule set; never a whole-surah fallback, never a partial surah, never a splice:
//   --config <dashboard.config.json>: the review dashboard's ACCEPTED timing (development/generate-reviewed-timing.mjs
//     acceptedTiming: every start accepted by Reviewer 1 or by the automatic policy auto-accept-v2; nothing very high,
//     disputed, rejected, uncertain or owner-overridden; Reviewer 1's confirmed times where a person reviewed). Read only.
//     Every registered alignment of a non-MP3Quran file, except reciters on hold (Rifaat, Gebril). Unresolved RIGHTS do
//     not block a development preview (owner 2026-10-24: never a release); every other playback block does.
//   <packages dir> ...: review packages not (yet) in the dashboard (review/make-packages.mjs --aligned): valid, not
//     blocked, CBR, and no Very High Risk start (the dashboard's own rules; high, medium, check and routine starts are
//     accepted under auto-accept-v2). A surah the dashboard already decides is never taken from a package.
//   --copies <json>: same-performance CBR copies (surah-sources/same-performance-copies.json): `openings` (a file that
//     starts with other audio plays ayah 1 from the recitation) and `transfers` (the original's accepted timing, moved).
//   --repairs <json>: recorded, acoustically checked boundary repairs (surah-sources/boundary-repairs.json), package mode.
//   --stream-urls <json>: a verified direct URL for a file whose public URL redirects (archive.org /download/ → its
//     storage node): used only when its size and SHA-256 equal the reviewed file's (surah-sources/stream-urls.json).
//
// usage: node tools/quran-audio/surah-sources/generate-timed-preview.mjs [--config <cfg>] [--stream-urls <json>]
//          [<packages dir> ...] [--out <file.ts>] [--report <json>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { acceptedTiming } from '../development/generate-reviewed-timing.mjs';
import { timingFingerprint } from '../fingerprint.mjs';
import { ledgerFile, openLedger } from '../review/dashboard/auto-accept.mjs';
import { packageProblems, providerOf, readConfig, riskOf, sessionFromPackage } from '../review/dashboard/dashboard-lib.mjs';
import { openOverrides, overrideFile } from '../review/dashboard/owner-override.mjs';
import { createLogStore } from '../review/manual/log-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..', '..');
const ON_HOLD = ['rifaat', 'gebril'];
// A rights block only (no grant for app use yet): a development preview may play it; a release never does.
const RIGHTS_ONLY = /^no permission for app use\b/;
const argv = process.argv.slice(2);
const VALUED = ['--out', '--report', '--config', '--stream-urls', '--repairs', '--copies'];
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const dirs = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
const OUT = opt('--out') ? path.resolve(opt('--out')) : path.join(REPO, 'mobile', 'src', 'audio', 'generated', 'timedPreview.ts');
const streamUrls = opt('--stream-urls') ? JSON.parse(fs.readFileSync(opt('--stream-urls'), 'utf8')).files ?? {} : {};
const repairs = opt('--repairs') ? JSON.parse(fs.readFileSync(opt('--repairs'), 'utf8')).repairs ?? [] : [];
const copies = opt('--copies') ? JSON.parse(fs.readFileSync(opt('--copies'), 'utf8')) : {};
const openings = copies.openings ?? [];
const transfers = copies.transfers ?? [];
const sameFile = (x, pkg) => x.reciterId === pkg.reciterId && x.surah === pkg.surah && x.url === pkg.url;
let dash = null; // the review dashboard (read only), when --config is given

const chosen = new Map(); // reciterId -> Map(surah -> { provider, url, bytes, durationMs, entries, reviewer1, automatic, evidence })
const report = {};
const rep = (id) => (report[id] ??= { enabled: [], blocked: {}, how: {} });

/** Where the app streams `url` from: the URL itself, or its verified direct copy (same bytes, same SHA-256). */
function streamUrl(url, bytes, sha256) {
  const s = streamUrls[url];
  if (!s) return { url };
  if (s.bytes !== bytes || !sha256 || s.sha256 !== sha256) return { why: `stream-urls entry for ${url} is not the reviewed file (size or SHA-256 differs)` };
  return { url: s.url };
}

/**
 * The recorded adjustments of one file's timing, the same whether its timing comes from the dashboard or from a package
 * (so importing a package never changes what the app plays): --copies transfers, --repairs, --copies openings.
 * `own`: the file's own timing (entries); returns { entries, how, openingMs } or { why }.
 */
function adjust(file, own, how) {
  let entries = own.map((x) => ({ ...x }));
  // --copies transfers: a CBR copy of the SAME performance as a dashboard recording (compare.py: constant lag) takes
  // that recording's accepted timing moved by the measured offset, never its own aligner's, and only when the copy's
  // own alignment agrees with it at every start from ayah 2 (maxDevMs). The original's review decides its starts
  // (Reviewer 1 / automatic), so the copy's own risk classification does not apply.
  const tr = transfers.find((x) => sameFile(x, file));
  if (tr) {
    const t = dash?.tasks.get(tr.fromKey);
    if (!t || t.reciterId !== file.reciterId || t.surah !== file.surah) return { why: `transfer from ${tr.fromKey}: not in the dashboard (give --config)` };
    const { session: os, state } = dash.store.load(t.key);
    const r = acceptedTiming({ ...t, playbackBlocked: [] }, { ...os, format: { ...os.format, mode: 'cbr' } }, state, dash.ledger.forKey(t.key), dash.overrides.forKey(t.key), t.ayahCount);
    if (r.why) return { why: `transfer from ${tr.fromKey}: ${r.why}` };
    const moved = r.entries.map((x) => ({ ayah: x.ayah, startMs: x.startMs + tr.offsetMs, endMs: Math.min(x.endMs + tr.offsetMs, file.durationMs) }));
    const dev = Math.max(...moved.slice(1).map((x, i) => Math.abs(x.startMs - entries[i + 1].startMs)));
    if (moved.length !== entries.length || !(dev <= tr.maxDevMs)) return { why: `transfer from ${tr.fromKey}: the copy's own alignment differs by ${dev} ms (allowed ${tr.maxDevMs})` };
    entries = moved;
    how = { reviewer1: r.how.reviewer1, automatic: r.how.automatic, transferred: `${tr.fromKey} +${tr.offsetMs} ms (own alignment within ${dev} ms)` };
  }
  // Recorded boundary repairs (--repairs): only where the timing still has the exact boundary the repair was made
  // for, and the repaired start stays between its neighbours' starts. Anything else leaves the surah unavailable.
  const fixes = repairs.filter((x) => sameFile(x, file));
  const bad = fixes.find((x) => {
    const k = x.ayah - 1;
    return !(k > 0 && k < entries.length) || entries[k].startMs !== x.fromMs || !(x.toMs > entries[k - 1].startMs && x.toMs < entries[k].endMs);
  });
  if (bad) return { why: `boundary repair of ${file.surah}:${bad.ayah} does not apply to this timing (made for ${bad.fromMs} ms)` };
  for (const x of fixes) { entries[x.ayah - 1].startMs = x.toMs; entries[x.ayah - 2].endMs = x.toMs; }
  if (entries.some((x) => !(x.endMs > x.startMs))) return { why: 'a non-positive ayah length' };
  // --copies openings: a file that starts with audio outside the recitation plays ayah 1 from the recitation's
  // opening, located against the same performance's catalogue file; it must lie before ayah 1's words.
  const op = openings.find((x) => sameFile(x, file));
  if (op && !(Number.isInteger(op.openingMs) && op.openingMs > 0 && op.openingMs < entries[0].startMs)) return { why: `opening ${op.openingMs} ms is not before ayah 1 (${entries[0].startMs} ms)` };
  return { entries, how, openingMs: op?.openingMs, transferred: !!tr };
}

function choose(reciterId, surah, x) {
  const m = chosen.get(reciterId) ?? new Map();
  chosen.set(reciterId, m);
  if (m.has(surah)) {
    // Two candidate recordings of one surah: neither is chosen here (a person picks one).
    m.delete(surah);
    rep(reciterId).blocked[surah] = 'two accepted candidate recordings of this surah: none chosen';
    return;
  }
  m.set(surah, x);
}

if (opt('--config')) {
  const cfg = readConfig(opt('--config'));
  const inv = JSON.parse(fs.readFileSync(path.join(cfg.registryDir, 'inventory.json'), 'utf8'));
  const tasks = new Map(inv.tasks.map((t) => [t.key, t]));
  const store = createLogStore({ locate: (k) => tasks.get(k) ?? null });
  const ledger = openLedger(ledgerFile(cfg.dataDir));
  if (ledger.problem) throw new Error(ledger.problem);
  const overrides = openOverrides(overrideFile(cfg.dataDir));
  if (overrides.problem) throw new Error(overrides.problem);
  dash = { tasks, store, ledger, overrides };
  for (const t of [...tasks.values()].sort((a, b) => a.reciterId.localeCompare(b.reciterId) || a.surah - b.surah || a.key.localeCompare(b.key))) {
    if (t.reviewType !== 'alignment-verification' || t.provider === 'mp3quran' || t.perAyah || ON_HOLD.includes(t.reciterId)) continue;
    const no = (why) => { rep(t.reciterId).blocked[t.surah] = `${t.key}: ${why}`; };
    const other = (t.playbackBlocked ?? []).filter((b) => !RIGHTS_ONLY.test(b));
    if (other.length) { no(`playback-blocked: ${other.join('; ')}`); continue; }
    const { session, state } = store.load(t.key);
    const file = { reciterId: t.reciterId, surah: t.surah, url: t.url, durationMs: session.durationMs };
    let own;
    let how;
    if (transfers.some((x) => sameFile(x, file))) {
      // A transfer: the original's review decides; this file's own proposed starts are only compared with it.
      const p = session.proposal?.starts ?? {};
      const starts = Array.from({ length: t.ayahCount }, (_, i) => p[i + 1]);
      if (starts.some((x) => !Number.isFinite(x))) { no('no proposed start for every ayah'); continue; }
      own = starts.map((x, i) => ({ ayah: i + 1, startMs: Math.round(x), endMs: Math.round(i + 1 < starts.length ? starts[i + 1] : session.proposal.endMs ?? session.durationMs) }));
      how = { reviewer1: 0, automatic: 0 };
    } else {
      const r = acceptedTiming({ ...t, playbackBlocked: [] }, session, state, ledger.forKey(t.key), overrides.forKey(t.key), t.ayahCount);
      if (r.why) { no(r.why); continue; }
      own = r.entries;
      how = { reviewer1: r.how.reviewer1, automatic: r.how.automatic };
    }
    const a = adjust(file, own, how);
    if (a.why) { no(a.why); continue; }
    const s = streamUrl(t.url, t.bytes, t.sha256);
    if (s.why) { no(s.why); continue; }
    choose(t.reciterId, t.surah, {
      provider: t.provider, url: s.url, bytes: t.bytes, durationMs: session.durationMs, entries: a.entries, ...a.how, openingMs: a.openingMs,
      evidence: `review dashboard ${t.key} (${t.sourceId})`, source: `review dashboard (accepted timing, source ${t.sourceId})`, rights: (t.playbackBlocked ?? []).filter((b) => RIGHTS_ONLY.test(b)).join('; ') || (t.rights?.reason ?? null),
    });
  }
}

for (const dir of dirs) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const e of index.packages) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, e.file), 'utf8'));
    if (chosen.get(pkg.reciterId)?.has(pkg.surah) || rep(pkg.reciterId).blocked[pkg.surah]) continue; // the dashboard decides it
    const no = (why) => { rep(pkg.reciterId).blocked[pkg.surah] = why; };
    const problems = packageProblems(pkg);
    if (problems.length) { no(`invalid package: ${problems.join('; ')}`); continue; }
    if (pkg.blocked?.length) { no(`blocked: ${pkg.blocked.join('; ')}`); continue; }
    if (pkg.format?.mode !== 'cbr') { no(`not CBR (${pkg.format?.mode}): no exact seeking`); continue; }
    const ayahs = pkg.ayahs.map((a) => ({ ayah: a.ayah, startMs: Math.round(a.startMs), endMs: Math.round(a.endMs) }));
    // The app times each ayah from its start to the next ayah's start (the last: to its end).
    const entries = ayahs.map((a, i) => ({ ayah: a.ayah, startMs: a.startMs, endMs: i + 1 < ayahs.length ? ayahs[i + 1].startMs : a.endMs }));
    const file = { reciterId: pkg.reciterId, surah: pkg.surah, url: pkg.url, durationMs: pkg.durationMs };
    // A transfer takes the original's reviewed timing; otherwise the package's own starts must carry no Very High risk.
    if (!transfers.some((x) => sameFile(x, file))) {
      const session = sessionFromPackage(pkg, { key: 'k', provider: providerOf(pkg.url), sourceId: 'preview', phase: null, packageFile: e.file, packageSha256: '', issues: {}, concerns: [], sha256: null });
      const vh = riskOf(session).map(([t], i) => (t === 'veryhigh' ? i + 1 : null)).filter(Boolean);
      if (vh.length) { no(`very high risk start(s) ${vh.join(', ')}: awaiting a person`); continue; }
    }
    const a = adjust(file, entries, { reviewer1: 0, automatic: entries.length });
    if (a.why) { no(a.why); continue; }
    const s = streamUrl(pkg.url, pkg.bytes, pkg.sha256 ?? pkg.experiment?.sha256);
    if (s.why) { no(s.why); continue; }
    const where = path.relative(REPO, path.resolve(dir)).replaceAll('\\', '/');
    choose(pkg.reciterId, pkg.surah, { provider: providerOf(pkg.url), url: s.url, bytes: pkg.bytes, durationMs: pkg.durationMs, entries: a.entries, ...a.how, openingMs: a.openingMs, evidence: `${where}/${e.file}`, source: `${where} (review packages, not in the dashboard)` });
  }
}

const lines = [];
for (const [id, surahs] of [...chosen].sort(([a], [b]) => a.localeCompare(b))) {
  const rows = [...surahs].sort(([a], [b]) => a - b);
  if (!rows.length) continue;
  const r = rep(id);
  const evidence = [...new Set(rows.map(([, x]) => x.source))].join('; ');
  lines.push('  {', `    reciterId: '${id}',`, `    evidence: '${evidence.replaceAll("'", "\\'")}',`, `    generatedOn: '${new Date().toISOString().slice(0, 10)}',`, '    surahs: {');
  for (const [s, x] of rows) {
    const deltas = [x.entries[0].startMs, ...x.entries.map((e) => e.endMs - e.startMs)];
    lines.push(`      ${s}: { provider: '${x.provider}', url: '${x.url.replaceAll("'", "\\'")}', bytes: ${x.bytes}, durationMs: ${x.durationMs}, fingerprint: '${timingFingerprint(x.entries)}', reviewer1: ${x.reviewer1}, automatic: ${x.automatic}, ${x.openingMs ? `openingMs: ${x.openingMs}, ` : ''}deltas: [${deltas.join(', ')}] },`);
    r.enabled.push(s);
    r.how[s] = { evidence: x.evidence, reviewer1: x.reviewer1, automatic: x.automatic, provider: x.provider, url: x.url, rights: x.rights ?? null, ...(x.transferred ? { transferred: x.transferred } : {}), ...(x.openingMs ? { openingMs: x.openingMs } : {}) };
  }
  lines.push('    },', '  },');
}
fs.writeFileSync(OUT, [
  '// GENERATED by tools/quran-audio/surah-sources/generate-timed-preview.mjs. Do not edit.',
  '/**',
  ' * DEVELOPMENT PREVIEW ONLY (audio/timedPreview.ts): aligned timing for whole-surah files outside the catalogue, loaded',
  ' * only when __DEV__ is true (audio/reciters.ts). Per surah: its own file (provider, url, size, length), the fingerprint',
  ' * of its ayah timing, how many starts Reviewer 1 accepted and how many the automatic policy accepted (automatic',
  ' * acceptance is not listening), and the timing delta-encoded (ayah 1\'s start, then each ayah\'s length). Only surahs',
  ' * whose every start is accepted (review dashboard) or, for packages not yet in it, with no Very High Risk start, a',
  ' * valid unblocked CBR file. The files\' rights for app use are NOT established: never in a release.',
  ' */',
  "import type { TimedPreviewRecording } from '../timedPreview';",
  '',
  'export const TIMED_PREVIEW: readonly TimedPreviewRecording[] = [',
  ...lines,
  '];',
  '',
].join('\n'));
for (const r of Object.values(report)) r.enabled.sort((a, b) => a - b);
if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 1));
console.log(`${path.relative(REPO, OUT)}: ${Object.entries(report).map(([id, r]) => `${id}: ${r.enabled.length} enabled, ${Object.keys(r.blocked).length} unavailable`).join('; ')} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
