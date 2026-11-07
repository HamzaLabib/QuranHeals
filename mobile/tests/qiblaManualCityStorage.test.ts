import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ map: new Map<string, string>(), fail: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (storage.fail) throw new Error('storage');
      return storage.map.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (storage.fail) throw new Error('storage');
      storage.map.set(key, value);
    },
    removeItem: async (key: string) => {
      if (storage.fail) throw new Error('storage');
      storage.map.delete(key);
    },
  },
}));

const { MANUAL_CITY_KEY, clearManualCityId, loadManualCityId, saveManualCityId } = await import('@/qibla/manualCityStorage');

beforeEach(() => {
  storage.map.clear();
  storage.fail = false;
});

describe('the chosen city: its ID only, on this device', () => {
  it('saves and loads the ID under one key; nothing else is written', async () => {
    await saveManualCityId(1159151603);
    expect([...storage.map.entries()]).toEqual([[MANUAL_CITY_KEY, '1159151603']]);
    expect(await loadManualCityId()).toBe(1159151603);
    await clearManualCityId();
    expect(await loadManualCityId()).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it('refuses anything but a positive whole number, both ways', async () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) await saveManualCityId(bad);
    expect(storage.map.size).toBe(0);
    for (const raw of ['30.04,31.23', 'Cairo', '', '-1', '1e9']) {
      storage.map.set(MANUAL_CITY_KEY, raw);
      expect(await loadManualCityId(), raw).toBeNull();
    }
  });

  it('a storage failure never throws: nothing saved, nothing loaded', async () => {
    storage.fail = true;
    await expect(saveManualCityId(42)).resolves.toBeUndefined();
    await expect(loadManualCityId()).resolves.toBeNull();
    await expect(clearManualCityId()).resolves.toBeUndefined();
  });
});
