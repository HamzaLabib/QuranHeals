// DEVELOPMENT-ONLY measured timing for surahs whose MP3Quran timing was withdrawn or never usable, for reciters whose
// EveryAyah per-ayah set is cut from the app's own MP3Quran recording (probe 2026-10-18 on 103 and 112: chunk scores
// 0.83-0.97 for Minshawi, Husary, Shuraim, Shatri, Naina; Ajmi and Basfar are other recordings, 0.16-0.6).
//
// The same evidence as the production measured timing (refine-results.mjs, "Measured timing" in README.md), applied
// unchanged, then the same boundary sweep and the same withdrawal rules. The result goes ONLY to
// development/development-timing.json -> mobile/src/audio/generated/developmentTiming.ts, which the app loads in
// development builds only (__DEV__). audit-results.json and measured-timing.json (production) are never written.
// Promotion to production needs the owner's listening review of the review list and an explicit approval.
//
//   node development/supplement-measured.mjs accept <align dir: <id>/<surah>.json> [gap voicing dir] -> candidates.json, jobs.json
//     (2026-10-18 run: audit-data/gap-voicing-2026-10-18; husary-verified/ there holds the 11 production-verified controls)
//     gap voicing dir: <id>/<surah>.json from development/gap_voicing.py, for LONG_PAUSE reciters only
//   python -I -X utf8 audit/boundary_sweep.py development/jobs.json <sweep.jsonl> 16
//   node development/supplement-measured.mjs finalize <sweep.jsonl> [date]              -> development-timing.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classify } from '../audit/boundary-sweep-summary.mjs';
import { timingFingerprint } from '../fingerprint.mjs';
import { SUPPLEMENTS } from './supplements.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const results = readJson(path.join(tools, 'audit-results.json'));
const counts = readJson(path.join(tools, 'audit-data', 'ayah-counts.json'));

/** refine-results.mjs MEASURE, unchanged (kept identical by tests/developmentTiming.test.ts). */
export const MEASURE = { minChunkScore: 0.7, maxChunkJumpMs: 500, maxPauseMs: 4000 };
/**
 * Long pauses (Phase 4.1, owner-requested investigation of Husary's slow murattal; docs/audio/alignment-phase-4-1-2026-10-18.md).
 * For these reciters only, a pause longer than MEASURE.maxPauseMs is accounted for when the MP3Quran file holds no
 * recitation inside it (development/gap_voicing.py: at most maxVoicedMs of voiced sound) and it is at most maxPauseMs
 * long. Measured on Husary: real gaps held <= 800 ms of voiced sound, gaps spanning one whole ayah >= 3,600 ms; the
 * 4 s rule itself (MEASURE) is unchanged for every reciter and every other check still applies.
 */
