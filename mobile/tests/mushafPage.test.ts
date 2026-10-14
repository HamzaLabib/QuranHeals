/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { HAFS_KFQC_PAGE_061 } from '@/mushaf/generated/hafsKfqcPage061';
import {
  ayahAtPoint,
  juzOfAyah,
  juzTitle,
  MushafPageError,
  parseMushafPage,
  polygonToPath,
  polygonToRects,
  tintAyahMarkers,
  toArabicIndicDigits,
  toPageCoordinates,
  type MushafPageSource,
} from '@/mushaf/mushafPage';
import { openTestDatabase } from './helpers/sqlite';

/** Mushaf page 61 (quran-ws/quran-svg v1.1.1, Hafs/KFQC): integrity, verified boundaries, and verse selection. */

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const tanzilData = readFileSync(resolve(__dirname, '../../tools/quran-verification/input/quran-data.xml'), 'utf-8');
const page = parseMushafPage(HAFS_KFQC_PAGE_061);

describe('bundled page 61', () => {
  it('is byte-identical to the pinned v1.1.1 release files', () => {
    expect(HAFS_KFQC_PAGE_061.source).toMatchObject({ repository: 'quran-ws/quran-svg', tag: 'v1.1.1' });
    expect(HAFS_KFQC_PAGE_061.source.svgUrl).toContain('/v1.1.1/mushafs/hafs/kfqc/svg/061.svg');
    expect(sha256(HAFS_KFQC_PAGE_061.svg)).toBe(HAFS_KFQC_PAGE_061.source.svgSha256);
    expect(sha256(HAFS_KFQC_PAGE_061.mappingJson)).toBe(HAFS_KFQC_PAGE_061.source.mappingSha256);
    expect(HAFS_KFQC_PAGE_061.source.svgSha256).toBe('60bd941ffc69c001e9c5ac2820c88852c7f9fc280d22b478b70730b332d026dc');
  });

  it('maps exactly 3:84–3:91, matching Tanzil`s verified page boundaries (page 61 = 3:84, page 62 = 3:92)', () => {
    const pageStart = (index: number) => tanzilData.match(new RegExp(`<page index="${index}" sura="(\\d+)" aya="(\\d+)"`))!.slice(1).join(':');
    expect(pageStart(61)).toBe('3:84');
    expect(pageStart(62)).toBe('3:92');
    expect(page.ayahs.map((ayah) => ayah.verseKey)).toEqual(['3:84', '3:85', '3:86', '3:87', '3:88', '3:89', '3:90', '3:91']);
  });

  it('every mapped ayah exists in the app`s verified Quran database', async () => {
    const db = openTestDatabase();
    for (const ayah of page.ayahs) {
      const rows = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM verses WHERE verse_key = ?', ayah.verseKey);
      expect(rows[0].n, ayah.verseKey).toBe(1);
    }
  });

  it('the SVG`s own hit layer is the same ayahs and shapes as the mapping', () => {
    const svgPolygons = [...HAFS_KFQC_PAGE_061.svg.matchAll(/<path class="ayahPolygon"[^>]*\bayah="(\d+)" surah="(\d+)" d="([^"]+)"/g)];
    expect(svgPolygons.map((match) => `${match[2]}:${match[1]}`)).toEqual(page.ayahs.map((ayah) => ayah.verseKey));
    expect(svgPolygons.map((match) => match[3])).toEqual(page.ayahs.map((ayah) => ayah.path));
  });

  it('reads the page`s own viewBox', () => {
    expect(page.viewBox).toEqual({ x: 0, y: 0, width: 345, height: 550 });
  });
});

describe('verse selection', () => {
  it('the centre of every printed line fragment resolves to its own ayah', () => {
    for (const ayah of page.ayahs) {
      for (const rect of ayah.rects) {
        expect(ayahAtPoint(page, rect.x + rect.width / 2, rect.y + rect.height / 2)?.verseKey, JSON.stringify(rect)).toBe(ayah.verseKey);
      }
    }
  });

  it('a line shared by two ayahs splits at the ayah end, as printed', () => {
    // Line 4 (y 114.25–153.5): 3:84 ends at the right (x ≥ 198.88), 3:85 begins on the left.
    expect(ayahAtPoint(page, 300, 130)?.verseKey).toBe('3:84');
    expect(ayahAtPoint(page, 100, 130)?.verseKey).toBe('3:85');
    // First and last lines.
    expect(ayahAtPoint(page, 170, 20)?.verseKey).toBe('3:84');
    expect(ayahAtPoint(page, 170, 530)?.verseKey).toBe('3:91');
  });

  it('a tap exactly on a shared edge goes to the earlier ayah; margins select nothing', () => {
    expect(ayahAtPoint(page, 198.88, 130)?.verseKey).toBe('3:84');
    expect(ayahAtPoint(page, 342, 300)).toBeNull(); // right margin, beyond x = 338
    expect(ayahAtPoint(page, 100, 549.5)).toBeNull(); // below the last line
    expect(ayahAtPoint(page, 100, 0.5)).toBeNull(); // above the first line
    expect(ayahAtPoint(page, Number.NaN, 10)).toBeNull();
  });

  it('maps a tap on the rendered page to page coordinates at any size', () => {
    expect(toPageCoordinates(page, 690, 1100, 345, 550)).toEqual({ x: 172.5, y: 275 });
    const point = toPageCoordinates(page, 321, (321 * 550) / 345, (100 / 345) * 321, (130 / 550) * ((321 * 550) / 345));
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(130);
  });
});

