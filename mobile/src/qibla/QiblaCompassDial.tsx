import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg';

import { usePalette } from '@/theme/useTheme';

import type { HeadingFrame } from './qiblaCompassController';
import { DIAL_ANIMATION_MS, DIAL_CENTER, DIAL_TICKS, DIAL_VIEWBOX, dialPoint } from './qiblaDialGeometry';

type Props = {
  size: number;
  /** The Qibla bearing, degrees clockwise from true north. */
  bearing: number;
  needle: 'hidden' | 'dimmed' | 'full';
  aligned: boolean;
  /** Subscribes to every heading reading (useQiblaCompass().onFrame); returns the unsubscribe function. */
  subscribe: (listener: (frame: HeadingFrame) => void) => () => void;
  cardinals: [string, string, string, string];
  accessibilityLabel: string;
};

/** The compass card turns by -heading: its N points to true north, its needle (drawn at the bearing) to the Qibla. */
const C = DIAL_CENTER;

/**
 * The Qibla compass (docs/qibla.md, "Screen"). Geometry is fixed left to right (`direction: 'ltr'`): an Arabic layout
 * mirrors the text around it, never the compass. When the reading cannot be used (needle hidden) the card shows no
 * letters, so a still dial never suggests where north is.
 */
export function QiblaCompassDial({ size, bearing, needle, aligned, subscribe, cardinals, accessibilityLabel }: Props) {
  const colors = usePalette();
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);

  useEffect(
    () =>
      subscribe((frame) => {
        rotation.value = reduceMotion ? frame.dialRotation : withTiming(frame.dialRotation, { duration: DIAL_ANIMATION_MS, easing: Easing.linear });
      }),
    [subscribe, reduceMotion, rotation],
  );

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  const live = needle !== 'hidden';
  const needleColor = needle === 'full' ? colors.accent : colors.textSecondary;
  const ringColor = aligned ? colors.accent : colors.border;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID="qibla-dial"
      style={[styles.box, { width: size, height: size }]}>
      <Animated.View style={[StyleSheet.absoluteFill, cardStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${DIAL_VIEWBOX} ${DIAL_VIEWBOX}`}>
          <Circle cx={C} cy={C} r={92} fill={colors.card} stroke={ringColor} strokeWidth={aligned ? 3 : 1.5} />
          {DIAL_TICKS.map(([angle, inner]) => {
            const [x1, y1] = dialPoint(angle, inner);
            const [x2, y2] = dialPoint(angle, 90);
            return <Line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.textMuted} strokeWidth={angle % 30 === 0 ? 1.6 : 0.8} opacity={live ? 1 : 0.35} />;
          })}
          {live &&
            cardinals.map((letter, i) => {
              const [x, y] = dialPoint(i * 90, 66);
              return (
                <SvgText
                  key={letter}
                  x={x}
                  y={y + 6}
                  fontSize={17}
                  fontWeight="700"
                  textAnchor="middle"
                  // The letters turn with the card, as on a hand compass; N in the warning colour.
                  fill={i === 0 ? colors.danger : colors.textSecondary}>
                  {letter}
                </SvgText>
              );
            })}
          {live && (
            <G rotation={bearing} origin={`${C}, ${C}`} opacity={needle === 'full' ? 1 : 0.55}>
              {/* The needle: its point toward the Qibla, its tail muted. */}
              <Polygon points={`${C},24 ${C + 9},${C} ${C - 9},${C}`} fill={needleColor} />
              <Polygon points={`${C + 9},${C} ${C},${C + 46} ${C - 9},${C}`} fill={colors.textMuted} opacity={0.5} />
            </G>
          )}
          <Circle cx={C} cy={C} r={6} fill={colors.textPrimary} />
        </Svg>
      </Animated.View>
      {/* The top of the phone: fixed, outside the turning card. */}
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={size} height={size} viewBox={`0 0 ${DIAL_VIEWBOX} ${DIAL_VIEWBOX}`}>
        <Polygon points={`${C},1 ${C - 7},13 ${C + 7},13`} fill={aligned ? colors.accent : colors.textPrimary} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // Never mirrored by an Arabic layout (the web has no `direction` style; RTL there comes from the text only).
  box: { alignSelf: 'center', ...(Platform.OS === 'web' ? {} : { direction: 'ltr' as const }) },
});
