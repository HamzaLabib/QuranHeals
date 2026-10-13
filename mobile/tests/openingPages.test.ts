import { readFileSync, writeFileSync } from 'node:fs';

import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * Mushaf pages 1 and 2: the verified text inside the ornamental circle (approved 2026-10-12).
 *
 * The real QpcV1PageText lays out the verified QPC V1 lines of pages 1–2 (word advances: fixtures/qpcV1WordAdvances.json;
 * each line's real vertical ink: fixtures/openingPagesInk.json, tools/mushaf-audit/generate_opening_ink.py); the drawn
 * glyphs are placed as each platform draws them (iOS lower; Android's rows moved; the web neither). Checked against the
 * circle as OpeningPageOrnament draws it, centred in the frame, on four page widths, Normal and Full-Screen:
 * - every line's ink (its end words' ink and medallions included) and the Basmala inside the circle's opening;
 * - the title cartouche inside the opening, and the Surah name inside the cartouche;
 * - the circle (its lace and side crests), the top and bottom crests and the corner ornaments inside the frame's inner
 *   edge, the corner ornaments clear of the circle.
 */
const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({
  Platform: platform,
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

const { QpcV1PageText, OPENING_CARTOUCHE } = await import('@/components/QpcV1PageText');
const { openingCircleGeometry, OPENING_CIRCLE_RADIUS, OPENING_CIRCLE_BAND } = await import('@/components/OpeningPageOrnament');
const { surahHeaderGeometry } = await import('@/components/SurahHeaderOrnament');
const { getAyahMarker, qcfV1DrawnLineShiftEm } = await import('@/mushaf/ayahMarkers');
const { computePageLayout, MUSHAF_TEXT_LIFT_PT } = await import('@/mushaf/pageGeometry');
const { withSelectionInk } = await import('@/mushaf/qpcV1Selection');

type Advances = Record<string, [number, [string, number, string, number][]][]>;
const advances = JSON.parse(readFileSync(new URL('./fixtures/qpcV1WordAdvances.json', import.meta.url), 'utf8')) as Advances;
const ink = JSON.parse(readFileSync(new URL('./fixtures/openingPagesInk.json', import.meta.url), 'utf8')) as Record<string, Record<string, [number, number]>> & { basmala: [number, number] };
const headings = JSON.parse(readFileSync(new URL('./fixtures/surahHeadings.json', import.meta.url), 'utf8')) as { surah: number; inkEm: { left: number; right: number; ascent: number; descent: number; advance: number } }[];

const UPM = 2048;
const OPENING_SIZE = 0.0692;
const GAP_EM = 0.033;
const HEADING_SIZE = 0.78;
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));

const CONFIGS = [
  ...[251, 317, 396, 434].map((w) => ({ w, tiles: 29, mode: 'Normal' })),
  ...[[310, 29], [314, 31], [396, 35], [434, 35]].map(([w, tiles]) => ({ w, tiles, mode: 'Full-Screen' })),
];

async function audit(page: 1 | 2, os: string, w: number, tiles: number) {
  platform.OS = os;
  const layout = computePageLayout(w, tiles);
  const textW = layout.text.width;
  const textH = layout.text.height;
  const printed = computePageLayout(w).linePitch;
  const lines = advances[String(page)];
  const qpc = {
    page, edition: 'qpc-v1', fontFamily: `QCF_P00${page}`, fetchedAt: '', keepUntil: '',
    verseKeys: [...new Set(lines.flatMap(([, ws]) => ws.map((x) => x[0])))],
    lines: lines.map(([line, ws]) => ({ line, words: ws.map(([verseKey, position, kind]) => ({ verseKey, position, kind, glyph: 'x' })) })),
  };
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(QpcV1PageText, { layout: qpc as never, width: textW, height: textH, printedPitch: printed, selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h', basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional', boxMarginEm: 0.25 }));
  });
  const row = (id: string) => styleOf(root.root.find((n) => n.props.testID === id && typeof n.type === 'string'));
  const fs = textW * OPENING_SIZE;
  const em = fs / UPM;
  const pitch = Math.min(layout.linePitch, printed);
  // The circle in text-area coordinates: the frame's centre, the text area drawn MUSHAF_TEXT_LIFT_PT up.
  const circle = openingCircleGeometry(layout.frame.width, layout.frame.height);
  const cx = layout.frame.x + circle.cx - layout.text.x;
  const cy = layout.frame.y + circle.cy - (layout.text.y - MUSHAF_TEXT_LIFT_PT);
  const reach = (x: number, y: number) => Math.hypot(x - cx, y - cy);
  const drop = os === 'ios' ? qcfV1DrawnLineShiftEm(page, 'ios') * fs : 0; // Android's rows already carry it
  const problems: string[] = [];
  let least = Infinity;
  const inside = (label: string, xs: number[], ys: number[]) => {
    for (const x of xs) for (const y of ys) {
      const m = circle.inner - reach(x, y);
      least = Math.min(least, m);
      if (m < 0.01 * w) problems.push(`p${page} ${os} ${w}/${tiles}: ${label} ${m.toFixed(2)} pt from the circle's inner edge`);
    }
  };
  // Every line: its words centred (justified to the centre, WORD_GAP_EM apart), right to left, with their ink.
  for (const [line, ws] of lines) {
    const widths = ws.map((x) => (x[3] / UPM) * fs);
    const total = widths.reduce((a, b) => a + b, 0) + GAP_EM * fs * (ws.length - 1);
    let right = textW / 2 + total / 2;
    let left = Infinity;
    let rightInk = -Infinity;
    ws.forEach(([verseKey, position, kind], i) => {
      const box = { x: right - widths[i], width: widths[i], verseKey };
      const inked = withSelectionInk(box, page, { verseKey, position }, fs, kind === 'end' ? getAyahMarker(page, verseKey) : null);
      left = Math.min(left, box.x - (inked.inkLeft ?? 0));
      rightInk = Math.max(rightInk, box.x + box.width + (inked.inkRight ?? 0));
      right -= widths[i] + GAP_EM * fs;
    });
    const top = row(`qpc-line-${line}`).top as number;
    const baseline = top + pitch / 2 + (2541 - 3919 / 2) * em + drop;
    const [lo, hi] = ink[String(page)][String(line)];
    inside(`line ${line}`, [left, rightInk], [baseline - hi * em, baseline - lo * em]);
  }
  // The Basmala (page 2): page 1's four glyphs, centred.
  if (page === 2) {
    const basWidth = advances['1'].find(([l]) => l === 9)![1].slice(0, 4).reduce((s, x) => s + (x[3] / UPM) * fs, 0) + 3 * GAP_EM * fs;
    const top = row('qpc-basmala-9').top as number;
    const baseline = top + pitch / 2 + (2541 - 3919 / 2) * em + drop;
    inside('Basmala', [textW / 2 - basWidth / 2, textW / 2 + basWidth / 2], [baseline - ink.basmala[1] * em, baseline - ink.basmala[0] * em]);
  }
  // The title cartouche: its pointed tips and its top and bottom edges; the name inside it.
  const heading = root.root.find((n) => n.props.testID === 'qpc-heading-8' && typeof n.type === 'string');
  const ht = styleOf(heading).top as number;
  const svg = heading.find((n) => String(n.type) === 'Svg');
  const s = styleOf(svg);
  const cw = svg.props.width as number;
  const ch = svg.props.height as number;
  expect(cw).toBeCloseTo((textW / (1 - 2 / 20 - 2 * 25 / 593)) * OPENING_CARTOUCHE.width, 6);
  const cl = s.left as number;
  const ctop = ht + (s.top as number);
  const u = ch / 100;
  inside('cartouche tips', [cl, cl + cw], [ctop + ch / 2]);
  inside('cartouche edges', [cl + 3 * u + 40 * u, cl + cw - 3 * u - 40 * u], [ctop, ctop + ch]);
  const name = headings[page - 1].inkEm;
  const hs = fs * HEADING_SIZE;
  const box = surahHeaderGeometry(cw, ch, hs * 3.95, true).nameBox;
  const start = cw / 2 + (name.advance * hs) / 2;
  const nameBaseline = (pitch - 1.8 * hs) / 2 + ((1.8 - 1.124 - 0.634) / 2 + 1.124) * hs - (s.top as number); // in the cartouche's box
  const nameClear = Math.min(start - name.left * hs - box.left, box.right - (start + name.right * hs), nameBaseline - name.ascent * hs - box.top, box.bottom - (nameBaseline + name.descent * hs));
  if (nameClear < 1) problems.push(`p${page} ${os} ${w}: the name only ${nameClear.toFixed(2)} pt inside its cartouche`);
  await act(async () => root.unmount());
  platform.OS = 'ios';
  return { problems, least };
}

