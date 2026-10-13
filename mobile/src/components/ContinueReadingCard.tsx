import { router } from 'expo-router';
import { BookMarked, BookOpen } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { fill, localNumber } from '@/localization/fill';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { openMushafFor } from '@/mushaf/continueWird';
import { loadReadingData, type Wird } from '@/mushaf/khatmas';
import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';
import { subscribeToReadingData } from '@/mushaf/readingStops';
import { subscribeToLocalDataOwner } from '@/storage/localDataOwner';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

/** The ورد Home continues: the active one, else the most recently saved; null when there is none. */
export function continueTarget(wirds: readonly Wird[], activeStopId: string | null): { wird: Wird; active: boolean } | null {
  const active = wirds.find((w) => w.stop.id === activeStopId);
  if (active) return { wird: active, active: true };
  // Wirds are in saved order, most recent first.
  return wirds[0] ? { wird: wirds[0], active: false } : null;
}

/**
 * Home's first section, متابعة التلاوة / Continue Reciting: the ورد being read (its name, saved
 * page and progress) with two actions — المصحف, opening the reader at that
 * saved page, and أورادي وختماتي. With no ورد yet, a first-reading state
 * opens the Mushaf at page 1; no progress is shown or invented.
 */
export function ContinueReadingCard() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const copy = messages.continueReading;
  const direction = getDirectionStyle(locale);
  const rtl = isRtlLocale(locale);
  const [target, setTarget] = useState<ReturnType<typeof continueTarget> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void loadReadingData()
        .then((data) => {
          if (!cancelled) setTarget(continueTarget(data.wirds, data.activeStopId));
        })
        .catch(() => {
          if (!cancelled) setTarget(null);
        });
    };
    reload();
    const unsubscribeData = subscribeToReadingData(reload);
    const unsubscribeOwner = subscribeToLocalDataOwner(() => {
      setTarget(undefined);
      reload();
    });
    return () => {
      cancelled = true;
      unsubscribeData();
      unsubscribeOwner();
    };
  }, []);

  const wird = target?.wird ?? null;
  const openMushaf = () => void openMushafFor(wird ? wird.stop : null);

  return (
    <View testID="home-continue-reading" style={styles.card}>
      <Text accessibilityRole="header" style={[styles.title, direction]}>{copy.title}</Text>
      {wird ? (
        <View testID="home-continue-wird" style={styles.info}>
          <Text style={[styles.caption, direction]}>{target?.active ? copy.activeWird : copy.lastSaved}</Text>
          <Text numberOfLines={1} style={[styles.wirdName, direction]}>{wird.stop.name}</Text>
          <View style={[styles.metaRow, rtl && styles.rowRtl]}>
            <Text style={[styles.meta, { writingDirection: direction.writingDirection }]}>
              {fill(copy.pageOf, { page: localNumber(locale, wird.stop.page), total: localNumber(locale, MUSHAF_PAGE_COUNT) })}
            </Text>
            <Text style={styles.metaStrong}>{fill(messages.myReading.percent, { percent: localNumber(locale, wird.percent) })}</Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={messages.myReading.positionLabel}
            accessibilityValue={{ min: 0, max: 100, now: wird.percent }}
            style={[styles.track, rtl && styles.rowRtl]}>
            <View style={[styles.fill, { width: `${wird.percent}%` }]} />
          </View>
        </View>
      ) : target === null ? (
        <View testID="home-continue-first" style={styles.info}>
          <Text style={[styles.wirdName, direction]}>{copy.firstTitle}</Text>
          <Text style={[styles.caption, direction]}>{copy.firstBody}</Text>
        </View>
      ) : null}
      <View style={[styles.actions, rtl && styles.rowRtl]}>
        <Pressable
          testID="home-open-mushaf"
          accessibilityRole="button"
          accessibilityLabel={copy.mushaf}
          onPress={openMushaf}
          style={({ pressed }) => [styles.primary, rtl && styles.rowRtl, pressed && styles.pressed]}>
          <BookOpen size={20} color={colors.onAccentFill} />
          <Text style={styles.primaryText}>{copy.mushaf}</Text>
        </Pressable>
        <Pressable
          testID="home-open-my-reading"
          accessibilityRole="button"
          accessibilityLabel={copy.myReading}
          onPress={() => router.navigate('/my-reading')}
          style={({ pressed }) => [styles.secondary, rtl && styles.rowRtl, pressed && styles.pressed]}>
          <BookMarked size={20} color={colors.accent} />
          <Text numberOfLines={2} style={styles.secondaryText}>{copy.myReading}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  card: {
    backgroundColor: colors.sageSurface,
    borderColor: colors.sageBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.soft,
  },
  title: { color: colors.accent, fontSize: typography.body, fontWeight: '800' },
  info: { gap: spacing.xs },
  caption: { color: colors.textSecondary, fontSize: typography.caption, lineHeight: 19 },
  wirdName: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rowRtl: { flexDirection: 'row-reverse' },
  meta: { color: colors.textSecondary, fontSize: typography.caption },
  metaStrong: { color: colors.accent, fontSize: typography.caption, fontWeight: '800' },
  track: { backgroundColor: colors.accentSoft, borderRadius: radii.full, flexDirection: 'row', height: 6, marginTop: spacing.xs, overflow: 'hidden' },
  fill: { backgroundColor: colors.accentFill, borderRadius: radii.full, height: 6 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  primary: {
    alignItems: 'center', backgroundColor: colors.accentFill, borderRadius: radii.full, flex: 1, flexDirection: 'row',
    gap: spacing.sm, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md,
  },
  primaryText: { color: colors.onAccentFill, fontSize: typography.body, fontWeight: '800' },
  secondary: {
    alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.full, borderWidth: 1,
    flex: 1.3, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md,
  },
  secondaryText: { color: colors.textPrimary, flexShrink: 1, fontSize: typography.caption, fontWeight: '800', textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
