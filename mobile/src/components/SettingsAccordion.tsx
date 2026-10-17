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
  /**
   * A small control of its own right beside the title and summary (Favorite Reciter's download icon), with the dropdown
   * chevron after it at the row's end: outside the header button, so the control keeps its own label and action. The
   * title and summary, and the chevron, still open and close the section (independent touch targets).
   */
  accessory?: ReactNode;
};

const CHEVRON_DURATION_MS = 200;

/**
 * One collapsible Settings card. Purely presentational: which section is
 * open is owned by the Settings screen (only one at a time), and toggling
 * only changes that local state — it never reads or writes a preference.
 * The whole header is one accessible button that announces its expanded
 * state and, when collapsed, the current selection.
 */
export function SettingsAccordion({ title, summary, expanded, onToggle, direction, isRtl, children, accessory }: SettingsAccordionProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  // State, not a ref, so it is safe to read during render (as in StateView).
  const [rotation] = useState(() => new Animated.Value(expanded ? 1 : 0));

  useEffect(() => {
    Animated.timing(rotation, { toValue: expanded ? 1 : 0, duration: CHEVRON_DURATION_MS, useNativeDriver: true }).start();
  }, [expanded, rotation]);

  const chevronRotation = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  const chevron = (
    <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
      <ChevronDown size={20} color={colors.textSecondary} />
    </Animated.View>
  );

  const header = (
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
        {/* Decorative: the header's label and expanded state cover it for screen readers. With an accessory, it moves after it (below). */}
        {!accessory && chevron}
      </Pressable>
  );

  return (
    <View style={styles.card}>
      {accessory ? (
        <View style={[styles.headerRow, isRtl && styles.headerRtl]}>
          <View style={styles.headerFill}>{header}</View>
          <View style={styles.accessory}>{accessory}</View>
          {/* The chevron at the row's end: a tap opens or closes the section, as the header does (which already announces it to screen readers). */}
          <Pressable
            testID="settings-accordion-chevron"
            accessible={false}
            importantForAccessibility="no"
            onPress={onToggle}
            style={({ pressed }) => [styles.chevronButton, isRtl ? styles.chevronButtonRtl : null, pressed && styles.pressed]}>
            {chevron}
          </Pressable>
        </View>
      ) : header}
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
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  headerFill: {
    flex: 1,
  },
  /** Right beside the title and summary. */
  accessory: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The chevron at the row's end, with the header's own end padding. */
  chevronButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
  },
  chevronButtonRtl: {
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
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
