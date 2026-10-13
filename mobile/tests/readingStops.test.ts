import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Named page bookmarks (Mushaf prototype): persistence, renaming and validation, with an in-memory AsyncStorage. */

const storage = vi.hoisted(() => ({ map: new Map<string, string>(), failWrites: false }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.map.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      if (storage.failWrites) throw new Error('disk full');
      storage.map.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => { storage.map.delete(key); }),
  },
}));

const {
  ACTIVE_READING_STOP_STORAGE_KEY,
  activeReadingStop,
  loadActiveReadingStopId,
  setActiveReadingStopId,
  loadReadingStops,
  MAX_READING_STOPS,
  normalizeReadingStopName,
  parseReadingStops,
  READING_STOPS_STORAGE_KEY,
  ReadingStopError,
  removeReadingStop,
  renameReadingStop,
  saveReadingStop,
} = await import('@/mushaf/readingStops');

let clock = Date.parse('2026-10-11T08:00:00Z');
let ids = 0;
const options = { now: () => new Date((clock += 60_000)), newId: () => `id-${(ids += 1)}` };
const stored = () => JSON.parse(storage.map.get(READING_STOPS_STORAGE_KEY) ?? 'null');
const errorKind = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return 'ok';
  } catch (error) {
    return error instanceof ReadingStopError ? error.kind : 'other';
  }
};

beforeEach(() => {
  storage.map.clear();
  storage.failWrites = false;
  clock = Date.parse('2026-10-11T08:00:00Z');
  ids = 0;
});

describe('saving', () => {
  it('saves a named stop for a whole page — no ayah — under a versioned key', async () => {
    const stops = await saveReadingStop({ name: 'Ramadan', page: 61 }, options);
    expect(READING_STOPS_STORAGE_KEY).toBe('quran-heals:mushaf-reading-stops:v1');
    // nameUpdatedAt: when its name was set (sync resolves concurrent renames by it).
    expect(stops).toEqual([{ id: 'id-1', name: 'Ramadan', page: 61, updatedAt: '2026-10-11T08:01:00.000Z', nameUpdatedAt: '2026-10-11T08:01:00.000Z' }]);
    expect(stored()).toEqual(stops);
    expect(await loadReadingStops()).toEqual(stops);
  });

  it('saving an existing name (any case) moves that stop to the new page instead of adding another', async () => {
    await saveReadingStop({ name: 'Mum', page: 61 }, options);
    await saveReadingStop({ name: 'Dad', page: 61 }, options);
    const stops = await saveReadingStop({ name: '  mum ', page: 62 }, options);
    expect(stops.map((stop) => [stop.id, stop.name, stop.page])).toEqual([['id-1', 'mum', 62], ['id-2', 'Dad', 61]]);
  });

  it('keeps Arabic names as typed', async () => {
    const [stop] = await saveReadingStop({ name: 'ختمة رمضان', page: 61 }, options);
    expect(stop.name).toBe('ختمة رمضان');
  });

  it('rejects an empty or over-long name, or a page outside 1–604', async () => {
    expect(await errorKind(() => saveReadingStop({ name: '   ', page: 61 }, options))).toBe('invalid_name');
    expect(await errorKind(() => saveReadingStop({ name: 'x'.repeat(41), page: 61 }, options))).toBe('invalid_name');
    for (const page of [0, 605, 61.5, Number.NaN]) {
      expect(await errorKind(() => saveReadingStop({ name: 'Mum', page }, options))).toBe('invalid_page');
    }
    expect(storage.map.size).toBe(0);
  });

  it('there is no small limit: 20+ stops are fine; only a 500-stop storage safeguard remains', async () => {
    for (let index = 0; index < 25; index += 1) await saveReadingStop({ name: `Reader ${index}`, page: 61 }, options);
    expect(await loadReadingStops()).toHaveLength(25);
    expect(MAX_READING_STOPS).toBe(500);
    const many = Array.from({ length: MAX_READING_STOPS }, (_, index) => ({ id: `s${index}`, name: `R${index}`, page: 1, updatedAt: new Date(2026, 0, 1, 0, index).toISOString() }));
    storage.map.set(READING_STOPS_STORAGE_KEY, JSON.stringify(many));
    expect(await errorKind(() => saveReadingStop({ name: 'One more', page: 61 }, options))).toBe('too_many');
    expect(await errorKind(() => saveReadingStop({ name: 'R3', page: 62 }, options))).toBe('ok'); // moving still works at the ceiling
  });

  it('a failed write surfaces as an error and leaves the stored list unchanged', async () => {
    await saveReadingStop({ name: 'Mum', page: 61 }, options);
    storage.failWrites = true;
    await expect(saveReadingStop({ name: 'Dad', page: 61 }, options)).rejects.toThrow('disk full');
    expect(stored().map((stop: { name: string }) => stop.name)).toEqual(['Mum']);
  });
});

