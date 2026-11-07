import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * tools/tafsir: the KFGQPC adapter's structural rules (on a SYNTHETIC table shaped like the developer package, with
 * the label variants and the one shared passage found in the real file), the coverage check, and that the generated
 * modules are exactly what build.mjs writes. No real tafsir text.
 */
const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const counts: number[] = JSON.parse(readFileSync(repo('tools/quran-verification/surah-counts.json'), 'utf8')).counts;
const adapter = await import(repo('tools/tafsir/adapters/kfgqpc-mouaser.mjs'));
const lib = await import(repo('tools/tafsir/lib.mjs'));
const quranenc = await import(repo('tools/tafsir/adapters/quranenc-sqlite.mjs'));

const OPEN = 'ﵡ';
const CLOSE = 'ﵠ';

function table(override: (surah: number, ayah: number) => string | null = () => null) {
  const lines = ['id\tjozz\tpage\tsura_no\tsura_name_en\tsura_name_ar\tline_start\tline_end\taya_no\taya_text\taya_text_emlaey\taya_tafseer'];
  let id = 1;
  counts.forEach((count, i) => {
    for (let ayah = 1; ayah <= count; ayah += 1) {
      const text = override(i + 1, ayah) ?? `[${ayah}] نص تجريبي ${i + 1}:${ayah}`;
      lines.push(`${id++}\t1\t1\t${i + 1}\tx\tx\t1\t1\t${ayah}\tx\tx\t${text}`);
    }
  });
  return `${lines.join('\r\n')}\r\n`;
}

describe('KFGQPC «التفسير الميسر» adapter', () => {
  it('removes only a label naming the row\'s own ayah, keeping what follows it (the source\'s variants)', () => {
    const variants: Record<string, string> = {
      '11:55': '[55]، تكملة',
      '26:99': '99]  تكملة',
      '33:39': '[39]ثم تكملة',
      '26:51': '[51]. تكملة',
    };
    const surahs = adapter.convertRows(adapter.rowsFromTable(table((s: number, a: number) => variants[`${s}:${a}`] ?? null)), counts);
    expect(lib.coverageProblem(surahs, counts)).toBeNull();
    expect(surahs[10][54]).toEqual([55, 55, '، تكملة']);
    expect(surahs[25][98]).toEqual([99, 99, 'تكملة']);
    expect(surahs[32][38]).toEqual([39, 39, 'ثم تكملة']);
    expect(surahs[25][50]).toEqual([51, 51, '. تكملة']);
  });

  it('a passage labelled on both its rows with the same commentary is kept once, as its range; a one-sided label stays on its ayah and is reported', () => {
    const shared = '[33، 34] نص تجريبي مشترك';
    const surahs = adapter.convertRows(adapter.rowsFromTable(table((s: number, a: number) => (s === 28 && (a === 33 || a === 34) ? shared : s === 68 && a === 22 ? '[21، 22] تكملة' : null))), counts);
    expect(surahs[27].filter((e: number[]) => e[0] >= 32 && e[0] <= 35)).toEqual([[32, 32, 'نص تجريبي 28:32'], [33, 34, 'نص تجريبي مشترك'], [35, 35, 'نص تجريبي 28:35']]);
    expect(surahs[67].filter((e: number[]) => e[0] === 21 || e[0] === 22)).toEqual([[21, 21, 'نص تجريبي 68:21'], [22, 22, 'تكملة']]);
    expect(adapter.anomalies).toEqual([expect.stringContaining('68:22 is labelled [21، 22]')]);
    expect(lib.stats(surahs)).toEqual({ entries: 6235, ranges: 1 });
  });

  it('quotations: the tag removed, the Hafs font\'s two bracket code points become ﴿ ﴾; nothing else changes', () => {
    expect(adapter.quotations(`قبل <span class='aya'>${OPEN}آية${CLOSE}</span> بعد`)).toEqual({ text: 'قبل ﴿آية﴾ بعد', count: 1 });
    expect(() => adapter.quotations(`${OPEN}خارج`)).toThrow(/outside a quotation/);
    expect(() => adapter.quotations('<b>غليظ</b>')).toThrow(/markup/);
  });

  it('stops on a label naming another ayah, a missing row or a duplicate', () => {
    expect(() => adapter.convertRows(adapter.rowsFromTable(table((s: number, a: number) => (s === 2 && a === 5 ? '[6] خطأ' : null))), counts)).toThrow(/labelled/);
    const rows = adapter.rowsFromTable(table());
    expect(() => adapter.convertRows(rows.slice(1), counts)).toThrow(/rows/);
    expect(() => adapter.convertRows([...rows.slice(1), rows[2]], counts)).toThrow(/row 1:3/);
  });
});

