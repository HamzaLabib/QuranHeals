import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';

import { AyahMarkerOrnament } from '@/components/AyahMarkerOrnament';
import { MUSHAF_PAPER } from '@/constants/mushafTheme';
import { MUSHAF_MARKER_STYLES, type MushafMarkerStyleId } from '@/mushaf/appearance';
import { cssBaseline, getAyahMarker, markerOverlayBox, QCF_V1_INK_OVERFLOW_EM, QCF_V1_INK_ROOM_V_EM, QCF_V1_LINE_BOX_EM, qcfV1AndroidRowShiftEm, qcfV1DrawnLineShiftEm } from '@/mushaf/ayahMarkers';
import { textSideInset } from '@/mushaf/pageGeometry';
import { pressLocation } from '@/mushaf/pressLocation';
import { ayahAtLineX, lineAtY, selectionSpan, type QpcV1PageLayout, type WordBox } from '@/mushaf/qpcV1Layout';
import { withSelectionInk } from '@/mushaf/qpcV1Selection';
import { BASMALA_GLYPHS, isOpeningPage, surahOpeningSlots } from '@/mushaf/surahOpenings';
import { getSurahName } from '@/services/surahNames';

type QpcV1PageTextProps = {
  layout: QpcV1PageLayout;
  /** Width and height of the page's text area (mushaf/pageGeometry.ts). */
  width: number;
  height: number;
  selectedVerseKey: string | null;
  onSelectVerse: (verseKey: string) => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  /** How ayah-end markers are drawn (mushaf/appearance.ts); the font's own glyph by default. */
  markerStyle?: MushafMarkerStyleId;
  /** Quran ink colour (mushaf/appearance.ts MUSHAF_INKS). */
  ink?: string;
  /** Selected-ayah highlight (MUSHAF_PAGE_FURNITURE). */
  highlight?: { color: string; opacity: number };
  /** The printed page's line pitch, when lines are spaced wider (Mobile-Optimized): the highlight keeps the printed band height. */
  printedPitch?: number;
  /**
   * Normal Mode: each drawn glyph's box grows by this much above and below its line (em;
   * QCF_V1_NORMAL_BOX_MARGIN_EM), as padding around an unchanged line box — so no glyph moves. 0 in Full-Screen.
   */
  boxMarginEm?: number;
  /** The QCF V1 family holding the Basmala's glyphs (page 1's font), once loaded; without it the Basmala lines stay empty. */
  basmalaFontFamily?: string | null;
  /** Font and colour for a Surah heading's name (the running heads' font). */
  headingFontFamily?: string;
  headingColor?: string;
};

/** Android draws each glyph through an unclipped copy (see androidInk). */
const ANDROID = Platform.OS === 'android';

/** Size the hidden first pass is measured at. */
const MEASURE_SIZE = 100;
/** A hair under the measured fit, so rounding never pushes a glyph past the margin. */
const FIT = 0.985;
/**
 * Pages 1–2: the regular pages' letter size, as a fraction of the text width
 * (the median over pages 3–604, which range 0.065–0.073). Fitting their
 * short lines to the full width made them 1.5× too large.
 */
const OPENING_PAGE_SIZE_PER_WIDTH = 0.0692;
/** Between words on a centred line: the median justified gap on regular pages (the glyphs carry their own spacing). */
const WORD_GAP_EM = 0.033;
/** A Surah heading's name, relative to the Quran text size. */
const HEADING_SIZE = 0.78;

/**
 * The page's text in QPC V1: each word is its own glyph in the page's QCF
 * V1 font, in the original 15 lines and reading order (right to left).
 * Glyphs are never reshaped or reordered, and only take an ink colour.
 *
 * Ayah markers: with the 'qpc-glyph' style the font's marker glyph is
 * tinted green as one glyph. With a medallion style it stays in the line,
 * unchanged, so positions, justification and taps are the font's, but is
 * painted transparent, and the Quran SVG medallion with that ayah's number
 * is drawn over its ring (AyahMarkerOrnament), on every page alike.
 *
 * Sizing: a hidden pass measures each line's natural width; the font size
 * makes the widest line fill the text area, and every line is justified
 * edge to edge like the print (space between words).
 *
 * Pages 1–2 (mushaf/surahOpenings.ts): the regular letter size, each line
 * centred, the block (heading, Basmala, lines) centred on the page — not
 * low in the 15-line grid, where Quran Foundation's layout numbers them.
 *
 * Surah openings: the empty heading and Basmala lines are drawn — the
 * Basmala in QPC V1's own glyphs (page 1's font), the heading as the
 * Surah's name in the running heads' font. The print's ornamental heading
 * frame is not drawn: no licensed source for it yet.
 */
