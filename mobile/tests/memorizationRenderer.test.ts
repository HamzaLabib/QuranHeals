import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * Memorization Mode in the real QPC V1 renderer (QpcV1PageText's isAyahHidden / onPeekVerse). On iOS and Android, on
 * the committed fixture pages (1, 2, 5, 50, 61, 237, 466: the openings, page 61, mixed-line and multi-line ayahs) and
 * — where MUSHAF_SYNC_DIR names a local Content Sync snapshot — all 604 pages (page 604 included):
 * - hidden: every ayah word and pause mark is not painted; every ayah number (medallion) is drawn exactly as before;
 * - nothing moves: every line, word box, glyph Text (bar its paint), heading and Basmala is identical to the normal page;
 * - one ayah revealed: exactly its glyphs painted, on every line it spans, no neighbour's;
 * - a tap on a hidden ayah's place still reaches that ayah; a long press peeks and its release ends the peek;
 * - without Memorization Mode the page is exactly as before (no long press, nothing hidden).
 */
const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({
  Platform: platform,
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The renderer as loaded on `os` (it reads Platform.OS once, when its module loads). */
const renderers = new Map<string, unknown>();
async function rendererFor(os: string) {
  if (!renderers.has(os)) {
    platform.OS = os;
    vi.resetModules();
    renderers.set(os, (await import('@/components/QpcV1PageText')).QpcV1PageText);
  }
  platform.OS = os;
  return renderers.get(os) as typeof import('@/components/QpcV1PageText').QpcV1PageText;
}
const { computePageLayout, MIN_TILES_DOWN } = await import('@/mushaf/pageGeometry');
const { QCF_V1_NORMAL_BOX_MARGIN_EM } = await import('@/mushaf/ayahMarkers');

type Kind = 'word' | 'end' | 'mark';
type Layout = { page: number; edition: 'qpc-v1'; fontFamily: string; fetchedAt: string; keepUntil: string; verseKeys: string[]; lines: { line: number; words: { verseKey: string; position: number; kind: Kind; glyph: string }[] }[] };
type Advances = Record<string, [number, [string, number, Kind, number][]][]>;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/qpcV1WordAdvances.json', import.meta.url), 'utf8')) as Advances;
const UPM = 2048;

const PAGE_WIDTH = 387;
const geometry = computePageLayout(PAGE_WIDTH, MIN_TILES_DOWN);
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, unknown>;
/** A subtree's drawn form: element types and props, functions dropped. */
const plain = (node: ReactTestInstance | string): unknown => (typeof node === 'string' ? node : {
  type: typeof node.type === 'string' ? node.type : (node.type as { name?: string }).name,
  props: Object.fromEntries(Object.entries(node.props).filter(([key, value]) => key !== 'children' && typeof value !== 'function')),
  children: (node.children as (ReactTestInstance | string)[]).map(plain),
});
const drawn = (node: ReactTestInstance | ReactTestRenderer) => JSON.stringify('toJSON' in node ? node.toJSON() : plain(node));

type Props = { isAyahHidden?: (verseKey: string) => boolean; onPeekVerse?: (verseKey: string | null) => void; onSelectVerse?: (verseKey: string) => void; onPressMarker?: (verseKey: string) => void };

/** The page as a device lays it out: the measuring pass, then each word's advance box (right to left), via onLayout. */
async function renderPage(layout: Layout, advance: (line: number, index: number) => number, os: string, props: Props) {
  const QpcV1PageText = await rendererFor(os);
  const { width, height } = geometry.text;
  const element = (p: Props) => createElement(QpcV1PageText, {
    layout: layout as never, width, height, selectedVerseKey: null, onSelectVerse: p.onSelectVerse ?? (() => undefined), onPressMarker: p.onPressMarker,
    accessibilityLabel: 'p', accessibilityHint: 'h', basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional', boxMarginEm: QCF_V1_NORMAL_BOX_MARGIN_EM,
    printedPitch: computePageLayout(PAGE_WIDTH).linePitch, isAyahHidden: p.isAyahHidden, onPeekVerse: p.onPeekVerse,
  });
  let root!: ReactTestRenderer;
  await act(async () => { root = create(element(props)); });
  const sums = new Map(layout.lines.map((line) => [line.line, line.words.reduce((sum, _w, i) => sum + advance(line.line, i), 0)]));
  if (layout.page > 2) {
    await act(async () => {
      for (const node of root.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('qpc-measure-'))) {
        node.props.onLayout({ nativeEvent: { layout: { width: (sums.get(Number(node.props.testID.split('-').pop()))! / UPM) * 100 } } });
      }
    });
  }
  const rowOf = (line: number) => root.root.find((n) => n.props.testID === `qpc-line-${line}` && typeof n.type === 'string');
  const wordViews = (line: number) => (rowOf(line).children as ReactTestInstance[]).filter((c) => typeof c !== 'string' && typeof c.props.onLayout === 'function');
  const fontSize = (() => {
    const first = wordViews(layout.lines[0].line)[0];
    return first.children.length ? styleOf(first.children[0] as ReactTestInstance).fontSize as number : 0;
  })();
  const boxes = new Map<number, { x: number; width: number }[]>();
  for (const line of layout.lines) {
    const widths = line.words.map((_w, i) => (advance(line.line, i) / UPM) * fontSize);
    const total = widths.reduce((a, b) => a + b, 0);
    const gap = line.words.length > 1 ? (width - total) / (line.words.length - 1) : 0;
    let right = layout.page <= 2 ? (width + total) / 2 : width;
    boxes.set(line.line, widths.map((w) => { const box = { x: right - w, width: w }; right -= w + (layout.page <= 2 ? 0 : gap); return box; }));
  }
  await act(async () => {
    for (const line of layout.lines) wordViews(line.line).forEach((view, i) => view.props.onLayout({ nativeEvent: { layout: { x: boxes.get(line.line)![i].x, y: 0, width: boxes.get(line.line)![i].width, height: 10 } } }));
  });
  return { root, rowOf, wordViews, boxes, update: (p: Props) => act(async () => root.update(element(p))) };
}

/** Whether a word's glyph is painted: iOS its own Text's colour; Android its unclipped copy (the in-flow Text never paints there). */
function painted(view: ReactTestInstance, os: string) {
  const [inFlow, ...rest] = view.children as ReactTestInstance[];
  if (os === 'android') return rest.some((child) => child.type === ('Text' as never) && child.props.accessible === false);
  return styleOf(inFlow).color !== 'transparent';
}
/** The in-flow glyph's layout: its style without its paint (colour, opacity). */
const glyphLayout = (view: ReactTestInstance) => {
  const { color: _color, opacity: _opacity, ...rest } = styleOf(view.children[0] as ReactTestInstance);
  return JSON.stringify(rest);
};
const decorations = (root: ReactTestRenderer) => root.root
  .findAll((n) => typeof n.type === 'string' && typeof n.props.testID === 'string' && /^qpc-(basmala|heading)-\d+$/.test(n.props.testID))
  .map((n) => drawn(n));

async function auditPage(layout: Layout, advance: (line: number, index: number) => number, os: string, problems: string[]) {
  const label = `p${layout.page} ${os}`;
  const fail = (message: string) => { if (problems.length < 60) problems.push(`${label}: ${message}`); };
  const normal = await renderPage(layout, advance, os, {});
  const hidden = await renderPage(layout, advance, os, { isAyahHidden: () => true, onPeekVerse: () => undefined });
  for (const line of layout.lines) {
    if (JSON.stringify(styleOf(normal.rowOf(line.line))) !== JSON.stringify(styleOf(hidden.rowOf(line.line)))) fail(`line ${line.line} moved`);
    const before = normal.wordViews(line.line);
    const after = hidden.wordViews(line.line);
    if (before.length !== after.length) { fail(`line ${line.line}: ${before.length} → ${after.length} words`); continue; }
    line.words.forEach((word, i) => {
      if (JSON.stringify(styleOf(before[i])) !== JSON.stringify(styleOf(after[i]))) fail(`${word.verseKey} word ${i} box changed`);
      if (glyphLayout(before[i]) !== glyphLayout(after[i])) fail(`${word.verseKey} word ${i} glyph layout changed`);
      if (word.kind === 'end') {
        if (drawn(before[i]) !== drawn(after[i])) fail(`${word.verseKey} number not drawn as before`);
      } else {
        if (!painted(before[i], os)) fail(`${word.verseKey} ${word.kind} ${i} not painted normally`);
        if (painted(after[i], os)) fail(`${word.verseKey} ${word.kind} ${i} still painted when hidden`);
      }
    });
  }
  if (JSON.stringify(decorations(normal.root)) !== JSON.stringify(decorations(hidden.root))) fail('headings or Basmala changed');
  await act(async () => { normal.root.unmount(); hidden.root.unmount(); });
}

const fixtureLayout = (page: number): { layout: Layout; advance: (line: number, index: number) => number } => {
  const lines = fixture[String(page)];
  const byLine = new Map(lines.map(([line, words]) => [line, words]));
  return {
    layout: {
      page, edition: 'qpc-v1', fontFamily: `QCF_P${String(page).padStart(3, '0')}`, fetchedAt: '', keepUntil: '',
      verseKeys: [...new Set(lines.flatMap(([, words]) => words.map((w) => w[0])))],
      lines: lines.map(([line, words]) => ({ line, words: words.map(([verseKey, position, kind]) => ({ verseKey, position, kind, glyph: 'x' })) })),
    },
    advance: (line, index) => byLine.get(line)![index][3],
  };
};
const FIXTURE_PAGES = Object.keys(fixture).map(Number).sort((a, b) => a - b);

describe('Memorization Mode in the QPC V1 renderer (fixture pages)', () => {
  it('the fixture holds the pages this checks: the openings, page 61, mixed-line and multi-line ayahs', () => {
    expect(FIXTURE_PAGES).toEqual([1, 2, 5, 50, 61, 237, 466]);
    const all = FIXTURE_PAGES.flatMap((page) => fixtureLayout(page).layout.lines);
    // A line holding three ayahs, and an ayah over six lines. (No separate pause-mark glyphs on these pages: QPC V1
    // draws them in the words. Any 'mark' glyph is hidden with its ayah all the same; the all-pages run counts them.)
    expect(all.some((line) => new Set(line.words.map((w) => w.verseKey)).size > 2)).toBe(true);
    const linesOf = new Map<string, Set<number>>();
    for (const page of FIXTURE_PAGES) for (const line of fixtureLayout(page).layout.lines) for (const w of line.words) linesOf.set(`${page}|${w.verseKey}`, (linesOf.get(`${page}|${w.verseKey}`) ?? new Set()).add(line.line));
    expect(Math.max(...[...linesOf.values()].map((s) => s.size))).toBeGreaterThan(5);
  });

  it.each(['ios', 'android'])('%s: hidden, every word and pause mark unpainted, every number, line, box, heading and Basmala exactly as before', async (os) => {
    const problems: string[] = [];
    for (const page of FIXTURE_PAGES) {
      const { layout, advance } = fixtureLayout(page);
      await auditPage(layout, advance, os, problems);
    }
    expect(problems).toEqual([]);
  });

  it.each(['ios', 'android'])('%s: one ayah revealed shows exactly its words, on every line it spans; no neighbour', async (os) => {
    const problems: string[] = [];
    for (const page of FIXTURE_PAGES) {
      const { layout, advance } = fixtureLayout(page);
      const view = await renderPage(layout, advance, os, { isAyahHidden: () => true });
      for (const target of layout.verseKeys) {
        await view.update({ isAyahHidden: (key) => key !== target });
        for (const line of layout.lines) {
          const views = view.wordViews(line.line);
          line.words.forEach((word, i) => {
            if (word.kind === 'end') return;
            if (painted(views[i], os) !== (word.verseKey === target)) problems.push(`p${page} ${os} reveal ${target}: ${word.verseKey} word ${i} on line ${line.line}`);
          });
        }
      }
      await act(async () => view.root.unmount());
    }
    expect(problems).toEqual([]);
  });

  it('a tap on a hidden word or number reaches its own ayah; a long press peeks it and the release ends the peek', async () => {
    const { layout, advance } = fixtureLayout(50);
    const selected: string[] = [];
    const markers: string[] = [];
    const peeks: (string | null)[] = [];
    const view = await renderPage(layout, advance, 'ios', { isAyahHidden: () => true, onSelectVerse: (k) => selected.push(k), onPressMarker: (k) => markers.push(k), onPeekVerse: (k) => peeks.push(k) });
    const expected: string[] = [];
    const expectedMarkers: string[] = [];
    for (const line of layout.lines) {
      const row = view.rowOf(line.line);
      const middle = (styleOf(row).height as number) / 2;
      line.words.forEach((word, i) => {
        const box = view.boxes.get(line.line)![i];
        const event = { nativeEvent: { locationX: box.x + box.width / 2, locationY: middle } };
        row.props.onPress(event);
        (word.kind === 'end' ? expectedMarkers : expected).push(word.verseKey);
        row.props.onLongPress(event);
        row.props.onPressOut();
      });
    }
    expect(selected).toEqual(expected);
    expect(markers).toEqual(expectedMarkers);
    expect(peeks).toEqual(layout.lines.flatMap((line) => line.words.flatMap((w) => [w.verseKey, null])));
    await act(async () => view.root.unmount());
  });

  it('without Memorization Mode: exactly the normal page (no long press, nothing hidden); "nothing hidden" draws the same', async () => {
    for (const os of ['ios', 'android']) {
      const { layout, advance } = fixtureLayout(61);
      const normal = await renderPage(layout, advance, os, {});
      const shown = await renderPage(layout, advance, os, { isAyahHidden: () => false });
      expect(drawn(shown.root)).toBe(drawn(normal.root));
      for (const line of layout.lines) {
        expect(normal.rowOf(line.line).props.onLongPress).toBeUndefined();
        expect(normal.rowOf(line.line).props.onPressOut).toBeUndefined();
      }
      await act(async () => { normal.root.unmount(); shown.root.unmount(); });
    }
  });
});

/**
 * All 604 pages: MUSHAF_SYNC_DIR names a Content Sync snapshot folder (backend/data/mushaf-sync, gitignored Quran
 * Foundation content; read only). Word advances are not in it: every glyph is given one advance (the checks compare
 * the page with and without Memorization Mode, so any equal advances do).
 */
const syncDir = process.env.MUSHAF_SYNC_DIR;
const snapshot = syncDir && existsSync(syncDir) ? readdirSync(syncDir).find((name) => /^records-\d+\.json\.gz$/.test(name)) : undefined;

describe.skipIf(!snapshot)('Memorization Mode on all 604 pages (local Content Sync snapshot)', () => {
  it.each(['ios', 'android'])('%s: every page hides every word and pause mark and keeps every number, line, box, heading and Basmala', async (os) => {
    const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
    const verses = db.prepare('SELECT verse_key AS k FROM verses ORDER BY surah, ayah').all() as { k: string }[];
    type Rec = { record_type: string; mushaf_id: number; page_number: number; line_number: number; position_in_page: number; position_in_verse: number; verse_id: number; char_type_name: string; text: string };
    const records = JSON.parse(gunzipSync(readFileSync(resolve(syncDir!, snapshot!))).toString('utf8')) as Rec[];
    const byPage = new Map<number, Rec[]>();
    for (const r of records) if (r.record_type === 'mushaf_word' && r.mushaf_id === 2) byPage.set(r.page_number, [...(byPage.get(r.page_number) ?? []), r]);
    const problems: string[] = [];
    for (let page = 1; page <= 604; page++) {
      const lines: Layout['lines'] = [];
      const verseKeys: string[] = [];
      for (const w of [...(byPage.get(page) ?? [])].sort((a, b) => a.position_in_page - b.position_in_page)) {
        const verseKey = verses[w.verse_id - 1].k;
        if (verseKeys.at(-1) !== verseKey) verseKeys.push(verseKey);
        if (lines.at(-1)?.line !== w.line_number) lines.push({ line: w.line_number, words: [] });
        lines.at(-1)!.words.push({ verseKey, position: w.position_in_verse, kind: w.char_type_name === 'word' ? 'word' : w.char_type_name === 'end' ? 'end' : 'mark', glyph: w.text });
      }
      await auditPage({ page, edition: 'qpc-v1', fontFamily: '', fetchedAt: '', keepUntil: '', lines, verseKeys }, () => 600, os, problems);
    }
    expect(problems).toEqual([]);
  }, 600_000);
});
