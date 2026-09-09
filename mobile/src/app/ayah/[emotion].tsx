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
import { getApiErrorMessage, getRandomAyah } from '@/services/api';
import { getRecentAyahState, rememberAyahForEmotion } from '@/storage/recentAyahs';
import type { Ayah } from '@/types/domain';

export default function AyahScreen() {
  const params = useLocalSearchParams<{ emotion?: string }>();
  const rawEmotion = params.emotion;
  const emotionKey =
    typeof rawEmotion === 'string'
      ? rawEmotion
      : Array.isArray(rawEmotion)
        ? rawEmotion[0]
        : undefined;
  const [ayah, setAyah] = useState<Ayah | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const { isFavorite, toggleFavorite, error: favoritesError } = useFavorites();

  const readableEmotion = useMemo(() => {
    if (!emotionKey) {
      return 'Emotion';
    }

    return emotionKey
      .split('-')
      .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }, [emotionKey]);

  const loadAyah = useCallback(async () => {
    if (!emotionKey) {
      setErrorMessage('Please choose an emotion first.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setHistoryMessage(null);

    try {
      let excludedIds: string[] = [];
      try {
        const recent = await getRecentAyahState(emotionKey);
        excludedIds = recent.ids;
        if (recent.unresolvedCount > 0) setHistoryMessage('Some older history entries could not be used to prevent repeats. Your stored history has been kept.');
      } catch {
        setHistoryMessage('Recent history could not be read. Your stored history has been kept.');
      }
      const nextAyah = await getRandomAyah(emotionKey, excludedIds);
      setAyah(nextAyah);
      try {
        await rememberAyahForEmotion(emotionKey, nextAyah);
      } catch {
        setHistoryMessage('This ayah could not be added to recent history. Your previous history has been kept.');
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "We couldn't load an ayah right now."));
    } finally {
      setIsLoading(false);
    }
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
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <ArrowLeft size={22} color={colors.ink} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.emotion}>{readableEmotion}</Text>
            <Text style={styles.kicker}>A selected ayah for this moment</Text>
          </View>
        </View>

        {isLoading && (
          <StateView
            title="Loading ayah"
            message="Finding a relevant ayah."
            icon={<RefreshCw size={22} color={colors.olive} />}
          />
        )}

        {!isLoading && errorMessage && (
          <StateView
            title="Please try again"
            message={errorMessage}
            actionLabel="Try Again"
            onAction={loadAyah}
          />
        )}

        {!isLoading && !errorMessage && ayah && (
          <>
            <AyahCard ayah={ayah} />

            {favoritesError && <StateView title="Saved ayahs" message={favoritesError} />}
            {historyMessage && <StateView title="Recent ayahs" message={historyMessage} />}

            <View style={styles.actions}>
              <FavoriteButton isSaved={isFavorite(ayah)} onToggle={() => toggleFavorite(ayah)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share ayah"
                onPress={shareAyah}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Share2 size={18} color={colors.ink} />
                <Text style={styles.secondaryButtonText}>Share</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Load another ayah"
              onPress={loadAyah}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <RefreshCw size={19} color={colors.surface} />
              <Text style={styles.primaryButtonText}>Another Ayah</Text>
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
