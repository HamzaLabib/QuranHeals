import { Link, router } from 'expo-router';
import { BookOpen, ChevronLeft, ChevronRight, Heart, MessageSquare, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContinueReadingCard } from '@/components/ContinueReadingCard';
import { EmotionCard } from '@/components/EmotionCard';
import { ReportIssueSheet } from '@/components/ReportIssueSheet';
import { SettingsHeaderButton } from '@/components/SettingsHeaderButton';
import { StateView } from '@/components/StateView';
import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getApiErrorMessage, getEmotions } from '@/services/api';
import { withRetry } from '@/services/retry';
import { getCachedEmotions, setCachedEmotions } from '@/storage/emotionsCache';
import { subscribeToLocalDataOwner } from '@/storage/localDataOwner';
import { loadRecentEmotionKeys, pickHomeEmotions, recordEmotionUse } from '@/storage/recentEmotions';
import type { Emotion } from '@/types/domain';
import { devLog } from '@/utils/devLog';
import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';
import { scrollBottomPadding } from '@/utils/safeAreaSpacing';

// Backgrounded only briefly (e.g. a quick app switch) — not worth a full
// revalidation on every foreground; see Part 4's "foreground refresh
// throttling."
const FOREGROUND_REVALIDATE_AFTER_MS = 60_000;

/**
 * Home (the first tab), in the approved order:
 *  1. متابعة التلاوة / Continue Reciting (ContinueReadingCard): the Mushaf at
 *     the ورد's saved page, and أورادي وختماتي.
 *  2. Four emotions: the most recently chosen distinct ones (most recent
 *     first), filled from the catalog's own order (storage/recentEmotions.ts),
 *     slightly shorter cards; "View All" opens every emotion (/emotions).
 *  3. رسالة من القرآن / A Message from the Quran, unchanged.
 *  4. شاركنا رأيك / Share Feedback: one discreet action (opens the feedback sheet).
 * The spiritual disclaimer is on the emotion list (/emotions), under every emotion.
 */
