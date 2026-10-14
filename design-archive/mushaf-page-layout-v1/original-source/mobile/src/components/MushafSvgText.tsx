import { memo } from 'react';
import { Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';
import Svg, { Path, SvgXml } from 'react-native-svg';

import { MUSHAF_PAPER } from '@/constants/mushafTheme';
import { ayahAtPoint, toPageCoordinates, type MushafPage } from '@/mushaf/mushafPage';
import { fitInside, type Box } from '@/mushaf/pageGeometry';
import { pressLocation } from '@/mushaf/pressLocation';

type MushafSvgTextProps = {
  page: MushafPage;
  /** The page SVG with its ayah medallions tinted (tintAyahMarkers). */
  svg: string;
  /** The page's text area. */
  area: Box;
  selectedVerseKey: string | null;
  onSelectVerse: (verseKey: string) => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  /** Selected-ayah highlight (MUSHAF_PAGE_FURNITURE). */
  highlight?: { color: string; opacity: number };
};

/**
 * The fallback renderer: the Quran SVG page (quran-ws/quran-svg v1.1.1,
 * newer KFQC typesetting), unmodified except for the medallion tint, fitted
 * into the text area. A tap is mapped to page coordinates and resolved
 * through the page's ayah polygons (ayahAtPoint).
 */
export function MushafSvgText({
  page, svg, area, selectedVerseKey, onSelectVerse, accessibilityLabel, accessibilityHint,
  highlight = { color: MUSHAF_PAPER.highlight, opacity: MUSHAF_PAPER.highlightOpacity },
}: MushafSvgTextProps) {
  const box = fitInside(area, page.viewBox.height / page.viewBox.width);
  const selected = page.ayahs.find((ayah) => ayah.verseKey === selectedVerseKey) ?? null;
  const viewBox = `${page.viewBox.x} ${page.viewBox.y} ${page.viewBox.width} ${page.viewBox.height}`;

  const onPress = (event: GestureResponderEvent) => {
    const tap = pressLocation(event);
    const point = toPageCoordinates(page, box.width, box.height, tap.x, tap.y);
    const ayah = ayahAtPoint(page, point.x, point.y);
    if (ayah) onSelectVerse(ayah.verseKey);
  };

  return (
    <Pressable
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={[styles.absolute, { height: box.height, left: box.x, top: box.y, width: box.width }]}>
      <PageArtwork svg={svg} width={box.width} height={box.height} />
      {selected && (
        <Svg
          pointerEvents="none"
          testID="mushaf-selection"
          width={box.width}
          height={box.height}
          viewBox={viewBox}
          style={StyleSheet.absoluteFill}>
          <Path d={selected.path} fill={highlight.color} fillOpacity={highlight.opacity} />
        </Svg>
      )}
    </Pressable>
  );
}

/** The ~0.6 MB page artwork only re-parses when the SVG itself changes, never on selection. */
const PageArtwork = memo(function PageArtwork({ svg, width, height }: { svg: string; width: number; height: number }) {
  return <SvgXml xml={svg} width={width} height={height} pointerEvents="none" />;
});

const styles = StyleSheet.create({
  absolute: {
    position: 'absolute',
  },
});
