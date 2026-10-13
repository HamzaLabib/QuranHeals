import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { HIZB_QUARTER_STARTS } from '@/mushaf/generated/hizbQuarters';
import { HIZB_ORDINALS, hizbLabelsForPage, hizbQuarterLabel } from '@/mushaf/hizbQuarters';
import { juzTitle } from '@/mushaf/mushafPage';

const counts = (JSON.parse(readFileSync(new URL('../../tools/quran-verification/surah-counts.json', import.meta.url), 'utf8')) as { counts: number[] }).counts;
const KEYS = counts.flatMap((n, s) => Array.from({ length: n }, (_, a) => `${s + 1}:${a + 1}`));
const order = (key: string) => KEYS.indexOf(key);

describe('Hizb and quarter-Hizb starts (generated/hizbQuarters.ts)', () => {
  it('has the 240 quarters, in Quran order, one per page, from page 1 to 599', () => {
    expect(HIZB_QUARTER_STARTS.map(([q]) => q)).toEqual(Array.from({ length: 240 }, (_, i) => i + 1));
    for (let i = 1; i < 240; i++) {
      expect(order(HIZB_QUARTER_STARTS[i][1])).toBeGreaterThan(order(HIZB_QUARTER_STARTS[i - 1][1]));
      expect(HIZB_QUARTER_STARTS[i][2]).toBeGreaterThan(HIZB_QUARTER_STARTS[i - 1][2]); // no page holds two starts
    }
    expect(HIZB_QUARTER_STARTS[0]).toEqual([1, '1:1', 1]);
    expect(HIZB_QUARTER_STARTS[239]).toEqual([240, '100:9', 599]);
    // The one documented correction to Tanzil (15:50): the ۞ is printed on 15:49 (QCF V1 page 264).
    expect(HIZB_QUARTER_STARTS[105]).toEqual([106, '15:49', 264]);
  });

  it('labels each quarter as printed: الحزب, ربع, نصف, ثلاثة أرباع الحزب … with the header`s ordinals', () => {
    expect(hizbQuarterLabel(1)).toBe('الحزب الأول');
    expect(hizbQuarterLabel(2)).toBe('ربع الحزب الأول');
    expect(hizbQuarterLabel(3)).toBe('نصف الحزب الأول');
    expect(hizbQuarterLabel(4)).toBe('ثلاثة أرباع الحزب الأول');
    expect(hizbQuarterLabel(5)).toBe('الحزب الثاني');
    expect(hizbQuarterLabel(106)).toBe('ربع الحزب السابع والعشرون');
    expect(hizbQuarterLabel(237)).toBe('الحزب الستون');
    expect(hizbQuarterLabel(240)).toBe('ثلاثة أرباع الحزب الستون');
    expect(() => hizbQuarterLabel(0)).toThrow();
    expect(() => hizbQuarterLabel(241)).toThrow();
    // The same ordinals as the header's juz' (الجزء الأول … الثلاثون), 60 of them.
    expect(HIZB_ORDINALS).toHaveLength(60);
    for (let n = 1; n <= 30; n++) expect(`الجزء ${HIZB_ORDINALS[n - 1]}`).toBe(juzTitle(n));
    expect(new Set(HIZB_ORDINALS).size).toBe(60);
  });

  it('shows labels only on the 240 start pages; the other 364 pages have none', () => {
    const labelled = Array.from({ length: 604 }, (_, i) => i + 1).filter((page) => hizbLabelsForPage(page).length > 0);
    expect(labelled).toEqual(HIZB_QUARTER_STARTS.map(([, , page]) => page));
    expect(labelled).toHaveLength(240);
    expect(hizbLabelsForPage(1)).toEqual(['الحزب الأول']);
    expect(hizbLabelsForPage(5)).toEqual(['ربع الحزب الأول']);
    expect(hizbLabelsForPage(7)).toEqual(['نصف الحزب الأول']);
    expect(hizbLabelsForPage(9)).toEqual(['ثلاثة أرباع الحزب الأول']);
    expect(hizbLabelsForPage(11)).toEqual(['الحزب الثاني']);
    for (const page of [2, 3, 4, 6, 8, 10, 61, 604]) expect(hizbLabelsForPage(page), `page ${page}`).toEqual([]);
  });
});

/** Where a local Content Sync snapshot exists: every start page is the QCF V1 page of its ayah's first word. */
const dir = fileURLToPath(new URL('../../backend/data/mushaf-sync/', import.meta.url));
const snapshot = existsSync(dir) ? readdirSync(dir).find((name) => /^records-\d+\.json\.gz$/.test(name)) : undefined;
describe.skipIf(!snapshot)('Hizb starts against the QCF V1 (1405 AH) layout (local snapshot)', () => {
  it('every start ayah`s first word is on the page given', () => {
    type Rec = { record_type: string; mushaf_id: number; page_number: number; position_in_verse: number; verse_id: number };
    const records = JSON.parse(gunzipSync(readFileSync(resolve(dir, snapshot!))).toString('utf8')) as Rec[];
    const firstWordPage = new Map<number, number>();
    for (const r of records) if (r.record_type === 'mushaf_word' && r.mushaf_id === 2 && r.position_in_verse === 1) firstWordPage.set(r.verse_id, r.page_number);
    const wrong = HIZB_QUARTER_STARTS.filter(([, key, page]) => firstWordPage.get(order(key) + 1) !== page);
    expect(wrong).toEqual([]);
  });
});

describe('Hizb labels in Normal and Full-Screen (Taller): the same 240 pages, in the same header', () => {
  it('every page width and frame height (29–35 tiles): the header is the same, the frame below it; 240 labelled pages, 364 without', async () => {
    const { computePageLayout } = await import('@/mushaf/pageGeometry');
    const labelled = Array.from({ length: 604 }, (_, i) => i + 1).filter((page) => hizbLabelsForPage(page).length > 0);
    expect(labelled).toHaveLength(240);
    expect(labelled).toEqual(HIZB_QUARTER_STARTS.map(([, , page]) => page));
    expect(hizbLabelsForPage(264)).toEqual([hizbQuarterLabel(106)]); // 15:49, kept
    for (const width of [251, 268, 310, 314, 338, 354, 387, 396, 406, 426, 434]) {
      const normal = computePageLayout(width, 29);
      for (let tiles = 29; tiles <= 35; tiles++) {
        const taller = computePageLayout(width, tiles);
        // The label lives in the header row (MushafPageView): the same box in every frame; the frame starts below it.
        expect(taller.header).toEqual(normal.header);
        expect(taller.headerFontSize).toBe(normal.headerFontSize);
        expect(taller.frame.y).toBeGreaterThan(taller.header.y + taller.header.height);
      }
    }
  });
});
