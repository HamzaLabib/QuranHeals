// Risk classification of a per-ayah recording (one file per ayah), from the automated evidence:
//   everyayah-fetch.mjs  fetch-manifest.json, listing.json, 000_checksum.md5   what the host served, sizes, checksums
//   scan.py              scan.json                                           MP3 structure, tags, levels, silences
//   verify_text.py       text-verification.json                              CTC text scores against the expected
//                                                                            ayah, its neighbours and a far control
// Every ayah (and every surah's Basmala file) is LOW risk only when every check passes clearly; anything missing,
// damaged, unusual, contradictory or merely uncertain is HIGH risk, with each reason. LOW risk is not a verification:
// it means no automated check found a reason to listen. Nothing here approves, rejects or changes anything.
//
// Thresholds are calibrated on the recording itself (printed in the report): the text thresholds sit above the
// wrong-text controls (each ayah's audio scored against a far ayah of similar length), the duration rule uses a robust
// fit of voiced length against the text's letters, and the silence and edge rules flag only the extremes.
//
// usage: node tools/quran-audio/per-ayah/classify.mjs --recording gebril [--cache <dir>] [--out <risk.json>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PER_AYAH_RECORDINGS } from './recordings.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..', '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
const recording = PER_AYAH_RECORDINGS.find((r) => r.id === (args.recording ?? 'gebril'));
if (!recording) throw new Error(`unknown recording ${args.recording}`);
const cache = args.cache ?? path.join(process.env.LOCALAPPDATA ?? '.', 'QuranHeals', 'per-ayah-cache', recording.folder);
const today = new Date().toISOString().slice(0, 10);
const out = args.out ?? path.join(REPO, 'tools', 'quran-audio', 'audit-data', `${recording.id}-per-ayah-risk-${today}.json`);
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8'));

// ---------------------------------------------------------------- the canonical text (the app's runtime text)
const text = new Map();
for (const line of fs.readFileSync(path.join(REPO, 'tools', 'quran-verification', 'input', 'quran-uthmani.txt'), 'utf8').split(/\r?\n/)) {
  const p = line.split('|');
  if (p.length === 3 && /^\d+$/.test(p[0])) text.set(`${p[0]}:${p[1]}`, p[2]);
}
const COUNTS = Array.from({ length: 114 }, (_, i) => [...text.keys()].filter((k) => k.startsWith(`${i + 1}:`)).length);
const BASMALA = text.get('1:1');
const LETTER = /[ء-يٱ]/g;
const letters = (s) => (s.match(LETTER) ?? []).length;
// Ayah 1 without its Basmala (recited from its own file). Compared by letters only: in this text 95:1 and 97:1 spell it
// «بِّسْمِ» (with a shadda), like align_mms.py's comparison.
const bare = (w) => (w.match(LETTER) ?? []).join('');
const BASMALA_WORDS = BASMALA.split(' ').map(bare).join(' ');
const ayahText = (s, a) => {
  const t = text.get(`${s}:${a}`);
  if (a !== 1 || s === 1 || s === 9) return t;
  const ws = t.split(' ');
  return ws.slice(0, 4).map(bare).join(' ') === BASMALA_WORDS ? ws.slice(4).join(' ') : t;
};
// Ayahs that are separate opening letters only (الم، حم، ص، ق، ن …): recited as letter names, much longer than their letters.
const OPENING_LETTERS = new Set(['2:1', '3:1', '7:1', '10:1', '11:1', '12:1', '13:1', '14:1', '15:1', '19:1', '20:1', '26:1', '27:1', '28:1', '29:1', '30:1', '31:1', '32:1', '36:1', '38:1', '40:1', '41:1', '42:1', '42:2', '43:1', '44:1', '45:1', '46:1', '50:1', '68:1']);

