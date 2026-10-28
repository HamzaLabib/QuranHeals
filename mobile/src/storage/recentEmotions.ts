import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Emotion } from '@/types/domain';
import { getActiveLocalOwner, ownerStorageKey } from './localDataOwner';

/**
 * The emotions most recently chosen, for Home's four cards. Stored per owner
 * like favorites (localDataOwner.ts: the guest key, or `<key>:account:<id>`)
 * so one account never sees another's choices. An account's list follows
 * it across devices (sync/preferencesSync.ts): every device's choices are
 * merged — one entry per emotion, its latest use — most recent first, at
 * most KEEP. A guest's list stays on the device and is never uploaded. An
 * account's copy is removed with the account.
 *
 * Stored as `{ key, at }` entries (`at`: epoch ms of the latest use). A list
 * saved before uses were timed (bare keys, most recent first) keeps its
 * order with instants below any real use, so on another device it never
 * outranks an emotion actually chosen since.
 */
export const RECENT_EMOTIONS_STORAGE_KEY = 'quran-heals:recent-emotions:v1';
/** Home shows this many emotions. */
export const HOME_EMOTION_COUNT = 4;
/** Kept to cover choices of emotions that are later withdrawn from the catalog. Mirrors backend preferencesMerge.ts RECENT_EMOTIONS_LIMIT. */
export const RECENT_EMOTIONS_KEEP = 12;
const KEEP = RECENT_EMOTIONS_KEEP;

/** One emotion's latest use (epoch ms). */
export type RecentEmotionUse = { key: string; at: number };

const isEmotionKey = (key: unknown): key is string => typeof key === 'string' && key.length > 0 && key.length <= 100;

const keyFor = async (ownerUserId?: string | null) =>
  ownerStorageKey(RECENT_EMOTIONS_STORAGE_KEY, ownerUserId === undefined ? await getActiveLocalOwner() : ownerUserId);

/** The union of two histories: one entry per emotion (its latest use), most recent first, at most KEEP. Mirrors the server's. */
export function mergeRecentEmotionUses(a: readonly RecentEmotionUse[], b: readonly RecentEmotionUse[]): RecentEmotionUse[] {
  const latest = new Map<string, RecentEmotionUse>();
  for (const entry of [...a, ...b]) {
    const known = latest.get(entry.key);
    if (!known || entry.at > known.at) latest.set(entry.key, { key: entry.key, at: entry.at });
  }
  return [...latest.values()].sort((x, y) => y.at - x.at || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0)).slice(0, KEEP);
}

export const sameRecentEmotionUses = (a: readonly RecentEmotionUse[], b: readonly RecentEmotionUse[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry.key === b[index].key && entry.at === b[index].at);

function parseUses(raw: string | null): RecentEmotionUse[] {
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const uses: RecentEmotionUse[] = [];
  parsed.forEach((entry, index) => {
    // Saved before uses were timed: its order kept, below any real use.
    if (isEmotionKey(entry)) uses.push({ key: entry, at: KEEP - index });
    else if (entry && typeof entry === 'object') {
      const { key, at } = entry as { key?: unknown; at?: unknown };
      if (isEmotionKey(key) && typeof at === 'number' && Number.isFinite(at)) uses.push({ key, at });
    }
  });
  return mergeRecentEmotionUses(uses, []);
}

/** Most recent first, one per emotion, each with its latest use; never throws (unreadable storage reads as none). */
export async function loadRecentEmotionUses(ownerUserId?: string | null): Promise<RecentEmotionUse[]> {
  try {
    return parseUses(await AsyncStorage.getItem(await keyFor(ownerUserId)));
  } catch {
    return [];
  }
}

/** Most recent first, distinct; never throws (unreadable storage reads as none). */
export async function loadRecentEmotionKeys(ownerUserId?: string | null): Promise<string[]> {
  return (await loadRecentEmotionUses(ownerUserId)).map((use) => use.key);
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

const listeners = new Set<(userId: string) => void>();
let lastUse = 0;

/** Called with the account a choice was recorded for (never for a guest); useAuth.tsx uploads it. */
export function subscribeToRecentEmotionChanges(listener: (userId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Moves `emotionKey` to the front, as used now (two quick choices never share an instant) or at `at` (tests). A failed
 * write is ignored: choosing an emotion never fails because of this.
 */
export function recordEmotionUse(emotionKey: string, at: number = Math.max(Date.now(), lastUse + 1)): Promise<void> {
  lastUse = Math.max(lastUse, at);
  return serialized(async () => {
    try {
      const owner = await getActiveLocalOwner();
      const key = ownerStorageKey(RECENT_EMOTIONS_STORAGE_KEY, owner);
      const recent = parseUses(await AsyncStorage.getItem(key));
      await AsyncStorage.setItem(key, JSON.stringify(mergeRecentEmotionUses([{ key: emotionKey, at }], recent)));
      if (owner !== null) listeners.forEach((listener) => listener(owner));
    } catch {
      // A convenience only.
    }
  });
}

/**
 * The account's history joined with this device's, in `userId`'s own list
 * (sync/preferencesSync.ts). `adopt`: instants the account stored for uses
 * this device sent (`sent`) — earlier ones replace this device's own when
 * its clock ran ahead (backend/src/services/clientInstants.ts), unless the
 * emotion was chosen again meanwhile. Resolves to the list now stored.
 */
export function mergeRecentEmotionsFromAccount(
  userId: string,
  account: readonly RecentEmotionUse[],
  sent: readonly RecentEmotionUse[] = [],
): Promise<RecentEmotionUse[]> {
  return serialized(async () => {
    const key = ownerStorageKey(RECENT_EMOTIONS_STORAGE_KEY, userId);
    let current: RecentEmotionUse[];
    try {
      current = parseUses(await AsyncStorage.getItem(key));
    } catch {
      return [];
    }
    const sentAt = new Map(sent.map((use) => [use.key, use.at]));
    const accountAt = new Map(account.map((use) => [use.key, use.at]));
    const own = current.map((use) => {
      const stored = accountAt.get(use.key);
      return sentAt.get(use.key) === use.at && stored !== undefined && stored < use.at ? { key: use.key, at: stored } : use;
    });
    const merged = mergeRecentEmotionUses(own, account);
    if (!sameRecentEmotionUses(merged, current)) {
      try {
        await AsyncStorage.setItem(key, JSON.stringify(merged));
      } catch {
        // Kept for the next sync.
      }
    }
    return merged;
  });
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
