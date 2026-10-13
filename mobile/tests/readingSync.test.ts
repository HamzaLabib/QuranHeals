import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeReadingServer } from './helpers/fakeReadingServer';

/**
 * أورادي وختماتي sync between devices of one account (sync/readingSync.ts).
 *
 * Each "device" is its own AsyncStorage; both talk to one fake account
 * server with the backend's rules (helpers/fakeReadingServer.ts). The real
 * reading data (mushaf/khatmas.ts) and merge rules run unchanged. Account-
 * based like favorites: only the session — never a Sync Password or key.
 * A device is offline when its fetch fails.
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
// Reached through storage/localDataOwnership.ts (favorites); never called here.
vi.mock('@/services/quran', () => ({ resolveAyahArabic: async (value: unknown) => value, getVerseByKey: async () => null }));

const khatmas = await import('@/mushaf/khatmas');
const { renameReadingStop, setActiveReadingStopId } = await import('@/mushaf/readingStops');
const { resetLocalDataOwnerForTests } = await import('@/storage/localDataOwner');
const { activateLocalDataForAccount, activateGuestLocalData } = await import('@/storage/localDataOwnership');
const { syncReading } = await import('@/sync/readingSync');
const { getReadingSyncStatus } = await import('@/sync/readingSyncState');

let server: FakeReadingServer;

type Device = { name: string; storage: Map<string, string>; online: boolean };
const device = (name: string): Device => ({ name, storage: new Map(), online: true });
let iphone: Device;
let android: Device;

/** Runs `work` on `d`, signed in to `account` (null: the guest). */
async function on<T>(d: Device, account: string | null, work: () => Promise<T>): Promise<T> {
  env.storage = d.storage;
  env.online = d.online;
  resetLocalDataOwnerForTests();
  if (account) await activateLocalDataForAccount(account);
  else await activateGuestLocalData();
  return work();
}
const sync = (d: Device, account = 'A') => on(d, account, () => syncReading(`token-${account}`, account));
const syncOrFail = async (d: Device, account = 'A') => sync(d, account).catch(() => 'failed' as const);
const read = (d: Device, account: string | null = 'A') => on(d, account, () => khatmas.loadReadingData());
const at = (iso: string) => ({ now: () => new Date(iso) });

/** What أورادي وختماتي shows, comparable across devices. */
async function shown(d: Device, account: string | null = 'A') {
  const data = await read(d, account);
  return {
    wirds: data.wirds.map((w) => ({ id: w.stop.id, name: w.stop.name, page: w.stop.page, status: w.status, khatmas: w.khatmas, cycle: w.cycle.id })).sort((a, b) => a.id.localeCompare(b.id)),
    records: data.records.map((r) => ({ id: r.id, cycleId: r.cycleId, ramadan: r.ramadan, completedAt: r.completedAt, localDate: r.localDate })).sort((a, b) => a.id.localeCompare(b.id)),
    stats: data.stats,
    active: data.wirds.find((w) => w.stop.id === data.activeStopId)?.stop.name ?? null,
  };
}
const wird = async (d: Device, name: string, account = 'A') => (await read(d, account)).wirds.find((w) => w.stop.name === name)!;

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

