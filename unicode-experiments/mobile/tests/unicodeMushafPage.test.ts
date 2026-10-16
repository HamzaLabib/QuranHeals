import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));

const { UnicodeMushafPageText } = await import('@/components/UnicodeMushafPageText');
const { UNICODE_MUSHAF_FONTS, TAJWEED_RULES } = await import('@/mushaf/unicode/data');
const { layoutPage } = await import('@/mushaf/unicode/layout');
const { TAJWEED_PALETTES, tajweedSpans } = await import('@/mushaf/unicode/tajweed');
const { fromDisplay } = await import('@/mushaf/unicode/encoding');
const { computePageLayout } = await import('@/mushaf/pageGeometry');
const { MUSHAF_WIRD_MARKER } = await import('@/mushaf/appearance');

/**
 * Unicode Mushaf prototype — rendering (separate from the text checks in unicodeMushafIntegrity.test.ts): the critical
 * pages in the reader's real text areas (several phones, Normal Mode and full screen), as react-native would lay them
 * out. Physical devices are not covered here (docs/unicode-mushaf/feasibility-report.md).
 */
const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
const verses = db.prepare('SELECT arabic_text AS t FROM verses ORDER BY surah, ayah').all() as { t: string }[];
db.close();
const text = (i: number) => verses[i].t;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CRITICAL_PAGES = [1, 2, 3, 5, 187, 319, 560, 595, 604];
// [page width, frame tiles]: iPhone 393 Normal (31) and full screen (33), a tall Android (35), iPhone SE (31/34), a small
// Android (31), 320-pt (31), Pro Max (32), and a tablet (31).
const FRAMES = [[387, 31], [387, 33], [406, 35], [324, 31], [324, 34], [274, 31], [261, 31], [434, 32], [621, 31]] as const;
const font = (id: 'hafs' | 'amiri') => {
  const m = UNICODE_MUSHAF_FONTS[id].fontMetrics;
  return { fontFamily: id, ascentEm: m.ascent / m.unitsPerEm, descentEm: m.descent / m.unitsPerEm, displayEncoding: UNICODE_MUSHAF_FONTS[id].displayEncoding, fallback: id === 'hafs' ? { fontFamily: 'amiri', ascentEm: 1.815, descentEm: 0.634 } : null };
};
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
const textOf = (node: ReactTestInstance): string => node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

function render(props: Record<string, unknown>) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(UnicodeMushafPageText, props as never));
  });
  return renderer;
}

