// Reads King Fahd Complex's «الميسر في غريب القرآن الكريم» (MuyassarGhareeb.docx, the file its developer platform
// serves) into entries, and groups them by the page of our QCF V1 Mushaf. Node built-ins only (no npm packages), so it
// runs before `npm ci`. Every string is kept exactly as the source has it: nothing is trimmed inside, normalized,
// corrected or reworded. Anything the rules below do not recognise stops the import rather than being guessed at.
//
// The source's structure (surveyed 2026-10-24, documented in tools/word-meanings/README.md):
//  - one paragraph per Surah heading («سورة الفاتحة» …), 114 in Mushaf order;
//  - one paragraph per ayah: «(n) ﴿word﴾: explanation. ﴿word﴾: explanation.» — the ayah number in parentheses, then
//    each selected Quranic word or phrase in ornate brackets, a colon (absent in a few entries) and its explanation;
//    two paragraphs explain a pair of ayahs together: «(1، 2)» and «(20،19)»;
//  - a few paragraphs continue the previous ayah's last explanation (Word split one paragraph in two): they do not
//    begin with an ayah number and are joined back to it;
//  - a few brackets inside an explanation quote the Quran: another ayah («في قوله تعالى: ﴿…﴾ [الأنفال: 30]»), or a word
//    of the same ayah in a grammatical note or a second opinion («مُعْتَرِضٌ بَيْنَ: ﴿…﴾ ومَفْعُولِهِ: ﴿…﴾», «وقيل: ﴿…﴾»).
//    Such a quotation always follows a colon (an entry never does: it begins its paragraph or line, or follows the end of
//    the previous explanation), and it is part of that explanation, never an entry.
import { inflateRawSync } from 'node:zlib';

/** Bumped whenever the parsing rules or the output shape change, so generated data is rebuilt. */
export const PARSER_VERSION = 3;
export const PAGE_COUNT = 604;

// ── ZIP (the .docx container) ────────────────────────────────────────────────────────────────────────────────────

/** One file's bytes from a ZIP archive (stored or deflated), by its exact name. */
export function readZipEntry(zip, name) {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === eocdSignature) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive (no end of central directory)');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const entryName = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`corrupt ZIP local header for ${name}`);
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
  }
  throw new Error(`${name} not found in the archive`);
}

// ── WordprocessingML paragraphs ──────────────────────────────────────────────────────────────────────────────────

const decodeXml = (text) => text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e) => {
  if (e === 'amp') return '&';
  if (e === 'lt') return '<';
  if (e === 'gt') return '>';
  if (e === 'quot') return '"';
  if (e === 'apos') return "'";
  return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});

/**
 * The text of each top-level paragraph of word/document.xml, in order: the concatenated <w:t> runs (deleted text,
 * <w:delText>, is not part of the document), with each plain line break (<w:br/>) as "\n" — in this source only ever
 * the line break before an ayah's next entry (parseGhareebParagraphs checks). Throws on nested paragraphs (text
 * boxes) and on tabs, page or column breaks or symbol characters inside a paragraph: this source has none, and their
 * meaning here would be a guess.
 */
export function documentParagraphs(xml) {
  // A tab character in the text is a bare <w:tab/> (a tab stop in the paragraph's properties has attributes).
  const token = /<w:p\/>|<w:p[\s>]|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\/>|(<w:br\/>)|<w:(tab)\/>|<w:(br|cr|sym|noBreakHyphen|softHyphen)\b[^>]*\/>/g;
  const paragraphs = [];
  let depth = 0;
  let current = null;
  for (const match of xml.matchAll(token)) {
    const [whole, text, lineBreak, tab, other] = match;
    const special = tab ?? other;
    if (lineBreak) {
      if (depth !== 1) throw new Error('a line break outside a paragraph');
      current.push('\n');
      continue;
    }
    if (whole === '<w:p/>') {
      if (depth === 0) paragraphs.push('');
      continue;
    }
    if (whole.startsWith('<w:p')) {
      depth += 1;
      if (depth > 1) throw new Error('nested paragraphs (a text box?): not part of this source as surveyed');
      current = [];
    } else if (whole === '</w:p>') {
      depth -= 1;
      paragraphs.push(current.join(''));
      current = null;
    } else if (special) {
      throw new Error(`<w:${special}/> inside paragraph ${paragraphs.length + 1}: not part of this source as surveyed`);
    } else if (text !== undefined && depth === 1) {
      current.push(decodeXml(text));
    }
  }
  if (depth !== 0) throw new Error('unbalanced paragraphs in document.xml');
  return paragraphs;
}

// ── Entries ──────────────────────────────────────────────────────────────────────────────────────────────────────

