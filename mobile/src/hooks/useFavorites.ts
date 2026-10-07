import { useCallback, useEffect, useState } from 'react';

import { getCurrentSessionToken } from '@/auth/useAuth';
import { resolveVerseKey } from '@/services/quranReference';
import { addFavorite, favoriteMatchesAyah, getFavoriteState, removeFavorite as removeStoredFavorite, type FavoriteReadResult } from '@/storage/favorites';
import { getLocalDataGeneration, getLocalDataOwnerState, subscribeToLocalDataOwner } from '@/storage/localDataOwner';
import { addCloudFavorites, removeCloudFavorite } from '@/sync/syncApi';
import type { Ayah, FavoriteAyah } from '@/types/domain';

/**
 * Best-effort, fire-and-forget propagation to the cloud when signed in — a
 * failure here never affects the already-applied local change (Part E: the
 * device is always correct locally; sync catches up later, e.g. on the next
 * full sync at sign-in/reconnect). Only for an account's own change, and
 * only while that account is still the active one: a guest change, or one
 * made just before a sign-out/account switch, is never sent with another
 * session's token (the next full sync of its own account carries it).
 */
async function propagateToCloud(action: 'add' | 'remove', verseKey: string, owner: string | null, generation: number) {
  if (owner === null || generation !== getLocalDataGeneration()) return;
  const token = await getCurrentSessionToken().catch(() => null);
  if (!token || generation !== getLocalDataGeneration()) return;
  try {
    if (action === 'add') {
      await addCloudFavorites(token, [verseKey]);
    } else {
      await removeCloudFavorite(token, verseKey);
    }
  } catch {
    // Swallowed deliberately — see doc comment above.
  }
}

/** The active owner, or null while it is not yet known (see localDataOwner.ts's `resolved`). */
async function resolvedOwner(): Promise<{ owner: string | null } | null> {
  const { activeUserId, resolved } = await getLocalDataOwnerState();
  return resolved ? { owner: activeUserId } : null;
}

/**
 * The active owner's favorites (the signed-in account's, or the guest's).
 * When the owner changes (sign-in, sign-out, account switch) what is shown
 * is dropped at once and the new owner's favorites load in its place, so a
 * previous account's favorites never stay on screen; results of reads or
 * changes begun for an earlier owner are discarded.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteAyah[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unresolvedCount, setUnresolvedCount] = useState(0);

  const applyResult = useCallback((result: FavoriteReadResult) => {
    setFavorites(result.favorites);
    setUnresolvedCount(result.unresolvedCount);
    setError(null);
  }, []);

  const refreshFavorites = useCallback(async () => {
    const generation = getLocalDataGeneration();
    try {
      const active = await resolvedOwner();
      // Not known yet: stay loading; the owner change reloads.
      if (!active) return;
      const result = await getFavoriteState(active.owner);
      if (generation !== getLocalDataGeneration()) return;
      applyResult(result);
      setIsReady(true);
    } catch {
      if (generation !== getLocalDataGeneration()) return;
      setError('Saved ayahs could not be read. Your stored data has been kept. Please try again.');
      setIsReady(true);
    }
  }, [applyResult]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshFavorites();
    }, 0);
    const unsubscribe = subscribeToLocalDataOwner((change) => {
      if (change === 'owner') {
        setFavorites([]);
        setUnresolvedCount(0);
        setError(null);
        setIsReady(false);
      }
      void refreshFavorites();
    });

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [refreshFavorites]);

  const isFavorite = useCallback((ayah: Ayah | string) => favorites.some(favorite => favoriteMatchesAyah(favorite, ayah)), [favorites]);

  const removeFavorite = useCallback(async (id: string) => {
    const generation = getLocalDataGeneration();
    try {
      const active = await resolvedOwner();
      if (!active || generation !== getLocalDataGeneration()) return;
      const removed = favorites.find((favorite) => favorite.id === id);
      const result = await removeStoredFavorite(id, active.owner);
      if (generation !== getLocalDataGeneration()) return;
      applyResult(result);
      if (removed) void propagateToCloud('remove', resolveVerseKey(removed), active.owner, generation);
    } catch {
      if (generation === getLocalDataGeneration()) setError('The saved ayah could not be removed. Please try again.');
    }
  }, [applyResult, favorites]);

  const toggleFavorite = useCallback(
    async (ayah: Ayah) => {
      const generation = getLocalDataGeneration();
      try {
        const active = await resolvedOwner();
        if (!active || generation !== getLocalDataGeneration()) return;
        const saved = favorites.find(favorite => favoriteMatchesAyah(favorite, ayah));
        const result = saved ? await removeStoredFavorite(saved.id, active.owner) : await addFavorite(ayah, active.owner);
        if (generation !== getLocalDataGeneration()) return;
        applyResult(result);
        void propagateToCloud(saved ? 'remove' : 'add', resolveVerseKey(ayah), active.owner, generation);
      } catch {
        if (generation === getLocalDataGeneration()) setError('Saved ayahs could not be updated. Please try again.');
      }
    },
    [favorites, applyResult],
  );

  return {
    favorites,
    isReady,
    error,
    unresolvedCount,
    isFavorite,
    removeFavorite,
    toggleFavorite,
    refreshFavorites,
  };
}
