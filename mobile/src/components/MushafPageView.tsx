import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MushafBorder } from '@/components/MushafBorder';
import { OpeningPageOrnament } from '@/components/OpeningPageOrnament';
import { MUSHAF_PAPER } from '@/constants/mushafTheme';
import { MUSHAF_BACKGROUNDS, MUSHAF_APPEARANCE_DEFAULT } from '@/mushaf/appearance';
import type { BorderInk } from '@/mushaf/borderPattern';
import { juzOfAyah, juzTitle, toArabicIndicDigits } from '@/mushaf/mushafPage';
import { computePageLayout, MUSHAF_TEXT_LIFT_PT, type Box } from '@/mushaf/pageGeometry';
import { getSurahName } from '@/services/surahNames';

/** The Hizb label's size, relative to the running heads (modest: it never outweighs the Surah and juz'). */
const HIZB_LABEL_SIZE = 0.85;
/**
 * How far in from the page's edges the Surah and juz' heads sit, each on its own side: one border tile
 * (the band's width, page width ÷ 20), so their outer edges line up with the frame's inner rule below them
 * at every page size. (A fixed 7 pt left them over the band itself, still reading as flush with the edge.)
 * The header's height, font and the page below are unchanged. Pages 1–2 (the approved opening design) keep their
 * heads as approved.
 */
export const headerSideInset = (layout: { tile: number }) => layout.tile;

type MushafPageViewProps = {
  pageNumber: number;
  /** The page's first ayah, for the surah and juz' headers. */
  firstAyah: { surah: number; ayah: number };
  /** Width of the printed page; the frame spans it. */
  width: number;
  /**
   * The page's text, drawn inside the measured text area (either renderer).
   * `printedLinePitch`: the printed page's line spacing at this width (the
   * same as the text area's unless the frame is taller).
   */
  renderText: (textArea: Box, info: { printedLinePitch: number }) => ReactNode;
  /** The frame's height in tiles: the printed 29 by default; more only in the Mobile-Optimized experiment. */
  tilesDown?: number;
  /** The Hizb / quarter-Hizb starting on this page (hizbLabelsForPage), centred in the header, in Normal and Full-Screen. */
  hizbLabels?: readonly string[];
  /** Pages 1–2 in the QPC V1 fonts: the ornamental circle and corner ornaments inside the frame (OpeningPageOrnament). */
  openingOrnament?: boolean;
  /** Font for the running heads and page number once loaded (system font until then). */
  headerFontFamily?: string;
  /** Paper colour: a background preset from mushaf/appearance.ts (the approved Warm Cream by default). */
  paperColor?: string;
  /** Surah and juz heads and the page number (MUSHAF_PAGE_FURNITURE). */
  headerColor?: string;
  /** The border's colours (MUSHAF_BORDER_STYLES); the approved ones by default. */
  borderInks?: Readonly<Record<BorderInk, string>>;
};

/**
 * One printed page laid out with the reference print's measured geometry
 * (mushaf/pageGeometry.ts): juz' and surah headers flush with the frame,
 * the tiled border between two brown rules (MushafBorder), the text area,
 * the page number below. The text itself comes from a renderer — QPC V1
 * glyph lines (QpcV1PageText) or the Quran SVG page (MushafSvgText). The
 * border is drawn first and takes no touches, so it never covers a tap.
 */
