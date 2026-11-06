import type { Ayah } from '@/types/domain';

import { getAyah } from './api';
import { resolveVerseKey } from './quranReference';

export type AyahTranslation = { text: string; source: string };

/**
 * The English translation (and its attribution) for an ayah reference, from the same backend ayah endpoint Saved
 * Ayahs' translations come from (the device bundles only the Arabic). Used by My Reflections, whose stored
 * reflections hold only a verseKey and the person's own text — this never writes anything to storage, so a
 * reflection's storage, encryption and sync are untouched, and reflections saved before this existed work too.
 *
 * Kept in memory for the app session only. A failure (offline, backend down, unknown ayah, a response for a
 * different ayah, an empty translation) resolves to null and is not remembered, so the next look retries; the caller
 * shows nothing in its place, exactly as Saved Ayahs does for a translation it doesn't have yet.
 */
export function createAyahTranslationLookup(fetchAyah: (verseKey: string) => Promise<Ayah>, maxConcurrent = 4) {
  const cache = new Map<string, AyahTranslation>();
  const inFlight = new Map<string, Promise<AyahTranslation | null>>();
  // A long list mounts many cards at once: at most `maxConcurrent` requests run together (the backend's per-IP limit).
  let running = 0;
  const waiting: (() => void)[] = [];
  // A slot is taken synchronously, and a finished request hands its slot straight to the next waiting one.
  const acquire = (): Promise<void> => {
    if (running < maxConcurrent) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  async function fetchTranslation(verseKey: string): Promise<AyahTranslation | null> {
    await acquire();
    try {
      const ayah = await fetchAyah(verseKey);
      const text = ayah.englishTranslation.trim();
      if (resolveVerseKey(ayah) !== verseKey || text === '') return null;
      const translation = { text: ayah.englishTranslation, source: ayah.translationSource };
      cache.set(verseKey, translation);
      return translation;
    } catch {
      return null;
    } finally {
      release();
    }
  }

  return {
    /** Already loaded this session (synchronous, for a first render without a flash). */
    peek: (verseKey: string): AyahTranslation | null => cache.get(verseKey) ?? null,
    load(verseKey: string): Promise<AyahTranslation | null> {
      const cached = cache.get(verseKey);
      if (cached) return Promise.resolve(cached);
      const pending = inFlight.get(verseKey);
      if (pending) return pending;
      const request = fetchTranslation(verseKey).finally(() => inFlight.delete(verseKey));
      inFlight.set(verseKey, request);
      return request;
    },
  };
}

export const ayahTranslationLookup = createAyahTranslationLookup(getAyah);