// ---------------------------------------------------------------- inputs
const manifest = readJson('fetch-manifest.json');
const listing = readJson('listing.json');
const scan = readJson('scan.json').files;
const verify = readJson('text-verification.json').files;
const listed = new Set(listing.map((r) => r.name));
const strays = listing.filter((r) => r.bytes >= 0 && /\.mp3$/i.test(r.name) && !/^\d{6}\.mp3$/.test(r.name)).map((r) => r.name);
const subfolders = listing.filter((r) => r.bytes < 0).map((r) => r.name);
// Identity (optional, --identity <dir>): ../audit/align_everyayah.py run against the recording's full-surah reference
// (recordings.mjs `reference`, e.g. MP3Quran's Hafs file of the same reciter). An ayah is LOCATED when every 3 s chunk of
// its file is found, in order, in the reference surah (chunk score >= 0.45): the same performance. In a checked surah,
// an ayah not located is another performance (or not this reciter): its identity and riwaya are not confirmed.
const MIN_CHUNK = 0.45;
const identity = new Map(); // `${s}:${a}` -> { located, why }
const identityChecked = [];
if (args.identity) {
  for (const f of fs.readdirSync(args.identity).filter((x) => /^\d+\.json$/.test(x))) {
    const j = JSON.parse(fs.readFileSync(path.join(args.identity, f), 'utf8'));
    identityChecked.push(j.surah);
    let last = -1;
    for (const a of j.ayahs) {
      const chunks = a.chunks ?? [];
      const inOrder = a.start_ms != null && a.start_ms >= last;
      const located = chunks.length > 0 && chunks.every((c) => c[2] >= MIN_CHUNK) && inOrder;
      if (a.start_ms != null) last = a.start_ms;
      identity.set(`${j.surah}:${a.ayah}`, located
        ? { located: true, why: `located in ${recording.reference.provider}'s ${recording.reference.label} file at ${(a.start_ms / 1000).toFixed(1)} s (${chunks.length} chunks, min ${Math.min(...chunks.map((c) => c[2])).toFixed(2)})` }
        : { located: false, why: chunks.length ? `only partly found in ${recording.reference.provider}'s ${recording.reference.label} recording of this surah (weakest 3 s chunk ${Math.min(...chunks.map((c) => c[2])).toFixed(2)}${inOrder ? '' : ', out of order'})` : `not found in ${recording.reference.provider}'s ${recording.reference.label} recording of this surah` });
    }
  }
  identityChecked.sort((x, y) => x - y);
}
// A surah most of whose ayahs are not in the reference is ANOTHER PERFORMANCE of the whole surah (not a set of broken
// files): one question, "is this surah this reciter?". Its first ayah carries it as Very High (listen to confirm the
// voice); its other ayahs carry the finding as High. Isolated ayahs not found in an otherwise matching surah stay Very
// High one by one (a patched or replaced file).
const otherPerformance = new Set(identityChecked.filter((s) => {
  const own = [...identity].filter(([k]) => k.startsWith(`${s}:`));
  return own.length && own.filter(([, v]) => !v.located).length > own.length / 2;
}));
// A mis-named file (e.g. "038003.mp3.mp3002.mp3") names the ayahs it may belong to: SSSAAA, then any later AAA.
const strayRefs = new Map();
for (const n of strays) {
  const m = /^(\d{3})(\d{3})/.exec(n);
  if (m) for (const a of [m[2], ...(n.slice(6).replace(/\.?mp3/gi, ' ').match(/\d{3}/g) ?? [])]) strayRefs.set(`${m[1]}${a}.mp3`, n);
}
// Earlier copies EveryAyah keeps under mistakes/ (everyayah-fetch.mjs lists that folder): those ayahs were corrected once.
const mistakes = (manifest.mistakes ?? []).map((m) => m.name);

const pad = (n) => String(n).padStart(3, '0');
const fileOf = (s, a) => `${pad(s)}${pad(a)}.mp3`;
const items = [];
for (let s = 1; s <= 114; s++) {
  if (s !== 1 && s !== 9) items.push({ surah: s, ayah: 0, file: fileOf(s, 0), ref: `${s}:0 (Basmala)` });
  for (let a = 1; a <= COUNTS[s - 1]; a++) items.push({ surah: s, ayah: a, file: fileOf(s, a), ref: `${s}:${a}` });
}

