import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * أورادي وختماتي: per-ورد cycles, manually confirmed Khatmas, undo, legacy
 * stops at 604, interrupted writes, and guest/account partitions — over an
 * in-memory AsyncStorage.
 */

const storage = vi.hoisted(() => ({ map: new Map<string, string>(), failWritesAfter: Infinity, writes: 0 }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.map.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.writes += 1;
      if (storage.writes > storage.failWritesAfter) throw new Error('app killed');
      storage.map.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => { storage.map.delete(key); }),
  },
}));

const {
  KHATMAS_STORAGE_KEY,
  adoptGuestReadingData,
  clearAccountReadingData,
  confirmKhatma,
  createWird,
  deleteWird,
  guestHasReadingData,
  KhatmaError,
  loadReadingData,
  progressPercent,
  removeKhatma,
  saveWirdPage,
} = await import('@/mushaf/khatmas');
const { READING_STOPS_STORAGE_KEY, ACTIVE_READING_STOP_STORAGE_KEY, ReadingStopError, renameReadingStop, setActiveReadingStopId, saveReadingStop } = await import('@/mushaf/readingStops');
const { resetLocalDataOwnerForTests, setLocalDataOwnerState } = await import('@/storage/localDataOwner');

let clock = Date.parse('2026-10-11T08:00:00Z');
let ids = 0;
const options = () => ({ now: () => new Date((clock += 60_000)), newId: () => `id-${(ids += 1)}` });
const at = (iso: string) => ({ now: () => new Date(iso), newId: () => `id-${(ids += 1)}` });
const errorKind = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return 'ok';
  } catch (error) {
    return error instanceof KhatmaError || error instanceof ReadingStopError ? error.kind : String(error);
  }
};
const wird = async (name: string) => (await loadReadingData()).wirds.find((w) => w.stop.name === name)!;
/** Saves page by page, as the bookmark does. */
const readTo = async (name: string, ...pages: number[]) => {
  let result;
  for (const page of pages) result = await saveWirdPage({ name, page }, options());
  return result!;
};
const asGuest = () => setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true });
const asAccount = (id: string) => setLocalDataOwnerState({ activeUserId: id, keptSeparate: [], resolved: true });

beforeEach(() => {
  storage.map.clear();
  storage.writes = 0;
  storage.failWritesAfter = Infinity;
  clock = Date.parse('2026-10-11T08:00:00Z');
  ids = 0;
  resetLocalDataOwnerForTests();
});

describe('independent progress per ورد', () => {
  it('each ورد keeps its own page, percentage and Khatma count', async () => {
    await readTo('وردي اليومي', 1, 300, 604);
    await readTo('ورد رمضان', 1, 320);
    await readTo('ورد التدبر', 150);
    const data = await loadReadingData();
    const byName = Object.fromEntries(data.wirds.map((w) => [w.stop.name, [w.stop.page, w.percent, w.status, w.khatmas]]));
    expect(byName).toEqual({
      'وردي اليومي': [604, 100, 'pending', 0],
      'ورد رمضان': [320, 52, 'reading', 0],
      'ورد التدبر': [150, 24, 'reading', 0],
    });
  });

  it('percent is the saved page out of 604, rounded down: 100% only on page 604', () => {
    expect([1, 302, 603, 604].map(progressPercent)).toEqual([0, 50, 99, 100]);
  });

  it('switching the active ورد changes no ورد`s page or cycle', async () => {
    await readTo('Fajr', 100);
    await readTo('Isha', 400);
    const before = await loadReadingData();
    for (const w of before.wirds) await setActiveReadingStopId(w.stop.id);
    const after = await loadReadingData();
    expect(after.wirds.map((w) => [w.stop.page, w.cycle])).toEqual(before.wirds.map((w) => [w.stop.page, w.cycle]));
  });

  it('there is no small limit on the number of ورد', async () => {
    for (let i = 0; i < 30; i += 1) await createWird({ name: `ورد ${i}`, page: i + 1 }, options());
    const data = await loadReadingData();
    expect(data.wirds).toHaveLength(30);
    expect(new Set(data.wirds.map((w) => w.stop.page)).size).toBe(30);
  });
});