describe('the critical pages in every frame (Normal Mode and full screen, phones and a tablet)', () => {
  it('every row inside the text area; every word inside its line; numbers in medallions; the words drawn are the verified words', () => {
    const problems: string[] = [];
    for (const [pageWidth, tiles] of FRAMES) {
      const { text: area } = computePageLayout(pageWidth, tiles);
      const printedPitch = computePageLayout(pageWidth).linePitch;
      for (const page of CRITICAL_PAGES) {
        const laid = layoutPage(UNICODE_MUSHAF_FONTS.hafs, page, area.width, text);
        const r = render({ laid, width: area.width, height: area.height, printedPitch, font: font('hafs'), selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h' });
        const rows = r.root.findAll((n) => typeof n.props.testID === 'string' && /^unicode-(line|heading|basmala)-\d+$/.test(n.props.testID) && String(n.type) !== 'Text');
        const expectedRows = laid.rows.length;
        if (rows.length !== expectedRows) problems.push(`${pageWidth}/${tiles} p${page}: ${rows.length} of ${expectedRows} rows`);
        for (const row of rows) {
          const s = styleOf(row);
          if (s.top < -0.01 || s.top + s.height > area.height + 0.01) problems.push(`${pageWidth}/${tiles} p${page} ${row.props.testID}: row outside the text area`);
        }
        for (const row of rows.filter((n) => n.props.testID.startsWith('unicode-line-'))) {
          const words = row.findAll((n) => String(n.type) === 'Text' && styleOf(n).position === 'absolute');
          for (const w of words) {
            const s = styleOf(w);
            // The advance (box less its ink room) lies inside the line.
            const room = s.fontSize * 0.6;
            if (s.left + room < -0.01 || s.left + s.width - room > area.width + 0.01) problems.push(`${pageWidth}/${tiles} p${page} ${row.props.testID}: word outside the line`);
          }
          const drawn = words.map((w) => fromDisplay(textOf(w), 'kfgqpc').replace(/ـ/g, ''));
          const expected = laid.rows.find((x) => `unicode-line-${x.line}` === row.props.testID);
          if (expected?.kind === 'text') {
            const want = expected.items.filter((i) => i.kind === 'word').map((i) => (i.kind === 'word' ? i.text.replace(/ـ/g, '') : ''));
            if (drawn.join(' ') !== want.join(' ')) problems.push(`${pageWidth}/${tiles} p${page} ${row.props.testID}: drawn words differ`);
          }
        }
        const medallions = r.root.findAll((n) => String(n.type) === 'View' && /^unicode-(marker-|guide-marker|wird-marker)/.test(String(n.props.testID ?? '')) && n.findAllByType('Svg' as never).length === 1);
        const markers = laid.rows.flatMap((x) => (x.kind === 'text' ? x.items.filter((i) => i.kind === 'marker') : []));
        if (medallions.length !== markers.length) problems.push(`${pageWidth}/${tiles} p${page}: ${medallions.length} medallions, ${markers.length} numbers`);
        act(() => r.unmount());
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('interactions and colours', () => {
  const { text: area } = computePageLayout(387, 31);
  const laid = layoutPage(UNICODE_MUSHAF_FONTS.hafs, 3, area.width, text);

  it('a tap on a word selects its ayah; a tap on a medallion is the ayah`s number (Apply to ورد)', () => {
    const onSelectVerse = vi.fn();
    const onPressMarker = vi.fn();
    const r = render({ laid, width: area.width, height: area.height, font: font('hafs'), selectedVerseKey: null, onSelectVerse, onPressMarker, accessibilityLabel: 'p', accessibilityHint: 'h' });
    const row = laid.rows.find((x) => x.kind === 'text' && x.items.some((i) => i.kind === 'marker'))!;
    if (row.kind !== 'text') throw new Error('no line');
    const marker = row.items.find((i) => i.kind === 'marker')!;
    const word = row.items.find((i) => i.kind === 'word' && i.verseKey === marker.verseKey)!;
    const line = r.root.findByProps({ testID: `unicode-line-${row.line}` });
    act(() => line.props.onPress({ nativeEvent: { locationX: word.x + word.width / 2, locationY: 10, pageX: 100, pageY: 200 } }));
    expect(onSelectVerse).toHaveBeenCalledWith(word.verseKey, { x: 100, y: 200 });
    act(() => line.props.onPress({ nativeEvent: { locationX: marker.x + marker.width / 2, locationY: 10 } }));
    expect(onPressMarker).toHaveBeenCalledWith(marker.verseKey, undefined);
  });

  it('the selected ayah is highlighted on each of its lines; the ورد`s ayah alone has the gold medallion', () => {
    const r = render({ laid, width: area.width, height: area.height, font: font('hafs'), selectedVerseKey: '2:8', onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h', wirdAyahKey: '2:6', wirdMarker: MUSHAF_WIRD_MARKER.warm });
    const lines = laid.rows.filter((x) => x.kind === 'text' && x.items.some((i) => i.verseKey === '2:8')).map((x) => x.line);
    for (const l of lines) expect(r.root.findAllByProps({ testID: `unicode-highlight-${l}` }).length).toBeGreaterThan(0);
    expect(r.root.findAll((n) => n.props.testID === 'unicode-wird-marker' && String(n.type) === 'View')).toHaveLength(1);
  });

  it('Tajweed ON draws the same characters at the same places (only colours change); OFF draws plain ink', () => {
    const base = { laid, width: area.width, height: area.height, font: font('hafs'), selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h' };
    const words = (r: ReactTestRenderer) => r.root.findAll((n) => String(n.type) === 'Text' && styleOf(n).position === 'absolute').map((n) => ({ s: styleOf(n), t: textOf(n), coloured: n.findAll((c) => String(c.type) === 'Text' && c !== n).length }));
    const off = words(render(base));
    const on = words(render({ ...base, tajweed: { spans: (i: number) => tajweedSpans(TAJWEED_RULES, i), palette: TAJWEED_PALETTES.light } }));
    expect(on.map((w) => [w.t, w.s.left, w.s.top, w.s.width, w.s.fontSize, w.s.fontFamily])).toEqual(off.map((w) => [w.t, w.s.left, w.s.top, w.s.width, w.s.fontSize, w.s.fontFamily]));
    expect(off.every((w) => w.coloured === 0)).toBe(true);
    expect(on.filter((w) => w.coloured > 0).length).toBeGreaterThan(40);
  });

  it('the two words KFGQPC Hafs cannot draw are drawn in the fallback font, on the line`s baseline', () => {
    for (const [page, key] of [[236, '12:11'], [525, '52:37']] as const) {
      const laidPage = layoutPage(UNICODE_MUSHAF_FONTS.hafs, page, area.width, text);
      const r = render({ laid: laidPage, width: area.width, height: area.height, font: font('hafs'), selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h' });
      const fallbacks = r.root.findAll((n) => String(n.type) === 'Text' && styleOf(n).fontFamily === 'amiri');
      expect(fallbacks, key).toHaveLength(1);
      const s = styleOf(fallbacks[0]);
      // Baselines agree: the fallback box's top + its ascent = the line box's top + the primary ascent.
      const f = font('hafs');
      expect(s.top + s.fontSize * 0.08 + 1.815 * s.fontSize).toBeCloseTo(f.ascentEm * s.fontSize, 6);
    }
  });
});

describe('cross-platform hardening and on-device diagnostics', () => {
  const { text: area } = computePageLayout(387, 31);
  const laid = layoutPage(UNICODE_MUSHAF_FONTS.hafs, 3, area.width, text);
  const base = { laid, width: area.width, height: area.height, font: font('hafs'), selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h' };
  const wordTexts = (r: ReactTestRenderer) => r.root.findAll((n) => String(n.type) === 'Text' && styleOf(n).position === 'absolute');

  it('every Quran word: one line, clipped never ellipsised, no Android font padding, the font`s own line box', () => {
    const r = render(base);
    const words = wordTexts(r);
    expect(words.length).toBeGreaterThan(100);
    for (const w of words) {
      const s = styleOf(w);
      expect(w.props.numberOfLines).toBe(1);
      expect(w.props.ellipsizeMode).toBe('clip');
      expect(w.props.allowFontScaling).toBe(false);
      expect(s.includeFontPadding).toBe(false);
      expect(s.lineHeight).toBeCloseTo((2400 + 1200) / 2048 * s.fontSize, 6);
    }
  });

  it('platform widths equal to the layout`s: a clean report; a word drawn wider than its gap allows: reported as touching', () => {
    const run = (widen: number) => {
      const reports: { widthOver1px: number; touching: string[]; words: number; widthMaxDelta: number }[] = [];
      const r = render({ ...base, diagnostics: { onReport: (rep: never) => reports.push(rep) } });
      // The page's word slots are outlined, and each line's baseline drawn.
      expect(r.root.findAll((n) => String(n.type) === 'View' && styleOf(n).borderWidth === 0.5).length).toBeGreaterThan(100);
      const words = wordTexts(r).filter((w) => typeof w.props.onTextLayout === 'function');
      words.forEach((w, i) => {
        const s = styleOf(w);
        const advance = s.width - 2 * 0.6 * s.fontSize;
        act(() => w.props.onTextLayout({ nativeEvent: { lines: [{ y: s.paddingTop, width: advance + (i === 0 ? widen : 0), ascender: (2400 / 2048) * s.fontSize, x: 0, height: s.lineHeight }] } }));
      });
      return reports;
    };
    const clean = run(0);
    expect(clean).toHaveLength(1);
    expect(clean[0].words).toBe(laid.rows.reduce((n, row) => n + (row.kind === 'text' ? row.items.filter((i) => i.kind === 'word').length : 0), 0));
    expect(clean[0].widthOver1px).toBe(0);
    expect(clean[0].touching).toEqual([]);
    const wide = run(40);
    expect(wide[0].widthOver1px).toBe(1);
    expect(wide[0].touching.length).toBeGreaterThan(0);
  });
});
