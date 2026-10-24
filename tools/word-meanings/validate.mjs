#!/usr/bin/env node
/**
 * Validates the Word Meanings dataset against independent sources and writes the validation report:
 *  - completeness: every bracketed word in the original is an entry or a recognised quotation; ids 1…N, each on
 *    exactly one page; repeated words and explanations kept;
 *  - references: Surahs 1–114 in the source's order (its headings against Tanzil's names), ayahs within each Surah;
 *  - text: each entry's Quranic word found in its ayah's verified Tanzil text (compared by base letters only, as the
 *    two editions mark vowels, sukun and hamza differently);
 *  - pagination: each entry's page (the reader's page table) against Quran Foundation's QCF V1 word records, the
 *    edition the reader draws (backend/data/mushaf-sync, local only), and that no ayah is split across two pages.
 *
 *   node tools/word-meanings/validate.mjs [--date YYYY-MM-DD]
 *
 * Writes docs/word-meanings/validation-<date>.md (tracked: counts and references only, no King Fahd text) and
 * tools/word-meanings/output/validation-<date>.json (git-ignored: the same with the entries' text). Exits 1 on any
 * failed check.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { documentParagraphs, letterSkeleton as skeleton, PAGE_COUNT, readZipEntry } from './ghareeb-docx.mjs';
import { buildFromSource, datasetPath, lockPath, pinMismatch, renderDataset, sourcePath } from './import.mjs';

const toolDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolDir, '../..');
const dateArg = process.argv.indexOf('--date');
const date = dateArg > 0 ? process.argv[dateArg + 1] : new Date().toISOString().slice(0, 10);

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const bytes = readFileSync(sourcePath);
const pinProblem = pinMismatch(bytes, lock);
if (pinProblem) throw new Error(`${sourcePath}: ${pinProblem}`);
const { dataset, parsed } = buildFromSource(bytes, lock);
const { entries, report } = parsed;
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

// Completeness ─────────────────────────────────────────────────────────────────────────────────────────────────────
const paragraphs = documentParagraphs(readZipEntry(bytes, 'word/document.xml').toString('utf8'));
const bracketPairs = paragraphs.reduce((n, p) => n + [...p.matchAll(/﴿[^﴿﴾]*﴾/g)].length, 0);
check('Every bracketed word is an entry or a quotation inside an explanation', bracketPairs === entries.length + report.quotations.length, `${bracketPairs} bracketed = ${entries.length} entries + ${report.quotations.length} quotations`);
check('Every paragraph accounted for', paragraphs.length === report.emptyParagraphs + report.surahHeadings.length + report.ayahParagraphs + report.continuations.length,
  `${paragraphs.length} = ${report.emptyParagraphs} empty + ${report.surahHeadings.length} headings + ${report.ayahParagraphs} ayah + ${report.continuations.length} continuation`);
const placed = dataset.pages.flat().map((row) => row[0]);
check('Entry ids 1…N, each on exactly one page (none dropped or duplicated)', placed.length === entries.length && new Set(placed).size === entries.length && placed.every((id) => id >= 1 && id <= entries.length), `${placed.length} placed of ${entries.length}`);
check('No empty word or explanation', entries.every((e) => e.word.trim() !== '' && e.explanation.trim() !== ''), 'checked on every entry');
// The signs of a quotation mistaken for an entry: an explanation that only punctuates, or stops at a colon.
const fragments = entries.filter((e) => !/[ء-ي]/.test(e.explanation) || /:\s*$/.test(e.explanation));
check('No explanation is a fragment (only punctuation, or ending at a colon)', fragments.length === 0, fragments.length ? `fragments: ${fragments.map((e) => `#${e.id} (${e.surah}:${e.ayah})`).join(', ')}` : 'checked on every entry');
const onDisk = existsSync(datasetPath) ? readFileSync(datasetPath, 'utf8') : null;
check('The app dataset is identical to a fresh build (deterministic import)', onDisk === renderDataset(dataset), datasetPath.replace(`${repoRoot}\\`, '').replace(`${repoRoot}/`, ''));

// Repeats (kept: each is its own ayah's entry) ────────────────────────────────────────────────────────────────────────
const tally = (key) => {
  const seen = new Map();
  for (const e of entries) seen.set(key(e), (seen.get(key(e)) ?? 0) + 1);
  return [...seen.values()].filter((n) => n > 1);
};
const repeatedWordAndExplanation = tally((e) => `${e.word}|${e.explanation}`);
const repeatedInSameAyah = tally((e) => `${e.surah}:${e.ayah}|${e.word}`);
const repeats = {
  wordsExplainedIdenticallyElsewhere: { groups: repeatedWordAndExplanation.length, entries: repeatedWordAndExplanation.reduce((a, b) => a + b, 0) },
  sameWordTwiceInOneAyah: { groups: repeatedInSameAyah.length, entries: repeatedInSameAyah.reduce((a, b) => a + b, 0) },
};

// References ─────────────────────────────────────────────────────────────────────────────────────────────────────
const counts = JSON.parse(readFileSync(resolve(repoRoot, 'tools/quran-verification/surah-counts.json'), 'utf8')).counts;
const names = JSON.parse(readFileSync(resolve(repoRoot, 'tools/quran-verification/surah-names.json'), 'utf8')).surahs;
const headingMismatches = report.surahHeadings
  .map((h, i) => ({ surah: i + 1, ok: skeleton(h.text.replace(/^سورة\s+/, '')) === skeleton(names[i].nameArabic) }))
  .filter((h) => !h.ok).map((h) => h.surah);
check('114 Surah headings, in order, matching Tanzil\'s Surah names (base letters)', report.surahHeadings.length === 114 && headingMismatches.length === 0, headingMismatches.length ? `differ: Surahs ${headingMismatches.join(', ')}` : 'all 114 match');
const badRefs = entries.filter((e) => e.surah < 1 || e.surah > 114 || e.ayah < 1 || e.ayahEnd < e.ayah || e.ayahEnd > counts[e.surah - 1]);
check('Every Surah and ayah reference exists', badRefs.length === 0, badRefs.length ? `invalid: ${badRefs.map((e) => e.id).join(', ')}` : `${entries.length} entries checked against 114 Surahs / 6,236 ayahs`);
const ayahOrder = (e) => e.surah * 1000 + e.ayah;
const outOfOrder = entries.filter((e, i) => i > 0 && ayahOrder(e) < ayahOrder(entries[i - 1]));
check('Entries follow Mushaf order', outOfOrder.length === 0, outOfOrder.length ? `out of order: ${outOfOrder.map((e) => e.id).join(', ')}` : 'non-decreasing Surah:ayah');

// Text ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const tanzil = new Map();
for (const line of readFileSync(resolve(repoRoot, 'tools/quran-verification/input/quran-uthmani.txt'), 'utf8').split(/\r?\n/)) {
  const [s, a, text] = line.split('|');
  if (text !== undefined) tanzil.set(`${s}:${a}`, text);
}
const notFound = [];
for (const e of entries) {
  let ayahText = '';
  for (let a = e.ayah; a <= e.ayahEnd; a++) ayahText += tanzil.get(`${e.surah}:${a}`) ?? '';
  if (!skeleton(ayahText).includes(skeleton(e.word))) notFound.push(e);
}
check('Each Quranic word is found in its ayah (verified Tanzil text, base letters)', notFound.length === 0, notFound.length ? `not found: ${notFound.length} — ${notFound.map((e) => `#${e.id} (${e.surah}:${e.ayah})`).join(', ')}` : `${entries.length} of ${entries.length}`);

// Pagination ─────────────────────────────────────────────────────────────────────────────────────────────────────
const syncDir = resolve(repoRoot, 'backend/data/mushaf-sync');
const snapshot = existsSync(syncDir) ? readdirSync(syncDir).find((name) => /^records-\d+\.json\.gz$/.test(name)) : undefined;
const pageByEntry = new Map();
dataset.pages.forEach((rows, i) => rows.forEach((row) => pageByEntry.set(row[0], i + 1)));
const firstVerseId = [0];
for (const n of counts) firstVerseId.push(firstVerseId.at(-1) + n);
let qcf = null;
if (snapshot) {
  const records = JSON.parse(gunzipSync(readFileSync(resolve(syncDir, snapshot))).toString('utf8'));
  const pagesOfVerse = new Map();
  for (const r of records) {
    if (r.record_type !== 'mushaf_word' || r.mushaf_id !== 2) continue;
    if (!pagesOfVerse.has(r.verse_id)) pagesOfVerse.set(r.verse_id, new Set());
    pagesOfVerse.get(r.verse_id).add(r.page_number);
  }
  const split = [...pagesOfVerse.values()].filter((s) => s.size > 1).length;
  check('No ayah is split across two QCF V1 pages', pagesOfVerse.size === 6236 && split === 0, `${pagesOfVerse.size} ayahs with words, ${split} on more than one page (snapshot ${snapshot})`);
  const disagree = entries.filter((e) => {
    for (let a = e.ayah; a <= e.ayahEnd; a++) {
      const pages = pagesOfVerse.get(firstVerseId[e.surah - 1] + a);
      if (!pages || pages.size !== 1 || !pages.has(pageByEntry.get(e.id))) return true;
    }
    return false;
  });
  check('Each entry is on the QCF V1 page of its ayah (Quran Foundation word records)', disagree.length === 0, disagree.length ? `disagree: ${disagree.map((e) => e.id).join(', ')}` : `${entries.length} of ${entries.length}`);
  qcf = { snapshot, ayahs: pagesOfVerse.size, split, disagree: disagree.length };
} else {
  check('Each entry is on the QCF V1 page of its ayah (Quran Foundation word records)', false, 'NOT CHECKED: no local Content Sync snapshot in backend/data/mushaf-sync');
}
check('Pages 1–604, every page has at least one entry', dataset.pages.length === PAGE_COUNT && dataset.pages.every((p) => p.length > 0), `${dataset.pages.filter((p) => p.length > 0).length} of ${PAGE_COUNT}`);

// Statistics ─────────────────────────────────────────────────────────────────────────────────────────────────────
const perPage = dataset.pages.map((rows, i) => ({ page: i + 1, entries: rows.length, surahs: [...new Set(rows.map((r) => r[1]))] }));
const sorted = [...perPage].sort((a, b) => a.entries - b.entries || a.page - b.page);
const median = sorted[Math.floor(sorted.length / 2)].entries;
const multiSurah = perPage.filter((p) => p.surahs.length > 1);
const representative = [1, 2, 61, 125, 604].map((page) => ({ page, entries: perPage[page - 1].entries, refs: dataset.pages[page - 1].map((r) => `${r[1]}:${r[2]}${r[3] !== r[2] ? `-${r[3]}` : ''}`) }));

const failed = checks.filter((c) => !c.ok);
const summary = {
  date,
  source: { file: lock.file, url: lock.url, bytes: lock.bytes, md5: lock.md5, sha1: lock.sha1, sha256: lock.sha256, retrieved: lock.retrieved },
  counts: dataset.counts,
  checks,
  repeats,
  qcf,
  perPage: { min: sorted[0], max: sorted.at(-1), median, fewest: sorted.slice(0, 10), most: sorted.slice(-10).reverse(), multiSurahPages: multiSurah.length },
  representative,
  structure: { ayahRanges: report.ayahRanges, continuations: report.continuations, quotations: report.quotations, referenceCorrections: dataset.referenceCorrections, withoutColon: report.withoutColon },
};

// The detailed (git-ignored) output: the same, with the text of everything a reviewer would look at.
const byId = new Map(entries.map((e) => [e.id, e]));
const detailed = {
  ...summary,
  text: {
    notFoundInAyah: notFound,
    withoutColon: report.withoutColon.map((w) => byId.get(w.id)),
    continuationsJoined: report.continuations.map((c) => ({ ...c, entries: entries.filter((e) => e.surah === c.surah && e.ayah === c.ayah) })),
    ayahRanges: report.ayahRanges.map((r) => entries.filter((e) => e.surah === r.surah && e.ayah === r.ayah)),
  },
};
const outputDir = resolve(toolDir, 'output');
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, `validation-${date}.json`), `${JSON.stringify(detailed, null, 2)}\n`);

const n = (value) => value.toLocaleString('en-US');
const md = [];
md.push(`# Word Meanings (المعاني) — dataset validation, ${date}`, '');
md.push('Generated by `node tools/word-meanings/validate.mjs`. Counts and references only: the King Fahd Complex text itself is kept out of Git (its redistribution terms are unresolved; see tools/word-meanings/README.md). The same report with the entries\' text is written to the git-ignored `tools/word-meanings/output/validation-' + date + '.json`.', '');
md.push(`**Result: ${failed.length === 0 ? 'all checks passed' : `${failed.length} check(s) FAILED`}.**`, '');
md.push('## Source', '');
md.push(`| | |`, `|---|---|`);
md.push(`| Work | ${lock.title} (${lock.titleEnglish}) |`, `| Publisher | ${lock.publisher} (${lock.publisherEnglish}) |`, `| Platform | ${lock.platform} |`, `| File | ${lock.url} |`);
md.push(`| Size | ${n(lock.bytes)} bytes |`, `| MD5 (published) | \`${lock.md5}\` — matches |`, `| SHA-1 (published) | \`${lock.sha1}\` — matches |`, `| SHA-256 (computed) | \`${lock.sha256}\` |`);
md.push(`| Listing | created ${lock.listing.created}, last modified ${lock.listing.lastModified}, ${lock.listing.update} |`, `| HTTP Last-Modified | ${lock.httpLastModified} |`, `| Retrieved | ${lock.retrieved} |`, '');
md.push('## Checks', '');
md.push('| Check | Result | Detail |', '|---|---|---|');
for (const c of checks) md.push(`| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail} |`);
md.push('', '## Coverage', '');
md.push(`- Entries: **${n(dataset.counts.entries)}**, on **${dataset.counts.pagesWithEntries} of 604** pages (pages without entries: ${604 - dataset.counts.pagesWithEntries}).`);
md.push(`- Per page: fewest ${sorted[0].entries} (page ${sorted[0].page}), median ${median}, most ${sorted.at(-1).entries} (page ${sorted.at(-1).page}).`);
md.push(`- Fewest entries: ${summary.perPage.fewest.map((p) => `p.${p.page} (${p.entries})`).join(', ')}.`);
md.push(`- Most entries: ${summary.perPage.most.map((p) => `p.${p.page} (${p.entries})`).join(', ')}.`);
md.push(`- Pages whose entries come from more than one Surah: ${multiSurah.length}.`);
md.push(`- Repeats kept as separate entries (each belongs to its own ayah): ${n(repeats.wordsExplainedIdenticallyElsewhere.entries)} entries in ${n(repeats.wordsExplainedIdenticallyElsewhere.groups)} groups share both word and explanation with another entry; ${repeats.sameWordTwiceInOneAyah.entries} entries in ${repeats.sameWordTwiceInOneAyah.groups} groups repeat a word within one ayah.`);
md.push('- English explanations: **none** (the source is Arabic only; no verified English dataset has been imported).', '');
md.push('## Representative pages', '');
md.push('| Page | Entries | Ayahs (in order) |', '|---|---|---|');
for (const r of representative) md.push(`| ${r.page} | ${r.entries} | ${r.refs.join(', ')} |`);
md.push('', '## Source structure handled explicitly', '');
md.push(`- **Pairs of ayahs explained together** (${report.ayahRanges.length}): ${report.ayahRanges.map((r) => `${r.surah}:${r.ayah}–${r.ayahEnd} (paragraph ${r.paragraph})`).join('; ')}. Kept as one entry each with its ayah range; both ayahs share a page.`);
md.push(`- **Continuation paragraphs** (${report.continuations.length}), each joined to the end of the previous ayah's paragraph exactly as written (with the source's own trailing space, else one space): ${report.continuations.map((c) => `paragraph ${c.paragraph} → ${c.surah}:${c.ayah} (${c.joinedWith})`).join('; ')}.`);
md.push(`- **Quotations inside an explanation** (${report.quotations.length}): a bracketed Quranic word or ayah that follows a colon (another ayah, «قوله تعالى: ﴿…﴾», ${report.quotations.filter((q) => q.reference).length} of them with their [Surah: ayah] reference; or a word of the same ayah in a grammatical note or a second opinion), kept as part of that explanation, never an entry: ${report.quotations.map((q) => `${q.surah}:${q.ayah}`).join(', ')}.`);
md.push(`- **Reference corrections** (${dataset.referenceCorrections.length}, tools/word-meanings/reference-corrections.json; approved ${JSON.parse(readFileSync(resolve(toolDir, 'reference-corrections.json'), 'utf8')).approved ?? 'NOT YET APPROVED'}): ${dataset.referenceCorrections.map((c) => `#${c.id} listed under ${c.surah}:${c.sourceAyah}, shown as ${c.surah}:${c.ayah}`).join('; ') || 'none'}. Only the ayah reference changes; the word and explanation stay as written.`);
md.push(`- **Entries without a colon** after the word (${report.withoutColon.length}): parsed the same way: ${report.withoutColon.map((w) => `#${w.id} (${w.surah}:${w.ayah})`).join(', ')}.`);
md.push('- **Line breaks**: 6,283 plain line breaks, each between two entries of one ayah (checked: none inside a word or explanation).', '');
md.push('## Notes', '');
md.push(`- The platform documents a developer package with the fields ${lock.listing.documentedFields.join(', ')}; it serves only this .docx, which has none of them. Pages are therefore taken from the reader's own page table (mobile/src/mushaf/generated/pageStarts.ts) and checked against Quran Foundation's QCF V1 word records, never from another edition's pagination.`);
md.push('- Words are compared by base letters only because the King Fahd and Tanzil encodings mark sukun, hamza, small letters and open tanween differently; the words and explanations shown in the app are the source\'s own, unchanged.');
mkdirSync(resolve(repoRoot, 'docs/word-meanings'), { recursive: true });
writeFileSync(resolve(repoRoot, `docs/word-meanings/validation-${date}.md`), `${md.join('\n')}\n`);

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
process.exitCode = failed.length === 0 ? 0 : 1;
