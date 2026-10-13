import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * Android only: Android's TextView.onDraw clips the canvas horizontally to its content box (inside the padding), so
 * the iOS ink room (horizontal padding) draws nothing there. Each drawn glyph's in-flow Text stays (layout, line box,
 * width and taps unchanged) but transparent, and an unclipped copy draws it: a content box spanning the advance
 * ± QCF_V1_INK_OVERFLOW_EM, no horizontal padding, centred; vertically the same room. iOS: qpcV1 / mushaf tests.
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

const { QpcV1PageText } = await import('@/components/QpcV1PageText');
const { QCF_V1_INK_OVERFLOW_EM, QCF_V1_INK_ROOM_V_EM, QCF_V1_LINE_BOX_EM, QCF_V1_NORMAL_BOX_MARGIN_EM } = await import('@/mushaf/ayahMarkers');
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));
const isText = (node: ReactTestInstance) => String(node.type) === 'Text' && typeof node.props.children === 'string';

type Layout = Parameters<typeof QpcV1PageText>[0]['layout'];
async function render(layout: Layout, boxMarginEm = 0) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(QpcV1PageText, { layout, width: 315, height: 509, selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h', basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional', boxMarginEm }));
  });
  const measures = root.root.findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('qpc-measure-'));
  if (measures.length) await act(async () => { for (const m of measures) m.props.onLayout({ nativeEvent: { layout: { width: 400 } } }); });
  return root;
}

/** Every drawn glyph: one transparent in-flow Text plus one unclipped copy, exactly placed; markers: no copy. Returns the glyphs drawn. */
function checkPage(root: ReturnType<typeof create>, boxMarginEm: number, problems: string[], label: string) {
  const drawn: string[] = [];
  const lines = root.root.findAll((node) => typeof node.props.testID === 'string' && /^qpc-(line|basmala)-\d+$/.test(node.props.testID) && String(node.type) !== 'Text');
  for (const line of lines) {
    for (const word of line.children as ReactTestInstance[]) {
      if (typeof word === 'string' || String(word.type) !== 'View' || word.props.testID) continue;
      const texts = word.findAll(isText).filter((node) => node.parent === word);
      if (texts.length === 0) continue;
      const [inFlow, copy] = texts;
      const s = styleOf(inFlow);
      const size = s.fontSize;
      const R = size * QCF_V1_INK_OVERFLOW_EM;
      const RV = size * QCF_V1_INK_ROOM_V_EM;
      if (s.color !== 'transparent') { problems.push(`${label}: in-flow glyph painted`); continue; }
      // In-flow layout as on iOS: the advance, the font's line box, the vertical room.
      if (Math.abs(s.lineHeight - size * QCF_V1_LINE_BOX_EM) > 1e-6 || Math.abs(s.marginHorizontal + R) > 1e-6 || Math.abs(s.paddingHorizontal - R) > 1e-6) problems.push(`${label}: in-flow layout changed`);
      const hiddenMarker = texts.length === 1;
      if (hiddenMarker) {
        if (Math.abs(s.paddingVertical ?? 0) > 1e-6) problems.push(`${label}: a glyph without its copy`); // only the hidden ayah-end glyph has no copy (and no vertical room)
        continue;
      }
      const c = styleOf(copy);
      if (copy.props.children !== inFlow.props.children) problems.push(`${label}: copy draws another glyph`);
      if (c.position !== 'absolute' || Math.abs(c.left + R) > 1e-6 || Math.abs(c.right + R) > 1e-6 || Math.abs(c.top + RV) > 1e-6 || Math.abs(c.bottom + RV) > 1e-6) problems.push(`${label}: copy box`);
      if (c.textAlign !== 'center' || (c.paddingHorizontal ?? 0) !== 0 || c.paddingLeft !== undefined || c.paddingRight !== undefined) problems.push(`${label}: copy not centred in an unpadded box`);
      if (Math.abs(c.paddingVertical - size * (QCF_V1_INK_ROOM_V_EM + boxMarginEm)) > 1e-6) problems.push(`${label}: copy vertical room`);
      if (c.fontFamily !== s.fontFamily || c.fontSize !== size || c.lineHeight !== s.lineHeight || c.color === 'transparent') problems.push(`${label}: copy font`);
      if (copy.props.accessible !== false || copy.props.numberOfLines !== 1) problems.push(`${label}: copy props`);
      drawn.push(copy.props.children);
    }
  }
  return drawn;
}