describe('pages 1–2: the verified text inside the ornamental circle', () => {
  it('the circle at the approved proportions; inside the frame, its crests and corner ornaments too', () => {
    expect(OPENING_CIRCLE_RADIUS).toBe(0.485);
    expect(OPENING_CIRCLE_BAND).toBe(0.095);
    for (const { w, tiles } of CONFIGS) {
      const frame = computePageLayout(w, tiles).frame;
      const c = openingCircleGeometry(frame.width, frame.height);
      const u = w / 396;
      const sideGap = (c.innerW - 2 * c.outer) / 2;
      expect(sideGap - 3.1 * u, `${w}/${tiles} lace to the frame`).toBeGreaterThan(0.5); // its lace dots reach 3.1 pt outside
      // Top and bottom crests: they reach 2.74 bands beyond the band's middle.
      const crest = c.outer - c.band / 2 + 2.74 * c.band;
      expect(c.innerH / 2 - crest, `${w}/${tiles} crests`).toBeGreaterThan(5);
      // Corner ornaments: quarter-fans of 0.16 W (their tendrils along the frame); clear of the circle's lace.
      const corner = Math.hypot(c.innerW / 2, c.innerH / 2) - 0.16 * w;
      expect(corner - (c.outer + 3.1 * u), `${w}/${tiles} corners`).toBeGreaterThan(5);
    }
  });

  for (const page of [1, 2] as const) {
    for (const os of ['ios', 'android', 'web']) {
      it(`page ${page}, ${os}: every line, ${page === 2 ? 'the Basmala, ' : ''}the cartouche and the name clear, on every size, Normal and Full-Screen`, async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const all: string[] = [];
        const least: Record<string, number> = {};
        for (const { w, tiles } of CONFIGS) {
          const r = await audit(page, os, w, tiles);
          all.push(...r.problems);
          least[`${w}/${tiles}`] = Number(r.least.toFixed(2));
        }
        if (process.env.OPENING_REPORT) writeFileSync(`${process.env.OPENING_REPORT}-p${page}-${os}.json`, JSON.stringify(least));
        expect(all).toEqual([]);
      });
    }
  }
});
