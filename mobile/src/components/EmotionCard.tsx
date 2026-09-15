import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { getDirectionStyle } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import type { Emotion } from '@/types/domain';
import { EMOTION_ICON_FALLBACK, EMOTION_ICONS } from '@/utils/emotionIcons';
import { resolveEmotionDisplayName } from '@/utils/emotionLabel';

type EmotionCardProps = {
  emotion: Emotion;
  onPress: () => void;
};

export function EmotionCard({ emotion, onPress }: EmotionCardProps) {
  const { locale } = useAppLocale();
  const Icon = EMOTION_ICONS[emotion.icon] ?? EMOTION_ICON_FALLBACK;
  // Only the selected locale's name is ever shown — never English+Arabic
  // together, and never the description (data-ready only, not rendered).
  const displayName = resolveEmotionDisplayName(emotion, locale);
  const direction = getDirectionStyle(locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={displayName}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.iconWrap}>
        <Icon color={colors.olive} size={22} strokeWidth={2} />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.name, direction]}>{displayName}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: '47.5%',
    flexGrow: 1,
    gap: spacing.md,
    minHeight: 166,
    padding: spacing.md,
    ...shadows.soft,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.oliveWash,
    borderRadius: radii.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  textWrap: {
    gap: 4,
  },
  name: {
    color: colors.ink,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
    letterSpacing: 0,
  },
});

