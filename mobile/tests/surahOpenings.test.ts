import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));

const { surahOpeningSlots, BASMALA_GLYPHS, isOpeningPage } = await import('@/mushaf/surahOpenings');
const { QpcV1PageText } = await import('@/components/QpcV1PageText');

/**
 * Surah headings and Basmalas (the empty lines of a Surah's opening), and the
 * special opening pages 1–2. The slot rules are also checked against all 604
 * pages by tools/mushaf-audit/audit-surah-openings.mts (114 headings, 112
 * Basmalas, every empty line accounted for).
 */

type Word = { verseKey: string; position: number; kind: 'word' | 'end'; glyph: string };
const line = (n: number, ...keys: [string, number][]) => ({ line: n, words: keys.map(([verseKey, position]) => ({ verseKey, position, kind: 'word', glyph: 'x' }) as Word) });
/** Text lines from..15 continuing `verseKey` (a real page runs to line 15). */
const rest = (from: number, verseKey: string) => Array.from({ length: 16 - from }, (_, i) => line(from + i, [verseKey, 10 + i]));

describe('where headings and Basmalas go', () => {
  it('a Surah opening mid-page: the two empty lines are its heading, then its Basmala', () => {
    const slots = surahOpeningSlots({ lines: [line(5, ['4:176', 40]), line(8, ['5:1', 1], ['5:1', 2]), ...rest(9, '5:2')] });
    expect(slots).toEqual([{ line: 6, kind: 'heading', surah: 5 }, { line: 7, kind: 'basmala', surah: 5 }]);
  });

  it('one empty line at the top before ayah 1: the Basmala (its heading ended the page before)', () => {
    expect(surahOpeningSlots({ lines: [line(2, ['10:1', 1]), ...rest(3, '10:2')] })).toEqual([{ line: 1, kind: 'basmala', surah: 10 }]);
  });

  it('empty lines at the bottom of a page open the next Surah: heading and Basmala, or the heading alone', () => {
    expect(surahOpeningSlots({ lines: [line(13, ['3:200', 10])] })).toEqual([{ line: 14, kind: 'heading', surah: 4 }, { line: 15, kind: 'basmala', surah: 4 }]);
    expect(surahOpeningSlots({ lines: [line(14, ['21:112', 9])] })).toEqual([{ line: 15, kind: 'heading', surah: 22 }]);
  });

  it('Surah 9 has no Basmala; Surah 1`s Basmala is its first ayah, so only its heading', () => {
    expect(surahOpeningSlots({ lines: [line(1, ['8:75', 3]), line(4, ['9:1', 1]), ...rest(5, '9:2')] })).toEqual([{ line: 3, kind: 'heading', surah: 9 }]);
    expect(surahOpeningSlots({ lines: [line(9, ['1:1', 1]), ...rest(10, '1:2')] })).toEqual([{ line: 8, kind: 'heading', surah: 1 }]);
  });

  it('a regular page has no slots; ayah 1 continuing a line is not an opening', () => {
    expect(surahOpeningSlots({ lines: Array.from({ length: 15 }, (_, i) => line(i + 1, ['3:85', i + 1])) })).toEqual([]);
    expect(isOpeningPage(1) && isOpeningPage(2) && !isOpeningPage(3)).toBe(true);
  });

  it('the Basmala is the four word glyphs of 1:1 in page 1`s QPC V1 font, without its ayah marker', () => {
    expect(BASMALA_GLYPHS.map((g) => g.codePointAt(0)!.toString(16))).toEqual(['fb51', 'fb52', 'fb53', 'fb54']);
  });
});