describe('reaching page 604', () => {
  it('a save from an earlier page to 604 makes completion available; nothing is counted', async () => {
    const result = await readTo('Daily', 1, 603, 604);
    expect(result.reachedEnd).toBe(true);
    const data = await loadReadingData();
    expect(data.wirds[0].status).toBe('pending');
    expect(data.records).toEqual([]);
    expect(data.stats).toEqual({ total: 0, ramadan: 0, nonRamadan: 0 });
  });

  it('saving 604 again, or loading again, never re-announces it or counts anything', async () => {
    await readTo('Daily', 10, 604);
    expect((await saveWirdPage({ name: 'Daily', page: 604 }, options())).reachedEnd).toBe(false);
    await loadReadingData();
    expect((await loadReadingData()).records).toHaveLength(0);
  });

  it('a ورد created directly on page 604 is not eligible: only an explicit, separate choice can record it', async () => {
    const result = await saveWirdPage({ name: 'New', page: 604 }, options());
    expect(result.reachedEnd).toBe(false);
    const w = await wird('New');
    expect(w.status).toBe('unconfirmedEnd');
    expect(await errorKind(() => confirmKhatma(w.stop.id, w.cycle.id, options()))).toBe('not_eligible');
    expect((await loadReadingData()).records).toHaveLength(0);
  });

  it('a legacy stop already saved at 604 (before this feature) is neither counted nor discarded', async () => {
    storage.map.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'old', name: 'Mum', page: 604, updatedAt: '2026-09-01T08:00:00.000Z' }]));
    const data = await loadReadingData();
    expect(data.wirds[0]).toMatchObject({ status: 'unconfirmedEnd', percent: 100, khatmas: 0 });
    expect(data.records).toEqual([]);
    // Loading writes nothing for it, and the stop itself is untouched.
    expect(JSON.parse(storage.map.get(READING_STOPS_STORAGE_KEY)!)).toEqual([{ id: 'old', name: 'Mum', page: 604, updatedAt: '2026-09-01T08:00:00.000Z' }]);
    // The reader's explicit choice records it.
    const { record } = await confirmKhatma('old', data.wirds[0].cycle.id, { ...options(), acceptUnconfirmedEnd: true });
    expect(record.stopId).toBe('old');
    expect((await wird('Mum')).stop.page).toBe(1);
  });

  it('moving back below 604 withdraws the pending completion', async () => {
    await readTo('Daily', 500, 604);
    await readTo('Daily', 590);
    expect((await wird('Daily')).status).toBe('reading');
  });

  it('a save made through the plain bookmark API (no cycle bookkeeping) is caught up on load', async () => {
    await readTo('Daily', 500);
    await saveReadingStop({ name: 'Daily', page: 604 }, options());
    expect((await wird('Daily')).status).toBe('pending');
  });
});