export function MushafPageView({
  pageNumber, firstAyah, width, renderText, headerFontFamily,
  paperColor = MUSHAF_BACKGROUNDS[MUSHAF_APPEARANCE_DEFAULT.background].paper,
  headerColor = MUSHAF_PAPER.header,
  borderInks,
  tilesDown,
  hizbLabels,
  openingOrnament = false,
}: MushafPageViewProps) {
  const layout = computePageLayout(width, tilesDown);
  const printedLinePitch = tilesDown === undefined ? layout.linePitch : computePageLayout(width).linePitch;
  const surahTitle = `سورة ${getSurahName(firstAyah.surah).nameArabic}`;
  const juz = juzTitle(juzOfAyah(firstAyah.surah, firstAyah.ayah));
  // Amiri is set without synthetic bold (it is the Bold face); the system fallback keeps its weight.
  const headerFont = headerFontFamily ? { fontFamily: headerFontFamily, fontWeight: 'normal' as const } : null;
  const headerText = [styles.headerText, { color: headerColor, fontSize: layout.headerFontSize, lineHeight: layout.header.height }, headerFont];

  return (
    // The page background is this one opaque fill; everything else is transparent over it.
    <View testID="mushaf-paper" style={[styles.paper, { backgroundColor: paperColor, height: layout.page.height, width: layout.page.width }]}>
      {/* Fixed physical layout, as printed: juz' on the right, surah on the left. */}
      <View
        testID="mushaf-header"
        style={[styles.headerRow, { height: layout.header.height, paddingHorizontal: openingOrnament ? 0 : headerSideInset(layout) }, hizbLabels && hizbLabels.length > 0 && styles.headerBaseline]}>
        <Text testID="mushaf-header-surah" allowFontScaling={false} style={[headerText, styles.headerSide]}>{surahTitle}</Text>
        {/* Only on a page where a Hizb or one of its quarters starts: centred between the two, a little smaller. */}
        {hizbLabels && hizbLabels.length > 0 && (
          <Text
            testID="mushaf-hizb-label"
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[headerText, styles.hizbLabel, { fontSize: layout.headerFontSize * HIZB_LABEL_SIZE }]}>
            {hizbLabels.join('، ')}
          </Text>
        )}
        <Text testID="mushaf-header-juz" allowFontScaling={false} style={[headerText, styles.headerSide]}>{juz}</Text>
      </View>

      {/* Decorative: no touches (taps reach the text above it), hidden from screen readers. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.absolute, { height: layout.frame.height, left: layout.frame.x, top: layout.frame.y, width: layout.frame.width }]}>
        <MushafBorder width={layout.frame.width} height={layout.frame.height} inks={borderInks} down={tilesDown} />
        {openingOrnament && <OpeningPageOrnament testID="mushaf-opening-ornament" width={layout.frame.width} height={layout.frame.height} left={0} top={0} />}
      </View>

      {/* The Quran text, MUSHAF_TEXT_LIFT_PT above the printed text area (a temporary, uniform adjustment). */}
      <View
        testID="mushaf-text-area"
        style={[styles.absolute, { height: layout.text.height, left: layout.text.x, top: layout.text.y - MUSHAF_TEXT_LIFT_PT, width: layout.text.width }]}>
        {renderText({ x: 0, y: 0, width: layout.text.width, height: layout.text.height }, { printedLinePitch })}
      </View>

      <Text
        allowFontScaling={false}
        style={[styles.absolute, styles.pageNumber, headerFont, { color: headerColor }, {
          fontSize: layout.pageNumberFontSize,
          height: layout.pageNumber.height,
          left: 0,
          lineHeight: layout.pageNumber.height,
          top: layout.pageNumber.y,
          width: layout.page.width,
        }]}>
        {toArabicIndicDigits(pageNumber)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  paper: {
    alignSelf: 'center',
  },
  absolute: {
    position: 'absolute',
  },
  headerRow: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  headerSide: {
    flexShrink: 0,
  },
  // With a Hizb label: its smaller text on the same baseline as the Surah and juz', as on a printed line.
  headerBaseline: {
    alignItems: 'baseline',
  },
  // Between the Surah and the juz', in the space they leave; centred in it.
  hizbLabel: {
    flex: 1,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  headerText: {
    fontWeight: '700',
    writingDirection: 'rtl',
  },
  pageNumber: {
    color: MUSHAF_PAPER.header,
    fontWeight: '600',
    textAlign: 'center',
  },
});