// ---------------------------------------------------------------- calibration
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const q = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))] : NaN; };
const ayahItems = items.filter((x) => x.ayah > 0);
const sc = (x, label) => verify[x.file]?.scores?.[label];
const controlScores = ayahItems.map((x) => sc(x, 'control')?.score).filter(Number.isFinite);
const neighbourScores = ayahItems.flatMap((x) => ['prev', 'next'].map((l) => sc(x, l)?.score)).filter(Number.isFinite);
const expectedScores = ayahItems.map((x) => sc(x, 'expected')?.score).filter(Number.isFinite);
const controlSim = ayahItems.map((x) => sc(x, 'control')?.greedySimilarity).filter(Number.isFinite);
const T = {
  // The expected text must score above (almost) every wrong-text control, and never below 0.30.
  minScore: Math.max(0.30, Math.round(q(controlScores, 0.999) * 100) / 100),
  // ... and clearly above every other text tried (neighbours, control, alternatives).
  minMargin: 0.08,
  // Each half of the text must be found (a missing half scores like a wrong text).
  minHalf: Math.max(0.15, Math.round(q(controlScores, 0.95) * 100) / 100),
  // The greedy transcription must be closer to the expected text than to any other text tried.
  minSimilarityMargin: 0.03,
  minSimilarity: Math.max(0.30, Math.round(q(controlSim, 0.999) * 100) / 100),
  // Voiced audio outside the aligned text, at either end: more than this is something else recited.
  maxVoicedOutsideMs: 1500,
  maxLeadSilenceMs: 3000,
  maxTrailSilenceMs: 1500,
  maxInternalSilenceMs: 3500,
  // Sound at nearly full level in the first / last 30 ms: the recording may be cut.
  maxEdgeDb: -6,
  minDurationMs: 600,
  durationZ: 4.5,
  nearDuplicateCorr: 0.97,
  nearDuplicateLength: 0.02,
};

// Duration against COMPARABLE verses: each ayah's recited time per letter (log scale) is compared with the DUR_WINDOW
// ayahs nearest to it in letter count, through a straight line fitted over that window against log(letters) (so the
// steep fall of time per letter among short ayahs is followed), after removing its surah's own pace (the median over
// the surah); z by the window's MAD. Separate opening letters are left out (recited as letter names).
const DUR_WINDOW = 300;
const durRows = ayahItems.filter((x) => scan[x.file]?.audio?.voicedMs > 0 && !OPENING_LETTERS.has(`${x.surah}:${x.ayah}`))
  .map((x) => { const L = Math.max(1, letters(ayahText(x.surah, x.ayah))); return { x, L, lx: Math.log(L), r: Math.log(scan[x.file].audio.voicedMs / L) }; })
  .sort((p, r) => p.L - r.L || p.x.surah - r.x.surah || p.x.ayah - r.x.ayah);
const windowOf = (i) => { const lo = Math.max(0, Math.min(i - DUR_WINDOW / 2, durRows.length - DUR_WINDOW)); return durRows.slice(lo, lo + DUR_WINDOW); };
const localLine = (w, y) => {
  const mx = w.reduce((a, d) => a + d.lx, 0) / w.length;
  const my = w.reduce((a, d) => a + y(d), 0) / w.length;
  const sxx = w.reduce((a, d) => a + (d.lx - mx) ** 2, 0);
  const b = sxx > 1e-9 ? w.reduce((a, d) => a + (d.lx - mx) * (y(d) - my), 0) / sxx : 0;
  return (lx) => my + b * (lx - mx);
};
durRows.forEach((d, i) => { d.dev = d.r - localLine(windowOf(i), (w) => w.r)(d.lx); });
const bySurah = new Map();
for (const d of durRows) { if (!bySurah.has(d.x.surah)) bySurah.set(d.x.surah, []); bySurah.get(d.x.surah).push(d.dev); }
const surahPace = new Map([...bySurah].map(([k, v]) => [k, q(v, 0.5)]));
for (const d of durRows) d.adj = d.dev - surahPace.get(d.x.surah);
const durOf = new Map();
durRows.forEach((d, i) => { const w = windowOf(i).map((x) => x.adj); const med = q(w, 0.5); durOf.set(d.x.file, (d.adj - med) / Math.max(0.03, q(w.map((v) => Math.abs(v - med)), 0.5) * 1.4826)); });
const durZ = (x) => durOf.get(x.file) ?? null;
const fit = { method: `rolling window of the ${DUR_WINDOW} ayahs nearest in letter count, surah pace removed, z by the window MAD (floor 0.03 log)`, ayahs: durRows.length };

