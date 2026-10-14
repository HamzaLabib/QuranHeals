/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { cssBaseline, QCF_V1_LINE_BOX_EM, QCF_V1_METRICS } from '@/mushaf/ayahMarkers';
import { computePageLayout } from '@/mushaf/pageGeometry';

/**
 * Regression protection for clipped harakat and hamzas (2026-10-12).
 *
 * iOS and Android draw a Text only inside its own bounds. Each QPC V1 glyph
 * was in a Text 1.3 em tall, shorter than the font's line (1.91 em), so ink
 * above or below it — fatha, damma, shadda, sukun, hamza, madd, the small
 * Quranic letters, kasra, descenders — was cut off on devices (the web lets
 * text overflow, which hid it). These tests read the real outlines of the
 * bundled page-61 font: every glyph must lie inside the box the renderer
 * gives it, and the fix must move nothing.
 */

const font = readFileSync(resolve(__dirname, '../assets/mushaf/qpc-v1/p61.ttf'));

function tables(buffer: Buffer): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < buffer.readUInt16BE(4); i += 1) {
    const record = 12 + i * 16;
    out[buffer.toString('ascii', record, record + 4)] = buffer.readUInt32BE(record + 8);
  }
  return out;
}
const t = tables(font);
const unitsPerEm = font.readUInt16BE(t.head + 18);
const ascent = font.readInt16BE(t.hhea + 4);
const descent = -font.readInt16BE(t.hhea + 6);
const longLoca = font.readInt16BE(t.head + 50) === 1;
const glyphCount = font.readUInt16BE(t.maxp + 4);
/** Every glyph's outline bounds (yMin, yMax) from the glyf table; empty glyphs (spaces) skipped. */
const glyphs = Array.from({ length: glyphCount }, (_, index) => {
  const at = (n: number) => (longLoca ? font.readUInt32BE(t.loca + n * 4) : font.readUInt16BE(t.loca + n * 2) * 2);
  const start = at(index);
  if (at(index + 1) === start) return null;
  const header = t.glyf + start;
  return { index, yMin: font.readInt16BE(header + 4), yMax: font.readInt16BE(header + 8) };
}).filter((g): g is { index: number; yMin: number; yMax: number } => g !== null);

/** A glyph's Text box of `boxEm`, centred on the font's line (half-leading, as CSS and the native platforms place it). */
function box(boxEm: number) {
  const height = boxEm * unitsPerEm;
  const baselineFromTop = (height - (ascent + descent)) / 2 + ascent;
  return { above: baselineFromTop, below: height - baselineFromTop };
}
const outside = (b: { above: number; below: number }) => glyphs.filter((g) => g.yMax > b.above || -g.yMin > b.below);

describe('every QPC V1 glyph fits inside its Text box', () => {
  it('reads the bundled font: 2048 units per em, the line metrics the renderer assumes, 539 outlines', () => {
    expect(unitsPerEm).toBe(QCF_V1_METRICS.unitsPerEm);
    expect([ascent, descent]).toEqual([QCF_V1_METRICS.ascent, QCF_V1_METRICS.descent]);
    expect(glyphs).toHaveLength(539);
  });

  it('the box is the font`s whole line, so no outline crosses it: above (harakat, hamza, madd, small letters) or below (kasra, descenders)', () => {
    expect(QCF_V1_LINE_BOX_EM * unitsPerEm).toBeCloseTo(ascent + descent);
    expect(outside(box(QCF_V1_LINE_BOX_EM))).toEqual([]);
    const highest = Math.max(...glyphs.map((g) => g.yMax));
    const lowest = Math.min(...glyphs.map((g) => g.yMin));
    expect(highest).toBeLessThanOrEqual(ascent);
    expect(-lowest).toBeLessThanOrEqual(descent);
  });

  it('documents the defect: the former 1.3 em box left page 61`s marks outside it, above and below', () => {
    const old = box(1.3);
    expect(glyphs.filter((g) => g.yMax > old.above)).toHaveLength(12);
    expect(glyphs.filter((g) => -g.yMin > old.below)).toHaveLength(36);
  });

  it('nothing moves: the baseline keeps its place relative to the line centre, at any font size', () => {
    for (const fontSize of [14.57, 20.6, 22.02, 23.1, 35.34]) {
      const offset = (lineHeight: number) => cssBaseline(fontSize, lineHeight) - lineHeight / 2;
      expect(offset(fontSize * QCF_V1_LINE_BOX_EM)).toBeCloseTo(offset(fontSize * 1.3), 9);
    }
  });
});

