import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, Heart, Share2, Trash2 } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/useAuth';
import { useSyncOnFocus } from '@/hooks/useSyncOnFocus';
import { AyahCard } from '@/components/AyahCard';
import { SettingsHeaderButton } from '@/components/SettingsHeaderButton';
import { ShareAyahSheet } from '@/components/ShareAyahSheet';
import { StateView } from '@/components/StateView';
import { pageHeaderText, radii, spacing, typography, type Palette } from '@/constants/theme';
import { useContentColumnStyle } from '@/layout/useWindowClass';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { useFavorites } from '@/hooks/useFavorites';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import type { Messages } from '@/localization/messages';
import type { FavoriteAyah } from '@/types/domain';
import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';

type FavoriteActionsProps = {
  favorite: FavoriteAyah;
  onShare: (favorite: FavoriteAyah) => void;
  onRemove: (id: string) => void;
  messages: Messages;
  isRtl: boolean;
};

function FavoriteActions({ favorite, onShare, onRemove, messages, isRtl }: FavoriteActionsProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.cardActions, isRtl && styles.cardActionsRtl]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={messages.favorites.shareSaved}
        onPress={() => onShare(favorite)}
        style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
        <Share2 size={17} color={colors.icon} />
        <Text style={styles.smallButtonText}>{messages.favorites.share}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={messages.favorites.removeSaved}
        onPress={() => onRemove(favorite.id)}
        style={({ pressed }) => [styles.smallButton, styles.removeButton, pressed && styles.pressed]}>
        <Trash2 size={17} color={colors.danger} />
        <Text style={[styles.smallButtonText, styles.removeText]}>{messages.favorites.remove}</Text>
      </Pressable>
    </View>
  );
}

export default function FavoritesScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  // Tablets: a centred content column (layout/windowClass.ts); phones: unchanged.
  const column = useContentColumnStyle();
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  const { favorites, removeFavorite, isReady, error, unresolvedCount, refreshFavorites } = useFavorites();
  const { refreshSync } = useAuth();
  // Opening (or returning to) Saved Ayahs picks up another device's changes:
  // the same full sync as pull-to-refresh, behind the Sync Password, throttled.
  useSyncOnFocus('all');
  // Guards a rapid repeated pull gesture from starting a second, overlapping
  // sync + local re-read while one is already in flight (a ref, not just
  // the `isRefreshing` state below — see pullToRefresh.ts's doc comment for
  // why a ref is required here).
  const refreshGuardRef = useRef<RefreshInFlightRef>({ current: false });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sharedFavorite, setSharedFavorite] = useState<FavoriteAyah | null>(null);

  const onPullToRefresh = useCallback(async () => {
    await runGuardedRefresh(refreshGuardRef.current, async () => {
      setIsRefreshing(true);
      try {
        // Reuses the exact same sync run as sign-in/app-foreground
        // (favorites + preferences + reflections) — a no-op for a guest.
        // Never a duplicate sync implementation.
        await refreshSync();
        // Picks up whatever that sync just wrote to local storage (or, for
        // a guest, simply re-reads current local state).
        await refreshFavorites();
      } finally {
        setIsRefreshing(false);
      }
    });
  }, [refreshSync, refreshFavorites]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, column]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void onPullToRefresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }>
        <View style={[styles.header, isRtl && styles.headerRtl]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <BackIcon size={22} color={colors.icon} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, direction]}>{messages.favorites.title}</Text>
            <Text style={[styles.subtitle, direction]}>{messages.favorites.subtitle}</Text>
          </View>
          <SettingsHeaderButton style={styles.iconButton} pressedStyle={styles.pressed} />
        </View>

        {!isReady && (
          <StateView
            title={messages.favorites.loadingTitle}
            message={messages.favorites.loadingMessage}
            icon={<Heart size={22} color={colors.accent} />}
          />
        )}

        {isReady && (error || unresolvedCount > 0) && (
          <StateView
            title={messages.favorites.errorTitle}
            message={error ?? `${unresolvedCount} ${messages.favorites.unresolvedSuffix}`}
            actionLabel={messages.favorites.retry}
            onAction={refreshFavorites}
          />
        )}

        {isReady && !error && unresolvedCount === 0 && favorites.length === 0 && (
          <StateView title={messages.favorites.emptyTitle} message={messages.favorites.emptyMessage} />
        )}

        {isReady &&
          favorites.map((favorite) => (
            <View key={favorite.id} style={styles.favoriteItem}>
              <AyahCard ayah={favorite} compact />
              <FavoriteActions favorite={favorite} onRemove={removeFavorite} onShare={setSharedFavorite} messages={messages} isRtl={isRtl} />
            </View>
          ))}
      </ScrollView>

      <ShareAyahSheet visible={sharedFavorite !== null} ayah={sharedFavorite} onClose={() => setSharedFavorite(null)} />
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
  headerText: pageHeaderText(colors).block,
  title: pageHeaderText(colors).title,
  subtitle: pageHeaderText(colors).subtitle,
  favoriteItem: {
    gap: spacing.sm,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardActionsRtl: {
    flexDirection: 'row-reverse',
  },
  smallButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  smallButtonText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  removeButton: {
    borderColor: colors.dangerBorder,
  },
  removeText: {
    color: colors.danger,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});
