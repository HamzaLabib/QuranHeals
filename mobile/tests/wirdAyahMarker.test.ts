import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { createElement } from 'react';
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { syntheticQpcPage61 } from './helpers/syntheticQpcPage61';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

/**
 * The selected ورد's saved ayah, drawn with a gold medallion (QpcV1PageText `wirdAyahKey`, MUSHAF_WIRD_MARKER).
 *
 * The rule checked here: the gold changes COLOURS only, and only of that ayah's own number. Each page is drawn twice,
 * with and without it, and compared node by node: every glyph (its text, font, size, colour, box), every line, every
 * medallion's place, size, artwork and number are identical; exactly one medallion's fills differ, and they are the
 * gold. The real QCF V1 pages 1, 2, 4, 61 and 604 come from the local Content Sync snapshot (gitignored; skipped
 * without it), page 61 also synthetically (always runs).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { QpcV1PageText } = await import('@/components/QpcV1PageText');
const { MUSHAF_MARKER_STYLES, MUSHAF_WIRD_MARKER, MUSHAF_BACKGROUNDS, MUSHAF_INKS } = await import('@/mushaf/appearance');
const { computePageLayout } = await import('@/mushaf/pageGeometry');
const { isWirdAyahOnPage, wirdAyahOnPage } = await import('@/mushaf/wirdAyah');
const { MUSHAF_PAPER } = await import('@/constants/mushafTheme');

type Layout = ReturnType<typeof syntheticQpcPage61>;
type Node = ReactTestRendererJSON;
const GOLD = MUSHAF_WIRD_MARKER.warm.colors;
const TRADITIONAL = MUSHAF_MARKER_STYLES.traditional.colors;

async function draw(layout: Layout, props: Record<string, unknown> = {}): Promise<Node> {
  const { text } = computePageLayout(387, 31);
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(QpcV1PageText, {
      layout, width: text.width, height: text.height, selectedVerseKey: null, onSelectVerse: () => undefined,
      accessibilityLabel: 'p', accessibilityHint: 'h', basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional',
      wirdMarker: MUSHAF_WIRD_MARKER.warm, ...props,
    }));
  });
  // Regular pages measure their lines first, as on a device.
  const measures = renderer.root.findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('qpc-measure-'));
  if (measures.length) await act(async () => { for (const m of measures) m.props.onLayout({ nativeEvent: { layout: { width: 400 } } }); });
  return renderer.toJSON() as Node;
}

const all = (node: Node | string | null, test: (n: Node) => boolean, out: Node[] = []): Node[] => {
  if (!node || typeof node === 'string') return out;
  if (test(node)) out.push(node);
  for (const child of node.children ?? []) all(child as Node, test, out);
  return out;
};
const svgs = (tree: Node) => all(tree, (n) => n.type === 'Svg');
/** The ayah-number medallions: the SVGs on the Quran lines (headings and the opening pages' ornaments are elsewhere). */
const medallions = (tree: Node) => all(tree, (n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('qpc-line-')).flatMap(svgs);
/** A medallion's colours: every fill and gradient stop, in order. */
const fills = (svg: Node) => all(svg, (n) => 'fill' in n.props || 'stopColor' in n.props).map((n) => String(n.props.fill ?? n.props.stopColor));
/**
 * The tree without colour: each medallion reduced to its geometry (box, viewBox, the ellipses' and paths' shapes and
 * transforms; gradient definitions dropped), every other node with all its props (functions aside) and children.
 */
function withoutMarkerColours(node: Node | string | null): unknown {
  if (!node || typeof node === 'string') return node;
  if (node.type === 'Svg') {
    const { style, width, height, viewBox } = node.props;
    const shapes = all(node, (n) => ['Ellipse', 'G', 'Path'].includes(String(n.type))).map(({ type, props }) => {
      const { fill: _fill, ...geometry } = props;
      return { type, geometry };
    });
    return { type: 'Svg', style, width, height, viewBox, shapes };
  }
  const props = Object.fromEntries(Object.entries(node.props).filter(([, value]) => typeof value !== 'function'));
  return { type: node.type, props, children: (node.children ?? []).map((child) => withoutMarkerColours(child as Node)) };
}
const glyphs = (tree: Node) => all(tree, (n) => n.type === 'Text').map((n) => JSON.stringify({ props: n.props, children: n.children }));
const markerKeys = (layout: Layout) => layout.lines.flatMap((line) => line.words.filter((w) => w.kind === 'end').map((w) => w.verseKey));

/** Draws `layout` with each of its ayahs gold in turn and checks the rule above; returns how many were checked. */
async function expectColourOnly(layout: Layout, keys = markerKeys(layout)) {
  const plain = await draw(layout);
  const plainShape = JSON.stringify(withoutMarkerColours(plain));
  const plainFills = medallions(plain).map(fills);
  const plainOtherFills = svgs(plain).filter((svg) => !medallions(plain).includes(svg)).map(fills);
  for (const key of keys) {
    expect(isWirdAyahOnPage(key, layout.page), key).toBe(true);
    const gold = await draw(layout, { wirdAyahKey: key });
    // Geometry and every glyph: identical.
    expect(JSON.stringify(withoutMarkerColours(gold)), `page ${layout.page}, ${key}`).toBe(plainShape);
    expect(glyphs(gold)).toEqual(glyphs(plain));
    // Exactly one medallion recoloured, to the gold; the others as they were.
    const goldFills = medallions(gold).map(fills);
    const changed = goldFills.map((f, i) => (JSON.stringify(f) === JSON.stringify(plainFills[i]) ? -1 : i)).filter((i) => i >= 0);
    expect(changed, `page ${layout.page}, ${key}`).toHaveLength(1);
    const marked = all(gold, (n) => n.props.testID === 'qpc-wird-marker');
    expect(marked).toHaveLength(1);
    expect(medallions(gold).indexOf(marked[0])).toBe(changed[0]);
    expect(fills(marked[0])).toEqual([GOLD.capFill, GOLD.sideFill, GOLD.innerFill, GOLD.caps, GOLD.number]);
    // Headings and the opening pages' ornaments: their colours too.
    expect(svgs(gold).filter((svg) => !medallions(gold).includes(svg)).map(fills)).toEqual(plainOtherFills);
    // The ayah's own medallion: every number on the page has one, in page order, so the n-th is the n-th ayah's.
    expect(medallions(gold)).toHaveLength(markerKeys(layout).length);
    expect(changed[0]).toBe(markerKeys(layout).indexOf(key));
  }
  return keys.length;
}

describe('the selected ورد`s ayah: a gold medallion, colours only (synthetic page 61)', () => {
  it('each ayah in turn: only its own medallion turns gold; every glyph, line and medallion box is unchanged', async () => {
    expect(await expectColourOnly(syntheticQpcPage61())).toBe(8);
  });

  it('no ayah, a page-only ورد, or an ayah of another page: the page is drawn exactly as before', async () => {
    const layout = syntheticQpcPage61();
    const plain = JSON.stringify(await draw(layout, { wirdMarker: undefined }));
    for (const wirdAyahKey of [null, undefined, '2:255', '3:92', '3:84:1']) {
      expect(JSON.stringify(await draw(layout, { wirdAyahKey })), String(wirdAyahKey)).toBe(plain);
    }
    // Without the gold given (no ورد highlight configured) nothing changes either.
    expect(JSON.stringify(await draw(layout, { wirdAyahKey: '3:86', wirdMarker: undefined }))).toBe(plain);
  });

  it('never tints a word: the ayah`s own words and its neighbours keep the Quran ink', async () => {
    const layout = syntheticQpcPage61();
    const gold = await draw(layout, { wirdAyahKey: '3:86' });
    const colours = new Set(all(gold, (n) => n.type === 'Text').map((n) => [n.props.style].flat(3).reduce((c: unknown, s) => (s && typeof s === 'object' && 'color' in s ? s.color : c), undefined)));
    // Words: the ink; markers: transparent (the medallion is drawn over them); nothing gold.
    expect([...colours].sort()).toEqual([MUSHAF_INKS.original.color, 'transparent'].sort());
  });

  it('the medallion stays untouchable: taps still reach the line (Apply / X, Reflection / Save / Share unchanged)', async () => {
    const gold = await draw(syntheticQpcPage61(), { wirdAyahKey: '3:86' });
    expect(all(gold, (n) => n.props.testID === 'qpc-wird-marker')[0].props.pointerEvents).toBe('none');
  });

  it('Dark Mode: the same golds on Warm Midnight Olive, drawn the same way', async () => {
    const layout = syntheticQpcPage61();
    const gold = await draw(layout, { wirdAyahKey: '3:88', wirdMarker: MUSHAF_WIRD_MARKER.midnight, ink: MUSHAF_INKS.midnight.color });
    const plain = await draw(layout, { wirdMarker: MUSHAF_WIRD_MARKER.midnight, ink: MUSHAF_INKS.midnight.color });
    expect(JSON.stringify(withoutMarkerColours(gold))).toBe(JSON.stringify(withoutMarkerColours(plain)));
    expect(fills(all(gold, (n) => n.props.testID === 'qpc-wird-marker')[0])).toEqual([GOLD.capFill, GOLD.sideFill, GOLD.innerFill, GOLD.caps, GOLD.number]);
  });

  it('the plain-glyph style (?markers=qpc-glyph): only that ayah`s number glyph is tinted gold, nothing else changes', async () => {
    const layout = syntheticQpcPage61();
    const plain = await draw(layout, { markerStyle: 'qpc-glyph' });
    const gold = await draw(layout, { markerStyle: 'qpc-glyph', wirdAyahKey: '3:86' });
    const before = glyphs(plain);
    const after = glyphs(gold);
    const changed = after.map((g, i) => (g === before[i] ? -1 : i)).filter((i) => i >= 0);
    expect(changed).toHaveLength(1);
    expect(after[changed[0]]).toContain(MUSHAF_WIRD_MARKER.warm.glyph);
    expect(before[changed[0]]).toContain(MUSHAF_PAPER.marker);
    expect(after[changed[0]].replace(MUSHAF_WIRD_MARKER.warm.glyph, MUSHAF_PAPER.marker)).toBe(before[changed[0]]);
  });
});

describe('the gold palette', () => {
  /** WCAG 2 contrast ratio. */
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  it('is the approved gold: soft #FFF3CB, darker #D3A126, detail #DFBA5B, dark #9C741D', () => {
    expect(GOLD).toEqual({ caps: '#9C741D', sides: '#9C741D', capFill: '#D3A126', sideFill: '#DFBA5B', innerFill: '#FFF3CB', number: '#231F20' });
    expect(MUSHAF_WIRD_MARKER.midnight.colors).toEqual(GOLD);
    expect(MUSHAF_WIRD_MARKER.original.colors).toEqual(GOLD);
  });

  it('reads in Light and Dark: the number as legible as on every medallion; the gold set apart from the paper', () => {
    // The number on its centre: at least the regular medallions' own (dark on cream).
    expect(contrast(GOLD.number, GOLD.innerFill!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(TRADITIONAL.number, TRADITIONAL.innerFill!)).toBeGreaterThanOrEqual(4.5);
    // Its outline against each paper: WCAG's 3:1 for graphics.
    expect(contrast(GOLD.caps, MUSHAF_BACKGROUNDS.warm.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(GOLD.caps, MUSHAF_BACKGROUNDS.original.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(GOLD.capFill!, MUSHAF_BACKGROUNDS.midnight.paper)).toBeGreaterThanOrEqual(3);
    // The plain-glyph tints.
    expect(contrast(MUSHAF_WIRD_MARKER.warm.glyph, MUSHAF_BACKGROUNDS.warm.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(MUSHAF_WIRD_MARKER.midnight.glyph, MUSHAF_BACKGROUNDS.midnight.paper)).toBeGreaterThanOrEqual(3);
  });
});

describe('wirdAyahOnPage: only the selected ورد, only its own page', () => {
  it('shows the selected ورد`s ayah on its saved page only; none for a page-only ورد, another page, or no ورد', () => {
    expect(wirdAyahOnPage({ page: 61, ayahKey: '3:86' }, 61)).toBe('3:86');
    expect(wirdAyahOnPage({ page: 61, ayahKey: '3:86' }, 62)).toBeNull();
    expect(wirdAyahOnPage({ page: 61 }, 61)).toBeNull();
    expect(wirdAyahOnPage(null, 61)).toBeNull();
    // Damaged: an ayah that isn't on that page is never drawn.
    expect(wirdAyahOnPage({ page: 62, ayahKey: '3:86' }, 62)).toBeNull();
  });

  it('the ayah numbers of pages 1, 2, 4, 61 and 604 belong to those pages', () => {
    expect(['1:1', '1:7'].every((k) => isWirdAyahOnPage(k, 1))).toBe(true);
    expect(['2:1', '2:5'].every((k) => isWirdAyahOnPage(k, 2))).toBe(true);
    expect(['2:17', '2:24'].every((k) => isWirdAyahOnPage(k, 4))).toBe(true);
    expect(['3:84', '3:91'].every((k) => isWirdAyahOnPage(k, 61))).toBe(true);
    expect(['112:1', '114:6'].every((k) => isWirdAyahOnPage(k, 604))).toBe(true);
    expect(isWirdAyahOnPage('2:5', 3)).toBe(false);
    expect(isWirdAyahOnPage('2:6', 2)).toBe(false);
  });
});

// The real pages (Quran Foundation content: never in the repository).
const dir = fileURLToPath(new URL('../../backend/data/mushaf-sync/', import.meta.url));
const snapshot = existsSync(dir) ? readdirSync(dir).find((name) => /^records-\d+\.json\.gz$/.test(name)) : undefined;

describe.skipIf(!snapshot)('real QCF V1 pages 1, 2, 4, 61 and 604 (local Content Sync snapshot)', () => {
  type Rec = { record_type: string; mushaf_id: number; page_number: number; line_number: number; position_in_page: number; position_in_verse: number; verse_id: number; char_type_name: string; text: string };
  const records = snapshot ? (JSON.parse(gunzipSync(readFileSync(resolve(dir, snapshot))).toString('utf8')) as Rec[]) : [];
  // verse_id → verse key, in Mushaf order (Tanzil's counts, as the reader uses).
  const counts = (JSON.parse(readFileSync(new URL('../../tools/quran-verification/surah-counts.json', import.meta.url), 'utf8')) as { counts: number[] }).counts;
  const keyOf: string[] = counts.flatMap((count, s) => Array.from({ length: count }, (_, a) => `${s + 1}:${a + 1}`));
  const layoutOf = (page: number): Layout => {
    const lines: Layout['lines'] = [];
    const verseKeys: string[] = [];
    for (const w of records.filter((r) => r.record_type === 'mushaf_word' && r.mushaf_id === 2 && r.page_number === page).sort((a, b) => a.position_in_page - b.position_in_page)) {
      const verseKey = keyOf[w.verse_id - 1];
      if (verseKeys.at(-1) !== verseKey) verseKeys.push(verseKey);
      if (lines.at(-1)?.line !== w.line_number) lines.push({ line: w.line_number, words: [] });
      lines.at(-1)!.words.push({ verseKey, position: w.position_in_verse, kind: w.char_type_name === 'word' ? 'word' : w.char_type_name === 'end' ? 'end' : 'mark', glyph: w.text } as never);
    }
    return { page, edition: 'qpc-v1', fontFamily: `QCF_P${String(page).padStart(3, '0')}`, fetchedAt: '', keepUntil: '', lines, verseKeys };
  };

  for (const [page, expected] of [[1, 7], [2, 5], [4, 8], [61, 8], [604, 15]] as const) {
    it(`page ${page}: each of its ${expected} ayah numbers in turn turns gold, and nothing else on the page changes`, async () => {
      const layout = layoutOf(page);
      expect(markerKeys(layout)).toHaveLength(expected);
      expect(await expectColourOnly(layout)).toBe(expected);
    });
  }
});
