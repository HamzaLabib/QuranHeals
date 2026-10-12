import Svg, { G, Path } from 'react-native-svg';

type ReflectionBulbIconProps = {
  /** Lit: the same bulb with short rays around it (an ayah is selected). */
  lit: boolean;
  color: string;
  /** The bulb's own size, as for the other lucide icons (the rays reach a little beyond it). */
  size?: number;
  /** Matches the other lucide toolbar icons (2 at 24 px). */
  strokeWidth?: number;
};

/**
 * The Mushaf reader's Reflection icon: lucide's `lightbulb` outline at the
 * same size and stroke as its neighbours, in a slightly larger box that
 * leaves room for the rays of the lit state. Both states share that box and
 * that bulb, so the toolbar never shifts; only the rays and the colour
 * change. No fill, glow or animation.
 */
export function ReflectionBulbIcon({ lit, color, size = 22, strokeWidth = 2 }: ReflectionBulbIconProps) {
  const box = size / BULB_SCALE;
  return (
    <Svg
      testID={lit ? 'reflection-bulb-lit' : 'reflection-bulb-unlit'}
      width={box}
      height={box}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round">
      {/* lucide `lightbulb`, scaled about (12, 12) and moved down: drawn exactly `size` across, at lucide's stroke. */}
      <G transform={`translate(12 ${12 + BULB_SHIFT}) scale(${BULB_SCALE}) translate(-12 -12)`} strokeWidth={strokeWidth}>
        <Path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
        <Path d="M9 18h6" />
        <Path d="M10 22h4" />
      </G>
      {lit && <Path testID="reflection-bulb-rays" d={RAYS} strokeWidth={strokeWidth * BULB_SCALE} />}
    </Svg>
  );
}

const BULB_SCALE = 0.74;
/** Down a little, so the bulb lines up with its neighbours and the top ray still fits. */
const BULB_SHIFT = 1;
/** Five short rays 2 units clear of the glass (its centre lands at 12, 10.04): up, both diagonals, both sides. */
const RAYS = 'M12 3.6V1.4 M16.6 5.4l1.5-1.5 M7.4 5.4 5.9 3.9 M18.6 10h2.2 M5.4 10H3.2';
