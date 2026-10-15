import AsyncStorage from '@react-native-async-storage/async-storage';

import { MUSHAF_PAGE_COUNT } from './mushafPage';

/**
 * The last Mushaf page the reader was moved to on THIS device (a swipe, the
 * page selector, the index, a link), so browsing survives an app restart.
 *
 *  - Device-specific: never synced, never part of an account (like Keep
 *    Screen Awake). Browsing is not a reading position.
 *  - It never touches a ورد: only an explicit save moves a ورد's page
 *    (khatmas.ts saveWirdPage), and nothing here calls it. A ورد's saved
 *    page, Khatma cycles and the gold medallion are unaffected.
 *  - On opening without a requested page, the more recent of the two wins:
 *    a ورد saved after the last browse (here, or on another device and
 *    synced) opens at its page, exactly as before; a browse after the last
 *    save opens where the reader left off (openingPage).
 */
export const LAST_BROWSED_PAGE_STORAGE_KEY = 'quran-heals:mushaf-last-page:v1';

export type LastBrowsedPage = { page: number; at: number };

function isPage(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MUSHAF_PAGE_COUNT;
}

/** The stored page, or null (none, or unreadable). Never throws. */
export async function loadLastBrowsedPage(): Promise<LastBrowsedPage | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_BROWSED_PAGE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<LastBrowsedPage>;
    return isPage(parsed.page) && typeof parsed.at === 'number' && Number.isFinite(parsed.at) ? { page: parsed.page, at: parsed.at } : null;
  } catch {
    return null;
  }
}

let writes: Promise<void> = Promise.resolve();

/** Remembers `page` as browsed now. Writes in order, so a slower earlier write never lands last. Never throws. */
export function saveLastBrowsedPage(page: number, at: number = Date.now()): Promise<void> {
  if (!isPage(page)) return writes;
  writes = writes.then(() => AsyncStorage.setItem(LAST_BROWSED_PAGE_STORAGE_KEY, JSON.stringify({ page, at }))).catch(() => {
    // Non-fatal: the reader simply opens as it did before this existed.
  });
  return writes;
}

/**
 * The page to open with no page requested: the last browsed page when it is
 * more recent than the given ورد's last save (or there is no ورد), else the
 * ورد's saved page; null when there is neither (page 1).
 */
export function openingPage(lastBrowsed: LastBrowsedPage | null, wird: { page: number; updatedAt: string } | null): number | null {
  const savedAt = wird ? Date.parse(wird.updatedAt) : Number.NaN;
  if (lastBrowsed && (!wird || !Number.isFinite(savedAt) || lastBrowsed.at > savedAt)) return lastBrowsed.page;
  return wird ? wird.page : null;
}
