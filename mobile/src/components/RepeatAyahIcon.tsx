import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { RepeatSetting } from '@/audio/engine';
import { localDigits } from '@/audio/format';

type Props = { repeat: RepeatSetting; rtl: boolean; activeColor: string; inactiveColor: string; size?: number };

/**
 * Repeat Ayah's icon: two arcs chasing each other round a loop, each ending in an arrowhead, with the setting written
 * inside the loop (1, 2, 3 or ∞; Arabic digits in Arabic). Off: the loop alone, in the muted colour. Vector strokes
 * only (no image asset), drawn the same in every language: a loop has no reading direction.
 */
export function RepeatAyahIcon({ repeat, rtl, activeColor, inactiveColor, size = 30 }: Props) {
  const active = repeat !== 0;
  const color = active ? activeColor : inactiveColor;
  const label = repeat === 'infinite' ? '∞' : repeat === 0 ? '' : localDigits(repeat, rtl);
  return (
    <View testID="audio-repeat-icon" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 32 32">
        {/* Upper arc, clockwise from the left, arrowhead down-right; the lower arc is its half-turn copy. */}
        <Path d="M5 16 A11 11 0 0 1 25.6 11.3" stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <Path d="M22.2 9.4 L25.6 11.3 L26.2 7.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d="M27 16 A11 11 0 0 1 6.4 20.7" stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <Path d="M9.8 22.6 L6.4 20.7 L5.8 24.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
      {label !== '' && (
        <View style={styles.center} pointerEvents="none">
          <Text testID="audio-repeat-count" allowFontScaling={false} style={[styles.count, { color, fontSize: repeat === 'infinite' ? size * 0.42 : size * 0.36 }]}>
            {label}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  count: {
    fontWeight: '800',
    includeFontPadding: false,
    textAlign: 'center',
  },
});
