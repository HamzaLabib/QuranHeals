import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseVerseKey } from '@/services/quranReference';

import { parseCivilDate } from './recurrence';
import type { CivilDate } from './types';

/**
 * The Random Quran Ayah's chosen verses, by delivery date. A verse is chosen
 * once, when its date is first scheduled, and kept until that date has
 * passed or the schedule no longer includes it (frequency changed). So a
 * reconciliation — a language change, a new time, a return to the app —
 * rebuilds the same notification with the same verse, and the verse on the
 * lock screen is always the one the tap opens (the payload carries it too).
 *
 * `recent` remembers the last verses (delivered or dropped) so a new choice
 * avoids repeating them. Device-local, like the reminder settings: only
 * public Quran references, nothing about the user.
 */
export const AYAH_QUEUE_STORAGE_KEY = 'quran-heals:notification-ayah-queue:v1';
export const AYAH_RECENT_LIMIT = 120;

export type AyahQueue = { entries: Record<CivilDate, string>; recent: string[] };

function isVerseKey(value: unknown): value is string {
  try {
    parseVerseKey(value);
    return true;
  } catch {
    return false;
  }
}

export function parseAyahQueue(raw: unknown): AyahQueue {
  const queue: AyahQueue = { entries: {}, recent: [] };
  if (!raw || typeof raw !== 'object') return queue;
  const source = raw as { entries?: unknown; recent?: unknown };
  if (source.entries && typeof source.entries === 'object' && !Array.isArray(source.entries)) {
    for (const [date, key] of Object.entries(source.entries as Record<string, unknown>)) {
      if (parseCivilDate(date) && isVerseKey(key)) queue.entries[date] = key;
    }
  }
  if (Array.isArray(source.recent)) queue.recent = source.recent.filter(isVerseKey).slice(-AYAH_RECENT_LIMIT);
  return queue;
}

export type AyahQueueStore = { load(): Promise<AyahQueue>; save(queue: AyahQueue): Promise<void> };

export const asyncStorageAyahQueueStore: AyahQueueStore = {
  async load() {
    try {
      const raw = await AsyncStorage.getItem(AYAH_QUEUE_STORAGE_KEY);
      return parseAyahQueue(raw === null ? null : JSON.parse(raw));
    } catch {
      return parseAyahQueue(null);
    }
  },
  async save(queue) {
    try {
      await AsyncStorage.setItem(AYAH_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch {
      // Non-fatal: the next reconciliation chooses again for any date it cannot find.
    }
  },
};