const SURAH_HEADING = /^سورة\s/;
/** «(12)», or a pair of ayahs explained together: «(1، 2)», «(20،19)». */
const AYAH_PREFIX = /^\((\d+)(?:\s*[،,]\s*(\d+))?\)/;
const BRACKETS = /﴿([^﴿﴾]*)﴾/g;
/** Introduced by a colon («تعالى:», «بَيْنَ:», «وقيل:»): a quotation inside an explanation. */
const QUOTATION_BEFORE = /:[ \t]*$/;
/** Followed by its reference («[الأنفال: 30]»): a quoted ayah inside an explanation. */
const QUOTATION_AFTER = /^\s*\[/;

/**
 * All entries in source order: { id, surah, ayah, ayahEnd, word, explanation } (id: 1, 2, … in the source's order),
 * plus what was joined, quoted or left out, for the validation report. Throws when the source's structure is not the
 * one surveyed (the heading count, an entry outside a Surah, text outside the brackets' entries, an empty word or
 * explanation, unbalanced brackets).
 */
export function parseGhareebParagraphs(paragraphs) {
  const blocks = []; // { surah, ayah, ayahEnd, text, paragraph }
  const headings = [];
  const continuations = [];
  let emptyParagraphs = 0;
  for (let index = 0; index < paragraphs.length; index++) {
    const raw = paragraphs[index];
    const text = raw.trim();
    if (text === '') { emptyParagraphs += 1; continue; }
    if (SURAH_HEADING.test(text)) { headings.push({ paragraph: index + 1, text }); continue; }
    const surah = headings.length;
    if (surah === 0) throw new Error(`paragraph ${index + 1} precedes the first Surah heading`);
    const prefix = AYAH_PREFIX.exec(text);
    if (prefix) {
      const first = Number(prefix[1]);
      const second = prefix[2] === undefined ? first : Number(prefix[2]);
      // Its end as written (a continuation may follow it: joined at the source's own trailing space, if any).
      blocks.push({ surah, ayah: Math.min(first, second), ayahEnd: Math.max(first, second), text: raw.trimStart().slice(prefix[0].length), paragraph: index + 1 });
      continue;
    }
    // A continuation: the rest of the previous ayah's paragraph (never across a Surah heading).
    const previous = blocks.at(-1);
    if (!previous || previous.surah !== surah) throw new Error(`paragraph ${index + 1} continues no ayah of Surah ${surah}`);
    const separator = /\s$/.test(previous.text) ? '' : ' ';
    previous.text = `${previous.text}${separator}${raw.trimStart()}`;
    continuations.push({ paragraph: index + 1, surah, ayah: previous.ayah, joinedWith: separator === '' ? 'source space' : 'one space' });
  }
  if (headings.length !== 114) throw new Error(`expected 114 Surah headings, found ${headings.length}`);

  const entries = [];
  const quotations = [];
  const withoutColon = [];
  for (const block of blocks) {
    const opens = [...block.text].filter((c) => c === '﴿').length;
    const closes = [...block.text].filter((c) => c === '﴾').length;
    if (opens !== closes) throw new Error(`unbalanced brackets in ${block.surah}:${block.ayah} (paragraph ${block.paragraph})`);
    // A line break only ever ends an entry (the next one starts on the next line): never inside a word or explanation.
    if (/\n(?!\s*﴿)/.test(block.text)) throw new Error(`a line break inside an entry of ${block.surah}:${block.ayah} (paragraph ${block.paragraph})`);
    const starts = [];
    for (const match of block.text.matchAll(BRACKETS)) {
      const before = block.text.slice(0, match.index);
      const after = block.text.slice(match.index + match[0].length);
      if (QUOTATION_BEFORE.test(before) || QUOTATION_AFTER.test(after)) {
        quotations.push({ surah: block.surah, ayah: block.ayah, paragraph: block.paragraph, reference: QUOTATION_AFTER.test(after) });
        continue;
      }
      starts.push({ index: match.index, end: match.index + match[0].length, word: match[1] });
    }
    if (starts.length === 0) throw new Error(`no entry in ${block.surah}:${block.ayah} (paragraph ${block.paragraph})`);
    const lead = block.text.slice(0, starts[0].index);
    if (lead.trim() !== '') throw new Error(`text before the first entry of ${block.surah}:${block.ayah} (paragraph ${block.paragraph})`);
    starts.forEach((start, i) => {
      const until = i + 1 < starts.length ? starts[i + 1].index : block.text.length;
      let explanation = block.text.slice(start.end, until);
      const colon = /^\s*:/.exec(explanation);
      if (colon) explanation = explanation.slice(colon[0].length);
      explanation = explanation.trim();
      const word = start.word.trim();
      const id = entries.length + 1;
      if (!colon) withoutColon.push({ id, surah: block.surah, ayah: block.ayah });
      if (word === '') throw new Error(`empty Quranic word in ${block.surah}:${block.ayah} (paragraph ${block.paragraph})`);
      if (explanation === '') throw new Error(`empty explanation for entry ${id} in ${block.surah}:${block.ayah}`);
      if (/\n/.test(word) || /\n/.test(explanation)) throw new Error(`a line break inside entry ${id}`);
      entries.push({ id, surah: block.surah, ayah: block.ayah, ayahEnd: block.ayahEnd, word, explanation });
    });
  }
  return {
    entries,
    report: {
      paragraphs: paragraphs.length,
      emptyParagraphs,
      surahHeadings: headings,
      ayahParagraphs: blocks.length,
      ayahRanges: blocks.filter((b) => b.ayahEnd !== b.ayah).map((b) => ({ surah: b.surah, ayah: b.ayah, ayahEnd: b.ayahEnd, paragraph: b.paragraph })),
      continuations,
      quotations,
      withoutColon,
    },
  };
}

/**
 * For validation only (never for what the app shows): base letters, with hamza seats and alef forms folded and every
 * mark, small letter, space and sign removed, so a King Fahd word can be found in the Tanzil text of its ayah although
 * the two encodings mark sukun, hamza, small letters and open tanween differently.
 */
export function letterSkeleton(text) {
  return text
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/[ىئی]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/[^ا-غف-ي]/g, '');
}

