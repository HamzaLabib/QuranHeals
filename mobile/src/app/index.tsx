import { Link, router } from 'expo-router';
import { BookOpen, Heart, NotebookPen, RefreshCw, Settings } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmotionCard } from '@/components/EmotionCard';
import { StateView } from '@/components/StateView';
import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getApiErrorMessage, getEmotions } from '@/services/api';
import { withRetry } from '@/services/retry';
import { getCachedEmotions, setCachedEmotions } from '@/storage/emotionsCache';
import type { Emotion } from '@/types/domain';
import { devLog } from '@/utils/devLog';

// Backgrounded only briefly (e.g. a quick app switch) — not worth a full
// revalidation on every foreground; see Part 4's "foreground refresh
// throttling."
const FOREGROUND_REVALIDATE_AFTER_MS = 60_000;

export default function HomeScreen() {
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
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

      try {
        const response = await withRetry(() => getEmotions());
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.header, isRtl && styles.headerRtl]}>
          <View style={styles.headerTitleBlock}>
            <Text style={[styles.wordmark, direction]}>{messages.appName}</Text>
            <Text style={[styles.subtitle, direction]}>{messages.home.subtitle}</Text>
          </View>
          <View style={[styles.headerActions, isRtl && styles.headerActionsRtl]}>
            <Link href="/favorites" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.home.openFavorites}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Heart size={20} color={colors.ink} strokeWidth={2} />
              </Pressable>
            </Link>
            <Link href="/reflections" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.home.openReflections}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <NotebookPen size={20} color={colors.ink} strokeWidth={2} />
              </Pressable>
            </Link>
            <Link href="/settings" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.settings.openSettings}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Settings size={20} color={colors.ink} strokeWidth={2} />
              </Pressable>
            </Link>
          </View>
        </View>

        <View style={styles.prompt}>
          <Text style={[styles.eyebrow, direction]}>{messages.home.eyebrow}</Text>
          <Text style={[styles.title, direction]}>{messages.home.title}</Text>
        </View>

        {isLoading && (
          <StateView
            title={messages.home.loadingTitle}
            message={messages.home.loadingMessage}
            icon={<RefreshCw size={22} color={colors.olive} />}
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
          <View style={[styles.grid, isRtl && styles.gridRtl]}>
            {emotions.map((emotion) => (
              <EmotionCard
                key={emotion.key}
                emotion={emotion}
                onPress={() =>
                  router.push({
                    pathname: '/ayah/[emotion]',
                    params: { emotion: emotion.key, namesJson: JSON.stringify(emotion.names) },
                  })
                }
              />
            ))}
          </View>
        )}

        {/*
          Completely separate from the 29 emotion cards above — visually
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
          <BookOpen size={18} color={colors.ink} strokeWidth={2} />
          <Text style={[styles.generalQuranActionText, { writingDirection: direction.writingDirection }]}>
            {messages.generalQuran.action}
          </Text>
        </Pressable>

        <Text style={[styles.disclaimer, direction]}>{messages.home.disclaimer}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.parchment,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
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
    color: colors.ink,
    fontSize: 29,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.muted,
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
    color: colors.olive,
    fontSize: typography.small,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
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
    color: colors.ink,
    fontSize: typography.bodyLarge,
    fontWeight: '700',
  },
  disclaimer: {
    color: colors.softText,
    fontSize: typography.caption,
    lineHeight: 19,
    paddingHorizontal: spacing.xs,
  },
});
