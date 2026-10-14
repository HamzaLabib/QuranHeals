import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeReadingServer } from './helpers/fakeReadingServer';

/**
 * أورادي وختماتي sync between two devices whose system clocks disagree
 * (release audit, offline conflict ordering). Same harness as
 * readingSync.test.ts: each device is its own AsyncStorage, both talk to one
 * fake account server with the backend's rules, and the real reading data
 * and merge rules run unchanged. Each device's clock is the `now` it stamps
 * its saves, renames and confirmations with.
 *
 * What these pin down:
 *  - Edits made one after the other (the second device had already synced
 *    the first's) are ordered by the account's revisions, never by clocks.
 *  - Edits made concurrently offline are ordered by the devices' own
 *    timestamps: deterministic and identical on both devices, but a device
 *    whose clock runs ahead wins even when it saved earlier in real time.
 *    Real-time order cannot be established in that case.
 *  - Confirmed Khatmas are ordered by cycle generation (`seq`), not clocks:
 *    no clock setting lets a stale device revert or duplicate one, and the
 *    record keeps the confirming device's own date.
 */
const env = vi.hoisted(() => ({ storage: new Map<string, string>(), online: true }));

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => env.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { env.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { env.storage.delete(key); }),
  },
}));
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));
vi.mock('@/services/quran', () => ({ resolveAyahArabic: async (value: unknown) => value, getVerseByKey: async () => null }));

const khatmas = await import('@/mushaf/khatmas');
const { renameReadingStop } = await import('@/mushaf/readingStops');
const { resetLocalDataOwnerForTests } = await import('@/storage/localDataOwner');
const { activateLocalDataForAccount } = await import('@/storage/localDataOwnership');
const { syncReading } = await import('@/sync/readingSync');

let server: FakeReadingServer;

type Device = { name: string; storage: Map<string, string>; online: boolean };
const device = (name: string): Device => ({ name, storage: new Map(), online: true });
let iphone: Device;
let android: Device;

async function on<T>(d: Device, work: () => Promise<T>): Promise<T> {
  env.storage = d.storage;
  env.online = d.online;
  resetLocalDataOwnerForTests();
  await activateLocalDataForAccount('A');
  return work();
}
const sync = (d: Device) => on(d, () => syncReading('token-A', 'A'));
const read = (d: Device) => on(d, () => khatmas.loadReadingData());
/** A device clock reading `iso` (whatever the real time is). */
const clock = (iso: string) => ({ now: () => new Date(iso) });
const offline = (...devices: Device[]) => devices.forEach((d) => { d.online = false; });
const online = (...devices: Device[]) => devices.forEach((d) => { d.online = true; });

async function shown(d: Device) {
  const data = await read(d);
  return {
    wirds: data.wirds.map((w) => ({ id: w.stop.id, name: w.stop.name, page: w.stop.page, status: w.status, khatmas: w.khatmas, cycle: w.cycle.id })).sort((a, b) => a.id.localeCompare(b.id)),
    records: data.records.map((r) => ({ id: r.id, cycleId: r.cycleId, completedAt: r.completedAt, localDate: r.localDate, ramadan: r.ramadan })).sort((a, b) => a.id.localeCompare(b.id)),
    stats: data.stats,
  };
}
const wird = async (d: Device, name: string) => (await read(d)).wirds.find((w) => w.stop.name === name)!;

/** Both devices hold `name` at `page`, synced. */
async function bothHave(name: string, page: number) {
  await on(iphone, () => khatmas.saveWirdPage({ name, page }, clock('2026-10-01T00:00:00Z')));
  await sync(iphone);
  await sync(android);
}

/** Syncs until both devices agree with the account (at most a few rounds), in the given order. */
async function reconcile(first: Device, second: Device) {
  await sync(first);
  await sync(second);
  await sync(first);
}

beforeEach(() => {
  iphone = device('iphone');
  android = device('android');
  server = new FakeReadingServer((token) => (token.startsWith('token-') ? token.slice(6) : null));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!env.online) throw new TypeError('Network request failed');
    if (new URL(url).pathname === '/api/sync/reading') return server.handle(url, init);
    throw new Error(`unexpected request ${url}`);
  }));
});