export const LONG_PAUSE = { reciters: ['husary'], maxPauseMs: 10000, maxVoicedMs: 1000 };
/** refine-results.mjs: Kufan separate-letter ayahs (the boundary after them starts ayah `next`) and the block offset. */
const OPENING_LETTERS = [2, 3, 7, 19, 20, 26, 28, 29, 30, 31, 32, 36, 40, 41, 42, 43, 44, 45, 46].map((s) => [s, 2]).concat([[42, 3]]);
const BLOCK_OFFSET = 10;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/** refine-results.mjs step 2, for one surah: the timing if every ayah is found whole and in order, else the reasons. */
export function acceptMeasured(m, ayahCount, { reciterId, gapVoicing } = {}) {
  const reasons = [];
  const longPauses = [];
  const voicedIn = new Map((gapVoicing?.gaps ?? []).filter((g) => g.kind === 'gap').map((g) => [g.ayah, g.voicedMs]));
  const ay = m.ayahs;
  const s = m.surah;
  if (ay.length !== ayahCount) reasons.push(`expected ${ayahCount} ayahs, measured ${ay.length}`);
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
      const gap = x.voiced_start_ms - ay[k - 1].voiced_end_ms;
      if (gap < 0) reasons.push(`${label} overlaps the previous ayah (${gap} ms)`);
      else if (gap > MEASURE.maxPauseMs) {
        const voiced = voicedIn.get(x.ayah);
        if (LONG_PAUSE.reciters.includes(reciterId) && gap <= LONG_PAUSE.maxPauseMs && voiced !== undefined && voiced <= LONG_PAUSE.maxVoicedMs) longPauses.push(`${label}: ${gap} ms pause, ${voiced} ms voiced`);
        else reasons.push(`${label}: ${gap} ms between it and the previous ayah not accounted for${LONG_PAUSE.reciters.includes(reciterId) ? (voiced === undefined ? ' (no gap voicing measured)' : ` (${voiced} ms voiced inside)`) : ''}`);
      }
    }
  }
  const last = ay.at(-1);
  if (last?.end_ms > m.duration_ms + 500) reasons.push(`the last ayah ends after the file (${last.end_ms} > ${m.duration_ms})`);
  if (reasons.length) return { ok: false, reasons };
  const starts = ay.map((x, k) => (k === 0 ? clamp(x.start_ms, 0, x.voiced_start_ms) : clamp(x.start_ms, ay[k - 1].voiced_end_ms, x.voiced_start_ms)));
  const timing = ay.map((x, k) => [starts[k], k + 1 < ay.length ? starts[k + 1] : Math.min(m.duration_ms, Math.max(x.end_ms, x.voiced_end_ms))]);
  if (timing.some(([a, b]) => !(b > a))) return { ok: false, reasons: ['a measured ayah has no length'] };
  return { ok: true, timing, worst, longPauses };
}

const fingerprintOf = (timing) => timingFingerprint(timing.map(([startMs, endMs], k) => ({ ayah: k + 1, startMs, endMs })));
const candidatesFile = path.join(here, 'candidates.json');

async function headerOf(url) {
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const h = Buffer.from(await (await fetch(url, { headers: { Range: 'bytes=0-131071', 'User-Agent': 'QuranHeals-audit/1.0' } })).arrayBuffer());
  let p = 0;
  if (h.slice(0, 3).toString() === 'ID3') p = 10 + ((h[6] & 127) << 21 | (h[7] & 127) << 14 | (h[8] & 127) << 7 | (h[9] & 127));
  while (p < h.length - 1 && !(h[p] === 255 && (h[p + 1] & 224) === 224)) p++;
  return { first: p, kbps: ((h[p + 1] >> 3) & 3) === 3 ? BR1[(h[p + 2] >> 4) & 15] : BR2[(h[p + 2] >> 4) & 15] };
}

async function accept(alignDir, voicingDir) {
  const out = { generatedOn: new Date().toISOString().slice(0, 10), method: 'audit/align_everyayah.py + refine-results.mjs MEASURE rules', reciters: {} };
  const jobs = [];
  for (const sup of SUPPLEMENTS) {
    const entry = results.reciters.find((r) => r.id === sup.id);
    const rec = (out.reciters[sup.id] = { audio: entry.server, reference: sup.reference, accepted: {}, excluded: {} });
    for (const s of sup.surahs) {
      const why = [];
      if (entry.timed[s]) why.push('already has verified timing (production)');
      if (!entry.surahs.includes(s)) why.push('no audio file in the catalogue');
      const file = path.join(alignDir, sup.id, `${s}.json`);
      if (!fs.existsSync(file)) why.push('not measured');
      if (why.length) { rec.excluded[s] = why; continue; }
      const voicing = voicingDir && path.join(voicingDir, sup.id, `${s}.json`);
      const r = acceptMeasured(readJson(file), counts[s - 1], { reciterId: sup.id, gapVoicing: voicing && fs.existsSync(voicing) ? readJson(voicing) : undefined });
      if (!r.ok) { rec.excluded[s] = r.reasons.length > 3 ? [...r.reasons.slice(0, 3), `… and ${r.reasons.length - 3} more`] : r.reasons; continue; }
      rec.accepted[s] = { timing: r.timing, fingerprint: fingerprintOf(r.timing), lowestChunk: r.worst, bytes: entry.bytes[s], ...(r.longPauses.length ? { longPauses: r.longPauses } : {}) };
      const url = `${entry.server}${String(s).padStart(3, '0')}.mp3`;
      jobs.push({ id: sup.id, surah: s, url, ...(await headerOf(url)), size: entry.bytes[s], boundaries: r.timing.slice(1).map(([start], k) => [k + 2, start]) });
    }
    console.log(`${sup.id.padEnd(10)} accepted ${Object.keys(rec.accepted).length}, not ${Object.keys(rec.excluded).length}`);
  }
  fs.writeFileSync(candidatesFile, JSON.stringify(out) + '\n');
  fs.writeFileSync(path.join(here, 'jobs.json'), JSON.stringify(jobs));
  console.log(`jobs.json: ${jobs.length} surahs, ${jobs.reduce((a, j) => a + j.boundaries.length, 0)} boundaries`);
}

