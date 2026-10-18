import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reminder taps (notifications/responseRouting.ts and the root hook,
 * useNotificationResponseRouting.ts): where each type goes, decided from the
 * payload and — for the Wird Reminder — the current owner's real reading
 * stops (mushaf/readingStops.ts over an in-memory AsyncStorage), and that a
 * tap never writes any reading data.
 */
const state = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  writes: [] as string[],
  navKey: undefined as string | undefined,
  pushed: [] as unknown[],
  navigated: [] as unknown[],
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => state.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { state.writes.push(key); state.storage.set(key, value); },
    removeItem: async (key: string) => { state.writes.push(key); state.storage.delete(key); },
  },
}));
vi.mock('expo-router', () => ({
  router: { push: (route: unknown) => state.pushed.push(route), navigate: (route: unknown) => state.navigated.push(route) },
  useRootNavigationState: () => (state.navKey ? { key: state.navKey } : undefined),
}));

const { asyncStorageHandledTapStore, createNotificationResponseHandler, destinationOf, HANDLED_TAPS_STORAGE_KEY } = await import('@/notifications/responseRouting');
const { parseNotificationPayload, NOTIFICATION_PAYLOAD_VERSION } = await import('@/notifications/content');
const { loadReadingStops, READING_STOPS_STORAGE_KEY } = await import('@/mushaf/readingStops');
const { KHATMAS_STORAGE_KEY } = await import('@/mushaf/khatmas');
const { setLocalDataOwnerState, resetLocalDataOwnerForTests } = await import('@/storage/localDataOwner');
const { useNotificationResponseRouting } = await import('@/notifications/useNotificationResponseRouting');
type NotificationResponseEvent = import('@/notifications/api').NotificationResponseEvent;
type NotificationsApi = import('@/notifications/api').NotificationsApi;

const tap = (data: unknown, overrides: Partial<NotificationResponseEvent> = {}): NotificationResponseEvent => ({
  identifier: 'quranheals.x', deliveredAt: 1, data, isDefaultAction: true, ...overrides,
});
const stop = (id: string, name: string, page: number) => ({ id, name, page, updatedAt: '2026-10-01T00:00:00.000Z' });

let opened: { id: string; page: number }[];
let navigated: unknown[];
function handler() {
  return createNotificationResponseHandler({
    loadStops: () => loadReadingStops(),
    openMushafFor: async (s) => { opened.push(s); },
    navigate: (route) => { navigated.push(route); },
  });
}

beforeEach(() => {
  state.storage.clear();
  state.writes = [];
  state.pushed = [];
  state.navigated = [];
  state.navKey = undefined;
  opened = [];
  navigated = [];
  resetLocalDataOwnerForTests();
  setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true });
});

describe('Payloads', () => {
  it('accepts exactly the three types at the current version; rejects unknown, newer, damaged and mismatched ones', () => {
    expect(parseNotificationPayload({ v: 1, kind: 'wird' })).toEqual({ kind: 'wird' });
    expect(parseNotificationPayload({ v: 1, kind: 'emotionCheckIn' })).toEqual({ kind: 'emotionCheckIn' });
    expect(parseNotificationPayload({ v: 1, kind: 'randomAyah', verseKey: '2:255', surah: 2, ayah: 255 })).toEqual({ kind: 'randomAyah', verseKey: '2:255', surah: 2, ayah: 255 });
    for (const bad of [
      null, 'x', [], {}, { kind: 'wird' }, { v: NOTIFICATION_PAYLOAD_VERSION + 1, kind: 'wird' }, { v: 0, kind: 'wird' }, { v: 1, kind: 'other' },
      { v: 1, kind: 'randomAyah', verseKey: '2:255', surah: 2, ayah: 256 }, // key and numbers disagree
      { v: 1, kind: 'randomAyah', verseKey: '1:8', surah: 1, ayah: 8 }, // does not exist (Al-Fatiha has 7)
      { v: 1, kind: 'randomAyah', verseKey: '115:1', surah: 115, ayah: 1 },
    ]) expect(parseNotificationPayload(bad)).toBeNull();
  });
});

describe('Random Quran Ayah → the exact verse that was shown, in the Mushaf', () => {
  it('opens the Mushaf on the verse\'s page with that ayah selected, with no new random choice (payload v1 and v2)', async () => {
    for (const v of [1, 2]) {
      navigated = [];
      const destination = await handler()(tap({ v, kind: 'randomAyah', verseKey: '2:255', surah: 2, ayah: 255 }));
      expect(destination).toEqual({ type: 'ayah', surah: 2, ayah: 255 });
      expect(navigated).toEqual([{ pathname: '/mushaf', params: { page: '42', ayah: '2:255', at: expect.any(String) } }]);
    }
    expect(state.writes).toEqual([]);
  });

  it('94:5 (the approved example) opens page 596; each tap is a new request, so an open reader on another page moves', async () => {
    const handle = handler();
    await handle(tap({ v: 2, kind: 'randomAyah', verseKey: '94:5', surah: 94, ayah: 5 }, { deliveredAt: 1 }));
    await new Promise((done) => setTimeout(done, 2));
    await handle(tap({ v: 2, kind: 'randomAyah', verseKey: '94:5', surah: 94, ayah: 5 }, { deliveredAt: 2 }));
    expect(navigated).toEqual([
      { pathname: '/mushaf', params: { page: '596', ayah: '94:5', at: expect.any(String) } },
      { pathname: '/mushaf', params: { page: '596', ayah: '94:5', at: expect.any(String) } },
    ]);
    const [first, second] = navigated as { params: { at: string } }[];
    expect(first.params.at).not.toBe(second.params.at);
  });
});

