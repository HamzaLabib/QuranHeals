#!/usr/bin/env node
/**
 * Checks the generated Surah Preview dataset (mobile/assets/surah-preview/surah-preview.json) and prints its coverage:
 *  1. exactly 114 unique Surahs, numbered 1–114, in order;
 *  2. ayah counts and Makki/Madani equal Tanzil's raw quran-data.xml (read here directly, not through the derived JSON),
 *     6,236 ayahs in all;
 *  3. every Arabic main purpose present, verbatim as locked (source.lock.json SHA-256 per Surah);
 *  4. each section's text present exactly when its status is not 'unavailable'; 'quoted' only for the Mukhtasar purpose;
 *  5. every section cites sources that the dataset lists; no placeholder or test text;
 *  6. English presented only with a reviewed status.
 * Exit code 1 on any failure. Usage: node tools/surah-preview/validate.mjs [--file <dataset.json>]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const fileArg = process.argv.indexOf('--file');
const data = JSON.parse(readFileSync(fileArg > 0 ? process.argv[fileArg + 1] : join(root, 'mobile/assets/surah-preview/surah-preview.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(here, 'source.lock.json'), 'utf8'));
const xml = readFileSync(join(root, 'backend/data/quran/quran-data.xml'), 'utf8');
const tanzil = [...xml.matchAll(/<sura index="(\d+)" ayas="(\d+)"[^>]*type="(Meccan|Medinan)"/g)].map((m) => ({ n: Number(m[1]), ayas: Number(m[2]), type: m[3] }));

const failures = [];
const fail = (msg) => failures.push(msg);
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const STATUSES = new Set(['quoted', 'approved', 'pending-review', 'unavailable']);
const PLACEHOLDER = /TODO|TBD|lorem|placeholder|تجريبي|xxx|\.\.\.|…$/i;

if (data.format !== 1 || data.status !== 'official') fail('dataset is not format 1 / official');
if (tanzil.length !== 114) fail(`Tanzil XML: ${tanzil.length} suras parsed`);
if (tanzil.reduce((sum, s) => sum + s.ayas, 0) !== 6236) fail('Tanzil XML: ayah total is not 6236');
const sourceIds = new Set((data.sources ?? []).map((s) => s.id));
for (const id of ['mukhtasar-quranenc', 'tanzil']) if (!sourceIds.has(id)) fail(`source "${id}" not listed`);
if (!Array.isArray(data.surahs) || data.surahs.length !== 114) fail(`expected 114 surahs, got ${data.surahs?.length}`);
const seen = new Set();
const counts = { purposeAr: {}, purposeEn: {}, themesAr: {}, themesEn: {} };

(data.surahs ?? []).forEach((e, i) => {
  const n = i + 1;
  if (e.surah !== n) fail(`entry ${i}: surah ${e.surah}, expected ${n}`);
  if (seen.has(e.surah)) fail(`Surah ${e.surah} twice`);
  seen.add(e.surah);
  const t = tanzil[i];
  if (!t || t.n !== n) return fail(`Surah ${n}: no Tanzil record`);
  if (e.ayahCount !== t.ayas) fail(`Surah ${n}: ${e.ayahCount} ayahs, Tanzil ${t.ayas}`);
  if (e.revelation !== (t.type === 'Meccan' ? 'makki' : 'madani')) fail(`Surah ${n}: ${e.revelation}, Tanzil ${t.type}`);
  if (typeof e.purpose?.ar !== 'string' || !e.purpose.ar.trim()) fail(`Surah ${n}: no Arabic purpose`);
  else if (sha256(e.purpose.ar) !== lock.objectivesSha256[i]) fail(`Surah ${n}: Arabic purpose differs from the locked source text`);
  const texts = { purposeAr: e.purpose?.ar, purposeEn: e.purpose?.en, themesAr: e.themes?.ar, themesEn: e.themes?.en };
  for (const key of Object.keys(counts)) {
    const st = e.status?.[key];
    if (!STATUSES.has(st)) { fail(`Surah ${n}: ${key} status "${st}"`); continue; }
    counts[key][st] = (counts[key][st] ?? 0) + 1;
    const text = texts[key];
    const present = text !== null && text !== undefined;
    if (present !== (st !== 'unavailable')) fail(`Surah ${n}: ${key} text ${present ? 'present' : 'missing'} but status ${st}`);
    if (st === 'quoted' && key !== 'purposeAr') fail(`Surah ${n}: ${key} may not be "quoted" (only the Mukhtasar purpose is)`);
    for (const piece of [text].flat()) if (typeof piece === 'string' && PLACEHOLDER.test(piece)) fail(`Surah ${n}: ${key} looks like placeholder text`);
  }
  if (e.status?.purposeAr !== 'quoted') fail(`Surah ${n}: Arabic purpose must be the quoted Mukhtasar text`);
  if (!Array.isArray(e.sources) || !e.sources.includes('mukhtasar-quranenc') || !e.sources.includes('tanzil')) fail(`Surah ${n}: missing source references`);
  for (const id of e.sources ?? []) if (!sourceIds.has(id)) fail(`Surah ${n}: cites unlisted source "${id}"`);
});

console.log('Coverage (status: Surahs):');
for (const [key, byStatus] of Object.entries(counts)) console.log(`  ${key}: ${Object.entries(byStatus).map(([st, c]) => `${st} ${c}`).join(', ')}`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nAll checks passed: 114 Surahs; Tanzil facts; locked Arabic purposes; statuses, sources and texts consistent.');
