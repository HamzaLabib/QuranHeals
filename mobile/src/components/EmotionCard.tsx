import {
  Activity,
  BatteryLow,
  Circle,
  CloudRain,
  Compass,
  Flame,
  Gauge,
  Heart,
  HelpCircle,
  Leaf,
  type LucideIcon,
  Moon,
  ShieldAlert,
  Sunrise,
} from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import type { Emotion } from '@/types/domain';

const icons: Record<string, LucideIcon> = {
  activity: Activity,
  'battery-low': BatteryLow,
  'cloud-rain': CloudRain,
  compass: Compass,
  flame: Flame,
  gauge: Gauge,
  heart: Heart,
  'help-circle': HelpCircle,
  leaf: Leaf,
  moon: Moon,
  'shield-alert': ShieldAlert,
  sunrise: Sunrise,
};

type EmotionCardProps = {
  emotion: Emotion;
  onPress: () => void;
};

export function EmotionCard({ emotion, onPress }: EmotionCardProps) {
  const Icon = icons[emotion.icon] ?? Circle;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${emotion.name}. ${emotion.description}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.iconWrap}>
        <Icon color={colors.olive} size={22} strokeWidth={2} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.name}>{emotion.name}</Text>
        <Text style={styles.arabicName}>{emotion.arabicName}</Text>
        <Text style={styles.description}>{emotion.description}</Text>
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
  arabicName: {
    color: colors.olive,
    fontSize: typography.body,
    fontWeight: '600',
    textAlign: 'left',
    writingDirection: 'rtl',
  },
  description: {
    color: colors.muted,
    fontSize: typography.caption,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
});

