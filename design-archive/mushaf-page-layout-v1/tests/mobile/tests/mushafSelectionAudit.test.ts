import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * Ayah selection on the Traditional Mushaf (2026-10-12): the highlight and the taps follow the words as drawn.
 *
 * The real QpcV1PageText is rendered and given the word positions the platform lays out (each word's advance from its
 * page font, at the page's letter size; lines justified right to left, pages 1–2 centred), through its own onLayout
 * handlers. For every ayah on the page it is then selected, and the highlights it draws are checked against the words:
 * - a highlight on exactly the lines holding the ayah's words, covering all of them and the gaps between them;
 * - covering its end words' ink (or medallion) unless that ink reaches into a neighbouring ayah's word box;
 * - never overlapping a word of another ayah; within the text area's margins;
 * - the band centred on the line as drawn (iOS draws QPC V1 glyphs lower than laid out: qcfV1DrawnLineShiftEm; Android's
 *   Quran rows move to the iPhone's place: qcfV1AndroidRowShiftEm), inside
 *   the frame, the bands of neighbouring lines apart;
 * - and a tap on each word (its centre, and near the top and bottom of the band) selects that word's ayah.
 * Pages: a committed fixture (1, 2, 5, 50, 61, 237, 466) always; all 604 when QPC_V1_ADVANCES names the full export
 * of tools/mushaf-audit/export_word_advances.py.
 */
const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({
  Platform: platform,
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

const { QpcV1PageText } = await import('@/components/QpcV1PageText');
const { computePageLayout, MUSHAF_TEXT_LIFT_PT, PAGE_GEOMETRY, textSideInset } = await import('@/mushaf/pageGeometry');
const { getAyahMarker, markerOverlayBox, qcfV1DrawnLineShiftEm, QCF_V1_NORMAL_BOX_MARGIN_EM } = await import('@/mushaf/ayahMarkers');
const { QPC_V1_SELECTION_INK } = await import('@/mushaf/generated/qpcV1SelectionInk');

type Advances = Record<string, [number, [string, number, string, number][]][]>;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/qpcV1WordAdvances.json', import.meta.url), 'utf8')) as Advances;
const fullPath = process.env.QPC_V1_ADVANCES;
const full = fullPath && existsSync(fullPath) ? (JSON.parse(readFileSync(fullPath, 'utf8')) as Advances) : null;

const UPM = 2048;
const FIT = 0.985; // QpcV1PageText
const OPENING_SIZE = 0.0692;
const WORD_GAP_EM = 0.033;
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));
const E = 1e-6;

type Mode = { name: string; tiles: number; margin: number };
const NORMAL: Mode = { name: 'Normal', tiles: 29, margin: QCF_V1_NORMAL_BOX_MARGIN_EM };
const FULL: Mode = { name: 'Full-Screen', tiles: 34, margin: 0 };

type Tally = { ayahs: number; lines: number; taps: number; inkLimited: string[]; failures: string[] };

async function auditPage(page: number, lines: Advances[string], pageWidth: number, mode: Mode, os: string, tally: Tally) {
  platform.OS = os;
  const geometry = computePageLayout(pageWidth, mode.tiles);
  const width = geometry.text.width;
  const height = geometry.text.height;
  const layout = {
    page, edition: 'qpc-v1', fontFamily: `QCF_P${String(page).padStart(3, '0')}`, fetchedAt: '', keepUntil: '',
    verseKeys: [...new Set(lines.flatMap(([, words]) => words.map((w) => w[0])))],
    lines: lines.map(([line, words]) => ({ line, words: words.map(([verseKey, position, kind]) => ({ verseKey, position, kind, glyph: 'x' })) })),
  };
  let selected: string | null = null;
  const element = (selectedVerseKey: string | null) => createElement(QpcV1PageText, {
    layout: layout as never, width, height, selectedVerseKey, onSelectVerse: (key: string) => { selected = key; }, accessibilityLabel: 'p', accessibilityHint: 'h',
    basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional', boxMarginEm: mode.margin, printedPitch: computePageLayout(pageWidth).linePitch,
  });
  let root!: ReturnType<typeof create>;
  await act(async () => { root = create(element(null)); });
  // The measuring pass: each line's natural width at 100 pt.
  const opening = page <= 2;
  const sums = new Map(lines.map(([line, words]) => [line, words.reduce((s, w) => s + w[3], 0)]));
  if (!opening) {
    await act(async () => {
      for (const node of root.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('qpc-measure-'))) {
        node.props.onLayout({ nativeEvent: { layout: { width: (sums.get(Number(node.props.testID.split('-').pop()))! / UPM) * 100 } } });
      }
    });
  }
  const fontSize = opening ? width * OPENING_SIZE : (width * FIT) / (Math.max(...sums.values()) / UPM);
  // Word boxes as the platform lays them out (row-reverse: reading order from the right).
  const boxes = new Map<number, { x: number; width: number; verseKey: string; kind: string; position: number }[]>();
  for (const [line, words] of lines) {
    const widths = words.map((w) => (w[3] / UPM) * fontSize);
    const total = widths.reduce((a, b) => a + b, 0);
    const gap = opening ? WORD_GAP_EM * fontSize : words.length > 1 ? (width - total) / (words.length - 1) : 0;
    let right = opening ? (width + total + gap * (words.length - 1)) / 2 : width;
    boxes.set(line, words.map((w, i) => { const box = { x: right - widths[i], width: widths[i], verseKey: w[0], kind: w[2], position: w[1] }; right -= widths[i] + gap; return box; }));
  }
  const rowOf = (line: number) => root.root.find((n) => n.props.testID === `qpc-line-${line}` && typeof n.type === 'string');
  await act(async () => {
    for (const [line, list] of boxes) {
      const words = (rowOf(line).children as ReactTestInstance[]).filter((c) => typeof c !== 'string' && typeof c.props.onLayout === 'function');
      words.forEach((word, i) => word.props.onLayout({ nativeEvent: { layout: { x: list[i].x, y: 0, width: list[i].width, height: 10 } } }));
    }
  });
  const rows = new Map([...boxes.keys()].map((line) => { const s = styleOf(rowOf(line)); return [line, { top: s.top as number, height: s.height as number }]; }));
  const shift = qcfV1DrawnLineShiftEm(page, os) * fontSize;
  const side = textSideInset(width);
  const insetY = pageWidth * PAGE_GEOMETRY.textInsetY;
  const label = `p${page} ${mode.name} ${os} w${pageWidth}`;
  const fail = (msg: string) => { if (tally.failures.length < 40) tally.failures.push(`${label}: ${msg}`); else tally.failures.length += 0; };
  const inkOf = (b: { kind: string; verseKey: string; position: number; width: number }) => {
    if (b.kind === 'end') { const m = markerOverlayBox(getAyahMarker(page, b.verseKey)!, fontSize, 0); return [Math.max(0, -m.x), Math.max(0, m.x + m.width - b.width)]; }
    const ink = QPC_V1_SELECTION_INK[page]?.[`${b.verseKey}:${b.position}`];
    return ink ? [(ink[0] / 100) * fontSize, (ink[1] / 100) * fontSize] : [0, 0];
  };

  for (const verseKey of layout.verseKeys) {
    tally.ayahs += 1;
    await act(async () => root.update(element(verseKey)));
    let lastBottom = Number.NEGATIVE_INFINITY;
    for (const [line, list] of boxes) {
      const own = list.filter((b) => b.verseKey === verseKey);
      const hl = root.root.findAll((n) => n.props.testID === `qpc-highlight-${line}` && typeof n.type === 'string');
      if (own.length === 0) { if (hl.length) fail(`${verseKey} highlights line ${line} without its words`); continue; }
      tally.lines += 1;
      if (hl.length !== 1) { fail(`${verseKey} line ${line}: ${hl.length} highlights`); continue; }
      const s = styleOf(hl[0]);
      const left = s.left as number; const right = left + (s.width as number);
      const sorted = [...list].sort((a, b) => a.x - b.x);
      const lo = sorted.findIndex((b) => b.verseKey === verseKey);
      let hi = lo; sorted.forEach((b, i) => { if (b.verseKey === verseKey) hi = i; });
      for (const b of own) if (b.x < left - E || b.x + b.width > right + E) fail(`${verseKey} line ${line}: a word outside its highlight`);
      for (const b of list) if (b.verseKey !== verseKey && b.x < right - E && b.x + b.width > left + E) fail(`${verseKey} line ${line}: covers ${b.verseKey}`);
      if (left < -side - E || right > width + side + E) fail(`${verseKey} line ${line}: beyond the text margin`);
      const inkL = sorted[lo].x - inkOf(sorted[lo])[0];
      const inkR = sorted[hi].x + sorted[hi].width + inkOf(sorted[hi])[1];
      const limitL = lo > 0 ? sorted[lo - 1].x + sorted[lo - 1].width : -side;
      const limitR = hi < sorted.length - 1 ? sorted[hi + 1].x : width + side;
      if (inkL < left - E) { if (Math.abs(left - limitL) > E) fail(`${verseKey} line ${line}: ink left of the highlight`); else tally.inkLimited.push(`${label} ${verseKey} line ${line} left`); }
      if (inkR > right + E) { if (Math.abs(right - limitR) > E) fail(`${verseKey} line ${line}: ink right of the highlight`); else tally.inkLimited.push(`${label} ${verseKey} line ${line} right`); }
      // Vertically: centred on the drawn line; inside the frame (the text area is MUSHAF_TEXT_LIFT_PT up); apart from the line above's band.
      const row = rows.get(line)!;
      const top = row.top + (s.top as number);
      const bottom = top + (s.height as number);
      if (Math.abs((top + bottom) / 2 - (row.top + row.height / 2 + shift)) > E) fail(`${verseKey} line ${line}: band not on the drawn line`);
      if (top < -(insetY - MUSHAF_TEXT_LIFT_PT) - E || bottom > height + insetY + MUSHAF_TEXT_LIFT_PT + E) fail(`${verseKey} line ${line}: band crosses the frame`);
      if (top < lastBottom - E) fail(`${verseKey} line ${line}: band overlaps the line above's`);
      lastBottom = bottom;
      // Taps on each word: at the drawn line's centre and near the band's top and bottom.
      for (const b of own) {
        for (const dy of [0, -0.4, 0.4]) {
          const y = (top + bottom) / 2 + dy * (s.height as number);
          const touched = [...rows.entries()].find(([, r]) => y >= r.top && y < r.top + r.height);
          if (!touched) { if (dy === 0) fail(`${verseKey} line ${line}: tap at the word's centre lands on no line`); continue; }
          selected = null;
          await act(async () => rowOf(touched[0]).props.onPress({ nativeEvent: { locationX: b.x + b.width / 2, locationY: y - touched[1].top } }));
          tally.taps += 1;
          if (selected !== verseKey) fail(`${verseKey} line ${line}: tap (${dy}) selected ${selected}`);
        }
      }
    }
  }
  await act(async () => root.unmount());
}

async function audit(pages: Advances, widths: number[]) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const tally: Tally = { ayahs: 0, lines: 0, taps: 0, inkLimited: [], failures: [] };
  for (const [page, lines] of Object.entries(pages)) {
    for (const width of widths) for (const mode of [NORMAL, FULL]) for (const os of ['ios', 'android', 'web']) await auditPage(Number(page), lines, width, mode, os, tally);
  }
  platform.OS = 'ios';
  return tally;
}

