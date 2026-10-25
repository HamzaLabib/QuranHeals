#!/usr/bin/env node
/**
 * Surah Preview (عن السورة) data: builds mobile/assets/surah-preview/surah-preview.json (git-ignored) from
 *  - «من مقاصد السورة» of المختصر في تفسير القرآن الكريم (Tafsir Center for Quranic Studies), as QuranEnc publishes it on
 *    https://quranenc.com/ar/browse/arabic_mokhtasar/{n}: the text of the one span after that heading, tags stripped,
 *    entities decoded, whitespace trimmed — nothing else changed;
 *  - Makki/Madani and the ayah count from Tanzil's quran-data.xml, via the repository's pinned
 *    backend/assets/quran/surah-names.json.
 *
 * Every objective must match source.lock.json (its SHA-256, one per Surah): a changed page stops the import (the old
 * file stays) until the change is reviewed and the lock updated with --update-lock. The Mukhtasar has no «موضوعات
 * السورة» and its English objectives were withdrawn (README.md), so themes and English come only from a reviewed file:
 *
 *   tools/surah-preview/reviewed-content.json (optional; absent until a source is approved for use), shaped
 *   { sources: [{ id, title, publisher, url, retrieved, permission }], surahs: { "<n>": { themesAr?: { items: string[],
 *   status: 'approved' | 'pending-review' | 'rejected', sources: string[], review?: { reviewer, decidedAt, decision,
 *   action, basis } }, purposeEn?: …, themesEn?: … } } }
 *
 *   Every item must cite a listed source and carry a status; nothing in it may claim 'quoted'. For Topics it is written
 *   by review/apply.mjs from the reviewers' decisions; 'approved' and 'rejected' need `review` (the human decision), and
 *   'rejected' shows no topics in the app.
 *
 * «موضوعاتها» (Arabic topics) where reviewed-content.json has none: Quranpedia's official surah-information dump
 * (https://quranpedia.net/dumps/surahs.json.gz), pinned in quranpedia.lock.json (version, SHA-256 of the file and of
 * each Surah's topics), cached git-ignored in tools/surah-preview/source/. Extracted by quranpedia-topics.mjs (the
 * source's own items, verbatim; numbering, ayah ranges and sub-sections dropped) and always 'pending-review'. A new
 * dump version or a changed Surah stops the import until reviewed (--update-lock). topics-review.json (tracked) records,
 * per Surah, the item count, the source's citation and anything to review — never the text itself.
 * Surahs with no topics in Quranpedia (42, 44): al-Fairuzabadi's «بصائر ذوي التمييز» (Quranpedia book 186, its contents
 * file pinned in quranpedia.lock.json, cached in source/), the chapter on that Surah (matched by its exact title), its
 * «معظم مقصود السورة» sentence verbatim — also 'pending-review'.
 *
 * Each entry records each section's status ('quoted' | 'approved' | 'pending-review' | 'unavailable') and its sources.
 *
 * Usage: node tools/surah-preview/import.mjs [--cache <dir of 001.html…114.html>] [--quranpedia <surahs.json.gz>] [--update-lock]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { basairTopics, citation as topicsCitation, topics as extractTopics } from './quranpedia-topics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(root, 'mobile/assets/surah-preview/surah-preview.json');
const lockPath = join(here, 'source.lock.json');
const reviewedPath = join(here, 'reviewed-content.json');
const metadataPath = join(root, 'backend/assets/quran/surah-names.json');
const PAGE = (n) => `https://quranenc.com/ar/browse/arabic_mokhtasar/${n}`;
const HEADING = '<b>من مقاصد السورة:</b>';

const args = process.argv.slice(2);
const cacheDir = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;
const updateLock = args.includes('--update-lock');
const quranpediaArg = args.includes('--quranpedia') ? args[args.indexOf('--quranpedia') + 1] : null;
const QURANPEDIA_URL = 'https://quranpedia.net/dumps/surahs.json.gz';
const quranpediaLockPath = join(here, 'quranpedia.lock.json');
const quranpediaCache = join(here, 'source/quranpedia-surahs.json.gz');
const topicsReviewPath = join(here, 'topics-review.json');
const BASAIR_URL = 'https://quranpedia.net/books-contents/book-186.json';
const basairCache = join(here, 'source/quranpedia-book-186.json');
/** Surahs with no topics in Quranpedia: the chapter of «بصائر ذوي التمييز» on each, and that chapter's exact title. */
const BASAIR_CHAPTERS = { 42: { id: 145435, title: 'بصيرة فى.. حم. عسق' }, 44: { id: 145437, title: 'بصيرة فى.. حم. والكتاب المبين. انا أنزلناه' } };
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

