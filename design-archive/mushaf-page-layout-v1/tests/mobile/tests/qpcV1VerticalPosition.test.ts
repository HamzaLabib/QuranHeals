import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * Vertical position of the Quran text (2026-10-12). The only vertical offset is MUSHAF_TEXT_LIFT_PT, a temporary,
 * uniform lift of the whole text area (MushafPageView; mushafScreen.test.ts). Inside it, QpcV1PageText lays the rows on
 * the printed grid with no correction of its own: the device-measured baseline correction is removed (it had no effect
 * on the iPhone, so it is not stacked with the lift). Everything that belongs to a line is inside that line's row, so
 * it moves with the text: glyphs, medallions, highlight, tap target.
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

const { QpcV1PageText } = await import('@/components/QpcV1PageText');
const { MUSHAF_TEXT_LIFT_PT } = await import('@/mushaf/pageGeometry');
const { QCF_V1_INK_ROOM_V_EM, QCF_V1_NORMAL_BOX_MARGIN_EM } = await import('@/mushaf/ayahMarkers');
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));
const rowNodes = (root: ReturnType<typeof create>) =>
  root.root.findAll((node) => typeof node.props.testID === 'string' && /^qpc-(line|basmala|heading)-\d+$/.test(node.props.testID) && typeof node.type === 'string');

type Layout = Parameters<typeof QpcV1PageText>[0]['layout'];
const page61 = {
  page: 61, edition: 'qpc-v1', fontFamily: 'QCF_P061', fetchedAt: '', keepUntil: '', verseKeys: ['3:84'],
  lines: [{ line: 1, words: [
    { verseKey: '3:84', position: 1, kind: 'word', glyph: 'ﭑ' },
    { verseKey: '3:84', position: 2, kind: 'word', glyph: 'ﭒ' },
    { verseKey: '3:84', position: 3, kind: 'end', glyph: 'ﭓ' },
  ] }],
} as unknown as Layout;
const HEIGHT = 509;

async function render(layout: Layout, boxMarginEm: number) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(QpcV1PageText, { layout, width: 315, height: HEIGHT, selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h', basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional', boxMarginEm }));
  });
  const measures = root.root.findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('qpc-measure-'));
  if (measures.length) await act(async () => { for (const m of measures) m.props.onLayout({ nativeEvent: { layout: { width: 400 } } }); });
  return root;
}

describe('rows on the printed grid, no correction of their own (Normal and Full-Screen)', () => {
  for (const [mode, margin] of [['Normal', QCF_V1_NORMAL_BOX_MARGIN_EM], ['Full-Screen', 0]] as const) {
    it(`${mode}: every Quran line and Basmala row at its grid position, the heading row moved by surahHeadingShift; no baseline probe`, async () => {
      const { surahHeadingShift } = await import('@/mushaf/ayahMarkers');
      const root = await render(page61, margin);
      const pitch = HEIGHT / 15;
      const rows = rowNodes(root);
      const fontSize = styleOf(root.root.find((n) => n.props.testID === 'qpc-line-1' && typeof n.type === 'string').findAll((n) => String(n.type) === 'Text')[0]).fontSize as number;
      expect(rows.map((row) => row.props.testID)).toEqual(expect.arrayContaining(['qpc-line-1', 'qpc-heading-2', 'qpc-basmala-3']));
      for (const row of rows) {
        const line = Number(String(row.props.testID).split('-').pop());
        const shift = String(row.props.testID).startsWith('qpc-heading-') ? surahHeadingShift(61, 'ios', fontSize, pitch) : 0;
        expect(styleOf(row).top, row.props.testID).toBeCloseTo((line - 1) * pitch + shift, 9);
        expect(styleOf(row).height, row.props.testID).toBeCloseTo(pitch, 9);
      }
      expect(root.root.findAll((node) => String(node.props.testID ?? '').includes('probe'))).toHaveLength(0);
      await act(async () => root.unmount());
    });
  }

  it('the medallion and the tap target belong to their line`s row, so they move with its text', async () => {
    const root = await render(page61, QCF_V1_NORMAL_BOX_MARGIN_EM);
    const line = root.root.find((node) => node.props.testID === 'qpc-line-1' && typeof node.type === 'string');
    expect(String(line.type)).toBe('Pressable');
    expect(typeof line.props.onPress).toBe('function'); // taps are line-relative
    const medallions = root.root.findAll((node) => node.props.box !== undefined && node.props.marker !== undefined);
    expect(medallions.length).toBeGreaterThan(0);
    for (const medallion of medallions) {
      let parent = medallion.parent;
      while (parent && parent !== line) parent = parent.parent;
      expect(parent).toBe(line);
    }
    await act(async () => root.unmount());
  });

  it('pages 1–2 keep their own centred composition (no correction)', async () => {
    const page1 = { ...page61, page: 1, fontFamily: 'QCF_P001', verseKeys: ['1:1'], lines: [{ line: 2, words: [{ verseKey: '1:1', position: 1, kind: 'word', glyph: 'ﭑ' }] }] } as unknown as Layout;
    const root = await render(page1, QCF_V1_NORMAL_BOX_MARGIN_EM);
    const { surahHeadingShift } = await import('@/mushaf/ayahMarkers');
    const fontSize = 315 * 0.0692;
    // Each row's grid position (a heading row is drawn surahHeadingShift lower than its grid position).
    const rows = rowNodes(root).map((row) => {
      const s = styleOf(row) as { top: number; height: number };
      return String(row.props.testID).startsWith('qpc-heading-') ? { ...s, top: s.top - surahHeadingShift(1, 'ios', fontSize, s.height) } : s;
    });
    const blockTop = Math.min(...rows.map((row) => row.top));
    const blockBottom = Math.max(...rows.map((row) => row.top + row.height));
    // The rows' block centred on the frame (its ornamental circle) as drawn: the text area's lift taken back, less the
    // platform's drawn drop (iOS here).
    const { MUSHAF_TEXT_LIFT_PT } = await import('@/mushaf/pageGeometry');
    const { qcfV1DrawnLineShiftEm } = await import('@/mushaf/ayahMarkers');
    expect((blockTop + blockBottom) / 2).toBeCloseTo(HEIGHT / 2 + MUSHAF_TEXT_LIFT_PT - qcfV1DrawnLineShiftEm(1, 'ios') * fontSize, 6);
    await act(async () => root.unmount());
  });
});