describe('Android: every Quran glyph drawn through an unclipped copy', () => {
  it('a page with words, an ayah-end medallion and a Basmala (Normal and Full-Screen room)', async () => {
    const layout = {
      page: 61, edition: 'qpc-v1', fontFamily: 'QCF_P061', fetchedAt: '', keepUntil: '', verseKeys: ['3:84'],
      lines: [{ line: 1, words: [
        { verseKey: '3:84', position: 1, kind: 'word', glyph: 'ﭑ' },
        { verseKey: '3:84', position: 2, kind: 'word', glyph: 'ﭒ' },
        { verseKey: '3:84', position: 3, kind: 'end', glyph: 'ﭓ' },
      ] }],
    } as unknown as Layout;
    for (const margin of [QCF_V1_NORMAL_BOX_MARGIN_EM, 0]) {
      const problems: string[] = [];
      const root = await render(layout, margin);
      // The two words (the ayah end has its medallion instead), then the Basmala of the empty lines below (page 1's font).
      expect(checkPage(root, margin, problems, `margin ${margin}`)).toEqual(['ﭑ', 'ﭒ', 'ﭑ', 'ﭒ', 'ﭓ', 'ﭔ']);
      expect(problems).toEqual([]);
      await act(async () => root.unmount());
    }
  });
});

describe('Android: the Quran lines where the approved iPhone draws them (ANDROID_MATCHES_IPHONE_BASELINE)', () => {
  it('Quran and Basmala rows move down by the iPhone`s measured drop; headings by surahHeadingShift; copies and in-flow glyphs share one baseline', async () => {
    const { ANDROID_MATCHES_IPHONE_BASELINE, qcfV1AndroidRowShiftEm, qcfV1DrawnLineShiftEm } = await import('@/mushaf/ayahMarkers');
    expect(ANDROID_MATCHES_IPHONE_BASELINE).toBe(true);
    expect(qcfV1AndroidRowShiftEm(61, 'android')).toBeCloseTo(770 / 2048, 9); // = the iPhone's drop (3311 − 2541 units)
    expect(qcfV1AndroidRowShiftEm(61, 'android')).toBe(qcfV1DrawnLineShiftEm(61, 'ios'));
    expect(qcfV1AndroidRowShiftEm(237, 'android')).toBe(qcfV1DrawnLineShiftEm(237, 'ios')); // page 237: its own metrics
    expect(qcfV1AndroidRowShiftEm(61, 'ios')).toBe(0); // the iPhone renderer is untouched
    expect(qcfV1AndroidRowShiftEm(61, 'web')).toBe(0);
    const layout = {
      page: 61, edition: 'qpc-v1', fontFamily: 'QCF_P061', fetchedAt: '', keepUntil: '', verseKeys: ['3:84'],
      lines: [{ line: 1, words: [{ verseKey: '3:84', position: 1, kind: 'word', glyph: 'ﭑ' }, { verseKey: '3:84', position: 2, kind: 'end', glyph: 'ﭓ' }] }],
    } as unknown as Layout;
    const root = await render(layout, QCF_V1_NORMAL_BOX_MARGIN_EM);
    const row = (id: string) => styleOf(root.root.find((n) => n.props.testID === id && typeof n.type === 'string'));
    const glyph = root.root.find((n) => n.props.testID === 'qpc-line-1' && typeof n.type === 'string').findAll(isText)[0];
    const fontSize = styleOf(glyph).fontSize as number;
    const pitch = 509 / 15;
    expect(row('qpc-line-1').top).toBeCloseTo(0 + qcfV1DrawnLineShiftEm(61, 'ios') * fontSize, 9);
    const { surahHeadingShift } = await import('@/mushaf/ayahMarkers');
    expect(row('qpc-heading-2').top).toBeCloseTo(pitch + surahHeadingShift(61, 'android', fontSize, pitch), 9);
    expect(row('qpc-basmala-3').top).toBeCloseTo(2 * pitch + qcfV1DrawnLineShiftEm(1, 'ios') * fontSize, 9);
    // In-flow and copy: the same font, size, line box and content top, so the same baseline (checkPage verifies boxes).
    expect(checkPage(root, QCF_V1_NORMAL_BOX_MARGIN_EM, [], 'parity')).toContain('ﭑ');
    await act(async () => root.unmount());
  });
});

