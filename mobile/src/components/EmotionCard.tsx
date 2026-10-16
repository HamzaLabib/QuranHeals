import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, shadows, spacing, type Palette } from '@/constants/theme';
import { gridCardBasis } from '@/layout/windowClass';
import { useEmotionLocale } from '@/localization/useEmotionsLanguage';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import type { Emotion } from '@/types/domain';
import { EMOTION_ICON_FALLBACK, EMOTION_ICONS } from '@/utils/emotionIcons';
import { resolveEmotionDisplayName } from '@/utils/emotionLabel';

type EmotionCardProps = {
  emotion: Emotion;
  onPress: () => void;
  /** Home's four cards: the same card, slightly shorter. The full list (/emotions) uses the original size. */
  compact?: boolean;
  /** Cards per row: 2 on phones (the original grid, unchanged), 3 or 4 on tablets (layout/windowClass.ts). */
  columns?: number;
};

export function EmotionCard({ emotion, onPress, compact = false, columns = 2 }: EmotionCardProps) {
  // Emotion names follow the Emotions Language (لغة المشاعر), not the App Language.
  const { emotionLocale, emotionDirection, emotionRtl } = useEmotionLocale();
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const Icon = EMOTION_ICONS[emotion.icon] ?? EMOTION_ICON_FALLBACK;
  // Only the selected locale's name is ever shown — never English+Arabic
  // together, and never the description (data-ready only, not rendered).
  const displayName = resolveEmotionDisplayName(emotion, emotionLocale);
  const direction = emotionDirection;
  // The icon+name are stacked in a column, so RTL mirroring means aligning
  // that stack to the end (right) edge instead of the start (left) one —
  // writingDirection alone (already applied to the text below) doesn't
  // reposition sibling layout.
  const alignEnd = emotionRtl;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={displayName}
      onPress={onPress}
      style={({ pressed }) => [styles.card, columns !== 2 && { flexBasis: gridCardBasis(columns) }, compact && styles.cardCompact, alignEnd && styles.cardRtl, pressed && styles.pressed]}>
      <View style={styles.iconWrap}>
        <Icon color={colors.accent} size={22} strokeWidth={2} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.name, direction]}>{displayName}</Text>
      </View>
    </Pressable>
  );
}

/**
 * An empty cell completing a tablet grid's last row (gridFillerCount), so the last cards keep the width of the others
 * instead of growing to fill the row. Invisible and not focusable; never used in the phone grid.
 */
export function EmotionGridFiller({ columns }: { columns: number }) {
  return <View accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ flexBasis: gridCardBasis(columns), flexGrow: 1 }} />;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  card: {
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: '47.5%',
    flexGrow: 1,
    gap: spacing.md,
    minHeight: 144,
    padding: spacing.md,
    ...shadows.soft,
  },
  cardCompact: {
    gap: spacing.sm,
    minHeight: 112,
  },
  cardRtl: {
    alignItems: 'flex-end',
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: radii.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  textWrap: {
    gap: 4,
    width: '100%',
  },
  name: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 23,
  },
});

