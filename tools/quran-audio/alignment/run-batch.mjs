// Candidate ayah timing for whole-surah recordings with no per-ayah reference: for each reciter and surah, downloads the
// catalogue's MP3Quran file (only surahs MP3Quran lists for that recording, at their audited size), aligns it to the
// canonical text twice (no-star primary, star comparison), then flag_boundaries.py (structure, two-configuration
// comparison, ambiguity flags, candidate timing + fingerprint, listening worklist) and completeness.py.
//
// Output is EXPERIMENTAL and stays outside the repository (out dir): nothing here is read by generate-catalog.mjs. A
// candidate reaches the app only after the listening review (review/review.html) and development/apply-review.mjs.
//
// Long runs: every step is skipped when its output exists, and each finished surah is appended to <out>/progress.jsonl,
// so a stopped run resumes where it was. One failing surah (download, alignment, out of GPU memory) is recorded and the
// run goes on. The next file downloads while the current one aligns (one at a time: bounded disk and network).
// Audio stays in <out>/_audio (outside the repository); --delete-audio removes each file once its surah is finished.
//
// usage: node alignment/run-batch.mjs <gpu python> <out dir> <reciterId:s,s,s> [<reciterId:s,...> ...] [--delete-audio]
//        node alignment/run-batch.mjs <gpu python> <out dir> --source <surah-cache/<id>/selected.json> [s,s,...]
//   --source: a reciter with no MP3Quran recording (surah-sources/select.mjs); its cached files are never deleted.
//   --no-basmala (any mode): no Basmala segment before ayah 1 (recordings that do not recite it aloud).
//        node alignment/run-batch.mjs <gpu python> <out dir> --untimed [reciterId,...] [--delete-audio]
//   --untimed: every surah MP3Quran lists for the reciter with neither production nor development timing (all
//   reciters with a recording when no list is given; reciters with no permitted recording are never processed).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const repo = path.join(tools, '..', '..');
const argv = process.argv.slice(2);
const deleteAudio = argv.includes('--delete-audio');
// --no-basmala: align_mms.py without its Basmala segment before ayah 1, for recordings that do not recite it aloud
// (Haram prayer recordings: Phase 4.7 found the forced segment absorbing up to 3.2 s of ayah 1). Off by default.
const noBasmala = argv.includes('--no-basmala');
const [python, out, ...specArgs] = argv.filter((a) => a !== '--delete-audio' && a !== '--no-basmala');
if (!python || !out || specArgs.length === 0) throw new Error('usage: node alignment/run-batch.mjs <gpu python> <out dir> (<reciterId:s,s,...> ... | --untimed [ids])');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const results = readJson(path.join(tools, 'audit-results.json'));
const development = readJson(path.join(tools, 'development', 'development-timing.json'));
const quran = path.join(repo, 'backend', 'data', 'quran', 'quran-uthmani.txt');
// Recordings already shown unusable (alignment-phase-4-1 doc): not processed again without new evidence.
const exclusions = readJson(path.join(here, 'batch-exclusions.json')).reciters;
const UA = { 'User-Agent': 'QuranHeals-audit/1.0' };
const ALIGN_TIMEOUT_MS = 45 * 60 * 1000;
const LONG_MS = 50 * 60 * 1000;
/** Files above this size (~1 h at 128 kbps) go last, so a run covers the most surahs per hour first. */
const LATE_BYTES = 60e6;

/** The work list: [{ id, surahs }]. */
function plan() {
  if (specArgs[0] !== '--untimed') return specArgs.map((spec) => ({ id: spec.split(':')[0], surahs: spec.split(':')[1].split(',').map(Number) }));
  const only = specArgs[1]?.split(',');
  return results.reciters
    .filter((r) => r.server && (!only || only.includes(r.id)))
    .map((r) => ({ id: r.id, surahs: r.surahs.filter((s) => !r.timed[s] && !development.reciters[r.id]?.surahs?.[s]) }))
    .filter((p) => p.surahs.length)
    .sort((a, b) => (only ? only.indexOf(a.id) - only.indexOf(b.id) : 0));
}