describe('two devices, one account', () => {
  it('page 250 saved on the iPhone appears on Android; a ورد created on Android appears on the iPhone; Android`s update reaches the iPhone', async () => {
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'ورد الفجر', page: 250 }));
    expect(await sync(iphone)).toBe(true);
    expect(await sync(android)).toBe(true);
    expect((await shown(android)).wirds).toEqual([expect.objectContaining({ name: 'ورد الفجر', page: 250, status: 'reading' })]);
    expect((await shown(android)).active).toBe('ورد الفجر');

    await on(android, 'A', () => khatmas.createWird({ name: 'ورد رمضان', page: 12 }));
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'ورد الفجر', page: 260 }));
    await sync(android);
    await sync(iphone);
    expect(await shown(iphone)).toEqual(await shown(android));
    expect((await shown(iphone)).wirds.map((w) => [w.name, w.page])).toEqual(expect.arrayContaining([['ورد الفجر', 260], ['ورد رمضان', 12]]));
  });

  it('a Khatma confirmed on the iPhone appears exactly once on Android, with the same date, Ramadan classification and counts', async () => {
    await on(iphone, 'A', async () => {
      await khatmas.saveWirdPage({ name: 'Daily', page: 600 });
      await khatmas.saveWirdPage({ name: 'Daily', page: 604 });
    });
    await sync(iphone);
    await sync(android);
    const pending = await wird(iphone, 'Daily');
    const { record } = await on(iphone, 'A', () => khatmas.confirmKhatma(pending.stop.id, pending.cycle.id, at('2027-02-10T12:00:00Z')));
    expect(record.ramadan).toBe(true);
    await sync(iphone);
    await sync(android);
    await sync(android); // again: nothing is counted twice
    const a = await shown(iphone);
    const b = await shown(android);
    expect(b).toEqual(a);
    expect(b.records).toEqual([expect.objectContaining({ id: record.id, ramadan: true, completedAt: record.completedAt, localDate: record.localDate })]);
    expect(b.stats).toEqual({ total: 1, ramadan: 1, nonRamadan: 0 });
    expect(b.stats.total).toBe(b.stats.ramadan + b.stats.nonRamadan);
    expect(b.wirds[0]).toMatchObject({ page: 1, status: 'reading', khatmas: 1 });
    expect(server.active('A', 'khatma')).toHaveLength(1);
  });

  it('needs only the session: no Sync Password, key or reflections; content goes to the signed-in account alone', async () => {
    await on(iphone, 'A', async () => {
      await khatmas.saveWirdPage({ name: 'ورد أمي', page: 1 });
      await khatmas.saveWirdPage({ name: 'ورد أمي', page: 604 });
      const w = await wird(iphone, 'ورد أمي');
      await khatmas.confirmKhatma(w.stop.id, w.cycle.id, at('2027-02-10T12:00:00Z'));
    });
    expect(await sync(iphone)).toBe(true);
    expect(server.active('A', 'wird')[0].data).toMatchObject({ name: 'ورد أمي', page: 1 });
    expect(server.active('A', 'khatma')[0].data).toMatchObject({ ramadan: true, localDate: '2027-02-10' });
    expect(server.log.every((entry) => entry.account === 'A')).toBe(true);
    expect(server.accounts.has('B')).toBe(false);
  });
});