const dir = fileURLToPath(new URL('../../backend/data/mushaf-sync/', import.meta.url));
const snapshot = existsSync(dir) ? readdirSync(dir).find((name) => /^records-\d+\.json\.gz$/.test(name)) : undefined;
describe.skipIf(!snapshot)('Android: all 604 pages (local Content Sync snapshot)', () => {
  it('every word and Basmala glyph of every page has its exact unclipped copy; no glyph is drawn twice', async () => {
    type Rec = { record_type: string; mushaf_id: number; page_number: number; line_number: number; position_in_page: number; position_in_verse: number; verse_id: number; char_type_name: string; text: string };
    const records = JSON.parse(gunzipSync(readFileSync(resolve(dir, snapshot!))).toString('utf8')) as Rec[];
    const counts = (JSON.parse(readFileSync(new URL('../../tools/quran-verification/surah-counts.json', import.meta.url), 'utf8')) as { counts: number[] }).counts;
    const keys = counts.flatMap((n, s) => Array.from({ length: n }, (_, a) => `${s + 1}:${a + 1}`));
    const byPage = new Map<number, Rec[]>();
    for (const r of records) if (r.record_type === 'mushaf_word' && r.mushaf_id === 2) byPage.set(r.page_number, [...(byPage.get(r.page_number) ?? []), r]);
    const problems: string[] = [];
    let words = 0;
    for (let page = 1; page <= 604; page++) {
      const lines: { line: number; words: { verseKey: string; position: number; kind: string; glyph: string }[] }[] = [];
      const verseKeys: string[] = [];
      for (const w of [...byPage.get(page)!].sort((a, b) => a.position_in_page - b.position_in_page)) {
        const verseKey = keys[w.verse_id - 1];
        if (verseKeys.at(-1) !== verseKey) verseKeys.push(verseKey);
        if (lines.at(-1)?.line !== w.line_number) lines.push({ line: w.line_number, words: [] });
        lines.at(-1)!.words.push({ verseKey, position: w.position_in_verse, kind: w.char_type_name === 'end' ? 'end' : 'word', glyph: w.text });
      }
      const layout = { page, edition: 'qpc-v1', fontFamily: `QCF_P${String(page).padStart(3, '0')}`, fetchedAt: '', keepUntil: '', lines, verseKeys } as unknown as Layout;
      const root = await render(layout, QCF_V1_NORMAL_BOX_MARGIN_EM);
      const drawn = checkPage(root, QCF_V1_NORMAL_BOX_MARGIN_EM, problems, `page ${page}`);
      const expected = lines.flatMap((l) => l.words.filter((w) => w.kind === 'word').map((w) => w.glyph));
      const textDrawn = drawn.filter((g) => !['ﭑ', 'ﭒ', 'ﭓ', 'ﭔ'].includes(g) || expected.includes(g));
      if (textDrawn.slice(0, expected.length).join('') !== expected.join('') && !drawn.join('').includes(expected.join(''))) problems.push(`page ${page}: copies differ from the layout's words`);
      words += expected.length;
      await act(async () => root.unmount());
      if (problems.length > 10) break;
    }
    expect(problems).toEqual([]);
    expect(words).toBe(77429); // every Quran word of the 604 pages (ayah ends: their medallions)
  }, 1_200_000);
});