// Encoding batches: a file whose MP3 layout differs from both neighbours' (in a run of at most 3) is a later replacement
// or another source.
const sig = (f) => { const m = scan[f]?.mp3; const t = scan[f]?.tags ?? {}; return m ? `${m.id3v2}|${Object.keys(t).sort().join(',')}|${(m.problems ?? []).length ? 'junk' : ''}|${m.sampleRates}|${m.channels}` : 'missing'; };
const order = items.map((x) => x.file);
const runs = [];
for (const f of order) { const s = sig(f); if (runs.length && runs.at(-1).sig === s) runs.at(-1).files.push(f); else runs.push({ sig: s, files: [f] }); }
const batchOutlier = new Map();
runs.forEach((r, i) => {
  if (r.files.length > 3 || i === 0 || i === runs.length - 1) return;
  if (runs[i - 1].sig === runs[i + 1].sig && runs[i - 1].files.length > 3 && runs[i + 1].files.length > 3) for (const f of r.files) batchOutlier.set(f, `${r.files.length === 1 ? 'a single file' : `${r.files.length} files`} whose MP3 layout (tags, header) differs from the files on both sides: likely a later replacement or another source`);
});
const MAJOR = (() => { const m = {}; for (const f of order) { const a = scan[f]?.mp3; if (a) { const k = `${a.sampleRates}|${a.channels}|${a.kbpsMin}|${a.kbpsMax}|${a.seekHeader}`; m[k] = (m[k] ?? 0) + 1; } } return Object.entries(m).sort((x, y) => y[1] - x[1])[0][0]; })();

// Near duplicates: almost the same loudness envelope and length under two names whose texts differ.
const nearDup = new Map();
{
  const xs = items.filter((x) => scan[x.file]?.audio?.env).map((x) => ({ x, d: scan[x.file].audio.voicedMs, e: scan[x.file].audio.env, t: x.ayah === 0 ? BASMALA : ayahText(x.surah, x.ayah) })).sort((a, b) => a.d - b.d);
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length && xs[j].d <= xs[i].d * (1 + T.nearDuplicateLength); j++) {
      if (xs[i].t === xs[j].t) continue; // the same words (a refrain, or the Basmala): expected to sound alike
      let c = 0;
      for (let k = 0; k < xs[i].e.length; k++) c += xs[i].e[k] * xs[j].e[k];
      c /= xs[i].e.length;
      if (c >= T.nearDuplicateCorr) {
        nearDup.set(xs[i].x.file, `${xs[i].x.ref}: audio almost identical (envelope correlation ${c.toFixed(3)}) to ${xs[j].x.ref}, whose text differs`);
        nearDup.set(xs[j].x.file, `${xs[j].x.ref}: audio almost identical (envelope correlation ${c.toFixed(3)}) to ${xs[i].x.ref}, whose text differs`);
      }
    }
  }
}