export function QpcV1PageText({
  layout, width, height, selectedVerseKey, onSelectVerse, accessibilityLabel, accessibilityHint,
  markerStyle = 'qpc-glyph', ink = MUSHAF_PAPER.ink,
  highlight = { color: MUSHAF_PAPER.highlight, opacity: MUSHAF_PAPER.highlightOpacity },
  printedPitch,
  boxMarginEm = 0,
  basmalaFontFamily = null,
  headingFontFamily,
  headingColor,
}: QpcV1PageTextProps) {
  const lineCount = Math.max(15, layout.lines.length);
  const pitch = height / lineCount;
  const opening = isOpeningPage(layout.page);
  const slots = surahOpeningSlots(layout);
  // Pages 1–2: their own composition, not the 15-line grid. The rows from the first heading to the last line
  // keep the printed line spacing (also in a Taller frame, where only the frame grows) and are centred on the page.
  const rowPitch = opening ? Math.min(pitch, printedPitch ?? pitch) : pitch;
  const used = [...layout.lines.map((line) => line.line), ...slots.map((slot) => slot.line)];
  const blockTop = opening && used.length ? (height - (Math.max(...used) - Math.min(...used) + 1) * rowPitch) / 2 - (Math.min(...used) - 1) * rowPitch : 0;
  const rowTop = (line: number) => blockTop + (line - 1) * rowPitch;
  // The highlight band: 92% of the line pitch, as printed — no taller when the lines are spaced wider.
  const band = Math.min(pitch, printedPitch ?? pitch) * 0.92;
  const measured = useRef(new Map<number, number>());
  const [measuredSize, setFontSize] = useState<number | null>(null);
  // Pages 1–2 take the regular size (no measuring: their lines are short by design).
  const fontSize = opening ? width * OPENING_PAGE_SIZE_PER_WIDTH : measuredSize;
  // Rendered word positions per line (from onLayout); highlights and taps use them.
  const [boxes, setBoxes] = useState<Record<number, Record<number, WordBox>>>({});
  const lineBoxes = (line: number) => Object.values(boxes[line] ?? {});
  const markerColors = MUSHAF_MARKER_STYLES[markerStyle].colors;
  const markerFor = (kind: string, verseKey: string) => (markerColors && kind === 'end' ? getAyahMarker(layout.page, verseKey) : null);
  // The marker glyph's baseline in its line box: reported by iOS and Android
  // (onTextLayout), computed from the font's metrics on the web.
  const [reportedBaseline, setReportedBaseline] = useState<number | null>(null);
  const onMarkerTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const first = event.nativeEvent.lines[0];
    const baseline = first ? first.y + first.ascender : Number.NaN;
    if (fontSize !== null && baseline > 0 && baseline < fontSize * QCF_V1_LINE_BOX_EM && baseline !== reportedBaseline) setReportedBaseline(baseline);
  };

  const onMeasureLine = (line: number) => (event: LayoutChangeEvent) => {
    measured.current.set(line, event.nativeEvent.layout.width);
    if (measured.current.size === layout.lines.length) {
      const widest = Math.max(...measured.current.values());
      if (widest > 0) setFontSize((MEASURE_SIZE * width * FIT) / widest);
    }
  };

  // Selection geometry follows the words as drawn: the rows are where the layout puts the lines, the platform may
  // draw the glyphs lower in them (qcfV1DrawnLineShiftEm: iOS). The highlight band and the taps use the drawn line;
  // horizontally, the words' rendered boxes plus their ink (withSelectionInk: generated data; medallions: their box).
  const drawnShift = fontSize === null ? 0 : qcfV1DrawnLineShiftEm(layout.page, Platform.OS) * fontSize;
  // Android: the Quran rows themselves move to where the iPhone draws the lines (qcfV1AndroidRowShiftEm); the Basmala
  // is in page 1's font. Headings (Amiri) keep their rows. 0 on iOS and the web.
  const quranRowShift = fontSize === null ? 0 : qcfV1AndroidRowShiftEm(layout.page, Platform.OS) * fontSize;
  const basmalaRowShift = fontSize === null ? 0 : qcfV1AndroidRowShiftEm(1, Platform.OS) * fontSize;
  const quranRowTop = (line: number) => rowTop(line) + quranRowShift;
  const drawnCentre = (line: number) => quranRowTop(line) + rowPitch / 2 + drawnShift;
  const onWordLayout = (line: number, index: number, verseKey: string) => (event: LayoutChangeEvent) => {
    const { x, width: wordWidth } = event.nativeEvent.layout;
    setBoxes((current) => ({ ...current, [line]: { ...current[line], [index]: { x, width: wordWidth, verseKey } } }));
  };
  /** A line's rendered word boxes with each word's ink past its box (a medallion: its own box). */
  const selectionBoxes = (line: QpcV1PageLayout['lines'][number]): WordBox[] => Object.entries(boxes[line.line] ?? {}).map(([index, box]) => {
    const word = line.words[Number(index)];
    return word && fontSize !== null ? withSelectionInk(box, layout.page, word, fontSize, markerFor(word.kind, word.verseKey)) : box;
  });

  const onLinePress = (line: number) => (event: GestureResponderEvent) => {
    const { x, y } = pressLocation(event);
    const target = lineAtY(line, quranRowTop(line) + y, layout.lines.map((l) => l.line), drawnCentre);
    const verseKey = ayahAtLineX(lineBoxes(target), x);
    if (verseKey) onSelectVerse(verseKey);
  };

  const glyphStyle = (size: number, kind: string) => ({
    color: kind === 'end' ? MUSHAF_PAPER.marker : ink,
    fontFamily: layout.fontFamily,
    fontSize: size,
    includeFontPadding: false,
    // The font's whole line: no part of any glyph may fall outside its Text (see QCF_V1_LINE_BOX_EM).
    lineHeight: size * QCF_V1_LINE_BOX_EM,
  });
  // Drawn glyphs: room for ink outside the advance (QCF_V1_INK_OVERFLOW_EM) and the line box (QCF_V1_INK_ROOM_V_EM),
  // margin and padding cancelling, so the glyph does not move. In Normal Mode the box itself is also taller: boxMarginEm
  // of uncancelled padding above and below, so the word's container grows symmetrically around its unchanged line box
  // (centred in the row, the baseline stays put). Not for the measuring pass, nor vertically for a hidden marker
  // glyph (its reported baseline places the medallion).
  const inkRoom = (size: number, vertical = true) => ({
    marginHorizontal: -size * QCF_V1_INK_OVERFLOW_EM,
    paddingHorizontal: size * QCF_V1_INK_OVERFLOW_EM,
    ...(vertical && { marginVertical: -size * QCF_V1_INK_ROOM_V_EM, paddingVertical: size * (QCF_V1_INK_ROOM_V_EM + boxMarginEm) }),
  });

  // Android: TextView.onDraw clips the canvas horizontally to its content box, inside the padding (AOSP TextView.java,
  // onDraw: clipLeft = compoundPaddingLeft, clipRight = width − compoundPaddingRight; top and bottom are not clipped
  // when unscrolled), and React Native 0.86 draws <Text> with it (ReactTextView; the non-clipping prepared-layout
  // renderer is off by default). So inkRoom's horizontal padding draws nothing there: the in-flow Text stays (its
  // advance, line box and layout unchanged) but transparent, and this copy draws the glyph from a content box that
  // itself spans the advance ± QCF_V1_INK_OVERFLOW_EM (no horizontal padding), centred — the same place, unclipped.
  // Vertically the same room as inkRoom. Not touchable, not read by screen readers. iOS draws as before.
  const androidInk = (size: number, style: object, glyph: string) => (
    <Text
      allowFontScaling={false}
      accessible={false}
      importantForAccessibility="no"
      numberOfLines={1}
      style={[style, {
        position: 'absolute',
        left: -size * QCF_V1_INK_OVERFLOW_EM,
        right: -size * QCF_V1_INK_OVERFLOW_EM,
        top: -size * QCF_V1_INK_ROOM_V_EM,
        bottom: -size * QCF_V1_INK_ROOM_V_EM,
        paddingVertical: size * (QCF_V1_INK_ROOM_V_EM + boxMarginEm),
        textAlign: 'center',
      }]}>
      {glyph}
    </Text>
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID="qpc-v1-text"
      style={{ height, width }}>
      {/* Hidden measuring pass at a fixed size. */}
      {fontSize === null && !opening && (
        <View pointerEvents="none" style={styles.measure} importantForAccessibility="no-hide-descendants">
          {layout.lines.map((line) => (
            <View key={line.line} testID={`qpc-measure-${line.line}`} onLayout={onMeasureLine(line.line)} style={styles.measureLine}>
              {line.words.map((word, index) => (
                <Text key={index} allowFontScaling={false} style={glyphStyle(MEASURE_SIZE, word.kind)}>{word.glyph}</Text>
              ))}
            </View>
          ))}
        </View>
      )}

      {fontSize !== null && layout.lines.map((line) => {
        const span = selectedVerseKey ? selectionSpan(selectionBoxes(line), selectedVerseKey, textSideInset(width)) : null;
        return (
          <Pressable
            key={line.line}
            testID={`qpc-line-${line.line}`}
            accessible={false}
            onPress={onLinePress(line.line)}
            style={[styles.line, opening && { columnGap: fontSize * WORD_GAP_EM, justifyContent: 'center' }, { height: rowPitch, top: quranRowTop(line.line), width }]}>
            {span && (
              <View
                pointerEvents="none"
                testID={`qpc-highlight-${line.line}`}
                style={[styles.highlight, { backgroundColor: highlight.color, opacity: highlight.opacity, height: band, left: span.x, top: (rowPitch - band) / 2 + drawnShift, width: span.width }]}
              />
            )}
            {line.words.map((word, index) => {
              const marker = markerFor(word.kind, word.verseKey);
              const baseline = reportedBaseline ?? cssBaseline(fontSize, fontSize * QCF_V1_LINE_BOX_EM);
              return (
                // pointerEvents none: taps land on the line, so the press location is line-relative.
                <View key={index} pointerEvents="none" onLayout={onWordLayout(line.line, index, word.verseKey)}>
                  <Text
                    allowFontScaling={false}
                    onTextLayout={marker ? onMarkerTextLayout : undefined}
                    style={[glyphStyle(fontSize, word.kind), inkRoom(fontSize, !marker), (marker || ANDROID) && styles.hiddenGlyph]}>
                    {word.glyph}
                  </Text>
                  {ANDROID && !marker && androidInk(fontSize, glyphStyle(fontSize, word.kind), word.glyph)}
                  {marker && markerColors && (
                    <AyahMarkerOrnament marker={marker} colors={markerColors} box={markerOverlayBox(marker, fontSize, baseline)} />
                  )}
                </View>
              );
            })}
          </Pressable>
        );
      })}

      {fontSize !== null && slots.map((slot) => (
        slot.kind === 'basmala' ? (
          basmalaFontFamily ? (
            <View
              key={`basmala-${slot.line}`}
              testID={`qpc-basmala-${slot.line}`}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.line, { columnGap: fontSize * WORD_GAP_EM, justifyContent: 'center', height: rowPitch, top: rowTop(slot.line) + basmalaRowShift, width }]}>
              {BASMALA_GLYPHS.map((glyph) => (ANDROID ? (
                <View key={glyph}>
                  <Text allowFontScaling={false} style={[glyphStyle(fontSize, 'word'), inkRoom(fontSize), { fontFamily: basmalaFontFamily }, styles.hiddenGlyph]}>{glyph}</Text>
                  {androidInk(fontSize, [glyphStyle(fontSize, 'word'), { fontFamily: basmalaFontFamily }], glyph)}
                </View>
              ) : (
                <Text key={glyph} allowFontScaling={false} style={[glyphStyle(fontSize, 'word'), inkRoom(fontSize), { fontFamily: basmalaFontFamily }]}>{glyph}</Text>
              )))}
            </View>
          ) : null
        ) : (
          <View
            key={`heading-${slot.line}`}
            testID={`qpc-heading-${slot.line}`}
            pointerEvents="none"
            style={[styles.line, { justifyContent: 'center', height: rowPitch, top: rowTop(slot.line), width }]}>
            <Text
              allowFontScaling={false}
              style={[styles.heading, { color: headingColor ?? ink, fontFamily: headingFontFamily, fontSize: fontSize * HEADING_SIZE, lineHeight: fontSize * HEADING_SIZE * 1.8 }]}>
              {`سورة ${getSurahName(slot.surah).nameArabic}`}
            </Text>
          </View>
        )
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Kept in the line for its exact advance; not painted.
  hiddenGlyph: {
    color: 'transparent',
  },
  measure: {
    left: -10000,
    opacity: 0,
    position: 'absolute',
    top: 0,
  },
  measureLine: {
    alignSelf: 'flex-start',
    flexDirection: 'row-reverse',
  },
  // Right-to-left: the first word of each line is at its right edge.
  line: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    left: 0,
    position: 'absolute',
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
