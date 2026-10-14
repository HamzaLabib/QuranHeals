import { describe, expect, it } from 'vitest';

import { MUSHAF_PAPER } from '@/constants/mushafTheme';
import {
  MUSHAF_APPEARANCE_APPROVED,
  MUSHAF_APPEARANCE_DEFAULT,
  MUSHAF_APPEARANCE_PHASE_1C,
  MUSHAF_BACKGROUND_ORIGINAL,
  MUSHAF_BACKGROUND_WARM,
  MUSHAF_BACKGROUNDS,
  MUSHAF_INKS,
  MUSHAF_MARKER_STYLES,
  resolveMushafAppearance,
} from '@/mushaf/appearance';
import { cssBaseline, getAyahMarker, markerOverlayBox, QCF_V1_LINE_BOX_EM, QCF_V1_METRICS } from '@/mushaf/ayahMarkers';
import { AYAH_MARKERS_061 } from '@/mushaf/generated/ayahMarkers061';
import { HAFS_KFQC_PAGE_061 } from '@/mushaf/generated/hafsKfqcPage061';
import { parseMushafPage } from '@/mushaf/mushafPage';
import { REFERENCE_COLORS } from '@/mushaf/pageGeometry';

/** Reversible page appearance (backgrounds, medallions, ink) and the Quran SVG medallion artwork used by QPC V1. */

const relativeLuminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('background presets', () => {
  it('Original Cream is exactly the phase-1C page background, unchanged', () => {
    // The one opaque fill the page has always had: REFERENCE_COLORS.paper.
    expect(MUSHAF_BACKGROUND_ORIGINAL).toEqual({ id: 'original', label: 'Original Cream', paper: '#F9F5DA' });
    expect(MUSHAF_BACKGROUND_ORIGINAL.paper).toBe(REFERENCE_COLORS.paper);
    expect(MUSHAF_BACKGROUND_ORIGINAL.paper).toBe(MUSHAF_PAPER.paper);
    expect(MUSHAF_BACKGROUNDS.original).toBe(MUSHAF_BACKGROUND_ORIGINAL);
  });

  it('the approved design is the default: Warm Cream, traditional medallions, original ink', () => {
    expect(MUSHAF_APPEARANCE_APPROVED).toEqual({ background: 'warm', markers: 'traditional', ink: 'original' });
    expect(MUSHAF_APPEARANCE_DEFAULT).toBe(MUSHAF_APPEARANCE_APPROVED);
    expect(resolveMushafAppearance()).toEqual({ ...MUSHAF_APPEARANCE_APPROVED, border: 'original' });
  });

  it('the phase-1C page stays restorable by name: Original Cream and the font`s marker glyphs', () => {
    expect(MUSHAF_APPEARANCE_PHASE_1C).toEqual({ background: 'original', markers: 'qpc-glyph', ink: 'original' });
    expect(resolveMushafAppearance({ background: 'original', markers: 'qpc-glyph' })).toEqual({ ...MUSHAF_APPEARANCE_PHASE_1C, border: 'original' });
  });

  it('Warm Cream is a separate option, a little darker and warmer, never yellow', () => {
    expect(MUSHAF_BACKGROUND_WARM.paper).toBe('#F9EFD2');
    expect(MUSHAF_BACKGROUND_WARM.paper).not.toBe(MUSHAF_BACKGROUND_ORIGINAL.paper);
    const [original, warm] = [MUSHAF_BACKGROUND_ORIGINAL.paper, MUSHAF_BACKGROUND_WARM.paper].map(relativeLuminance);
    expect(warm).toBeLessThan(original);
    expect(warm / original).toBeGreaterThan(0.95); // slightly, not much
    // Warmer: less blue relative to red than the original.
    const blueToRed = (hex: string) => parseInt(hex.slice(5, 7), 16) / parseInt(hex.slice(1, 3), 16);
    expect(blueToRed(MUSHAF_BACKGROUND_WARM.paper)).toBeLessThan(blueToRed(MUSHAF_BACKGROUND_ORIGINAL.paper));
    expect(blueToRed(MUSHAF_BACKGROUND_WARM.paper)).toBeGreaterThan(0.8);
  });

  it('a preview can name a preset in the route; anything unknown falls back to the default', () => {
    expect(resolveMushafAppearance({ background: 'original', markers: 'quran-svg' })).toEqual({ background: 'original', markers: 'quran-svg', ink: 'original', border: 'original' });
    expect(resolveMushafAppearance({ background: ['original', 'warm'], markers: 'qpc-glyph' })).toMatchObject({ background: 'original', markers: 'qpc-glyph' });
    expect(resolveMushafAppearance({ background: 'neon', markers: 'toString', ink: '#000', border: 'x' })).toEqual({ ...MUSHAF_APPEARANCE_DEFAULT, border: 'original' });
  });
});