export default function HomeScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  // The SafeAreaView below leaves out the bottom edge so the list can scroll
  // behind Android's edge-to-edge navigation bar; the bottom inset is added
  // to the scroll content instead (once), so the sources footer always ends
  // fully above the gesture bar / 3-button bar / home indicator.
  const insets = useSafeAreaInsets();
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Mirrors `emotions` for use inside loadEmotions without adding it to that
  // callback's own deps (which would recreate it, and re-fire the mount/
  // AppState effects below, on every successful load).
  const emotionsRef = useRef<Emotion[]>([]);
  // Guards against the mount effect and an AppState foreground event firing
  // an overlapping second fetch (Part 4: "Prevent duplicate foreground
  // refreshes").
  const isFetchingRef = useRef(false);
  const lastFetchedAtRef = useRef(0);

  useEffect(() => {
    emotionsRef.current = emotions;
  }, [emotions]);

  // The active owner's recently chosen emotions (each account its own; the guest its own).
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void loadRecentEmotionKeys().then((keys) => {
        if (!cancelled) setRecentKeys(keys);
      });
    };
    reload();
    const unsubscribe = subscribeToLocalDataOwner(reload);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  const homeEmotions = pickHomeEmotions(emotions, recentKeys);

  useEffect(() => {
    if (!isLoading) {
      devLog('home', 'render readiness', { emotionCount: emotions.length, hasError: errorMessage !== null });
    }
  }, [isLoading, emotions.length, errorMessage]);

  const loadEmotions = useCallback(
    async (options?: { silent?: boolean }) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      const silent = options?.silent ?? false;

      // A silent (background revalidation) run never shows the blocking
      // loading state or clears an already-displayed error — the emotions
      // already on screen (from cache or a previous successful fetch) stay
      // exactly as they are unless this call actually succeeds.
      if (!silent) {
        setIsLoading(emotionsRef.current.length === 0);
        setErrorMessage(null);
      }

      devLog('emotions', 'load start', { silent });
      try {
        const response = await withRetry(() => getEmotions());
        devLog('emotions', 'load result', { count: response.length });
        setEmotions(response);
        setErrorMessage(null);
        lastFetchedAtRef.current = Date.now();
        void setCachedEmotions(response);
      } catch (error) {
        devLog('emotions', 'fetch failed', { kind: error instanceof Error ? error.name : 'unknown' });
        // Never blank a screen that already has good data — Part 4: "Never
        // replace good data with an empty list merely because the request
        // failed." Only surface a blocking error when there's nothing to
        // show at all.
        if (emotionsRef.current.length === 0) {
          setErrorMessage(getApiErrorMessage(error, messages.home.errorTitle));
        }
      } finally {
        setIsLoading(false);
        isFetchingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messages is stable per locale
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      void (async () => {
        const cached = await getCachedEmotions();
        if (cancelled) return;
        const hasCached = cached !== null && cached.length > 0;
        if (hasCached) {
          setEmotions(cached);
          setIsLoading(false);
        }
        // Always revalidates against the backend even after a cache hit —
        // the cache only avoids a blocking spinner, it's never treated as
        // the source of truth on its own.
        void loadEmotions({ silent: hasCached });
      })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [loadEmotions]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const elapsed = Date.now() - lastFetchedAtRef.current;
      if (elapsed < FOREGROUND_REVALIDATE_AFTER_MS) return;
      devLog('emotions', 'revalidating on foreground', { elapsedMs: elapsed });
      void loadEmotions({ silent: true });
    });
    return () => subscription.remove();
  }, [loadEmotions]);

  // Guards a rapid repeated pull gesture the same way Favorites does — see
  // pullToRefresh.ts's doc comment for why this needs a ref, not just the
  // `isPullRefreshing` state below.
  const refreshGuardRef = useRef<RefreshInFlightRef>({ current: false });
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [isFeedbackVisible, setIsFeedbackVisible] = useState(false);

  const onPullToRefresh = useCallback(async () => {
    await runGuardedRefresh(refreshGuardRef.current, async () => {
      setIsPullRefreshing(true);
      try {
        // Reuses the exact same fetch (cache write, retry, error handling)
        // as mount/foreground revalidation — never a duplicate fetch path.
        // Not silent: a user-initiated pull is allowed to surface an error
        // if there's nothing on screen yet, exactly like the manual "Try
        // Again" action does.
        await loadEmotions();
      } finally {
        setIsPullRefreshing(false);
      }
    });
  }, [loadEmotions]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding(insets.bottom) }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isPullRefreshing}
            onRefresh={() => void onPullToRefresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }>
        <View style={[styles.header, isRtl && styles.headerRtl]}>
          <View style={styles.headerTitleBlock}>
            <Text style={[styles.wordmark, direction]}>{messages.appName}</Text>
            {/* Under the name: Text B (home.eyebrow), «تدبّر وتفكّر مع القرآن». It and Text A swapped places; each place keeps its own style. */}
            <Text testID="home-subtitle" style={[styles.subtitle, direction]}>{messages.home.eyebrow}</Text>
          </View>
          {/* Favorites and Settings. Reflections and أورادي وختماتي are bottom tabs (app/(tabs)/_layout.tsx). */}
          <View style={[styles.headerActions, isRtl && styles.headerActionsRtl]}>
            <Link href="/favorites" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.home.openFavorites}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Heart size={20} color={colors.icon} strokeWidth={2} />
              </Pressable>
            </Link>
            <SettingsHeaderButton style={styles.iconButton} pressedStyle={styles.pressed} />
          </View>
        </View>

        <ContinueReadingCard />

        <View style={styles.prompt}>
          {/* Above the emotions question: Text A (home.subtitle), «هداية قرآنية لكل شعور». */}
          <Text testID="home-eyebrow" style={[styles.eyebrow, direction]}>{messages.home.subtitle}</Text>
          <Text style={[styles.title, direction]}>{messages.home.title}</Text>
        </View>

        {isLoading && (
          <StateView
            title={messages.home.loadingTitle}
            message={messages.home.loadingMessage}
            icon={<RefreshCw size={22} color={colors.accent} />}
            spin
          />
        )}

        {!isLoading && errorMessage && (
          <StateView
            title={messages.home.errorTitle}
            message={errorMessage}
            actionLabel={messages.home.retry}
            onAction={loadEmotions}
          />
        )}

        {!isLoading && !errorMessage && (
          <View testID="home-emotions" style={[styles.grid, isRtl && styles.gridRtl]}>
            {homeEmotions.map((emotion) => (
              <EmotionCard
                key={emotion.key}
                emotion={emotion}
                compact
                onPress={() => {
                  // Remembered for Home's four cards; never blocks or changes the emotion's own flow.
                  setRecentKeys((keys) => [emotion.key, ...keys.filter((k) => k !== emotion.key)]);
                  void recordEmotionUse(emotion.key);
                  router.push({
                    pathname: '/ayah/[emotion]',
                    params: { emotion: emotion.key, namesJson: JSON.stringify(emotion.names) },
                  });
                }}
              />
            ))}
          </View>
        )}

        {!isLoading && !errorMessage && emotions.length > 0 && (
          <Pressable
            testID="home-view-all"
            accessibilityRole="button"
            accessibilityLabel={messages.emotionsAll.viewAll}
            onPress={() => router.push('/emotions')}
            hitSlop={8}
            style={({ pressed }) => [styles.viewAll, isRtl && styles.viewAllRtl, pressed && styles.pressed]}>
            <Text style={styles.viewAllText}>{messages.emotionsAll.viewAll}</Text>
            {isRtl ? <ChevronLeft size={18} color={colors.accent} /> : <ChevronRight size={18} color={colors.accent} />}
          </Pressable>
        )}

        {/*
          Completely separate from the emotion cards above — visually
          distinct (a single full-width action, not a grid tile) and
          logically distinct (no emotionKey, no mapping; see
          AyahExperience's `source.mode === 'general'`). Never shown inside
          `styles.grid`, so it can never be mistaken for a 30th emotion. The
          whole block is itself the tappable target — there is no separate
          heading + button pair.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={messages.generalQuran.action}
          onPress={() => router.push('/ayah/general')}
          style={({ pressed }) => [styles.generalQuranAction, pressed && styles.pressed]}>
          <BookOpen size={18} color={colors.icon} strokeWidth={2} />
          <Text style={[styles.generalQuranActionText, { writingDirection: direction.writingDirection }]}>
            {messages.generalQuran.action}
          </Text>
        </Pressable>

        {/*
          Share Feedback: one discreet action directly after A Message from the
          Quran, styled exactly like the ayah screen's Report an Issue
          (AyahExperience's tertiary action). Opens the reporting sheet as
          general feedback; nothing about the reader is attached.
        */}
        <View testID="home-feedback" style={styles.feedbackActions}>
          <Pressable
            testID="home-feedback-action"
            accessibilityRole="button"
            accessibilityLabel={messages.feedback.action}
            onPress={() => setIsFeedbackVisible(true)}
            hitSlop={4}
            style={({ pressed }) => [styles.feedbackButton, isRtl && styles.feedbackButtonRtl, pressed && styles.feedbackPressed]}>
            <MessageSquare size={14} color={colors.textSecondary} strokeWidth={2} />
            <Text style={styles.feedbackButtonText}>{messages.feedback.action}</Text>
          </Pressable>
        </View>

        {/* Quran sources: Tanzil requires its name and a link, Quran Foundation a credit within the app (constants/quranSources.ts). */}
        <View testID="home-sources" style={styles.sources}>
          <Text style={[styles.sourcesCredit, direction]}>{messages.home.sourcesCredit}</Text>
          <Link href="/credits" asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={messages.home.sourcesLink}
              hitSlop={8}
              style={({ pressed }) => [styles.sourcesLink, isRtl && styles.sourcesLinkRtl, pressed && styles.pressed]}>
              <Text style={styles.sourcesLinkText}>{messages.home.sourcesLink}</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
      <ReportIssueSheet visible={isFeedbackVisible} onClose={() => setIsFeedbackVisible(false)} variant="feedback" />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  // paddingBottom is applied inline: the bottom safe-area inset + clearance (scrollBottomPadding).
  content: {
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerRtl: {
    flexDirection: 'row-reverse',
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerActionsRtl: {
    flexDirection: 'row-reverse',
  },
  // Without an explicit flexShrink, React Native's default (0, unlike web's
  // 1) would let this block overflow past the three now-present icon
  // buttons on narrow screens instead of wrapping — flexShrink keeps the
  // title/subtitle text visible (wrapping if truly needed) rather than
  // clipped or pushed under the header actions. fontSize is never reduced.
  headerTitleBlock: {
    flexShrink: 1,
  },
  wordmark: {
    color: colors.textPrimary,
    fontSize: 29,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 22,
    marginTop: spacing.xs,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
    ...shadows.soft,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.99 }],
  },
  prompt: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: typography.small,
    fontWeight: '700',
    letterSpacing: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 40,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Column gap unchanged (spacing.md) so card width — computed from the
    // 47.5% flexBasis plus this gap — stays exactly the same; only the
    // vertical gap between rows is trimmed to match the slightly shorter
    // card height below.
    columnGap: spacing.md,
    rowGap: spacing.sm,
  },
  gridRtl: {
    flexDirection: 'row-reverse',
  },
  viewAll: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    marginTop: -spacing.md,
    minHeight: 40,
  },
  viewAllRtl: {
    alignSelf: 'flex-start',
    flexDirection: 'row-reverse',
  },
  viewAllText: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
  generalQuranAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    ...shadows.soft,
  },
  generalQuranActionText: {
    color: colors.textPrimary,
    fontSize: typography.bodyLarge,
    fontWeight: '700',
  },
  // Share Feedback: the same values as AyahExperience's tertiaryActions / tertiaryButton / tertiaryButtonText / pressed.
  feedbackActions: {
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    paddingTop: spacing.xs,
  },
  feedbackButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  feedbackButtonRtl: {
    flexDirection: 'row-reverse',
  },
  feedbackButtonText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  feedbackPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  sources: {
    borderTopColor: colors.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
  },
  sourcesCredit: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 16,
  },
  sourcesLink: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
  },
  sourcesLinkRtl: {
    alignSelf: 'flex-end',
  },
  sourcesLinkText: {
    color: colors.accent,
    fontSize: typography.small,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
