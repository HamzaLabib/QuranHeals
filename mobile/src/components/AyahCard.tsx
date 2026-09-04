import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import type { Ayah } from '@/types/domain';

type AyahCardProps = {
  ayah: Ayah;
  compact?: boolean;
};

export function AyahCard({ ayah, compact = false }: AyahCardProps) {
  return (
    <View style={[styles.card, compact && styles.compactCard]}>
      <Text style={[styles.arabic, compact && styles.compactArabic]}>{ayah.arabicText}</Text>
      <Text style={[styles.translation, compact && styles.compactTranslation]}>
        {ayah.englishTranslation}
      </Text>
      <View style={styles.referenceRow}>
        <Text style={styles.reference}>
          {ayah.surahNameEnglish} • {ayah.surahNumber}:{ayah.ayahNumber}
        </Text>
        <Text style={styles.source}>{ayah.translationSource}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    ...shadows.soft,
  },
  compactCard: {
    borderRadius: radii.md,
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  arabic: {
    color: colors.ink,
    fontSize: typography.arabic,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 54,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  compactArabic: {
    fontSize: 25,
    lineHeight: 41,
  },
  translation: {
    color: colors.ink,
    fontSize: typography.bodyLarge,
    lineHeight: 28,
  },
  compactTranslation: {
    fontSize: typography.body,
    lineHeight: 24,
  },
  referenceRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.xs,
    paddingTop: spacing.md,
  },
  reference: {
    color: colors.olive,
    fontSize: typography.body,
    fontWeight: '800',
  },
  source: {
    color: colors.softText,
    fontSize: 11,
    lineHeight: 16,
  },
});

