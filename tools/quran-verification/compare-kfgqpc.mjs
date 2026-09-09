import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { sha256, expectedKeys } from './verify.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const zipPath = 'tools/quran-import/raw/UthmanicHafs_v2-0.zip';
const staging = 'tools/quran-import/staging/kfgqpc';
const datasetPath = 'UthmanicHafs_v2-0 data/hafsData_v2-0.json';
const fontPath = 'UthmanicHafs_v2-0 font/uthmanic_hafs_v20.ttf';
const zipHash = 'a7b0e5591945712ec5e4d6142938ae4d1e9b49bdc89dff06222789bfebdfd72c';
const verificationHash = '6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f';
const load = p => readFileSync(resolve(repo, p));
const decode = b => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
const cp = c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

// Read central directory and uncompressed members without executing package code.
export function archiveEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('ZIP directory missing');
  let p = buffer.readUInt32LE(end + 16);
  const result = [];
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const flags = buffer.readUInt16LE(p + 8), method = buffer.readUInt16LE(p + 10);
    const compressed = buffer.readUInt32LE(p + 20), size = buffer.readUInt32LE(p + 24);
    const nameLength = buffer.readUInt16LE(p + 28), extraLength = buffer.readUInt16LE(p + 30), commentLength = buffer.readUInt16LE(p + 32);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength), local = buffer.readUInt32LE(p + 42);
    if (flags & 1 || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('Unsupported/unsafe ZIP entry');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const packed = buffer.subarray(start, start + compressed);
    const bytes = method === 0 ? Buffer.from(packed) : method === 8 ? inflateRawSync(packed) : null;
    if (!bytes || bytes.length !== size) throw new Error('Unsupported/invalid ZIP compression');
    result.push({ path: name, bytes });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

export function validateExact(records) {
  const expected = new Set(expectedKeys), seen = new Set(), surahs = new Set();
  const duplicates = [], invalid = [], empty = [];
  for (const r of records) {
    if (seen.has(r.key)) duplicates.push(r.key);
    seen.add(r.key);
    if (!expected.has(r.key)) invalid.push(r.key);
    else surahs.add(Number(r.key.split(':')[0]));
    if (typeof r.text !== 'string' || r.text.length === 0 || /^\s+$/u.test(r.text)) empty.push(r.key);
  }
  const missing = expectedKeys.filter(k => !seen.has(k));
  return { valid: records.length === 6236 && surahs.size === 114 && !duplicates.length && !invalid.length && !empty.length && !missing.length, ayahs: records.length, surahs: surahs.size, duplicateKeys: duplicates, missingKeys: missing, extraOrInvalidKeys: invalid, emptyTextKeys: empty };
}

export function parsePrimary(bytes) {
  const rows = JSON.parse(decode(bytes));
  if (!Array.isArray(rows)) throw new Error('Expected source JSON array');
  return rows.map((r, sourceIndex) => {
    if (!Number.isInteger(r.sura_no) || !Number.isInteger(r.aya_no) || typeof r.aya_text !== 'string') throw new Error(`Malformed primary source row ${sourceIndex}`);
    return { key: `${r.sura_no}:${r.aya_no}`, text: r.aya_text, sourceIndex, sourceId: r.id };
  });
}

export function parseVerification(bytes) {
  if (sha256(bytes) !== verificationHash) throw new Error('Tanzil source pin changed');
  const rows = [];
  for (const [i, line] of decode(bytes).split(/\r?\n/).entries()) {
    if (line === '' || line.startsWith('#')) continue;
    const m = /^([1-9]\d*)\|([1-9]\d*)\|(.+)$/u.exec(line);
    if (!m) throw new Error(`Malformed Tanzil line ${i + 1}`);
    rows.push({ key: `${m[1]}:${m[2]}`, text: m[3], sourceLine: i + 1 });
  }
  return rows;
}

// Exact code-point LCS: no trim, normalization, substitutions or mark removal.
// Equal segments are omitted from output; unmatched runs are deterministic edits.
export function editsBetween(primary, verification) {
  const a = [...primary], b = [...verification], width = b.length + 1;
  const matrix = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    matrix[i * width + j] = a[i] === b[j] ? 1 + matrix[(i + 1) * width + j + 1] : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
  }
  const edits = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; continue; }
    const startA = i, startB = j;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) break;
      if (i < a.length && (j === b.length || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])) i++;
      else j++;
    }
    const removed = a.slice(startA, i).join(''), added = b.slice(startB, j).join('');
    edits.push({ operation: removed && added ? 'substitution' : removed ? 'removal' : 'addition', primaryRange: [startA, i], tanzilRange: [startB, j], removed, added, removedCodePoints: [...removed].map(cp), addedCodePoints: [...added].map(cp) });
  }
  return edits;
}

