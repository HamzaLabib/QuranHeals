// Cross-checks Maher Al-Muaiqly's MP3Quran timing (read 133, as audited) against Quran Foundation's verse timestamps
// for chapter reciter 159 ("year1440", labelled Hafs), which is the same performance encoded separately (established by
// audio comparison: one constant 25 ms lag, correlation 0.86-0.92 in every 10 s window; tools/quran-audio/README.md).
//
// Two independent timings of one performance: where they agree (within 0.5 s of their median offset) the boundary is
// corroborated; where they disagree, each candidate is tested for a pause in the MP3Quran audio (pause_check.py).
//
// Quran Foundation content stays in <work dir> (its Developer Terms: no copy kept beyond 7 days outside Content Sync,
// no build-time bundle; this repository is public). Only the verdicts are written to the repository:
// audit-data/maher-qf-crosscheck-<date>.json (boundary, ratios, size of the disagreement rounded to 0.1 s).
//
// usage (from backend/, which holds the QF_* credentials in .env; they are never printed):
//   node ../tools/quran-audio/audit/maher-qf-crosscheck.mjs <work dir outside the repository>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { timingFingerprint } from '../fingerprint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.join(here, '..');
const work = process.argv[2];
if (!work) throw new Error('usage: node maher-qf-crosscheck.mjs <work dir>');
fs.mkdirSync(work, { recursive: true });
const audit = JSON.parse(fs.readFileSync(path.join(tools, 'audit-results.json'), 'utf8')).reciters.find((r) => r.id === 'maher');

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => /^QF_/.test(l)).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
  }),
);
if (env.QF_ENV !== 'production' || !env.QF_CLIENT_ID || !env.QF_CLIENT_SECRET) throw new Error('needs production QF_* credentials in ./.env');
const token = (await (await fetch('https://oauth2.quran.foundation/oauth2/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${env.QF_CLIENT_ID}:${env.QF_CLIENT_SECRET}`).toString('base64') },
  body: 'grant_type=client_credentials&scope=content',
})).json()).access_token;

async function getJson(url, headers = {}) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch (error) {
      if (i > 3) throw error;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

const rows = [];
for (let s = 1; s <= 114; s++) {
  const m3 = await getJson(`https://www.mp3quran.net/api/v3/ayat_timing?surah=${s}&read=133`);
  const fingerprintOk = timingFingerprint(m3.map((x) => ({ ayah: x.ayah, startMs: x.start_time, endMs: x.end_time }))) === audit.timed[s]?.fingerprint;
  const qf = (await getJson(`https://apis.quran.foundation/content/api/v4/chapter_recitations/159/${s}?segments=true`, { 'x-auth-token': token, 'x-client-id': env.QF_CLIENT_ID })).audio_file;
  fs.writeFileSync(path.join(work, `qf159_${s}.json`), JSON.stringify(qf));
  const qfStart = new Map(qf.timestamps.map((t) => [Number(t.verse_key.split(':')[1]), t.timestamp_from]));
  const ayahs = m3.filter((x) => x.ayah > 0);
  rows.push({ s, fingerprintOk, counts: [ayahs.length, qf.timestamps.length], starts: ayahs.map((a) => [a.ayah, a.start_time, qfStart.get(a.ayah) ?? null]) });
}

// Ayah 1's start is not used for playback (ayah 1 plays from the file's start), so boundaries are ayahs 2..N.
const diffs = rows.flatMap((r) => r.starts.slice(1).filter(([, , q]) => q !== null).map(([a, m, q]) => ({ s: r.s, a, m, q, d: m - q })));
const sorted = diffs.map((x) => x.d).sort((a, b) => a - b);
const median = sorted[sorted.length >> 1];
const disagree = diffs.filter((x) => Math.abs(x.d - median) > 500);

// Both candidates of every disagreement, in the MP3Quran file (the QF file runs 25 ms behind it: one MP3 frame).
const cases = disagree.map((x) => ({
  label: `${x.s}:${x.a}`,
  url: `https://cdn.mp3quran.net/audio/maher-muaiqly/r3/${String(x.s).padStart(3, '0')}.mp3`,
  bitrate_kbps: 96, first_byte: 6900, size: audit.bytes[x.s], t: [x.m, x.q + 25],
}));
fs.writeFileSync(path.join(work, 'cases.json'), JSON.stringify(cases));
execFileSync('python', ['-I', '-X', 'utf8', path.join(here, 'pause_check.py'), path.join(work, 'cases.json'), path.join(work, 'pauses.json')], { stdio: 'inherit' });
const pauses = new Map(JSON.parse(fs.readFileSync(path.join(work, 'pauses.json'), 'utf8')).map((p) => [p.label, p.ratios]));

const PAUSE = 0.35;
const verdicts = disagree.map((x) => {
  const [m3Ratio, qfRatio] = pauses.get(`${x.s}:${x.a}`);
  const verdict = m3Ratio < PAUSE ? 'mp3quran in a pause' : qfRatio < PAUSE ? 'mp3quran wrong (inside recitation; the other timing is in a pause)' : 'neither in a pause';
  return { boundary: `${x.s}:${x.a}`, mp3quranStartMs: x.m, disagreementS: Math.round((x.d - median) / 100) / 10, mp3quranRatio: m3Ratio, otherRatio: qfRatio, verdict };
});
const within = (t) => diffs.filter((x) => Math.abs(x.d - median) <= t).length;
const out = {
  checkedOn: new Date().toISOString().slice(0, 10),
  mp3quranRead: 133,
  reference: 'Quran Foundation chapter reciter 159 (Maher al-Muaiqly, qirat: Hafs, style: Murattal; audio download.quranicaudio.com/quran/maher_almu3aiqly/year1440/)',
  fingerprintsMatchingAudit: rows.filter((r) => r.fingerprintOk).length,
  ayahCountsEqual: rows.filter((r) => r.counts[0] === r.counts[1]).length,
  boundariesCompared: diffs.length,
  medianOffsetMs: median,
  agreeWithin: { '100ms': within(100), '250ms': within(250), '500ms': within(500), '1000ms': within(1000) },
  disagreements: verdicts,
  mp3quranWrong: verdicts.filter((v) => v.verdict.startsWith('mp3quran wrong')).map((v) => v.boundary),
};
const target = path.join(tools, 'audit-data', `maher-qf-crosscheck-${out.checkedOn}.json`);
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`${out.boundariesCompared} boundaries, median offset ${median} ms, ${out.agreeWithin['500ms']} within 0.5 s; MP3Quran wrong at: ${out.mp3quranWrong.join(' ')}`);
console.log('wrote', target);
