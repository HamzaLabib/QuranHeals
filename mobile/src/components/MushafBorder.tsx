import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';

import { BORDER_INK_ORDER, BORDER_INKS, buildBorderPattern, type BorderInk } from '@/mushaf/borderPattern';
import { BORDER_TILES_ACROSS, BORDER_TILES_DOWN } from '@/mushaf/pageGeometry';

// Built once per frame height, scaled by the viewBox (one unit = one tile, always square).
const PATTERNS = new Map<number, ReturnType<typeof buildBorderPattern>>();
function patternFor(down: number) {
  let pattern = PATTERNS.get(down);
  if (!pattern) {
    pattern = buildBorderPattern(BORDER_TILES_ACROSS, down);
    PATTERNS.set(down, pattern);
  }
  return pattern;
}
const EVEN_ODD = new Set(['rule', 'cream']);

type MushafBorderProps = {
  width: number;
  height: number;
  /** The border's colours (mushaf/appearance.ts MUSHAF_BORDER_STYLES); the approved ones by default. Pattern and geometry never change. */
  inks?: Readonly<Record<BorderInk, string>>;
  /** Tiles down each side: the printed 29, or more in the Mobile-Optimized experiment (the same tiles, repeated). */
  down?: number;
};

/**
 * The page frame: the reference print's double brown rule and tiled
 * border (mushaf/borderPattern.ts), one vector path per ink. Purely
 * decorative: MushafPageView wraps it in a view that takes no touches and
 * is hidden from accessibility.
 */
export const MushafBorder = memo(function MushafBorder({ width, height, inks = BORDER_INKS, down = BORDER_TILES_DOWN }: MushafBorderProps) {
  const PATTERN = patternFor(down);
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
