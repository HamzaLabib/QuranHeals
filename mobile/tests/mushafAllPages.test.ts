import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { createElement } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', G: 'G', Defs: 'Defs', Ellipse: 'Ellipse', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

/**
 * All 604 QPC V1 pages, from a local Content Sync snapshot
 * (backend/data/mushaf-sync/records-*.json.gz — gitignored, Quran Foundation
 * content). Skipped where there is none (CI): no QF data in the repository.
 *  - The reader's per-page Tanzil check passes on every page (it used to
 *    refuse every page with a Surah opening: Tanzil's ayah 1 carries the Basmala).
 *  - Every Surah has one heading slot and every Surah but 1 and 9 one Basmala
 *    slot; every empty line is one of them.
 */
const dir = fileURLToPath(new URL('../../backend/data/mushaf-sync/', import.meta.url));
const snapshot = existsSync(dir) ? readdirSync(dir).find((name) => /^records-\d+\.json\.gz$/.test(name)) : undefined;

describe.skipIf(!snapshot)('all 604 pages (local Content Sync snapshot)', async () => {
  const { checkAgainstTanzil } = await import('@/mushaf/qpcV1Layout');
  const { surahOpeningSlots } = await import('@/mushaf/surahOpenings');
  const { getSurahName } = await import('@/services/surahNames');
  const { placeSurahHeading } = await import('@/mushaf/surahHeadingPlacement');
  const FIT = 0.985; // QpcV1PageText
  const headingPageSize = new Map((JSON.parse(readFileSync(new URL('./fixtures/headingNeighbours.json', import.meta.url), 'utf8')) as { page: number; sizePerTextWidth: number }[]).map((h) => [h.page, h.sizePerTextWidth]));
  const { MUSHAF_TEXT_LIFT_PT, pageWidthOfText, textSideInset, textVerticalInset } = await import('@/mushaf/pageGeometry');
  const { qcfV1DrawnLineShiftEm } = await import('@/mushaf/ayahMarkers');
  const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
  const verses = db.prepare('SELECT verse_key AS k, arabic_text AS t FROM verses ORDER BY surah, ayah').all() as { k: string; t: string }[];
  const textOf = new Map(verses.map((v) => [v.k, v.t]));
  type Rec = { record_type: string; mushaf_id: number; page_number: number; line_number: number; position_in_page: number; position_in_verse: number; verse_id: number; char_type_name: string; text: string };
  const records = snapshot ? (JSON.parse(gunzipSync(readFileSync(resolve(dir, snapshot))).toString('utf8')) as Rec[]) : [];
  const byPage = new Map<number, Rec[]>();
  for (const r of records) if (r.record_type === 'mushaf_word' && r.mushaf_id === 2) byPage.set(r.page_number, [...(byPage.get(r.page_number) ?? []), r]);
  const layoutOf = (page: number) => {
    const lines: { line: number; words: { verseKey: string; position: number; kind: 'word' | 'end' | 'mark'; glyph: string }[] }[] = [];
    const verseKeys: string[] = [];
    // Page order: position_in_line is unreliable at line starts (see backend/src/mushaf/offline/dataset.ts).
    for (const w of [...(byPage.get(page) ?? [])].sort((a, b) => a.position_in_page - b.position_in_page)) {
      const verseKey = verses[w.verse_id - 1].k;
      if (verseKeys.at(-1) !== verseKey) verseKeys.push(verseKey);
      if (lines.at(-1)?.line !== w.line_number) lines.push({ line: w.line_number, words: [] });
      lines.at(-1)!.words.push({ verseKey, position: w.position_in_verse, kind: w.char_type_name === 'word' ? 'word' : w.char_type_name === 'end' ? 'end' : 'mark', glyph: w.text });
    }
    return { page, edition: 'qpc-v1' as const, fontFamily: '', fetchedAt: '', keepUntil: '', lines, verseKeys };
  };

  it('the reader`s Tanzil check passes on every page (with the Basmala rule); the old count refused every Surah opening', () => {
    const basmala = textOf.get('1:1')!;
    const failing: string[] = [];
    let refusedBefore = 0;
    for (let page = 1; page <= 604; page++) {
      const layout = layoutOf(page);
      const tanzil = Object.fromEntries(layout.verseKeys.map((k) => [k, textOf.get(k)!]));
      const check = checkAgainstTanzil(layout, layout.verseKeys, tanzil, basmala);
      if (!check.ok) failing.push(`page ${page}: ${check.problems.join('; ')}`);
      if (!checkAgainstTanzil(layout, layout.verseKeys, tanzil).ok) refusedBefore += 1;
    }
    expect(failing).toEqual([]);
    expect(refusedBefore).toBe(99); // every page with a Surah opening (some hold several)
  });

  it('every page renders: each text line, heading and Basmala drawn once, rows inside the page and never on top of each other (the larger-text frames, several phones)', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { QpcV1PageText } = await import('@/components/QpcV1PageText');
    const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
    const problems: string[] = [];
    let separators = 0;
    let glyphsChecked = 0;
    let totalGlyphs = 0;
    const { computePageLayout, QURAN_TEXT_SCALE } = await import('@/mushaf/pageGeometry');
    const { QCF_V1_INK_OVERFLOW_EM, QCF_V1_INK_ROOM_V_EM, QCF_V1_LINE_BOX_EM, QCF_V1_NORMAL_BOX_MARGIN_EM } = await import('@/mushaf/ayahMarkers');
    const { AYAH_MARKER_ARTWORK } = await import('@/mushaf/generated/ayahMarkerArtwork');
    let medallions = 0;
    // The text areas the reader really uses with the larger text (candidate C; fitMushafPage, MushafPageView): a 387-pt
    // page (iPhone 393) in Normal Mode (31 tiles) and Full-Screen (33), the tallest frame (35 tiles, a tall 412-pt Android)
    // in both modes, the iPhone SE's 324-pt page (31 tiles, the shortest frame; 34 in full screen), a small Android's
    // 274-pt page and a 320 × 568 phone's 261-pt one (31: the shortest frame on the narrowest pages), and the 16 Pro Max's
    // 434-pt page (32). Normal Mode's glyph
    // containers are taller.
    for (const [pageWidth, tiles, mode] of [[387, 31, 'normal'], [387, 33, 'full'], [406, 35, 'normal'], [406, 35, 'full'], [324, 31, 'normal'], [324, 34, 'full'], [274, 31, 'normal'], [261, 31, 'normal'], [434, 32, 'normal']] as const) {
      const marginEm = mode === 'normal' ? QCF_V1_NORMAL_BOX_MARGIN_EM : 0;
      const { text } = computePageLayout(pageWidth, tiles);
      const { width, height } = text;
      const printedPitch = computePageLayout(pageWidth).linePitch;
      const pitch = height / 15;
      for (let page = 1; page <= 604; page++) {
        const layout = layoutOf(page);
        const slots = surahOpeningSlots(layout);
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
          renderer = create(createElement(QpcV1PageText, { layout, width, height, printedPitch, selectedVerseKey: null, onSelectVerse: () => undefined, accessibilityLabel: 'p', accessibilityHint: 'h', basmalaFontFamily: 'QCF_P001', markerStyle: 'traditional', boxMarginEm: marginEm }));
        });
        // Regular pages measure their lines first (as on a device); the widest fills the width.
        const measures = renderer.root.findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('qpc-measure-'));
        // A page with a Surah heading gets its real letter size (its widest line from the page font, recorded by the
        // heading-ink generator): the heading is placed by the real ink next to it, at that size.
        const size = headingPageSize.get(page);
        const measured = size === undefined ? 400 : (100 * FIT) / size;
        if (measures.length) await act(async () => { for (const m of measures) m.props.onLayout({ nativeEvent: { layout: { width: measured } } }); });
        const rows = renderer.root.findAll((node) => typeof node.props.testID === 'string' && /^qpc-(line|heading|basmala)-\d+$/.test(node.props.testID) && String(node.type) !== 'Text');
        const lines = rows.filter((r) => r.props.testID.startsWith('qpc-line-'));
        if (lines.length !== layout.lines.length) problems.push(`page ${page}: ${lines.length} of ${layout.lines.length} lines drawn`);
        const headings = rows.filter((r) => r.props.testID.startsWith('qpc-heading-')).length;
        const basmalas = rows.filter((r) => r.props.testID.startsWith('qpc-basmala-')).length;
        if (headings !== slots.filter((x) => x.kind === 'heading').length || basmalas !== slots.filter((x) => x.kind === 'basmala').length) problems.push(`page ${page}: ${headings} headings, ${basmalas} Basmalas drawn`);
        // Pages 1–2 keep the printed line spacing in every frame (their own composition, centred); others fill the grid.
        const rowPitch = page <= 2 ? Math.min(pitch, printedPitch) : pitch;
        for (const slot of slots.filter((candidate) => candidate.kind === 'heading')) {
          const heading = renderer.root.findByProps({ testID: `qpc-heading-${slot.line}` });
          const ornament = heading.findByType('Svg' as never);
          const ornamentStyle = styleOf(ornament);
          const headingText = heading.findAllByType('Text' as never).map((node) => [node.props.children].flat().join('')).join('');
          if (headingText !== `سورة ${getSurahName(slot.surah).nameArabic}`) problems.push(`page ${page}: wrong heading for Surah ${slot.surah}`);
          if (ornament.props.pointerEvents !== 'none' || ornament.props.accessible === true) problems.push(`page ${page}: heading ornament is interactive or accessible`);
          // Option A, full width: 96 % of the frame's inner width (the text area and its side margins), centred, inside
          // the frame's inner edge; the heading row's own height and place (the row itself is checked below).
          // Pages 1–2: the compact cartouche inside the ornamental circle (0.40 of the page width, 0.8 of the row, centred).
          const side = textSideInset(width);
          const span = page <= 2 ? pageWidthOfText(width) * 0.4 : (width + 2 * side) * 0.96;
          const tall = page <= 2 ? rowPitch * 0.8 : rowPitch;
          if (Math.abs(ornament.props.width - span) > 1e-6 || Math.abs(ornament.props.height - tall) > 1e-6
            || Math.abs(ornamentStyle.left - (width - span) / 2) > 1e-6 || Math.abs(ornamentStyle.top - (rowPitch - tall) / 2) > 1e-6
            || ornamentStyle.left < -side || ornamentStyle.left + ornament.props.width > width + side) {
            problems.push(`page ${page}: heading ornament outside its full-width slot or the frame's inner edge`);
          }
        }
        const tops = rows.map((r) => Math.round(styleOf(r).top * 1000));
        if (new Set(tops).size !== tops.length) problems.push(`page ${page}: two rows share a line`);
        for (const r of rows) {
          const { top, height: h } = styleOf(r);
          if (Math.abs(h - rowPitch) > 0.001) problems.push(`page ${page}: ${r.props.testID} is not one row tall`);
          if (String(r.props.testID).startsWith('qpc-heading-')) {
            // A Surah heading is placed by its neighbouring ink (surahHeadingPlacement.ts): it may reach past the text
            // area (a page's last line), but its ornament and name must stay inside the frame's inner edge, 0.5 pt clear.
            const inset = textVerticalInset(width);
            if (top < -(inset - MUSHAF_TEXT_LIFT_PT) + 0.5 - 0.001 || top + h > height + inset + MUSHAF_TEXT_LIFT_PT - 0.5 + 0.001) problems.push(`page ${page}: ${r.props.testID} outside the frame's inner edge (top ${top.toFixed(1)})`);
          } else if (top < -0.001 || top + h > height + 0.001) problems.push(`page ${page}: ${r.props.testID} outside the page (top ${top.toFixed(1)})`); // Quran and Basmala rows: inside the text area
        }
        // Regular pages: every Quran line and Basmala row exactly on its grid row (uniform baselines: every glyph box
        // centred in its row); each Surah heading where its neighbouring ink places it (surahHeadingPlacement.ts).
        if (page > 2) {
          for (const r of rows) {
            const line = Number(String(r.props.testID).split('-').pop());
            const top = styleOf(r).top as number;
            const expected = String(r.props.testID).startsWith('qpc-heading-')
              ? placeSurahHeading({ page, line, os: 'ios', fontSize: styleOf(lines[0].findAll((n) => String(n.type) === 'Text')[0]).fontSize as number, rowPitch: pitch, rowTop: (l) => (l - 1) * pitch, textWidth: width, textHeight: height }).top
              : (line - 1) * pitch;
            if (Math.abs(top - expected) > 0.001) problems.push(`page ${page}: ${r.props.testID} off its place (uneven line spacing)`);
          }
        }
        // Every glyph (words, ayah separators, marks) has the full QPC V1 glyph box: nothing can be clipped by its Text.
        for (const line of lines) {
          for (const glyph of line.findAll((node) => String(node.type) === 'Text' && typeof node.props.children === 'string')) {
            const style = styleOf(glyph);
            if (Math.abs(style.lineHeight - style.fontSize * QCF_V1_LINE_BOX_EM) > 0.001) { problems.push(`page ${page}: ${line.props.testID} glyph box ${style.lineHeight} for size ${style.fontSize}`); break; }
            // …and room for the ink outside its advance (iOS clipped it: تَقُولَ on page 465 read نقول), without moving it.
            const room = style.fontSize * QCF_V1_INK_OVERFLOW_EM;
            if (Math.abs(style.paddingHorizontal - room) > 0.001 || Math.abs(style.marginHorizontal + room) > 0.001) { problems.push(`page ${page}: ${line.props.testID} glyph without ink room`); break; }
            // …and above and below its line box (ink reaches within 1 unit of it on pages 322, 323, 466), unless it is a hidden marker.
            // Normal Mode's container: 0.25 em more padding above and below, uncancelled (taller, centred: nothing moves).
            const hidden = style.color === 'transparent';
            const roomV = hidden ? 0 : style.fontSize * QCF_V1_INK_ROOM_V_EM;
            const extraV = hidden ? 0 : style.fontSize * marginEm;
            if (Math.abs((style.paddingVertical ?? 0) - roomV - extraV) > 0.001 || Math.abs((style.marginVertical ?? 0) + roomV) > 0.001) { problems.push(`page ${page}: ${line.props.testID} glyph without its vertical room (${mode})`); break; }
          }
        }
        // Every ayah separator is the approved medallion (page 61's ornament) with its own ayah's number, over its hidden glyph.
        for (const line of lines) {
          for (const word of line.children as ReactTestInstance[]) {
            const glyph = word.findAll((node) => String(node.type) === 'Text' && typeof node.props.children === 'string')[0];
            const layoutWord = layout.lines.flatMap((l) => l.words).find((w) => w.glyph === glyph?.props.children);
            if (layoutWord?.kind !== 'end') continue;
            const paths = word.findAll((node) => String(node.type) === 'Path').map((node) => node.props.d as string);
            const ayah = Number(layoutWord.verseKey.split(':')[1]);
            if (paths.length !== 2 || paths[0] !== AYAH_MARKER_ARTWORK.ornamentPath || paths[1] !== AYAH_MARKER_ARTWORK.numbers[ayah - 1].numberPath) problems.push(`page ${page}: ${layoutWord.verseKey} separator is not the approved medallion with number ${ayah}`);
            else if (styleOf(glyph).color !== 'transparent') problems.push(`page ${page}: ${layoutWord.verseKey} font marker glyph still painted`);
            else medallions += 1;
          }
        }
        // Each ayah separator is drawn, after its ayah's words, once.
        const ends = layout.lines.flatMap((l) => l.words.filter((w) => w.kind === 'end').map((w) => w.glyph));
        const drawn = lines.flatMap((line) => line.findAll((node) => String(node.type) === 'Text' && typeof node.props.children === 'string').map((node) => node.props.children as string));
        for (const end of ends) if (!drawn.includes(end)) problems.push(`page ${page}: ayah separator ${end.codePointAt(0)!.toString(16)} not drawn`);
        separators += ends.filter((end) => drawn.includes(end)).length;
        // Every word, separator and mark of the layout, each drawn exactly once and in order, nothing extra.
        const expected = layout.lines.flatMap((l) => l.words.map((w) => w.glyph));
        if (drawn.join('') !== expected.join('') || drawn.length !== expected.length) problems.push(`page ${page}: ${drawn.length} of ${expected.length} glyphs drawn as laid out`);
        glyphsChecked += drawn.length;
        totalGlyphs += expected.length;
        if (page <= 2) {
          const size = styleOf(lines[0].findAllByType('Text' as never)[0]).fontSize;
          // The printed letter size: on the printed text width (this text area is QURAN_TEXT_SCALE wider).
          if (Math.abs(size - (width / QURAN_TEXT_SCALE) * 0.0692) > 0.01) problems.push(`page ${page}: letter size ${size}`);
          // The block (heading, Basmala, lines) centred: from the line rows' grid, with the heading's grid row.
          const firstLine = lines[0];
          const blockTop = (styleOf(firstLine).top as number) - (Number(String(firstLine.props.testID).split('-').pop()) - 1) * rowPitch;
          const used = [...layout.lines.map((l) => l.line), ...slots.map((x) => x.line)];
          const above = blockTop + (Math.min(...used) - 1) * rowPitch;
          const below = height - (blockTop + Math.max(...used) * rowPitch);
          // Centred on the frame (its ornamental circle) as drawn: the lift taken back, less iOS's drawn drop.
          const offset = MUSHAF_TEXT_LIFT_PT - qcfV1DrawnLineShiftEm(page, 'ios') * size;
          if (Math.abs(above - below - 2 * offset) > 0.01) problems.push(`page ${page}: block not centred (${above.toFixed(1)} above, ${below.toFixed(1)} below)`);
        }
        await act(async () => renderer.unmount());
      }
    }
    expect(problems).toEqual([]);
    expect(separators).toBe(6236 * 9); // every ayah's separator, in each of the nine frames
    expect(medallions).toBe(6236 * 9); // each one the approved medallion
    expect(glyphsChecked).toBe(totalGlyphs);
    expect(totalGlyphs / 9).toBe(records.filter((r) => r.record_type === 'mushaf_word' && r.mushaf_id === 2).length); // all of the dataset's glyphs
  }, 1_200_000);

  it('114 headings, 112 Basmalas, every empty line one of them', () => {
    const headings = new Map<number, number>();
    const basmalas = new Map<number, number>();
    const unassigned: string[] = [];
    for (let page = 1; page <= 604; page++) {
      const layout = layoutOf(page);
      const slots = surahOpeningSlots(layout);
      for (const slot of slots) (slot.kind === 'heading' ? headings : basmalas).set(slot.surah, ((slot.kind === 'heading' ? headings : basmalas).get(slot.surah) ?? 0) + 1);
      const used = new Set([...layout.lines.map((l) => l.line), ...slots.map((s) => s.line)]);
      const first = Math.min(...layout.lines.map((l) => l.line));
      for (let line = 1; line <= 15; line++) {
        if (page <= 2 && line < first - (page === 1 ? 1 : 2)) continue; // pages 1–2 sit low in the grid
        if (!used.has(line)) unassigned.push(`page ${page} line ${line}`);
      }
    }
    expect(unassigned).toEqual([]);
    expect([...headings.values()].every((n) => n === 1) && headings.size === 114).toBe(true);
    expect(basmalas.size).toBe(112);
    expect(basmalas.has(1) || basmalas.has(9)).toBe(false);
  });
});