describe('the first and last lines stay inside the frame (Traditional and Mobile-Optimized)', () => {
  // Audited over all 604 page fonts: the tallest ink (2540 units, page 322) and the deepest (−1377, page 466),
  // and the largest font size ÷ line pitch outside the opening pages 1–2 (0.678, page 3).
  const INK = { yMax: 2540, yMin: -1377 };
  const SIZE_PER_PITCH = 0.679;
  for (const [name, width, tiles] of [['iPhone 393, Traditional', 387, 29], ['iPhone 393, Mobile full screen', 387, 33], ['Android 412, Traditional', 406, 29], ['Android 412, Mobile', 406, 37], ['narrow 320', 256, 29], ['Mobile cap', 406, 40]] as const) {
    it(name, () => {
      const layout = computePageLayout(width, tiles);
      const pitch = layout.linePitch;
      // The width sets the glyph size, so a taller (Mobile) frame keeps the Traditional size: only the pitch grows.
      const fontSize = computePageLayout(width).linePitch * SIZE_PER_PITCH;
      const em = fontSize / unitsPerEm;
      const baselineBelowCentre = ((ascent - descent) / 2) * em;
      const firstTop = pitch / 2 + baselineBelowCentre - INK.yMax * em;
      const lastBottom = layout.text.height - pitch / 2 + baselineBelowCentre - INK.yMin * em;
      const insetY = layout.text.y - layout.inner.y; // the text area's margin inside the inner rule
      expect(firstTop).toBeGreaterThan(-insetY);
      expect(lastBottom).toBeLessThan(layout.text.height + insetY);
    });
  }
});

describe('Normal Mode glyph containers: vertical room past the font`s line (bottom-of-line clipping on iPhone)', () => {
  // Measured over all 604 page fonts and 8,820 lines (tools/mushaf-audit/audit_vertical_boxes.py, 2026-10-12): ink comes
  // within 1 font unit of the font's line at the bottom (page 466 line 7: −1377 of −1378) and the top (page 322 line 15:
  // 2540 of 2541); with only the line box, 7 lines on a 393-pt iPhone (14 on an iPhone SE) had under 1.5 device pixels.
  const deepest = -1377;
  const highest = 2540;
  // Pages 1 and 565 set USE_TYPO_METRICS (OS/2 1564 + 403, gap 205): a platform honouring it could set their glyphs
  // up to 306.5 units lower (TextKit bottom-aligns the OS/2 line; the gap counted once more as a bound).
  const typoShift = 306.5;
  // Pixel snapping and antialiasing: 1.5 device pixels at the smallest Normal-Mode text (iPhone SE: ≈ 16 pt at 2×).
  const snapUnits = (1.5 / (16 * 2)) * QCF_V1_METRICS.unitsPerEm;

  it('leaves room for the deepest and highest ink under the worst baseline placement, plus pixel snapping', async () => {
    const { QCF_V1_NORMAL_BOX_MARGIN_EM, QCF_V1_NORMAL_LINE_BOX_EM } = await import('@/mushaf/ayahMarkers');
    const margin = QCF_V1_NORMAL_BOX_MARGIN_EM * QCF_V1_METRICS.unitsPerEm;
    expect(QCF_V1_NORMAL_LINE_BOX_EM).toBeCloseTo(QCF_V1_LINE_BOX_EM + 2 * QCF_V1_NORMAL_BOX_MARGIN_EM);
    // Bottom: the font's descent + margin must hold the deepest ink set lower by typoShift, with snapping room.
    expect(QCF_V1_METRICS.descent + margin + deepest - typoShift).toBeGreaterThan(snapUnits);
    // Top: likewise for the highest ink (a lower baseline only gives the top more room; the hhea placement is the worst).
    expect(QCF_V1_METRICS.ascent + margin - highest).toBeGreaterThan(snapUnits);
    // Without the margin (the font's line alone) the bottom has under a pixel: the clipping this guards against.
    expect(QCF_V1_METRICS.descent + deepest).toBeLessThan(snapUnits);
  });
});
