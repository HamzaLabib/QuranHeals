import AsyncStorage from '@react-native-async-storage/async-storage';

import { resolveVerseKey } from '@/services/quranReference';
import type { Ayah } from '@/types/domain';

const recentKey = 'quran-heals:recent-ayahs';
const recentVerseKey = 'quran-heals:recent-verse-keys:v1';
const maxRecentPerEmotion = 4;

type RecentMap = Record<string, unknown>;

async function readRecentMap(key: string): Promise<RecentMap> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RecentMap;
    }
  } catch {
    // An unreadable value must not be overwritten by an empty history.
  }
  throw new Error('Recent ayahs could not be read. Your stored history has been kept.');
}

function emotionEntries(recent: RecentMap, emotionKey: string): unknown[] {
  if (!Object.hasOwn(recent, emotionKey)) return [];
  const entries = recent[emotionKey];
  if (!Array.isArray(entries)) {
    throw new Error('Recent ayahs could not be read. Your stored history has been kept.');
  }
  return entries;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

function isVerseKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return resolveVerseKey({ verseKey: value }) === value;
  } catch {
    return false;
  }
}

function remember(entries: unknown[], value: string, isValid: (entry: unknown) => entry is string): unknown[] {
  const valid = entries.filter(isValid);
  const next = [value, ...valid.filter((entry) => entry !== value)].slice(0, maxRecentPerEmotion);
  // Unexpected old records remain stored even though they cannot be used as exclusions.
  return [...next, ...entries.filter((entry) => !isValid(entry))];
}

let pendingMutation: Promise<unknown> = Promise.resolve();

export async function getRecentAyahIds(emotionKey: string): Promise<string[]> {
  return (await getRecentAyahState(emotionKey)).ids;
}

export async function getRecentAyahState(emotionKey: string): Promise<{ ids: string[]; unresolvedCount: number }> {
  await pendingMutation;
  const recent = await readRecentMap(recentKey);
  const entries = emotionEntries(recent, emotionKey);
  const ids = entries.filter(isId);
  return { ids, unresolvedCount: entries.length - ids.length };
}

export async function getRecentVerseKeys(emotionKey: string): Promise<string[]> {
  await pendingMutation;
  const recent = await readRecentMap(recentVerseKey);
  return emotionEntries(recent, emotionKey).filter(isVerseKey);
}

export function rememberAyahForEmotion(emotionKey: string, ayah: Ayah): Promise<void> {
  const operation = async () => {
    const verseKey = resolveVerseKey(ayah);
    if (!isId(ayah.id) || emotionKey.length === 0) throw new Error('Invalid recent ayah record.');
    const [legacy, stable] = await Promise.all([readRecentMap(recentKey), readRecentMap(recentVerseKey)]);
    const nextIds = remember(emotionEntries(legacy, emotionKey), ayah.id, isId);
    const nextKeys = remember(emotionEntries(stable, emotionKey), verseKey, isVerseKey);

    await AsyncStorage.multiSet([
      [recentKey, JSON.stringify({ ...legacy, [emotionKey]: nextIds })],
      [recentVerseKey, JSON.stringify({ ...stable, [emotionKey]: nextKeys })],
    ]);
  };
  const result = pendingMutation.then(operation, operation);
  pendingMutation = result.catch(() => undefined);
  return result;
}
