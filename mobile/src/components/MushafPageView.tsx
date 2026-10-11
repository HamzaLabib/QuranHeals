import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MushafBorder } from '@/components/MushafBorder';
import { MUSHAF_PAPER } from '@/constants/mushafTheme';
import { MUSHAF_BACKGROUNDS, MUSHAF_APPEARANCE_DEFAULT } from '@/mushaf/appearance';
import type { BorderInk } from '@/mushaf/borderPattern';
import { juzOfAyah, juzTitle, toArabicIndicDigits } from '@/mushaf/mushafPage';
import { computePageLayout, type Box } from '@/mushaf/pageGeometry';
import { getSurahName } from '@/services/surahNames';

type MushafPageViewProps = {
  pageNumber: number;
  /** The page's first ayah, for the surah and juz' headers. */
  firstAyah: { surah: number; ayah: number };
  /** Width of the printed page; the frame spans it. */
  width: number;
  /** The page's text, drawn inside the measured text area (either renderer). */
  renderText: (textArea: Box) => ReactNode;
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
}: MushafPageViewProps) {
  const layout = computePageLayout(width);
  const surahTitle = `سورة ${getSurahName(firstAyah.surah).nameArabic}`;
  const juz = juzTitle(juzOfAyah(firstAyah.surah, firstAyah.ayah));
  // Amiri is set without synthetic bold (it is the Bold face); the system fallback keeps its weight.
  const headerFont = headerFontFamily ? { fontFamily: headerFontFamily, fontWeight: 'normal' as const } : null;
  const headerText = [styles.headerText, { color: headerColor, fontSize: layout.headerFontSize, lineHeight: layout.header.height }, headerFont];

  return (
    // The page background is this one opaque fill; everything else is transparent over it.
    <View testID="mushaf-paper" style={[styles.paper, { backgroundColor: paperColor, height: layout.page.height, width: layout.page.width }]}>
      {/* Fixed physical layout, as printed: juz' on the right, surah on the left. */}
      <View style={[styles.headerRow, { height: layout.header.height }]}>
        <Text allowFontScaling={false} style={headerText}>{surahTitle}</Text>
        <Text allowFontScaling={false} style={headerText}>{juz}</Text>
      </View>

      {/* Decorative: no touches (taps reach the text above it), hidden from screen readers. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.absolute, { height: layout.frame.height, left: layout.frame.x, top: layout.frame.y, width: layout.frame.width }]}>
        <MushafBorder width={layout.frame.width} height={layout.frame.height} inks={borderInks} />
      </View>

      <View
        testID="mushaf-text-area"
        style={[styles.absolute, { height: layout.text.height, left: layout.text.x, top: layout.text.y, width: layout.text.width }]}>
        {renderText({ x: 0, y: 0, width: layout.text.width, height: layout.text.height })}
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
