import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getAyahMarker, markerOverlayBox, QCF_V1_LINE_BOX_EM, QCF_V1_METRICS } from '@/mushaf/ayahMarkers';
import { AYAH_MARKER_ARTWORK } from '@/mushaf/generated/ayahMarkerArtwork';
import { AYAH_MARKER_INK } from '@/mushaf/generated/ayahMarkerInk';
import { AYAH_MARKERS_061 } from '@/mushaf/generated/ayahMarkers061';

/**
 * Ayah separators on all 604 pages. Until 2026-10-12 only page 61 drew the
 * approved medallion; every other page fell back to the QCF V1 font's plain
 * marker glyph (tinted green), because the medallion artwork existed for
 * page 61 alone. Now every page draws the same artwork through one path.
 * mushafAllPages.test.ts checks the rendered tree (every separator, four sizes)
 * where a local snapshot exists; this file needs none.
 */
const report = JSON.parse(readFileSync(new URL('../../tools/mushaf/ayah-marker-artwork.report.json', import.meta.url), 'utf8')) as {
  medallions: number; pages: number; ornamentSha256: string;
  numbers: { ayah: number; source: { page: number; verseKey: string }; occurrences: number }[];
  pageMedallions: Record<string, string[]>;
};
const counts = (JSON.parse(readFileSync(new URL('../../tools/quran-verification/surah-counts.json', import.meta.url), 'utf8')) as { counts: number[] }).counts;
const ALL_KEYS = counts.flatMap((n, s) => Array.from({ length: n }, (_, a) => `${s + 1}:${a + 1}`));

describe('ayah separators: the approved medallion on all 604 pages', () => {
  it('is page 61`s approved ornament, byte for byte, shared by all 6,236 medallions of the source', () => {
    expect(report.medallions).toBe(6236);
    expect(report.pages).toBe(604);
    expect(AYAH_MARKER_ARTWORK.ornamentPath).toBe(AYAH_MARKERS_061.ornamentPath);
    expect(createHash('sha256').update(AYAH_MARKER_ARTWORK.ornamentPath, 'utf8').digest('hex')).toBe(report.ornamentSha256);
    expect(AYAH_MARKER_ARTWORK.ornamentTransform).toBe(AYAH_MARKERS_061.markers[0].ornamentTransform);
  });

  it('has one authentic number for every ayah number 1–286, inside the ornament', () => {
    expect(AYAH_MARKER_ARTWORK.numbers.map((n) => n.ayah)).toEqual(Array.from({ length: 286 }, (_, i) => i + 1));
    const o = AYAH_MARKER_ARTWORK.ornamentBox;
    for (const n of AYAH_MARKER_ARTWORK.numbers) {
      const b = n.numberBox;
      expect(b.x > o.x && b.y > o.y && b.x + b.width < o.x + o.width && b.y + b.height < o.y + o.height, `number ${n.ayah}`).toBe(true);
      // Taken from a medallion of that very number in the source.
      expect(Number(n.source.verseKey.split(':')[1])).toBe(n.ayah);
      expect(report.pageMedallions[n.source.page]).toContain(n.source.verseKey);
    }
    expect(new Set(AYAH_MARKER_ARTWORK.numbers.map((n) => n.numberPath)).size).toBe(286);
  });

  it('cross-check of the two sources: 6,180 ayah endings on the same page; 56 one page apart, on 25 pages (two printings)', () => {
    // The QPC V1 fonts encode the 1405 AH Madani print; quran-svg's KFGQPC pages are a later printing, whose pages
    // break differently in a few places. Only the medallion's ornament and digits come from quran-svg (both the
    // same in every printing); where it goes always comes from the QPC V1 font. Any new difference fails here.
    const svgPage = new Map(Object.entries(report.pageMedallions).flatMap(([page, keys]) => keys.map((k) => [k, Number(page)] as const)));
    expect(Object.keys(AYAH_MARKER_INK)).toEqual(ALL_KEYS);
    const mismatched = ALL_KEYS.filter((k) => AYAH_MARKER_INK[k][0] !== svgPage.get(k));
    expect(mismatched).toHaveLength(56);
    expect(new Set(mismatched.map((k) => Math.abs(svgPage.get(k)! - AYAH_MARKER_INK[k][0])))).toEqual(new Set([1]));
    expect([...new Set(mismatched.map((k) => AYAH_MARKER_INK[k][0]))]).toEqual([121, 122, 123, 144, 532, 533, 534, 565, 568, 570, 576, 584, 585, 587, 588, 589, 591, 592, 593, 594, 595, 596, 597, 598, 599]);
  });

  it('every page`s every separator resolves to the same artwork through the same path — and to nothing on any other page', () => {
    const pages = new Set<number>();
    for (const key of ALL_KEYS) {
      const page = AYAH_MARKER_INK[key][0];
      const marker = getAyahMarker(page, key)!;
      expect(marker, key).not.toBeNull();
      expect(marker.ornamentPath).toBe(AYAH_MARKERS_061.ornamentPath);
      expect(marker.ornamentBox).toEqual(AYAH_MARKER_ARTWORK.ornamentBox);
      expect(marker.numberPath).toBe(AYAH_MARKER_ARTWORK.numbers[marker.ayah - 1].numberPath);
      expect(getAyahMarker(page === 604 ? 603 : page + 1, key)).toBeNull();
      pages.add(page);
    }
    expect(pages.size).toBe(604);
    for (const page of [1, 2, 50, 60, 61, 106, 187, 322, 323, 465, 466, 604]) expect(pages.has(page)).toBe(true);
  });

  it('every medallion is centred on its own ring, as tall as page 61`s relative to the ring, and inside its glyph`s line box', () => {
    const fontSize = 24;
    const em = fontSize / QCF_V1_METRICS.unitsPerEm;
    const lineBox = fontSize * QCF_V1_LINE_BOX_EM;
    const baseline = (QCF_V1_METRICS.ascent / QCF_V1_METRICS.unitsPerEm) * fontSize;
    const p61 = markerOverlayBox(getAyahMarker(61, '3:84')!, fontSize, baseline);
    const p61Ring = (QCF_V1_METRICS.markerInk.yMax - QCF_V1_METRICS.markerInk.yMin) * em;
    const outside: string[] = [];
    for (const key of ALL_KEYS) {
      const marker = getAyahMarker(AYAH_MARKER_INK[key][0], key)!;
      const box = markerOverlayBox(marker, fontSize, baseline);
      const { xMin, xMax, yMin, yMax } = marker.ink;
      expect(box.x + box.width / 2).toBeCloseTo(((xMin + xMax) / 2) * em);
      expect(box.y + box.height / 2).toBeCloseTo(baseline - ((yMin + yMax) / 2) * em);
      expect(box.height / ((yMax - yMin) * em)).toBeCloseTo(p61.height / p61Ring);
      if (box.y < 0 || box.y + box.height > lineBox) outside.push(key);
    }
    expect(outside).toEqual([]);
  });
});
