import { ChevronDown, ChevronUp, Heart } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette, useThemedStyles, useThemeName } from '@/theme/useTheme';

type AyahConnectionAccordionProps = {
  /** This emotion–ayah mapping's text for the active locale (see utils/ayahConnection.ts). Callers render nothing when there is none. */
  text: string;
  /** Changes on every newly shown ayah ("Another Ayah"), collapsing the section again. */
  resetKey: string | number;
};

/**
 * "How this ayah connects": a calm, collapsed-by-default explanation of why
 * this ayah was chosen for the selected feeling. Explanatory, not an action:
 * a sage surface with a small filled olive heart beside a centered title —
 * never the Favorite button's circular toggle. Expands inline; the whole
 * header row toggles.
 */
export function AyahConnectionAccordion({ text, resetKey }: AyahConnectionAccordionProps) {
  const { locale, messages } = useAppLocale();
  const colors = usePalette();
  const theme = useThemeName();
  const styles = useThemedStyles(makeStyles);
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const [expanded, setExpanded] = useState(false);
  const [trackedResetKey, setTrackedResetKey] = useState(resetKey);

  // Light mode reads clearly against the very-light sage surface with the
  // app's existing dark-green primary text; dark mode keeps the original
  // muted textSecondary (unchanged) — see constants/theme.ts for the actual
  // sage surface/border/heart values themselves.
  const chevronColor = theme === 'light' ? colors.textPrimary : colors.textSecondary;

  // A newly shown ayah always starts collapsed. Adjusting state during
  // render (as AyahCard does) avoids a visible expanded frame.
  if (trackedResetKey !== resetKey) {
    setTrackedResetKey(resetKey);
    setExpanded(false);
  }

  const Chevron = expanded ? ChevronUp : ChevronDown;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={messages.ayah.connectionHeading}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        {/* Decorative: the Pressable's label covers the whole row, so the icons
            add nothing for screen readers. No `accessible` prop on SVG icons —
            react-native-web would forward it to the DOM as an invalid attribute.

            True centering: the header reserves the same CHEVRON_SLOT on both
            sides and centers the heart + title group in between; the chevron
            is absolutely positioned inside one of those slots, so it never
            shifts the group. RTL only mirrors the group's order (heart at the
            start of the Arabic title) and which side the chevron sits on. */}
        <View style={[styles.titleGroup, isRtl && styles.titleGroupRtl]}>
          <Heart size={ICON_SIZE} color={colors.sageHeart} fill={colors.sageHeart} strokeWidth={2} />
          <Text style={[styles.heading, { writingDirection: direction.writingDirection }]}>{messages.ayah.connectionHeading}</Text>
        </View>
        <View style={[styles.chevron, isRtl ? styles.chevronRtl : styles.chevronLtr]}>
          <Chevron size={ICON_SIZE} color={chevronColor} />
        </View>
      </Pressable>
      {expanded && <Text style={[styles.body, direction]}>{text}</Text>}
    </View>
  );
}

const ICON_SIZE = 18;
/** Room kept free on EACH side of the centered title group: chevron inset + chevron + breathing space. */
const CHEVRON_SLOT = spacing.md + ICON_SIZE + spacing.sm;

const makeStyles = (colors: Palette) => StyleSheet.create({
  container: {
    backgroundColor: colors.sageSurface,
    borderColor: colors.sageBorder,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  header: {
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: CHEVRON_SLOT,
    paddingVertical: spacing.sm,
  },
  titleGroup: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  titleGroupRtl: {
    flexDirection: 'row-reverse',
  },
  heading: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  chevron: {
    bottom: 0,
    justifyContent: 'center',
    pointerEvents: 'none', // taps pass through to the header Pressable
    position: 'absolute',
    top: 0,
  },
  chevronLtr: {
    right: spacing.md,
  },
  chevronRtl: {
    left: spacing.md,
  },
  body: {
    color: colors.textPrimary,
    fontSize: typography.body,
    lineHeight: 24,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.78,
  },
});
