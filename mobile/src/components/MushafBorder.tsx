import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';

import { BORDER_INK_ORDER, BORDER_INKS, buildBorderPattern, type BorderInk } from '@/mushaf/borderPattern';
import { BORDER_TILES_ACROSS, BORDER_TILES_DOWN } from '@/mushaf/pageGeometry';

// Static: built once, scaled by the viewBox (one unit = one tile).
const PATTERN = buildBorderPattern(BORDER_TILES_ACROSS, BORDER_TILES_DOWN);
const EVEN_ODD = new Set(['rule', 'cream']);

type MushafBorderProps = {
  width: number;
  height: number;
  /** The border's colours (mushaf/appearance.ts MUSHAF_BORDER_STYLES); the approved ones by default. Pattern and geometry never change. */
  inks?: Readonly<Record<BorderInk, string>>;
};

/**
 * The page frame: the reference print's double brown rule and tiled
 * border (mushaf/borderPattern.ts), one vector path per ink. Purely
 * decorative: MushafPageView wraps it in a view that takes no touches and
 * is hidden from accessibility.
 */
export const MushafBorder = memo(function MushafBorder({ width, height, inks = BORDER_INKS }: MushafBorderProps) {
  return (
    <Svg
      testID="mushaf-frame"
      width={width}
      height={height}
      viewBox={`0 0 ${PATTERN.across} ${PATTERN.down}`}>
      {BORDER_INK_ORDER.map((ink) => (
        <Path key={ink} d={PATTERN.paths[ink]} fill={inks[ink]} fillRule={EVEN_ODD.has(ink) ? 'evenodd' : 'nonzero'} />
      ))}
    </Svg>
  );
});
