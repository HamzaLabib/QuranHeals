import { Link, router } from 'expo-router';
import { Heart, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmotionCard } from '@/components/EmotionCard';
import { StateView } from '@/components/StateView';
import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { getEmotions } from '@/services/api';
import type { Emotion } from '@/types/domain';

export default function HomeScreen() {
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadEmotions = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await getEmotions();
      setEmotions(response);
    } catch {
      setErrorMessage("We couldn't load the emotions right now.");
    } finally {
      setIsLoading(false);
    }
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
        <View style={styles.header}>
          <View>
            <Text style={styles.wordmark}>Quran Heals</Text>
            <Text style={styles.subtitle}>{"Qur'anic guidance for every emotion."}</Text>
          </View>
          <Link href="/favorites" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open saved ayahs"
              style={({ pressed }) => [styles.favoritesButton, pressed && styles.pressed]}>
              <Heart size={20} color={colors.ink} strokeWidth={2} />
            </Pressable>
          </Link>
        </View>

        <View style={styles.prompt}>
          <Text style={styles.eyebrow}>Reflect with an ayah</Text>
          <Text style={styles.title}>How are you feeling?</Text>
        </View>

        {isLoading && (
          <StateView
            title="Loading emotions"
            message="Preparing the emotion list."
            icon={<RefreshCw size={22} color={colors.olive} />}
          />
        )}

        {!isLoading && errorMessage && (
          <StateView
            title="Unable to connect"
            message={errorMessage}
            actionLabel="Try Again"
            onAction={loadEmotions}
          />
        )}

        {!isLoading && !errorMessage && (
          <View style={styles.grid}>
            {emotions.map((emotion) => (
              <EmotionCard
                key={emotion.key}
                emotion={emotion}
                onPress={() =>
                  router.push({
                    pathname: '/ayah/[emotion]',
                    params: { emotion: emotion.key },
                  })
                }
              />
            ))}
          </View>
        )}

        <Text style={styles.disclaimer}>
          Quran Heals offers spiritual reflection and is not a substitute for professional care.
        </Text>
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
  favoritesButton: {
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
    gap: spacing.md,
  },
  disclaimer: {
    color: colors.softText,
    fontSize: typography.caption,
    lineHeight: 19,
    paddingHorizontal: spacing.xs,
  },
});
