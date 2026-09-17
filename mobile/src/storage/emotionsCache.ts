import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Emotion } from '@/types/domain';

// The 29-emotion list changes only on a backend deploy, never per-user —
// caching it locally (Part 4: "Cache the successfully loaded emotion list
// locally") lets the home screen render instantly from the last good
// response while a fresh copy loads in the background, instead of showing
// a blocking spinner (or worse, an error) every time the app resumes.
const EMOTIONS_CACHE_KEY = 'quran-heals:emotions-cache:v1';

type CachedEmotions = { emotions: Emotion[] };

function isEmotionArray(value: unknown): value is Emotion[] {
  return Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object' && typeof (entry as { key?: unknown }).key === 'string');
}

export async function getCachedEmotions(): Promise<Emotion[] | null> {
  try {
    const raw = await AsyncStorage.getItem(EMOTIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEmotions;
    return isEmotionArray(parsed?.emotions) ? parsed.emotions : null;
  } catch {
    return null;
  }
}

/** Replaces the cache only when called with a genuinely successful response — never with an empty/error result (Part 4: "Replace cached data only when a valid successful response is received"). */
export async function setCachedEmotions(emotions: Emotion[]): Promise<void> {
  try {
    await AsyncStorage.setItem(EMOTIONS_CACHE_KEY, JSON.stringify({ emotions } satisfies CachedEmotions));
  } catch {
    // Best-effort cache — a failed write must never block showing emotions.
  }
}
