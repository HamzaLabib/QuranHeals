import { StyleSheet, Text, View } from 'react-native';

import { getReciter, reciterName } from '@/audio/reciters';
import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { localNumber } from '@/localization/fill';
import type { AppLocale } from '@/localization/locales';
import { getSurahName } from '@/services/surahNames';
import { useThemedStyles } from '@/theme/useTheme';

import type { AudioIssueContext } from './context';
import type { AudioIssueLabels } from './labels';

type Props = {
  context: AudioIssueContext;
  labels: AudioIssueLabels;
  locale: AppLocale;
  rtl: boolean;
  /** The review's extra rows (the chosen problem, the description, the email), after the attached details. */
  extra?: readonly (readonly [label: string, value: string])[];
};

/**
 * What an Audio Issue attaches, shown before it is sent: the surah and ayah, the reciter, the recording and the
 * playback, each only when known. The recording is shown as the report carries it (provider and file), left to right.
 */
export function AudioIssueDetails({ context, labels, locale, rtl, extra = [] }: Props) {
  const styles = useThemedStyles(makeStyles);
  const reciter = getReciter(context.reciterId);
  const surahName = context.surah ? getSurahName(context.surah) : null;
  const rows: (readonly [string, string, boolean?])[] = [];
  if (context.surah && surahName) rows.push([labels.surah, `${rtl ? surahName.nameArabic : surahName.nameEnglish} (${localNumber(locale, context.surah)})`]);
  if (context.ayah) rows.push([labels.ayah, localNumber(locale, context.ayah)]);
  if (reciter) rows.push([labels.reciter, reciterName(reciter, rtl)]);
  if (context.audioSource) rows.push([labels.recording, context.audioSource.startsWith('none') ? labels.noRecording : context.audioSource, !context.audioSource.startsWith('none')]);
  rows.push([labels.playback, labels.playbackPhases[context.playback]]);
  for (const [label, value] of extra) rows.push([label, value]);
  const direction = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;

  return (
    <View testID="audio-issue-details" style={styles.box}>
      <Text style={[styles.title, direction]}>{labels.detailsTitle}</Text>
      {rows.map(([label, value, ltr]) => (
        <View key={label} style={[styles.row, rtl && styles.rowRtl]}>
          <Text style={[styles.label, direction]}>{label}</Text>
          <Text
            selectable
            numberOfLines={ltr ? 3 : undefined}
            style={[styles.value, direction, ltr && styles.ltrValue]}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  box: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  title: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '700',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.caption,
    width: 96,
  },
  value: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  // A URL reads left to right in every language.
  ltrValue: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
});