describe('Emotional Check-in → the full emotion list, nothing chosen or recorded', () => {
  it('opens /emotions and writes nothing', async () => {
    expect(await handler()(tap({ v: 1, kind: 'emotionCheckIn' }))).toEqual({ type: 'emotions' });
    expect(navigated).toEqual(['/emotions']);
    expect(state.writes).toEqual([]);
  });
});

describe('Wird Reminder → resolved at tap time from the current reading data', () => {
  const wird = tap({ v: 1, kind: 'wird' });

  it('no ورد: أورادي وختماتي (nothing invented)', async () => {
    await handler()(wird);
    expect(navigated).toEqual(['/my-reading']);
    expect(opened).toEqual([]);
  });

  it('exactly one ورد: the Mushaf on its current saved page (an update since scheduling is picked up)', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('a', 'Mum', 40)]));
    await handler()(wird);
    expect(opened).toEqual([expect.objectContaining({ id: 'a', page: 40 })]);
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('a', 'Mum', 77)]));
    await handler()({ ...wird, deliveredAt: 2 });
    expect(opened[1]).toEqual(expect.objectContaining({ id: 'a', page: 77 }));
    expect(navigated).toEqual([]);
  });

  it('several أوراد: one reminder, opening أورادي وختماتي to choose', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('a', 'Mum', 40), stop('b', 'Ramadan', 300)]));
    await handler()(wird);
    expect(navigated).toEqual(['/my-reading']);
    expect(opened).toEqual([]);
  });

  it('a ورد deleted after scheduling: falls back safely to أورادي وختماتي', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([]));
    await handler()(wird);
    expect(navigated).toEqual(['/my-reading']);
  });

  it('uses the active owner only: a signed-in account never sees the guest\'s ورد, and vice versa', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('g', 'Guest', 10)]));
    state.storage.set(`${READING_STOPS_STORAGE_KEY}:account:user-1`, JSON.stringify([stop('u1', 'Mine', 20), stop('u2', 'Other', 30)]));
    setLocalDataOwnerState({ activeUserId: 'user-1', keptSeparate: [], resolved: true });
    await handler()(wird);
    expect(navigated).toEqual(['/my-reading']);
    expect(opened).toEqual([]);
    setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true });
    await handler()({ ...wird, deliveredAt: 9 });
    expect(opened).toEqual([expect.objectContaining({ id: 'g', page: 10 })]);
  });

  it('never writes reading data: no page saved, no stop changed, no Khatma or cycle touched', async () => {
    const stops = JSON.stringify([stop('a', 'Mum', 604)]);
    const khatmas = JSON.stringify({ schema: 1, cycles: {}, records: [], deletedStops: {}, deletedRecords: {} });
    state.storage.set(READING_STOPS_STORAGE_KEY, stops);
    state.storage.set(KHATMAS_STORAGE_KEY, khatmas);
    await handler()(wird);
    expect(state.writes).toEqual([]);
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stops);
    expect(state.storage.get(KHATMAS_STORAGE_KEY)).toBe(khatmas);
  });
});

describe('Robustness', () => {
  it('the same tap reported twice navigates once; a later delivery of the same repeating request navigates again', async () => {
    const handle = handler();
    const event = tap({ v: 1, kind: 'emotionCheckIn' }, { identifier: 'quranheals.checkin.daily', deliveredAt: 100 });
    await handle(event);
    await handle(event);
    expect(navigated).toEqual(['/emotions']);
    await handle({ ...event, deliveredAt: 200 });
    expect(navigated).toEqual(['/emotions', '/emotions']);
  });

  it('a dismiss or other action, an unknown payload, or an old app\'s damaged payload opens the app without navigating', async () => {
    const handle = handler();
    expect(await handle(tap({ v: 1, kind: 'wird' }, { isDefaultAction: false }))).toBeNull();
    expect(await handle(tap({ hello: 'world' }, { deliveredAt: 2 }))).toBeNull();
    expect(await handle(tap(undefined, { deliveredAt: 3 }))).toBeNull();
    expect(navigated).toEqual([]);
    expect(destinationOf({ data: { v: 1, kind: 'wird' } })).toEqual({ type: 'wird' });
  });
});

