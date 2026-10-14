import { router, useLocalSearchParams } from 'expo-router';
import { BookHeart, BookOpen, BookOpenText } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { fill, localNumber } from '@/localization/fill';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { loadReadingData, type KhatmaRecord } from '@/mushaf/khatmas';
import { setActiveReadingStopId } from '@/mushaf/readingStops';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { formatCivilDate } from '@/utils/formatDate';

/** Back to أورادي وختماتي: the one under this screen when it is there, otherwise opened in its place. */
export function backToMyKhatmas() {
  router.dismissTo('/my-reading');
}

/**
 * Back to the Mushaf, closing this screen the same way (never a second reader on top): the completed ورد selected,
 * open at its saved page — after the confirmation, page 1 of its new cycle, never the old page 604. Records nothing,
 * and nothing here can offer another Khatma (page 604 itself blocks a cycle just restarted by one). A ورد deleted
 * meanwhile: page 1, the selection unchanged.
 */
export async function backToMushaf(stopId: string | null) {
  const stop = stopId ? (await loadReadingData().catch(() => null))?.wirds.find((w) => w.stop.id === stopId)?.stop : undefined;
  if (stop) await setActiveReadingStopId(stop.id).catch(() => undefined);
  router.dismissTo({ pathname: '/mushaf', params: { page: String(stop ? stop.page : 1), at: String(Date.now()) } });
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
  // One navigation from here: a second tap while the first is on its way does nothing.
  const leavingRef = useRef(false);
  const leave = (go: () => unknown) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    void Promise.resolve(go()).finally(() => {
      leavingRef.current = false;
    });
  };

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
        {/* The ورد name, the date and the Ramadan tag each in its own line: one mixed-direction string let an English
            name land inside an Arabic date (2026/10/Hi · 13). The name takes its own direction (its first strong letter);
            the date is the record's stored local calendar day, never shifted by the time zone. */}
        {record && (
          <View testID="khatma-complete-detail" style={styles.details}>
            {record.stopName ? (
              <Text testID="khatma-complete-name" style={[styles.detailName, styles.centered]}>{record.stopName}</Text>
            ) : null}
            <Text testID="khatma-complete-date" style={[styles.detail, styles.centered, { writingDirection: direction.writingDirection }]}>
              {formatCivilDate(record.localDate, locale)}
            </Text>
            {tag ? (
              <Text testID="khatma-complete-tag" style={[styles.detail, styles.centered, { writingDirection: direction.writingDirection }]}>{tag}</Text>
            ) : null}
          </View>
        )}
        <View style={styles.rule} />
        {/* Three full-width actions, stacked (never crowded side by side): the Mushaf, أورادي وختماتي, the du'a. */}
        <View style={styles.actions}>
          <Pressable
            testID="khatma-complete-mushaf"
            accessibilityRole="button"
            accessibilityLabel={copy.backToMushaf}
            onPress={() => leave(() => backToMushaf(record?.stopId ?? null))}
            style={({ pressed }) => [styles.secondary, isRtlLocale(locale) && styles.rowRtl, pressed && styles.pressed]}>
            <BookOpen size={20} color={colors.textPrimary} />
            <Text style={styles.secondaryText}>{copy.backToMushaf}</Text>
          </Pressable>
          <Pressable
            testID="khatma-complete-back"
            accessibilityRole="button"
            onPress={() => leave(backToMyKhatmas)}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{copy.backToKhatmas}</Text>
          </Pressable>
          <Pressable
            testID="khatma-complete-dua"
            accessibilityRole="button"
            onPress={() => router.push('/khatm-dua')}
            style={({ pressed }) => [styles.primary, isRtlLocale(locale) && styles.rowRtl, pressed && styles.pressed]}>
            <BookOpenText size={20} color={colors.onPrimaryButton} />
            <Text style={styles.primaryText}>{copy.readDua}</Text>
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
  details: {
    alignItems: 'stretch',
    gap: spacing.xs,
  },
  detailName: {
    color: colors.textSecondary,
    fontSize: typography.body,
    fontWeight: '700',
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
    flexDirection: 'row',
    gap: spacing.sm,
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
