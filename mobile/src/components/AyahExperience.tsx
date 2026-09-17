import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, RefreshCw, Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFavorites } from '@/hooks/useFavorites';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getApiErrorMessage, getRandomAyah } from '@/services/api';
import { getRandomGeneralAyah } from '@/services/generalQuran';
import { withRetry } from '@/services/retry';
import { buildExhaustionRetryExclusions, getExcludedVerseKeys, GENERAL_QURAN_HISTORY_KEY, recordShownAyah } from '@/storage/recentAyahHistory';
import type { Ayah, LocalizedText } from '@/types/domain';
import { resolveLocalizedEmotionName } from '@/utils/emotionLabel';
import { AyahCard } from './AyahCard';
import { FavoriteButton } from './FavoriteButton';
import { ReflectionSheet } from './ReflectionSheet';
import { ReportIssueSheet } from './ReportIssueSheet';
import { StateView } from './StateView';
import { colors, radii, spacing, typography } from '@/constants/theme';

/**
 * The one shared ayah-viewing experience for BOTH flows this app supports:
 *  - `{ mode: 'emotion' }`: an approved emotion↔ayah mapping (the existing
 *    29-emotion system, entirely unchanged).
 *  - `{ mode: 'general' }`: "Need an ayah from the Quran?" — any of the
 *    complete 6,236 verified ayahs, with no emotion/mapping involved at
 *    all. This is intentionally NOT a 30th emotion: there is no emotionKey,
 *    no Emotion document, no mapping, anywhere in this mode.
 *
 * Callers (app/ayah/[emotion].tsx, app/ayah/general.tsx) only parse route
 * params and hand this component a `source`; every behavioral difference
 * between the two flows (selection, recent-history namespace, "Another
 * ayah" scope, the issue report's emotionKey) is decided from `source.mode`
 * here, never from any localized text (Part 6 of the general-Quran-flow
 * spec).
 */
export type AyahSource = { mode: 'emotion'; emotionKey: string; names?: LocalizedText } | { mode: 'general' };

type AyahExperienceProps = {
  source: AyahSource;
};

