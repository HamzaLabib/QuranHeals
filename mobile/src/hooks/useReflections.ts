import { useCallback, useEffect, useState } from 'react';

import { getVerseByKey } from '@/services/quran';
import { parseVerseKey } from '@/services/quranReference';
import { getAllReflections, type AyahReflection } from '@/storage/ayahReflections';
import { getLocalDataGeneration, getLocalDataOwnerState, subscribeToLocalDataOwner } from '@/storage/localDataOwner';

export type ReflectionListItem = {
  reflection: AyahReflection;
  surahNumber: number;
  ayahNumber: number;
  /**
   * The verified Arabic text from the local `quran.sqlite`, resolved fresh
   * at display time — never cached alongside the reflection in AsyncStorage
   * (see ayahReflections.ts). `null` means this one verseKey could not be
   * verified locally right now; the reflection itself is still kept and
   * shown, never dropped from the list.
   */
  arabicText: string | null;
};

async function resolveItem(reflection: AyahReflection): Promise<ReflectionListItem> {
  const { surah, ayah } = parseVerseKey(reflection.verseKey);
  try {
    const verse = await getVerseByKey(reflection.verseKey);
    return { reflection, surahNumber: verse.surah, ayahNumber: verse.ayah, arabicText: verse.arabicText };
  } catch {
    // One ayah failing to resolve locally (rare: local DB unavailable) must
    // never drop this reflection or any other from the list.
    return { reflection, surahNumber: surah, ayahNumber: ayah, arabicText: null };
  }
}

function sortByUpdatedAtDesc(reflections: AyahReflection[]): AyahReflection[] {
  return [...reflections].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Loads every device-local reflection (guest or signed-in — this never
 * touches the network or requires auth), newest edit first, resolving each
 * one's Arabic text from the local Quran repository. A plain async function
 * (not a hook) so it's directly testable without a React renderer — see
 * useReflections() below, which is a thin state wrapper around this.
 */
export async function loadReflectionListItems(ownerUserId?: string | null): Promise<ReflectionListItem[]> {
  const reflections = sortByUpdatedAtDesc(await getAllReflections(ownerUserId));
  return Promise.all(reflections.map(resolveItem));
}

/**
 * React state wrapper around loadReflectionListItems() for the My
 * Reflections screen. Shared by the screen so every reflection card reads
 * the same loaded list rather than each independently touching
 * AsyncStorage/sqlite.
 *
 * Shows only the active owner's reflections (see useFavorites.ts): an owner
 * change (sign-in, sign-out, account switch) drops the list at once and
 * loads the new owner's, and a read begun for an earlier owner is discarded.
 */
export function useReflections() {
  const [items, setItems] = useState<ReflectionListItem[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  const refresh = useCallback(async () => {
    const generation = getLocalDataGeneration();
    try {
      const { activeUserId, resolved } = await getLocalDataOwnerState();
      // Not known yet: stay loading; the owner change reloads.
      if (!resolved) return;
      const loaded = await loadReflectionListItems(activeUserId);
      if (generation !== getLocalDataGeneration()) return;
      setItems(loaded);
      setHasError(false);
      setIsReady(true);
    } catch {
      // Mirrors storage/ayahReflections.ts's own guarantee: a read failure
      // never discards or overwrites what's already stored on disk — this
      // hook simply reports the failure without touching prior state.
      if (generation !== getLocalDataGeneration()) return;
      setHasError(true);
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refresh();
    }, 0);
    const unsubscribe = subscribeToLocalDataOwner((change) => {
      if (change === 'owner') {
        setItems([]);
        setHasError(false);
        setIsReady(false);
      }
      void refresh();
    });
    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [refresh]);

  return { items, isReady, hasError, refresh };
}
