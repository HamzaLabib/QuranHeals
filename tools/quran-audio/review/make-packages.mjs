// Listening-review packages for review/review.html (Phase 4.1). One JSON file per surah, with everything the reviewer
// shows: the reciter and surah names, the canonical Arabic text of every ayah (verbatim, from the tracked runtime
// source tools/quran-verification/input/quran-uthmani.txt), the proposed start and end of every ayah, each boundary's
// automatic checks, and the WORKLIST (the boundaries a person must decide before the surah can be approved).
// Packages contain no audio: the page streams the catalogue's MP3Quran file.
//
//   aligned      candidate timing from alignment/run-batch.mjs (<id>/<surah>.flags.json): experimental, plays nowhere.
//                Worklist: every flagged boundary, the first, the last, and a seeded 10 % sample of the rest.
//   development  DEVELOPMENT-ONLY measured timing (development/development-timing.json) with the Phase 4.1
//                re-validation (audit-data/development-revalidation-<date>.json). Worklist: every priority 1 and 2
//                boundary, the first, the last, and a seeded 10 % sample of the rest.
// index.json lists every package by review priority (highest risk first) for the reviewer's queue.
//
// usage: node review/make-packages.mjs <out dir> [--aligned <run-batch out dir>] [--development <revalidation.json>] [--phase <label>]
//          [--voice <surah-sources voice.json> [--min-voice 0.7]]  (a suspected other voice: very high risk on one start)
//   --phase (Phase 4.8): written into index.json, so the review dashboard (review/dashboard) labels the packages. A
//   folder written under the dashboard's scan roots (Working progress/Screenshots and Logs) appears there on Refresh queue.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RECITERS } from '../reciters.mjs';
import { OPENING_RULE } from './manual/opening.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const repo = path.join(tools, '..', '..');
const args = process.argv.slice(2);
const out = args[0];
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
if (!out || (!opt('--aligned') && !opt('--development'))) throw new Error('usage: node review/make-packages.mjs <out dir> [--aligned <dir>] [--development <revalidation.json>]');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const audit = readJson(path.join(tools, 'audit-results.json'));
const formats = readJson(path.join(tools, 'audit-data', 'recording-formats-2026-10-17.json')).recordings;
// Phase 4.3: VBR files with a validated seekable copy (audit-data/vbr-recovery-<date>.json, the latest).
const recoveryFile = fs.readdirSync(path.join(tools, 'audit-data')).filter((f) => /^vbr-recovery-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().at(-1);
const vbrRecovery = recoveryFile ? readJson(path.join(tools, 'audit-data', recoveryFile)) : { recordings: {} };
/** A lossless MLLT copy that keeps every audio byte and seeks (real media3 extractor) within one frame, as production CBR. */
function recoveredVbr(id, s) {
  const r = vbrRecovery.recordings[`${id}:${s}`];
  const [lo, hi] = vbrRecovery.baselineProductionCbrMs ?? [0, 26.1];
  return r && r.mllt.audioFramesIdentical && r.mllt.decodedPcmIdentical && r.mllt.xingLameFrameKept && r.mllt.seek.errorRangeMs[0] >= lo - 1 && r.mllt.seek.errorRangeMs[1] <= hi + 1 ? r : null;
}
const TEXT = path.join(repo, 'tools', 'quran-verification', 'input', 'quran-uthmani.txt');
const META = path.join(repo, 'tools', 'quran-verification', 'input', 'quran-data.xml');

const text = new Map();
for (const line of fs.readFileSync(TEXT, 'utf8').split(/\r?\n/)) {
  const p = line.split('|');
  if (p.length === 3 && /^\d+$/.test(p[0])) text.set(`${p[0]}:${p[1]}`, p[2]);
}
const surahName = new Map([...fs.readFileSync(META, 'utf8').matchAll(/<sura index="(\d+)" ayas="(\d+)"[^>]* name="([^"]+)" tname="([^"]+)"/g)].map((m) => [Number(m[1]), { ar: m[3], en: m[4], ayahs: Number(m[2]) }]));
const BASMALA = text.get('1:1');
if (!BASMALA) throw new Error(`${TEXT}: no 1:1`);

function seededSample(list, fraction, seed) {
  let x = seed || 1;
  const rand = () => (x = (x * 16807) % 2147483647) / 2147483647;
  return list.filter(() => rand() < fraction);
}

function base(id, s, kind, flags = null) {
  const reciter = RECITERS.find((r) => r.id === id);
  const entry = audit.reciters.find((r) => r.id === id);
  const file = formats[id]?.files?.[s];
  const name = surahName.get(s);
  // A file from another source (alignment/run-batch.mjs --source): a reciter with no MP3Quran recording, or a surah its
  // MP3Quran recording cannot play. The recording is the one the flags file names (surah-sources/select.mjs: URL, size,
  // SHA-256, format, why that source).
  const own = flags?.source && (!entry?.server || flags.source !== 'mp3quran') ? flags : null;
  return {
    kind: 'ayah-timing-review-package', version: 1, source: kind, createdOn: new Date().toISOString().slice(0, 10),
    reciterId: id, reciterEn: reciter.nameEn, reciterAr: reciter.nameAr, recording: own ? `${own.source} (${own.format.kbps} kbps ${own.format.mode.toUpperCase()}): ${own.sourceWhy}` : entry.moshafName,
    surah: s, surahAr: name.ar, surahEn: name.en, ayahCount: name.ayahs,
    url: own ? own.url : `${entry.server}${String(s).padStart(3, '0')}.mp3`, bytes: own ? own.bytes : entry.bytes[s],
    format: own ? { kbps: own.format.kbps, mode: own.format.mode, durationMs: own.format.durationMs } : file ? { kbps: file.kbps, mode: file.bitrateMode, durationMs: file.durationMs } : null,
    ...(own ? { experiment: { phase: opt('--phase') ?? 'ahmed-salama', source: own.source, sha256: own.sha256, rightsStatus: 'not cleared: no source grants use in an app (surah-sources/sources.mjs)' } } : {}),
    textSource: 'tools/quran-verification/input/quran-uthmani.txt (Tanzil Uthmani 1.1, the app\'s runtime text), verbatim',
  };
}

/**
 * The text of each ayah. Tanzil writes the Basmala at the head of ayah 1 of every surah but 1 and 9; it is shown on its
 * own line above ayah 1 (basmala), and ayah 1 without it. No character of either is changed.
 */
function ayahRows(s, entries) {
  const words = BASMALA.split(' ').length;
  let basmala = null;
  const rows = entries.map(([ayah, startMs, endMs]) => {
    let t = text.get(`${s}:${ayah}`);
    if (ayah === 1 && s !== 1 && s !== 9 && t.split(' ').slice(0, words).join(' ') === BASMALA) {
      basmala = BASMALA;
      t = t.split(' ').slice(words).join(' ');
    }
    return { ayah, startMs, endMs, text: t };
  });
  return { basmala, rows };
}
const packages = [];

function write(pkg) {
  // Phase 4.8.8 (opening rule): ayah 1 plays from 0 ms; the aligned/measured first timestamp is its onset (highlighting).
  // review/dashboard refuses a package whose declared opening says otherwise.
  if (!(pkg.ayahs?.[0]?.startMs >= 0)) throw new Error(`${pkg.reciterId} ${pkg.surah}: ayah 1 has no first timestamp`);
  pkg.opening = { rule: OPENING_RULE.id, startMs: OPENING_RULE.startMs, onsetMs: pkg.ayahs[0].startMs };
  const dir = path.join(out, pkg.source, pkg.reciterId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${pkg.surah}.json`);
  fs.writeFileSync(file, JSON.stringify(pkg));
  const p1 = pkg.boundaries.filter((b) => b.priority === 1).length;
  const p2 = pkg.boundaries.filter((b) => b.priority === 2).length;
  packages.push({ file: path.relative(out, file).replaceAll('\\', '/'), source: pkg.source, reciterId: pkg.reciterId, reciterEn: pkg.reciterEn, surah: pkg.surah, surahEn: pkg.surahEn, boundaries: pkg.boundaries.length, worklist: pkg.worklist.length, priority1: p1, priority2: p2, blocked: pkg.blocked ?? null, fingerprint: pkg.candidateFingerprint });
}

// Aligned candidates.
const voice = opt('--voice') ? readJson(opt('--voice')) : null;
/** Below this speaker similarity to the rest of the recording a surah is a suspected other voice (Ahmed Salama: 0.70). */
const MIN_VOICE = Number(opt('--min-voice') ?? 0.7);
const P1_FLAGS = new Set(['configs-disagree', 'no-pause', 'competing-pause', 'shallow-pause', 'extra-audio', 'anchored', 'reordered', 'past-own-end']);
if (opt('--aligned')) {
  const dir = opt('--aligned');
  for (const id of fs.readdirSync(dir).filter((d) => !d.startsWith('_') && fs.statSync(path.join(dir, d)).isDirectory())) {
    const completeness = fs.existsSync(path.join(dir, id, 'completeness.json')) ? readJson(path.join(dir, id, 'completeness.json')) : {};
    for (const f of fs.readdirSync(path.join(dir, id)).filter((x) => x.endsWith('.flags.json'))) {
      const flags = readJson(path.join(dir, id, f));
      if (!flags.url || !flags.checks) continue; // only flag files from the Phase 4.1 checks
      const s = flags.surah;
      const pkg = base(id, s, 'aligned', flags);
      if (pkg.url !== flags.url || pkg.bytes !== flags.bytes) throw new Error(`${id} ${s}: flags file is of another recording`);
      const boundaries = flags.boundaries.map((b) => ({
        ayah: b.ayah, ms: b.chosen_ms, flags: b.flags, acoustic: b.acoustic, pauseMs: b.pause_ms, alignedOnsetMs: b.aligned_onset_ms,
        // Placed by the boundary rule (reordered / past-own-end): where pause snapping had put it.
        ...(b.moved_from_ms !== undefined ? { repairedFromMs: b.moved_from_ms } : {}),
        priority: b.flags.some((x) => P1_FLAGS.has(x)) ? 1 : b.flags.length ? 2 : 3,
      }));
      const rest = boundaries.filter((b) => b.priority === 3);
      const must = new Set([...boundaries.filter((b) => b.priority < 3).map((b) => b.ayah), boundaries[0]?.ayah, boundaries.at(-1)?.ayah].filter(Boolean));
      for (const b of seededSample(rest, 0.1, s * 7919)) must.add(b.ayah);
      const c = completeness[String(s)] ?? null;
      const blocked = [];
      if (!flags.structure.ok) blocked.push(`structure failed: ${flags.structure.problems.join('; ')}`);
      const recovered = pkg.format?.mode === 'vbr' ? recoveredVbr(id, s) : null;
      const playbackBlocked = [];
      if (pkg.format?.mode === 'vbr' && !recovered) blocked.push('VBR file: the app cannot seek it to an ayah precisely (0.5-1.8 s); timing would not be usable for ayah playback');
      if (recovered) {
        // The timing (and this review) is on the original's decoded timeline, which the lossless copy keeps exactly.
        playbackBlocked.push(`the app streams MP3Quran's original, which it cannot seek to an ayah (media3: ${recovered.originalSeek.errorRangeMs[0]} to +${recovered.originalSeek.errorRangeMs[1]} ms); a seekable copy (local, validated: ${recoveryFile}) must be hosted, which needs permission to redistribute a modified file`);
        pkg.recovery = { evidence: `tools/quran-audio/audit-data/${recoveryFile}`, mllt: recovered.mllt, cbr: recovered.cbr, originalSeek: recovered.originalSeek };
      }
      if (playbackBlocked.length) pkg.playbackBlocked = playbackBlocked;
      if (c && c.median_score < 0.3) blocked.push(`text not confirmed: median character score ${c.median_score} (wrong-text controls 0.17-0.18, complete files 0.46-0.58)`);
      const openingOnly = c && c.collapsed === 1 && c.collapsed_runs[0] === '1';
      if (c && c.collapsed > 0 && !openingOnly) blocked.push(`completeness: ${c.collapsed} ayahs look absent (${c.collapsed_runs.join(', ')})`);
      if (openingOnly && boundaries[0]) { boundaries[0].flags.push('opening-squeezed'); boundaries[0].priority = 1; must.add(boundaries[0].ayah); }
      // --voice <voice.json> (surah-sources/voice.py): a surah whose voice is far from the rest of the recording's is a
      // suspected other reciter: its first start after the opening carries it (very high risk, review/manual/very-high.mjs).
      const v = voice?.surahs?.[String(s)];
      if (v && v.toCentroid < MIN_VOICE && boundaries[0]) {
        boundaries[0].flags.push('identity-sample');
        boundaries[0].priority = 1;
        boundaries[0].identity = `speaker similarity ${v.toCentroid} to the recording's other surahs (median ${voice.summary.median}; another reciter scores ${voice.summary.controlsMax} or less)`;
        must.add(boundaries[0].ayah);
      }
      Object.assign(pkg, {
        status: 'experimental candidate (plays nowhere)',
        candidateFingerprint: flags.candidate.fingerprint, checks: flags.checks, structure: flags.structure,
        completeness: c, durationMs: flags.duration_ms, intro: flags.candidate.entries[0]?.[0] === 0 ? flags.candidate.entries[0].slice(1) : null,
        ...(({ basmala, rows }) => ({ basmala, ayahs: rows }))(ayahRows(s, flags.candidate.entries.filter(([a]) => a > 0))),
        boundaries, worklist: [...must].sort((a, b) => a - b),
        worklistRule: 'every flagged boundary, the first, the last, and a 10 % sample of the rest (seeded by the surah)',
        ...(blocked.length ? { blocked } : {}),
      });
      write(pkg);
    }
  }
}

