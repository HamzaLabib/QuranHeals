import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/constants/theme';
import { isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranFontSizePreference } from '@/localization/useQuranFontSizePreference';

// Visual height (38) is intentionally below the 44px minimum touch target —
// HIT_SLOP pads the tappable area back out to >=44x44 without inflating the
// compact segmented-control chrome itself.
const HIT_SLOP = { top: 6, bottom: 6, left: 8, right: 8 };

/**
 * Compact A−/Auto/A+ controls for the user's preferred Quran text size (see
 * quranFontSizePreference.ts). Deliberately rendered only on the main ayah
 * screen (AyahCard passes `compact={false}`/omits it) — Favorites reads the
 * same shared preference automatically via useQuranFontSizePreference and
 * does not get a second set of controls. Styled as one small, centered,
 * content-width segmented control so it never competes visually with the
 * Quran Arabic above it.
 */
export function QuranFontSizeControls() {
  const { locale, messages } = useAppLocale();
  const { canDecrease, canIncrease, decrease, increase, reset } = useQuranFontSizePreference();
  const isRtl = isRtlLocale(locale);

  return (
    <View style={[styles.group, isRtl && styles.groupRtl]}>
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
        accessibilityLabel={messages.quranFontSize.autoLabel}
        hitSlop={HIT_SLOP}
        onPress={reset}
        style={({ pressed }) => [styles.segment, pressed && styles.pressed]}>
        <Text style={styles.autoText}>{messages.quranFontSize.auto}</Text>
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
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    paddingHorizontal: 10,
  },
  groupRtl: {
    flexDirection: 'row-reverse',
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
  autoText: {
    color: colors.olive,
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
