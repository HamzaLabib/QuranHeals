import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReflectionListCard } from '@/components/ReflectionListCard';
import { ReflectionSheet } from '@/components/ReflectionSheet';
import { StateView } from '@/components/StateView';
import { colors, radii, spacing, typography } from '@/constants/theme';
import { useReflections, type ReflectionListItem } from '@/hooks/useReflections';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';

/**
 * My Reflections (خواطري) — a read-only, offline list over the same
 * device-local reflection storage/editor already used from the ayah screen
 * (see storage/ayahReflections.ts, ReflectionSheet.tsx). This screen never
 * duplicates the save logic or the Quran Arabic itself: Arabic is resolved
 * fresh per item from the local quran.sqlite repository (useReflections),
 * and editing reuses the existing ReflectionSheet unchanged.
 */
export default function ReflectionsScreen() {
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const { items, isReady, hasError, refresh } = useReflections();
  const [activeVerseKey, setActiveVerseKey] = useState<string | null>(null);

  const closeSheet = () => {
    setActiveVerseKey(null);
    // The sheet may have just changed this reflection's text/updatedAt (or
    // deleted it via an empty save) — reload so the list reflects that
    // immediately rather than showing stale text/timestamps.
    void refresh();
  };

  const showLoading = !isReady;
  const showError = isReady && hasError;
  const showEmpty = isReady && !hasError && items.length === 0;
  const listData = isReady && !hasError ? items : [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <FlatList<ReflectionListItem>
        data={listData}
        keyExtractor={(item) => item.reflection.verseKey}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerArea}>
            <View style={[styles.header, isRtl && styles.headerRtl]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.ayah.goBack}
                onPress={() => router.back()}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <BackIcon size={22} color={colors.ink} />
              </Pressable>
              <View style={styles.headerText}>
                <Text style={[styles.title, direction]}>{messages.reflections.title}</Text>
                <Text style={[styles.subtitle, direction]}>{messages.reflections.subtitle}</Text>
              </View>
            </View>

            {showLoading && (
              <StateView
                title={messages.reflections.loadingTitle}
                message={messages.reflections.loadingMessage}
                icon={<RefreshCw size={22} color={colors.olive} />}
                spin
              />
            )}

            {showError && (
              <StateView
                title={messages.reflections.errorTitle}
                message={messages.reflections.errorMessage}
                actionLabel={messages.reflections.retry}
                onAction={refresh}
              />
            )}

            {showEmpty && (
              <StateView title={messages.reflections.emptyTitle} message={messages.reflections.emptyMessage} />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <ReflectionListCard
            item={item}
            locale={locale}
            messages={messages}
            onPress={() => setActiveVerseKey(item.reflection.verseKey)}
          />
        )}
      />

      <ReflectionSheet visible={activeVerseKey !== null} verseKey={activeVerseKey} onClose={closeSheet} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.parchment,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  headerArea: {
    gap: spacing.lg,
    marginBottom: spacing.sm,
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
  title: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: '700',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.muted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.78,
  },
});