function finalize(sweepFile, date) {
  const cand = readJson(candidatesFile);
  const lines = fs.readFileSync(sweepFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  if (lines.some((l) => l.err)) throw new Error('some boundaries were not measured: re-run boundary_sweep.py (it resumes)');
  const byKey = new Map();
  for (const m of lines) (byKey.get(`${m.id}:${m.s}`) ?? byKey.set(`${m.id}:${m.s}`, []).get(`${m.id}:${m.s}`)).push(m);
  const out = { stage: 'development', generatedOn: date, method: cand.method, sweep: 'audit/boundary_sweep.py + boundary-sweep-summary.mjs classify()', reciters: {} };
  for (const [id, rec] of Object.entries(cand.reciters)) {
    const r = (out.reciters[id] = { audio: rec.audio, reference: rec.reference, surahs: {}, evidence: {}, review: {}, excluded: { ...rec.excluded } });
    for (const [s, a] of Object.entries(rec.accepted)) {
      const ms = byKey.get(`${id}:${s}`) ?? [];
      if (ms.length !== a.timing.length - 1) { r.excluded[s] = [`boundary sweep incomplete (${ms.length}/${a.timing.length - 1})`]; continue; }
      const classed = ms.map((m) => ({ a: m.a, c: classify(m), m }));
      const displaced = classed.filter((x) => x.c.kind === 'displaced');
      const reasons = [];
      for (const [ls, next] of OPENING_LETTERS) if (ls === Number(s) && displaced.some((x) => x.a === next)) reasons.push(`${s}:${next} (after the opening letters) starts inside recitation`);
      if (displaced.length >= BLOCK_OFFSET) reasons.push(`${displaced.length} boundaries start inside recitation: a block offset`);
      if (reasons.length) { r.excluded[s] = reasons; continue; }
      r.surahs[s] = a.timing;
      const inPause = classed.filter((x) => x.c.kind === 'pause').length;
      r.evidence[s] = { fingerprint: a.fingerprint, bytes: a.bytes, measured: `${a.timing.length} ayahs found whole and in order; lowest chunk score ${a.lowestChunk}`, boundaries: `${inPause}/${classed.length} in a pause`, ...(a.longPauses ? { longPauses: `${a.longPauses.length} pauses over ${MEASURE.maxPauseMs / 1000} s, each with no recitation inside (LONG_PAUSE)` } : {}) };
      const notInPause = classed.filter((x) => x.c.kind !== 'pause');
      if (notInPause.length) r.review[s] = notInPause.map((x) => `${s}:${x.a} ${x.c.kind}`);
    }
    console.log(`${id.padEnd(10)} development surahs ${Object.keys(r.surahs).length}; review boundaries ${Object.values(r.review).flat().length}; excluded ${Object.keys(r.excluded).length}`);
  }
  fs.writeFileSync(path.join(here, 'development-timing.json'), JSON.stringify(out) + '\n');
}

const [cmd, arg, date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (cmd === 'accept' && arg) await accept(arg, process.argv[4]);
  else if (cmd === 'finalize' && arg) finalize(arg, date);
  else throw new Error('usage: node development/supplement-measured.mjs accept <align dir> | finalize <sweep.jsonl> [date]');
}