// ---------------------------------------------------------------- tiers (graded recordings)
// The dashboard's own tiers (review/manual/very-high.mjs): only CREDIBLE STRUCTURAL evidence is Very High (a wrong or
// ambiguous mapping to another ayah, a cut beginning or end, audio outside the ayah, a broken or joined stream, another
// source, a replaced, missing or unreadable file, an abnormal length, a near-duplicate of another ayah). Weak or
// uncertain text evidence is High; extreme silences and clipping are Medium. A flagged file is never "verified":
// under the owner's policy auto-accept-v2 High and Medium are accepted automatically (administrative), Very High needs
// a person. Recordings without `graded` (Gebril, 2026-10-23) keep every flagged file Very High, as first packaged.
const TIERS_ORDER = ['veryhigh', 'high', 'medium'];
const TIER_OF = {
  veryhigh: ['missing', 'not-fetched', 'redirect', 'decode', 'too-short', 'checksum', 'mistakes-folder', 'stray-name', 'format', 'splice', 'tag-artist', 'tag-album', 'cut-start', 'cut-end', 'internal-silence', 'duration', 'near-duplicate', 'text-mismatch', 'transcript-mismatch', 'extra-before', 'extra-after', 'basmala-inside', 'text-unverified', 'identity', 'identity-sample'],
  high: ['text-weak', 'text-part', 'transcript-weak', 'text-ambiguous', 'batch', 'content-type', 'identity-surah'],
  medium: ['lead-silence', 'trail-silence', 'clipping'],
};
/** An unknown reason is treated as the most serious. */
const tierOf = (code) => TIERS_ORDER.find((t) => TIER_OF[t].includes(code)) ?? 'veryhigh';