describe('QuranEnc «التفسير الميسر» adapter (quranenc-sqlite)', () => {
  /** SYNTHETIC rows, one per ayah, in Mushaf order. */
  const rows = (text: (s: number, a: number) => string = (s, a) => `نص تجريبي ${s}:${a}`) => {
    const out: { id: number; sura: number; aya: number; translation: string; footnotes: string }[] = [];
    counts.forEach((count, i) => {
      for (let a = 1; a <= count; a += 1) out.push({ id: out.length + 1, sura: i + 1, aya: a, translation: text(i + 1, a), footnotes: '' });
    });
    return out;
  };

  it('keeps every text byte for byte; only consecutive identical texts of one Surah become one passage', () => {
    const joint = 'نص تجريبي مشترك';
    const refrain = 'لازمة تجريبية';
    const text = (s: number, a: number) =>
      (s === 28 && (a === 33 || a === 34)) || (s === 68 && (a === 21 || a === 22)) ? joint
        : s === 55 && (a === 13 || a === 16) ? refrain // the same text on ayahs that are not adjacent
          : s === 96 && [10, 11, 12, 14, 15].includes(a) ? 'مقطع' // a run interrupted by 96:13
            : (s === 1 && a === 7) || (s === 2 && a === 1) ? 'عبر السورتين' // adjacent across two Surahs
              : `نص تجريبي ${s}:${a}`;
    const surahs = quranenc.entriesFromRows(quranenc.validateRows(rows(text), counts));
    expect(lib.coverageProblem(surahs, counts)).toBeNull();
    expect(surahs[27].filter((e: number[]) => e[0] >= 32 && e[0] <= 35).map((e: unknown[]) => e.slice(0, 2))).toEqual([[32, 32], [33, 34], [35, 35]]);
    expect(surahs[67].find((e: number[]) => e[0] === 21)).toEqual([21, 22, joint]);
    expect(surahs[54].filter((e: unknown[]) => e[2] === refrain).map((e: unknown[]) => e.slice(0, 2))).toEqual([[13, 13], [16, 16]]);
    expect(surahs[95].filter((e: unknown[]) => e[2] === 'مقطع').map((e: unknown[]) => e.slice(0, 2))).toEqual([[10, 12], [14, 15]]);
    expect(surahs[0][6]).toEqual([7, 7, 'عبر السورتين']);
    expect(surahs[1][0]).toEqual([1, 1, 'عبر السورتين']);
    expect(quranenc.repeats).toEqual(expect.arrayContaining([['55:13', '55:16'], ['96:10-12', '96:14-15'], ['1:7', '2:1']]));
  });

  it.each([
    ['a missing row', (r: ReturnType<typeof rows>) => r.splice(100, 1)],
    ['rows out of order', (r: ReturnType<typeof rows>) => { [r[5], r[6]] = [r[6], r[5]]; }],
    ['an empty text', (r: ReturnType<typeof rows>) => { r[9].translation = ' '; }],
    ['surrounding spaces (never trimmed: the text is not changed)', (r: ReturnType<typeof rows>) => { r[9].translation += ' '; }],
    ['markup', (r: ReturnType<typeof rows>) => { r[9].translation = '<b>x</b>'; }],
    ['a footnote the reader would not show', (r: ReturnType<typeof rows>) => { r[9].footnotes = '[1] حاشية'; }],
  ])('stops on %s', (_name, damage) => {
    const r = rows();
    damage(r);
    expect(() => quranenc.validateRows(r, counts)).toThrow(/quranenc-sqlite/);
  });
});

describe('build.mjs and editions.json', () => {
  const editions = JSON.parse(readFileSync(repo('tools/tafsir/editions.json'), 'utf8')).editions as { id: string; source: Record<string, unknown> | null; rights: { status: string }; kfgqpcV3?: Record<string, unknown> }[];
  const byId = (id: string) => editions.find((e) => e.id === id)!;

  it('only التفسير الميسر is cleared; the other three have no source and unverified rights', () => {
    expect(byId('muyassar').rights.status).toBe('verified');
    for (const id of ['saadi', 'jalalayn', 'zilal']) {
      expect(byId(id).source).toBeNull();
      expect(byId(id).rights.status).toBe('unverified');
    }
  });

  it('الميسر is QuranEnc.com\'s own artifact, pinned by SHA-256, with its upstream version; King Fahd\'s v3 package is a separate, unused record', () => {
    expect(byId('muyassar').source).toMatchObject({
      adapter: 'quranenc-sqlite',
      url: 'https://quranenc.com/downloads/sqlite/arabic_moyassar.zip',
      bytes: 812274,
      sha256: '96182831395a03e7497a8f398a960d45fcf90397dd72760ac35d735752a18046',
      entry: 'arabic_moyassar.sqlite',
      entrySha256: 'eb384e586487b089b826375d3f705d07e775e0019325da405e0337a9f6b3da04',
      upstream: { distributor: 'QuranEnc.com', key: 'arabic_moyassar', version: '1.0.0', lastUpdate: 1487106000 },
      distributor: 'QuranEnc.com',
      version: '1.0.0',
    });
    expect(byId('muyassar').kfgqpcV3).toMatchObject({ url: 'https://download.qurancomplex.gov.sa/resources_dev/hafs_tafseerMouaser_v3.zip', md5: '5601682965e32f4dd6992c7600fdccc3' });
  });

  // The original is git-ignored (tools/tafsir/source/): where it was restored, a fresh build must equal what is checked in.
  it.skipIf(!existsSync(repo('tools/tafsir/source/muyassar/arabic_moyassar.zip')))('the generated modules and the bundled file are exactly a fresh build', () => {
    const output = execFileSync(process.execPath, [repo('tools/tafsir/build.mjs'), '--verify'], { encoding: 'utf8' });
    expect(output).toContain('muyassar: ready');
    expect(output).toContain('5278 entries (494 ranges)');
    expect(output).toContain('saadi: blocked');
  });
});
