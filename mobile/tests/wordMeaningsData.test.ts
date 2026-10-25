import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync, gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { pageOfAyah } from '@/mushaf/navigation';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';
import { readWordMeaningsDataset } from '@/wordMeanings/dataset';

/**
 * Word Meanings (المعاني) data: King Fahd Complex's «الميسر في غريب القرآن الكريم», its import
 * (tools/word-meanings/) and the app's lookup. The parsing rules are checked on SYNTHETIC text; the real source and
 * dataset are git-ignored (their redistribution terms are unresolved), so the checks on them read the local copies
 * (`node tools/word-meanings/import.mjs`). A missing source or dataset fails here, except in CI, which has neither
 * (there those checks are reported skipped, never passed). No King Fahd text is written in this file.
 */

const repo = fileURLToPath(new URL('../../', import.meta.url));
const tools = join(repo, 'tools/word-meanings');
const imp = (p: string) => import(pathToFileURL(join(tools, p)).href);
const lib = await imp('ghareeb-docx.mjs');
const importer = await imp('import.mjs');
const lock = JSON.parse(readFileSync(join(tools, 'source.lock.json'), 'utf8'));
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

const datasetPath = join(repo, 'mobile/assets/word-meanings/ghareeb.json');
const datasetText = existsSync(datasetPath) ? readFileSync(datasetPath, 'utf8') : null;
const dataset = datasetText ? JSON.parse(datasetText) : null;
const datasetReady = dataset?.status === 'official';
const sourcePath = join(tools, 'source/MuyassarGhareeb.docx');
const sourceBytes = existsSync(sourcePath) ? readFileSync(sourcePath) : null;
const inCi = Boolean(process.env.CI);
type Row = [number, number, number, number, string, string];
const rows = (): Row[] => (dataset.pages as Row[][]).flat();

