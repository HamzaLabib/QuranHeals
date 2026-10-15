import Svg, { Path, Rect } from 'react-native-svg';

type MushafIconProps = { size?: number; color?: string; strokeWidth?: number };

/**
 * The app's one Mushaf icon: an open Mushaf — two pages bowing gently toward the spine, each with a framed text panel
 * like the Mushaf's bordered page, with two short lines of text in it. An original drawing (inspired by a traditional open-Quran icon, not copied from
 * one), on lucide's 24 × 24 grid with round joins, so it sits with the other icons and takes the same size, colour and
 * stroke width. The panels are drawn a little finer (65% of the stroke) and the text lines finer still (45%) so they
 * stay clear at small sizes; two lines, not three, so the panels don't crowd at 18 pt. Used wherever an icon means the
 * Mushaf or a message from it: the Mushaf tab, Home's Continue Reciting button and A Message from the Quran, a ورد's
 * Continue, and Back to Mushaf after a Khatma. Every stroke stays inside the grid (x 2.5–21.5, y 3.4–20.6, plus half a stroke).
 */
export function MushafIcon({ size = 24, color = 'currentColor', strokeWidth = 2 }: MushafIconProps) {
  const panel = strokeWidth * 0.65;
  const line = strokeWidth * 0.45;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* The open pages: their top edges bowing down to the spine, the bottom edges rising from it. */}
      <Path d="M12 7.4Q7.4 3.4 2.5 5.1v13.7q4.9-1.3 9.5 1.8 4.6-3.1 9.5-1.8V5.1Q16.6 3.4 12 7.4z" />
      {/* The spine. */}
      <Path d="M12 7.4v13.2" />
      {/* Each page's framed text panel. */}
      <Rect x={5.1} y={8.3} width={4.3} height={7.4} rx={0.9} strokeWidth={panel} />
      <Rect x={14.6} y={8.3} width={4.3} height={7.4} rx={0.9} strokeWidth={panel} />
      {/* Two lines of text in each panel, centred in it. */}
      <Path d="M6.3 10.9h1.9M6.3 13.1h1.9M15.8 10.9h1.9M15.8 13.1h1.9" strokeWidth={line} />
    </Svg>
  );
}