describe('ayah selection follows the drawn words (fixture pages 1, 2, 5, 50, 61, 237, 466)', () => {
  it('every ayah, every line, both modes, iOS, Android and the web, three page widths', async () => {
    const tally = await audit(fixture, [317, 396, 434]);
    expect(tally.failures).toEqual([]);
    expect(tally.inkLimited).toEqual([]);
    expect(tally.ayahs).toBeGreaterThan(0);
    if (process.env.QPC_V1_SELECTION_REPORT) writeFileSync(`${process.env.QPC_V1_SELECTION_REPORT}-fixture.json`, JSON.stringify(tally, null, 1));
  }, 600_000);

  it('page 5: 2:25 on lines 1–4 (ends with its medallion), 2:29 from the last word of line 13 to line 15', () => {
    const lines = fixture['5'];
    const linesOf = (key: string) => lines.filter(([, words]) => words.some((w) => w[0] === key)).map(([line]) => line);
    expect(linesOf('2:25')).toEqual([1, 2, 3, 4]);
    expect(linesOf('2:29')).toEqual([13, 14, 15]);
    const line13 = lines.find(([line]) => line === 13)![1];
    expect(line13.at(-1)![0]).toBe('2:29'); // هُوَ, after 2:28's medallion
    expect(line13.at(-2)).toEqual(expect.arrayContaining(['2:28', 'end']));
  });
});

describe.skipIf(!full)('ayah selection on all 604 pages (QPC_V1_ADVANCES)', () => {
  it('every ayah, every line, both modes, iOS, Android and the web (396-pt page)', async () => {
    const tally = await audit(full!, [396]);
    if (process.env.QPC_V1_SELECTION_REPORT) writeFileSync(`${process.env.QPC_V1_SELECTION_REPORT}-604.json`, JSON.stringify(tally, null, 1));
    expect(tally.failures).toEqual([]);
  }, 7_200_000);
});