async function download(url, file, bytes) {
  if (fs.existsSync(file) && fs.statSync(file).size === bytes) return;
  for (let attempt = 0; ; attempt++) {
    try {
      // No redirect followed: an unlisted surah is answered with another reciter's file.
      const response = await fetch(url, { headers: UA, redirect: 'manual' });
      if (response.status !== 200) throw new Error(`${url}: HTTP ${response.status}`);
      fs.writeFileSync(`${file}.part`, Buffer.from(await response.arrayBuffer()));
      if (fs.statSync(`${file}.part`).size !== bytes) throw new Error(`${url}: ${fs.statSync(`${file}.part`).size} bytes, audited ${bytes}`);
      fs.renameSync(`${file}.part`, file);
      return;
    } catch (error) {
      if (attempt >= 3 || /HTTP 3|audited/.test(String(error))) throw error;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
}

const progressFile = path.join(out, 'progress.jsonl');
fs.mkdirSync(path.join(out, '_audio'), { recursive: true });
const finished = new Set(fs.existsSync(progressFile) ? fs.readFileSync(progressFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.flags || r.skipped).map((r) => `${r.id}:${r.s}`) : []);
const record = (row) => { fs.appendFileSync(progressFile, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n'); console.log(JSON.stringify(row)); };

const jobs = [];
// --source <selected.json> [surahs]: a reciter with no MP3Quran recording, from the files chosen by
// surah-sources/select.mjs (already cached, size-checked; never deleted here). Same alignment and checks as below.
const sourceMode = specArgs[0] === '--source';
if (sourceMode) {
  const sel = readJson(specArgs[1]);
  const only = specArgs[2] ? new Set(specArgs[2].split(',').map(Number)) : null;
  for (const [sStr, x] of Object.entries(sel.surahs)) {
    const s = Number(sStr);
    if ((only && !only.has(s)) || finished.has(`${sel.recording}:${s}`)) continue;
    if (exclusions[sel.recording]?.[s]) { record({ id: sel.recording, s, skipped: exclusions[sel.recording][s] }); continue; }
    jobs.push({ id: sel.recording, s, url: x.url, bytes: x.bytes, audio: x.file, dir: path.join(out, sel.recording), keepAudio: true,
      extra: { source: x.source, sha256: x.sha256, format: { kbps: x.format.kbps, mode: x.format.mode, durationMs: x.format.durationMs, sampleRateHz: x.format.sampleRateHz }, sourceWhy: x.why } });
  }
}
for (const { id, surahs } of sourceMode ? [] : plan()) {
  const entry = results.reciters.find((r) => r.id === id);
  if (!entry?.server) { record({ id, skipped: 'no permitted MP3Quran recording in the catalogue' }); continue; }
  for (const s of surahs) {
    if (finished.has(`${id}:${s}`)) continue;
    if (!entry.surahs.includes(s)) { record({ id, s, skipped: 'not listed by MP3Quran for this recording' }); continue; }
    if (entry.timed[s]) { record({ id, s, skipped: 'already has verified timing' }); continue; }
    if (exclusions[id]?.[s]) { record({ id, s, skipped: exclusions[id][s] }); continue; }
    const url = `${entry.server}${String(s).padStart(3, '0')}.mp3`;
    jobs.push({ id, s, url, bytes: entry.bytes[s], audio: path.join(out, '_audio', `${id}_${s}.mp3`), dir: path.join(out, id) });
  }
}
// Within the requested reciter order: every shorter file first, then the long ones.
jobs.sort((x, y) => (x.bytes > LATE_BYTES) - (y.bytes > LATE_BYTES));
console.log(`${jobs.length} surahs to process (${finished.size} already finished)`);

const fetched = new Map();
const fetchJob = (k) => {
  if (k >= jobs.length || fetched.has(k)) return;
  const j = jobs[k];
  const p = download(j.url, j.audio, j.bytes);
  p.catch(() => {});
  fetched.set(k, p);
};
fetchJob(0);
for (let k = 0; k < jobs.length; k++) {
  const j = jobs[k];
  fetchJob(k + 1); // the next file downloads while this one aligns
  fs.mkdirSync(j.dir, { recursive: true });
  const t0 = Date.now();
  try {
    await fetched.get(k);
    fetched.delete(k);
    const a = path.join(j.dir, `${j.s}.nostar.json`);
    const b = path.join(j.dir, `${j.s}.star.json`);
    const align = (file, extra) => run(python, ['-X', 'utf8', path.join(here, 'align_mms.py'), quran, String(j.s), j.audio, file, ...extra, ...(noBasmala ? ['--no-basmala'] : [])], { timeout: ALIGN_TIMEOUT_MS, maxBuffer: 1 << 24 });
    // Both configurations from one set of emissions in one process (align_mms.py --both; long files: windowed star run).
    if (!fs.existsSync(a) && !fs.existsSync(b)) await align(a, ['--no-star-between', '--both', b]);
    if (!fs.existsSync(a)) await align(a, ['--no-star-between']);
    if (!fs.existsSync(b)) {
      // Long surahs: the comparison run in windows cut between the primary run's ayahs (one whole alignment of 2 h
      // of audio does not fit the GPU with star tokens); the boundaries at the cuts are flagged 'anchored'.
      const long = readJson(a).duration_ms > LONG_MS;
      try { await align(b, long ? ['--anchors', a] : []); } catch (error) { if (long) throw error; await align(b, ['--anchors', a]); }
    }
    const flags = path.join(j.dir, `${j.s}.flags.json`);
    // The checks use ../pylib (miniaudio, numpy) with the system Python, never the GPU environment.
    await run('python', ['-I', '-X', 'utf8', path.join(here, 'flag_boundaries.py'), j.audio, a, b, flags], { maxBuffer: 1 << 24 });
    const f = readJson(flags);
    // What review/review.html and development/apply-review.mjs need to find and check the audio.
    Object.assign(f, { reciterId: j.id, surah: j.s, url: j.url, bytes: j.bytes, ...(j.extra ?? {}) });
    fs.writeFileSync(flags, JSON.stringify(f, null, 1));
    record({ id: j.id, s: j.s, flags: path.relative(out, flags), structure: f.structure.ok, flagged: f.flags.flagged, boundaries: f.flags.boundaries, fingerprint: f.candidate.fingerprint, seconds: Math.round((Date.now() - t0) / 1000) });
    if (deleteAudio && !j.keepAudio) fs.rmSync(j.audio, { force: true });
  } catch (error) {
    const message = String(error.stderr || error.message || error).split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400);
    record({ id: j.id, s: j.s, error: message, seconds: Math.round((Date.now() - t0) / 1000) });
  }
}

// Completeness evidence per reciter (star configuration: it absorbs extra audio best). Each reciter on its own.
for (const id of new Set(jobs.map((j) => j.id))) {
  try {
    const dir = path.join(out, id);
    const starDir = path.join(dir, '_star');
    fs.mkdirSync(starDir, { recursive: true });
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.star.json'))) fs.copyFileSync(path.join(dir, f), path.join(starDir, f.replace('.star', '')));
    await run('python', ['-I', path.join(here, 'completeness.py'), quran, starDir, path.join(dir, 'completeness.json')], { maxBuffer: 1 << 24 });
  } catch (error) {
    record({ id, completenessError: String(error.message).slice(0, 300) });
  }
}
console.log(`finished; progress in ${progressFile}`);
