import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Emotion } from '@/types/domain';
import { getActiveLocalOwner, ownerStorageKey } from './localDataOwner';

/**
 * The emotions most recently chosen, for Home's four cards. Stored per owner
 * like favorites (localDataOwner.ts: the guest key, or `<key>:account:<id>`)
 * so one account never sees another's choices, and device-local: never
 * synced, like the recent-ayah history (docs/auth-and-sync/data-behavior.md).
 * A convenience only: it is not merged into an account, and an account's
 * copy is removed with the account.
 */
export const RECENT_EMOTIONS_STORAGE_KEY = 'quran-heals:recent-emotions:v1';
/** Home shows this many emotions. */
export const HOME_EMOTION_COUNT = 4;
/** Kept to cover choices of emotions that are later withdrawn from the catalog. */
const KEEP = 12;

const keyFor = async (ownerUserId?: string | null) =>
  ownerStorageKey(RECENT_EMOTIONS_STORAGE_KEY, ownerUserId === undefined ? await getActiveLocalOwner() : ownerUserId);

/** Most recent first, distinct; never throws (unreadable storage reads as none). */
export async function loadRecentEmotionKeys(ownerUserId?: string | null): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(await keyFor(ownerUserId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((key): key is string => typeof key === 'string' && key.length > 0 && key.length <= 100))].slice(0, KEEP);
  } catch {
    return [];
  }
}

let chain: Promise<unknown> = Promise.resolve();

/** Moves `emotionKey` to the front. A failed write is ignored: choosing an emotion never fails because of this. */
export function recordEmotionUse(emotionKey: string): Promise<void> {
  const run = chain.then(async () => {
    try {
      const key = await keyFor();
      const recent = await loadRecentEmotionKeys();
      await AsyncStorage.setItem(key, JSON.stringify([emotionKey, ...recent.filter((k) => k !== emotionKey)].slice(0, KEEP)));
    } catch {
      // A convenience only.
    }
  });
  chain = run;
  return run;
}

/** Account deletion: that account's list on this device. */
export async function clearRecentEmotions(userId: string): Promise<void> {
  await AsyncStorage.removeItem(ownerStorageKey(RECENT_EMOTIONS_STORAGE_KEY, userId));
}

/**
 * Home's emotions: the most recently chosen ones still in the catalog, most
 * recent first, then the catalog's own first emotions (in its order) to fill
 * the rest. Never a duplicate; fewer only when the catalog itself is smaller.
 */
export function pickHomeEmotions(catalog: readonly Emotion[], recentKeys: readonly string[], count = HOME_EMOTION_COUNT): Emotion[] {
  const byKey = new Map(catalog.map((emotion) => [emotion.key, emotion]));
  const picked: Emotion[] = [];
  const seen = new Set<string>();
  for (const key of [...recentKeys, ...catalog.map((emotion) => emotion.key)]) {
    const emotion = byKey.get(key);
    if (!emotion || seen.has(key)) continue;
    seen.add(key);
    picked.push(emotion);
    if (picked.length === count) break;
  }
  return picked;
}