// Development (measured) timing with the re-validation.
if (opt('--development')) {
  const reval = readJson(opt('--development'));
  const dev = readJson(path.join(tools, 'development', 'development-timing.json'));
  for (const [id, surahs] of Object.entries(reval.reciters)) {
    for (const [sKey, r] of Object.entries(surahs)) {
      const s = Number(sKey);
      const timing = dev.reciters[id].surahs[sKey];
      if (dev.reciters[id].evidence[sKey].fingerprint !== r.fingerprint) throw new Error(`${id} ${s}: the re-validation is of other timing`);
      const pkg = base(id, s, 'development');
      const boundaries = r.boundaries.map((b) => ({ ayah: b.ayah, ms: b.ms, flags: [...(b.sweep !== 'pause' ? [`sweep-${b.sweep}`] : []), ...(b.mp3quran === 'differs' ? ['mp3quran-differs'] : [])], acoustic: b.acoustic, sweep: b.sweep, mp3quran: b.mp3quran, priority: b.priority }));
      const rest = boundaries.filter((b) => b.priority === 3);
      const must = new Set([...boundaries.filter((b) => b.priority < 3).map((b) => b.ayah), boundaries[0]?.ayah, boundaries.at(-1)?.ayah].filter(Boolean));
      for (const b of seededSample(rest, 0.1, s * 7919)) must.add(b.ayah);
      Object.assign(pkg, {
        status: 'DEVELOPMENT ONLY (measured; plays in development builds, never in a release)',
        candidateFingerprint: r.fingerprint, evidence: dev.reciters[id].evidence[sKey],
        ...(({ basmala, rows }) => ({ basmala, ayahs: rows }))(ayahRows(s, timing.map(([a, b], k) => [k + 1, a, b]))),
        boundaries, worklist: [...must].sort((a, b) => a - b),
        worklistRule: 'every priority 1 and 2 boundary, the first, the last, and a 10 % sample of the rest (seeded by the surah)',
      });
      write(pkg);
    }
  }
}

// Queue: development first (it already plays in development builds), then candidates that are not blocked; within
// each, the highest share of priority-1 boundaries first.
const rank = (p) => (p.source === 'development' ? 0 : p.blocked ? 2 : 1);
packages.sort((a, b) => rank(a) - rank(b) || b.priority1 / Math.max(1, b.boundaries) - a.priority1 / Math.max(1, a.boundaries) || b.priority2 - a.priority2 || a.reciterId.localeCompare(b.reciterId) || a.surah - b.surah);
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ kind: 'ayah-timing-review-index', createdOn: new Date().toISOString().slice(0, 10), ...(opt('--phase') ? { phase: opt('--phase') } : {}), packages }, null, 1));
console.log(`${packages.length} packages → ${out}`);
