// Chooses ONE whole file per surah for a reciter with several candidate sources (fetch.mjs, formats.py, compare.py),
// and writes <cache>/<recording>/selected.json: what the alignment uses and the app will stream. Never a splice: every
// surah is one unmodified file from one source.
//
// Rule (ahmed-salama): the primary source (better quality) where it is the SAME PERFORMANCE as the complete reference
// source (compare.py verdict 'same'), within 1 % of its duration (not cut) and with a clean MP3 stream; otherwise the
// complete reference source. Every choice records why. A surah neither source has (or whose chosen file is VBR, which
// the app cannot seek to an ayah) is left out with its reason.
//
// usage: node tools/quran-audio/surah-sources/select.mjs --recording ahmed-salama --primary way2quran --reference assabile
import fs from 'node:fs';
import path from 'node:path';

import { SURAH_SOURCES } from './sources.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
const root = path.join(process.env.LOCALAPPDATA ?? '.', 'QuranHeals', 'surah-cache', args.recording);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const rec = SURAH_SOURCES[args.recording];
const load = (id) => ({ id, ...rec.sources[id], manifest: readJson(path.join(root, id, 'manifest.json')).files, formats: readJson(path.join(root, id, 'formats.json')) });
const P = load(args.primary);
const R = load(args.reference);
// compare.py results (primary pieces located in the reference; split runs merged) and the reverse direction (reference
// pieces located in the primary: nothing recited is missing from the primary's file).
const compare = Object.assign({}, ...fs.readdirSync(root).filter((f) => /^compare-(w2q-vs-|part\d+).*\.json$/.test(f)).map((f) => readJson(path.join(root, f))));
const reverse = fs.existsSync(path.join(root, 'compare-reverse.json')) ? readJson(path.join(root, 'compare-reverse.json')) : {};

const pick = (src, s, why) => {
  const m = src.manifest[s];
  const f = src.formats[s];
  return { source: src.id, url: m.url, bytes: m.bytes, sha256: m.sha256, etag: m.etag ?? null, lastModified: m.lastModified ?? null, acceptRanges: m.acceptRanges ?? null,
    file: path.join(root, src.id, `${String(s).padStart(3, '0')}.mp3`), format: { mode: f.mode, kbps: f.kbps, sampleRateHz: f.sampleRates[0], channels: f.channels[0], durationMs: f.durationMs }, why };
};
const surahs = {};
const left = {};
for (let s = 1; s <= 114; s++) {
  const p = P.manifest[s]?.ok && P.formats[s] && !P.formats[s].error ? P : null;
  const r = R.manifest[s]?.ok && R.formats[s] && !R.formats[s].error ? R : null;
  const c = compare[String(s)];
  let choice = null;
  if (p && r && c) {
    const ratio = P.formats[s].durationMs / R.formats[s].durationMs;
    const clean = !(P.formats[s].problems ?? []).length && P.formats[s].mode === 'cbr';
    const rv = reverse[String(s)];
    // Within 1 % of the reference's length, or found in full in both directions (only padding differs).
    const whole = Math.abs(ratio - 1) <= 0.01 || rv?.verdict === 'same';
    if (c.verdict === 'same' && whole && clean) choice = pick(P, s, `${P.id}: the same performance as ${R.id} (${c.found}/${c.pieces} pieces at a constant lag, spread ${c.lagSpreadMs} ms)${Math.abs(ratio - 1) <= 0.01 ? `, duration ratio ${ratio.toFixed(3)}` : `; ${((P.formats[s].durationMs - R.formats[s].durationMs) / 1000).toFixed(1)} s shorter, yet every piece of ${R.id}'s file is in it too (${rv.found}/${rv.pieces}): padding only`}, clean ${P.formats[s].kbps} kbps CBR stream`);
    else choice = pick(R, s, `${R.id}: ${P.id}'s file is ${c.verdict !== 'same' ? `not the same performance throughout (${c.verdict}: ${c.found}/${c.pieces} pieces, lag spread ${c.lagSpreadMs} ms)` : !whole ? `${((1 - ratio) * 100).toFixed(1)} % shorter or longer and ${rv ? `${R.id}'s file is not all in it (${rv.verdict}: ${rv.found}/${rv.pieces})` : 'not checked the other way'} (cut or edited)` : 'not a clean CBR stream'}`);
  } else if (r) choice = pick(R, s, `${R.id}: ${p ? `${P.id} not compared` : `${P.id} has no file (HTTP ${P.manifest[s]?.status ?? 'none'})`}`);
  else if (p) choice = pick(P, s, `${P.id}: ${R.id} has no file`);
  if (!choice) { left[s] = 'no source has this surah'; continue; }
  if (choice.format.mode !== 'cbr') { left[s] = `the chosen file is ${choice.format.mode.toUpperCase()}: the app cannot seek it to an ayah exactly`; continue; }
  surahs[s] = choice;
}
const out = { kind: 'surah-source-selection', version: 1, recording: args.recording, nameEn: rec.nameEn, nameAr: rec.nameAr, createdAt: new Date().toISOString(), primary: P.id, reference: R.id,
  rule: 'primary where the same performance as the complete reference, within 1 % of its duration, clean CBR; else the reference; one unmodified file per surah, never spliced', surahs, left,
  bySource: Object.fromEntries([P.id, R.id].map((id) => [id, Object.values(surahs).filter((x) => x.source === id).length])) };
fs.writeFileSync(path.join(root, 'selected.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ selected: Object.keys(surahs).length, bySource: out.bySource, left }));
