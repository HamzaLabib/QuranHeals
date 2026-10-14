import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SURAH_START_PAGES } from '@/mushaf/generated/surahStartPages';
import { normalizeArabic, normalizeLatin, searchSurahs, SURAHS } from '@/mushaf/surahSearch';

/**
 * The Mushaf search's Surah list: the 114 Surahs with the page each begins
 * on, and how typed names find them. The page table is checked here against
 * the pinned Tanzil quran-data.xml it was generated from
 * (tools/quran-import/generate-surah-pages.mjs), independently recomputed.
 */

const xml = readFileSync(resolve(__dirname, '../../tools/quran-verification/input/quran-data.xml'), 'utf8');
const pageStarts = [...xml.matchAll(/<page index="(\d+)" sura="(\d+)" aya="(\d+)"/g)].map((m) => ({ page: +m[1], surah: +m[2], ayah: +m[3] }));
const ayahCounts = [...xml.matchAll(/<sura index="(\d+)" ayas="(\d+)"/g)].map((m) => +m[2]);

describe('the Surah list and first pages', () => {
  it('has all 114 Surahs in Quran order, from الفاتحة to الناس', () => {
    expect(SURAHS).toHaveLength(114);
    expect(SURAHS.map((surah) => surah.surahNumber)).toEqual(Array.from({ length: 114 }, (_, i) => i + 1));
    expect(SURAHS[0]).toEqual({ surahNumber: 1, nameArabic: 'الفاتحة', nameEnglish: 'Al-Faatiha', startPage: 1 });
    expect(SURAHS[113]).toMatchObject({ nameArabic: 'الناس', startPage: 604 });
  });

  it('every Surah opens the page holding its first ayah (Tanzil`s 604-page table, recomputed here)', () => {
    expect(pageStarts).toHaveLength(604);
    for (let surah = 1; surah <= 114; surah++) {
      const expected = pageStarts.filter((p) => p.surah < surah || (p.surah === surah && p.ayah === 1)).at(-1)!.page;
      expect(SURAH_START_PAGES[surah - 1], `Surah ${surah}`).toBe(expected);
      // And that page really holds ayah 1: it starts at or before it, and the next page starts after it.
      const next = pageStarts[expected];
      if (next) expect(next.surah > surah || (next.surah === surah && next.ayah > 1), `Surah ${surah}`).toBe(true);
    }
  });

  it('known first pages of the Madinah Mushaf, including Surahs that begin partway down a page', () => {
    const known: [number, number][] = [[1, 1], [2, 2], [3, 50], [4, 77], [9, 187], [18, 293], [36, 440], [55, 531], [67, 562], [78, 582], [112, 604], [113, 604], [114, 604]];
    for (const [surah, page] of known) expect(SURAH_START_PAGES[surah - 1], `Surah ${surah}`).toBe(page);
    // Short Surahs share pages: 112–114 all begin on 604, so 113 and 114 start partway down it.
    expect(new Set(SURAH_START_PAGES).size).toBeLessThan(114);
    expect(ayahCounts).toHaveLength(114);
  });
});

describe('finding a Surah by name', () => {
  const first = (query: string) => searchSurahs(query)[0]?.surahNumber;

  it('an empty search lists every Surah in order', () => {
    expect(searchSurahs('').map((s) => s.surahNumber)).toEqual(SURAHS.map((s) => s.surahNumber));
    expect(searchSurahs('   ')).toHaveLength(114);
  });

  it('Arabic: with or without diacritics, hamza and alef forms, ta marbuta, the article or «سورة»', () => {
    expect(normalizeArabic('ٱلْبَقَرَة')).toBe(normalizeArabic('البقره'));
    expect(normalizeArabic('إبراهيم')).toBe('ابراهيم');
    expect(normalizeArabic('سورة يس')).toBe('يس');
    expect(first('البقرة')).toBe(2);
    expect(first('بقرة')).toBe(2);
    expect(first('ٱلْكَهْف')).toBe(18);
    expect(first('آل عمران')).toBe(3);
    expect(first('ال عمران')).toBe(3);
    expect(first('الاسراء')).toBe(17);
    expect(first('إبراهيم')).toBe(14);
    expect(first('المائده')).toBe(5);
    expect(first('سبا')).toBe(34);
    expect(first('الرحمـٰن')).toBe(55);
  });

  it('English: any case, without hyphens or apostrophes, common spellings', () => {
    expect(normalizeLatin("Al-An'aam")).toBe(normalizeLatin('alanam'));
    for (const [query, surah] of [['baqarah', 2], ['Al Baqara', 2], ['FATIHA', 1], ['Faatiha', 1], ['imran', 3], ['Yasin', 36], ['Ya Sin', 36], ['yaseen', 36], ['kahf', 18], ['Rahman', 55], ['ikhlas', 112], ['nas', 114], ['taha', 20], ['tawbah', 9]] as const) {
      expect(first(query), query).toBe(surah);
    }
  });

  it('partial names find every Surah that contains them, names starting with the query first', () => {
    const results = searchSurahs('an');
    expect(results.length).toBeGreaterThan(5);
    expect(searchSurahs('بقر').map((s) => s.surahNumber)).toEqual([2]);
    const ranked = searchSurahs('nisa').map((s) => s.surahNumber);
    expect(ranked[0]).toBe(4);
  });

  it('a Surah number, in Western or Arabic-Indic digits', () => {
    expect(searchSurahs('36').map((s) => s.surahNumber)).toEqual([36]);
    expect(searchSurahs('٣٦').map((s) => s.surahNumber)).toEqual([36]);
    expect(searchSurahs('115')).toEqual([]);
  });

  it('nothing matching: an empty list (the sheet shows its no-results message)', () => {
    expect(searchSurahs('xyzzy')).toEqual([]);
    expect(searchSurahs('ثثثث')).toEqual([]);
  });
});
