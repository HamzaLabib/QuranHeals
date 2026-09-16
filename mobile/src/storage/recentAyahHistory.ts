import AsyncStorage from '@react-native-async-storage/async-storage';

import { resolveVerseKey } from '@/services/quranReference';
import type { Ayah } from '@/types/domain';

// Device-local, per-emotion "don't repeat this ayah for a while" window.
// Deliberately separate from storage/recentAyahs.ts (a fixed last-4-shown
// count used for the legacy favorites/history surface) — this store is
// time-based, not count-based, and exists solely to build the `exclude`
// list the backend's GET /ayahs/random endpoint already accepts.
//
// Also reused, unchanged, for the general Quran flow's own recent-history
// namespace ("Need an ayah from the Quran?" — see GENERAL_QURAN_HISTORY_KEY
// below): the map is keyed by a plain string, so a second, independent
// namespace is just another key in the same map, with its own TTL tracking
// that never reads or clears any emotion's entries. This is *not* a 30th
// emotion — GENERAL_QURAN_HISTORY_KEY is never a real emotionKey (it starts
// with "__", which the backend's emotionKey pattern `^[a-z][a-z_-]{1,40}$`
// structurally rejects), never sent to the backend, and never shown to the
// user.
const STORAGE_KEY = 'quran-heals:recent-emotion-ayahs:v1';

/** Reserved history-map key for the general "Need an ayah from the Quran?" flow — never a real emotionKey, never user-visible, never sent to the backend. See the module doc comment above. */
export const GENERAL_QURAN_HISTORY_KEY = '__general_quran__';

export const RECENT_AYAH_TTL_MS = 10 * 60 * 1000; // 10 minutes = 600,000 ms

// Defensive cap so a pathological run of requests (or a corrupted/replayed
// clock) can't grow one emotion's — or the general Quran flow's — history
// without bound. Matches the backend's own `exclude` query cap
// (ayahValidators.ts: max 20), so nothing we'd ever send would be truncated
// server-side anyway.
const MAX_ENTRIES_PER_EMOTION = 20;

type HistoryEntry = { verseKey: string; shownAt: number };
type HistoryMap = Record<string, HistoryEntry[]>;

function isVerseKeyShape(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,2}:[1-9]\d{0,2}$/.test(value);
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isVerseKeyShape(candidate.verseKey) && typeof candidate.shownAt === 'number' && Number.isFinite(candidate.shownAt);
}

/** Never throws: missing, corrupt, or unexpectedly-shaped storage is treated as empty history. */
async function readHistoryMap(): Promise<HistoryMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const map: HistoryMap = {};
    for (const [emotionKey, entries] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(entries)) {
        map[emotionKey] = entries.filter(isHistoryEntry);
      }
    }
    return map;
  } catch {
    return {};
  }
}

/** Best-effort persistence: a write failure must never surface to the caller or block showing an already-fetched ayah. */
async function writeHistoryMap(map: HistoryMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Swallowed deliberately — see doc comment above.
  }
}

function activeEntries(entries: HistoryEntry[], now: number): HistoryEntry[] {
  return entries.filter((entry) => now - entry.shownAt < RECENT_AYAH_TTL_MS).sort((a, b) => a.shownAt - b.shownAt);
}

// Serializes every read/mutation through this module so two near-simultaneous
// calls (e.g. a rapid double-tap racing two loadAyah() calls) never
// interleave a read of stale state with another call's write.
let pendingOperation: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingOperation.then(operation, operation);
  pendingOperation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Still-active (not yet expired), oldest-first entries recorded for this
 * emotion on this device. Expired entries are pruned from the returned list
 * and, if any were dropped, the cleaned-up history is persisted back.
 */
export function getRecentAyahs(emotionKey: string, now: number = Date.now()): Promise<HistoryEntry[]> {
  return enqueue(async () => {
    const map = await readHistoryMap();
    const entries = map[emotionKey] ?? [];
    const active = activeEntries(entries, now);

    if (active.length !== entries.length) {
      await writeHistoryMap({ ...map, [emotionKey]: active });
    }

    return active;
  });
}

/** Convenience wrapper: the verseKeys of the still-active entries, oldest first — exactly what the `exclude` query param wants. */
export async function getExcludedVerseKeys(emotionKey: string, now: number = Date.now()): Promise<string[]> {
  return (await getRecentAyahs(emotionKey, now)).map((entry) => entry.verseKey);
}

/**
 * Records an ayah as having just been shown for an emotion. Only call this
 * after the ayah has actually been obtained and is about to be displayed —
 * never for a failed/cancelled/loading request.
 */
export function recordShownAyah(emotionKey: string, ayah: Ayah, shownAt: number = Date.now()): Promise<void> {
  return enqueue(async () => {
    const verseKey = resolveVerseKey(ayah);
    const map = await readHistoryMap();
    const withoutDuplicate = activeEntries(map[emotionKey] ?? [], shownAt).filter((entry) => entry.verseKey !== verseKey);
    const next = [...withoutDuplicate, { verseKey, shownAt }].slice(-MAX_ENTRIES_PER_EMOTION);

    await writeHistoryMap({ ...map, [emotionKey]: next });
  });
}

/**
 * Decides the bounded exhaustion-fallback retry for GET /ayahs/random.
 *
 * The backend's own selection (MongooseQuranRepository.findRandomAyahByEmotion)
 * never returns an excluded verseKey *unless* every approved ayah for the
 * emotion is currently excluded, in which case it falls back to ignoring the
 * exclusion list entirely. `returnedVerseKey` being a member of
 * `excludedVerseKeys` is therefore an exact signal that this fallback fired.
 *
 * When it has, this returns the exclusion list for exactly one bounded
 * retry: the same (oldest-first) list with only its single oldest —
 * least-recently-shown — entry dropped, so that specific ayah is the one
 * that becomes eligible again, while every other recently-shown ayah stays
 * excluded. Returns null when no retry is needed. Never loops; the caller
 * is expected to issue at most one follow-up request from this result.
 */
export function buildExhaustionRetryExclusions(excludedVerseKeys: string[], returnedVerseKey: string): string[] | null {
  if (excludedVerseKeys.length === 0 || !excludedVerseKeys.includes(returnedVerseKey)) return null;
  const [, ...withoutOldest] = excludedVerseKeys;
  return withoutOldest;
}

/**
 * Prunes expired entries across every emotion (not just one) and persists
 * the result. Not required on every read (getRecentAyahs already prunes the
 * emotion it's asked about), but useful as periodic bounded-storage
 * maintenance, e.g. on app start.
 */
export function removeExpiredEntries(now: number = Date.now()): Promise<void> {
  return enqueue(async () => {
    const map = await readHistoryMap();
    const next: HistoryMap = {};
    let changed = false;

    for (const [emotionKey, entries] of Object.entries(map)) {
      const active = activeEntries(entries, now);
      if (active.length !== entries.length) changed = true;
      if (active.length > 0) next[emotionKey] = active;
    }

    if (changed) await writeHistoryMap(next);
  });
}