describe('conflicts (both devices offline, then reconnecting)', () => {
  async function bothHave(name: string, page: number) {
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name, page }));
    await sync(iphone);
    await sync(android);
  }
  const offline = (...devices: Device[]) => devices.forEach((d) => { d.online = false; });
  const online = (...devices: Device[]) => devices.forEach((d) => { d.online = true; });

  it('1. different أوراد edited on each device: both edits kept', async () => {
    await bothHave('Fajr', 10);
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Isha', page: 5 }));
    await sync(iphone);
    await sync(android);
    offline(iphone, android);
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 20 }));
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'Isha', page: 30 }));
    expect(await syncOrFail(iphone)).toBe('failed');
    online(iphone, android);
    await sync(iphone);
    await sync(android);
    await sync(iphone);
    expect(await shown(iphone)).toEqual(await shown(android));
    expect((await shown(iphone)).wirds.map((w) => [w.name, w.page]).sort()).toEqual([['Fajr', 20], ['Isha', 30]]);
  });

  it('2. both devices rename the same ورد: the later rename wins on both', async () => {
    await bothHave('Fajr', 10);
    const id = (await wird(iphone, 'Fajr')).stop.id;
    offline(iphone, android);
    await on(iphone, 'A', () => renameReadingStop(id, 'Morning', at('2026-10-13T08:00:00Z')));
    await on(android, 'A', () => renameReadingStop(id, 'Dawn', at('2026-10-13T09:00:00Z')));
    online(iphone, android);
    await sync(android);
    await sync(iphone);
    await sync(android);
    expect((await shown(iphone)).wirds).toEqual([expect.objectContaining({ id, name: 'Dawn', page: 10 })]);
    expect(await shown(android)).toEqual(await shown(iphone));
  });

  it('3. both save different pages of the same ورد: the LATER SAVE wins — not the higher page', async () => {
    await bothHave('Fajr', 10);
    offline(iphone, android);
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 450 }, at('2026-10-13T08:00:00Z')));
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 300 }, at('2026-10-13T09:00:00Z')));
    online(iphone, android);
    await sync(android);
    await sync(iphone);
    await sync(android);
    expect((await shown(iphone)).wirds).toEqual([expect.objectContaining({ name: 'Fajr', page: 300 })]);
    expect(await shown(android)).toEqual(await shown(iphone));
  });

  it('4. deleted on one device, edited offline on the other: the deletion wins; its Khatmas stay in the history', async () => {
    await on(iphone, 'A', async () => {
      await khatmas.saveWirdPage({ name: 'Fajr', page: 1 });
      await khatmas.saveWirdPage({ name: 'Fajr', page: 604 });
      const w = await wird(iphone, 'Fajr');
      await khatmas.confirmKhatma(w.stop.id, w.cycle.id, at('2027-06-10T12:00:00Z'));
    });
    await sync(iphone);
    await sync(android);
    const id = (await wird(iphone, 'Fajr')).stop.id;
    offline(android);
    await on(iphone, 'A', () => khatmas.deleteWird(id));
    await sync(iphone);
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 77 }));
    online(android);
    await sync(android);
    await sync(iphone);
    for (const d of [iphone, android]) {
      const s = await shown(d);
      expect(s.wirds).toEqual([]);
      expect(s.stats).toEqual({ total: 1, ramadan: 0, nonRamadan: 1 });
    }
    expect(server.record('A', 'wird', id)?.deleted).toBe(true);
  });

  it('5. a Khatma confirmed on one device while the other, offline, saved a page in the finished cycle: the confirmation stands', async () => {
    await bothHave('Fajr', 600);
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }));
    await sync(iphone);
    await sync(android);
    offline(android);
    const w = await wird(iphone, 'Fajr');
    await on(iphone, 'A', () => khatmas.confirmKhatma(w.stop.id, w.cycle.id));
    await sync(iphone);
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 590 }, at('2030-01-01T00:00:00Z')));
    online(android);
    await sync(android);
    await sync(iphone);
    for (const d of [iphone, android]) {
      const s = await shown(d);
      expect(s.stats.total).toBe(1);
      // The new cycle (page 1), never the stale page of the cycle already completed.
      expect(s.wirds).toEqual([expect.objectContaining({ page: 1, status: 'reading', khatmas: 1 })]);
    }
    expect(await shown(android)).toEqual(await shown(iphone));
  });

  it('6. the same confirmation retried many times (lost responses, repeated taps) is one Khatma', async () => {
    await bothHave('Fajr', 600);
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }));
    const w = await wird(iphone, 'Fajr');
    await on(iphone, 'A', async () => {
      await khatmas.confirmKhatma(w.stop.id, w.cycle.id);
      expect((await khatmas.confirmKhatma(w.stop.id, w.cycle.id)).alreadyRecorded).toBe(true);
    });
    // Twice the request never reaches the account (offline)…
    iphone.online = false;
    expect(await syncOrFail(iphone)).toBe('failed');
    expect(await syncOrFail(iphone)).toBe('failed');
    iphone.online = true;
    // …then it does, but the answer is lost on the way back.
    server.loseNextPushResponse = true;
    expect(await syncOrFail(iphone)).toBe('failed');
    const khatmaUploads = () => server.log.flatMap((entry) => entry.changes ?? []).filter((c) => c.kind === 'khatma' && c.action === 'upsert').length;
    expect(khatmaUploads()).toBe(1);
    // The next sync learns from the account that it arrived: nothing is sent again.
    expect(await sync(iphone)).toBe(true);
    expect(await sync(iphone)).toBe(true);
    expect(khatmaUploads()).toBe(1);
    await sync(android);
    expect(server.active('A', 'khatma')).toHaveLength(1);
    expect((await shown(iphone)).stats.total).toBe(1);
    expect((await shown(android)).stats.total).toBe(1);
  });

  it('6b. both devices confirm the same completion offline: one Khatma, the same on both', async () => {
    await bothHave('Fajr', 600);
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }));
    await sync(iphone);
    await sync(android);
    offline(iphone, android);
    for (const [d, iso] of [[iphone, '2027-02-10T10:00:00Z'], [android, '2027-02-10T11:00:00Z']] as const) {
      const w = await wird(d, 'Fajr');
      await on(d, 'A', () => khatmas.confirmKhatma(w.stop.id, w.cycle.id, at(iso)));
    }
    online(iphone, android);
    await sync(iphone);
    await sync(android);
    await sync(iphone);
    expect(server.active('A', 'khatma')).toHaveLength(1);
    const a = await shown(iphone);
    expect(a.stats).toEqual({ total: 1, ramadan: 1, nonRamadan: 0 });
    expect(await shown(android)).toEqual(a);
    // The first to reach the account is the record kept, with its own date.
    expect(a.records[0].completedAt).toBe('2027-02-10T10:00:00.000Z');
  });

  it('7. a Khatma removed on one device is never restored by the other`s older copy', async () => {
    await bothHave('Fajr', 600);
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }));
    const w = await wird(iphone, 'Fajr');
    const { record } = await on(iphone, 'A', () => khatmas.confirmKhatma(w.stop.id, w.cycle.id));
    await sync(iphone);
    await sync(android);
    offline(android);
    await on(iphone, 'A', () => khatmas.removeKhatma(record.id));
    await sync(iphone);
    online(android);
    await sync(android);
    await sync(iphone);
    for (const d of [iphone, android]) expect((await shown(d)).stats.total).toBe(0);
    expect(server.record('A', 'khatma', record.id)?.deleted).toBe(true);
    // Not saved since: the undo returned it to 604 awaiting confirmation, on both.
    expect((await shown(android)).wirds).toEqual([expect.objectContaining({ page: 604, status: 'pending' })]);
    // Confirming it again records a new Khatma (a new id), never the removed one.
    const again = await wird(android, 'Fajr');
    const { record: second } = await on(android, 'A', () => khatmas.confirmKhatma(again.stop.id, again.cycle.id));
    expect(second.id).not.toBe(record.id);
    await sync(android);
    await sync(iphone);
    expect((await shown(iphone)).stats.total).toBe(1);
  });

  it('7b. an undo on one device never erases progress saved meanwhile on the other', async () => {
    await bothHave('Fajr', 600);
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }));
    const w = await wird(iphone, 'Fajr');
    const { record } = await on(iphone, 'A', () => khatmas.confirmKhatma(w.stop.id, w.cycle.id));
    await sync(iphone);
    await sync(android);
    offline(iphone, android);
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 50 }));
    await on(iphone, 'A', () => khatmas.removeKhatma(record.id));
    online(iphone, android);
    await sync(iphone);
    await sync(android);
    await sync(iphone);
    for (const d of [iphone, android]) {
      const s = await shown(d);
      expect(s.stats.total).toBe(0); // the removal itself stands
      expect(s.wirds).toEqual([expect.objectContaining({ page: 50, status: 'reading' })]); // and so does the later reading
    }
  });

  it('8. a completion pending on one device, confirmed on the other: it is recorded once, and no longer pending anywhere', async () => {
    await bothHave('Fajr', 600);
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 604 }));
    await sync(android);
    await sync(iphone);
    expect((await shown(android)).wirds[0].status).toBe('pending');
    const pendingOnAndroid = await wird(android, 'Fajr');
    const w = await wird(iphone, 'Fajr');
    await on(iphone, 'A', () => khatmas.confirmKhatma(w.stop.id, w.cycle.id));
    await sync(iphone);
    await sync(android);
    expect((await shown(android)).wirds[0]).toMatchObject({ status: 'reading', page: 1, khatmas: 1 });
    // A stale confirmation screen on Android finds it already recorded (or stale): never a second Khatma.
    const retry = await on(android, 'A', () => khatmas.confirmKhatma(pendingOnAndroid.stop.id, pendingOnAndroid.cycle.id).then((r) => r.alreadyRecorded, (e: { kind?: string }) => e.kind));
    expect([true, 'stale']).toContain(retry);
    await sync(android);
    expect(server.active('A', 'khatma')).toHaveLength(1);
  });

  it('9. changing accounts while changes wait: each account receives only its own, when it next syncs', async () => {
    iphone.online = false;
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'A-wird', page: 40 }));
    expect(await syncOrFail(iphone, 'A')).toBe('failed');
    iphone.online = true;
    // Account B signs in on the same phone and syncs: nothing of A goes to B.
    await on(iphone, 'B', () => khatmas.saveWirdPage({ name: 'B-wird', page: 7 }));
    await sync(iphone, 'B');
    expect(server.active('B', 'wird')).toHaveLength(1);
    expect(server.active('A', 'wird')).toHaveLength(0);
    expect((await shown(iphone, 'B')).wirds.map((w) => w.name)).toEqual(['B-wird']);
    // A signs in again later: its waiting change goes up then.
    await sync(iphone, 'A');
    expect(server.active('A', 'wird')).toHaveLength(1);
    expect(server.active('B', 'wird')).toHaveLength(1);
    // And B's other device never sees A's data.
    await sync(android, 'B');
    expect((await shown(android, 'B')).wirds.map((w) => w.name)).toEqual(['B-wird']);
  });

  it('10. a device back after days offline with many changes, while the other kept going: everything reconciles, nothing lost or doubled', async () => {
    await bothHave('Fajr', 1);
    android.online = false;
    for (const [day, page] of [[1, 40], [2, 90], [3, 150], [4, 600], [5, 604]] as const) {
      await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page }, at(`2026-10-0${day}T06:00:00Z`)));
      await sync(iphone);
    }
    const f = await wird(iphone, 'Fajr');
    await on(iphone, 'A', () => khatmas.confirmKhatma(f.stop.id, f.cycle.id, at('2026-10-06T06:00:00Z')));
    await sync(iphone);
    for (const [day, name, page] of [[1, 'Isha', 10], [3, 'Isha', 55], [4, 'Duha', 3]] as const) {
      await on(android, 'A', () => khatmas.saveWirdPage({ name, page }, at(`2026-10-0${day}T20:00:00Z`)));
      expect(await syncOrFail(android)).toBe('failed');
    }
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 12 }, at('2026-10-02T20:00:00Z')));
    android.online = true;
    await sync(android);
    await sync(iphone);
    const a = await shown(iphone);
    expect(await shown(android)).toEqual(a);
    expect(a.wirds.map((w) => [w.name, w.page]).sort()).toEqual([['Duha', 3], ['Fajr', 1], ['Isha', 55]]);
    expect(a.stats.total).toBe(1);
    expect(getReadingSyncStatus().state).toBe('synced');
  });
});