/**
 * All 604 pages (tools/mushaf-audit/audit_vertical_position.py; real outlines of every letter and mark, every
 * medallion, Surah heading and Basmala; report committed beside it). Pinned so that any change to the lift, the
 * layout or the font data shows here. Pages the lift does not clear are reported to the user, not adjusted.
 */
const audit = JSON.parse(readFileSync(new URL('../../tools/mushaf-audit/vertical-position.report.json', import.meta.url), 'utf8'));
const at = (placement: 'intended' | 'iphone', width: number, tiles = 29) =>
  (tiles === 29 ? audit.normal[placement] : audit.fullScreen[placement]).find((r: { widthPt: number; tiles?: number }) => r.widthPt === width && (tiles === 29 || r.tiles === tiles));

describe('604-page audit with the lift', () => {
  it('was run with the app`s lift and constants, over every word glyph and the Basmala', () => {
    expect(audit.liftPt).toBe(MUSHAF_TEXT_LIFT_PT);
    expect(audit.glyphsChecked).toBe(77429 + 4);
    expect(audit.pages387NoLift).toHaveLength(604);
    expect(audit.clipping.normal.paintableRoomUnits).toBe((QCF_V1_INK_ROOM_V_EM + QCF_V1_NORMAL_BOX_MARGIN_EM) * 2048);
    expect(audit.clipping.fullScreen.paintableRoomUnits).toBe(QCF_V1_INK_ROOM_V_EM * 2048);
  });

  it('clipping: no letter or mark leaves its paintable box, at the intended and the iPhone placement, in both modes', () => {
    for (const mode of [audit.clipping.normal, audit.clipping.fullScreen]) {
      for (const placement of [mode.intended, mode.iphone]) expect(placement.clipped).toBe(false);
    }
  });

  it('intended placement (web; Android model): clear of the frame from a 354-pt page up; the smallest pages touch at the top', () => {
    for (const width of [354, 387, 396, 434, 681]) {
      expect(at('intended', width).pagesTouchingTop, `${width}`).toEqual([]);
      expect(at('intended', width).pagesTouchingBottom, `${width}`).toEqual([]);
    }
    expect(at('intended', 317).pagesTouchingTop).toEqual([44, 49, 236, 307]); // iPhone SE page
    expect(at('intended', 268).pagesTouchingTop).toHaveLength(37); // small Android page
  });

  it('iPhone placement: clear at the top everywhere; at the bottom, 7 pages still reach the frame on a 396-pt page', () => {
    for (const row of audit.normal.iphone) expect(row.pagesTouchingTop).toEqual([]);
    expect(at('iphone', 396).pagesTouchingBottom).toEqual([142, 202, 381, 459, 553, 556, 560]);
    expect(at('iphone', 396).minBottomPt).toBeCloseTo(-1.22, 2); // page 560
    expect(at('iphone', 317).pagesTouchingBottom).toEqual([560]);
  });

  it('the pages to check on the iPhone 16 Pro (396 pt): gaps above / below with the lift', () => {
    expect(audit.keyPages396['5'].iphone).toEqual([14.19, 0.05]);
    expect(audit.keyPages396['13'].iphone).toEqual([13.69, 2.18]);
    expect(audit.keyPages396['61'].iphone).toEqual([12.76, 4.06]);
    expect(audit.keyPages396['466'].iphone).toEqual([13.94, 2.26]);
  });
});
