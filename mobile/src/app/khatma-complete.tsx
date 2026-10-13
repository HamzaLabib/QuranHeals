import { router, useLocalSearchParams } from 'expo-router';
import { BookHeart, BookOpenText } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { fill, localNumber } from '@/localization/fill';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { loadReadingData, type KhatmaRecord } from '@/mushaf/khatmas';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { formatReflectionDate } from '@/utils/formatDate';

/** Back to أورادي وختماتي: the one under this screen when it is there, otherwise opened in its place. */
export function backToMyKhatmas() {
  router.dismissTo('/my-reading');
}

/**
 * تقبل الله ختمتك (/khatma-complete?id=<record>): shown once, right after a
 * Khatma is confirmed (the reader, أورادي وختماتي or the du'a screen). It
 * records nothing itself; the record already exists. The du'a is optional.
 */
export default function KhatmaCompleteScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const copy = messages.khatma;
  const direction = getDirectionStyle(locale);
  const params = useLocalSearchParams<{ id?: string }>();
  const [record, setRecord] = useState<KhatmaRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadReadingData()
      .then((data) => {
        if (!cancelled) setRecord(data.records.find((r) => r.id === params.id) ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const tag = record
    ? record.ramadan && record.ramadanHijriYear !== null
      ? fill(messages.myReading.ramadanTag, { year: localNumber(locale, record.ramadanHijriYear) })
      : messages.myReading.nonRamadanTag
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.emblem}>
          <BookHeart size={34} color={colors.accent} strokeWidth={1.8} />
        </View>
        <View style={styles.rule} />
        <Text testID="khatma-complete-title" accessibilityRole="header" style={[styles.title, styles.centered]}>{copy.completeTitle}</Text>
        <Text testID="khatma-complete-body" style={[styles.body, styles.centered]}>{copy.completeBody}</Text>
        {record && (
          <Text testID="khatma-complete-detail" style={[styles.detail, styles.centered, { writingDirection: direction.writingDirection }]}>
            {[record.stopName, formatReflectionDate(Date.parse(record.completedAt), locale), tag].filter(Boolean).join(' · ')}
          </Text>
        )}
        <View style={styles.rule} />
        <View style={styles.actions}>
          <Pressable
            testID="khatma-complete-dua"
            accessibilityRole="button"
            onPress={() => router.push('/khatm-dua')}
            style={({ pressed }) => [styles.primary, isRtlLocale(locale) && styles.rowRtl, pressed && styles.pressed]}>
            <BookOpenText size={20} color={colors.onPrimaryButton} />
            <Text style={styles.primaryText}>{copy.readDua}</Text>
          </Pressable>
          <Pressable
            testID="khatma-complete-back"
            accessibilityRole="button"
            onPress={backToMyKhatmas}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{copy.backToKhatmas}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    alignItems: 'stretch',
    flexGrow: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emblem: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.sageBorder,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  rule: {
    alignSelf: 'center',
    backgroundColor: colors.sageBorder,
    height: 1,
    width: '40%',
  },
  centered: {
    textAlign: 'center',
  },
  // The Arabic headings are given wording, shown in every language's own text: centred, as on a printed page.
  title: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 44,
  },
  body: {
    color: colors.textSecondary,
    fontSize: typography.bodyLarge,
    lineHeight: 30,
  },
  detail: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primary: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: radii.full,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: spacing.lg,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  primaryText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '800',
  },
  secondary: {
    alignItems: 'center',
    backgroundColor: colors.secondaryButtonSurface,
    borderColor: colors.secondaryButtonBorder,
    borderRadius: radii.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: spacing.lg,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
});