// ---------------------------------------------------------------- per file
function classify(x) {
  const reasons = [];
  const notes = [];
  const m = manifest.files[x.file];
  const s = scan[x.file];
  const v = verify[x.file];
  const hard = (code, why) => reasons.push({ code, why, blocking: true });
  const flag = (code, why) => reasons.push({ code, why });
  if (!listed.has(x.file)) hard('missing', 'not in the folder listing');
  if (!m?.ok) hard('not-fetched', `not served as listed (${m?.error ?? `HTTP ${m?.status}`})`);
  else {
    if (m.status !== 200 || m.location) hard('redirect', `HTTP ${m.status}${m.location ? ` → ${m.location}` : ''}`);
    if (m.contentType !== 'audio/mpeg') flag('content-type', `served as ${m.contentType}`);
    if (m.md5Match === false) flag('checksum', `differs from the folder's 000_checksum.md5 (${m.listedMd5}): the file was replaced after the checksums were made`);
    if (m.md5Match === null) notes.push('no entry in 000_checksum.md5 (the Basmala files were added after it)');
  }
  if (mistakes.includes(x.file)) flag('mistakes-folder', 'EveryAyah keeps an earlier copy under mistakes/ (the one the checksum lists): the file was corrected once');
  const id = identity.get(`${x.surah}:${x.ayah}`);
  if (id && !id.located && otherPerformance.has(x.surah)) {
    const why = `this whole surah is another performance than ${recording.reference.provider}'s ${recording.reference.label} recording (most of its ayahs are not found in it)`;
    if (x.ayah === 1) flag('identity-sample', `${why}: listen to confirm the voice is ${recording.nameEn} for the surah; this ayah stands for the surah`);
    else flag('identity-surah', `${why}: the voice is confirmed by ear on ayah 1 of the surah`);
  } else if (id && !id.located) flag('identity', `${id.why}: another performance; the voice and riwaya of this file are not confirmed`);
  else if (id) notes.push(`identity: ${id.why}`);
  if (strayRefs.has(x.file)) flag('stray-name', `the folder also holds "${strayRefs.get(x.file)}", a mis-named file naming this ayah: the files here may have been renamed`);
  const a = s?.audio;
  const mp3 = s?.mp3;
  if (!s || s.mp3?.error || a?.error) hard('decode', `cannot be read: ${s?.mp3?.error ?? a?.error ?? 'not scanned'}`);
  else {
    const fmt = `${mp3.sampleRates}|${mp3.channels}|${mp3.kbpsMin}|${mp3.kbpsMax}|${mp3.seekHeader}`;
    if (fmt !== MAJOR) flag('format', `${mp3.sampleRates.join('/')} Hz ${mp3.channels.join('/')}, ${mp3.kbpsMin === mp3.kbpsMax ? `${mp3.kbpsMin} kbps` : `${mp3.kbpsMin}–${mp3.kbpsMax} kbps (VBR)`}${mp3.seekHeader ? `, ${mp3.seekHeader} header` : ''}: unlike the recording's other files (${MAJOR.split('|').slice(0, 3).join(', ')} kbps): another source or a re-encode`);
    if ((mp3.problems ?? []).some((p) => /without sync/.test(p))) flag('splice', `the MP3 stream breaks (${mp3.problems.filter((p) => /without sync/.test(p)).join('; ')}): the file was cut or joined`);
    if (batchOutlier.has(x.file)) flag('batch', batchOutlier.get(x.file));
    const tags = s.tags ?? {};
    const artist = tags.TPE1 ?? tags.v1artist;
    if (artist && !new RegExp(recording.tags.artist, 'i').test(artist)) flag('tag-artist', `artist tag "${artist}"`);
    if (tags.TALB && !new RegExp(recording.tags.album, 'i').test(tags.TALB)) flag('tag-album', `album tag "${tags.TALB}": names another reciter or source`);
    if (a.decodedMs < T.minDurationMs) hard('too-short', `${a.decodedMs} ms`);
    if (a.leadSilenceMs > T.maxLeadSilenceMs) flag('lead-silence', `${a.leadSilenceMs} ms of silence before the recitation`);
    if (a.trailSilenceMs > T.maxTrailSilenceMs) flag('trail-silence', `${a.trailSilenceMs} ms of silence after the recitation`);
    if (a.longestInternalSilenceMs > T.maxInternalSilenceMs) flag('internal-silence', `a ${a.longestInternalSilenceMs} ms silence inside the recitation (a joined file, or a missing part)`);
    if (a.headEdgeDb > T.maxEdgeDb) flag('cut-start', `sound at full level in the first 30 ms (${a.headEdgeDb} dB): the beginning may be cut`);
    if (a.tailEdgeDb > T.maxEdgeDb) flag('cut-end', `sound at full level in the last 30 ms (${a.tailEdgeDb} dB): the ending may be cut`);
    if (a.peak >= 0.99 || a.clipShare > 1e-4) flag('clipping', `peak ${a.peak}, ${(a.clipShare * 100).toFixed(3)} % of samples at full scale`);
    const z = x.ayah > 0 ? durZ(x) : null;
    if (z !== null && Math.abs(z) > T.durationZ) flag('duration', `${(a.voicedMs / 1000).toFixed(1)} s of recitation for ${letters(ayahText(x.surah, x.ayah))} letters: ${z > 0 ? 'much longer' : 'much shorter'} than this reciter's pace (z ${z.toFixed(1)})`);
    if (nearDup.has(x.file)) flag('near-duplicate', nearDup.get(x.file));
  }
  // Text evidence.
  const ev = {};
  if (!v || v.error) flag('text-unverified', `no text evidence: ${v?.error ?? 'not verified'}`);
  else {
    const e = v.scores.expected;
    const others = Object.entries(v.scores).filter(([k]) => k !== 'expected' && k !== 'basmalaPlusExpected' && !(x.ayah === 0 && k === 'ayah1' && x.surah === 1));
    if (!e || e.error) flag('text-unverified', `the expected text cannot be aligned: ${e?.error ?? 'missing'}${/longer than the audio/.test(e?.error ?? '') ? ' (the recording is too short for the ayah: incomplete)' : ''}`);
    else {
      const best = others.filter(([, r]) => Number.isFinite(r.score)).sort((p, r) => r[1].score - p[1].score)[0];
      const bestSim = others.filter(([, r]) => Number.isFinite(r.greedySimilarity)).sort((p, r) => r[1].greedySimilarity - p[1].greedySimilarity)[0];
      Object.assign(ev, { score: e.score, firstHalf: e.firstHalf, secondHalf: e.secondHalf, similarity: e.greedySimilarity, voicedBeforeMs: e.voicedBeforeMs, voicedAfterMs: e.voicedAfterMs,
        best: best ? { text: best[0] === 'control' ? `control ${v.controlRef}` : best[0], score: best[1].score } : null, margin: best ? round(e.score - best[1].score) : null,
        bestSimilarity: bestSim ? { text: bestSim[0], similarity: bestSim[1].greedySimilarity } : null });
      const label = x.ayah === 0 ? 'the Basmala' : `ayah ${x.surah}:${x.ayah}`;
      if (best && best[1].score >= e.score) flag('text-mismatch', `matches ${best[0] === 'control' ? `another ayah (${v.controlRef})` : best[0] === 'prev' ? `the previous ayah` : best[0] === 'next' ? 'the next ayah' : `the ${best[0]}`} (${best[1].score}) at least as well as ${label} (${e.score}): wrong file?`);
      else if (best && e.score - best[1].score < T.minMargin) flag('text-ambiguous', `${label} scores ${e.score}, only ${(e.score - best[1].score).toFixed(3)} above ${best[0] === 'control' ? `another ayah (${v.controlRef})` : best[0]} (${best[1].score}): not clearly this ayah`);
      if (e.score < T.minScore) flag('text-weak', `weak match to ${label}: score ${e.score} (needs ≥ ${T.minScore}, above the wrong-text controls)`);
      if (Math.min(e.firstHalf, e.secondHalf) < T.minHalf) flag('text-part', `${e.firstHalf < e.secondHalf ? 'first' : 'second'} half of ${label} barely found (${Math.min(e.firstHalf, e.secondHalf)}; needs ≥ ${T.minHalf}): words may be missing`);
      if (bestSim && bestSim[1].greedySimilarity + T.minSimilarityMargin > e.greedySimilarity) flag('transcript-mismatch', `the automatic transcription is as close to ${bestSim[0] === 'control' ? `another ayah (${v.controlRef})` : bestSim[0]} (${bestSim[1].greedySimilarity}) as to ${label} (${e.greedySimilarity})`);
      else if (e.greedySimilarity < T.minSimilarity) flag('transcript-weak', `the automatic transcription is far from ${label} (similarity ${e.greedySimilarity}; needs ≥ ${T.minSimilarity})`);
      if (e.voicedBeforeMs > T.maxVoicedOutsideMs) flag('extra-before', `${(e.voicedBeforeMs / 1000).toFixed(1)} s of voiced audio before ${label}'s words: something else is recited first`);
      if (e.voicedAfterMs > T.maxVoicedOutsideMs) flag('extra-after', `${(e.voicedAfterMs / 1000).toFixed(1)} s of voiced audio after ${label}'s words: something else is recited after it`);
      const both = v.scores.basmalaPlusExpected;
      if (x.ayah === 1 && both?.score && both.score > e.score && e.voicedBeforeMs > 1000) flag('basmala-inside', `the ayah-1 file seems to begin with the Basmala too (score ${both.score} with it, ${e.score} without): it would be heard twice after the Basmala file`);
    }
  }
  const risk = reasons.length ? 'high' : 'low';
  // Graded recordings: the tier of the most serious reason (TIER_OF); every flagged file stays `risk: high` (not cleared).
  const tier = !reasons.length ? 'low' : TIERS_ORDER.find((t) => reasons.some((r) => tierOf(r.code) === t));
  return {
    ref: x.ref, surah: x.surah, ayah: x.ayah, file: x.file, bytes: m?.bytes ?? null, sha256: m?.sha256 ?? null,
    durationMs: mp3?.durationS ? Math.round(mp3.durationS * 1000) : a?.decodedMs ?? null, decodedMs: a?.decodedMs ?? null,
    playable: !reasons.some((r) => r.blocking) && !!m?.ok && !!s && !a?.error,
    risk, ...(recording.graded ? { tier } : {}), confidence: risk === 'low' ? `text ${ev.score} (margin ${ev.margin}), transcript ${ev.similarity}` : null,
    reasons: reasons.map((r) => `${r.code}: ${r.why}`), codes: reasons.map((r) => r.code), notes, evidence: ev,
  };
}