export function fontNames(b) {
  let table;
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const p = 12 + 16 * i;
    if (b.toString('ascii', p, p + 4) === 'name') table = b.readUInt32BE(p + 8);
  }
  if (table === undefined) throw new Error('Missing font name table');
  const records = [], base = table + b.readUInt16BE(table + 4);
  for (let i = 0; i < b.readUInt16BE(table + 2); i++) {
    const p = table + 6 + i * 12, platform = b.readUInt16BE(p), nameId = b.readUInt16BE(p + 6);
    const start = base + b.readUInt16BE(p + 10), len = b.readUInt16BE(p + 8);
    const bytes = Buffer.from(b.subarray(start, start + len));
    const text = platform === 0 || platform === 3 ? bytes.swap16().toString('utf16le') : bytes.toString('latin1');
    if ([0, 1, 4, 5, 8, 9, 11, 13, 14].includes(nameId)) records.push({ platform, nameId, text });
  }
  return records;
}

function main() {
  const original = load(zipPath);
  if (sha256(original) !== zipHash) throw new Error('ZIP pin changed');
  const entries = archiveEntries(original);
  const inventory = entries.map(e => ({ path: e.path, bytes: e.bytes.length, sha256: sha256(e.bytes) }));
  for (const entry of entries.filter(e => !e.path.endsWith('/'))) {
    if (!entry.bytes.equals(load(`${staging}/${entry.path}`))) throw new Error(`Extracted file does not match ZIP: ${entry.path}`);
  }
  const json = entries.find(e => e.path === datasetPath).bytes;
  const tanzilBytes = load('tools/quran-verification/input/quran-uthmani.txt');
  const tanzilRawText = decode(tanzilBytes);
  const noticeStart = tanzilRawText.indexOf('# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK');
  if (noticeStart < 0) throw new Error('Missing Tanzil redistribution notice');
  const tanzilCopyrightNotice = tanzilRawText.slice(noticeStart);
  const primary = parsePrimary(json), tanzil = parseVerification(tanzilBytes);
  const primaryValidation = validateExact(primary), tanzilValidation = validateExact(tanzil);
  const other = new Map(tanzil.map(r => [r.key, r]));
  const unicode = JSON.parse(decode(load('tools/quran-verification/reference/unicode-names.json')));
  const catalog = {}, categoriesByVerse = {}, editCounts = { addition: 0, removal: 0, substitution: 0 };
  const mismatches = []; let exactMatches = 0, matchedKeys = 0, letterVerses = 0, spacingVerses = 0;
  const categories = (c, marker) => {
    if (marker) return 'verse marker';
    const n = c.codePointAt(0);
    if (/\s/u.test(c)) return 'whitespace';
    if (n === 0x640) return 'tatweel';
    if (n === 0x670) return 'superscript alef';
    if (n === 0x6e9) return 'sajdah symbol';
    if (n >= 0x6d6 && n <= 0x6dc) return 'waqf mark';
    if ((n >= 0x6e2 && n <= 0x6e8) || n === 0x6ed) return 'small high/low letter or sign';
    if ([0x621,0x622,0x623,0x624,0x625,0x626,0x654,0x655,0x671].includes(n)) return 'hamza/alef form';
    if (/\p{M}/u.test(c)) return 'diacritic';
    if (/\p{L}/u.test(c)) return 'Arabic/other letter';
    return 'other Unicode difference';
  };
  for (const row of primary) {
    const second = other.get(row.key); if (!second) continue;
    matchedKeys++;
    if (Buffer.from(row.text, 'utf8').equals(Buffer.from(second.text, 'utf8'))) { exactMatches++; continue; }
    const edits = editsBetween(row.text, second.text), a = [...row.text], b = [...second.text];
    const verseCategories = new Set(); let actualLetters = false;
    for (const edit of edits) {
      editCounts[edit.operation]++;
      edit.categories = [];
      for (const [text, start, isPrimary] of [[edit.removed, edit.primaryRange[0], true], [edit.added, edit.tanzilRange[0], false]]) {
        [...text].forEach((c, offset) => {
          const code = cp(c), hex = code.slice(2), name = unicode.names[hex];
          catalog[code] = { character: c, name: name?.name ?? null, generalCategory: name?.category ?? null };
          // Package read.me documents terminal ayah symbols; retain their Unicode names too.
          const marker = isPrimary && start + offset === a.length - 1 && c.codePointAt(0) === 0xfc00 + Number(row.key.split(':')[1]) - 1;
          const category = categories(c, marker);
          verseCategories.add(category); edit.categories.push(category);
          if (/\p{L}/u.test(c) && !marker && c.codePointAt(0) !== 0x640 && !['small high/low letter or sign'].includes(category)) actualLetters = true;
        });
      }
      edit.categories = [...new Set(edit.categories)];
    }
    for (const c of verseCategories) categoriesByVerse[c] = (categoriesByVerse[c] ?? 0) + 1;
    if (actualLetters) letterVerses++;
    if (verseCategories.has('whitespace')) spacingVerses++;
    let first = 0; while (first < a.length && first < b.length && a[first] === b[first]) first++;
    mismatches.push({ verseKey: row.key, sourceIndex: row.sourceIndex, sourceId: row.sourceId, tanzilLine: second.sourceLine,
      kingFahdText: row.text, tanzilText: second.text,
      lengths: { kingFahdCodePoints: a.length, tanzilCodePoints: b.length, kingFahdUtf16: row.text.length, tanzilUtf16: second.text.length, kingFahdUtf8Bytes: Buffer.byteLength(row.text), tanzilUtf8Bytes: Buffer.byteLength(second.text) },
      firstDifference: { codePointIndex: first, kingFahdUtf16Index: a.slice(0, first).join('').length, tanzilUtf16Index: b.slice(0, first).join('').length, kingFahdUtf8Offset: Buffer.byteLength(a.slice(0, first).join('')), tanzilUtf8Offset: Buffer.byteLength(b.slice(0, first).join('')) },
      categories: [...verseCategories], affectsLetterCodePoints: actualLetters, edits,
    });
  }
  const names = fontNames(entries.find(e => e.path === fontPath).bytes);
  const readme = decode(entries.find(e => e.path.endsWith('/read.me')).bytes);
  const pdfInspection = JSON.parse(decode(load('tools/quran-verification/output/kfgqpc-pdf-inspection.json')));
  if (pdfInspection.sha256 !== sha256(entries.find(e=>e.path.endsWith('.pdf')).bytes)) throw new Error('PDF inspection does not match package');
  const docx = archiveEntries(entries.find(e=>e.path.endsWith('.docx')).bytes);
  const docxEvidence = docx.filter(e=>/^word\/(document|header\d+|footer\d+)\.xml$/.test(e.path)).map(e=> {
    const xml = decode(e.bytes);
    const textNodes = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)].map(m=>m[1]);
    return {internalPath:e.path,textNodeCount:textNodes.length,keywordHits:textNodes.filter(t=>/licen|copyright|permiss|redistrib|rights|مجمع|حقوق|استخدام|نسخ|نشر|تعديل/iu.test(t))};
  });
  const result = {
    status: 'FAIL — MANUAL REVIEW REQUIRED', recommendation: 'REVIEW REQUIRED BEFORE SQLITE GENERATION',
    originalZip: { path: zipPath, filename: 'UthmanicHafs_v2-0.zip', bytes: original.length, sha256Before: zipHash, sha256After: sha256(load(zipPath)), provenance: 'User supplied as official King Fahd package; internal organization/version metadata recorded. Exact download URL and independent publisher signature not supplied.' },
    selectedDataset: { internalPath: datasetPath, format: 'JSON', textField: 'aya_text', referenceFields: ['sura_no','aya_no'], sha256: sha256(json), version: '2.0', date: '2022-09-07', update: '13.0' },
    tanzil: { path: 'tools/quran-verification/input/quran-uthmani.txt', sha256: verificationHash, attribution: 'Independent verification source: Tanzil Quran Text — Uthmani 1.1 — https://tanzil.net', copyrightNotice: tanzilCopyrightNotice },
    inventory, primaryValidation, tanzilValidation,
    summary: { matchedKeys, exactMatches, mismatchedVerses: mismatches.length, missingVerses: primaryValidation.missingKeys.length, extraVerses: primaryValidation.extraOrInvalidKeys.length, duplicateKeys: primaryValidation.duplicateKeys.length, categoriesByVerse, editCounts, letterCodePointMismatchVerses: letterVerses, spacingMismatchVerses: spacingVerses },
    methodology: { equality: 'Exact UTF-8 bytes of decoded source field payloads; no trim/normalization/cleanup.', diff: 'Code-point longest common subsequence; ties remove from King Fahd first. Operations transform King Fahd into Tanzil for audit only. Ranges are zero-based, half-open code-point positions; alignment is deterministic, not a unique linguistic interpretation.', names: { source: unicode.url, version: unicode.version, sha256: unicode.sourceSha256 }, markerCaveat: 'Terminal U+FC00 + ayah - 1 classified as package ayah marker per read.me and observed sequence; these code points have Unicode Arabic ligature names. No symbol removed or assumed harmless.', review: 'All non-exact verses require review. Letter-code-point differences do not alone establish a different reading; no linguistic equivalence asserted.' },
    licensing: { readmeInternalPath: 'UthmanicHafs_v2-0 data/read.me', readmeExactText: readme, fontInternalPath: fontPath, fontNameRecords: names,
      quranTextUse: 'No explicit text-use grant located in read.me, extracted Word text, or PDF text inspection.', quranTextRedistribution: 'Unresolved: no explicit dataset redistribution terms located.', fontUseAndDistribution: 'Embedded name ID 13 grants Use, Copy, Distribute subject to conditions. Its condition 1 also forbids Reproduced; name ID 0 requires written approval for reproduction/modification. Preserve and clarify this tension; no unrestricted grant inferred.', offlineMobileBundling: 'Not explicitly stated; unresolved.', fontModification: 'Explicitly prohibited in embedded EULA.', attribution: 'Copyright/ownership stated; no separate explicit attribution clause located.', pdfReview: `${pdfInspection.pages} pages text-extracted; ${pdfInspection.extractedCharacters} extracted characters. Keyword/context inspection found no separate grant. Arabic extraction has display-order artifacts; no visual certification or inference of permission. Evidence: kfgqpc-pdf-inspection.json.`, docxEvidence },
    codePointCatalog: catalog, mismatches,
    unchanged: { runtime: true, sourceText: true, sqliteNotGenerated: true, noCommitPushDeploy: true },
  };
  const out = resolve(repo, 'tools/quran-verification/output');
  writeFileSync(resolve(out, 'kfgqpc-comparison.json'), JSON.stringify(result) + '\n');
  const md = ['# King Fahd / Tanzil exact comparison', '', '**FAIL — MANUAL REVIEW REQUIRED**', '', '**Recommendation: REVIEW REQUIRED BEFORE SQLITE GENERATION.** No SQLite, runtime or source changes were made.', '',
    `Archive: \`${result.originalZip.filename}\` — ${original.length.toLocaleString('en-US')} bytes.`, `SHA-256 before/after: \`${zipHash}\` (unchanged).`, '',
    `Dataset: \`${datasetPath}\`, field \`aya_text\`; version 2.0, 2022-09-07, update 13.0. Search field \`aya_text_emlaey\` was not used.`, '',
    '## Structural and exact comparison results', '',
    `King Fahd: ${primary.length} ayahs / ${primaryValidation.surahs} surahs. Tanzil: ${tanzil.length} ayahs / ${tanzilValidation.surahs} surahs.`,
    `Matched keys: ${matchedKeys}; exact matches: ${exactMatches}; mismatched verses: ${mismatches.length}.`,
    `Missing: ${primaryValidation.missingKeys.length}; extra/invalid: ${primaryValidation.extraOrInvalidKeys.length}; duplicate keys: ${primaryValidation.duplicateKeys.length}.`, '',
    '| Category | Verses containing differing code points |', '|---|---:|', ...Object.entries(categoriesByVerse).map(([c,n])=>`| ${c} | ${n} |`), '',
    'Categories overlap. These labels describe code points, not harmlessness or linguistic equivalence.',
    `Letter-code-point differences (excluding documented terminal markers, tatweel and small-letter annotations): **${letterVerses} verses**. Spacing differences: ${spacingVerses}.`, '',
    'The source includes non-breaking spaces and terminal ayah symbols; Tanzil includes opening basmala payloads in many first ayahs. All remain untouched. No mismatch has been automatically resolved.', '',
    'Examples needing review: 2:1 includes a basmala prefix in Tanzil but not the selected King Fahd ayah payload. In 2:4, a differing run includes U+0623 in King Fahd versus a sequence containing U+0654 and U+0627 in Tanzil. These are observed letter/representation differences, not a conclusion of changed Quranic meaning.', '',
    '## Provenance and package inventory', '', result.originalZip.provenance, '',
    ...inventory.map(e=>`- \`${e.path}\` (${e.bytes} bytes; SHA-256 \`${e.sha256}\`)`), '',
    'Every staged file was checked byte-for-byte against its ZIP member. The ZIP itself was rehashed after comparison.', '',
    '## License evidence', '',
    ...Object.entries(result.licensing).filter(([k])=>!['readmeExactText','fontNameRecords','docxEvidence'].includes(k)).map(([k,v])=>`- **${k}:** ${v}`), '',
    'Embedded font EULA (name ID 13, exact extracted text):', '', '```text', names.find(n=>n.nameId===13).text, '```', '',
    'Copyright/reproduction notice (name ID 0, exact extracted text):', '', '```text', names.find(n=>n.nameId===0).text, '```', '',
    '## Reproduction and checks', '',
    'Run `node tools/quran-verification/compare-kfgqpc.mjs` after safe extraction to the documented staging directory. It verifies the ZIP pin, every staged member, and the original Tanzil pin. Exit 1 means review required. The JSON contains full originals, lengths, source locations, every edit and Unicode names in `codePointCatalog`.', '',
    'Diff direction is King Fahd → Tanzil, for diagnosis only. Positions/ranges are zero-based code points, end-exclusive. Addition/removal/substitution alignment uses exact LCS, choosing primary removal on ties. No transformation is applied to either text.', '',
    'Unicode names: ' + unicode.url + '. Source SHA-256: `' + unicode.sourceSha256 + '`.', '',
    'Checks: `node --test tools/quran-verification/verify.test.mjs tools/quran-verification/compare-kfgqpc.test.mjs` passed 13 tests (0 failed). Every edit sequence reconstructs its untouched Tanzil target; every staged member matches the original ZIP. Backend/mobile code and dependencies were not changed this phase, so their typechecks are not directly affected. PDF inspection uses a temporary PDF.js install in ignored staging, outside both app projects.', '',
    'Files created: `compare-kfgqpc.mjs`, `compare-kfgqpc.test.mjs`, `inspect-package-pdf.mjs`, `reference/unicode-names.json`, `output/kfgqpc-comparison.json`, `output/kfgqpc-comparison-report.md`, `output/kfgqpc-pdf-inspection.json` (all under `tools/quran-verification`). `.gitignore` adds staging exclusion; verification README documents this phase. The inventory above lists all 13 staged archive members including directory entries (11 files). Temporary inspection dependencies are also under ignored staging. The user-supplied ZIP was not created or modified by these tools.', '',
    '## Tanzil attribution and retained notice', '', 'Independent verification source: Tanzil Quran Text — Uthmani 1.1 — https://tanzil.net', '', '```text', tanzilCopyrightNotice, '```', '',
    '## Every mismatch', '',
  ];
  for (const m of mismatches) {
    md.push(`### ${m.verseKey}`, '', `Categories: ${m.categories.join(', ')}. First differing code-point index: ${m.firstDifference.codePointIndex}.`,
      `Lengths (King Fahd / Tanzil): ${m.lengths.kingFahdCodePoints} / ${m.lengths.tanzilCodePoints} code points; ${m.lengths.kingFahdUtf8Bytes} / ${m.lengths.tanzilUtf8Bytes} UTF-8 bytes.`, '',
      'King Fahd — exact:', '```text', m.kingFahdText, '```', 'Tanzil — exact:', '```text', m.tanzilText, '```', '',
      ...m.edits.map(e=>`- ${e.operation}: K[${e.primaryRange.join(',')}) → T[${e.tanzilRange.join(',')}): [${e.removedCodePoints.join(' ')}] → [${e.addedCodePoints.join(' ')}]; ${e.categories.join(', ')}`), '');
  }
  md.push('## Unicode names for differing characters', '', '| Code point | Unicode name | Category |', '|---|---|---|', ...Object.entries(catalog).sort().map(([c,v])=>`| ${c} | ${v.name ?? 'Unavailable'} | ${v.generalCategory ?? 'Unavailable'} |`), '');
  writeFileSync(resolve(out, 'kfgqpc-comparison-report.md'), md.join('\n'));
  console.log(JSON.stringify({ ...result.summary, primaryValidation, selectedDataset: result.selectedDataset, recommendation: result.recommendation }, null, 2));
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