describe('edits made one after the other: ordered by the account, never by clocks', () => {
  it('a device whose clock is years behind still moves the ورد forward after it has synced the other`s save', async () => {
    await bothHave('Fajr', 10);
    // iPhone (correct clock) saves page 200 and syncs.
    await on(iphone, () => khatmas.saveWirdPage({ name: 'Fajr', page: 200 }, clock('2026-10-13T09:00:00Z')));
    await sync(iphone);
    // Android, whose clock says 2021, downloads that, then saves page 250 later in real time.
    await sync(android);
    await on(android, () => khatmas.saveWirdPage({ name: 'Fajr', page: 250 }, clock('2021-01-01T00:00:00Z')));
    await reconcile(android, iphone);
    for (const d of [iphone, android]) expect((await shown(d)).wirds).toEqual([expect.objectContaining({ name: 'Fajr', page: 250 })]);
  });

  it('a rename from a device with a clock far behind still applies when it follows the other`s rename', async () => {
    await bothHave('Fajr', 10);
    const id = (await wird(iphone, 'Fajr')).stop.id;
    await on(iphone, () => renameReadingStop(id, 'Morning', clock('2026-10-13T09:00:00Z')));
    await sync(iphone);
    await sync(android);
    await on(android, () => renameReadingStop(id, 'Dawn', clock('2019-05-05T00:00:00Z')));
    await reconcile(android, iphone);
    for (const d of [iphone, android]) expect((await shown(d)).wirds).toEqual([expect.objectContaining({ id, name: 'Dawn' })]);
  });
});

describe('edits made concurrently offline: ordered by device timestamps (deterministic, not real time)', () => {
  it('the device whose clock runs ahead wins the page, even though it saved first in real time; both devices agree', async () => {
    await bothHave('Fajr', 10);
    offline(iphone, android);
    // Real time 08:00: the iPhone (clock 3 h fast, reads 11:00) saves page 50.
    await on(iphone, () => khatmas.saveWirdPage({ name: 'Fajr', page: 50 }, clock('2026-10-13T11:00:00Z')));
    // Real time 10:00: Android (correct clock) saves page 80 — the reader's actual latest position.
    await on(android, () => khatmas.saveWirdPage({ name: 'Fajr', page: 80 }, clock('2026-10-13T10:00:00Z')));
    online(iphone, android);
    await reconcile(android, iphone);
    const a = await shown(iphone);
    expect(await shown(android)).toEqual(a);
    // Known limitation: the later device timestamp (page 50) wins, not the later real-time save (page 80).
    expect(a.wirds).toEqual([expect.objectContaining({ name: 'Fajr', page: 50, status: 'reading' })]);
  });

  it('the outcome does not depend on which device reconnects first', async () => {
    const outcomes: number[] = [];
    for (const order of [['iphone', 'android'], ['android', 'iphone']] as const) {
      iphone = device('iphone');
      android = device('android');
      server = new FakeReadingServer((token) => (token.startsWith('token-') ? token.slice(6) : null));
      await bothHave('Fajr', 10);
      offline(iphone, android);
      await on(iphone, () => khatmas.saveWirdPage({ name: 'Fajr', page: 50 }, clock('2026-10-13T11:00:00Z')));
      await on(android, () => khatmas.saveWirdPage({ name: 'Fajr', page: 80 }, clock('2026-10-13T10:00:00Z')));
      online(iphone, android);
      const [first, second] = order.map((name) => (name === 'iphone' ? iphone : android));
      await reconcile(first, second);
      const a = await shown(iphone);
      expect(await shown(android)).toEqual(a);
      outcomes.push(a.wirds[0].page);
    }
    expect(outcomes).toEqual([50, 50]);
  });

  it('identical timestamps on both devices: the version that reached the account first is kept, the same on both', async () => {
    await bothHave('Fajr', 10);
    offline(iphone, android);
    await on(iphone, () => khatmas.saveWirdPage({ name: 'Fajr', page: 50 }, clock('2026-10-13T10:00:00Z')));
    await on(android, () => khatmas.saveWirdPage({ name: 'Fajr', page: 80 }, clock('2026-10-13T10:00:00Z')));
    online(iphone, android);
    await reconcile(android, iphone);
    const a = await shown(iphone);
    expect(await shown(android)).toEqual(a);
    expect(a.wirds[0].page).toBe(80);
  });

  it('concurrent renames follow the same rule: the later rename timestamp wins on both devices', async () => {
    await bothHave('Fajr', 10);
    const id = (await wird(iphone, 'Fajr')).stop.id;
    offline(iphone, android);
    await on(iphone, () => renameReadingStop(id, 'Morning', clock('2026-10-13T12:00:00Z'))); // fast clock, earlier in real time
    await on(android, () => renameReadingStop(id, 'Dawn', clock('2026-10-13T10:00:00Z')));
    online(iphone, android);
    await reconcile(android, iphone);
    for (const d of [iphone, android]) expect((await shown(d)).wirds).toEqual([expect.objectContaining({ id, name: 'Morning' })]);
  });
});

