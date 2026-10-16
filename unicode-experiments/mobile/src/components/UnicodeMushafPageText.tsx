import { memo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { AyahMarkerOrnament } from '@/components/AyahMarkerOrnament';
import { SurahHeaderOrnament } from '@/components/SurahHeaderOrnament';
import { SurahHeadingTraditional } from '@/components/SurahHeadingTraditional';
import { MUSHAF_PAPER } from '@/constants/mushafTheme';
import { MUSHAF_MARKER_STYLES, type AyahMarkerColors } from '@/mushaf/appearance';
import { SURAH_HEADING_DECORATION, type HeadingDecoration } from '@/mushaf/decorations';
import { useGuideTarget } from '@/mushaf/guideTargets';
import { pageWidthOfText, textSideInset } from '@/mushaf/pageGeometry';
import { pressLocation } from '@/mushaf/pressLocation';
import { pressTargetAtLineX, type WordBox } from '@/mushaf/qpcV1Layout';
import { isOpeningPage, MEDALLION_ASPECT, MEDALLION_HEIGHT_EM, type LaidItem, type LaidPage, type LaidWord } from '@/mushaf/unicode/layout';
import { unicodeAyahMarker } from '@/mushaf/unicode/marker';
import { displayRuns, type DisplayEncoding } from '@/mushaf/unicode/encoding';
import { CHECK_COLORS, describeReport, summarise, type UnicodeDiagnosticsReport, type WordMeasure } from '@/mushaf/unicode/diagnostics';
import { colourRuns, type ColouredRun, type TajweedSpan } from '@/mushaf/unicode/tajweed';
import { getSurahName } from '@/services/surahNames';

/**
 * Unicode Mushaf prototype (development builds only): one page of the verified Tanzil text in a Unicode Quran font,
 * on the Madina Mushaf's own 15 lines, inside the unchanged production page (MushafPageView: frame, paper, running
 * heads, page number, navigation) — a drop-in for QpcV1PageText with the same props for selection, taps, the guide,
 * colours and the ورد's gold medallion.
 *
 * Every word group is its own Text at the position unicode/layout.ts computed, centred in a box wider and taller than
 * its advance (INK_ROOM_EM): iOS and Android draw a Text only inside its box, and Quran marks reach past a word's
 * advance; a box that already contains the ink needs no padding (which Android would clip) and nothing moves.
 * The line box is the font's own (ascent + descent), so no platform adds leading of its own.
 *
 * Ayah numbers are the production traditional medallion (AyahMarkerOrnament, the same artwork and colours, gold for
 * the selected ورد's ayah) in a slot of their own in the line. Taps: the row maps the press to the word or medallion
 * under it (pressTargetAtLineX, as the QPC V1 reader). Tajweed colours (`tajweed`) recolour runs of the same
 * characters inside each word's Text; nothing is placed differently.
 */

export type UnicodeMushafPageTextProps = {
  laid: LaidPage;
  /** The text area (mushaf/pageGeometry.ts), px. */
  width: number;
  height: number;
  /** The Quran font (mushaf/unicode/index.ts unicodeFontProps). */
  font: UnicodeFont;
  selectedVerseKey: string | null;
  onSelectVerse: (verseKey: string, at?: { x: number; y: number }) => void;
  onPressMarker?: (verseKey: string, at?: { x: number; y: number }) => void;
  guideTargets?: boolean;
  accessibilityLabel: string;
  accessibilityHint: string;
  accessibilityActions?: readonly { name: string; label?: string }[];
  onAccessibilityAction?: (actionName: string) => void;
  ink?: string;
  highlight?: { color: string; opacity: number };
  /** The printed line pitch: the highlight keeps the printed band height when lines are spaced wider. */
  printedPitch?: number;
  headingFontFamily?: string;
  headingColor?: string;
  headingDecoration?: HeadingDecoration;
  /** The selected ورد's ayah on this page: its medallion is drawn in `wirdMarker`'s gold. */
  wirdAyahKey?: string | null;
  wirdMarker?: { colors: AyahMarkerColors; glyph: string };
  markerColors?: AyahMarkerColors;
  /** Tajweed Colors ON: each verse's rule spans and the palette; null (the default) draws plain ink. */
  tajweed?: { spans: (verseIndex: number) => readonly TajweedSpan[]; palette: Parameters<typeof colourRuns>[2] } | null;
  /**
   * Development builds only (the "Check" chip): outline every word's and medallion's slot and each line's baseline,
   * and report what the platform laid out against the layout (mushaf/unicode/diagnostics.ts), once per page.
   */
  diagnostics?: { onReport: (report: UnicodeDiagnosticsReport) => void } | null;
};

/** A font as drawn: family and line box (ascent and descent per em). */
/**
 * A font as drawn: family, line box (ascent and descent per em) and, on iOS only, how far down its glyphs must move to sit
 * where the layout means them (TextKit places a font's baseline from its OS/2 typo metrics, other platforms from hhea;
 * the rule that measured the QCF V1 fonts' 0.376 em on the iPhone, ayahMarkers.ts qcfV1DrawnLineShiftEm).
 */
type FontFace = { fontFamily: string; ascentEm: number; descentEm: number; iosShiftEm?: number };
/**
 * The page's Quran font: its display encoding (how the verified text is handed to it, mushaf/unicode/encoding.ts) and
 * the fallback font for the words whose signs it cannot draw (their LaidWord.fallback), on the same baseline.
 */
export type UnicodeFont = FontFace & { displayEncoding: DisplayEncoding | null; fallback: FontFace | null };

/** Room around each word's advance for ink that reaches past it (marks, descenders), em: sideways and up/down. */
const INK_ROOM_EM = { x: 0.6, y: 0.08 };
/** A Surah heading's name, relative to the Quran text size, and its widest name (Amiri Bold), em (as QpcV1PageText). */
const HEADING_SIZE = 1.0;
const HEADING_NAME_MAX_EM = 5.27;
const OPENING_NAME_MAX_EM = 3.95;
const HEADING_ORNAMENT_SPAN = 0.96;
const OPENING_CARTOUCHE = { width: 0.4, height: 0.8 } as const;
/** The medallion's centre above the baseline, em: level with the middle of the letters. */
const MEDALLION_RISE_EM = 0.36;

/** The guide's examples: the first word and number of an ayah wholly on one line, from line 3 (clear of the heads). */
function guideExample(laid: LaidPage): { line: number; word: number; marker: number } | null {
  const rows = [...laid.rows.filter((r) => r.line >= 3), ...laid.rows.filter((r) => r.line < 3)];
  for (const row of rows) {
    if (row.kind !== 'text') continue;
    const marker = row.items.findIndex((item, i) => item.kind === 'marker' && i > 0 && row.items.slice(0, i).some((w) => w.kind === 'word' && w.verseKey === item.verseKey));
    if (marker < 0) continue;
    return { line: row.line, word: row.items.findIndex((w) => w.kind === 'word' && w.verseKey === row.items[marker].verseKey), marker };
  }
  return null;
}

/**
 * One word group. Drawn in the page's font through its display encoding (character by character, so Tajweed runs keep
 * their letters), with its elongation or narrow forms, or — for the rare word it cannot draw — in the fallback font as it is, its baseline on the line's.
 */
type MeasuredLine = { y: number; width: number; ascender: number };

function WordText({ item, fontSize, font, ink, runs, onMeasure }: { item: LaidWord; fontSize: number; font: UnicodeFont; ink: string; runs: ColouredRun[] | null; onMeasure?: (line: MeasuredLine, expectedBaseline: number) => void }) {
  const face = item.fallback && font.fallback ? font.fallback : font;
  const encoding = face === font ? font.displayEncoding : null;
  const lineBox = (face.ascentEm + face.descentEm) * fontSize;
  // The line's baseline is font.ascentEm below its box's top; this face's box is placed so its baseline falls there.
  const top = (font.ascentEm - face.ascentEm) * fontSize + (Platform.OS === 'ios' ? (face.iosShiftEm ?? 0) * fontSize : 0);
  const roomX = fontSize * INK_ROOM_EM.x;
  const roomY = fontSize * INK_ROOM_EM.y;
  return (
    <Text
      allowFontScaling={false}
      // One line, never an ellipsis: the box is wider than the word, so nothing should ever be cut; if a platform's
      // advance were wider still, clipping shows the problem plainly instead of hiding letters behind "…".
      numberOfLines={1}
      ellipsizeMode="clip"
      onTextLayout={onMeasure ? (event) => {
        const line = event.nativeEvent.lines[0];
        if (line) onMeasure({ y: line.y, width: line.width, ascender: line.ascender }, roomY + face.ascentEm * fontSize);
      } : undefined}
      style={[styles.word, {
        left: item.x - roomX,
        width: item.width + 2 * roomX,
        top: top - roomY,
        height: lineBox + 2 * roomY,
        paddingTop: roomY,
        color: ink,
        fontFamily: face.fontFamily,
        fontSize,
        lineHeight: lineBox,
      }, face === font && item.narrow ? stylisticSet(NARROW_SET) : null]}>
      {displayRuns(runs ?? [{ text: item.text, colour: null }], encoding).map((run, i) => (run.colour ? <Text key={i} style={{ color: run.colour }}>{run.text}</Text> : run.text))}
    </Text>
  );
}

/** QH Old Madina's narrow forms (tools/unicode-mushaf/build-madina-font.py): stylistic set 13. */
const NARROW_SET = 13;
/**
 * A word's narrow forms (QH Old Madina's stylistic set 13): the same characters, other glyphs of the same font. iOS
 * and Android take `fontVariant` ('stylistic-thirteen' = ss13), the web a CSS feature setting. (Calligraphic
 * elongation needs no feature: it is drawn from the tatweels the layout inserts.)
 */
function stylisticSet(n: number) {
  if (Platform.OS === 'web') return { fontFeatureSettings: `"ss${String(n).padStart(2, '0')}"` } as object;
  return { fontVariant: ['stylistic-thirteen'] } as object;
}

export const UnicodeMushafPageText = memo(function UnicodeMushafPageText({
  laid, width, height, font, selectedVerseKey, onSelectVerse, onPressMarker, guideTargets = false,
  accessibilityLabel, accessibilityHint, accessibilityActions, onAccessibilityAction,
  ink = MUSHAF_PAPER.ink,
  highlight = { color: MUSHAF_PAPER.highlight, opacity: MUSHAF_PAPER.highlightOpacity },
  printedPitch, headingFontFamily, headingColor, headingDecoration = SURAH_HEADING_DECORATION,
  wirdAyahKey = null, wirdMarker, markerColors = MUSHAF_MARKER_STYLES.traditional.colors ?? undefined, tajweed = null,
  diagnostics = null,
}: UnicodeMushafPageTextProps) {
  // Diagnostics: the platform's measure of each word, collected until the page's words are all in.
  // Both belong to the layout they were measured on: a new page (or width) starts afresh, without an effect.
  const measures = useRef<{ laid: LaidPage | null; map: Map<string, WordMeasure> }>({ laid: null, map: new Map() });
  const [badge, setBadge] = useState<{ laid: LaidPage; text: string } | null>(null);
  const expectedWords = laid.rows.reduce((n, row) => n + (row.kind === 'text' ? row.items.filter((i) => i.kind === 'word').length : 0), 0);
  const measureWord = (line: number, index: number, item: LaidWord) => (measured: MeasuredLine, expectedBaseline: number) => {
    if (!diagnostics) return;
    if (measures.current.laid !== laid) measures.current = { laid, map: new Map() };
    const map = measures.current.map;
    map.set(`${line}:${index}`, { line, index, verseKey: item.verseKey, expectedWidth: item.width, x: item.x, measuredWidth: measured.width, measuredBaseline: measured.y + measured.ascender, expectedBaseline });
    if (map.size === expectedWords) {
      const report = summarise(laid.page, [...map.values()]);
      setBadge({ laid, text: describeReport(report) });
      diagnostics.onReport(report);
    }
  };
  const ayahTarget = useGuideTarget('ayah');
  const markerTarget = useGuideTarget('marker');
  const example = guideTargets ? guideExample(laid) : null;
  const opening = isOpeningPage(laid.page);
  const pitch = height / 15;
  // Pages 1–2: their own block, at the printed line spacing, centred on the page (as the QPC V1 reader).
  const rowPitch = opening ? Math.min(pitch, printedPitch ?? pitch) : pitch;
  const blockTop = opening ? (height - laid.lineCount * rowPitch) / 2 : 0;
  const rowTop = (line: number) => blockTop + (line - 1) * rowPitch;
  const band = Math.min(pitch, printedPitch ?? pitch) * 0.92;

  const onRowPress = (items: readonly LaidItem[]) => (event: GestureResponderEvent) => {
    const { x } = pressLocation(event);
    const boxes: WordBox[] = items.map((item) => ({ x: item.x, width: item.width, verseKey: item.verseKey, kind: item.kind === 'marker' ? 'end' : 'word' }));
    const hit = pressTargetAtLineX(boxes, x);
    if (!hit) return;
    const native = event.nativeEvent as { pageX?: number; pageY?: number };
    const at = Number.isFinite(native.pageX) && Number.isFinite(native.pageY) ? { x: native.pageX as number, y: native.pageY as number } : undefined;
    if (hit.onMarker && onPressMarker) onPressMarker(hit.verseKey, at);
    else onSelectVerse(hit.verseKey, at);
  };

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction ? (event) => onAccessibilityAction(event.nativeEvent.actionName) : undefined}
      testID="unicode-mushaf-text"
      style={{ width, height }}>
      {laid.rows.map((row) => {
        if (row.kind === 'heading') {
          const fontSize = laid.fontSize;
          return (
            <View key={`h${row.line}`} testID={`unicode-heading-${row.line}`} pointerEvents="none" style={[styles.row, styles.centre, { top: rowTop(row.line), height: rowPitch, width }]}>
              {opening ? (
                <SurahHeaderOrnament
                  testID={`unicode-header-ornament-${row.line}`}
                  compact
                  width={pageWidthOfText(width) * OPENING_CARTOUCHE.width}
                  height={rowPitch * OPENING_CARTOUCHE.height}
                  left={(width - pageWidthOfText(width) * OPENING_CARTOUCHE.width) / 2}
                  top={(rowPitch * (1 - OPENING_CARTOUCHE.height)) / 2}
                  nameWidth={fontSize * HEADING_SIZE * OPENING_NAME_MAX_EM}
                />
              ) : headingDecoration === 'traditional' ? (
                <SurahHeadingTraditional
                  testID={`unicode-header-ornament-${row.line}`}
                  width={(width + 2 * textSideInset(width)) * HEADING_ORNAMENT_SPAN}
                  height={rowPitch}
                  left={(width - (width + 2 * textSideInset(width)) * HEADING_ORNAMENT_SPAN) / 2}
                  top={0}
                  nameWidth={fontSize * HEADING_SIZE * HEADING_NAME_MAX_EM}
                />
              ) : (
                <SurahHeaderOrnament
                  testID={`unicode-header-ornament-${row.line}`}
                  width={(width + 2 * textSideInset(width)) * HEADING_ORNAMENT_SPAN}
                  height={rowPitch}
                  left={(width - (width + 2 * textSideInset(width)) * HEADING_ORNAMENT_SPAN) / 2}
                  top={0}
                  nameWidth={fontSize * HEADING_SIZE * HEADING_NAME_MAX_EM}
                />
              )}
              <Text allowFontScaling={false} style={[styles.heading, { color: headingColor ?? ink, fontFamily: headingFontFamily, fontSize: fontSize * HEADING_SIZE, lineHeight: fontSize * HEADING_SIZE * 1.8 }]}>
                {`سورة ${getSurahName(row.surah).nameArabic}`}
              </Text>
            </View>
          );
        }
        const fontSize = row.fontSize;
        const lineBox = (font.ascentEm + font.descentEm) * fontSize;
        const textTop = (rowPitch - lineBox) / 2;
        const baseline = textTop + font.ascentEm * fontSize;
        if (row.kind === 'basmala') {
          return (
            <View key={`b${row.line}`} testID={`unicode-basmala-${row.line}`} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.row, { top: rowTop(row.line), height: rowPitch, width }]}>
              <View style={{ position: 'absolute', top: textTop, left: 0, width, height: lineBox }}>
                {row.items.map((item) => <WordText key={item.group} item={item} fontSize={fontSize} font={font} ink={ink} runs={null} />)}
              </View>
            </View>
          );
        }
        const selected = selectedVerseKey ? row.items.filter((item) => item.verseKey === selectedVerseKey) : [];
        const span = selected.length
          ? (() => {
              const left = Math.max(-textSideInset(width), Math.min(...selected.map((i) => i.x)) - row.gap / 2);
              const right = Math.min(width + textSideInset(width), Math.max(...selected.map((i) => i.x + i.width)) + row.gap / 2);
              return { x: left, width: right - left };
            })()
          : null;
        return (
          <Pressable key={`t${row.line}`} testID={`unicode-line-${row.line}`} accessible={false} onPress={onRowPress(row.items)} style={[styles.row, { top: rowTop(row.line), height: rowPitch, width }]}>
            {span && (
              <View pointerEvents="none" testID={`unicode-highlight-${row.line}`} style={[styles.highlight, { backgroundColor: highlight.color, opacity: highlight.opacity, height: band, left: span.x, top: (rowPitch - band) / 2, width: span.width }]} />
            )}
            <View pointerEvents="none" style={{ position: 'absolute', top: textTop, left: 0, width, height: lineBox }}>
              {diagnostics && row.items.map((item, index) => <View key={`check-${index}`} style={[styles.checkBox, { left: item.x, width: item.width, top: 0, height: lineBox }]} />)}
              {diagnostics && <View style={[styles.checkBaseline, { top: font.ascentEm * fontSize, width }]} />}
              {row.items.map((item, index) => {
                const guideRef = example?.line === row.line ? (index === example.word ? ayahTarget : index === example.marker ? markerTarget : undefined) : undefined;
                if (item.kind === 'word') {
                  const runs = tajweed ? colourRuns(item, tajweed.spans(item.verseIndex), tajweed.palette) : null;
                  // The guide's example word: measured through an empty box over it, never by wrapping the word (a Text
                  // inside a box only as wide as the word loses its ink room on the web: numberOfLines caps its width).
                  return guideRef ? (
                    <View key={index} style={StyleSheet.absoluteFill} pointerEvents="none">
                      <View ref={guideRef} testID="unicode-guide-ayah" style={[styles.guideBox, { left: item.x, width: item.width, height: lineBox }]} />
                      <WordText item={item} fontSize={fontSize} font={font} ink={ink} runs={runs} onMeasure={diagnostics ? measureWord(row.line, index, item) : undefined} />
                    </View>
                  ) : (
                    <WordText key={index} item={item} fontSize={fontSize} font={font} ink={ink} runs={runs} onMeasure={diagnostics ? measureWord(row.line, index, item) : undefined} />
                  );
                }
                const marker = unicodeAyahMarker(item.verseKey, item.ayah);
                const gold = wirdMarker && item.verseKey === wirdAyahKey ? wirdMarker : null;
                const colors = gold ? gold.colors : markerColors;
                const medallionHeight = MEDALLION_HEIGHT_EM * fontSize;
                const medallionWidth = medallionHeight * MEDALLION_ASPECT;
                const box = { x: (item.width - medallionWidth) / 2, y: baseline - textTop - MEDALLION_RISE_EM * fontSize - medallionHeight / 2, width: medallionWidth, height: medallionHeight };
                return (
                  <View key={index} ref={guideRef} testID={gold ? 'unicode-wird-marker' : guideRef ? 'unicode-guide-marker' : `unicode-marker-${item.verseKey}`} style={[styles.guideBox, { left: item.x, width: item.width, height: lineBox }]}>
                    {marker && colors ? (
                      <AyahMarkerOrnament marker={marker} colors={colors} idSuffix={gold ? '-wird' : '-u'} box={box} />
                    ) : (
                      <Text allowFontScaling={false} style={{ color: gold?.glyph ?? ink, fontFamily: font.fontFamily, fontSize, lineHeight: lineBox, textAlign: 'center' }}>{`۝${item.ayah}`}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </Pressable>
        );
      })}
      {diagnostics && badge?.laid === laid && (
        <View pointerEvents="none" style={styles.checkBadge} testID="unicode-check-badge">
          <Text allowFontScaling={false} style={styles.checkBadgeText}>{badge.text}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    left: 0,
    position: 'absolute',
  },
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    // Android adds the font's own top/bottom padding (its bounding box beyond ascent and descent) unless told not to,
    // which would move the baseline away from iOS and the layout; the box already has room for every glyph.
    includeFontPadding: false,
    position: 'absolute',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  checkBox: {
    borderColor: CHECK_COLORS.slot,
    borderWidth: StyleSheet.hairlineWidth,
    position: 'absolute',
  },
  checkBaseline: {
    backgroundColor: CHECK_COLORS.baseline,
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: 'absolute',
  },
  checkBadge: {
    backgroundColor: CHECK_COLORS.badgeBackground,
    borderRadius: 4,
    left: 0,
    paddingHorizontal: 4,
    position: 'absolute',
    top: 0,
  },
  checkBadgeText: {
    color: CHECK_COLORS.badgeText,
    fontSize: 9,
  },
  guideBox: {
    position: 'absolute',
    top: 0,
  },
  highlight: {
    borderRadius: 3,
    position: 'absolute',
  },
  heading: {
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
