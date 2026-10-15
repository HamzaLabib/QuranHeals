import Svg, { Path } from 'react-native-svg';

type HandsHeartIconProps = {
  size?: number;
  /** The solid heart (fill and edge). */
  heartColor: string;
  /** The hands' outline. */
  handsColor: string;
  /** The hands' stroke (the heart is solid). */
  strokeWidth?: number;
};

/**
 * The How I Feel tab's icon (approved Option 1, clean and minimal): a solid red heart centred above two open, upturned
 * hands, each a rounded olive outline (wrist, palm, fingers pointing up) with its thumb angled in under the heart, and
 * nothing filled behind them. Its two colours come from the palette (howIFeelHeart, howIFeelHands; a lighter sage in
 * Dark Mode for contrast), so it keeps them whether or not its tab is selected; the tab's label shows that. Drawn on
 * lucide's 24 × 24 grid with round joins, like the other tab icons, and drawn for that size: strokes of about 2 pt and
 * a heart big enough to read on a phone. Every stroke stays inside the grid (x 3–21 and y 2.6–21.5, plus half a
 * stroke), so nothing is clipped.
 */
export function HandsHeartIcon({ size = 24, heartColor, handsColor, strokeWidth = 1.8 }: HandsHeartIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* The heart, solid, centred above the hands. */}
      <Path
        testID="hands-heart-heart"
        d="M12 11.2c-.3-.2-4.6-2.7-4.6-5.8 0-1.6 1.2-2.8 2.6-2.8.9 0 1.6.5 2 1.1.4-.6 1.1-1.1 2-1.1 1.4 0 2.6 1.2 2.6 2.8 0 3.1-4.3 5.6-4.6 5.8z"
        fill={heartColor}
        stroke={heartColor}
        strokeWidth={0.8}
      />
      {/* Left hand: the wrist, the outer edge up to the fingertips, the palm curving back down to the wrist; then the thumb. */}
      <Path d="M5.6 21.5v-1.8c-1.6-1.3-2.6-3.4-2.6-5.7V9.6a1 1 0 0 1 2 0V13c.9.3 2 1 2.8 1.8 1.1.8 1.8 2.1 1.8 3.6v3.1" stroke={handsColor} strokeWidth={strokeWidth} />
      <Path d="M7.4 14.6l2.4-2.4" stroke={handsColor} strokeWidth={strokeWidth} />
      {/* Right hand: the mirror. */}
      <Path d="M18.4 21.5v-1.8c1.6-1.3 2.6-3.4 2.6-5.7V9.6a1 1 0 0 0-2 0V13c-.9.3-2 1-2.8 1.8-1.1.8-1.8 2.1-1.8 3.6v3.1" stroke={handsColor} strokeWidth={strokeWidth} />
      <Path d="M16.6 14.6l-2.4-2.4" stroke={handsColor} strokeWidth={strokeWidth} />
    </Svg>
  );
}
