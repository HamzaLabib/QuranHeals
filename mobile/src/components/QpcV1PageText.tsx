import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';

import { AyahMarkerOrnament } from '@/components/AyahMarkerOrnament';
import { MUSHAF_PAPER } from '@/constants/mushafTheme';
import { MUSHAF_MARKER_STYLES, type MushafMarkerStyleId } from '@/mushaf/appearance';
import { cssBaseline, getAyahMarker, markerOverlayBox } from '@/mushaf/ayahMarkers';
import { pressLocation } from '@/mushaf/pressLocation';
import { ayahAtLineX, highlightSpan, type QpcV1PageLayout, type WordBox } from '@/mushaf/qpcV1Layout';

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
};

/** Size the hidden first pass is measured at. */
const MEASURE_SIZE = 100;
/** A hair under the measured fit, so rounding never pushes a glyph past the margin. */
const FIT = 0.985;

/**
 * The page's text in QPC V1: each word is its own glyph in the page's QCF
 * V1 font, in the original 15 lines and reading order (right to left).
 * Glyphs are never reshaped or reordered, and only take an ink colour.
 *
 * Ayah markers: with the 'qpc-glyph' style the font's marker glyph is
 * tinted green as one glyph. With a medallion style it stays in the line,
 * unchanged, so positions, justification and taps are the font's, but is
 * painted transparent, and the Quran SVG page's medallion for that ayah is
 * drawn over its ink (AyahMarkerOrnament). An ayah without artwork keeps
 * its glyph.
 *
 * Sizing: a hidden pass measures each line's natural width; the font size
 * makes the widest line fill the text area, and every line is justified
 * edge to edge like the print (space between words).
 */
export function QpcV1PageText({
  layout, width, height, selectedVerseKey, onSelectVerse, accessibilityLabel, accessibilityHint,
  markerStyle = 'qpc-glyph', ink = MUSHAF_PAPER.ink,
  highlight = { color: MUSHAF_PAPER.highlight, opacity: MUSHAF_PAPER.highlightOpacity },
}: QpcV1PageTextProps) {
  const lineCount = Math.max(15, layout.lines.length);
  const pitch = height / lineCount;
  const measured = useRef(new Map<number, number>());
  const [fontSize, setFontSize] = useState<number | null>(null);
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
    if (fontSize !== null && baseline > 0 && baseline < fontSize * 1.3 && baseline !== reportedBaseline) setReportedBaseline(baseline);
  };

  const onMeasureLine = (line: number) => (event: LayoutChangeEvent) => {
    measured.current.set(line, event.nativeEvent.layout.width);
    if (measured.current.size === layout.lines.length) {
      const widest = Math.max(...measured.current.values());
      if (widest > 0) setFontSize((MEASURE_SIZE * width * FIT) / widest);
    }
  };

  const onWordLayout = (line: number, index: number, verseKey: string) => (event: LayoutChangeEvent) => {
    const { x, width: wordWidth } = event.nativeEvent.layout;
    setBoxes((current) => ({ ...current, [line]: { ...current[line], [index]: { x, width: wordWidth, verseKey } } }));
  };

  const onLinePress = (line: number) => (event: GestureResponderEvent) => {
    const verseKey = ayahAtLineX(lineBoxes(line), pressLocation(event).x);
    if (verseKey) onSelectVerse(verseKey);
  };

  const glyphStyle = (size: number, kind: string) => ({
    color: kind === 'end' ? MUSHAF_PAPER.marker : ink,
    fontFamily: layout.fontFamily,
    fontSize: size,
    includeFontPadding: false,
    lineHeight: size * 1.3,
  });

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID="qpc-v1-text"
      style={{ height, width }}>
      {/* Hidden measuring pass at a fixed size. */}
      {fontSize === null && (
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
        const span = selectedVerseKey ? highlightSpan(lineBoxes(line.line), selectedVerseKey) : null;
        return (
          <Pressable
            key={line.line}
            testID={`qpc-line-${line.line}`}
            accessible={false}
            onPress={onLinePress(line.line)}
            style={[styles.line, { height: pitch, top: (line.line - 1) * pitch, width }]}>
            {span && (
              <View
                pointerEvents="none"
                testID={`qpc-highlight-${line.line}`}
                style={[styles.highlight, { backgroundColor: highlight.color, opacity: highlight.opacity, height: pitch * 0.92, left: span.x, top: pitch * 0.04, width: span.width }]}
              />
            )}
            {line.words.map((word, index) => {
              const marker = markerFor(word.kind, word.verseKey);
              const boxWidth = boxes[line.line]?.[index]?.width;
              const baseline = reportedBaseline ?? cssBaseline(fontSize, fontSize * 1.3);
              return (
                // pointerEvents none: taps land on the line, so the press location is line-relative.
                <View key={index} pointerEvents="none" onLayout={onWordLayout(line.line, index, word.verseKey)}>
                  <Text
                    allowFontScaling={false}
                    onTextLayout={marker ? onMarkerTextLayout : undefined}
                    style={[glyphStyle(fontSize, word.kind), marker && styles.hiddenGlyph]}>
                    {word.glyph}
                  </Text>
                  {marker && markerColors && boxWidth !== undefined && (
                    <AyahMarkerOrnament marker={marker} colors={markerColors} box={markerOverlayBox(marker, fontSize, baseline, boxWidth)} />
                  )}
                </View>
              );
            })}
          </Pressable>
        );
      })}
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
});