/** A ZIP holding one deflated file, as Word writes a .docx. */
function zipOf(name: string, content: string) {
  const data = Buffer.from(content, 'utf8');
  const packed = deflateRawSync(data);
  const nameBytes = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + nameBytes.length, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, packed, central, nameBytes, end]);
}
const p = (...runs: string[]) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs.map((r) => (r === '\n' ? '<w:r><w:br/></w:r>' : `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`)).join('')}</w:p>`;
/** 114 synthetic Surah headings, each followed by `bodies[surah]` (its ayah paragraphs), else one plain entry. */
const document = (bodies: Record<number, string[]> = {}) => Array.from({ length: 114 }, (_, i) => [`سورة ${i + 1}`, ...(bodies[i + 1] ?? ['(1) ﴿كلمة﴾: معنى.'])]).flat();
const parse = (paragraphs: string[]) => lib.parseGhareebParagraphs(paragraphs);

describe('the import: reading the .docx (synthetic files)', () => {
  it('reads a deflated file from a ZIP, and refuses a missing one', () => {
    const zip = zipOf('word/document.xml', '<w:body/>');
    expect(lib.readZipEntry(zip, 'word/document.xml').toString('utf8')).toBe('<w:body/>');
    expect(() => lib.readZipEntry(zip, 'word/other.xml')).toThrow(/not found/);
  });

  it('paragraph text: runs joined, entities decoded, plain line breaks kept as \\n, tab stops in properties ignored', () => {
    const xml = `<w:body>${p('(1) ', '﴿أ&amp;ب﴾', ': معنى.', '\n', '﴿ج﴾: ثان.')}<w:p/></w:body>`;
    expect(lib.documentParagraphs(xml)).toEqual(['(1) ﴿أ&ب﴾: معنى.\n﴿ج﴾: ثان.', '']);
  });

  it('refuses what this source does not contain: nested paragraphs, tab characters, page breaks, symbols', () => {
    expect(() => lib.documentParagraphs('<w:p><w:txbxContent><w:p></w:p></w:txbxContent></w:p>')).toThrow(/nested/);
    expect(() => lib.documentParagraphs('<w:p><w:r><w:tab/></w:r></w:p>')).toThrow(/tab/);
    expect(() => lib.documentParagraphs('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')).toThrow(/br/);
    expect(() => lib.documentParagraphs('<w:p><w:r><w:sym w:font="x" w:char="F0"/></w:r></w:p>')).toThrow(/sym/);
  });
});

describe('the import: parsing rules (synthetic text)', () => {
  it('entries in order with their Surah (from the headings) and ayah; words and explanations exactly as written', () => {
    const { entries } = parse(document({ 2: ['(3) ﴿كلمة أولى﴾: معنى أول، وتفصيله. \n﴿كلمة ثانية﴾: معنى ثان.', '(5) ﴿كلمة ثالثة﴾ معنى بلا نقطتين.'] }));
    expect(entries.filter((e: { surah: number }) => e.surah === 2)).toEqual([
      { id: 2, surah: 2, ayah: 3, ayahEnd: 3, word: 'كلمة أولى', explanation: 'معنى أول، وتفصيله.' },
      { id: 3, surah: 2, ayah: 3, ayahEnd: 3, word: 'كلمة ثانية', explanation: 'معنى ثان.' },
      { id: 4, surah: 2, ayah: 5, ayahEnd: 5, word: 'كلمة ثالثة', explanation: 'معنى بلا نقطتين.' },
    ]);
  });

  it('a pair of ayahs explained together: «(1، 2)» and «(20،19)» give ayah 1–2 and 19–20', () => {
    const { entries, report } = parse(document({ 5: ['(1، 2) ﴿أ﴾: ب.', '(20،19) ﴿ج﴾: د.'] }));
    expect(entries.filter((e: { surah: number }) => e.surah === 5).map((e: { ayah: number; ayahEnd: number }) => [e.ayah, e.ayahEnd])).toEqual([[1, 2], [19, 20]]);
    expect(report.ayahRanges).toHaveLength(2);
  });

  it("a continuation paragraph joins the previous ayah's last explanation (its own trailing space kept), and may carry more entries", () => {
    const { entries, report } = parse(document({ 7: ['(8) ﴿أ﴾: يبدأ ', '(تتمة) . ﴿ب﴾: ثان.', '(9) ﴿ج﴾: بلا مسافة', '(تتمة).'] }));
    const of7 = entries.filter((e: { surah: number }) => e.surah === 7);
    expect(of7.map((e: { ayah: number; explanation: string }) => [e.ayah, e.explanation])).toEqual([[8, 'يبدأ (تتمة) .'], [8, 'ثان.'], [9, 'بلا مسافة (تتمة).']]);
    expect(report.continuations.map((c: { joinedWith: string }) => c.joinedWith)).toEqual(['source space', 'one space']);
  });

  it('a Quranic quotation after a colon stays in its explanation: another ayah (with or without its reference) or a word of the same ayah', () => {
    const { entries, report } = parse(document({ 9: [
      '(1) ﴿أ﴾: هو المذكور في قوله تعالى: ﴿آية أخرى﴾ [البقرة: 2]. \n﴿ب﴾: معنى.',
      '(2) ﴿ج﴾: ما ذكر من قوله تعالى: ﴿آية﴾ إلى تمام آيتين.',
      '(3) ﴿د﴾: معترض بين: ﴿كلمة﴾ ومفعوله: ﴿أخرى﴾. \n﴿هـ﴾: معنى. وقيل: ﴿و﴾: أي غيره.',
    ] }));
    const of9 = entries.filter((e: { surah: number }) => e.surah === 9);
    expect(of9.map((e: { word: string }) => e.word)).toEqual(['أ', 'ب', 'ج', 'د', 'هـ']);
    expect(of9[0].explanation).toBe('هو المذكور في قوله تعالى: ﴿آية أخرى﴾ [البقرة: 2].');
    expect(of9[3].explanation).toBe('معترض بين: ﴿كلمة﴾ ومفعوله: ﴿أخرى﴾.');
    expect(of9[4].explanation).toBe('معنى. وقيل: ﴿و﴾: أي غيره.');
    expect(report.quotations).toHaveLength(5);
  });

  it('repeated words are kept, each as its own entry', () => {
    const { entries } = parse(document({ 3: ['(1) ﴿تكرار﴾: معنى.', '(2) ﴿تكرار﴾: معنى.', '(3) ﴿تكرار﴾: معنى. \n﴿تكرار﴾: معنى.'] }));
    expect(entries.filter((e: { surah: number }) => e.surah === 3)).toHaveLength(4);
  });

  it('stops on anything not surveyed, never guessing: missing headings, text outside entries, empty words or explanations, broken brackets, a line break inside an entry', () => {
    expect(() => parse(document().slice(2))).toThrow(/114 Surah headings/);
    expect(() => parse(['(1) ﴿أ﴾: ب.'])).toThrow(/precedes the first Surah heading/);
    expect(() => parse(document({ 4: ['(1) مقدمة ﴿أ﴾: ب.'] }))).toThrow(/text before the first entry/);
    expect(() => parse(document({ 4: ['(1) ﴿ ﴾: ب.'] }))).toThrow(/empty Quranic word/);
    expect(() => parse(document({ 4: ['(1) ﴿أ﴾: '] }))).toThrow(/empty explanation/);
    expect(() => parse(document({ 4: ['(1) ﴿أ: ب.'] }))).toThrow(/unbalanced/);
    expect(() => parse(document({ 4: ['(1) ﴿أ﴾: ب\nج.'] }))).toThrow(/line break inside an entry/);
  });

  it('places each entry on the page of its ayah; refuses an ayah that does not exist, or a pair split over two pages', () => {
    const starts = lib.parsePageStarts(readFileSync(join(repo, 'mobile/src/mushaf/generated/pageStarts.ts'), 'utf8'));
    const counts = [...SURAH_AYAH_COUNTS];
    const one = (surah: number, ayah: number, ayahEnd = ayah) => ({ entries: [{ id: 1, surah, ayah, ayahEnd, word: 'أ', explanation: 'ب' }], report: { ayahParagraphs: 1, ayahRanges: [], continuations: [], quotations: [], withoutColon: [] } });
    const built = lib.buildDataset(one(3, 92), { starts, counts, source: {} });
    expect(built.pages[61]).toHaveLength(1);
    expect(built.pages.flat()).toHaveLength(1);
    expect(() => lib.buildDataset(one(1, 8), { starts, counts, source: {} })).toThrow(/no ayah/);
    expect(() => lib.buildDataset(one(3, 91, 92), { starts, counts, source: {} })).toThrow(/spans two pages/);
  });

  it('a reference correction must match exactly one entry (Surah, listed ayah, word hash) and changes only the ayah', () => {
    const entries = () => [{ id: 1, surah: 30, ayah: 49, ayahEnd: 49, word: 'أ', explanation: 'ب' }, { id: 2, surah: 30, ayah: 49, ayahEnd: 49, word: 'ج', explanation: 'د' }];
    const hash = (text: string) => sha256(Buffer.from(text, 'utf8'));
    const list = entries();
    expect(lib.applyReferenceCorrections(list, [{ surah: 30, sourceAyah: 49, ayah: 50, wordSha256: hash('ج') }], hash)).toEqual([{ id: 2, surah: 30, sourceAyah: 49, ayah: 50 }]);
    expect(list[1]).toEqual({ id: 2, surah: 30, ayah: 50, ayahEnd: 50, word: 'ج', explanation: 'د' });
    expect(list[0].ayah).toBe(49);
    expect(() => lib.applyReferenceCorrections(entries(), [{ surah: 30, sourceAyah: 48, ayah: 50, wordSha256: hash('ج') }], hash)).toThrow(/matches 0 entries/);
  });
});

describe('the app lookup (wordMeanings/dataset.ts)', () => {
  const pages = Array.from({ length: 604 }, (_, i) => (i === 0 ? [[1, 1, 1, 1, 'أ', 'ب'], [2, 1, 2, 2, 'ج', 'د']] : []));
  it('a page\'s entries, in order, offline from the bundled data; made once per page', () => {
    const data = readWordMeaningsDataset({ format: 1, status: 'official', source: {}, counts: { entries: 2 }, pages });
    expect(data.status).toBe('official');
    if (data.status !== 'official') return;
    expect(data.forPage(1)).toEqual([{ id: 1, surah: 1, ayah: 1, ayahEnd: 1, word: 'أ', explanation: 'ب' }, { id: 2, surah: 1, ayah: 2, ayahEnd: 2, word: 'ج', explanation: 'د' }]);
    expect(data.forPage(1)).toBe(data.forPage(1));
    expect(data.forPage(2)).toEqual([]);
    expect([0, 605, 1.5, Number.NaN].map((n) => data.forPage(n))).toEqual([[], [], [], []]);
  });
  it('unavailable for the import\'s placeholder, another format, a wrong page count, or nothing', () => {
    for (const raw of [{ format: 1, status: 'unavailable', pages: [] }, { format: 2, status: 'official', pages }, { format: 1, status: 'official', pages: pages.slice(1) }, null, 'x']) {
      expect(readWordMeaningsDataset(raw)).toEqual({ status: 'unavailable' });
    }
  });
  it('never a partial page: malformed rows give an empty page, not a guess', () => {
    const broken = pages.map((rows, i) => (i === 0 ? [[1, 1, 1, 1, 'أ']] : rows));
    const data = readWordMeaningsDataset({ format: 1, status: 'official', pages: broken });
    expect(data.status === 'official' && data.forPage(1)).toEqual([]);
  });
  it('offline and local only: the feature imports no network, account, sync or storage module, and bundles the data in every build, loaded lazily', () => {
    const dir = fileURLToPath(new URL('../src/wordMeanings/', import.meta.url));
    const sources = readdirSync(dir).map((name) => readFileSync(join(dir, name), 'utf8')).join('\n');
    expect(sources).not.toMatch(/fetch\(|@\/services\/api|expo-network|@\/auth|@\/sync|AsyncStorage|async-storage|readingStops|khatmas|lastBrowsedPage/);
    const bundled = readFileSync(join(dir, 'bundledDataset.ts'), 'utf8');
    // Release builds too (owner decision 2026-10-24): no __DEV__ guard; the one require is inside the function, so the
    // dataset is parsed only when Meanings is first opened, never at the reader's start.
    expect(bundled).not.toMatch(/__DEV__/);
    expect(bundled).toMatch(/export function bundledWordMeanings\(\): unknown \{\s*(\/\/[^\n]*\n\s*)*return require\('\.\.\/\.\.\/assets\/word-meanings\/ghareeb\.json'\);\s*\}/);
    expect(bundled.match(/require\(/g)).toHaveLength(1);
    expect(bundled).toMatch(/export function isWordMeaningsBundled\(\): boolean \{\s*return true;\s*\}/);
  });
});

describe('the official source and its dataset (local copies)', () => {
  it('the lock pins the publisher\'s file: URL on the official download host, size, the published MD5 and SHA-1, SHA-256', () => {
    expect(lock.url).toBe('https://download.qurancomplex.gov.sa/resources_dev/MuyassarGhareeb.docx');
    expect(lock.platform).toBe('https://qurancomplex.gov.sa/quran-dev/');
    expect(lock).toMatchObject({ bytes: 956677, md5: 'ffd3c58f51f8a69340a205b71bf1e870', sha1: '1be35ad20c48b4d47dfa0bfc3d97ac7b0b3401ca', sha256: '8a7af5decb94ee465b77c0eded05e018c6bf813fc544455bd0faebfcc84a8cb2' });
    expect(importer.pinMismatch(Buffer.from('not it'), lock)).toMatch(/size/);
  });

  it('neither the source nor the dataset can be committed (git-ignored); the lock and corrections are tracked', () => {
    const ignored = (path: string) => { try { execFileSync('git', ['check-ignore', '-q', path], { cwd: repo }); return true; } catch { return false; } };
    expect(ignored('tools/word-meanings/source/MuyassarGhareeb.docx')).toBe(true);
    expect(ignored('tools/word-meanings/output/validation.json')).toBe(true);
    expect(ignored('mobile/assets/word-meanings/ghareeb.json')).toBe(true);
    expect(ignored('tools/word-meanings/source.lock.json')).toBe(false);
    expect(ignored('tools/word-meanings/reference-corrections.json')).toBe(false);
  });

  it.skipIf(inCi && !sourceBytes)('the local original is the pinned file (every pin)', () => {
    expect(sourceBytes, 'run: node tools/word-meanings/import.mjs').not.toBeNull();
    expect(importer.pinMismatch(sourceBytes, lock)).toBeNull();
  });

  it.skipIf(inCi && !sourceBytes)('the import is deterministic: two builds are identical, and identical to the dataset on disk', () => {
    const first = importer.renderDataset(importer.buildFromSource(sourceBytes, lock).dataset);
    const second = importer.renderDataset(importer.buildFromSource(sourceBytes, lock).dataset);
    expect(first).toBe(second);
    expect(first).toBe(datasetText);
  });

  it.skipIf(inCi && !sourceBytes)('no record is lost: every bracketed word is an entry or a quotation, every paragraph accounted for', () => {
    const paragraphs = lib.documentParagraphs(lib.readZipEntry(sourceBytes, 'word/document.xml').toString('utf8'));
    const { entries, report } = lib.parseGhareebParagraphs(paragraphs);
    const bracketed = paragraphs.reduce((n: number, text: string) => n + [...text.matchAll(/﴿[^﴿﴾]*﴾/g)].length, 0);
    expect(bracketed).toBe(11391);
    expect(entries.length + report.quotations.length).toBe(bracketed);
    expect(paragraphs.length).toBe(report.emptyParagraphs + report.surahHeadings.length + report.ayahParagraphs + report.continuations.length);
    expect({ entries: entries.length, quotations: report.quotations.length, continuations: report.continuations.length, ranges: report.ayahRanges.length }).toEqual({ entries: 11384, quotations: 7, continuations: 8, ranges: 2 });
  });

  it.skipIf(inCi && !datasetReady)('the dataset has been built from the pinned source (status official)', () => {
    expect(datasetReady, 'run: node tools/word-meanings/import.mjs').toBe(true);
    expect(dataset.source.sha256).toBe(lock.sha256);
  });

  describe.skipIf(!datasetReady)('its entries', () => {
    it('604 pages, every one with entries; ids 1…N in source order, each once; counts agree', () => {
      expect(dataset.pages).toHaveLength(604);
      expect(dataset.pages.every((page: Row[]) => page.length > 0)).toBe(true);
      expect(rows().map((r) => r[0])).toEqual(Array.from({ length: rows().length }, (_, i) => i + 1));
      expect(rows()).toHaveLength(dataset.counts.entries);
      expect(dataset.counts.entries).toBe(11384);
    });

    it('valid Surah and ayah references, and each entry on the page of its ayah (the reader\'s own page table)', () => {
      for (const [id, surah, ayah, ayahEnd] of rows()) {
        expect(surah >= 1 && surah <= 114, `#${id}`).toBe(true);
        expect(ayah >= 1 && ayah <= ayahEnd && ayahEnd <= SURAH_AYAH_COUNTS[surah - 1], `#${id}`).toBe(true);
      }
      (dataset.pages as Row[][]).forEach((page, i) => {
        for (const [id, surah, ayah, ayahEnd] of page) {
          expect(pageOfAyah(surah, ayah), `#${id}`).toBe(i + 1);
          expect(pageOfAyah(surah, ayahEnd), `#${id}`).toBe(i + 1);
        }
      });
    });

    it('no empty word or explanation, no line break, no fragment (an explanation of punctuation only, or stopping at a colon)', () => {
      for (const [id, , , , word, explanation] of rows()) {
        expect(word.trim() && explanation.trim(), `#${id}`).toBeTruthy();
        expect(/\n/.test(word + explanation), `#${id}`).toBe(false);
        expect(/[ء-ي]/.test(explanation) && !/:\s*$/.test(explanation), `#${id}`).toBe(true);
      }
    });

    it('each Quranic word is in its ayah (the verified Tanzil text, by base letters)', () => {
      const tanzil = new Map(readFileSync(join(repo, 'tools/quran-verification/input/quran-uthmani.txt'), 'utf8').split(/\r?\n/).map((line) => line.split('|')).filter((f) => f.length === 3).map(([s, a, t]) => [`${s}:${a}`, t]));
      const missing = rows().filter(([, surah, ayah, ayahEnd, word]) => {
        let text = '';
        for (let a = ayah; a <= ayahEnd; a++) text += tanzil.get(`${surah}:${a}`);
        return !lib.letterSkeleton(text).includes(lib.letterSkeleton(word));
      });
      expect(missing.map((r) => `#${r[0]} ${r[1]}:${r[2]}`)).toEqual([]);
    });

    it('the one reviewed reference correction: listed under 30:49, its word is in 30:50 (same page, 409), not in 30:49', () => {
      expect(dataset.referenceCorrections).toEqual([{ id: 6975, surah: 30, sourceAyah: 49, ayah: 50 }]);
      const entry = rows().find((r) => r[0] === 6975)!;
      const tanzil = (key: string) => lib.letterSkeleton(readFileSync(join(repo, 'tools/quran-verification/input/quran-uthmani.txt'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${key}|`))!);
      expect(tanzil('30|50')).toContain(lib.letterSkeleton(entry[4]));
      expect(tanzil('30|49')).not.toContain(lib.letterSkeleton(entry[4]));
      expect([pageOfAyah(30, 49), pageOfAyah(30, 50)]).toEqual([409, 409]);
    });

    it('repeated words are preserved: identical word-and-explanation pairs appear under their own ayahs', () => {
      const seen = new Map<string, number>();
      for (const r of rows()) seen.set(`${r[4]}|${r[5]}`, (seen.get(`${r[4]}|${r[5]}`) ?? 0) + 1);
      expect([...seen.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0)).toBe(431);
    });

    it('representative pages: 1, 2, 61, 125 and 604; multi-Surah pages; the fullest and the sparest', () => {
      const refs = (page: number) => (dataset.pages[page - 1] as Row[]).map((r) => `${r[1]}:${r[2]}`);
      expect(refs(1)[0]).toBe('1:1');
      expect(new Set(refs(1).map((r) => r.split(':')[0]))).toEqual(new Set(['1']));
      expect(refs(2)[0]).toBe('2:1');
      expect(refs(61).every((r) => r.startsWith('3:'))).toBe(true);
      expect(refs(125).every((r) => r.startsWith('5:'))).toBe(true);
      expect(new Set(refs(604).map((r) => r.split(':')[0]))).toEqual(new Set(['112', '113', '114']));
      // A page holding two Surahs' ends and beginnings (Al-Ma'idah begins mid-page 106): both Surahs' entries.
      expect(new Set(refs(106).map((r) => r.split(':')[0]))).toEqual(new Set(['4', '5']));
      const sizes = (dataset.pages as Row[][]).map((page) => page.length);
      expect(Math.max(...sizes)).toBe(52);
      expect(sizes.indexOf(52) + 1).toBe(576);
      expect(Math.min(...sizes)).toBe(5);
    });

    it.skipIf(!existsSync(join(repo, 'backend/data/mushaf-sync')))('every entry is on the QCF V1 page of its ayah, from Quran Foundation\'s word records (local snapshot); no ayah crosses a page', () => {
      const dir = join(repo, 'backend/data/mushaf-sync');
      const snapshot = readdirSync(dir).find((name) => /^records-\d+\.json\.gz$/.test(name))!;
      type Rec = { record_type: string; mushaf_id: number; page_number: number; verse_id: number };
      const records = JSON.parse(gunzipSync(readFileSync(resolve(dir, snapshot))).toString('utf8')) as Rec[];
      const pagesOf = new Map<number, Set<number>>();
      for (const r of records) if (r.record_type === 'mushaf_word' && r.mushaf_id === 2) pagesOf.set(r.verse_id, (pagesOf.get(r.verse_id) ?? new Set()).add(r.page_number));
      expect([...pagesOf.values()].filter((s) => s.size !== 1)).toHaveLength(0);
      const firstVerse = SURAH_AYAH_COUNTS.reduce<number[]>((acc, n) => [...acc, acc.at(-1)! + n], [0]);
      (dataset.pages as Row[][]).forEach((page, i) => {
        for (const [id, surah, ayah, ayahEnd] of page) for (let a = ayah; a <= ayahEnd; a++) expect([...pagesOf.get(firstVerse[surah - 1] + a)!], `#${id}`).toEqual([i + 1]);
      });
    });
  });
});
