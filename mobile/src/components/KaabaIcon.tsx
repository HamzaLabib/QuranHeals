import Svg, { Polygon } from 'react-native-svg';

import { usePalette, useThemeName } from '@/theme/useTheme';

import {
  KAABA_COLORS,
  KAABA_ICON_VIEWBOX,
  KAABA_OUTLINE_WIDTH,
  KAABA_SHAPES,
  KAABA_SILHOUETTE,
  kaabaOutlineColor,
  toPointsAttribute,
} from './kaabaIconGeometry';

type KaabaIconProps = { size?: number };

/**
 * The Kaaba, black and gold (drawing: kaabaIconGeometry.ts). The thin outline follows the theme (owner-approved
 * 2026-11-06): the palette's textSecondary in Light, gold in Dark, so the black cube never disappears into the dark
 * button. Decorative: the button it sits in carries the label, so screen readers skip it. Home's Qibla Direction
 * button only; the compass uses a needle.
 */
export function KaabaIcon({ size = 22 }: KaabaIconProps) {
  const theme = useThemeName();
  const palette = usePalette();
  return (
    <Svg width={size} height={size} viewBox={KAABA_ICON_VIEWBOX} accessible={false} importantForAccessibility="no-hide-descendants">
      {KAABA_SHAPES.map((shape) => (
        <Polygon key={shape.id} points={toPointsAttribute(shape.points)} fill={KAABA_COLORS[shape.fill]} />
      ))}
      <Polygon
        points={toPointsAttribute(KAABA_SILHOUETTE)}
        fill="none"
        stroke={kaabaOutlineColor(theme, palette)}
        strokeWidth={KAABA_OUTLINE_WIDTH}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
