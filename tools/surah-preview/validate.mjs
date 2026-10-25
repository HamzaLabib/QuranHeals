#!/usr/bin/env node
/**
 * Checks the generated Surah Preview dataset (mobile/assets/surah-preview/surah-preview.json) and prints its coverage:
 *  1. exactly 114 unique Surahs, numbered 1–114, in order;
 *  2. ayah counts and Makki/Madani equal Tanzil's raw quran-data.xml (read here directly, not through the derived JSON),
 *     6,236 ayahs in all;
 *  3. every Arabic main purpose present, verbatim as locked (source.lock.json SHA-256 per Surah);
 *  4. each section's text present exactly when its status is not 'unavailable'; 'quoted' only for the Mukhtasar purpose;
 *  5. every section cites sources that the dataset lists; no placeholder or test text;
 *  6. English presented only with a reviewed status;
 *  7. Arabic topics carry a source of their own; Quranpedia's are 'pending-review' and, with the pinned dump cached,
 *     are derived again from it (quranpedia-topics.mjs) and must be exactly the ones shipped, for that very Surah;
 *  8. 'approved' only with a human reviewer's recorded decision (reviewed-content.json, written by review/apply.mjs:
 *     reviewer, time, decision number) and exactly its text; a rejected Surah shows no topics;
 *  9. the owner's editorial approval (owner-approval.json), when present: one per Surah, bound by SHA-256 to exactly the
 *     Arabic purpose and topics shipped (a changed text needs the owner's approval again). Reported apart from the
 *     scholarly statuses above, which it never changes.
 * Exit code 1 on any failure. Usage: node tools/surah-preview/validate.mjs [--file <dataset.json>]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { basairTopics, topics as extractTopics } from './quranpedia-topics.mjs';

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

// 7. Topics: a source of their own; Quranpedia's against the pinned dump (when cached).
(data.surahs ?? []).forEach((e, i) => {
  if (e.themes?.ar && !(e.sources ?? []).some((id) => id !== 'mukhtasar-quranenc' && id !== 'tanzil')) fail(`Surah ${i + 1}: topics without a source of their own`);
});
// 8. Approval provenance: what the app shows as approved is exactly what a named reviewer decided.
const reviewedPath = join(here, 'reviewed-content.json');
const reviewedDoc = existsSync(reviewedPath) ? JSON.parse(readFileSync(reviewedPath, 'utf8')) : { surahs: {} };
let approvedChecked = 0;
(data.surahs ?? []).forEach((e, i) => {
  const n = i + 1;
  for (const [key, text] of [['themesAr', e.themes?.ar], ['themesEn', e.themes?.en], ['purposeEn', e.purpose?.en]]) {
    const section = reviewedDoc.surahs?.[String(n)]?.[key];
    if (section?.status === 'rejected' && text != null) fail(`Surah ${n}: ${key} was rejected by a reviewer but has text`);
    if (e.status?.[key] !== 'approved') continue;
    approvedChecked += 1;
    const r = section?.review;
    if (section?.status !== 'approved' || !r || typeof r.reviewer !== 'string' || !r.reviewer.trim() || typeof r.decidedAt !== 'string' || !Number.isInteger(r.decision)) {
      fail(`Surah ${n}: ${key} is approved without a reviewer's recorded decision`);
    } else if (JSON.stringify(text) !== JSON.stringify(key === 'purposeEn' ? section.text?.trim() : section.items?.map((item) => item.trim()))) {
      fail(`Surah ${n}: ${key} differs from the text the reviewer approved`);
    }
  }
});
// 9. Owner approval: separate from scholarly review; exact wording only.
const ownerPath = join(here, 'owner-approval.json');
let ownerApproved = null;
if (existsSync(ownerPath)) {
  const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
  ownerApproved = 0;
  if (owner.kind !== 'owner-editorial-approval' || !owner.approvedBy || !owner.approvedOn) fail('owner-approval.json: not an owner editorial approval record');
  if (!Array.isArray(owner.surahs) || owner.surahs.length !== 114) fail(`owner-approval.json: ${owner.surahs?.length} Surahs, expected 114`);
  (data.surahs ?? []).forEach((e, i) => {
    const a = owner.surahs?.[i];
    if (!a || a.surah !== i + 1) return fail(`Surah ${i + 1}: no owner approval entry`);
    const purposeOk = typeof e.purpose?.ar === 'string' && sha256(e.purpose.ar) === a.purposeArSha256;
    const themesOk = e.themes?.ar != null && sha256(JSON.stringify(e.themes.ar)) === a.themesArSha256;
    if (!purposeOk) fail(`Surah ${i + 1}: Arabic purpose differs from the wording the owner approved`);
    if (!themesOk) fail(`Surah ${i + 1}: Arabic topics differ from the wording the owner approved`);
    if (purposeOk && themesOk) ownerApproved += 1;
  });
}
const qpLockPath = join(here, 'quranpedia.lock.json');
const qpCache = join(here, 'source/quranpedia-surahs.json.gz');
let topicsChecked = 0;
let rangesChecked = 0;
let rangesToLastAyah = 0;
if (existsSync(qpLockPath) && existsSync(qpCache)) {
  const bytes = readFileSync(qpCache);
  const qpLock = JSON.parse(readFileSync(qpLockPath, 'utf8'));
  if (createHash('sha256').update(bytes).digest('hex') !== qpLock.sha256) fail('cached Quranpedia dump does not match quranpedia.lock.json');
  const dump = JSON.parse(gunzipSync(bytes).toString('utf8'));
  (data.surahs ?? []).forEach((e, i) => {
    // Approved (checked in 8) or rejected Topics are a reviewer's, not the dump's.
    if (!(e.sources ?? []).includes('quranpedia-surahs') || e.status?.themesAr !== 'pending-review') return;
    topicsChecked += 1;
    const html = dump.data[i]?.information?.topics?.value ?? null;
    const expected = extractTopics(html);
    if (JSON.stringify(e.themes?.ar) !== JSON.stringify(expected)) fail(`Surah ${i + 1}: topics differ from the pinned Quranpedia dump`);
    // Association, independently of the extraction: the outline's ayah ranges must lie within this Surah (Tanzil's count).
    // A range's end, or a single ayah's number.
    const ends = [...String(html).matchAll(/\(\s*[0-9٠-٩]+\s*(?:[-–]\s*([0-9٠-٩]+)\s*)?\)|\(\s*([0-9٠-٩]+)\s*\)/g)]
      .map((m) => m[0].match(/[0-9٠-٩]+/g).at(-1))
      .map((d) => Number(d.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))));
    if (ends.length) {
      rangesChecked += 1;
      // Known typos in the source's ranges (reviewed by hand; the ranges are never shown): exactly these values pass.
      const KNOWN_RANGE_TYPOS = { 21: 121 }; // al-Anbiya's last heading «(١٠٧- ١٢١)» for its 112 ayahs.
      const beyond = ends.filter((end) => end > tanzil[i].ayas && end !== KNOWN_RANGE_TYPOS[i + 1]);
      if (beyond.length) fail(`Surah ${i + 1}: its topics' ayah ranges reach ${Math.max(...beyond)}, beyond its ${tanzil[i].ayas} ayahs`);
      if (Math.max(...ends) === tanzil[i].ayas) rangesToLastAyah += 1;
    }
  });
  // Surahs 42 and 44: «بصائر ذوي التمييز», from the chapters pinned in the lock.
  const bookCache = join(here, 'source/quranpedia-book-186.json');
  if (qpLock.basair && existsSync(bookCache)) {
    const bookBytes = readFileSync(bookCache);
    if (createHash('sha256').update(bookBytes).digest('hex') !== qpLock.basair.sha256) fail('cached «بصائر ذوي التمييز» does not match quranpedia.lock.json');
    const book = JSON.parse(bookBytes.toString('utf8'));
    (data.surahs ?? []).forEach((e, i) => {
      if (!(e.sources ?? []).includes('basair-firuzabadi') || e.status?.themesAr !== 'pending-review') return;
      topicsChecked += 1;
      const chapter = qpLock.basair.chapters[String(i + 1)];
      if (!chapter) return fail(`Surah ${i + 1}: cites «بصائر ذوي التمييز» but no chapter is pinned for it`);
      if (JSON.stringify(e.themes?.ar) !== JSON.stringify(basairTopics(book.contents, chapter.id))) fail(`Surah ${i + 1}: topics differ from the pinned «بصائر ذوي التمييز» chapter`);
    });
  }
}

console.log('Coverage (status: Surahs):');
for (const [key, byStatus] of Object.entries(counts)) console.log(`  ${key}: ${Object.entries(byStatus).map(([st, c]) => `${st} ${c}`).join(', ')}`);
if (ownerApproved !== null) console.log(`Owner editorial approval (Arabic purpose + topics, exact wording): ${ownerApproved}/114 — separate from scholarly review.`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nAll checks passed: 114 Surahs; Tanzil facts; locked Arabic purposes; statuses, sources and texts consistent; ${topicsChecked} pending topic lists re-derived from their pinned sources; ${approvedChecked} approved section(s), each with its reviewer's recorded decision; ${rangesChecked} outlines' ayah ranges within their own Surah (${rangesToLastAyah} reaching exactly its last ayah).`);
