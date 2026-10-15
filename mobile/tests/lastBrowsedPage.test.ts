import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The last browsed Mushaf page (mushaf/lastBrowsedPage.ts): device-only, survives restarts, never a ورد save. */

const storage = vi.hoisted(() => ({ map: new Map<string, string>(), fail: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      if (storage.fail) throw new Error('storage unavailable');
      return storage.map.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      if (storage.fail) throw new Error('storage unavailable');
      storage.map.set(key, value);
    }),
  },
}));

const { LAST_BROWSED_PAGE_STORAGE_KEY, loadLastBrowsedPage, openingPage, saveLastBrowsedPage } = await import('@/mushaf/lastBrowsedPage');

beforeEach(() => {
  storage.map.clear();
  storage.fail = false;
});

describe('storage', () => {
  it('saves and reloads (an app restart reads it back)', async () => {
    await saveLastBrowsedPage(212, 5000);
    expect(await loadLastBrowsedPage()).toEqual({ page: 212, at: 5000 });
  });

  it('keeps the latest of quick successive saves (writes land in order)', async () => {
    void saveLastBrowsedPage(10, 1);
    void saveLastBrowsedPage(11, 2);
    await saveLastBrowsedPage(12, 3);
    expect(await loadLastBrowsedPage()).toEqual({ page: 12, at: 3 });
  });

  it('ignores an impossible page, and reads damaged or missing data as none', async () => {
    await saveLastBrowsedPage(0);
    await saveLastBrowsedPage(605);
    expect(storage.map.has(LAST_BROWSED_PAGE_STORAGE_KEY)).toBe(false);
    storage.map.set(LAST_BROWSED_PAGE_STORAGE_KEY, '{"page":"7"');
    expect(await loadLastBrowsedPage()).toBeNull();
    storage.map.set(LAST_BROWSED_PAGE_STORAGE_KEY, JSON.stringify({ page: 700, at: 1 }));
    expect(await loadLastBrowsedPage()).toBeNull();
  });

  it('never throws when storage fails', async () => {
    storage.fail = true;
    await expect(saveLastBrowsedPage(3)).resolves.toBeUndefined();
    await expect(loadLastBrowsedPage()).resolves.toBeNull();
  });
});

describe('openingPage', () => {
  const wird = { page: 125, updatedAt: '2026-10-02T00:00:00.000Z' };
  const savedAt = Date.parse(wird.updatedAt);

  it('a browse after the ورد`s last save opens where the reader left off', () => {
    expect(openingPage({ page: 127, at: savedAt + 1 }, wird)).toBe(127);
  });

  it('a ورد saved after the last browse (here, or synced from another device) opens at its page', () => {
    expect(openingPage({ page: 127, at: savedAt - 1 }, wird)).toBe(125);
    expect(openingPage({ page: 127, at: savedAt }, wird)).toBe(125);
  });

  it('without a browse: the ورد`s page; without a ورد: the browse; with neither: none (page 1)', () => {
    expect(openingPage(null, wird)).toBe(125);
    expect(openingPage({ page: 9, at: 1 }, null)).toBe(9);
    expect(openingPage(null, null)).toBeNull();
  });
});

describe('separation from reading progress and sync', () => {
  it('never imports or calls anything that saves a ورد, a Khatma or the account', () => {
    const source = readFileSync(resolve(__dirname, '../src/mushaf/lastBrowsedPage.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"]\.\/khatmas['"]|from ['"]\.\/readingStops['"]|@\/sync|saveWirdPage\(/);
    const sync = ['preferenceFields.ts', 'preferencesSync.ts', 'readingSync.ts', 'syncOrchestrator.ts'].map((file) => readFileSync(resolve(__dirname, '../src/sync', file), 'utf-8')).join('\n');
    expect(sync).not.toMatch(/lastBrowsedPage|mushaf-last-page/);
  });
});
