import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NotificationsProvider (notifications/useNotifications.tsx): when the
 * schedule is reconciled — launch, return to the foreground, a reminder
 * change, an App Language change — and that it never asks the OS by itself.
 */
const state = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  appStateListeners: new Set<(next: string) => void>(),
  /** While set, reads of the reminder settings wait for it (a slow storage read at launch). */
  settingsGate: null as Promise<void> | null,
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (key === 'quran-heals:notification-preferences:v1' && state.settingsGate) await state.settingsGate;
      return state.storage.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => { state.storage.set(key, value); },
  },
}));
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (next: string) => void) => {
      state.appStateListeners.add(listener);
      return { remove: () => { state.appStateListeners.delete(listener); } };
    },
  },
}));
vi.mock('@/localization/deviceLocale', () => ({ getDeviceLanguageTags: () => ['en-US'], deviceUses24HourClock: () => null }));
vi.mock('expo-router', () => ({ useIsFocused: () => true }));

const { AppLocaleProvider, useAppLocale } = await import('@/localization/useAppLocale');
const { NotificationsProvider, useNotifications } = await import('@/notifications/useNotifications');
type NotificationsApi = import('@/notifications/api').NotificationsApi;
type ScheduleRequest = import('@/notifications/api').ScheduleRequest;

let permission: { status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean };
let pending: Map<string, ScheduleRequest>;
let requests: number;
let presentation: (() => boolean) | null;
const api: NotificationsApi = {
  supported: true,
  getPermission: async () => permission,
  requestPermission: async () => { requests += 1; return permission; },
  ensureChannels: async () => undefined,
  getPending: async () => [...pending.values()].map((r) => ({ identifier: r.identifier, data: r.content.data })),
  schedule: async (r) => { pending.set(r.identifier, r); },
  cancel: async (id) => { pending.delete(id); },
  getLastResponse: () => null,
  clearLastResponse: () => undefined,
  addResponseListener: () => ({ remove: () => undefined }),
  setForegroundPresentation: (quiet) => { presentation = quiet; },
  openSystemSettings: async () => undefined,
};
const verses = {
  getVerseByKey: async (verseKey: string) => ({ surah: 2, ayah: Number(verseKey.split(':')[1]), verseKey, arabicText: 'نص' }),
  getRandomVerseKey: async (excluded: string[]) => `2:${excluded.length + 1}`,
};