export function AyahExperience({ source }: AyahExperienceProps) {
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const [ayah, setAyah] = useState<Ayah | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const { isFavorite, toggleFavorite, error: favoritesError } = useFavorites();
  const [isReflectionVisible, setIsReflectionVisible] = useState(false);
  const [isReportVisible, setIsReportVisible] = useState(false);
  // Guards against a rapid double-tap firing two overlapping loadAyah() runs:
  // without this, both could read the same not-yet-updated recent-history
  // snapshot and independently be free to land on the same ayah.
  const isLoadingRef = useRef(false);

  // Locale-aware display only. In emotion mode the stable route key
  // (emotionKey) is never altered by this — it still goes to the
  // API/history exactly as received, and re-resolves automatically if the
  // user changes the app language while this screen is open. In general
  // mode there is no emotion name to show, so the app's own name is used —
  // an existing, always-defined string, not a new one invented for this
  // header.
  const headerTitle = useMemo(
    () => (source.mode === 'emotion' ? resolveLocalizedEmotionName(source.names, locale, source.emotionKey) : messages.appName),
    [source, locale, messages.appName],
  );

  // The recent-history namespace: the emotionKey itself in emotion mode, or
  // the reserved, never-user-visible, never-a-real-emotionKey general-flow
  // key in general mode. Both live in the exact same storage module/map —
  // see recentAyahHistory.ts's doc comment — so the emotion flow's own
  // history is never read or touched by general-mode loads, and vice versa.
  const historyKey = source.mode === 'emotion' ? source.emotionKey : GENERAL_QURAN_HISTORY_KEY;

  const loadAyah = useCallback(async () => {
    if (source.mode === 'emotion' && !source.emotionKey) {
      setErrorMessage(messages.ayah.missingEmotion);
      setIsLoading(false);
      return;
    }

    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);
    setErrorMessage(null);
    setHistoryMessage(null);

    try {
      let excludedVerseKeys: string[] = [];
      try {
        excludedVerseKeys = await getExcludedVerseKeys(historyKey);
      } catch {
        setHistoryMessage(messages.ayah.historyReadFailed);
      }

      // A transient backend/network hiccup (exactly what's likely right
      // after the app resumes from background/lock) gets a short bounded
      // retry before falling back to the existing manual "Try Again" state
      // — see Part 4 of the background/resume-reliability phase.
      const fetchAyah = (exclude: string[]) =>
        withRetry(() => (source.mode === 'emotion' ? getRandomAyah(source.emotionKey, exclude) : getRandomGeneralAyah(exclude)));

      let nextAyah = await fetchAyah(excludedVerseKeys);

      // Exhaustion fallback: see buildExhaustionRetryExclusions — at most
      // one bounded follow-up request, never a loop. In general mode the
      // 6,236-ayah pool makes this exceedingly unlikely to ever trigger.
      const retryExcludedVerseKeys = buildExhaustionRetryExclusions(excludedVerseKeys, nextAyah.verseKey);
      if (retryExcludedVerseKeys) {
        try {
          nextAyah = await fetchAyah(retryExcludedVerseKeys);
        } catch {
          // Keep the first (already-fetched, still valid) response — a
          // failed bounded retry must never block displaying an ayah.
        }
      }

      setAyah(nextAyah);
      try {
        await recordShownAyah(historyKey, nextAyah);
      } catch {
        setHistoryMessage(messages.ayah.historySaveFailed);
      }
    } catch (error) {
      const fallback = source.mode === 'emotion' ? messages.ayah.genericError : messages.generalQuran.loadError;
      setErrorMessage(getApiErrorMessage(error, fallback));
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messages is stable per locale; re-running on every message identity change is unnecessary
  }, [source, historyKey]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void loadAyah();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [loadAyah]);

  const shareAyah = useCallback(async () => {
    if (!ayah) {
      return;
    }

    await Share.share({
      message: `${ayah.arabicText}\n\n${ayah.englishTranslation}\n\n${ayah.surahNameEnglish} ${ayah.surahNumber}:${ayah.ayahNumber}\n\n${ayah.quranTextSource}\n\nQuran Heals`,
    });
  }, [ayah]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.header, isRtl && styles.headerRtl]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <BackIcon size={22} color={colors.ink} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.emotion, direction]}>{headerTitle}</Text>
            <Text style={[styles.kicker, direction]}>{messages.ayah.kicker}</Text>
          </View>
        </View>

        {isLoading && (
          <StateView
            title={messages.ayah.loadingTitle}
            message={messages.ayah.loadingMessage}
            icon={<RefreshCw size={22} color={colors.olive} />}
            spin
          />
        )}

        {!isLoading && errorMessage && (
          <StateView
            title={messages.ayah.errorTitle}
            message={errorMessage}
            actionLabel={messages.ayah.retry}
            onAction={loadAyah}
          />
        )}

        {!isLoading && !errorMessage && ayah && (
          <>
            <AyahCard ayah={ayah} />

            {favoritesError && <StateView title={messages.favorites.title} message={favoritesError} />}
            {historyMessage && <StateView title={messages.favorites.title} message={historyMessage} />}

            <View style={[styles.actions, isRtl && styles.actionsRtl]}>
              <FavoriteButton isSaved={isFavorite(ayah)} onToggle={() => toggleFavorite(ayah)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.ayah.shareAyah}
                onPress={shareAyah}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Share2 size={18} color={colors.ink} />
                <Text style={styles.secondaryButtonText}>{messages.ayah.share}</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={messages.ayah.loadAnotherAyah}
              onPress={loadAyah}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <RefreshCw size={19} color={colors.surface} />
              <Text style={styles.primaryButtonText}>{messages.ayah.anotherAyah}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={messages.reflection.writeAction}
              onPress={() => setIsReflectionVisible(true)}
              style={({ pressed }) => [styles.secondaryButton, styles.reflectionButton, pressed && styles.pressed]}>
              <Text style={[styles.secondaryButtonText, direction, styles.reflectionButtonText]}>
                {messages.reflection.writeAction}
              </Text>
            </Pressable>

            <View style={styles.tertiaryActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.issueReport.action}
                onPress={() => setIsReportVisible(true)}
                style={({ pressed }) => [styles.tertiaryButton, pressed && styles.pressed]}>
                <Text style={styles.tertiaryButtonText}>{messages.issueReport.action}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <ReflectionSheet
        visible={isReflectionVisible}
        verseKey={ayah?.verseKey ?? null}
        onClose={() => setIsReflectionVisible(false)}
      />
      <ReportIssueSheet
        visible={isReportVisible}
        onClose={() => setIsReportVisible(false)}
        context={{
          verseKey: ayah?.verseKey,
          surahNumber: ayah?.surahNumber,
          ayahNumber: ayah?.ayahNumber,
          // Never invented for general mode ("random"/"general"/"quran") —
          // simply absent, per Part 12 of the general-Quran-flow spec.
          emotionKey: source.mode === 'emotion' ? source.emotionKey : undefined,
        }}
      />
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
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerRtl: {
    flexDirection: 'row-reverse',
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
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  emotion: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: 0,
  },
  kicker: {
    color: colors.muted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionsRtl: {
    flexDirection: 'row-reverse',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  reflectionButton: {
    flex: 0,
    paddingVertical: spacing.md,
  },
  reflectionButtonText: {
    flexShrink: 1,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: '800',
  },
  tertiaryActions: {
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    paddingTop: spacing.xs,
  },
  tertiaryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tertiaryButtonText: {
    color: colors.muted,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});