describe('confirmed Khatmas are protected whatever the clocks say', () => {
  it('a device with a clock far ahead, offline in the finished cycle, never reverts or duplicates a Khatma confirmed on a device with a clock far behind', async () => {
    await bothHave('Fajr', 600);
    await on(iphone, () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }, clock('2026-10-02T00:00:00Z')));
    await sync(iphone);
    await sync(android);
    offline(android);
    // The iPhone's clock reads 2020; it confirms the Khatma.
    const w = await wird(iphone, 'Fajr');
    const { record } = await on(iphone, () => khatmas.confirmKhatma(w.stop.id, w.cycle.id, clock('2020-03-01T12:00:00Z')));
    await sync(iphone);
    // Android's clock reads 2035; offline, it saves and renames in the cycle the iPhone already finished.
    await on(android, () => khatmas.saveWirdPage({ name: 'Fajr', page: 590 }, clock('2035-01-01T00:00:00Z')));
    online(android);
    await reconcile(android, iphone);
    for (const d of [iphone, android]) {
      const s = await shown(d);
      expect(s.stats.total).toBe(1);
      expect(s.wirds).toEqual([expect.objectContaining({ page: 1, status: 'reading', khatmas: 1 })]);
      // Taken exactly as the confirming device recorded it: never re-dated by the other's clock.
      expect(s.records).toEqual([expect.objectContaining({ id: record.id, completedAt: '2020-03-01T12:00:00.000Z', localDate: record.localDate })]);
    }
    expect(server.active('A', 'khatma')).toHaveLength(1);
  });

  it('both devices confirm the same completion offline with different clocks: one Khatma, the first to reach the account, the same on both', async () => {
    await bothHave('Fajr', 600);
    await on(iphone, () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }, clock('2026-10-02T00:00:00Z')));
    await sync(iphone);
    await sync(android);
    offline(iphone, android);
    const wi = await wird(iphone, 'Fajr');
    const wa = await wird(android, 'Fajr');
    await on(iphone, () => khatmas.confirmKhatma(wi.stop.id, wi.cycle.id, clock('2031-01-01T00:00:00Z')));
    await on(android, () => khatmas.confirmKhatma(wa.stop.id, wa.cycle.id, clock('2024-01-01T00:00:00Z')));
    online(iphone, android);
    await reconcile(android, iphone);
    const a = await shown(iphone);
    expect(await shown(android)).toEqual(a);
    expect(a.stats.total).toBe(1);
    // Android reached the account first, so its record (and its own date) is the Khatma.
    expect(a.records[0].completedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(server.active('A', 'khatma')).toHaveLength(1);
  });

  it('an undo on a device with a clock far behind still never erases progress saved on the other device', async () => {
    await bothHave('Fajr', 600);
    await on(iphone, () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }, clock('2026-10-02T00:00:00Z')));
    const w = await wird(iphone, 'Fajr');
    const { record } = await on(iphone, () => khatmas.confirmKhatma(w.stop.id, w.cycle.id, clock('2026-10-03T00:00:00Z')));
    await sync(iphone);
    await sync(android);
    offline(iphone, android);
    await on(android, () => khatmas.saveWirdPage({ name: 'Fajr', page: 50 }, clock('2026-10-04T00:00:00Z')));
    await on(iphone, () => khatmas.removeKhatma(record.id, clock('2018-01-01T00:00:00Z')));
    online(iphone, android);
    await reconcile(iphone, android);
    for (const d of [iphone, android]) {
      const s = await shown(d);
      expect(s.stats.total).toBe(0);
      expect(s.wirds).toEqual([expect.objectContaining({ page: 50, status: 'reading' })]);
    }
  });
});
