// Phase 4.1 re-validation of the DEVELOPMENT-ONLY measured timing (development/development-timing.json). Adds, per
// boundary, the evidence that decides what a listener must hear first. It changes no timing and approves nothing.
//   sweep          the boundary sweep's class (pause / displaced / unconfirmed), as finalize recorded it
//   acoustic       alignment/flag_boundaries.py acoustic(): silence / reverb-tail / shallow, with the depth below the
//                  loud recitation around it (the median-relative sweep misses pauses inside long silences and under
//                  reverberation: docs/audio/alignment-phase-4-1-2026-10-18.md)
//   mp3quran       MP3Quran's own ayah timing of the same file (independent of the EveryAyah clips the timing was
//                  measured from): its start within 500 ms ('agrees'), further ('differs'), or none
//   priority       1 listen first: displaced, or shallow and not corroborated by MP3Quran
//                  2 listen: shallow but corroborated, or a reverberation tail not corroborated
//                  3 sample only
// Writes audit-data/development-revalidation-<date>.json (no audio, no third-party text).
//
// usage: node development/revalidate.mjs <audio dir: <id>_<surah>.mp3> [date]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const [audioDir, date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!audioDir) throw new Error('usage: node development/revalidate.mjs <audio dir> [date]');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const dev = readJson(path.join(here, 'development-timing.json'));
const audit = readJson(path.join(tools, 'audit-results.json'));
const AGREE_MS = 500;

/** Acoustic class of each time in one file (flag_boundaries.py's acoustic(), the same thresholds). */
function acousticOf(audio, times) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(tools, 'alignment'))})
import flag_boundaries as fb
env, dur, db = fb.envelope(sys.argv[1])
print(json.dumps([fb.acoustic(db, env, t) for t in json.loads(sys.argv[2])]))`;
  return JSON.parse(execFileSync('python', ['-I', '-X', 'utf8', '-c', script, audio, JSON.stringify(times)], { maxBuffer: 1 << 26 }).toString());
}

async function mp3quranStarts(read, s) {
  try {
    const t = await (await fetch(`https://www.mp3quran.net/api/v3/ayat_timing?surah=${s}&read=${read}`, { headers: { 'User-Agent': 'QuranHeals-audit/1.0' } })).json();
    return new Map((Array.isArray(t) ? t : []).filter((x) => x.ayah > 1).map((x) => [x.ayah, x.start_time]));
  } catch {
    return new Map();
  }
}

const out = { checkedOn: date, stage: 'development', method: 'development/revalidate.mjs (Phase 4.1)', reciters: {} };
for (const [id, r] of Object.entries(dev.reciters)) {
  const entry = audit.reciters.find((x) => x.id === id);
  const read = entry.timingRead ?? entry.moshafId;
  for (const [s, timing] of Object.entries(r.surahs)) {
    const audio = path.join(audioDir, `${id}_${s}.mp3`);
    if (!fs.existsSync(audio)) throw new Error(`${audio}: missing (download the catalogue file first)`);
    const sweep = new Map((r.review[s] ?? []).map((l) => { const [key, kind] = l.split(' '); return [Number(key.split(':')[1]), kind]; }));
    const starts = timing.slice(1).map(([start]) => start);
    const sounds = acousticOf(audio, starts);
    const ref = await mp3quranStarts(read, s);
    const boundaries = starts.map((ms, k) => {
      const ayah = k + 2;
      const m = ref.get(ayah);
      const mp3quran = m === undefined ? 'none' : Math.abs(m - ms) <= AGREE_MS ? 'agrees' : 'differs';
      const sw = sweep.get(ayah) ?? 'pause';
      const a = sounds[k];
      const priority = sw === 'displaced' || (a.kind === 'shallow' && mp3quran !== 'agrees') ? 1 : a.kind === 'shallow' || (a.kind === 'reverb-tail' && mp3quran !== 'agrees') ? 2 : 3;
      return { ayah, ms, sweep: sw, acoustic: a, mp3quran, ...(m === undefined ? {} : { mp3quranDeltaMs: m - ms }), priority };
    });
    const count = (f) => boundaries.filter(f).length;
    (out.reciters[id] ??= {})[s] = {
      fingerprint: r.evidence[s].fingerprint,
      summary: {
        boundaries: boundaries.length,
        sweepPause: count((b) => b.sweep === 'pause'),
        acoustic: { silence: count((b) => b.acoustic.kind === 'silence'), reverbTail: count((b) => b.acoustic.kind === 'reverb-tail'), shallow: count((b) => b.acoustic.kind === 'shallow') },
        mp3quran: { agrees: count((b) => b.mp3quran === 'agrees'), differs: count((b) => b.mp3quran === 'differs'), none: count((b) => b.mp3quran === 'none') },
        priority: { 1: count((b) => b.priority === 1), 2: count((b) => b.priority === 2), 3: count((b) => b.priority === 3) },
      },
      boundaries,
    };
    const x = out.reciters[id][s].summary;
    console.log(`${id} ${s}: ${x.boundaries} boundaries; sweep pause ${x.sweepPause}; silence ${x.acoustic.silence}, tail ${x.acoustic.reverbTail}, shallow ${x.acoustic.shallow}; MP3Quran agrees ${x.mp3quran.agrees}; priority 1/2: ${x.priority[1]}/${x.priority[2]}`);
  }
}
fs.writeFileSync(path.join(tools, 'audit-data', `development-revalidation-${date}.json`), JSON.stringify(out) + '\n');