const rows = items.map(classify);
// 001000.mp3 (Al-Fatiha's Basmala is its ayah 1) and 009000.mp3 (At-Tawbah has no Basmala) are not part of the Mushaf
// text: identified from the text evidence and reported, never played.
const NOT_PLAYED = { '001000.mp3': "Al-Fatiha's Basmala is its ayah 1 (001001.mp3)", '009000.mp3': 'At-Tawbah opens without the Basmala' };
const extra = Object.keys(NOT_PLAYED).filter((f) => listed.has(f)).map((f) => {
  const v = verify[f]?.scores ?? {};
  const cands = [['the Basmala', v.expected?.score], ["the isti'adha", v.istiadha?.score], ['ayah 1 of the surah', v.ayah1?.score]].filter(([, sc]) => Number.isFinite(sc)).sort((p, r) => r[1] - p[1]);
  const [best, next] = cands;
  const identified = best && best[1] >= T.minScore && (!next || best[1] - next[1] >= T.minMargin) ? `${best[0]} (score ${best[1]}${next ? ` vs ${next[1]} for ${next[0]}` : ''}; transcription "${verify[f]?.greedy}")` : `unclear (${cands.map(([n, sc]) => `${n} ${sc}`).join(', ')}; transcription "${verify[f]?.greedy}")`;
  return { file: f, played: false, identified, durationMs: scan[f]?.audio?.decodedMs ?? null, note: `${NOT_PLAYED[f]}: this file is not played by the app.` };
});
const surahs = {};
for (let s = 1; s <= 114; s++) {
  const own = rows.filter((r) => r.surah === s);
  const missing = own.filter((r) => !r.playable).map((r) => r.ref);
  surahs[s] = { files: own.length, high: own.filter((r) => r.risk === 'high').length, playable: missing.length === 0, notPlayable: missing };
}
const high = rows.filter((r) => r.risk === 'high');
const byCode = {};
for (const r of high) for (const c of r.codes) byCode[c] = (byCode[c] ?? 0) + 1;
const report = {
  kind: 'per-ayah-risk', version: 1, createdOn: today, recording: { ...recording },
  identity: args.identity ? { reference: recording.reference, rule: `every 3 s chunk of the ayah file found in order in the reference surah (score >= ${MIN_CHUNK})`, surahsChecked: identityChecked, located: [...identity.values()].filter((v) => v.located).length, otherPerformanceSurahs: [...otherPerformance].sort((a, b) => a - b), notLocated: [...identity].filter(([, v]) => !v.located).map(([k]) => k) } : null,
  source: { base: recording.base, listingEntries: listing.length, mp3Files: listing.filter((r) => /^\d{6}\.mp3$/.test(r.name)).length, strays, subfolders, mistakes, fetchedOn: manifest.fetchedOn, checksums: manifest.checksums },
  rule: 'LOW risk only when every automated check passes clearly; anything missing, damaged, unusual, contradictory or uncertain is HIGH risk. LOW risk is not a verification: no automated check found a reason to listen. Only a person decides by ear.',
  thresholds: { ...T, durationBins: fit, majorFormat: MAJOR },
  calibration: {
    expectedScore: [0.001, 0.01, 0.05, 0.5].map((p) => [p, q(expectedScores, p)]),
    controlScore: [0.5, 0.95, 0.99, 0.999, 1].map((p) => [p, q(controlScores, p)]),
    neighbourScore: [0.5, 0.95, 0.99, 0.999, 1].map((p) => [p, q(neighbourScores, p)]),
    controlSimilarity: [0.5, 0.99, 0.999, 1].map((p) => [p, q(controlSim, p)]),
  },
  totals: {
    files: rows.length, ayahs: rows.filter((r) => r.ayah > 0).length, basmalaFiles: rows.filter((r) => r.ayah === 0).length,
    available: rows.filter((r) => manifest.files[r.file]?.ok).length, playable: rows.filter((r) => r.playable).length,
    low: rows.length - high.length, high: high.length, highAyahs: high.filter((r) => r.ayah > 0).length, highBasmala: high.filter((r) => r.ayah === 0).length,
    surahsPlayable: Object.values(surahs).filter((x) => x.playable).length, surahsWithHigh: Object.values(surahs).filter((x) => x.high).length, byCode,
    ...(recording.graded ? { byTier: Object.fromEntries([...TIERS_ORDER, 'low'].map((t) => [t, rows.filter((r) => r.tier === t).length])) } : {}),
  },
  notPlayed: extra, surahs, items: rows,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report));
console.log(JSON.stringify({ out: path.relative(REPO, out), totals: report.totals, thresholds: T, calibration: report.calibration, fit }, null, 1));
