import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/constants/theme';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranFontSizePreference } from '@/localization/useQuranFontSizePreference';

// Visual height (38) is intentionally below the 44px minimum touch target —
// HIT_SLOP pads the tappable area back out to >=44x44 without inflating the
// compact segmented-control chrome itself.
const HIT_SLOP = { top: 6, bottom: 6, left: 8, right: 8 };

/**
 * A−/A+ controls for the user's preferred Quran text size (see
 * quranFontSizePreference.ts). No "Auto" button — it only ever reset
 * `preferredSize` to the default, which isn't a distinct automatic mode, so
 * it was removed rather than kept as a misleading label. Rendered inside
 * AyahCard's shared controls row (left side; the copy-ayah action occupies
 * the right side) — deliberately never reversed for RTL locales (Arabic/
 * Egyptian Arabic): A− always precedes A+ in every app language, matching
 * the fixed physical layout the controls row as a whole preserves.
 */
export function QuranFontSizeControls() {
  const { messages } = useAppLocale();
  const { canDecrease, canIncrease, decrease, increase } = useQuranFontSizePreference();

  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={messages.quranFontSize.decreaseLabel}
        accessibilityState={{ disabled: !canDecrease }}
        disabled={!canDecrease}
        hitSlop={HIT_SLOP}
        onPress={decrease}
        style={({ pressed }) => [styles.segment, !canDecrease && styles.segmentDisabled, pressed && styles.pressed]}>
        <Text style={[styles.segmentText, !canDecrease && styles.segmentTextDisabled]}>A−</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={messages.quranFontSize.increaseLabel}
        accessibilityState={{ disabled: !canIncrease }}
        disabled={!canIncrease}
        hitSlop={HIT_SLOP}
        onPress={increase}
        style={({ pressed }) => [styles.segment, !canIncrease && styles.segmentDisabled, pressed && styles.pressed]}>
        <Text style={[styles.segmentText, !canIncrease && styles.segmentTextDisabled]}>A+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    paddingHorizontal: 10,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentDisabled: {
    opacity: 0.4,
  },
  segmentText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  segmentTextDisabled: {
    color: colors.muted,
  },
  pressed: {
    opacity: 0.78,
  },
});
