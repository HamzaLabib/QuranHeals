// Applies the second audit (2026-10-17, after compile-results.mjs) to audit-results.json, and writes measured-timing.json.
//
//  1. MP3Quran timing, every boundary tested (audit-data/boundary-sweep-<date>.json) and Maher's cross-checked against a
//     second timing of the same performance (audit-data/maher-qf-crosscheck-<date>.json). A surah is withdrawn from
//     `timed` only where a wrong boundary is established:
//       - cross-check: the stated start is inside recitation and the other timing's start is in the pause;
//       - opening letters: the start of the ayah after a separate-letter ayah (الم، طه، يس، حم …) is "displaced"
//         (boundary-sweep-summary.mjs); those letters are always followed by a stop, so this cannot be wasl;
//       - block offset: 10 or more displaced boundaries in one surah (a whole stretch offset from its audio).
//     Any other boundary not in a pause is listed under `review` (with its class), not withdrawn: the sweep cannot tell
//     a stated time that is off from two ayahs joined in recitation. They need listening.
//  2. Measured timing (reciters.mjs `measure`): ayah timing for the MP3Quran file itself, from per-ayah files of the
//     same recording located in it (audit/align_everyayah.py output). A surah is accepted only if every ayah is found
//     whole and in order (thresholds in MEASURE); its boundaries are placed inside the measured pause.
//
// usage: node refine-results.mjs <align dir: <reciter id>/<surah>.json> [sweep date]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RECITERS } from './reciters.mjs';
import { timingFingerprint } from './fingerprint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [alignDir, date = '2026-10-17'] = process.argv.slice(2);
if (!alignDir) throw new Error('usage: node refine-results.mjs <align dir> [sweep date]');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const resultsFile = path.join(here, 'audit-results.json');
const results = readJson(resultsFile);
const sweep = readJson(path.join(here, 'audit-data', `boundary-sweep-${date}.json`)).reciters;
const crosscheck = readJson(path.join(here, 'audit-data', `maher-qf-crosscheck-${date}.json`));
const counts = readJson(path.join(here, 'audit-data', 'ayah-counts.json'));

/** Kufan separate-letter ayahs: the boundary after them is the start of ayah `next`. */
const OPENING_LETTERS = [2, 3, 7, 19, 20, 26, 28, 29, 30, 31, 32, 36, 40, 41, 42, 43, 44, 45, 46].map((s) => [s, 2]).concat([[42, 3]]);
const BLOCK_OFFSET = 10;

export const MEASURE = {
  /** Every located 3 s chunk of every ayah: two encodings of one recording score ~0.8-1, other audio below ~0.6. */
  minChunkScore: 0.7,
  /**
   * A chunk may sit this much off from where the previous one ends (pauses of slightly different length). Earlier by
   * more is accepted only where the clip has a pause there at least that long (the MP3Quran file's pause is shorter);
   * later by more (unknown extra audio in the MP3Quran file) never.
   */
  maxChunkJumpMs: 500,
  /** Between one ayah's last voiced sound and the next ayah's first, in the MP3Quran file. */
  maxPauseMs: 4000,
};

// 0. Reciters with no recording in the app (reciters.mjs `noRecording`): listed, with nothing to play.
for (const r of RECITERS.filter((x) => x.moshafId === null)) {
  if (results.reciters.some((x) => x.id === r.id)) continue;
  results.reciters.push({
    id: r.id, mp3quranReciterId: null, moshafId: null, moshafName: null, server: null, surahs: [],
    missingSurahs: Array.from({ length: 114 }, (_, i) => i + 1), timingRead: null, timingRejected: null,
    noRecording: r.noRecording, bytes: {}, timed: {}, excluded: {},
  });
}
results.reciters.sort((a, b) => RECITERS.findIndex((r) => r.id === a.id) - RECITERS.findIndex((r) => r.id === b.id));

// 1. MP3Quran timing.
const ccWrong = new Map();
for (const v of crosscheck.disagreements.filter((d) => d.verdict.startsWith('mp3quran wrong'))) {
  const [s, a] = v.boundary.split(':').map(Number);
  (ccWrong.get(s) ?? ccWrong.set(s, []).get(s)).push(`${s}:${a} starts inside recitation; a second timing of the same performance differs by ${Math.abs(v.disagreementS)} s and is in the pause`);
}
for (const entry of results.reciters) entry.timingSource = entry.timingRead !== null ? 'mp3quran' : null;

