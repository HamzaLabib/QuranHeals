import { AppState } from 'react-native';

import { createMushafAutoDownload, DEFAULT_AUTO_PREFS, type AutoPrefs, type AutoPrefsStore, type MushafAutoDownload, type OfflineEngine } from './autoDownload';
import { autoDownloadEnabled } from './autoDownloadConfig';
import { deviceNetwork } from './network';

/**
 * The app's one automatic-download controller (autoDownload.ts). Light to
 * import: the offline engine (SQLite, file system) and AsyncStorage load on
 * first use, so the tab bar and screens can read its state at no cost.
 */

/** Device-wide, not per account: the offline Mushaf is shared device content. */
export const AUTO_DOWNLOAD_PREFS_KEY = 'quran-heals:mushaf-offline-auto:v1';

const CELLULAR = new Set(['ask', 'allowed', 'wifi-only']);
const HOLDS = new Set(['paused', 'removed', null]);

export function parseAutoPrefs(raw: string | null): AutoPrefs {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<AutoPrefs>) : null;
    if (value && CELLULAR.has(value.cellular as string) && HOLDS.has(value.hold ?? null)) return { cellular: value.cellular!, hold: value.hold ?? null };
  } catch {
    // Damaged: the defaults (ask first, no hold).
  }
  return { ...DEFAULT_AUTO_PREFS };
}

const storage = async () => (await import('@react-native-async-storage/async-storage')).default;
const prefsStore: AutoPrefsStore = {
  load: async () => parseAutoPrefs(await (await storage()).getItem(AUTO_DOWNLOAD_PREFS_KEY)),
  save: async (prefs) => (await storage()).setItem(AUTO_DOWNLOAD_PREFS_KEY, JSON.stringify(prefs)),
};

const offline = async () => (await import('@/mushaf/offline')).offlineMushaf;
const engine: OfflineEngine = {
  status: async () => (await offline()).status(),
  download: async (options) => (await offline()).download(options),
  remove: async () => (await offline()).remove(),
  checkForUpdate: async (options) => (await offline()).checkForUpdate(options),
};

let controller: MushafAutoDownload | null = null;

export function mushafAutoDownload(): MushafAutoDownload {
  controller ??= createMushafAutoDownload({
    engine,
    network: deviceNetwork,
    appActivity: {
      subscribe: (listener) => {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
    },
    prefs: prefsStore,
    enabled: autoDownloadEnabled,
  });
  return controller;
}

/** Tests: a fresh controller (the previous one stopped, its listeners removed). */
export async function resetMushafAutoDownloadForTests(): Promise<void> {
  const previous = controller;
  controller = null;
  await previous?.dispose();
}