describe('Root hook: cold start and initialization order', () => {
  let root: ReactTestRenderer | undefined;
  let launch: NotificationResponseEvent | null;
  let listener: ((event: NotificationResponseEvent) => void) | null;
  let cleared: number;
  const api = () => ({
    supported: true,
    getLastResponse: () => launch,
    clearLastResponse: () => { cleared += 1; launch = null; },
    addResponseListener: (l: (event: NotificationResponseEvent) => void) => { listener = l; return { remove: () => { listener = null; } }; },
  }) as unknown as NotificationsApi;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    launch = tap({ v: 1, kind: 'randomAyah', verseKey: '94:5', surah: 94, ayah: 5 }, { identifier: 'quranheals.ayah.2026-10-15', deliveredAt: 5 });
    listener = null;
    cleared = 0;
  });
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
  });

  const testApi = api();
  function Probe({ ready }: { ready: boolean }) {
    useNotificationResponseRouting(ready, testApi);
    return null;
  }
  const flush = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });

  it('waits for startup and the root navigator, then opens the launching tap once and clears it', async () => {
    await act(async () => { root = create(createElement(Probe, { ready: false })); });
    state.navKey = 'root';
    await act(async () => root!.update(createElement(Probe, { ready: false })));
    expect(state.pushed).toEqual([]); // preferences not loaded yet
    state.navKey = undefined;
    await act(async () => root!.update(createElement(Probe, { ready: true })));
    expect(state.pushed).toEqual([]); // router not mounted yet
    state.navKey = 'root';
    await act(async () => root!.update(createElement(Probe, { ready: true })));
    await flush();
    expect(state.navigated).toEqual([{ pathname: '/mushaf', params: { page: '596', ayah: '94:5', at: expect.any(String) } }]);
    expect(state.pushed).toEqual([]);
    expect(cleared).toBe(1);
    // The same tap also arriving through the listener does not navigate again.
    listener!(tap({ v: 1, kind: 'randomAyah', verseKey: '94:5', surah: 94, ayah: 5 }, { identifier: 'quranheals.ayah.2026-10-15', deliveredAt: 5 }));
    await flush();
    expect(state.navigated).toHaveLength(1);
  });

  it('a tap while running (foreground or background) arrives through the listener', async () => {
    launch = null;
    state.navKey = 'root';
    await act(async () => { root = create(createElement(Probe, { ready: true })); });
    listener!(tap({ v: 1, kind: 'emotionCheckIn' }, { deliveredAt: 77 }));
    await flush();
    expect(state.pushed).toEqual(['/emotions']);
  });

  it('أورادي وختماتي (a tab) is switched to with navigate, not pushed', async () => {
    launch = tap({ v: 1, kind: 'wird' }, { deliveredAt: 88 });
    state.navKey = 'root';
    await act(async () => { root = create(createElement(Probe, { ready: true })); });
    await flush();
    expect(state.navigated).toEqual(['/my-reading']);
    expect(state.pushed).toEqual([]);
  });
});

describe('A tap is acted on once, even across a reload of the app code', () => {
  const event = tap({ v: 1, kind: 'randomAyah', verseKey: '94:5', surah: 94, ayah: 5 }, { identifier: 'quranheals.ayah.2026-10-15', deliveredAt: 500 });
  const withStore = () => createNotificationResponseHandler({
    loadStops: () => loadReadingStops(),
    openMushafFor: async (s) => { opened.push(s); },
    navigate: (route) => { navigated.push(route); },
    handledStore: asyncStorageHandledTapStore,
  });

  it('a new handler (after a reload) does not open the same tap again; a different tap still opens', async () => {
    await withStore()(event);
    expect(navigated).toHaveLength(1);
    expect(JSON.parse(state.storage.get(HANDLED_TAPS_STORAGE_KEY)!)).toEqual(['quranheals.ayah.2026-10-15@500']);
    // The app's code reloads: a brand-new handler, the OS reports the launching tap again.
    await withStore()(event);
    expect(navigated).toHaveLength(1);
    await withStore()({ ...event, deliveredAt: 600 });
    expect(navigated).toHaveLength(2);
  });

  it('two reports of one tap arriving together (launch response and listener) navigate once', async () => {
    const handle = withStore();
    await Promise.all([handle(event), handle(event)]);
    expect(navigated).toHaveLength(1);
  });

  it('keeps at most the last 50 taps, and a damaged stored list is ignored', async () => {
    state.storage.set(HANDLED_TAPS_STORAGE_KEY, 'not json');
    const handle = withStore();
    for (let i = 0; i < 60; i += 1) await handle({ ...event, deliveredAt: 1000 + i });
    expect(navigated).toHaveLength(60);
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    const kept = JSON.parse(state.storage.get(HANDLED_TAPS_STORAGE_KEY)!);
    expect(kept).toHaveLength(50);
    expect(kept.at(-1)).toBe('quranheals.ayah.2026-10-15@1059');
  });
});
