import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { HIZB_QUARTER_STARTS } from '@/mushaf/generated/hizbQuarters';
import { PAGE_FIRST_AYAH } from '@/mushaf/generated/pageStarts';
import { SURAH_START_PAGES } from '@/mushaf/generated/surahStartPages';
import { HIZB_COUNT, HIZB_START_PAGES, JUZ_COUNT, JUZ_START_PAGES, pageInfo, pageOfAyah, parseTypedPage, searchNumbered, surahStartPage } from '@/mushaf/navigation';

/**
 * The reader's navigation metadata (mushaf/navigation.ts): the generated page starts (Tanzil's pinned <pages>)
 * cross-checked against independent tables (the Surah start pages, the Hizb quarters verified against the QCF V1 print,
 * the Madani Mushaf's printed juz' pages) and, where the local Content Sync snapshot exists, against Quran Foundation's
 * own first word of every page.
 */

const key = ([surah, ayah]: readonly [number, number]) => surah * 1000 + ayah;

describe('page starts (generated/pageStarts.ts)', () => {
  it('604 pages, from 1:1, each beginning after the previous one', () => {
    expect(PAGE_FIRST_AYAH).toHaveLength(604);
    expect(PAGE_FIRST_AYAH[0]).toEqual([1, 1]);
    for (let i = 1; i < 604; i++) expect(key(PAGE_FIRST_AYAH[i]), `page ${i + 1}`).toBeGreaterThan(key(PAGE_FIRST_AYAH[i - 1]));
    expect(PAGE_FIRST_AYAH[603][0]).toBe(112); // page 604: Al-Ikhlāṣ, Al-Falaq, An-Nās
  });

  it('agree with the Surah start pages for all 114 Surahs (the page holding each Surah`s first ayah)', () => {
    for (let surah = 1; surah <= 114; surah++) expect(pageOfAyah(surah, 1), `Surah ${surah}`).toBe(SURAH_START_PAGES[surah - 1]);
  });

  it('agree with every one of the 240 Hizb quarters (verified against the QCF V1 print)', () => {
    for (const [quarter, verseKey, page] of HIZB_QUARTER_STARTS) {
      const [surah, ayah] = verseKey.split(':').map(Number);
      expect(pageOfAyah(surah, ayah), `quarter ${quarter} (${verseKey})`).toBe(page);
    }
  });

  const dir = fileURLToPath(new URL('../../backend/data/mushaf-sync/', import.meta.url));
  const snapshot = existsSync(dir) ? readdirSync(dir).find((name) => /^records-\d+\.json\.gz$/.test(name)) : undefined;
  it.skipIf(!snapshot)('agree with Quran Foundation`s QCF V1 layout: the first word on each of the 604 pages (local snapshot)', () => {
    type Rec = { record_type: string; mushaf_id: number; page_number: number; position_in_page: number; verse_id: number };
    const records = JSON.parse(gunzipSync(readFileSync(resolve(dir, snapshot!))).toString('utf8')) as Rec[];
    const counts = (JSON.parse(readFileSync(new URL('../../tools/quran-verification/surah-counts.json', import.meta.url), 'utf8')) as { counts: number[] }).counts;
    const keys = counts.flatMap((n, s) => Array.from({ length: n }, (_, a) => [s + 1, a + 1] as const));
    const first = new Map<number, Rec>();
    for (const r of records) {
      if (r.record_type !== 'mushaf_word' || r.mushaf_id !== 2) continue;
      const seen = first.get(r.page_number);
      if (!seen || r.position_in_page < seen.position_in_page) first.set(r.page_number, r);
    }
    expect(first.size).toBe(604);
    for (let page = 1; page <= 604; page++) expect(keys[first.get(page)!.verse_id - 1], `page ${page}`).toEqual(PAGE_FIRST_AYAH[page - 1]);
  });
});

describe('division start pages', () => {
  it('the 30 juz` begin on the Madani Mushaf`s printed pages (1, 22, 42 … 582)', () => {
    expect(JUZ_START_PAGES).toEqual([1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582]);
    expect(JUZ_START_PAGES).toHaveLength(JUZ_COUNT);
  });

  it('60 whole Hizbs, never a quarter marker: Hizb 2j − 1 begins with juz` j, and each Hizb is 4 quarters later', () => {
    expect(HIZB_START_PAGES).toHaveLength(HIZB_COUNT);
    for (let j = 1; j <= 30; j++) expect(HIZB_START_PAGES[2 * j - 2], `Hizb ${2 * j - 1}`).toBe(JUZ_START_PAGES[j - 1]);
    for (let h = 1; h <= 60; h++) expect(HIZB_START_PAGES[h - 1]).toBe(HIZB_QUARTER_STARTS[(h - 1) * 4][2]);
    for (let h = 1; h < 60; h++) expect(HIZB_START_PAGES[h]).toBeGreaterThan(HIZB_START_PAGES[h - 1]);
  });

  it('Surah start pages: Al-Fātiḥah 1, Al-Baqarah 2, Āl ʿImrān 50, Al-Māʾidah 106 (mid-page), At-Tawbah 187, An-Nās 604', () => {
    expect([1, 2, 3, 5, 9, 114].map(surahStartPage)).toEqual([1, 2, 50, 106, 187, 604]);
  });
});

describe('pageInfo: the Surah and juz` at the top of the page (the running heads` rule)', () => {
  it('first and last pages, a juz` boundary page, and pages where a Surah begins partway down', () => {
    expect(pageInfo(1)).toEqual({ page: 1, surah: 1, juz: 1 });
    expect(pageInfo(21)).toEqual({ page: 21, surah: 2, juz: 1 });
    expect(pageInfo(22)).toEqual({ page: 22, surah: 2, juz: 2 }); // juz' 2 begins with 2:142, the page's first ayah
    expect(pageInfo(50)).toEqual({ page: 50, surah: 3, juz: 3 }); // Āl ʿImrān begins at the top
    // Al-Māʾidah begins partway down page 106: the page still belongs to An-Nisāʾ, the Surah at its top.
    expect(pageInfo(106)?.surah).toBe(4);
    expect(pageInfo(604)).toEqual({ page: 604, surah: 112, juz: 30 }); // three Surahs: the first one, Al-Ikhlāṣ
  });

  it('every page has one, and none outside 1–604', () => {
    for (let page = 1; page <= 604; page++) expect(pageInfo(page)).not.toBeNull();
    for (const page of [0, 605, -1, 1.5, Number.NaN]) expect(pageInfo(page)).toBeNull();
  });
});

describe('typed numbers', () => {
  it('juz` and Hizb search by number, in Western or Arabic-Indic digits, words around them ignored', () => {
    expect(searchNumbered('', 30)).toHaveLength(30);
    expect(searchNumbered('3', 30)).toEqual([3, 30]);
    expect(searchNumbered('٣', 30)).toEqual([3, 30]);
    expect(searchNumbered('الجزء ١٢', 30)).toEqual([12]);
    expect(searchNumbered('Hizb 59', 60)).toEqual([59]);
    expect(searchNumbered('61', 60)).toEqual([]);
  });

  it('a typed page: 1–604 in Western or Arabic-Indic digits only, never a fraction or out of range', () => {
    expect(parseTypedPage('604')).toBe(604);
    expect(parseTypedPage('٢٠٠')).toBe(200);
    expect(parseTypedPage('۲۰۰')).toBe(200);
    for (const bad of ['0', '605', '1.5', '12a', '', ' ', '-3']) expect(parseTypedPage(bad), bad).toBeNull();
  });
});
