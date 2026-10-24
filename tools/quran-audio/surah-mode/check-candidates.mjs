// Nominates whole-surah (surah-only) candidates: MP3Quran files of the app's recordings that are listed in MP3Quran's
// catalogue but have no verified ayah timing. Automated checks only. They can flag a file, but they never approve
// one: approval needs a person's listening review recorded in ../surah-mode-approvals.json (see its "fields").
//
// Checks, per listed surah without verified timing:
//  - listed: the surah is in MP3Quran's catalogue for this recording (an unlisted surah redirects to another Sheikh);
//  - not another recording: its audited size differs from every other recording's file of the same surah (the
//    signature of MP3Quran's redirect to Minshawi r1, or of a shared file);
//  - format: bitrate, CBR / VBR (VBR is fine for whole-surah playback, never for ayah playback);
//  - duration plausible: against what this reciter's pace predicts for this surah (each surah's median length over all
//    the recordings, times the reciter's own median ratio). Outside 0.8-1.25 the file may be truncated, padded or of
//    another surah: flagged 'duration'. This catches gross problems only; it cannot show the whole surah is there;
//  - with --live: a HEAD request that must not redirect (redirect: 'manual'), and must answer 200 with the audited size.
//
// usage: node surah-mode/check-candidates.mjs [--live] [reciterId ...]
// writes: audit-data/surah-mode-candidates-<date>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const live = process.argv.includes('--live');
const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--')));
const results = JSON.parse(fs.readFileSync(path.join(root, 'audit-results.json'), 'utf8'));
const formatsFile = fs.readdirSync(path.join(root, 'audit-data')).filter((f) => /^recording-formats-.*\.json$/.test(f)).sort().at(-1);
const formats = JSON.parse(fs.readFileSync(path.join(root, 'audit-data', formatsFile), 'utf8')).recordings;
const UA = { 'User-Agent': 'QuranHeals-audit/1.0' };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

// Each surah's typical length (median over every recording that has it), then each reciter's pace against it.
const durations = {};
for (const [id, rec] of Object.entries(formats)) for (const [s, f] of Object.entries(rec.files)) if (f.durationMs) (durations[s] ??= []).push({ id, ms: f.durationMs });
const typical = Object.fromEntries(Object.entries(durations).map(([s, xs]) => [s, median(xs.map((x) => x.ms))]));
const pace = {};
for (const [id, rec] of Object.entries(formats)) pace[id] = median(Object.entries(rec.files).filter(([, f]) => f.durationMs).map(([s, f]) => f.durationMs / typical[s]));

async function head(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: UA });
      return { status: response.status, location: response.headers.get('location'), length: Number(response.headers.get('content-length')) || null };
    } catch (error) {
      if (attempt === 2) return { error: String(error) };
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

const candidates = [];
for (const reciter of results.reciters) {
  if (reciter.server === null || (only.size && !only.has(reciter.id))) continue;
  const untimed = reciter.surahs.filter((s) => reciter.timed[s] === undefined);
  for (const surah of untimed) {
    const file = formats[reciter.id].files[surah];
    const flags = [];
    const sameSize = Object.entries(formats).filter(([id, rec]) => id !== reciter.id && rec.files[surah]?.bytes === file.bytes).map(([id]) => id);
    if (sameSize.length) flags.push(`same size as ${sameSize.join(', ')}'s file of this surah`);
    if (file.status !== 206 && file.status !== 200) flags.push(`audit status ${file.status}`);
    const expected = pace[reciter.id] && typical[surah] ? pace[reciter.id] * typical[surah] : null;
    const ratio = expected && file.durationMs ? Math.round((file.durationMs / expected) * 100) / 100 : null;
    if (ratio === null) flags.push('duration unknown');
    else if (ratio < 0.8 || ratio > 1.25) flags.push(`duration ${ratio}× what this reciter's pace predicts`);
    const url = `${reciter.server}${String(surah).padStart(3, '0')}.mp3`;
    const entry = {
      reciterId: reciter.id, surah, url, bytes: file.bytes, kbps: file.kbps, bitrateMode: file.bitrateMode, durationMs: file.durationMs,
      durationRatio: ratio, why: reciter.timingSource === null ? 'no timing for this recording' : 'timing rejected by the audit',
      flags,
    };
    if (live) {
      const answer = await head(url);
      entry.live = answer;
      if (answer.error) flags.push(`live: ${answer.error}`);
      else if (answer.status >= 300 && answer.status < 400) flags.push(`live: redirects to ${answer.location}`);
      else if (answer.status !== 200) flags.push(`live: status ${answer.status}`);
      else if (answer.length !== file.bytes) flags.push(`live: ${answer.length} bytes ≠ audited ${file.bytes}`);
    }
    entry.status = flags.length ? 'flagged' : 'candidate';
    candidates.push(entry);
  }
}

// The unlisted surahs: never candidates; with --live, confirm the CDN still redirects them (to whom).
const unlisted = [];
for (const reciter of results.reciters) {
  if (reciter.server === null || (only.size && !only.has(reciter.id))) continue;
  for (const surah of reciter.missingSurahs) {
    const url = `${reciter.server}${String(surah).padStart(3, '0')}.mp3`;
    unlisted.push(live ? { reciterId: reciter.id, surah, ...(await head(url)) } : { reciterId: reciter.id, surah });
  }
}

const date = new Date().toISOString().slice(0, 10);
const out = path.join(root, 'audit-data', `surah-mode-candidates-${date}.json`);
const summary = {};
for (const c of candidates) (summary[c.reciterId] ??= { candidate: 0, flagged: 0 })[c.status]++;
fs.writeFileSync(out, `${JSON.stringify({
  checkedOn: date,
  live,
  note: 'Automated nomination only. A candidate is NOT approved: it still needs a listening review and an entry in surah-mode-approvals.json.',
  pace: Object.fromEntries(Object.entries(pace).map(([id, p]) => [id, Math.round(p * 100) / 100])),
  summary,
  candidates,
  unlisted,
}, null, 1)}\n`);
for (const [id, s] of Object.entries(summary)) console.log(`${id.padEnd(14)} ${String(s.candidate).padStart(3)} candidates, ${s.flagged} flagged`);
for (const c of candidates.filter((x) => x.flags.length)) console.log(`  ${c.reciterId} ${c.surah}: ${c.flags.join('; ')}`);
if (live) {
  const redirected = unlisted.filter((u) => u.status >= 300 && u.status < 400);
  console.log(`unlisted: ${unlisted.length}, redirecting now: ${redirected.length}${redirected.length ? ` (e.g. ${redirected[0].reciterId} ${redirected[0].surah} → ${redirected[0].location})` : ''}`);
}
console.log(`→ ${path.relative(process.cwd(), out)}`);
