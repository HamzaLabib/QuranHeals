// Summary of an alignment run (run-batch.mjs output dir): per reciter and surah, where each recording stands.
//   failed        alignment error, structure failed, ayahs after the first that look absent, text not confirmed (median character score < TEXT_MIN: the
//                 wrong-text controls score 0.17-0.18, complete files 0.46-0.58), or ayahs that look absent
//   blocked       automated checks passed, but the file cannot serve ayah playback as it is (VBR: seeks 0.5-1.8 s off)
//   candidate     passed the automated checks; needs the listening review (nothing here is approved or activated)
//   excluded      not processed (batch-exclusions.json, with the reason)
//   remaining     listed by MP3Quran, untimed, not processed yet
// Also refreshes <out>/<id>/completeness.json from the star-configuration alignments (completeness.py).
// Writes <out>/summary.json and prints a table.
//
// usage: node alignment/summarize-batch.mjs <run-batch out dir> [--json <file>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RECITERS } from '../reciters.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const repo = path.join(tools, '..', '..');
const [out] = process.argv.slice(2);
if (!out) throw new Error('usage: node alignment/summarize-batch.mjs <run-batch out dir>');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const audit = readJson(path.join(tools, 'audit-results.json'));
const dev = readJson(path.join(tools, 'development', 'development-timing.json'));
const formats = readJson(path.join(tools, 'audit-data', 'recording-formats-2026-10-17.json')).recordings;
const exclusions = readJson(path.join(here, 'batch-exclusions.json')).reciters;
const quran = path.join(repo, 'backend', 'data', 'quran', 'quran-uthmani.txt');
export const TEXT_MIN = 0.3;
const vbrRecoveryFile = fs.readdirSync(path.join(tools, 'audit-data')).filter((f) => /^vbr-recovery-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().at(-1);
const vbrRecovery = vbrRecoveryFile ? readJson(path.join(tools, 'audit-data', vbrRecoveryFile)) : { recordings: {} };

const progress = fs.existsSync(path.join(out, 'progress.jsonl')) ? fs.readFileSync(path.join(out, 'progress.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const lastError = new Map();
for (const p of progress) if (p.error) lastError.set(`${p.id}:${p.s}`, p.error);

const reciters = [];
for (const rec of RECITERS) {
  const entry = audit.reciters.find((r) => r.id === rec.id);
  const row = { id: rec.id, name: rec.nameEn, listed: entry?.surahs?.length ?? 0, production: Object.keys(entry?.timed ?? {}).length, development: Object.keys(dev.reciters[rec.id]?.surahs ?? {}).length, surahs: {} };
  reciters.push(row);
  if (!entry?.server) { row.noRecording = rec.noRecording ?? 'no permitted recording'; continue; }
  const dir = path.join(out, rec.id);
  let completeness = {};
  if (fs.existsSync(dir)) {
    const starDir = path.join(dir, '_star');
    fs.mkdirSync(starDir, { recursive: true });
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.star.json'))) fs.copyFileSync(path.join(dir, f), path.join(starDir, f.replace('.star', '')));
    if (fs.readdirSync(starDir).length) {
      execFileSync('python', ['-I', path.join(here, 'completeness.py'), quran, starDir, path.join(dir, 'completeness.json')], { stdio: 'pipe' });
      completeness = readJson(path.join(dir, 'completeness.json'));
    }
  }
  for (const s of entry.surahs.filter((x) => !entry.timed[x] && !dev.reciters[rec.id]?.surahs?.[x])) {
    const flagsFile = path.join(dir, `${s}.flags.json`);
    let status, why = [];
    if (exclusions[rec.id]?.[s]) { status = 'excluded'; why = [exclusions[rec.id][s]]; }
    else if (!fs.existsSync(flagsFile)) {
      status = lastError.has(`${rec.id}:${s}`) ? 'failed' : 'remaining';
      if (status === 'failed') why = [`alignment error: ${lastError.get(`${rec.id}:${s}`).slice(0, 160)}`];
    } else {
      const f = readJson(flagsFile);
      const c = completeness[String(s)];
      if (!f.structure.ok) why.push(`structure: ${f.structure.problems.join('; ')}`);
      if (c && c.median_score < TEXT_MIN) why.push(`text not confirmed (median score ${c.median_score})`);
      // Ayah 1 alone squeezed (opening letters, very short first ayahs: the audio is there, the aligner gives it a few
      // hundred ms): a candidate whose ayah 1 -> 2 boundary must be set by ear; any other absent-looking ayah fails it.
      const openingOnly = c && c.collapsed === 1 && c.collapsed_runs[0] === '1';
      if (c && c.collapsed > 0 && !openingOnly) why.push(`${c.collapsed} ayahs look absent (${c.collapsed_runs.join(', ')})`);
      const file = formats[rec.id]?.files?.[s];
      const vr = vbrRecovery.recordings[`${rec.id}:${s}`];
      const recoveredVbr = vr && vr.mllt.audioFramesIdentical && vr.mllt.decodedPcmIdentical && vr.mllt.seek.errorRangeMs[1] <= 27.1 && vr.mllt.seek.errorRangeMs[0] >= -1;
      const blockedWhy = file?.bitrateMode === 'vbr' && !recoveredVbr ? ['VBR file: the app cannot seek it to an ayah precisely'] : [];
      if (recoveredVbr) why.push(`VBR: seekable copy validated locally (${vbrRecoveryFile}); hosting it needs permission before app use`);
      status = why.filter((w) => !w.startsWith('VBR: seekable copy')).length ? 'failed' : blockedWhy.length ? 'blocked' : 'candidate';
      if (status === 'blocked') why = blockedWhy;
      if (openingOnly && status !== 'failed') why.push('ayah 1 squeezed by the aligner: set the 1 -> 2 boundary by ear');
      row.surahs[s] = { status, why, boundaries: f.flags?.boundaries, flagged: f.flags?.flagged, fingerprint: f.candidate?.fingerprint, checks: f.checks ?? null, ends: c ? { beforeFirstS: c.before_first_ayah_s, afterLastS: c.after_last_ayah_s } : null, medianScore: c?.median_score ?? null };
      continue;
    }
    row.surahs[s] = { status, why };
  }
}

const count = (r, st) => Object.values(r.surahs).filter((x) => x.status === st).length;
const summary = {
  createdOn: new Date().toISOString().slice(0, 10), status: 'experimental', publishable: false, textMin: TEXT_MIN,
  reciters: reciters.map((r) => ({ ...r, counts: Object.fromEntries(['candidate', 'blocked', 'failed', 'excluded', 'remaining'].map((st) => [st, count(r, st)])) })),
};
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
console.log('reciter'.padEnd(14), 'listed prod  dev | candidate blocked failed excluded remaining | boundaries flagged');
for (const r of summary.reciters) {
  const c = Object.values(r.surahs).filter((x) => x.boundaries);
  console.log(r.id.padEnd(14), String(r.listed).padStart(6), String(r.production).padStart(4), String(r.development).padStart(4), '|', String(r.counts.candidate).padStart(9), String(r.counts.blocked).padStart(7), String(r.counts.failed).padStart(6), String(r.counts.excluded).padStart(8), String(r.counts.remaining).padStart(9), '|', String(c.reduce((a, x) => a + x.boundaries, 0)).padStart(10), String(c.reduce((a, x) => a + x.flagged, 0)).padStart(7), r.noRecording ? `  (${r.noRecording.slice(0, 60)}…)` : '');
}
