// Live drift check (run before a release): for every surah the app plays ayah by ayah, fetches MP3Quran's timing now
// and compares its fingerprint with the audited one (as the app does before using it), and checks that the audio file
// still answers with the audited size. Any difference means that surah would be refused in the app until re-audited.
// Measured timing (timingSource 'measured') is shipped in the app, so only its audio file is checked: a different
// size means the file it was measured on has changed, and that reciter must be re-measured before release.
// Redirects are not followed: an audio URL that redirects (MP3Quran sends a missing surah to another Sheikh's file) is a
// difference. Approved whole-surah sources (surah-mode-approvals.json) are checked the same way (no timing to compare).
//
// usage: node check-live.mjs [reciterId ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timingFingerprint } from './fingerprint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const results = JSON.parse(fs.readFileSync(path.join(here, 'audit-results.json'), 'utf8'));
const only = new Set(process.argv.slice(2));
const UA = { 'User-Agent': 'QuranHeals-audit/1.0' };

async function retry(run, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw last;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}

let problems = 0;
let checked = 0;
for (const reciter of results.reciters) {
  if (only.size && !only.has(reciter.id)) continue;
  const surahs = Object.keys(reciter.timed).map(Number);
  if (surahs.length === 0) continue;
  const bad = [];
  await pool(surahs, 6, async (surah) => {
    const timing = reciter.timingSource === 'measured' ? null : await retry(async () => {
      const response = await fetch(`https://www.mp3quran.net/api/v3/ayat_timing?surah=${surah}&read=${reciter.timingRead}`, { headers: UA });
      if (!response.ok) throw new Error(`timing ${response.status}`);
      return response.json();
    }).catch((error) => ({ error: String(error) }));
    const fingerprint = Array.isArray(timing)
      ? timingFingerprint(timing.map((x) => ({ ayah: x.ayah, startMs: x.start_time, endMs: x.end_time })))
      : null;
    if (timing !== null && fingerprint !== reciter.timed[surah].fingerprint) bad.push(`${surah}: timing ${fingerprint ?? timing.error} ≠ ${reciter.timed[surah].fingerprint}`);
    const url = `${reciter.server}${String(surah).padStart(3, '0')}.mp3`;
    const size = await retry(async () => {
      const response = await fetch(url, { redirect: 'manual', headers: { ...UA, Range: 'bytes=0-1' } });
      await response.arrayBuffer();
      if (response.status >= 300 && response.status < 400) return `redirects to ${response.headers.get('location')}`;
      if (response.status !== 206 && response.status !== 200) throw new Error(`audio ${response.status}`);
      const range = response.headers.get('content-range');
      return range ? Number(range.split('/')[1]) : Number(response.headers.get('content-length'));
    }).catch((error) => String(error));
    if (size !== reciter.bytes[surah]) bad.push(`${surah}: audio ${size} ≠ ${reciter.bytes[surah]} bytes`);
    checked++;
  });
  problems += bad.length;
  const what = reciter.timingSource === 'measured' ? 'audio (measured timing)' : 'timing and audio';
  console.log(`${reciter.id.padEnd(14)} ${surahs.length} surahs, ${what}: ${bad.length === 0 ? 'all match' : `${bad.length} differ`}`);
  for (const line of bad.sort()) console.log(`   ${line}`);
}
const approved = JSON.parse(fs.readFileSync(path.join(here, 'surah-mode-approvals.json'), 'utf8')).approved.filter((a) => !only.size || only.has(a.reciterId));
for (const a of approved) {
  const answer = await retry(async () => {
    const response = await fetch(a.url, { method: 'HEAD', redirect: 'manual', headers: UA });
    return { status: response.status, location: response.headers.get('location'), length: Number(response.headers.get('content-length')) };
  }).catch((error) => ({ error: String(error) }));
  const bad = answer.error ?? (answer.status >= 300 && answer.status < 400 ? `redirects to ${answer.location}` : answer.status !== 200 ? `status ${answer.status}` : answer.length !== a.bytes ? `${answer.length} ≠ ${a.bytes} bytes` : null);
  checked++;
  if (bad) {
    problems++;
    console.log(`whole surah    ${a.reciterId} ${a.surah} (${a.provider}): ${bad}`);
  }
}
if (approved.length) console.log(`${approved.length} approved whole-surah sources checked`);
console.log(`${checked} surahs checked, ${problems} differences (${new Date().toISOString()})`);
process.exitCode = problems ? 1 : 0;
