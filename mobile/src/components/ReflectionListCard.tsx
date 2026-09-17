import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import type { ReflectionListItem } from '@/hooks/useReflections';
import type { AppLocale } from '@/localization/locales';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import type { Messages } from '@/localization/messages';
import {
  computeCompactQuranFontSize,
  computeQuranLineHeight,
  countArabicWords,
} from '@/localization/quranFontSizePreference';
import { useQuranFontSizePreference } from '@/localization/useQuranFontSizePreference';
import { formatReflectionDate } from '@/utils/formatDate';
import { resolveReflectionSyncStatusLabel } from '@/utils/reflectionSyncStatus';

type ReflectionListCardProps = {
  item: ReflectionListItem;
  locale: AppLocale;
  messages: Messages;
  onPress: () => void;
};

/**
 * One row on the My Reflections screen. Deliberately NOT a re-skinned
 * AyahCard — this needs only a short Arabic preview, never the
 * translation/source/reveal-toggle UI a full AyahCard renders, so a long
 * list of these stays lightweight and doesn't visually compete with the
 * Quran text on the main ayah screen. Tapping opens the existing
 * ReflectionSheet for this exact verseKey (see app/reflections.tsx) — this
 * component never edits or saves a reflection itself.
 */
export function ReflectionListCard({ item, locale, messages, onPress }: ReflectionListCardProps) {
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const { preferredSize } = useQuranFontSizePreference();
  const { reflection, arabicText } = item;

  const wordCount = arabicText ? countArabicWords(arabicText) : 0;
  const arabicFontSize = computeCompactQuranFontSize(preferredSize, wordCount);
  const arabicLineHeight = computeQuranLineHeight(arabicFontSize);
  const statusLabel = resolveReflectionSyncStatusLabel(reflection.syncState, messages);
  const editedDate = formatReflectionDate(reflection.updatedAt, locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${messages.reflections.openReflectionLabel} ${reflection.verseKey}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.referenceRow, isRtl && styles.referenceRowRtl]}>
        <Text style={styles.reference}>{reflection.verseKey}</Text>
        <Text style={styles.statusText}>{statusLabel}</Text>
      </View>

      {arabicText ? (
        <Text
          numberOfLines={2}
          style={[styles.arabic, { fontSize: arabicFontSize, lineHeight: arabicLineHeight }]}>
          {arabicText}
        </Text>
      ) : (
        <Text style={[styles.unresolvedNote, direction]}>{messages.reflections.referenceUnresolved}</Text>
      )}

      <Text numberOfLines={3} style={[styles.reflectionText, direction]}>
        {reflection.text}
      </Text>

      <Text style={[styles.editedDate, direction]}>
        {messages.reflections.editedLabel} {editedDate}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    ...shadows.soft,
  },
  pressed: {
    opacity: 0.85,
  },
  referenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  referenceRowRtl: {
    flexDirection: 'row-reverse',
  },
  reference: {
    color: colors.olive,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  statusText: {
    color: colors.muted,
    fontSize: typography.small,
    fontWeight: '600',
  },
  arabic: {
    color: colors.ink,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  unresolvedNote: {
    color: colors.rust,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  reflectionText: {
    color: colors.ink,
    fontSize: typography.body,
    lineHeight: 22,
  },
  editedDate: {
    color: colors.softText,
    fontSize: typography.small,
  },
});
