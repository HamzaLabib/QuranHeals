// Compiles the MP3Quran audit (audit/*.mjs|py outputs) into tools/quran-audio/audit-results.json: one entry per
// Quran Heals reciter with the recording chosen, the surahs it has, and the surahs whose ayah timing passed every check.
//
// usage: node compile-results.mjs <audit work dir>   (the directory holding audit.json, persurah.json, dense.json,
//        ayah_counts.json and timing/<read>_<surah>.json, as written by the audit scripts)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RECITERS } from './reciters.mjs';
import { timingFingerprint } from './fingerprint.mjs';

const work = process.argv[2];
if (!work) throw new Error('usage: node compile-results.mjs <audit work dir>');
const read = (name) => JSON.parse(fs.readFileSync(path.join(work, name), 'utf8'));
const audit = new Map(read('audit.json').map((r) => [r.moshafId, r]));
const persurah = read('persurah.json');
const dense = fs.existsSync(path.join(work, 'dense.json')) ? read('dense.json') : {};
const counts = read('ayah_counts.json');
const PASS = 0.8;

const passes = (d) => d && d.n > 0 && d.pause >= Math.ceil(PASS * d.n);

const out = [];
for (const r of RECITERS) {
  if (r.moshafId === null) continue; // no recording in the app: refine-results.mjs lists it
  const a = audit.get(r.moshafId);
  if (!a) throw new Error(`no audit for ${r.id} (${r.moshafId})`);
  const entry = {
    id: r.id,
    mp3quranReciterId: r.reciterId,
    moshafId: r.moshafId,
    moshafName: a.moshafName,
    server: a.server,
    surahs: a.surahList,
    missingSurahs: a.missingSurahs,
    timingRead: r.useTiming ? a.timingRead : null,
    timingRejected: r.timingRejected ?? null,
    bytes: {},
    timed: {},
    excluded: {},
  };
  for (const s of a.surahList) entry.bytes[s] = a.files[s].size;
  if (r.useTiming) {
    for (let s = 1; s <= 114; s++) {
      const t = a.timing[s];
      const reasons = [];
      if (!a.surahList.includes(s)) reasons.push('no audio file');
      if (!t || !t.ok) reasons.push(...(t?.problems ?? ['no timing']));
      else if (t.problems.some((p) => p.startsWith('short ayah'))) reasons.push(...t.problems);
      const fi = a.files[s];
      if (fi?.vbrTag === 'Xing') reasons.push('VBR file: not acoustically checked');
      const ps = persurah[String(r.moshafId)]?.[s];
      const ds = dense[String(r.moshafId)]?.[s];
      if (!passes(ps)) {
        if (!ds) reasons.push(ps ? `acoustic ${ps.pause}/${ps.n}` : 'not acoustically checked');
        else if (!passes(ds)) reasons.push(`acoustic ${ps?.pause ?? 0}/${ps?.n ?? 0}, dense ${ds.pause}/${ds.n}`);
      }
      if (reasons.length) {
        entry.excluded[s] = reasons;
        continue;
      }
      const timing = JSON.parse(fs.readFileSync(path.join(work, 'timing', `${a.timingRead}_${s}.json`), 'utf8'));
      const ayahs = timing.filter((x) => x.ayah > 0);
      if (ayahs.length !== counts[s - 1]) throw new Error(`count drift ${r.id} ${s}`);
      entry.timed[s] = {
        fingerprint: timingFingerprint(timing.map((x) => ({ ayah: x.ayah, startMs: x.start_time, endMs: x.end_time }))),
        acoustic: `${(ps?.pause ?? 0) + (passes(ps) ? 0 : ds?.pause ?? 0)}/${(ps?.n ?? 0) + (passes(ps) ? 0 : ds?.n ?? 0)}`,
      };
    }
  }
  out.push(entry);
  console.log(`${r.id.padEnd(16)} moshaf ${String(r.moshafId).padEnd(4)} surahs ${a.surahList.length} timed ${Object.keys(entry.timed).length}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(path.join(here, 'audit-results.json'), JSON.stringify({ auditedOn: '2026-10-17', passThreshold: PASS, reciters: out }, null, 1) + '\n');