describe('polygon formats (docs/FORMAT.md at v1.1.1)', () => {
  it('path data → one rectangle per line; point lists (pages 1–2) → one box', () => {
    expect(polygonToRects('M 0.0 1.0 L 338.0 1.0 L 338.0 114.25 L 0.0 114.25 Z M 198.88 114.25 L 338.0 114.25 L 338.0 153.5 L 198.88 153.5 Z')).toEqual([
      { x: 0, y: 1, width: 338, height: 113.25 },
      { x: 198.88, y: 114.25, width: 139.12, height: 39.25 },
    ]);
    expect(polygonToRects('181.08,18.31 57.54,18.31 57.54,48.94 181.08,48.94')).toEqual([
      { x: 57.54, y: 18.31, width: expect.closeTo(123.54), height: expect.closeTo(30.63) },
    ]);
    expect(polygonToPath('1,2 3,4 5,6')).toBe('M 1 2 L 3 4 L 5 6 Z');
    expect(() => polygonToRects('M 1 2 L')).toThrow(MushafPageError);
  });

  it('rejects mappings that could select the wrong ayah', () => {
    const withMapping = (mapping: unknown): MushafPageSource => ({ ...HAFS_KFQC_PAGE_061, mappingJson: JSON.stringify(mapping) });
    const box = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';
    expect(() => parseMushafPage(withMapping([{ surahNumber: 94, ayahNumber: 9, polygon: box }]))).toThrow(MushafPageError);
    expect(() => parseMushafPage(withMapping([{ surahNumber: 3, ayahNumber: 84, polygon: box }, { surahNumber: 3, ayahNumber: 84, polygon: box }]))).toThrow(MushafPageError);
    expect(() => parseMushafPage(withMapping([{ surahNumber: 3, ayahNumber: 85, polygon: box }, { surahNumber: 3, ayahNumber: 84, polygon: box }]))).toThrow(MushafPageError);
    expect(() => parseMushafPage(withMapping([]))).toThrow(MushafPageError);
  });
});

describe('page furniture', () => {
  it('medallion tint changes only the 8 ornament fills; the Quran text and ayah numbers are untouched', () => {
    const tinted = tintAyahMarkers(HAFS_KFQC_PAGE_061.svg, '#3E7D57');
    expect(tinted.match(/fill="#3E7D57"/g)).toHaveLength(8);
    expect(tinted.replace(/fill="#3E7D57"/g, 'fill="#231f20"')).toBe(HAFS_KFQC_PAGE_061.svg);
    const content = (svg: string) => svg.slice(svg.indexOf('<g id="content">'));
    expect(content(tinted)).toBe(content(HAFS_KFQC_PAGE_061.svg));
    expect(() => tintAyahMarkers(HAFS_KFQC_PAGE_061.svg, 'red')).toThrow(MushafPageError);
  });

  it('juz` boundaries match Tanzil quran-data.xml exactly', () => {
    const starts = [...tanzilData.matchAll(/<juz index="(\d+)" sura="(\d+)" aya="(\d+)"/g)].map((match) => [Number(match[2]), Number(match[3])]);
    expect(starts).toHaveLength(30);
    starts.forEach(([surah, ayah], index) => {
      expect(juzOfAyah(surah, ayah), `juz ${index + 1} start`).toBe(index + 1);
      if (index > 0) expect(juzOfAyah(surah, ayah - 1 || 1) <= index + 1).toBe(true);
    });
    expect(juzOfAyah(3, 84)).toBe(3);
    expect(juzOfAyah(3, 92)).toBe(3);
    expect(juzOfAyah(3, 93)).toBe(4);
    expect(juzOfAyah(114, 6)).toBe(30);
  });

  it('prints the reference page`s header and number: الجزء ٣, ٦١', () => {
    expect(juzTitle(3)).toBe('الجزء ٣');
    expect(juzTitle(30)).toBe('الجزء ٣٠');
    expect(() => juzTitle(31)).toThrow(MushafPageError);
    expect(toArabicIndicDigits(61)).toBe('٦١');
    expect(toArabicIndicDigits(604)).toBe('٦٠٤');
  });
});