describe('medallion styles and ink', () => {
  it('keeps the phase-1C marker glyph and ink as presets of their own', () => {
    expect(MUSHAF_MARKER_STYLES['qpc-glyph'].colors).toBeNull();
    expect(MUSHAF_PAPER.marker).toBe('#3E7D57');
    expect(MUSHAF_INKS.original.color).toBe('#231F20');
    expect(MUSHAF_INKS.original.color).toBe(MUSHAF_PAPER.ink);
  });

  it('the Quran SVG style matches that page: green ornament (as tintAyahMarkers), its black number', () => {
    expect(MUSHAF_MARKER_STYLES['quran-svg'].colors).toMatchObject({ caps: '#3E7D57', sides: '#3E7D57', number: '#231F20', capFill: null, sideFill: null, innerFill: null });
  });

  it('the traditional style darkens the caps against lighter green sides, with a light centre and a dark number', () => {
    const colors = MUSHAF_MARKER_STYLES.traditional.colors;
    expect(relativeLuminance(colors.caps)).toBeLessThan(relativeLuminance(colors.sides));
    expect(relativeLuminance(colors.capFill)).toBeLessThan(relativeLuminance(colors.sideFill));
    expect(relativeLuminance(colors.innerFill)).toBeGreaterThan(0.85);
    expect(relativeLuminance(colors.number)).toBeLessThan(0.03);
  });
});

describe('medallion artwork (from the bundled Quran SVG page)', () => {
  const page = parseMushafPage(HAFS_KFQC_PAGE_061);

  it('is copied verbatim from the hash-pinned page SVG', () => {
    expect(AYAH_MARKERS_061.svgSha256).toBe(HAFS_KFQC_PAGE_061.source.svgSha256);
    expect(HAFS_KFQC_PAGE_061.svg).toContain(`<path d="${AYAH_MARKERS_061.ornamentPath}"`);
    for (const marker of AYAH_MARKERS_061.markers) expect(HAFS_KFQC_PAGE_061.svg).toContain(`<path d="${marker.numberPath}"`);
    expect(HAFS_KFQC_PAGE_061.svg.split(`<path d="${AYAH_MARKERS_061.ornamentPath}"`)).toHaveLength(9); // one ornament per ayah
  });

  it('has exactly one medallion per ayah, in reading order, each inside its own ayah on the page', () => {
    expect(AYAH_MARKERS_061.markers.map((marker) => marker.verseKey)).toEqual(page.ayahs.map((ayah) => ayah.verseKey));
    for (const marker of AYAH_MARKERS_061.markers) {
      const ayah = page.ayahs.find((candidate) => candidate.verseKey === marker.verseKey)!;
      const box = marker.ornamentBox;
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      expect(ayah.rects.some((r) => centre.x >= r.x && centre.x <= r.x + r.width && centre.y >= r.y && centre.y <= r.y + r.height)).toBe(true);
      // Its number sits inside its ornament.
      const n = marker.numberBox;
      expect(n.x).toBeGreaterThan(box.x);
      expect(n.y).toBeGreaterThan(box.y);
      expect(n.x + n.width).toBeLessThan(box.x + box.width);
      expect(n.y + n.height).toBeLessThan(box.y + box.height);
    }
  });

  it('every number is a different drawing (84 … 91); every page now draws this same ornament', () => {
    expect(new Set(AYAH_MARKERS_061.markers.map((marker) => marker.numberPath)).size).toBe(8);
    expect(getAyahMarker(61, '3:84')?.ornamentPath).toBe(AYAH_MARKERS_061.ornamentPath);
    // An ayah whose marker is on another page has none here.
    expect(getAyahMarker(61, '3:92')).toBeNull();
    // Every other page has the same medallion (it was null off page 61 until 2026-10-12: the plain font glyph).
    expect(getAyahMarker(62, '3:93')?.ornamentPath).toBe(AYAH_MARKERS_061.ornamentPath);
  });

  it('page 61 through the all-pages artwork: its own frame, and each number within a hair of its own tracing', () => {
    for (const reference of AYAH_MARKERS_061.markers) {
      const marker = getAyahMarker(61, reference.verseKey)!;
      expect(marker.ornamentTransform).toBe(AYAH_MARKERS_061.markers[0].ornamentTransform);
      expect(marker.ornamentBox).toEqual(AYAH_MARKERS_061.markers[0].ornamentBox);
      // Placed relative to the shared frame: compare against the reference number's offset in its own ornament.
      const dx = reference.ornamentBox.x - AYAH_MARKERS_061.markers[0].ornamentBox.x;
      const dy = reference.ornamentBox.y - AYAH_MARKERS_061.markers[0].ornamentBox.y;
      const scale = marker.ornamentBox.width;
      expect(Math.abs(marker.numberBox.x + marker.numberBox.width / 2 - (reference.numberBox.x - dx + reference.numberBox.width / 2)) / scale).toBeLessThan(0.02);
      expect(Math.abs(marker.numberBox.y + marker.numberBox.height / 2 - (reference.numberBox.y - dy + reference.numberBox.height / 2)) / scale).toBeLessThan(0.02);
      expect(Math.abs(marker.numberBox.width - reference.numberBox.width) / scale).toBeLessThan(0.05);
      expect(Math.abs(marker.numberBox.height - reference.numberBox.height) / scale).toBeLessThan(0.02);
    }
  });
});