describe('renaming', () => {
  it('changes only that stop`s name — its page, id, order and every other stop are unchanged', async () => {
    await saveReadingStop({ name: 'Mum', page: 61 }, options);
    await saveReadingStop({ name: 'Dad', page: 62 }, options);
    const before = await loadReadingStops();
    const after = await renameReadingStop('id-1', '  Mother ', { now: () => new Date('2026-10-12T09:00:00.000Z') });
    // Only the name and when it was set; the page and its save time are untouched.
    expect(after).toEqual(before.map((stop) => (stop.id === 'id-1' ? { ...stop, name: 'Mother', nameUpdatedAt: '2026-10-12T09:00:00.000Z' } : stop)));
    expect(stored()).toEqual(after);
  });

  it('refuses a name another stop already uses (any case) and changes nothing', async () => {
    await saveReadingStop({ name: 'Mum', page: 61 }, options);
    await saveReadingStop({ name: 'Dad', page: 62 }, options);
    const before = stored();
    expect(await errorKind(() => renameReadingStop('id-1', 'DAD'))).toBe('name_taken');
    expect(stored()).toEqual(before);
  });

  it('allows changing only the case of its own name; rejects invalid names and unknown stops', async () => {
    await saveReadingStop({ name: 'mum', page: 61 }, options);
    expect((await renameReadingStop('id-1', 'Mum'))[0].name).toBe('Mum');
    expect(await errorKind(() => renameReadingStop('id-1', ' '))).toBe('invalid_name');
    expect(await errorKind(() => renameReadingStop('nope', 'X'))).toBe('not_found');
  });
});

describe('removing', () => {
  it('removes one stop by id', async () => {
    await saveReadingStop({ name: 'Mum', page: 61 }, options);
    await saveReadingStop({ name: 'Dad', page: 61 }, options);
    expect((await removeReadingStop('id-1')).map((stop) => stop.name)).toEqual(['Dad']);
    expect((await loadReadingStops()).map((stop) => stop.name)).toEqual(['Dad']);
  });
});

describe('reading stored data', () => {
  it('missing or corrupted storage reads as no stops, never an error', async () => {
    expect(await loadReadingStops()).toEqual([]);
    storage.map.set(READING_STOPS_STORAGE_KEY, '{not json');
    expect(await loadReadingStops()).toEqual([]);
  });

  it('phase-1 stops saved with an ayah are kept as page-only stops', async () => {
    storage.map.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'a', name: 'Mum', page: 61, verseKey: '3:86', updatedAt: '2026-10-11T08:00:00.000Z' }]));
    expect(await loadReadingStops()).toEqual([{ id: 'a', name: 'Mum', page: 61, updatedAt: '2026-10-11T08:00:00.000Z' }]);
  });

  it('drops malformed entries and keeps the newest of duplicate names or ids', () => {
    const valid = { id: 'a', name: 'Mum', page: 61, updatedAt: '2026-10-11T08:00:00.000Z' };
    expect(parseReadingStops([
      valid,
      { ...valid, id: 'b', name: 'MUM', updatedAt: '2026-10-11T09:00:00.000Z' },
      { ...valid, id: 'b', name: 'Other', updatedAt: '2026-10-11T07:00:00.000Z' },
      { ...valid, id: 'c', name: '' },
      { ...valid, id: 'd', name: 'P', page: 999 },
      { ...valid, id: 'f', name: 'T', updatedAt: 'yesterday' },
      { ...valid, id: '', name: 'I' },
      null,
      'stop',
    ]).map((stop) => stop.id)).toEqual(['b']);
    expect(parseReadingStops({ stops: [] })).toEqual([]);
  });

  it('normalizes names: trims, collapses spaces, strips control characters', () => {
    expect(normalizeReadingStopName('  Ramadan \n  2026 ')).toBe('Ramadan 2026');
    expect(normalizeReadingStopName('Mum\u0000')).toBe('Mum');
    expect(normalizeReadingStopName(42)).toBeNull();
  });
});

describe('the active stop (the reader`s ورد selector)', () => {
  it('is stored as an id on its own key, survives a restart, and can be cleared', async () => {
    const [fajr] = await saveReadingStop({ name: 'Fajr', page: 61 }, options);
    expect(await loadActiveReadingStopId()).toBeNull();
    await setActiveReadingStopId(fajr.id);
    expect(storage.map.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe(fajr.id);
    expect(await loadActiveReadingStopId()).toBe(fajr.id);
    await setActiveReadingStopId(null);
    expect(await loadActiveReadingStopId()).toBeNull();
  });

  it('choosing a stop changes no stop: every name and page stays as saved', async () => {
    await saveReadingStop({ name: 'Fajr', page: 61 }, options);
    const stops = await saveReadingStop({ name: 'Tadabbur', page: 125 }, options);
    const before = storage.map.get(READING_STOPS_STORAGE_KEY);
    for (const stop of stops) await setActiveReadingStopId(stop.id);
    expect(storage.map.get(READING_STOPS_STORAGE_KEY)).toBe(before);
  });

  it('resolves to the stop itself, or null when unset or removed; removing the active stop clears it', async () => {
    const stops = await saveReadingStop({ name: 'Fajr', page: 61 }, options);
    expect(activeReadingStop(stops, stops[0].id)).toEqual(stops[0]);
    expect(activeReadingStop(stops, null)).toBeNull();
    expect(activeReadingStop(stops, 'missing')).toBeNull();
    await setActiveReadingStopId(stops[0].id);
    await removeReadingStop(stops[0].id);
    expect(await loadActiveReadingStopId()).toBeNull();
  });

  it('removing another stop leaves the active one alone', async () => {
    await saveReadingStop({ name: 'Fajr', page: 61 }, options);
    const stops = await saveReadingStop({ name: 'Isha', page: 300 }, options);
    await setActiveReadingStopId(stops[0].id);
    await removeReadingStop(stops[1].id);
    expect(await loadActiveReadingStopId()).toBe(stops[0].id);
  });
});
