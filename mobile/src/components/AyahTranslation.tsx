import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { useThemedStyles } from '@/theme/useTheme';

type AyahTranslationProps = {
  text: string;
  source: string;
  showTranslation: boolean;
  showToggleControl: boolean;
  /** Labels the toggle; already chosen by the caller (Show translation / Hide translation). */
  toggleLabel: string;
  onToggle: () => void;
  /** Saved Ayahs / My Reflections size (smaller than the ayah screen's). */
  compact?: boolean;
  /** My Reflections' list: the translation clamped to a few lines and a small text toggle, so the reflection stays prominent. */
  preview?: boolean;
  /** Overrides the theme (the reflection window opened from the Mushaf uses the reader's colours). */
  styles?: AyahTranslationStyles;
};

/**
 * The English translation under an ayah's Arabic, its attribution, and the Show / Hide translation toggle — the
 * markup Saved Ayahs' AyahCard renders, shared with My Reflections. What is visible is decided by the caller with
 * resolveAyahTranslationDisplay (localization/quranTranslationPreference.ts); this only draws it. Returns two
 * siblings (no wrapper) so it sits in the parent's own spacing exactly as before.
 */
export function AyahTranslation({ text, source, showTranslation, showToggleControl, toggleLabel, onToggle, compact = false, preview = false, styles: override }: AyahTranslationProps) {
  const themed = useThemedStyles(makeAyahTranslationStyles);
  const styles = override ?? themed;
  return (
    <>
      {showTranslation && (
        <View style={styles.translationBlock}>
          <Text numberOfLines={preview ? 2 : undefined} style={[styles.translation, compact && styles.compactTranslation, preview && styles.previewTranslation]}>
            {text}
          </Text>
          <Text style={styles.source}>{source}</Text>
        </View>
      )}

      {showToggleControl && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={toggleLabel}
          onPress={onToggle}
          hitSlop={preview ? 12 : undefined}
          style={({ pressed }) => [preview ? styles.previewToggle : styles.revealButton, pressed && styles.pressed]}>
          <Text style={preview ? styles.previewToggleText : styles.revealButtonText}>{toggleLabel}</Text>
        </Pressable>
      )}
    </>
  );
}

export type AyahTranslationStyles = ReturnType<typeof makeAyahTranslationStyles>;

export const makeAyahTranslationStyles = (colors: Palette) => StyleSheet.create({
  translationBlock: {
    gap: spacing.xs,
  },
  translation: {
    color: colors.textPrimary,
    fontSize: typography.bodyLarge,
    lineHeight: 28,
  },
  compactTranslation: {
    fontSize: typography.body,
    lineHeight: 24,
  },
  previewTranslation: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  source: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  revealButton: {
    alignItems: 'center',
    backgroundColor: colors.secondaryButtonSurface,
    borderColor: colors.secondaryButtonBorder,
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  revealButtonText: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
  previewToggle: {
    alignSelf: 'flex-start',
  },
  previewToggleText: {
    color: colors.accent,
    fontSize: typography.small,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