describe('medallion placement over the QCF V1 marker glyph', () => {
  // The phone layout measured in the browser: 20.598 px glyphs, a 25.67 px marker advance. Each glyph's
  // box is the font's whole line (QCF_V1_LINE_BOX_EM; it was 1.3 em until it was found to clip marks).
  const fontSize = 20.598;
  const lineHeight = fontSize * QCF_V1_LINE_BOX_EM;
  const marker = getAyahMarker(61, '3:84')!;

  it('the web baseline follows CSS: the font`s ascent below the box top (Chrome measured 19 px in the former 1.3-em box, the same place on the line)', () => {
    expect(cssBaseline(fontSize, lineHeight)).toBeCloseTo((QCF_V1_METRICS.ascent / QCF_V1_METRICS.unitsPerEm) * fontSize);
    // The same height above the line's centre as in the former 1.3-em box, where Chrome measured 19 px (snapped from 19.25).
    expect(cssBaseline(fontSize, lineHeight) - lineHeight / 2).toBeCloseTo(19.25 - (fontSize * 1.3) / 2, 1);
  });

  it('centres the medallion on the glyph`s own ink, inside its advance and its line, in the artwork`s proportions', () => {
    const baseline = cssBaseline(fontSize, lineHeight);
    const box = markerOverlayBox(marker, fontSize, baseline);
    const { unitsPerEm, markerInk } = QCF_V1_METRICS;
    expect(marker.ink).toEqual({ xMin: markerInk.xMin, xMax: markerInk.xMax, yMin: markerInk.yMin, yMax: markerInk.yMax });
    const inkCentre = baseline - ((markerInk.yMax + markerInk.yMin) / 2) * (fontSize / unitsPerEm);
    expect(box.y + box.height / 2).toBeCloseTo(inkCentre);
    expect(box.x + box.width / 2).toBeCloseTo(((markerInk.xMin + markerInk.xMax) / 2) * (fontSize / unitsPerEm));
    expect(Math.abs(box.x + box.width / 2 - 25.67 / 2)).toBeLessThan(0.05); // the ring is centred in its advance
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThan(25.67); // never wider than the glyph: no overlap with neighbouring words
    // Inside its line: the glyph box is centred in the 15-line pitch (31.77 px here).
    const pitch = 31.77;
    const lineTop = (pitch - lineHeight) / 2;
    expect(lineTop + box.y).toBeGreaterThan(0);
    expect(lineTop + box.y + box.height).toBeLessThan(pitch);
    expect(box.width / box.height).toBeCloseTo(marker.ornamentBox.width / marker.ornamentBox.height);
    // ≈ 0.82 of the pitch tall, as the printed medallions (≈ 42 px at a 52 px pitch).
    expect(box.height / pitch).toBeCloseTo(0.82, 1);
  });
});