// 2. Measured timing.
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const measured = { generatedOn: date, method: 'audit/align_everyayah.py + refine-results.mjs', reciters: {} };
for (const r of RECITERS.filter((x) => x.measure)) {
  const entry = results.reciters.find((x) => x.id === r.id);
  entry.timingSource = 'measured';
  entry.timingRead = null;
  entry.timingRejected = r.timingRejected ?? null;
  entry.measure = { reference: r.measure.reference, rule: MEASURE };
  entry.timed = {};
  entry.excluded = {};
  entry.review = {};
  const surahs = {};
  for (let s = 1; s <= 114; s++) {
    const file = path.join(alignDir, r.id, `${s}.json`);
    const reasons = [];
    if (!entry.surahs.includes(s)) reasons.push('no audio file');
    if (!fs.existsSync(file)) reasons.push('not measured');
    if (reasons.length) { entry.excluded[s] = reasons; continue; }
    const m = readJson(file);
    const ay = m.ayahs;
    if (ay.length !== counts[s - 1]) reasons.push(`expected ${counts[s - 1]} ayahs, measured ${ay.length}`);
    let worst = 1;
    for (let k = 0; k < ay.length; k++) {
      const x = ay[k];
      const label = `${s}:${x.ayah}`;
      if (x.start_ms === null || !x.chunks.length || x.voiced_start_ms === null) { reasons.push(`${label} not found`); continue; }
      const min = Math.min(...x.chunks.map((c) => c[2]));
      worst = Math.min(worst, min);
      if (min < MEASURE.minChunkScore) reasons.push(`${label}: part of the ayah not found in the MP3Quran file (chunk score ${min})`);
      for (let c = 1; c < x.chunks.length; c++) {
        const jump = (x.chunks[c][1] - x.chunks[c - 1][1]) - (x.chunks[c][0] - x.chunks[c - 1][0]);
        if (Math.abs(jump) <= MEASURE.maxChunkJumpMs) continue;
        const from = x.chunks[c - 1][0], to = x.chunks[c][0] + 3000;
        const pause = jump < 0 && (x.quiet ?? []).some(([qa, qb]) => qb > from && qa < to && Math.min(qb, to) - Math.max(qa, from) >= -jump);
        if (!pause) { reasons.push(`${label}: the two files differ inside the ayah (${jump} ms)`); break; }
      }
      if (k > 0 && ay[k - 1].voiced_end_ms !== null) {
        const pause = x.voiced_start_ms - ay[k - 1].voiced_end_ms;
        if (pause < 0) reasons.push(`${label} overlaps the previous ayah (${pause} ms)`);
        else if (pause > MEASURE.maxPauseMs) reasons.push(`${label}: ${pause} ms between it and the previous ayah not accounted for`);
      }
    }
    const last = ay.at(-1);
    if (last?.end_ms > m.duration_ms + 500) reasons.push(`the last ayah ends after the file (${last.end_ms} > ${m.duration_ms})`);
    if (reasons.length) { entry.excluded[s] = reasons.length > 3 ? [...reasons.slice(0, 3), `… and ${reasons.length - 3} more`] : reasons; continue; }
    // Boundaries: each clip's own cut point, kept inside the measured pause between the two ayahs' voiced sound.
    const starts = ay.map((x, k) => (k === 0 ? clamp(x.start_ms, 0, x.voiced_start_ms) : clamp(x.start_ms, ay[k - 1].voiced_end_ms, x.voiced_start_ms)));
    const timing = ay.map((x, k) => [starts[k], k + 1 < ay.length ? starts[k + 1] : Math.min(m.duration_ms, Math.max(x.end_ms, x.voiced_end_ms))]);
    if (timing.some(([a, b]) => !(b > a))) { entry.excluded[s] = ['a measured ayah has no length']; continue; }
    surahs[s] = timing;
    entry.timed[s] = {
      fingerprint: timingFingerprint(timing.map(([startMs, endMs], k) => ({ ayah: k + 1, startMs, endMs }))),
      measured: `${ay.length} ayahs found whole and in order; lowest chunk score ${worst}`,
    };
  }
  measured.reciters[r.id] = { audio: entry.server, reference: r.measure.reference, surahs };
  console.log(`${r.id.padEnd(14)} measured: ${Object.keys(surahs).length} surahs accepted, ${Object.keys(entry.excluded).length} not`);
}

// 3. The boundary sweep, for both sources (measured timing is swept after its first refine: boundary-sweep-prep.mjs
//    reads measured-timing.json, so the order is refine, sweep, refine).
let withdrawn = 0;
for (const entry of results.reciters) {
  if (entry.timingSource === null) continue;
  const sw = sweep[entry.id];
  if (!sw) {
    if (entry.timingSource === 'mp3quran') throw new Error(`no boundary sweep for ${entry.id}`);
    console.warn(`${entry.id}: measured timing not swept yet (run the boundary sweep, then refine again)`);
    continue;
  }
  entry.review = {};
  for (const s of Object.keys(entry.timed).map(Number)) {
    const surah = sw.surahs[s];
    if (!surah) throw new Error(`no boundary sweep for ${entry.id} ${s}`);
    const reasons = [];
    if (entry.id === 'maher' && ccWrong.has(s)) reasons.push(...ccWrong.get(s));
    const displaced = surah.notInPause.filter((b) => b[4] === 'displaced');
    for (const [ls, next] of OPENING_LETTERS) {
      const b = ls === s && displaced.find((x) => x[0] === next);
      if (b) reasons.push(`${s}:${next} (after the opening letters) starts inside recitation; the nearest pause is ${b[5][0] > 0 ? b[5][0] : b[5][1]} ms away`);
    }
    if (displaced.length >= BLOCK_OFFSET) reasons.push(`${displaced.length} boundaries start inside recitation, each within 2 s of a pause: a block offset from the audio`);
    if (reasons.length) {
      entry.excluded[s] = [...(entry.excluded[s] ?? []), ...new Set(reasons)];
      delete entry.timed[s];
      if (entry.timingSource === 'measured') delete measured.reciters[entry.id].surahs[s];
      withdrawn++;
      continue;
    }
    entry.timed[s].boundaries = `${surah.inPause}/${surah.boundaries} in a pause`;
    if (surah.notInPause.length) entry.review[s] = surah.notInPause.map((b) => `${s}:${b[0]} ${b[4]}`);
  }
}

results.refinedOn = date;
fs.writeFileSync(resultsFile, JSON.stringify(results, null, 1) + '\n');
fs.writeFileSync(path.join(here, 'measured-timing.json'), JSON.stringify(measured) + '\n');
for (const e of results.reciters) console.log(`${e.id.padEnd(14)} ${String(e.timingSource).padEnd(9)} timed ${Object.keys(e.timed).length}`);
console.log(`${withdrawn} surahs withdrawn by the boundary sweep`);
