// Review packages for the audio review dashboard (review/dashboard), from a per-ayah risk report (classify.mjs): one
// standard ayah-timing-review-package per surah, so the dashboard's waveform, listening, Confirm / Reject, notes,
// corrections, auto-acceptance and Very High Risk queue all apply unchanged.
//
//   - The audio is a local REVIEW COPY: the surah's files joined in the order the app plays them (the Basmala file
//     first where the surah has one), written by join_review_copy.py outside the repository and OneDrive. Never
//     published, never re-encoded (MP3 frames joined; a PCM decode only where the formats differ).
//   - Each ayah's start is exactly where its file begins in the copy (frame-exact); nothing is estimated. Ayah 1 starts
//     at 0:00.000 (the opening rule), its words after the Basmala file.
//   - The risk of every ayah goes with the package (perAyah.risk): HIGH risk ayahs become Very High Risk starts (the
//     only ones the owner's policy leaves for a person), with the reasons; a high-risk Basmala file marks ayah 1.
//   - Writes the folder `<out>` with index.json (kind ayah-timing-review-index): the dashboard discovers it under its
//     scan roots (Refresh queue), or name it in dashboard.config.json.
//
// usage: node tools/quran-audio/per-ayah/make-review-packages.mjs --risk <risk.json> --config <dashboard.config.json>
//          --out <packages folder> [--surahs 1,2,112] [--python <python>]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timingFingerprint } from '../fingerprint.mjs';
import { OPENING_RULE } from '../review/manual/opening.mjs';
import { canon, readConfig } from '../review/dashboard/dashboard-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..', '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
if (!args.risk || !args.config || !args.out) throw new Error('usage: make-review-packages.mjs --risk <risk.json> --config <dashboard.config.json> --out <folder>');
const report = JSON.parse(fs.readFileSync(args.risk, 'utf8'));
if (report.kind !== 'per-ayah-risk') throw new Error(`${args.risk}: not a per-ayah risk report`);
const cfg = readConfig(args.config);
const rec = report.recording;
const files = path.join(process.env.LOCALAPPDATA ?? '.', 'QuranHeals', 'per-ayah-cache', rec.folder, 'files');
// --copies <dir>: join the review copies there instead (e.g. a scratch folder while a dashboard serves the cache); the
// package then names the dashboard cache's existing copy, and only if it is byte-identical (size and SHA-256). Nothing
// in the dashboard cache is written; a missing or different copy stops the run.
const liveCopies = path.join(cfg.cacheDir, 'per-ayah', rec.id);
const copies = args.copies ? path.resolve(args.copies) : liveCopies;
const python = args.python ?? cfg.python;
const only = args.surahs ? new Set(String(args.surahs).split(',').map(Number)) : null;
fs.mkdirSync(copies, { recursive: true });
fs.mkdirSync(path.join(args.out, 'packages'), { recursive: true });

const { text, meta, basmala: B } = canon();
const pad = (n) => String(n).padStart(3, '0');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const byRef = new Map(report.items.map((r) => [`${r.surah}:${r.ayah}`, r]));
const index = [];
const summary = { surahs: 0, ayahs: 0, high: 0 };