describe('Dark Mode (Warm Midnight Olive)', () => {
  it('has the approved palette, and keeps the border, medallions and light furniture exactly', async () => {
    const { MUSHAF_APPEARANCE_DARK, MUSHAF_BACKGROUND_MIDNIGHT_OLIVE, MUSHAF_BORDER_STYLES, MUSHAF_PAGE_FURNITURE } = await import('@/mushaf/appearance');
    const { BORDER_INKS } = await import('@/mushaf/borderPattern');
    expect(MUSHAF_BACKGROUND_MIDNIGHT_OLIVE.paper).toBe('#222820');
    expect(MUSHAF_INKS.midnight.color).toBe('#F1E9D6');
    expect(MUSHAF_APPEARANCE_DARK).toEqual({ background: 'midnight', markers: 'traditional', ink: 'midnight', border: 'midnight' });
    // The approved border's inks, untouched: the Light page's own object.
    expect(MUSHAF_BORDER_STYLES.original.inks).toBe(BORDER_INKS);
    // Medallion numbers stay dark on cream.
    expect(MUSHAF_MARKER_STYLES.traditional.colors).toMatchObject({ number: '#231F20', innerFill: '#FBF7E4' });
    // The light papers keep phase 1C's heads and highlight exactly.
    for (const id of ['original', 'warm'] as const) {
      expect(MUSHAF_PAGE_FURNITURE[id]).toEqual({ header: MUSHAF_PAPER.header, highlight: MUSHAF_PAPER.highlight, highlightOpacity: MUSHAF_PAPER.highlightOpacity });
    }
    // Dark Mode's border: gold rules and sage leaves, every ink exactly as defined.
    expect(MUSHAF_BORDER_STYLES.midnight.inks).toEqual({ rule: '#A99A70', cream: '#2B3228', mint: '#3E4B3B', green: '#8EA68A', brown: '#A99A70', ochre: '#6E6548' });
  });

  it('dark pages take the midnight border inks: no bright cream or mint ground on the dark paper; Light keeps the approved inks', async () => {
    const { MUSHAF_BACKGROUND_MIDNIGHT_OLIVE, MUSHAF_BORDER_STYLES } = await import('@/mushaf/appearance');
    const { BORDER_INKS } = await import('@/mushaf/borderPattern');
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const paper = MUSHAF_BACKGROUND_MIDNIGHT_OLIVE.paper;
    const dark = MUSHAF_BORDER_STYLES[resolveMushafAppearance({}, 'dark').border!].inks;
    expect(dark).toBe(MUSHAF_BORDER_STYLES.midnight.inks);
    // The large grounds sit close to the paper (the original's cream and mint were ~13:1 against it) ...
    expect(contrast(BORDER_INKS.cream, paper)).toBeGreaterThan(12);
    for (const ink of ['cream', 'mint', 'ochre'] as const) expect(contrast(dark[ink], paper)).toBeLessThan(3);
    // ... while the gold rules and sage leaves stay readable on it.
    for (const ink of ['rule', 'green', 'brown'] as const) expect(contrast(dark[ink], paper)).toBeGreaterThan(4);
    // Every page resolves the same border (one preset, no per-page case); Light is unchanged.
    for (const page of ['1', '2', '61', '604']) {
      expect(resolveMushafAppearance({ page }, 'dark').border).toBe('midnight');
      expect(resolveMushafAppearance({ page }, 'light').border).toBe('original');
    }
    expect(MUSHAF_BORDER_STYLES[resolveMushafAppearance({}, 'light').border!].inks).toBe(BORDER_INKS);
    // A preview can still show the original border on the dark page.
    expect(resolveMushafAppearance({ border: 'original' }, 'dark').border).toBe('original');
  });

  it('follows the app theme; Light stays the default; a preview can force either', async () => {
    const { MUSHAF_APPEARANCE_DARK } = await import('@/mushaf/appearance');
    expect(resolveMushafAppearance({}, 'light')).toEqual({ ...MUSHAF_APPEARANCE_APPROVED, border: 'original' });
    expect(resolveMushafAppearance({}, 'dark')).toEqual(MUSHAF_APPEARANCE_DARK);
    expect(resolveMushafAppearance({ scheme: 'dark' }, 'light')).toEqual(MUSHAF_APPEARANCE_DARK);
    expect(resolveMushafAppearance({ scheme: 'light' }, 'dark').background).toBe('warm');
    expect(resolveMushafAppearance({ border: 'midnight' }, 'dark').border).toBe('midnight');
  });

  it('the Quran SVG page`s ink is recoloured by fill value only — every path is unchanged', async () => {
    const { tintAyahMarkers, tintSvgInk } = await import('@/mushaf/mushafPage');
    const tinted = tintSvgInk(tintAyahMarkers(HAFS_KFQC_PAGE_061.svg, '#3E7D57'), '#F1E9D6');
    expect(tinted).not.toContain('fill="#231f20"');
    expect(tinted.match(/fill="#3E7D57"/g)).toHaveLength(8);
    const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(paths(tinted)).toEqual(paths(HAFS_KFQC_PAGE_061.svg));
  });
});
