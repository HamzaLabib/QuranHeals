// Full boundary sweep, step 1 (step 2: boundary_sweep.py). For every surah of audit-results.json with MP3Quran timing,
// the live timing (kept only if its fingerprint equals the audited one), the audio file's first frame byte and CBR
// bitrate, and every boundary (the start of ayahs 2..N). Measured timing (measured-timing.json) is included too, so the
// same acoustic test runs on it.  usage: node audit/boundary-sweep-prep.mjs <work dir>   -> <work dir>/jobs.json
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { timingFingerprint } from '../fingerprint.mjs';
const tools = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out] = process.argv.slice(2);
if (!out) throw new Error('usage: node audit/boundary-sweep-prep.mjs <work dir>');
fs.mkdirSync(path.join(out, 'timing'), { recursive: true });
const res = JSON.parse(fs.readFileSync(path.join(tools, 'audit-results.json'), 'utf8')).reciters;
const measuredFile = path.join(tools, 'measured-timing.json');
const measured = fs.existsSync(measuredFile) ? JSON.parse(fs.readFileSync(measuredFile, 'utf8')).reciters : {};
const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
async function retry(f) { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i > 4) throw e; await new Promise((r) => setTimeout(r, 1000 * (i + 1))); } } }
const tasks = res.flatMap((r) => Object.keys(r.timed).map((s) => [r, Number(s)]));
const headerOf = async (url) => {
  const h = Buffer.from(await retry(async () => (await fetch(url, { headers: { Range: 'bytes=0-131071' } })).arrayBuffer()));
  let p = 0; if (h.slice(0, 3).toString() === 'ID3') p = 10 + ((h[6] & 127) << 21 | (h[7] & 127) << 14 | (h[8] & 127) << 7 | (h[9] & 127));
  while (p < h.length - 1 && !(h[p] === 255 && (h[p + 1] & 224) === 224)) p++;
  return { first: p, kbps: ((h[p + 1] >> 3) & 3) === 3 ? BR1[(h[p + 2] >> 4) & 15] : BR2[(h[p + 2] >> 4) & 15] };
};
const jobs = []; let i = 0, mismatch = 0;
await Promise.all(Array.from({ length: 8 }, async () => { while (i < tasks.length) { const [r, s] = tasks[i++];
  const url = `${r.server}${String(s).padStart(3, '0')}.mp3`;
  if (r.timingSource === 'measured') {
    const ay = measured[r.id].surahs[s];
    jobs.push({ id: r.id, surah: s, url, ...(await headerOf(url)), size: r.bytes[s], boundaries: ay.slice(1).map(([start], k) => [k + 2, start]) });
    continue;
  }
  const tf = path.join(out, 'timing', `${r.timingRead}_${s}.json`);
  const t = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf)) : await retry(async () => { const x = await fetch(`https://www.mp3quran.net/api/v3/ayat_timing?surah=${s}&read=${r.timingRead}`); if (!x.ok) throw new Error(x.status); return x.json(); });
  fs.writeFileSync(tf, JSON.stringify(t));
  if (timingFingerprint(t.map((x) => ({ ayah: x.ayah, startMs: x.start_time, endMs: x.end_time }))) !== r.timed[s].fingerprint) { mismatch++; console.log('fingerprint mismatch', r.id, s); continue; }
  const ay = t.filter((x) => x.ayah > 0).sort((a, b) => a.ayah - b.ayah);
  jobs.push({ id: r.id, surah: s, url, ...(await headerOf(url)), size: r.bytes[s], boundaries: ay.slice(1).map((x) => [x.ayah, x.start_time]) });
} }));
fs.writeFileSync(path.join(out, 'jobs.json'), JSON.stringify(jobs));
console.log('jobs', jobs.length, 'boundaries', jobs.reduce((a, j) => a + j.boundaries.length, 0), 'fingerprint mismatches', mismatch);
