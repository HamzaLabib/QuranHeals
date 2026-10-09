import { ChevronDown } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };

type SettingsAccordionProps = {
  title: string;
  /** The currently selected option, shown under the title; omitted for sections with no single selection (Legal & Privacy). */
  summary?: string;
  expanded: boolean;
  onToggle: () => void;
  direction: Direction;
  isRtl: boolean;
  children: ReactNode;
};

const CHEVRON_DURATION_MS = 200;

/**
 * One collapsible Settings card. Purely presentational: which section is
 * open is owned by the Settings screen (only one at a time), and toggling
 * only changes that local state — it never reads or writes a preference.
 * The whole header is one accessible button that announces its expanded
 * state and, when collapsed, the current selection.
 */
export function SettingsAccordion({ title, summary, expanded, onToggle, direction, isRtl, children }: SettingsAccordionProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  // State, not a ref, so it is safe to read during render (as in StateView).
  const [rotation] = useState(() => new Animated.Value(expanded ? 1 : 0));

  useEffect(() => {
    Animated.timing(rotation, { toValue: expanded ? 1 : 0, duration: CHEVRON_DURATION_MS, useNativeDriver: true }).start();
  }, [expanded, rotation]);

  const chevronRotation = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary ? `${title}, ${summary}` : title}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.header, isRtl && styles.headerRtl, pressed && styles.pressed]}>
        <View style={styles.headerText}>
          <Text style={[styles.title, direction]}>{title}</Text>
          {summary !== undefined && <Text style={[styles.summary, direction]}>{summary}</Text>}
        </View>
        {/* Decorative: the header's label and expanded state cover it for screen readers. */}
        <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
          <ChevronDown size={20} color={colors.textSecondary} />
        </Animated.View>
      </Pressable>
      {expanded && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.soft,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerRtl: {
    flexDirection: 'row-reverse',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  summary: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '600',
    lineHeight: 18,
  },
  body: {
    borderTopColor: colors.divider,
    borderTopWidth: 1,
  },
  pressed: {
    opacity: 0.78,
  },
});
