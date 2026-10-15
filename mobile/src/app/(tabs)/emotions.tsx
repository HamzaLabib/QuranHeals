import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmotionCard } from '@/components/EmotionCard';
import { SettingsHeaderButton } from '@/components/SettingsHeaderButton';
import { StateView } from '@/components/StateView';
import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getApiErrorMessage, getEmotions } from '@/services/api';
import { withRetry } from '@/services/retry';
import { getCachedEmotions, setCachedEmotions } from '@/storage/emotionsCache';
import { recordEmotionUse } from '@/storage/recentEmotions';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import type { Emotion } from '@/types/domain';
import { goBackOrHome } from '@/utils/goBackOrHome';
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.header, isRtl && styles.headerRtl]}>
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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding(insets.bottom) }]}>
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
                onPress={() => {
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
  titleBlock: { flex: 1, gap: 2 },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: typography.body, lineHeight: 22 },
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