// ── Pages ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** PAGE_FIRST_AYAH from mobile/src/mushaf/generated/pageStarts.ts (the reader's own page table), as [surah, ayah]. */
export function parsePageStarts(source) {
  const body = source.slice(source.indexOf('PAGE_FIRST_AYAH'));
  const starts = [...body.slice(0, body.indexOf('];') + 2).matchAll(/\[(\d+), (\d+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (starts.length !== PAGE_COUNT) throw new Error(`expected ${PAGE_COUNT} page starts, found ${starts.length}`);
  return starts;
}

/** The page an ayah is on: the last page that begins at or before it (as mobile/src/mushaf/navigation.ts). */
export function pageOf(starts, surah, ayah) {
  const target = surah * 1000 + ayah;
  let page = 0;
  for (let i = 0; i < starts.length && starts[i][0] * 1000 + starts[i][1] <= target; i++) page = i + 1;
  return page;
}

/**
 * Applies the reviewed reference corrections (reference-corrections.json): each names the source's Surah and ayah and
 * the SHA-256 of the entry's word (so no King Fahd text is kept in Git), and must match exactly one entry, else the
 * import stops (the source changed: review again). Only the ayah reference changes, never a word or explanation.
 */
export function applyReferenceCorrections(entries, corrections, sha256) {
  const applied = [];
  for (const c of corrections) {
    const matches = entries.filter((e) => e.surah === c.surah && e.ayah === c.sourceAyah && sha256(e.word) === c.wordSha256);
    if (matches.length !== 1) throw new Error(`reference correction ${c.surah}:${c.sourceAyah} → ${c.surah}:${c.ayah} matches ${matches.length} entries, not 1: review reference-corrections.json`);
    const [entry] = matches;
    if (entry.ayahEnd !== entry.ayah) throw new Error(`reference correction ${c.surah}:${c.sourceAyah}: not for a pair of ayahs`);
    entry.ayah = c.ayah;
    entry.ayahEnd = c.ayah;
    applied.push({ id: entry.id, surah: c.surah, sourceAyah: c.sourceAyah, ayah: c.ayah });
  }
  return applied;
}

/**
 * The app's dataset: every entry on the page of its ayah (a pair of ayahs explained together must share a page), in
 * source order. Throws on an ayah that does not exist (counts: the ayahs in each Surah).
 */
export function buildDataset({ entries, report }, { starts, counts, source, referenceCorrections = [] }) {
  const pages = Array.from({ length: PAGE_COUNT }, () => []);
  for (const e of entries) {
    if (e.surah < 1 || e.surah > 114) throw new Error(`entry ${e.id}: no Surah ${e.surah}`);
    if (e.ayah < 1 || e.ayahEnd > counts[e.surah - 1]) throw new Error(`entry ${e.id}: no ayah ${e.surah}:${e.ayah}-${e.ayahEnd}`);
    const page = pageOf(starts, e.surah, e.ayah);
    if (pageOf(starts, e.surah, e.ayahEnd) !== page) throw new Error(`entry ${e.id}: ${e.surah}:${e.ayah}-${e.ayahEnd} spans two pages`);
    pages[page - 1].push([e.id, e.surah, e.ayah, e.ayahEnd, e.word, e.explanation]);
  }
  return {
    format: 1,
    status: 'official',
    parser: PARSER_VERSION,
    source,
    counts: {
      entries: entries.length,
      pagesWithEntries: pages.filter((p) => p.length > 0).length,
      ayahParagraphs: report.ayahParagraphs,
      ayahRanges: report.ayahRanges.length,
      continuations: report.continuations.length,
      quotations: report.quotations.length,
      withoutColon: report.withoutColon.length,
    },
    referenceCorrections,
    pages,
  };
}