describe('confirming a Khatma', () => {
  it('creates exactly one record with the local date and Ramadan classification, and starts a new cycle at page 1', async () => {
    await readTo('Daily', 1, 604);
    const w = await wird('Daily');
    const { record, alreadyRecorded } = await confirmKhatma(w.stop.id, w.cycle.id, at('2027-02-10T10:00:00'));
    expect(alreadyRecorded).toBe(false);
    expect(record).toMatchObject({ stopId: w.stop.id, stopName: 'Daily', cycleId: w.cycle.id, localDate: '2027-02-10', ramadan: true, ramadanHijriYear: 1448 });
    const after = await wird('Daily');
    expect(after).toMatchObject({ status: 'reading', khatmas: 1, percent: 0 });
    expect(after.stop.page).toBe(1);
    expect(after.cycle.id).not.toBe(w.cycle.id);
  });

  it('repeated taps, retries and stale screens never count a cycle twice', async () => {
    await readTo('Daily', 1, 604);
    const w = await wird('Daily');
    const results = await Promise.all([1, 2, 3].map(() => confirmKhatma(w.stop.id, w.cycle.id, options())));
    expect(results.filter((r) => !r.alreadyRecorded)).toHaveLength(1);
    expect(new Set(results.map((r) => r.record.id)).size).toBe(1);
    expect((await confirmKhatma(w.stop.id, w.cycle.id, options())).alreadyRecorded).toBe(true);
    expect((await loadReadingData()).stats.total).toBe(1);
  });

  it('a ورد still reading cannot be confirmed', async () => {
    await readTo('Daily', 300);
    const w = await wird('Daily');
    expect(await errorKind(() => confirmKhatma(w.stop.id, w.cycle.id, options()))).toBe('not_eligible');
  });

  it('the same ورد completes many Khatmas over time; history and per-ورد counts are kept', async () => {
    for (const date of ['2026-03-01T09:00:00', '2026-07-01T09:00:00', '2027-02-20T09:00:00']) {
      await readTo('Daily', 200, 604);
      const w = await wird('Daily');
      await confirmKhatma(w.stop.id, w.cycle.id, at(date));
    }
    await readTo('Other', 10, 604);
    const other = await wird('Other');
    await confirmKhatma(other.stop.id, other.cycle.id, at('2026-08-01T09:00:00'));
    const data = await loadReadingData();
    expect(data.wirds.find((w) => w.stop.name === 'Daily')!.khatmas).toBe(3);
    expect(data.wirds.find((w) => w.stop.name === 'Other')!.khatmas).toBe(1);
    expect(data.stats).toEqual({ total: 4, ramadan: 2, nonRamadan: 2 });
    expect(data.stats.total).toBe(data.stats.ramadan + data.stats.nonRamadan);
    expect(data.records.map((r) => r.localDate)).toEqual(['2027-02-20', '2026-08-01', '2026-07-01', '2026-03-01']);
  });

  it('declining (ليس الآن) changes nothing: the completion stays pending and the page stays saved', async () => {
    await readTo('Daily', 1, 604);
    const before = await loadReadingData();
    const after = await loadReadingData();
    expect(after.wirds[0]).toEqual(before.wirds[0]);
    expect(after.wirds[0].status).toBe('pending');
  });

  it('survives a restart: records and counts are read back from storage', async () => {
    await readTo('Daily', 1, 604);
    const w = await wird('Daily');
    await confirmKhatma(w.stop.id, w.cycle.id, options());
    resetLocalDataOwnerForTests();
    expect((await loadReadingData()).stats.total).toBe(1);
  });

  it('an app killed between the two writes of a confirmation is finished on the next load, never counted twice', async () => {
    await readTo('Daily', 1, 604);
    const w = await wird('Daily');
    storage.failWritesAfter = storage.writes + 1; // the record + new cycle are written; the stop's page is not
    await expect(confirmKhatma(w.stop.id, w.cycle.id, options())).rejects.toThrow('app killed');
    storage.failWritesAfter = Infinity;
    const data = await loadReadingData();
    expect(data.records).toHaveLength(1);
    expect(data.wirds[0]).toMatchObject({ status: 'reading', khatmas: 1 });
    expect(data.wirds[0].stop.page).toBe(1);
    expect((await confirmKhatma(w.stop.id, w.cycle.id, options())).alreadyRecorded).toBe(true);
  });
});

describe('correcting a mistaken Khatma', () => {
  it('right after confirming: the record goes, the ورد returns to 604 with completion pending, counts recalculate', async () => {
    await readTo('Daily', 1, 604);
    const w = await wird('Daily');
    const { record } = await confirmKhatma(w.stop.id, w.cycle.id, options());
    expect(await removeKhatma(record.id)).toBe('restored');
    const after = await wird('Daily');
    expect(after).toMatchObject({ status: 'pending', khatmas: 0 });
    expect(after.stop.page).toBe(604);
    expect(after.cycle.id).toBe(w.cycle.id);
    expect((await loadReadingData()).stats.total).toBe(0);
    // And it can be confirmed again, once.
    expect((await confirmKhatma(w.stop.id, w.cycle.id, options())).alreadyRecorded).toBe(false);
    expect((await loadReadingData()).stats.total).toBe(1);
  });

  it('after reading on: the record goes but the current progress is never erased', async () => {
    await readTo('Daily', 1, 604);
    const w = await wird('Daily');
    const { record } = await confirmKhatma(w.stop.id, w.cycle.id, options());
    await readTo('Daily', 40);
    expect(await removeKhatma(record.id)).toBe('kept');
    expect((await wird('Daily')).stop.page).toBe(40);
  });

  it('never affects another ورد', async () => {
    await readTo('A', 1, 604);
    await readTo('B', 1, 604);
    const a = await wird('A');
    const b = await wird('B');
    const { record } = await confirmKhatma(a.stop.id, a.cycle.id, options());
    await confirmKhatma(b.stop.id, b.cycle.id, options());
    const bBefore = await wird('B');
    await removeKhatma(record.id);
    expect(await wird('B')).toEqual(bBefore);
  });
});