for (let s = 1; s <= 114; s++) {
  if (only && !only.has(s)) continue;
  const m = meta.get(s);
  const hasBasmala = s !== 1 && s !== 9;
  const key = `${rec.id}-${s}-${rec.provider}`;
  const joined = JSON.parse(execFileSync(python, ['-I', '-X', 'utf8', path.join(here, 'join_review_copy.py'), files, String(s), path.join(copies, key), hasBasmala ? '--basmala' : '--no-basmala'], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').at(-1));
  if (args.copies) {
    const live = path.join(liveCopies, path.basename(joined.file));
    const same = fs.existsSync(live) && fs.statSync(live).size === joined.bytes && crypto.createHash('sha256').update(fs.readFileSync(live)).digest('hex') === joined.sha256;
    if (!same) throw new Error(`surah ${s}: the dashboard cache's review copy ${live} is missing or not identical to the joined copy: not packaged`);
    joined.file = live;
  }
  const segs = joined.segments;
  if (segs.length !== m.ayahs + (hasBasmala ? 1 : 0)) throw new Error(`surah ${s}: ${segs.length} files joined for ${m.ayahs} ayahs`);
  const ayahSegs = hasBasmala ? segs.slice(1) : segs;
  const words = B.split(' ').length;
  let basmala = null;
  const ayahs = ayahSegs.map((g, i) => {
    let t = text.get(`${s}:${i + 1}`);
    if (i === 0 && hasBasmala && t.split(' ').slice(0, words).join(' ') === B) { basmala = B; t = t.split(' ').slice(words).join(' '); }
    return { ayah: i + 1, startMs: g.startMs, endMs: g.endMs, text: t };
  });
  // The text keeps the Basmala inside ayah 1 where it is not spelled exactly as 1:1 (95:1 and 97:1 write «بِّسْمِ»), as
  // the dashboard's own production sessions do; the audio still opens with the surah's Basmala file.
  const intro = hasBasmala ? [0, segs[0].endMs] : null;
  const entries = ayahs.map((a) => ({ ayah: a.ayah, startMs: a.startMs, endMs: a.endMs }));
  if (intro) entries.unshift({ ayah: 0, startMs: intro[0], endMs: intro[1] });
  // Risk per ayah; the Basmala file's risk is ayah 1's (it is heard as the opening of ayah 1).
  const risk = {};
  for (const a of ayahs) {
    const r = byRef.get(`${s}:${a.ayah}`);
    const b = a.ayah === 1 && hasBasmala ? byRef.get(`${s}:0`) : null;
    const reasons = [...(b?.risk === 'high' ? b.reasons.map((x) => `Basmala file ${b.file}: ${x}`) : []), ...(r.risk === 'high' ? r.reasons : [])];
    // Graded reports (classify.mjs `tier`): the more serious of the ayah's and its Basmala file's tier.
    const graded = r.tier !== undefined;
    // Phase 4.8.10 (severity.mjs reports): exceptions (not assessable) and check are tiers too.
    const tier = graded ? ['veryhigh', 'exception', 'high', 'medium', 'check', 'low'].find((t) => t === r.tier || (b?.risk === 'high' && t === b.tier)) : undefined;
    // The unified severity (severity.mjs): exact codes, evidence, adjacent ayahs, dependency; the Basmala file's codes too.
    const sev = r.severity || b?.severity ? {
      rule: r.severity?.rule ?? b?.severity?.rule, dependsOn: r.severity?.dependsOn ?? null, confidence: r.severity?.confidence ?? null, limitations: r.severity?.limitations ?? [],
      codes: [...(b?.severity?.codes ?? []).map((x) => ({ ...x, why: `Basmala file ${b.file}: ${x.why}`, locationMs: null })), ...(r.severity?.codes ?? [])],
      previous: r.severity?.previous ?? null,
    } : null;
    risk[a.ayah] = { risk: reasons.length ? 'high' : 'low', ...(graded ? { tier } : {}), reasons, confidence: r.confidence, evidence: r.evidence, ...(sev ? { severity: sev } : {}), ...(b ? { basmala: { risk: b.risk, ...(graded ? { tier: b.tier } : {}), confidence: b.confidence, evidence: b.evidence } } : {}) };
  }
  const high = Object.entries(risk).filter(([, r]) => r.risk === 'high').map(([a]) => Number(a));
  // The dashboard tier of a flagged ayah: priority 1 = high, 2 = medium (dashboard-lib riskOf); Very High comes from
  // the package's perAyah.risk (very-high.mjs). Ungraded packages: every flagged ayah priority 1, as before.
  const priorityOf = (x) => (x.risk !== 'high' || x.tier === 'check' || x.tier === 'low' ? 3 : x.tier === 'medium' ? 2 : 1);
  // Where the suspected problem is, inside the joined review copy (drawn on the review page's zoomed waveform).
  const locationOf = (a) => { const loc = risk[a.ayah].severity?.codes?.find((x) => x.tier === 'veryhigh' && Array.isArray(x.locationMs) && x.locationMs.every(Number.isFinite))?.locationMs; return loc ? [a.startMs + loc[0], Math.min(a.endMs, a.startMs + loc[1])] : null; };
  const pkg = {
    kind: 'ayah-timing-review-package', version: 1, source: 'per-ayah',
    status: `per-ayah recording, automated scan: ${high.length} of ${m.ayahs} ayahs high risk (listen), the rest low risk (no automated reason to listen; not a verification)`,
    reciterId: rec.id, recording: `EveryAyah ${rec.folder} (one file per ayah)`,
    surah: s, surahAr: m.ar, surahEn: m.en, ayahCount: m.ayahs,
    url: `${rec.base}#${pad(s)}`, bytes: joined.bytes, durationMs: joined.durationMs,
    format: { kbps: Number(/(\d+)kbps/i.exec(rec.folder)?.[1] ?? 0) || null, mode: joined.kind === 'wav' ? 'pcm' : 'cbr', durationMs: joined.durationMs, reviewCopy: joined.kind, formats: joined.formats },
    textSource: "tools/quran-verification/input/quran-uthmani.txt (Tanzil Uthmani 1.1, the app's runtime text), verbatim",
    basmala, ayahs, intro, candidateFingerprint: timingFingerprint(entries),
    boundaries: ayahs.filter((a) => a.ayah >= 2).map((a) => ({ ayah: a.ayah, ms: a.startMs, flags: risk[a.ayah].risk === 'high' ? [`per-ayah-${risk[a.ayah].tier ?? 'high'}`] : [], priority: priorityOf(risk[a.ayah]), ...(locationOf(a) ? { pauseMs: locationOf(a), problemAt: true } : {}), ...(risk[a.ayah].risk === 'high' ? { check: risk[a.ayah].reasons.join('; ') } : {}) })),
    worklist: high, worklistRule: 'the ayahs the automated per-ayah scan could not clear (per-ayah/classify.mjs)',
    structure: { ok: true, problems: [], note: 'file boundaries: every ayah once, in order (the files are the ayahs)' },
    completeness: { missing_in_alignment: [], collapsed_runs: [] },
    opening: { rule: OPENING_RULE.id, startMs: OPENING_RULE.startMs, onsetMs: ayahs[0].startMs },
    perAyah: {
      base: rec.base, riskReport: path.relative(REPO, path.resolve(args.risk)).replaceAll('\\', '/'),
      basmala: hasBasmala ? { file: segs[0].name, startMs: 0, endMs: segs[0].endMs } : null,
      files: segs.map((g) => { const r = byRef.get(`${s}:${Number(g.name.slice(3, 6))}`); return { name: g.name, startMs: g.startMs, endMs: g.endMs, bytes: r.bytes, sha256: r.sha256 }; }),
      risk, reviewCopy: { file: joined.file, kind: joined.kind, bytes: joined.bytes, sha256: joined.sha256 },
    },
    experiment: { phase: 'per-ayah', rightsStatus: rec.rights.evidence, sha256: joined.sha256 },
    createdOn: report.createdOn,
  };
  const file = `packages/${key}.json`;
  fs.writeFileSync(path.join(args.out, file), JSON.stringify(pkg, null, 1));
  index.push({ file, surah: s, ayahs: m.ayahs, high: high.length, sha256: sha256(JSON.stringify(pkg)) });
  summary.surahs++; summary.ayahs += m.ayahs; summary.high += high.length;
  process.stdout.write(`${s} `);
}
fs.writeFileSync(path.join(args.out, 'index.json'), JSON.stringify({
  kind: 'ayah-timing-review-index', phase: `per-ayah ${rec.id}`, createdOn: report.createdOn, recording: rec.id, riskReport: path.relative(REPO, path.resolve(args.risk)).replaceAll('\\', '/'),
  scan: { ...report.totals, rule: report.rule }, packages: index,
}, null, 1));
console.log(`\n${summary.surahs} packages, ${summary.ayahs} ayahs, ${summary.high} high risk -> ${args.out}`);
