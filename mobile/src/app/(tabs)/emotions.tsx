import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmotionCard, EmotionGridFiller } from '@/components/EmotionCard';
import { SettingsHeaderButton } from '@/components/SettingsHeaderButton';
import { StateView } from '@/components/StateView';
import { pageHeaderText, radii, spacing, typography, type Palette } from '@/constants/theme';
import { useWindowClass } from '@/layout/useWindowClass';
import { contentColumnStyle, emotionGridColumns, gridFillerCount } from '@/layout/windowClass';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getApiErrorMessage, getEmotions } from '@/services/api';
import { withRetry } from '@/services/retry';
import { getCachedEmotions, setCachedEmotions } from '@/storage/emotionsCache';
import { recordEmotionUse } from '@/storage/recentEmotions';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import type { Emotion } from '@/types/domain';
import { goBackOrHome } from '@/utils/goBackOrHome';
import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';
import { scrollBottomPadding } from '@/utils/safeAreaSpacing';

/**
 * Every emotion (/emotions), from Home's "View All": the same catalog Home
 * uses (the cached list, then the backend's), in its own order, with the
 * original full-size cards. Choosing one opens its ayah exactly as Home does
 * (the same raw emotion.key and names), and is remembered for Home's four.
 * The spiritual disclaimer (moved here from Home) closes the list.
 */
export default function AllEmotionsScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Tablets: a centred column, 3 cards per row (medium) or 4 (expanded); phones: the original two (layout/windowClass.ts).
  const { windowClass } = useWindowClass();
  const columns = emotionGridColumns(windowClass);
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async (hasShown: boolean) => {
    try {
      const response = await withRetry(() => getEmotions());
      setEmotions(response);
      setErrorMessage(null);
      void setCachedEmotions(response);
    } catch (error) {
      // Never blank a list already on screen.
      if (!hasShown) setErrorMessage(getApiErrorMessage(error, messages.home.errorTitle));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messages is stable per locale
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await getCachedEmotions();
      if (cancelled) return;
      const hasCached = cached !== null && cached.length > 0;
      if (hasCached) {
        setEmotions(cached);
        setIsLoading(false);
      }
      await load(hasCached);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Pull-to-refresh, exactly as Home: guarded against a rapid repeated pull
  // (see pullToRefresh.ts for why a ref, not just the state below).
  const refreshGuardRef = useRef<RefreshInFlightRef>({ current: false });
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const hasShown = emotions.length > 0;
  const onPullToRefresh = useCallback(async () => {
    await runGuardedRefresh(refreshGuardRef.current, async () => {
      setIsPullRefreshing(true);
      try {
        // The same fetch (retry, cache write, error handling) as opening and
        // Try Again — never a duplicate path. A list already on screen is
        // never blanked by a failed refresh.
        await load(hasShown);
      } finally {
        setIsPullRefreshing(false);
      }
    });
  }, [load, hasShown]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.header, contentColumnStyle(windowClass), isRtl && styles.headerRtl]}>
        <Pressable
          testID="emotions-back"
          accessibilityRole="button"
          accessibilityLabel={messages.emotionsAll.back}
          onPress={goBackOrHome}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <BackIcon size={22} color={colors.icon} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" style={[styles.title, direction]}>{messages.emotionsAll.title}</Text>
          <Text testID="emotions-subtitle" style={[styles.subtitle, direction]}>{messages.emotionsAll.subtitle}</Text>
        </View>
        <SettingsHeaderButton style={styles.iconButton} pressedStyle={styles.pressed} />
      </View>
      <ScrollView
        testID="emotions-scroll"
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentColumnStyle(windowClass), { paddingBottom: scrollBottomPadding(insets.bottom) }]}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={() => void onPullToRefresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }>
        {isLoading && (
          <StateView title={messages.home.loadingTitle} message={messages.home.loadingMessage} icon={<RefreshCw size={22} color={colors.accent} />} spin />
        )}
        {!isLoading && errorMessage && (
          <StateView title={messages.home.errorTitle} message={errorMessage} actionLabel={messages.home.retry} onAction={() => void load(emotions.length > 0)} />
        )}
        {!isLoading && !errorMessage && (
          <View testID="emotions-grid" style={[styles.grid, isRtl && styles.gridRtl]}>
            {emotions.map((emotion) => (
              <EmotionCard
                key={emotion.key}
                emotion={emotion}
                columns={columns}
                onPress={() => {
                  void recordEmotionUse(emotion.key);
                  router.push({
                    pathname: '/ayah/[emotion]',
                    params: { emotion: emotion.key, namesJson: JSON.stringify(emotion.names) },
                  });
                }}
              />
            ))}
            {Array.from({ length: gridFillerCount(emotions.length, columns) }, (_, index) => <EmotionGridFiller key={`filler-${index}`} columns={columns} />)}
          </View>
        )}
        {/* After the emotion cards; the scroll's bottom padding keeps it clear of the home indicator / navigation bar. */}
        <Text testID="emotions-disclaimer" style={[styles.disclaimer, direction]}>{messages.home.disclaimer}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerRtl: { flexDirection: 'row-reverse' },
  iconButton: {
    alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.full,
    borderWidth: 1, height: 48, justifyContent: 'center', width: 48,
  },
  // The title and its subtitle (Home's subtitle style) share the header's flexible middle.
  titleBlock: pageHeaderText(colors).block,
  title: pageHeaderText(colors).title,
  subtitle: pageHeaderText(colors).subtitle,
  // Fills the screen as Home's does, so the pull works however short the content is.
  scroll: { flex: 1 },
  content: { gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  // Home's original grid: two columns, the same gaps.
  grid: { columnGap: spacing.md, flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
  gridRtl: { flexDirection: 'row-reverse' },
  // Unchanged from Home, where it used to be.
  disclaimer: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 19,
    paddingHorizontal: spacing.xs,
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
});