describe('active ورد, names and deletion', () => {
  it('the selected ورد follows the latest choice; if it is deleted elsewhere, no ورد is selected (the established empty state)', async () => {
    await on(iphone, 'A', async () => {
      await khatmas.createWird({ name: 'One' });
      await khatmas.createWird({ name: 'Two' });
    });
    await sync(iphone);
    await sync(android);
    expect((await shown(android)).active).toBe('Two');
    const one = await wird(android, 'One');
    await on(android, 'A', () => setActiveReadingStopId(one.stop.id));
    await sync(android);
    await sync(iphone);
    expect((await shown(iphone)).active).toBe('One');
    await on(iphone, 'A', () => khatmas.deleteWird(one.stop.id));
    await sync(iphone);
    await sync(android);
    expect((await shown(android)).active).toBeNull();
    expect((await shown(android)).wirds.map((w) => w.name)).toEqual(['Two']);
  });

  it('two أوراد created offline with the same name on two devices: both kept, one renamed — the same way on both', async () => {
    iphone.online = false;
    android.online = false;
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'ورد الفجر', page: 20 }));
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'ورد الفجر', page: 300 }));
    iphone.online = true;
    android.online = true;
    await sync(iphone);
    await sync(android);
    await sync(iphone);
    const a = await shown(iphone);
    expect(a.wirds.map((w) => w.name).sort()).toEqual(['ورد الفجر', 'ورد الفجر (2)']);
    expect(a.wirds.map((w) => w.page).sort((x, y) => x - y)).toEqual([20, 300]);
    expect(await shown(android)).toEqual(a);
  });
});