describe('renaming and deleting', () => {
  it('renaming keeps the cycle and the count; history shows the record`s own name', async () => {
    await readTo('Daily', 1, 604);
    const w = await wird('Daily');
    await confirmKhatma(w.stop.id, w.cycle.id, options());
    await renameReadingStop(w.stop.id, 'Morning');
    const data = await loadReadingData();
    expect(data.wirds[0]).toMatchObject({ khatmas: 1 });
    expect(data.wirds[0].stop.name).toBe('Morning');
  });

  it('deleting a ورد keeps its completed Khatmas in the history and totals; other ورد are untouched', async () => {
    await readTo('Daily', 1, 604);
    await readTo('Other', 77);
    const w = await wird('Daily');
    await confirmKhatma(w.stop.id, w.cycle.id, options());
    await deleteWird(w.stop.id);
    const data = await loadReadingData();
    expect(data.wirds.map((x) => [x.stop.name, x.stop.page])).toEqual([['Other', 77]]);
    expect(data.records.map((r) => r.stopName)).toEqual(['Daily']);
    expect(data.stats.total).toBe(1);
  });

  it('creating refuses a name already in use (any case) instead of moving that ورد', async () => {
    await readTo('Daily', 200);
    expect(await errorKind(() => createWird({ name: 'DAILY' }, options()))).toBe('name_taken');
    expect((await wird('Daily')).stop.page).toBe(200);
  });
});

describe('guest and account partitions', () => {
  it('each owner sees only its own ورد and Khatmas', async () => {
    asGuest();
    await readTo('Guest wird', 10);
    asAccount('A');
    expect((await loadReadingData()).wirds).toEqual([]);
    await readTo('A wird', 20, 604);
    const a = await wird('A wird');
    await confirmKhatma(a.stop.id, a.cycle.id, options());
    asAccount('B');
    expect((await loadReadingData()).stats.total).toBe(0);
    asGuest();
    expect((await loadReadingData()).wirds.map((w) => w.stop.name)).toEqual(['Guest wird']);
    // The guest partition is the original key, unchanged.
    expect(JSON.parse(storage.map.get(READING_STOPS_STORAGE_KEY)!)[0].name).toBe('Guest wird');
    expect(storage.map.has(`${READING_STOPS_STORAGE_KEY}:account:A`)).toBe(true);
  });

  it('"Add to this account" moves the guest`s ورد and Khatmas without overwriting; duplicate names are numbered', async () => {
    asGuest();
    await readTo('Daily', 1, 604);
    const g = await wird('Daily');
    await confirmKhatma(g.stop.id, g.cycle.id, options());
    await readTo('Daily', 50);
    asAccount('A');
    await readTo('Daily', 300);
    expect(await guestHasReadingData()).toBe(true);
    expect(await adoptGuestReadingData('A')).toBe(true);
    const data = await loadReadingData();
    expect(Object.fromEntries(data.wirds.map((w) => [w.stop.name, w.stop.page]))).toEqual({ Daily: 300, 'Daily (2)': 50 });
    expect(data.stats.total).toBe(1);
    expect(data.wirds.find((w) => w.stop.name === 'Daily (2)')!.khatmas).toBe(1);
    expect(await guestHasReadingData()).toBe(false);
    expect(storage.map.has(READING_STOPS_STORAGE_KEY)).toBe(false);
    expect(storage.map.has(KHATMAS_STORAGE_KEY)).toBe(false);
    expect(storage.map.has(ACTIVE_READING_STOP_STORAGE_KEY)).toBe(false);
  });

  it('unreadable guest data is never moved or deleted', async () => {
    storage.map.set(READING_STOPS_STORAGE_KEY, '{broken');
    expect(await adoptGuestReadingData('A')).toBe(false);
    expect(storage.map.get(READING_STOPS_STORAGE_KEY)).toBe('{broken');
  });

  it('account deletion clears only that account`s reading data', async () => {
    asGuest();
    await readTo('Guest wird', 10);
    asAccount('A');
    await readTo('A wird', 20);
    asAccount('B');
    await readTo('B wird', 30);
    await clearAccountReadingData('A');
    expect((await loadReadingData('A')).wirds).toEqual([]);
    expect((await loadReadingData('B')).wirds).toHaveLength(1);
    expect((await loadReadingData(null)).wirds).toHaveLength(1);
  });
});
