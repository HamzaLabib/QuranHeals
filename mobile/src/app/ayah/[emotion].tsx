import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, RefreshCw, Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AyahCard } from '@/components/AyahCard';
import { FavoriteButton } from '@/components/FavoriteButton';
import { StateView } from '@/components/StateView';
import { colors, radii, spacing, typography } from '@/constants/theme';
import { useFavorites } from '@/hooks/useFavorites';
import { getDirectionStyle } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getApiErrorMessage, getRandomAyah } from '@/services/api';
import { getRecentVerseKeyState, rememberAyahForEmotion } from '@/storage/recentAyahs';
import type { Ayah, LocalizedText } from '@/types/domain';
import { resolveLocalizedEmotionName } from '@/utils/emotionLabel';

/** `namesJson` carries the full localized names map from the emotion-picker screen (which already fetched it) as a JSON string route param — parsed defensively since a stale/deep-linked navigation may not carry it at all. */
function parseNamesParam(raw: string | string[] | undefined): LocalizedText | undefined {
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as LocalizedText;
    }
  } catch {
    // Malformed param: fall through to the key-based fallback in resolveLocalizedEmotionName.
  }
  return undefined;
}

export default function AyahScreen() {
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const params = useLocalSearchParams<{ emotion?: string; namesJson?: string }>();
  const rawEmotion = params.emotion;
  const emotionKey =
    typeof rawEmotion === 'string'
      ? rawEmotion
      : Array.isArray(rawEmotion)
        ? rawEmotion[0]
        : undefined;
  const names = useMemo(() => parseNamesParam(params.namesJson), [params.namesJson]);
  const [ayah, setAyah] = useState<Ayah | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const { isFavorite, toggleFavorite, error: favoritesError } = useFavorites();

  // Locale-aware display only. The stable route key (emotionKey) is never
  // altered by this — it still goes to the API/history exactly as received,
  // and re-resolves automatically if the user changes the app language
  // while this screen is open (names/locale are both in the dependency list).
  const readableEmotion = useMemo(
    () => resolveLocalizedEmotionName(names, locale, emotionKey),
    [names, locale, emotionKey],
  );

  const loadAyah = useCallback(async () => {
    if (!emotionKey) {
      setErrorMessage(messages.ayah.missingEmotion);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setHistoryMessage(null);

    try {
      let excludedVerseKeys: string[] = [];
      try {
        const recent = await getRecentVerseKeyState(emotionKey);
        excludedVerseKeys = recent.verseKeys;
        if (recent.unresolvedCount > 0) setHistoryMessage(messages.ayah.historyUnresolved);
      } catch {
        setHistoryMessage(messages.ayah.historyReadFailed);
      }
      const nextAyah = await getRandomAyah(emotionKey, excludedVerseKeys);
      setAyah(nextAyah);
      try {
        await rememberAyahForEmotion(emotionKey, nextAyah);
      } catch {
        setHistoryMessage(messages.ayah.historySaveFailed);
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, messages.ayah.genericError));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messages is stable per locale; re-running on every message identity change is unnecessary
  }, [emotionKey]);

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
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <ArrowLeft size={22} color={colors.ink} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.emotion, direction]}>{readableEmotion}</Text>
            <Text style={[styles.kicker, direction]}>{messages.ayah.kicker}</Text>
          </View>
        </View>

        {isLoading && (
          <StateView
            title={messages.ayah.loadingTitle}
            message={messages.ayah.loadingMessage}
            icon={<RefreshCw size={22} color={colors.olive} />}
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

            <View style={styles.actions}>
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
          </>
        )}
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
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});