describe('guests, accounts and existing data', () => {
  it('a guest`s أوراد and Khatmas stay on the device: nothing is sent for them, even when an account later syncs on that device', async () => {
    await on(iphone, null, async () => {
      await khatmas.saveWirdPage({ name: 'Guest wird', page: 1 });
      await khatmas.saveWirdPage({ name: 'Guest wird', page: 604 });
      const w = (await khatmas.loadReadingData()).wirds[0];
      await khatmas.confirmKhatma(w.stop.id, w.cycle.id);
    });
    expect(server.log).toEqual([]);
    await sync(iphone, 'A');
    expect(server.active('A', 'wird')).toEqual([]);
    expect(server.active('A', 'khatma')).toEqual([]);
    expect((await shown(iphone, null)).stats.total).toBe(1);
  });

  it('"Add to this account": the guest`s أوراد and Khatmas join the account`s (none overwritten, none doubled) and reach its other devices', async () => {
    await on(android, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 100 }));
    await sync(android);
    await on(iphone, null, async () => {
      await khatmas.saveWirdPage({ name: 'Fajr', page: 1 });
      await khatmas.saveWirdPage({ name: 'Fajr', page: 604 });
      const w = (await khatmas.loadReadingData()).wirds[0];
      await khatmas.confirmKhatma(w.stop.id, w.cycle.id, at('2027-02-10T12:00:00Z'));
      await khatmas.saveWirdPage({ name: 'Isha', page: 9 });
    });
    await on(iphone, 'A', () => khatmas.adoptGuestReadingData('A'));
    await sync(iphone);
    await sync(android);
    await sync(iphone);
    const a = await shown(android);
    // Both "Fajr"s kept (one numbered, chosen by id the same way on every device), every page as it was.
    expect(a.wirds.map((w) => w.name).sort()).toEqual(['Fajr', 'Fajr (2)', 'Isha']);
    expect(a.wirds.map((w) => w.page).sort((x, y) => x - y)).toEqual([1, 9, 100]);
    expect(a.stats).toEqual({ total: 1, ramadan: 1, nonRamadan: 0 });
    expect(await shown(iphone)).toEqual(a);
    expect((await shown(iphone, null)).wirds).toEqual([]); // moved, not copied
  });

  it('existing data from before sync uploads on the first sync with nothing reset; an interrupted first sync repeats without doubling', async () => {
    // An account partition written by the previous app version: no seq, no name times, no deletion markers.
    const before = {
      'quran-heals:mushaf-reading-stops:v1:account:A': JSON.stringify([
        { id: 'stop-old-1', name: 'Old', page: 333, updatedAt: '2026-09-01T00:00:00.000Z' },
        { id: 'stop-old-2', name: 'Done', page: 1, updatedAt: '2026-09-02T00:00:00.000Z' },
      ]),
      'quran-heals:mushaf-khatmas:v1:account:A': JSON.stringify({
        schema: 1,
        cycles: {
          'stop-old-1': { id: 'c-old-1', startedAt: '2026-08-01T00:00:00.000Z', lastSavedPage: 333, reachedEndAt: null, startedByKhatmaId: null, savedSinceStart: true },
          'stop-old-2': { id: 'c-old-3', startedAt: '2026-09-02T00:00:00.000Z', lastSavedPage: 1, reachedEndAt: null, startedByKhatmaId: 'khatma-c-old-2', savedSinceStart: false },
        },
        records: [{ id: 'khatma-c-old-2', stopId: 'stop-old-2', stopName: 'Done', cycleId: 'c-old-2', cycleStartedAt: '2026-08-01T00:00:00.000Z', previousStartedByKhatmaId: null, completedAt: '2026-03-10T12:00:00.000Z', localDate: '2026-03-10', ramadan: true, ramadanHijriYear: 1447 }],
      }),
      'quran-heals:mushaf-active-reading-stop:v1:account:A': 'stop-old-1',
    };
    for (const [key, value] of Object.entries(before)) iphone.storage.set(key, value);
    const local = await shown(iphone);

    server.loseNextPushResponse = true;
    expect(await syncOrFail(iphone)).toBe('failed');
    expect(await sync(iphone)).toBe(true);
    expect(await shown(iphone)).toEqual(local); // no position reset, no record lost or added
    expect(server.active('A', 'wird')).toHaveLength(2);
    expect(server.active('A', 'khatma')).toHaveLength(1);
    await sync(android);
    expect(await shown(android)).toEqual(local);
    expect(local.stats).toEqual({ total: 1, ramadan: 1, nonRamadan: 0 });
  });

  it('if the account\'s stored records are replaced (new sync generation), devices upload their copies again; removed Khatmas stay removed', async () => {
    await on(iphone, 'A', async () => {
      await khatmas.saveWirdPage({ name: 'Fajr', page: 1 });
      await khatmas.saveWirdPage({ name: 'Fajr', page: 604 });
      const w = await wird(iphone, 'Fajr');
      const { record } = await khatmas.confirmKhatma(w.stop.id, w.cycle.id);
      await khatmas.saveWirdPage({ name: 'Fajr', page: 604 });
      const w2 = await wird(iphone, 'Fajr');
      await khatmas.confirmKhatma(w2.stop.id, w2.cycle.id);
      await khatmas.removeKhatma(record.id);
    });
    await sync(iphone);
    const local = await shown(iphone);
    server.replaceStoredRecords('A');
    expect(await sync(iphone)).toBe(true);
    expect(await shown(iphone)).toEqual(local);
    expect(server.active('A', 'khatma')).toHaveLength(1);
    expect(server.active('A', 'wird')).toHaveLength(1);
    await sync(android);
    expect(await shown(android)).toEqual(local);
  });

  it('a record this app version cannot read (invalid or unknown content) is left alone: never applied, never overwritten', async () => {
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 10 }));
    await sync(iphone);
    const id = (await wird(iphone, 'Fajr')).stop.id;
    const stored = server.record('A', 'wird', id)!;
    stored.data = { v: 2, kind: 'wird', id, somethingNew: true };
    stored.revision += 1;
    stored.changeSeq = 999;
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 11 }));
    await sync(iphone);
    expect(server.record('A', 'wird', id)!.data).toMatchObject({ v: 2, somethingNew: true });
    expect((await shown(iphone)).wirds[0].page).toBe(11);
  });

  it('migration from the unreleased encrypted build: its device sync state is discarded (never the data); both devices re-upload with nothing lost or doubled', async () => {
    for (const d of [iphone, android]) {
      await on(d, 'A', async () => {
        await khatmas.saveWirdPage({ name: d.name === 'iphone' ? 'Fajr' : 'Isha', page: 300 });
      });
    }
    // Both devices synced under the old build: shared records, and an old (v1) sync state on each.
    await sync(iphone);
    await sync(android);
    await sync(iphone);
    const fajr = await wird(iphone, 'Fajr');
    await on(iphone, 'A', async () => {
      await khatmas.saveWirdPage({ name: 'Fajr', page: 604 });
      const w = await wird(iphone, 'Fajr');
      await khatmas.confirmKhatma(w.stop.id, w.cycle.id, at('2027-02-10T12:00:00Z'));
    });
    await sync(iphone);
    await sync(android);
    const before = await shown(iphone);
    expect(await shown(android)).toEqual(before);
    for (const d of [iphone, android]) {
      const v2 = `quran-heals:mushaf-reading-sync:v2:account:A`;
      d.storage.set(`quran-heals:mushaf-reading-sync:v1:account:A`, d.storage.get(v2)!);
      d.storage.delete(v2);
    }
    // The new server holds none of it yet (the old records were encrypted and are not served).
    server.replaceStoredRecords('A');
    for (const r of [...server.accounts.get('A')!.records.values()]) expect(r.deleted).toBe(true);
    await sync(iphone);
    await sync(android);
    await sync(iphone);
    expect(await shown(iphone)).toEqual(before);
    expect(await shown(android)).toEqual(before);
    expect(server.active('A', 'wird')).toHaveLength(2);
    expect(server.active('A', 'khatma')).toHaveLength(1);
    for (const d of [iphone, android]) expect(d.storage.has('quran-heals:mushaf-reading-sync:v1:account:A')).toBe(false);
    expect(fajr.stop.id).toBe((await wird(android, 'Fajr')).stop.id); // stable ids throughout
  });

  it('status: "synced" only after the account acknowledged everything; offline it stays pending', async () => {
    iphone.online = false;
    await on(iphone, 'A', () => khatmas.saveWirdPage({ name: 'Fajr', page: 10 }));
    expect(await syncOrFail(iphone)).toBe('failed');
    expect(getReadingSyncStatus().state).toBe('pending');
    iphone.online = true;
    expect(await sync(iphone)).toBe(true);
    expect(getReadingSyncStatus().state).toBe('synced');
  });
});