/** The objective: the first <span> after the heading, exactly one heading per page. */
export function extractObjective(html) {
  const at = html.indexOf(HEADING);
  if (at < 0 || html.indexOf(HEADING, at + 1) >= 0) return null;
  const span = /<span>([\s\S]*?)<\/span>/.exec(html.slice(at, at + 2000));
  if (!span) return null;
  const text = decode(span[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

async function page(n) {
  const file = cacheDir ? join(cacheDir, `${String(n).padStart(3, '0')}.html`) : null;
  if (file && existsSync(file)) return readFileSync(file, 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(PAGE(n), { headers: { 'Accept-Language': 'ar' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      if (attempt >= 3) throw new Error(`${PAGE(n)}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
if (metadata.surahs?.length !== 114) throw new Error('surah-names.json: expected 114 Surahs');
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;

// The reviewed file, checked strictly: an item that does not cite a listed source or carries an unknown status stops the import.
const reviewed = existsSync(reviewedPath) ? JSON.parse(readFileSync(reviewedPath, 'utf8')) : { sources: [], surahs: {} };
const reviewedIds = new Set((reviewed.sources ?? []).map((source) => source.id));
// Defined below in the dataset itself; a reviewed file naming them (apply.mjs does) does not add them twice.
const BUILT_IN_SOURCES = new Set(['mukhtasar-quranenc', 'tanzil', 'quranpedia-surahs', 'basair-firuzabadi', 'tafsir-mawdui']);
const REVIEW_STATUSES = new Set(['approved', 'pending-review', 'rejected']);
// 'approved' only with the human decision behind it (review/apply.mjs): reviewer, time and decision number.
const humanReview = (review) => review && typeof review.reviewer === 'string' && review.reviewer.trim() && typeof review.decidedAt === 'string' && Number.isInteger(review.decision);
function reviewedSection(n, key, kind) {
  const section = reviewed.surahs?.[String(n)]?.[key];
  if (!section) return null;
  const sourcesOk = Array.isArray(section.sources) && section.sources.length > 0 && section.sources.every((id) => reviewedIds.has(id));
  if (section.status === 'rejected') {
    // Rejected by a reviewer: no text is shown for it (not the source's, not any other).
    if (!sourcesOk || !humanReview(section.review)) throw new Error(`reviewed-content.json: Surah ${n} ${key} rejected without listed sources and the reviewer's decision`);
    return { value: null, status: 'unavailable', rejected: true, sources: [], review: section.review };
  }
  const value = kind === 'list' ? section.items : section.text;
  const ok = kind === 'list' ? Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim()) : typeof value === 'string' && value.trim();
  if (!ok || !REVIEW_STATUSES.has(section.status) || !sourcesOk) {
    throw new Error(`reviewed-content.json: Surah ${n} ${key} needs text, a status (approved | pending-review | rejected) and listed sources`);
  }
  if (section.status === 'approved' && !humanReview(section.review)) {
    throw new Error(`reviewed-content.json: Surah ${n} ${key} is 'approved' without a reviewer's recorded decision (review/apply.mjs)`);
  }
  return { value: kind === 'list' ? value.map((item) => item.trim()) : value.trim(), status: section.status, sources: section.sources, review: section.review ?? null };
}

// Quranpedia's surah information: a local copy, the cache, or the official dump (downloaded once and cached).
const quranpediaLock = existsSync(quranpediaLockPath) ? JSON.parse(readFileSync(quranpediaLockPath, 'utf8')) : null;
async function quranpediaDump() {
  const file = quranpediaArg ?? (existsSync(quranpediaCache) ? quranpediaCache : null);
  let bytes;
  if (file) bytes = readFileSync(file);
  else {
    const res = await fetch(QURANPEDIA_URL, { headers: { 'User-Agent': 'QuranHeals-dev (surah-preview import)' } });
    if (!res.ok) throw new Error(`${QURANPEDIA_URL}: HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  if (!existsSync(quranpediaCache)) {
    mkdirSync(dirname(quranpediaCache), { recursive: true });
    writeFileSync(quranpediaCache, bytes);
  }
  const fileSha = createHash('sha256').update(bytes).digest('hex');
  if (quranpediaLock && quranpediaLock.sha256 !== fileSha && !updateLock) {
    console.error(`Quranpedia dump differs from quranpedia.lock.json (${fileSha}): review the new version, then run with --update-lock.`);
    process.exit(1);
  }
  const dump = JSON.parse(gunzipSync(bytes).toString('utf8'));
  if (!Array.isArray(dump.data) || dump.data.length !== 114 || dump.data.some((r, i) => r.surah !== i + 1)) throw new Error('Quranpedia dump: expected 114 Surahs in order');
  return { dump, fileSha, version: dump.license?.version ?? null };
}
const quranpedia = await quranpediaDump();

// «بصائر ذوي التمييز» (book 186): the cache, or downloaded once; pinned like the dump.
async function basairBook() {
  let bytes;
  if (existsSync(basairCache)) bytes = readFileSync(basairCache);
  else {
    const res = await fetch(BASAIR_URL, { headers: { 'User-Agent': 'QuranHeals-dev (surah-preview import)' } });
    if (!res.ok) throw new Error(`${BASAIR_URL}: HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(basairCache), { recursive: true });
    writeFileSync(basairCache, bytes);
  }
  const fileSha = createHash('sha256').update(bytes).digest('hex');
  if (quranpediaLock?.basair && quranpediaLock.basair.sha256 !== fileSha && !updateLock) {
    console.error(`«بصائر ذوي التمييز» differs from quranpedia.lock.json (${fileSha}): review it, then run with --update-lock.`);
    process.exit(1);
  }
  const book = JSON.parse(bytes.toString('utf8'));
  const titles = new Map();
  const walk = (chapters) => { for (const c of chapters ?? []) { titles.set(c.id, c.name); walk(c.children); } };
  walk(book.chapters);
  for (const [n, chapter] of Object.entries(BASAIR_CHAPTERS)) {
    if (titles.get(chapter.id) !== chapter.title) throw new Error(`«بصائر ذوي التمييز»: chapter ${chapter.id} is not «${chapter.title}» (Surah ${n})`);
  }
  return { book, fileSha };
}
const basair = await basairBook();
const TAFSIR_MAWDUI = /التفسير الموضوعي/;
// Read by hand while reviewing the 2026-10-24 version; never corrected in the data.
const REVIEW_NOTES = {
  1: "Topics are Quranpedia's own framing (no «ينظر» citation); the passage after them quotes al-Sa'di, «تيسير الكريم الرحمن» p. 17.",
  42: 'From «بصائر ذوي التمييز». It includes «استدعاء الرسول … محبة أهل البيت العترة الطاهرة», one interpretation of «إلا المودة في القربى» on which scholars differ; kept verbatim, for the reviewer. The book states the Surah is Makki by consensus (Tanzil agrees; Quranpedia\'s introduction calls it Madani).',
  44: 'From «بصائر ذوي التمييز»; ends with a Quranic quotation (ad-Dukhan 58) in the book\'s own text.',
  22: 'The source uses the heading «المجادلة بغير علم» for two separate passages (3–4 and 8–16), so it appears twice; kept as the source has it, for the reviewer.',
  21: "The source's last range reads «(١٠٧- ١٢١)» for a Surah of 112 ayahs: a typo in the source (ranges are not shown); the headings are al-Anbiya's.",
  18: 'Item 1 reads «الحمد الله /التبشير والإنذار» in the source: «الحمد الله» looks like a typo for «الحمد لله»; not corrected.',
};
const topicsReview = [];
const topicsHashes = [];

const surahs = [];
const hashes = [];
const changed = [];
for (let n = 1; n <= 114; n++) {
  const objective = extractObjective(await page(n));
  if (!objective) throw new Error(`Surah ${n}: no single «من مقاصد السورة» block on ${PAGE(n)}`);
  const hash = sha256(objective);
  hashes.push(hash);
  if (lock && lock.objectivesSha256[n - 1] !== hash) changed.push(n);
  const meta = metadata.surahs[n - 1];
  if (meta.surahNumber !== n || !['Meccan', 'Medinan'].includes(meta.revelationType)) throw new Error(`Surah ${n}: unexpected metadata`);
  // Topics: a reviewed entry if any, else Quranpedia's, pending review.
  const topicsHtml = quranpedia.dump.data[n - 1].information?.topics?.value ?? null;
  topicsHashes.push(topicsHtml ? sha256(topicsHtml) : null);
  const qpTopics = extractTopics(topicsHtml);
  const qpCitation = topicsHtml ? topicsCitation(topicsHtml) : null;
  const reviewedThemes = reviewedSection(n, 'themesAr', 'list');
  const basairChapter = qpTopics ? null : BASAIR_CHAPTERS[n] ?? null;
  const basairItems = basairChapter ? basairTopics(basair.book.contents, basairChapter.id) : null;
  const themesAr = reviewedThemes ?? (qpTopics ? {
    value: qpTopics,
    status: 'pending-review',
    sources: ['quranpedia-surahs', ...(qpCitation && TAFSIR_MAWDUI.test(qpCitation) ? ['tafsir-mawdui'] : [])],
  } : basairItems ? { value: basairItems, status: 'pending-review', sources: ['basair-firuzabadi'] } : null);
  const qpType = String(quranpedia.dump.data[n - 1].information?.surah_type?.value ?? '').trim();
  const flags = [
    ...(qpTopics ? [] : ['no-topics-in-quranpedia']),
    ...(basairItems ? ['classical-source: «بصائر ذوي التمييز» «معظم مقصود السورة», one sentence verbatim'] : []),
    ...(qpTopics && !qpCitation ? ['no-citation'] : []),
    ...(qpTopics && qpTopics.length > 10 ? ['long-list'] : []),
    ...(qpType && (qpType === 'مكية') !== (meta.revelationType === 'Meccan') ? [`classification: Quranpedia «${qpType}», Tanzil ${meta.revelationType}`] : []),
  ];
  const citationShown = qpCitation ?? (basairItems ? `«بصائر ذوي التمييز في لطائف الكتاب العزيز» للفيروزآبادي، تحقيق محمد علي النجار — Quranpedia book 186, chapter «${basairChapter.title}»` : null);
  topicsReview.push({
    surah: n,
    items: (qpTopics ?? basairItems)?.length ?? 0,
    status: reviewedThemes?.rejected ? 'rejected' : themesAr?.status ?? 'unavailable',
    ...(reviewedThemes?.review ? { review: { reviewer: reviewedThemes.review.reviewer, decidedAt: reviewedThemes.review.decidedAt, decision: reviewedThemes.review.decision, action: reviewedThemes.review.action ?? null, basis: reviewedThemes.review.basis ?? null } } : {}),
    citation: citationShown,
    flags,
    note: REVIEW_NOTES[n] ?? null,
  });
  const themesEn = reviewedSection(n, 'themesEn', 'list');
  const purposeEn = reviewedSection(n, 'purposeEn', 'text');
  surahs.push({
    surah: n,
    revelation: meta.revelationType === 'Meccan' ? 'makki' : 'madani',
    ayahCount: meta.ayahCount,
    purpose: { ar: objective, en: purposeEn?.value ?? null },
    themes: { ar: themesAr?.value ?? null, en: themesEn?.value ?? null },
    status: {
      purposeAr: 'quoted',
      purposeEn: purposeEn?.status ?? 'unavailable',
      themesAr: themesAr?.status ?? 'unavailable',
      themesEn: themesEn?.status ?? 'unavailable',
    },
    sources: [...new Set(['mukhtasar-quranenc', 'tanzil', ...[themesAr, themesEn, purposeEn].flatMap((section) => section?.sources ?? [])])],
  });
}

if (changed.length && !updateLock) {
  console.error(`Objectives differ from source.lock.json for Surahs ${changed.join(', ')}: review them, then run with --update-lock.`);
  process.exit(1);
}
const topicsChanged = quranpediaLock ? topicsHashes.map((h, i) => (h !== quranpediaLock.topicsSha256[i] ? i + 1 : null)).filter(Boolean) : [];
if (topicsChanged.length && !updateLock) {
  console.error(`Quranpedia topics differ from quranpedia.lock.json for Surahs ${topicsChanged.join(', ')}: review them, then run with --update-lock.`);
  process.exit(1);
}
if (!quranpediaLock || updateLock) {
  writeFileSync(quranpediaLockPath, `${JSON.stringify({
    source: QURANPEDIA_URL,
    version: quranpedia.version,
    sha256: quranpedia.fileSha,
    licence: 'Quranpedia data licence (LICENSE.md in the dump): free inside apps, no attribution required; contemporary works keep their own rights.',
    basair: { source: BASAIR_URL, sha256: basair.fileSha, chapters: BASAIR_CHAPTERS },
    topicsSha256: topicsHashes,
  }, null, 2)}\n`);
}
writeFileSync(topicsReviewPath, `${JSON.stringify({
  note: "Per Surah: the topics' status, item count, the source's own citation, and what to review. No text here: it is third-party (README.md).",
  quranpediaVersion: quranpedia.version,
  surahs: topicsReview,
}, null, 2)}\n`);
if (!lock || updateLock) {
  writeFileSync(lockPath, `${JSON.stringify({
    source: 'https://quranenc.com/ar/browse/arabic_mokhtasar/{n} — «من مقاصد السورة»',
    retrieved: new Date().toISOString().slice(0, 10),
    metadata: { file: 'backend/assets/quran/surah-names.json', sourceSha256: metadata.sourceSha256 },
    objectivesSha256: hashes,
  }, null, 2)}\n`);
}

const data = {
  format: 1,
  status: 'official',
  sources: [
    { id: 'mukhtasar-quranenc', title: 'المختصر في تفسير القرآن الكريم — من مقاصد السورة', publisher: 'مركز تفسير للدراسات القرآنية', url: 'https://quranenc.com/ar/browse/arabic_mokhtasar', retrieved: (lock && !updateLock ? lock.retrieved : new Date().toISOString().slice(0, 10)) },
    { id: 'tanzil', title: 'Tanzil quran-data.xml (Makki/Madani, ayah count)', publisher: 'Tanzil', url: metadata.source, retrieved: `pinned sha256 ${metadata.sourceSha256}` },
    { id: 'quranpedia-surahs', title: 'الموسوعة القرآنية — معلومات سور القرآن («موضوعاتها»)', publisher: 'Quranpedia.net', url: QURANPEDIA_URL, retrieved: `version ${quranpedia.version}` },
    { id: 'basair-firuzabadi', title: 'بصائر ذوي التمييز في لطائف الكتاب العزيز — «معظم مقصود السورة» (Surahs 42, 44)', publisher: 'الفيروزآبادي (ت 817هـ)، تحقيق محمد علي النجار — via Quranpedia.net', url: BASAIR_URL, retrieved: `pinned sha256 ${basair.fileSha.slice(0, 12)}` },
    { id: 'tafsir-mawdui', title: 'التفسير الموضوعي لسور القرآن الكريم (as cited by Quranpedia; volume/page per Surah in topics-review.json)', publisher: 'نخبة من علماء التفسير وعلوم القرآن', url: 'https://quranpedia.net', retrieved: `via Quranpedia ${quranpedia.version}` },
    ...(reviewed.sources ?? []).filter(({ id }) => !BUILT_IN_SOURCES.has(id)).map(({ id, title, publisher, url, retrieved }) => ({ id, title, publisher, url, retrieved })),
  ],
  surahs,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.partial`, `${JSON.stringify(data)}\n`);
renameSync(`${out}.partial`, out);
console.log(`Wrote ${out}: 114 Surahs, ${surahs.filter((s) => s.revelation === 'makki').length} Makki.`);
