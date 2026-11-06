import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { useThemedStyles } from '@/theme/useTheme';
import type { ReflectionListItem } from '@/hooks/useReflections';
import type { AppLocale } from '@/localization/locales';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import type { Messages } from '@/localization/messages';
import { formatReflectionDate } from '@/utils/formatDate';
import { resolveReflectionSyncStatusLabel } from '@/utils/reflectionSyncStatus';
import { ReflectionAyah, useReflectionTranslation } from './ReflectionAyah';

type ReflectionListCardProps = {
  item: ReflectionListItem;
  locale: AppLocale;
  messages: Messages;
  /** Opens the reflection; carries whether this card's translation is currently shown. */
  onPress: (translationRevealed: boolean | null) => void;
  /** Changes on pull-to-refresh: a translation that couldn't load is tried again. */
  translationRetryKey?: number;
};

/**
 * One row on the My Reflections screen. Deliberately NOT a re-skinned
 * AyahCard (no copy, audio or font-size controls), so a long list stays
 * lightweight. The ayah comes first — a two-line Arabic preview with its
 * translation underneath, shown by Saved Ayahs' rule (ReflectionAyah.tsx)
 * and clamped to two lines — then the person's reflection in its own
 * section below. Tapping opens the existing ReflectionSheet for this exact
 * verseKey (see app/reflections.tsx) — this component never edits or saves
 * a reflection itself.
 */
export function ReflectionListCard({ item, locale, messages, onPress, translationRetryKey }: ReflectionListCardProps) {
  const styles = useThemedStyles(makeStyles);
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const { reflection, arabicText } = item;
  const translation = useReflectionTranslation(reflection.verseKey, { retryKey: translationRetryKey });
  const statusLabel = item.recoveredOnly ? '' : resolveReflectionSyncStatusLabel(reflection.syncState, messages);
  const reviewLabel = item.recoveredOnly ? messages.reflections.recoveredBadge : item.otherVersionCount > 0 ? messages.reflections.otherVersionBadge : null;
  const editedDate = formatReflectionDate(reflection.updatedAt, locale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${messages.reflections.openReflectionLabel} ${reflection.verseKey}`}
      // The card is one accessible element, so the Show / Hide translation button inside it is offered as an action.
      accessibilityActions={translation.showToggleControl ? [{ name: 'toggleTranslation', label: translation.toggleLabel }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'toggleTranslation') translation.toggle();
      }}
      onPress={() => onPress(translation.showToggleControl ? translation.isRevealed : null)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.referenceRow, isRtl && styles.referenceRowRtl]}>
        <Text style={styles.reference}>{reflection.verseKey}</Text>
        <Text style={styles.statusText}>{statusLabel}</Text>
      </View>

      <ReflectionAyah arabicText={arabicText} translation={translation} preview />

      <View style={styles.reflectionSection}>
        {reviewLabel && <Text style={[styles.reviewBadge, direction]}>{reviewLabel}</Text>}

        <Text numberOfLines={3} style={[styles.reflectionText, direction]}>
          {reflection.text}
        </Text>

        <Text style={[styles.editedDate, direction]}>
          {messages.reflections.editedLabel} {editedDate}
        </Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
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
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: typography.small,
    fontWeight: '600',
  },
  reflectionSection: {
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  reflectionText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    lineHeight: 22,
  },
  editedDate: {
    color: colors.textMuted,
    fontSize: typography.small,
  },
  reviewBadge: {
    color: colors.accent,
    fontSize: typography.small,
    fontWeight: '700',
  },
});
