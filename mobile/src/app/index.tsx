import { Link, router } from 'expo-router';
import { BookOpen, Heart, RefreshCw, Settings } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmotionCard } from '@/components/EmotionCard';
import { StateView } from '@/components/StateView';
import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getApiErrorMessage, getEmotions } from '@/services/api';
import type { Emotion } from '@/types/domain';

export default function HomeScreen() {
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadEmotions = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await getEmotions();
      setEmotions(response);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, messages.home.errorTitle));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messages is stable per locale
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void loadEmotions();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [loadEmotions]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <View style={[styles.header, isRtl && styles.headerRtl]}>
          <View>
            <Text style={[styles.wordmark, direction]}>{messages.appName}</Text>
            <Text style={[styles.subtitle, direction]}>{messages.home.subtitle}</Text>
          </View>
          <View style={[styles.headerActions, isRtl && styles.headerActionsRtl]}>
            <Link href="/settings" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.settings.openSettings}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Settings size={20} color={colors.ink} strokeWidth={2} />
              </Pressable>
            </Link>
            <Link href="/favorites" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.home.openFavorites}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Heart size={20} color={colors.ink} strokeWidth={2} />
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
