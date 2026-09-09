import { router } from 'expo-router';
import { ArrowLeft, Heart, Share2, Trash2 } from 'lucide-react-native';
import { useCallback } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AyahCard } from '@/components/AyahCard';
import { StateView } from '@/components/StateView';
import { colors, radii, spacing, typography } from '@/constants/theme';
import { useFavorites } from '@/hooks/useFavorites';
import type { FavoriteAyah } from '@/types/domain';

type FavoriteActionsProps = {
  favorite: FavoriteAyah;
  onRemove: (id: string) => void;
};

function FavoriteActions({ favorite, onRemove }: FavoriteActionsProps) {
  const shareFavorite = useCallback(async () => {
    await Share.share({
      message: `${favorite.arabicText}\n\n${favorite.englishTranslation}\n\n${favorite.surahNameEnglish} ${favorite.surahNumber}:${favorite.ayahNumber}\n\n${favorite.quranTextSource}\n\nQuran Heals`,
    });
  }, [favorite]);

  return (
    <View style={styles.cardActions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share saved ayah"
        onPress={shareFavorite}
        style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
        <Share2 size={17} color={colors.ink} />
        <Text style={styles.smallButtonText}>Share</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Remove saved ayah"
        onPress={() => onRemove(favorite.id)}
        style={({ pressed }) => [styles.smallButton, styles.removeButton, pressed && styles.pressed]}>
        <Trash2 size={17} color={colors.rust} />
        <Text style={[styles.smallButtonText, styles.removeText]}>Remove</Text>
      </Pressable>
    </View>
  );
}

export default function FavoritesScreen() {
  const { favorites, removeFavorite, isReady, error, unresolvedCount, refreshFavorites } = useFavorites();

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
            <Text style={styles.title}>Saved Ayahs</Text>
            <Text style={styles.subtitle}>Favorites stored on this device.</Text>
          </View>
        </View>

        {!isReady && (
          <StateView
            title="Loading favorites"
            message="Opening your saved ayahs."
            icon={<Heart size={22} color={colors.olive} />}
          />
        )}

        {isReady && (error || unresolvedCount > 0) && (
          <StateView
            title="Some saved ayahs could not be opened"
            message={error ?? `${unresolvedCount} saved ${unresolvedCount === 1 ? 'ayah could' : 'ayahs could'} not be resolved. Your stored entries have been kept.`}
            actionLabel="Try Again"
            onAction={refreshFavorites}
          />
        )}

        {isReady && !error && unresolvedCount === 0 && favorites.length === 0 && (
          <StateView
            title="No saved ayahs yet"
            message="Save an ayah from the reflection screen and it will appear here."
          />
        )}

        {isReady &&
          favorites.map((favorite) => (
            <View key={favorite.id} style={styles.favoriteItem}>
              <AyahCard ayah={favorite} compact />
              <FavoriteActions favorite={favorite} onRemove={removeFavorite} />
            </View>
          ))}
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
  favoriteItem: {
    gap: spacing.sm,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
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
    color: colors.ink,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  removeButton: {
    borderColor: colors.rustSoft,
  },
  removeText: {
    color: colors.rust,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});
