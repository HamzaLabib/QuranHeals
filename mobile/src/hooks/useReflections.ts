import { useCallback, useEffect, useState } from 'react';

import { getVerseByKey } from '@/services/quran';
import { parseVerseKey } from '@/services/quranReference';
import { getAllReflections, type AyahReflection } from '@/storage/ayahReflections';
import { getLocalDataGeneration, getLocalDataOwnerState, subscribeToLocalDataOwner } from '@/storage/localDataOwner';
import { getConflictVersions, type ReflectionConflictVersion } from '@/storage/reflectionConflicts';

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
  /** Other versions sync kept for this ayah, awaiting review in the editor (D5). */
  otherVersionCount: number;
  /**
   * No current reflection exists (it was deleted, or replaced, elsewhere);
   * the item stands for the kept version(s) so they stay reachable. Its
   * `reflection` is built from the newest kept version and is never saved.
   */
  recoveredOnly: boolean;
};

async function resolveItem(reflection: AyahReflection, otherVersionCount = 0, recoveredOnly = false): Promise<ReflectionListItem> {
  const { surah, ayah } = parseVerseKey(reflection.verseKey);
  try {
    const verse = await getVerseByKey(reflection.verseKey);
    return { reflection, surahNumber: verse.surah, ayahNumber: verse.ayah, arabicText: verse.arabicText, otherVersionCount, recoveredOnly };
  } catch {
    // One ayah failing to resolve locally (rare: local DB unavailable) must
    // never drop this reflection or any other from the list.
    return { reflection, surahNumber: surah, ayahNumber: ayah, arabicText: null, otherVersionCount, recoveredOnly };
  }
}

/** A list entry for an ayah whose only text is kept versions. */
function recoveredReflection(versions: ReflectionConflictVersion[]): AyahReflection {
  const newest = versions.reduce((a, b) => (b.versionUpdatedAt > a.versionUpdatedAt ? b : a));
  return { verseKey: newest.verseKey, text: newest.text, createdAt: newest.versionUpdatedAt, updatedAt: newest.versionUpdatedAt };
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
  const [reflections, versions] = await Promise.all([
    getAllReflections(ownerUserId),
    // Kept versions are a review aid; failing to read them never hides reflections.
    getConflictVersions(ownerUserId).catch(() => [] as ReflectionConflictVersion[]),
  ]);
  const versionsByVerseKey = new Map<string, ReflectionConflictVersion[]>();
  for (const version of versions) versionsByVerseKey.set(version.verseKey, [...(versionsByVerseKey.get(version.verseKey) ?? []), version]);

  const current = new Set(reflections.map((reflection) => reflection.verseKey));
  const recovered = [...versionsByVerseKey.entries()]
    .filter(([verseKey]) => !current.has(verseKey))
    .map(([, kept]) => ({ reflection: recoveredReflection(kept), count: kept.length }));

  const entries = [
    ...reflections.map((reflection) => ({ reflection, count: versionsByVerseKey.get(reflection.verseKey)?.length ?? 0, recoveredOnly: false })),
    ...recovered.map((entry) => ({ ...entry, recoveredOnly: true })),
  ];
  const sorted = sortByUpdatedAtDesc(entries.map((entry) => entry.reflection));
  const byReflection = new Map(entries.map((entry) => [entry.reflection, entry]));
  return Promise.all(sorted.map((reflection) => {
    const entry = byReflection.get(reflection)!;
    return resolveItem(reflection, entry.count, entry.recoveredOnly);
  }));
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