let root: ReactTestRenderer | undefined;
let notifications: ReturnType<typeof useNotifications>;
let locale: ReturnType<typeof useAppLocale>;
function Probe() {
  notifications = useNotifications();
  locale = useAppLocale();
  return null;
}
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0)); });
async function mount() {
  await act(async () => {
    root = create(createElement(AppLocaleProvider, null,
      createElement(NotificationsProvider, { api, verses, now: () => new Date(2026, 9, 14, 12, 0) }, createElement(Probe))));
  });
  await flush();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.storage.clear();
  state.appStateListeners.clear();
  permission = { status: 'undetermined', canAskAgain: true };
  state.settingsGate = null;
  pending = new Map();
  requests = 0;
  presentation = null;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

describe('NotificationsProvider', () => {
  it('launch: loads the defaults (nothing to fix, nothing written), never asks the OS, and reports the honest state', async () => {
    await mount();
    expect(state.storage.get('quran-heals:notification-preferences:v1')).toBeUndefined();
    expect(notifications.isReady).toBe(true);
    expect(requests).toBe(0);
    expect(pending.size).toBe(0);
    expect(notifications.permission).toEqual({ status: 'undetermined', canAskAgain: true });
    expect(notifications.states).toEqual({ wird: { state: 'needsPermission' }, randomAyah: { state: 'needsPermission' }, emotionCheckIn: { state: 'needsPermission' } });
  });

  it('an install that kept Every 3 days without its cycle yet: the cycle is fixed once at launch and saved, the frequency kept', async () => {
    state.storage.set('quran-heals:notification-preferences:v1', JSON.stringify({ schema: 1, emotionCheckIn: { enabled: true, frequency: 'every3days', time: '21:00', weekday: null, anchor: null } }));
    await mount();
    expect(JSON.parse(state.storage.get('quran-heals:notification-preferences:v1')!).emotionCheckIn).toMatchObject({ frequency: 'every3days', anchor: '2026-10-14' });
  });

  it('permission granted later in device Settings: picked up on the return to the foreground, without duplicates', async () => {
    await mount();
    permission = { status: 'granted', canAskAgain: true };
    await act(async () => { state.appStateListeners.forEach((listener) => listener('active')); });
    await flush();
    expect(notifications.permission.status).toBe('granted');
    expect(pending.has('quranheals.wird.daily')).toBe(true);
    const size = pending.size;
    await act(async () => { state.appStateListeners.forEach((listener) => listener('active')); });
    await flush();
    expect(pending.size).toBe(size);
    // Revoked later: reflected, and nothing stays registered.
    permission = { status: 'denied', canAskAgain: false };
    await act(async () => { state.appStateListeners.forEach((listener) => listener('background')); state.appStateListeners.forEach((listener) => listener('active')); });
    await flush();
    expect(notifications.permission).toEqual({ status: 'denied', canAskAgain: false });
    expect(pending.size).toBe(0);
  });

  it('an App Language change rewrites the pending copy and keeps the reminder settings', async () => {
    permission = { status: 'granted', canAskAgain: true };
    await mount();
    expect(pending.get('quranheals.wird.daily')!.content.title).toBe('Time for your Quran reciting.');
    const before = JSON.stringify(notifications.preferences);
    await act(async () => locale.setLocale('ar'));
    await flush();
    expect(pending.get('quranheals.wird.daily')!.content.title).toBe('وقت وردك القرآني');
    expect(pending.get('quranheals.wird.daily')!.content.body).toBe('واصل وِردك اليوم وخصص وقتًا لقراءة القرآن.');
    const checkIn = [...pending.values()].find((r) => r.identifier.startsWith('quranheals.checkin.'))!;
    expect(checkIn.content).toMatchObject({ title: 'تستحق السكينة ❤️', body: 'مهما كان شعورك، في القرآن ما يلامس قلبك.' });
    expect(JSON.stringify(notifications.preferences)).toBe(before);
  });

  it('requestPermission asks the OS once per call and then schedules', async () => {
    await mount();
    permission = { status: 'granted', canAskAgain: true };
    await act(async () => { await notifications.requestPermission(); });
    await flush();
    expect(requests).toBe(1);
    expect(pending.has('quranheals.wird.daily')).toBe(true);
  });

  it('foreground presentation is quiet only while the Mushaf reader is focused', async () => {
    await mount();
    const { isMushafReadingFocused } = await import('@/notifications/foreground');
    expect(presentation).toBe(isMushafReadingFocused);
    expect(presentation!()).toBe(false);
  });
});

describe('NotificationsProvider: permission transitions and edits', () => {
  it('already allowed at launch (Android 12 and older, or granted earlier): scheduled at once, without any prompt', async () => {
    permission = { status: 'granted', canAskAgain: true };
    await mount();
    expect(requests).toBe(0);
    expect(pending.has('quranheals.wird.daily')).toBe(true);
    expect(notifications.states.wird).toEqual({ state: 'scheduled', pending: 1 });
  });

  it('denied, then allowed in device Settings, then revoked again: each change is reflected on the next return to the app', async () => {
    permission = { status: 'denied', canAskAgain: false };
    await mount();
    expect(notifications.states.wird).toEqual({ state: 'needsPermission' });
    expect(pending.size).toBe(0);
    const foreground = async () => {
      await act(async () => { state.appStateListeners.forEach((listener) => listener('active')); });
      await flush();
    };
    permission = { status: 'granted', canAskAgain: true };
    await foreground();
    expect(notifications.states.wird).toEqual({ state: 'scheduled', pending: 1 });
    permission = { status: 'denied', canAskAgain: false };
    await foreground();
    expect(notifications.states.wird).toEqual({ state: 'needsPermission' });
    expect(pending.size).toBe(0);
    expect(requests).toBe(0);
  });

  it('a prompt that is denied leaves the wish ON and nothing scheduled, and is never shown again by itself', async () => {
    await mount();
    permission = { status: 'denied', canAskAgain: false };
    await act(async () => { await notifications.requestPermission(); });
    await flush();
    expect(requests).toBe(1);
    expect(notifications.preferences.wird.enabled).toBe(true);
    expect(notifications.states.wird).toEqual({ state: 'needsPermission' });
    expect(pending.size).toBe(0);
    await act(async () => { state.appStateListeners.forEach((listener) => listener('active')); });
    await flush();
    expect(requests).toBe(1);
  });

  it('rapid ON/OFF toggling ends exactly as last chosen, with no duplicates, and leaves the other reminders as they were', async () => {
    permission = { status: 'granted', canAskAgain: true };
    await mount();
    const checkIns = [...pending.keys()].filter((id) => id.startsWith('quranheals.checkin.')).sort();
    await act(async () => {
      for (const enabled of [false, true, false, true, false]) notifications.update('wird', { enabled });
    });
    await flush();
    expect([...pending.keys()].filter((id) => id.startsWith('quranheals.wird.'))).toEqual([]);
    expect(JSON.parse(state.storage.get('quran-heals:notification-preferences:v1')!).wird.enabled).toBe(false);
    await act(async () => {
      for (const enabled of [true, false, true]) notifications.update('wird', { enabled });
    });
    await flush();
    expect([...pending.keys()].filter((id) => id.startsWith('quranheals.wird.'))).toEqual(['quranheals.wird.daily']);
    // The Wird's slot changes do not touch the Check-ins already scheduled.
    expect([...pending.keys()].filter((id) => id.startsWith('quranheals.checkin.')).sort().slice(0, checkIns.length - 1)).toEqual(checkIns.slice(0, -1));
  });
});

describe('NotificationsProvider: a change made before the saved settings have loaded', () => {
  it('is applied over the saved settings (never over the defaults), saved, and only then scheduled', async () => {
    permission = { status: 'granted', canAskAgain: true };
    // Saved earlier: Random Ayah OFF at 06:30.
    state.storage.set('quran-heals:notification-preferences:v1', JSON.stringify({
      schema: 1,
      wird: { enabled: true, frequency: 'daily', time: '21:00', weekday: null, anchor: null },
      randomAyah: { enabled: false, frequency: 'daily', time: '06:30', weekday: null, anchor: null },
      emotionCheckIn: { enabled: true, frequency: 'every3days', time: '21:00', weekday: null, anchor: '2026-10-14' },
    }));
    let release!: () => void;
    state.settingsGate = new Promise<void>((done) => { release = done; });
    await act(async () => {
      root = create(createElement(AppLocaleProvider, null,
        createElement(NotificationsProvider, { api, verses, now: () => new Date(2026, 9, 14, 12, 0) }, createElement(Probe))));
    });
    await flush();
    expect(notifications.isReady).toBe(false); // the stored settings have not arrived yet
    // Meanwhile, the Wird time changes: shown at once, nothing scheduled from the defaults.
    await act(async () => notifications.update('wird', { time: { hour: 5, minute: 0 } }));
    await flush();
    expect(notifications.preferences.wird.time).toEqual({ hour: 5, minute: 0 });
    expect(pending.size).toBe(0);
    state.settingsGate = null;
    await act(async () => release());
    await flush();
    expect(notifications.isReady).toBe(true);
    const saved = JSON.parse(state.storage.get('quran-heals:notification-preferences:v1')!);
    expect(saved.wird.time).toBe('05:00');
    expect(saved.randomAyah).toMatchObject({ enabled: false, time: '06:30' }); // the saved OFF survived
    expect(pending.get('quranheals.wird.daily')!.trigger).toEqual({ type: 'daily', hour: 5, minute: 0 });
    expect([...pending.keys()].some((id) => id.startsWith('quranheals.ayah.'))).toBe(false);
  });
});

describe('NotificationsProvider: the signed-in account`s reminders (2026-10-27)', () => {
  const WIRD_EVENING = { enabled: true, frequency: 'daily', time: '20:30', weekday: null, anchor: null };

  it('an account reminder arriving before the settings load waits for them, then is applied, saved and scheduled — without asking the OS', async () => {
    const { applyAccountReminder } = await import('@/notifications/accountReminders');
    const { getLastLocalPreferenceChangeForTests, resetPreferencesSyncStateForTests } = await import('@/sync/preferencesSyncState');
    resetPreferencesSyncStateForTests();
    permission = { status: 'granted', canAskAgain: true };
    state.storage.set('quran-heals:notification-preferences:v1', JSON.stringify({ schema: 1, wird: { enabled: true, frequency: 'daily', time: '21:00', weekday: null, anchor: null } }));
    let release!: () => void;
    state.settingsGate = new Promise((resolve) => { release = resolve; });
    applyAccountReminder('wird', WIRD_EVENING);
    await act(async () => {
      root = create(createElement(AppLocaleProvider, null,
        createElement(NotificationsProvider, { api, verses, now: () => new Date(2026, 9, 14, 12, 0) }, createElement(Probe))));
    });
    await act(async () => { release(); });
    await flush();

    expect(notifications.preferences.wird.time).toEqual({ hour: 20, minute: 30 });
    expect(JSON.parse(state.storage.get('quran-heals:notification-preferences:v1')!).wird).toMatchObject({ time: '20:30' });
    expect(pending.has('quranheals.wird.daily')).toBe(true);
    expect(requests).toBe(0);
    // Applied from the account: never recorded as this device's change (so never uploaded back).
    expect(getLastLocalPreferenceChangeForTests()).toBeNull();
  });

  it('without OS permission on this device the synced reminder is kept but nothing is scheduled, and permission is not requested', async () => {
    const { applyAccountReminder } = await import('@/notifications/accountReminders');
    permission = { status: 'denied', canAskAgain: false };
    await mount();
    await act(async () => { applyAccountReminder('wird', WIRD_EVENING); });
    await flush();
    expect(notifications.preferences.wird.time).toEqual({ hour: 20, minute: 30 });
    expect(pending.size).toBe(0);
    expect(notifications.states.wird).toEqual({ state: 'needsPermission' });
    expect(requests).toBe(0);
  });

  it('the user`s own change in Settings is recorded for the signed-in account, in stored form', async () => {
    const { getLastLocalPreferenceChangeForTests, resetPreferencesSyncStateForTests } = await import('@/sync/preferencesSyncState');
    resetPreferencesSyncStateForTests();
    await mount();
    await act(async () => { notifications.update('randomAyah', { enabled: false }); });
    await flush();
    expect(getLastLocalPreferenceChangeForTests()).toMatchObject({
      field: 'notificationRandomAyah',
      value: { enabled: false, frequency: 'daily', time: '08:00', weekday: null, anchor: null },
    });
  });
});