describe('drawing them', () => {
  let root: ReactTestRenderer;
  afterEach(async () => { if (root) await act(async () => root.unmount()); });
  const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
  const textOf = (node: ReactTestInstance) => node.findAllByType('Text' as never).map((t) => [t.props.children].flat().join(''));
  async function draw(layout: { page: number; fontFamily: string; lines: ReturnType<typeof line>[] }, props: Record<string, unknown> = {}) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const full = { ...layout, verseKeys: [...new Set(layout.lines.flatMap((l) => l.words.map((w) => w.verseKey)))] };
    await act(async () => {
      root = create(createElement(QpcV1PageText as never, { layout: full, width: 300, height: 450, selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h', ...props }));
    });
  }

  it('page 2: the regular letter size (not fitted to its short lines), lines centred, the block centred on the page', async () => {
    const lines = [line(10, ['2:1', 1]), ...[11, 12, 13, 14, 15].map((n) => line(n, [`2:${n - 9}`, 1], [`2:${n - 9}`, 2]))];
    await draw({ page: 2, fontFamily: 'QCF_P002', lines }, { basmalaFontFamily: 'QCF_P001', headingFontFamily: 'Amiri' });
    const pitch = 450 / 15;
    const row = (n: number) => styleOf(root.root.findByProps({ testID: `qpc-line-${n}` }));
    expect(root.root.findAllByProps({ testID: 'qpc-measure-10' })).toHaveLength(0); // not fitted to the width
    const size = styleOf(root.root.findByProps({ testID: 'qpc-line-10' }).findAllByType('Text' as never)[0]).fontSize;
    expect(size).toBeCloseTo(300 * 0.0692); // the regular pages' size, not 1.5× it
    expect(row(10).justifyContent).toBe('center');
    // Block: heading (8), Basmala (9), lines 10–15 — 8 rows, centred: 3.5 rows of space above and below.
    expect(styleOf(root.root.findByProps({ testID: 'qpc-heading-8' })).top).toBeCloseTo(3.5 * pitch);
    expect(row(15).top + pitch).toBeCloseTo(450 - 3.5 * pitch);
    // Even spacing kept: consecutive rows one pitch apart.
    expect(row(11).top - row(10).top).toBeCloseTo(pitch);
    expect(textOf(root.root.findByProps({ testID: 'qpc-heading-8' }))).toEqual(['سورة البقرة']);
    const basmala = root.root.findByProps({ testID: 'qpc-basmala-9' });
    expect(basmala.findAllByType('Text' as never).map((t) => t.props.children)).toEqual([...BASMALA_GLYPHS]);
    expect(styleOf(basmala.findAllByType('Text' as never)[0])).toMatchObject({ fontFamily: 'QCF_P001', fontSize: size });
  });

  it('a regular page keeps its measured, justified layout; a mid-page opening draws its heading and Basmala in their own lines', async () => {
    const lines = [...[1, 2, 3, 4, 5].map((n) => line(n, ['4:176', n])), ...[8, 9, 10, 11, 12, 13, 14, 15].map((n) => line(n, [n === 8 ? '5:1' : `5:${n - 7}`, 1]))];
    await draw({ page: 106, fontFamily: 'QCF_P106', lines }, { basmalaFontFamily: 'QCF_P001' });
    expect(root.root.findAllByProps({ testID: 'qpc-measure-1' })).toHaveLength(1); // measured as before
    await act(async () => { for (const l of lines) root.root.findByProps({ testID: `qpc-measure-${l.line}` }).props.onLayout({ nativeEvent: { layout: { width: 400 } } }); });
    const pitch = 450 / 15;
    expect(styleOf(root.root.findByProps({ testID: 'qpc-line-8' }))).toMatchObject({ top: 7 * pitch, justifyContent: 'space-between' });
    expect(styleOf(root.root.findByProps({ testID: 'qpc-heading-6' })).top).toBeCloseTo(5 * pitch);
    expect(styleOf(root.root.findByProps({ testID: 'qpc-basmala-7' })).top).toBeCloseTo(6 * pitch);
    expect(textOf(root.root.findByProps({ testID: 'qpc-heading-6' }))).toEqual(['سورة المائدة']);
  });

  it('without page 1`s font the Basmala line stays empty — never another font', async () => {
    const lines = [line(5, ['4:176', 1]), line(8, ['5:1', 1])];
    await draw({ page: 106, fontFamily: 'QCF_P106', lines }, { basmalaFontFamily: null });
    await act(async () => { for (const l of lines) root.root.findByProps({ testID: `qpc-measure-${l.line}` }).props.onLayout({ nativeEvent: { layout: { width: 400 } } }); });
    expect(root.root.findAllByProps({ testID: 'qpc-basmala-7' })).toHaveLength(0);
    expect(root.root.findAllByProps({ testID: 'qpc-heading-6' })).toHaveLength(1);
  });
});
