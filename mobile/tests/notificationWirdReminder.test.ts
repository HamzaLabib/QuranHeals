import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The final approved notification wording (2026-10-17) and the Wird Reminder's dynamic copy: the ورد it names
 * (notifications/wirdTarget.ts), the copy (content.ts), how the scheduled request follows the reading data
 * (scheduler.ts, useNotifications.tsx) and where its tap goes (responseRouting.ts). Reading data is the real
 * mushaf/readingStops.ts over an in-memory AsyncStorage.
 */
const state = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  appStateListeners: new Set<(next: string) => void>(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => state.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { state.storage.set(key, value); },
    removeItem: async (key: string) => { state.storage.delete(key); },
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

const { emotionCheckInContent, parseNotificationPayload, randomAyahContent, wirdReminderContent } = await import('@/notifications/content');
const { loadWirdReminderTarget, selectWirdReminderTarget } = await import('@/notifications/wirdTarget');
const { createNotificationScheduler } = await import('@/notifications/scheduler');
const { createNotificationResponseHandler } = await import('@/notifications/responseRouting');
const { DEFAULT_NOTIFICATION_PREFERENCES, applyReminderChange, completeSchedules } = await import('@/notifications/preferences');
const { READING_STOPS_STORAGE_KEY, ACTIVE_READING_STOP_STORAGE_KEY, loadReadingStops, removeReadingStop, renameReadingStop, saveReadingStop, setActiveReadingStopId } = await import('@/mushaf/readingStops');
const { resetLocalDataOwnerForTests, setLocalDataOwnerState } = await import('@/storage/localDataOwner');
const { AppLocaleProvider, useAppLocale } = await import('@/localization/useAppLocale');
const { NotificationsProvider } = await import('@/notifications/useNotifications');
type NotificationsApi = import('@/notifications/api').NotificationsApi;
type ScheduleRequest = import('@/notifications/api').ScheduleRequest;
type WirdTargetLookup = import('@/notifications/wirdTarget').WirdTargetLookup;
type ReadingStop = import('@/mushaf/readingStops').ReadingStop;

const stop = (id: string, name: string, page: number, updatedAt = '2026-10-01T00:00:00.000Z'): ReadingStop => ({ id, name, page, updatedAt });
const target = (name: string, page: number, stopId = 'stop-1') => ({ stopId, name, page });

let pending: Map<string, ScheduleRequest>;
let log: string[];
let permission: { status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean };
const api: NotificationsApi = {
  supported: true,
  getPermission: async () => permission,
  requestPermission: async () => permission,
  ensureChannels: async () => undefined,
  getPending: async () => [...pending.values()].map((r) => ({ identifier: r.identifier, data: r.content.data })),
  schedule: async (r) => { log.push(`+${r.identifier}`); pending.set(r.identifier, r); },
  cancel: async (id) => { log.push(`-${id}`); pending.delete(id); },
  getLastResponse: () => null,
  clearLastResponse: () => undefined,
  addResponseListener: () => ({ remove: () => undefined }),
  setForegroundPresentation: () => undefined,
  openSystemSettings: async () => undefined,
};
const verses = {
  getVerseByKey: async (verseKey: string) => ({ surah: 2, ayah: Number(verseKey.split(':')[1]), verseKey, arabicText: 'نص' }),
  getRandomVerseKey: async (excluded: string[]) => `2:${excluded.length + 1}`,
};
const memoryQueue = () => ({ value: { entries: {}, recent: [] as string[] }, async load() { return structuredClone(this.value); }, async save(q: { entries: Record<string, string>; recent: string[] }) { this.value = structuredClone(q); } });
const NOW = new Date(2026, 9, 14, 12, 0);
const prefs = (p = DEFAULT_NOTIFICATION_PREFERENCES) => completeSchedules(p, NOW).preferences;
const wirdRequest = () => pending.get('quranheals.wird.daily')!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.storage.clear();
  state.appStateListeners.clear();
  pending = new Map();
  log = [];
  permission = { status: 'granted', canAskAgain: true };
  resetLocalDataOwnerForTests();
  setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true });
});

describe('The six approved strings, exactly', () => {
  it('Quran Reciting Reminder, Emotional Check-in and Daily Random Quran Ayah, in English and Arabic', async () => {
    expect(wirdReminderContent('en', target('Evening', 125))).toMatchObject({ title: 'Time for your Quran reciting.', body: 'Continue your Evening reciting from page 125.' });
    expect(wirdReminderContent('ar', target('المسائي', 125))).toMatchObject({ title: 'وقت وردك القرآني', body: 'أكمل وردك المسائي من الصفحة ١٢٥.' });
    expect(emotionCheckInContent('en')).toMatchObject({ title: 'You Deserve Peace ❤️', body: "Whatever you're feeling, there's something in the Quran that speaks to your heart." });
    expect(emotionCheckInContent('ar')).toMatchObject({ title: 'تستحق السكينة ❤️', body: 'مهما كان شعورك، في القرآن ما يلامس قلبك.' });
    const verse = { surah: 94, ayah: 5, verseKey: '94:5', arabicText: 'فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا' };
    expect(randomAyahContent('en', verse)).toMatchObject({ title: 'A Verse for You Today', body: 'فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا\n\nAsh-Sharh · 94:5' });
    expect(randomAyahContent('ar', verse)).toMatchObject({ title: 'آية من القرآن لك اليوم', body: 'فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا\n\nسورة الشرح · الآية ٥' });
  });
});

describe('Wird Reminder copy: the ورد name exactly as saved, its page', () => {
  it('Morning, Evening, Ramadan (the approved examples), in English', () => {
    expect(wirdReminderContent('en', target('Morning', 125)).body).toBe('Continue your Morning reciting from page 125.');
    expect(wirdReminderContent('en', target('Evening', 125)).body).toBe('Continue your Evening reciting from page 125.');
    expect(wirdReminderContent('en', target('Ramadan', 125)).body).toBe('Continue your Ramadan reciting from page 125.');
  });

  it('the approved Arabic examples for ورد names saved in Arabic, with Arabic-Indic page numbers', () => {
    expect(wirdReminderContent('ar', target('الصباحي', 125)).body).toBe('أكمل وردك الصباحي من الصفحة ١٢٥.');
    expect(wirdReminderContent('ar', target('المسائي', 125)).body).toBe('أكمل وردك المسائي من الصفحة ١٢٥.');
    expect(wirdReminderContent('ar', target('رمضان', 125)).body).toBe('أكمل ورد رمضان من الصفحة ١٢٥.');
    expect(wirdReminderContent('ar', target('رمضان', 1)).body).toBe('أكمل ورد رمضان من الصفحة ١.');
    expect(wirdReminderContent('ar', target('رمضان', 604)).body).toBe('أكمل ورد رمضان من الصفحة ٦٠٤.');
    expect(wirdReminderContent('ar', target('رمضان', 604)).body).not.toMatch(/[0-9]/);
  });

  it('custom names are never translated: kept exactly, isolated only where their script runs against the copy', () => {
    // An English name in Arabic copy: unchanged, inside first-strong isolates so the sentence keeps its order.
    expect(wirdReminderContent('ar', target('Morning', 125)).body).toBe('أكمل ورد ⁨Morning⁩ من الصفحة ١٢٥.');
    expect(wirdReminderContent('ar', target('Mum 2', 7)).body).toBe('أكمل ورد ⁨Mum 2⁩ من الصفحة ٧.');
    // An Arabic name in English copy: likewise.
    expect(wirdReminderContent('en', target('ورد أمي', 30)).body).toBe('Continue your ⁨ورد أمي⁩ reciting from page 30.');
    // Same direction: exactly the saved name, nothing added.
    expect(wirdReminderContent('en', target("Mum's plan", 30)).body).toBe("Continue your Mum's plan reciting from page 30.");
    expect(wirdReminderContent('en', target('Morning', 125)).body).not.toContain('⁨');
  });

  it('a missing or invalid position: the generic copy, with no ورد id (nothing invented)', () => {
    for (const bad of [null, target('Mum', 0), target('Mum', 605), target('Mum', 12.5), target('  ', 4), { stopId: '', name: 'Mum', page: 4 }]) {
      expect(wirdReminderContent('en', bad)).toEqual({ title: 'Time for your Quran reciting.', body: 'Continue your Reciting and reconnect with the Quran.', data: { v: 2, kind: 'wird' } });
      expect(wirdReminderContent('ar', bad).body).toBe('واصل وِردك اليوم وخصص وقتًا لقراءة القرآن.');
    }
  });
});

describe('Which ورد: the one Home shows (the active one, else the most recently saved)', () => {
  const stops = [stop('b', 'Evening', 300, '2026-10-10T00:00:00.000Z'), stop('a', 'Morning', 125, '2026-10-01T00:00:00.000Z')];

  it('the active ورد, whatever the time of day; none active (or it was deleted): the most recently saved; none: null', () => {
    expect(selectWirdReminderTarget(stops, 'a')).toEqual({ stopId: 'a', name: 'Morning', page: 125 });
    expect(selectWirdReminderTarget(stops, 'b')).toEqual({ stopId: 'b', name: 'Evening', page: 300 });
    expect(selectWirdReminderTarget(stops, null)).toEqual({ stopId: 'b', name: 'Evening', page: 300 });
    expect(selectWirdReminderTarget(stops, 'deleted')).toEqual({ stopId: 'b', name: 'Evening', page: 300 });
    expect(selectWirdReminderTarget([], 'a')).toBeNull();
  });

  it('reads the active owner\'s data only (guest or account); unknown until the sign-in state is resolved', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('g', 'Guest', 10)]));
    state.storage.set(`${READING_STOPS_STORAGE_KEY}:account:user-1`, JSON.stringify(stops));
    state.storage.set(`${ACTIVE_READING_STOP_STORAGE_KEY}:account:user-1`, 'a');
    expect(await loadWirdReminderTarget()).toEqual({ known: true, target: { stopId: 'g', name: 'Guest', page: 10 } });
    setLocalDataOwnerState({ activeUserId: 'user-1', keptSeparate: [], resolved: true });
    expect(await loadWirdReminderTarget()).toEqual({ known: true, target: { stopId: 'a', name: 'Morning', page: 125 } });
    setLocalDataOwnerState({ activeUserId: 'user-1', keptSeparate: [], resolved: false });
    expect(await loadWirdReminderTarget()).toEqual({ known: false });
    setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true });
    state.storage.delete(READING_STOPS_STORAGE_KEY);
    expect(await loadWirdReminderTarget()).toEqual({ known: true, target: null });
  });
});

describe('Scheduling: the request follows the ورد, in place, never duplicated', () => {
  let lookup: WirdTargetLookup;
  const scheduler = () => createNotificationScheduler({ api, now: () => NOW, verses, ayahQueue: memoryQueue(), wirdTarget: async () => lookup });

  it('page, rename, another active ورد, deletion and language: only the Wird request is replaced, same identifier and time', async () => {
    const s = scheduler();
    lookup = { known: true, target: target('Evening', 125) };
    await s.reconcile({ preferences: prefs(), locale: 'en' });
    expect(wirdRequest().content).toMatchObject({ title: 'Time for your Quran reciting.', body: 'Continue your Evening reciting from page 125.', data: { v: 2, kind: 'wird', stopId: 'stop-1' } });
    expect(wirdRequest().trigger).toEqual({ type: 'daily', hour: 21, minute: 0 });
    const others = new Map([...pending].filter(([id]) => !id.startsWith('quranheals.wird.')).map(([id, r]) => [id, structuredClone(r)]));

    const steps: [WirdTargetLookup, 'en' | 'ar', string][] = [
      [{ known: true, target: target('Evening', 126) }, 'en', 'Continue your Evening reciting from page 126.'],
      [{ known: true, target: target('Night', 126) }, 'en', 'Continue your Night reciting from page 126.'],
      [{ known: true, target: target('Morning', 3, 'stop-2') }, 'en', 'Continue your Morning reciting from page 3.'],
      [{ known: true, target: null }, 'en', 'Continue your Reciting and reconnect with the Quran.'],
      [{ known: true, target: target('المسائي', 126) }, 'ar', 'أكمل وردك المسائي من الصفحة ١٢٦.'],
    ];
    for (const [next, locale, body] of steps) {
      lookup = next;
      log = [];
      await s.reconcile({ preferences: prefs(), locale });
      expect(wirdRequest().content.body).toBe(body);
      expect(wirdRequest().trigger).toEqual({ type: 'daily', hour: 21, minute: 0 });
      expect(parseNotificationPayload(wirdRequest().content.data)).toEqual(next.known && next.target ? { kind: 'wird', stopId: next.target.stopId } : { kind: 'wird' });
      if (locale === 'en') {
        expect(log).toEqual(['-quranheals.wird.daily', '+quranheals.wird.daily']);
        for (const [id, request] of others) expect(pending.get(id), id).toEqual(request);
      }
      expect([...pending.keys()].filter((id) => id.startsWith('quranheals.wird.'))).toEqual(['quranheals.wird.daily']);
    }
    // Nothing changed: nothing is touched.
    log = [];
    await s.reconcile({ preferences: prefs(), locale: 'ar' });
    expect(log).toEqual([]);
  });

  it('Every 3 days and Weekly keep their schedule: every dated Wird request names the current ورد and page', async () => {
    const s = scheduler();
    lookup = { known: true, target: target('Ramadan', 40) };
    const every3 = applyReminderChange(prefs(), 'wird', { frequency: 'every3days' }, NOW);
    await s.reconcile({ preferences: every3, locale: 'en' });
    const dated = [...pending.keys()].filter((id) => id.startsWith('quranheals.wird.d.'));
    expect(dated.length).toBeGreaterThan(5);
    for (const id of dated) expect(pending.get(id)!.content.body).toBe('Continue your Ramadan reciting from page 40.');
    lookup = { known: true, target: target('Ramadan', 41) };
    await s.reconcile({ preferences: every3, locale: 'en' });
    expect([...pending.keys()].filter((id) => id.startsWith('quranheals.wird.d.'))).toEqual(dated);
    for (const id of dated) expect(pending.get(id)!.content.body).toBe('Continue your Ramadan reciting from page 41.');
    const weekly = applyReminderChange(every3, 'wird', { frequency: 'weekly', weekday: 6 }, NOW);
    await s.reconcile({ preferences: weekly, locale: 'en' });
    expect([...pending.keys()].filter((id) => id.startsWith('quranheals.wird.'))).toEqual(['quranheals.wird.weekly']);
    expect(pending.get('quranheals.wird.weekly')!.trigger).toEqual({ type: 'weekly', weekday: 6, hour: 21, minute: 0 });
  });

  it('whose ورد is not known yet (launch): a scheduled reminder is left as it is; with none scheduled, the generic copy', async () => {
    const s = scheduler();
    lookup = { known: true, target: target('Evening', 125) };
    await s.reconcile({ preferences: prefs(), locale: 'en' });
    lookup = { known: false };
    log = [];
    const result = await s.reconcile({ preferences: prefs(), locale: 'en' });
    expect(log).toEqual([]);
    expect(wirdRequest().content.body).toBe('Continue your Evening reciting from page 125.');
    expect(result.states.wird).toEqual({ state: 'scheduled', pending: 1 });
    pending.clear();
    await s.reconcile({ preferences: prefs(), locale: 'en' });
    expect(wirdRequest().content.body).toBe('Continue your Reciting and reconnect with the Quran.');
  });

  it('a failed read of the reading data: the generic copy, never a guess', async () => {
    const s = createNotificationScheduler({ api, now: () => NOW, verses, ayahQueue: memoryQueue(), wirdTarget: async () => { throw new Error('storage'); } });
    await s.reconcile({ preferences: prefs(), locale: 'en' });
    expect(wirdRequest().content.data).toEqual(expect.objectContaining({ v: 2, kind: 'wird' }));
    expect(wirdRequest().content.data.stopId).toBeUndefined();
  });

  it('upgrading: requests the previous version scheduled (payload v1, old copy) are replaced in place, once — settings untouched, no duplicates', async () => {
    const preferences = prefs();
    lookup = { known: true, target: target('Evening', 125) };
    await scheduler().reconcile({ preferences, locale: 'en' });
    const ids = [...pending.keys()].sort();
    const triggers = new Map([...pending].map(([id, r]) => [id, r.trigger]));
    // What the previous release left pending: version 1 payloads, signed with version 1.
    for (const [id, r] of pending) pending.set(id, { ...r, content: { ...r.content, title: 'old', body: 'old', data: { ...r.content.data, v: 1, sig: String(r.content.data.sig).replace(/^2\|/, '1|') } } });
    log = [];
    await scheduler().reconcile({ preferences, locale: 'en' });
    expect([...pending.keys()].sort()).toEqual(ids);
    for (const [id, r] of pending) {
      expect(r.trigger, id).toEqual(triggers.get(id));
      expect(r.content.data.v, id).toBe(2);
      expect(r.content.title, id).not.toBe('old');
    }
    expect(log.filter((e) => e.startsWith('+'))).toHaveLength(ids.length);
    expect(new Set(log.filter((e) => e.startsWith('+'))).size).toBe(ids.length);
    log = [];
    await scheduler().reconcile({ preferences, locale: 'en' });
    expect(log).toEqual([]);
  });
});

describe('Tap: the ورد the reminder named', () => {
  let opened: { id: string; page: number }[];
  let navigated: unknown[];
  const handle = () => createNotificationResponseHandler({
    loadStops: () => loadReadingStops(),
    openMushafFor: async (s) => { opened.push(s); },
    navigate: (route) => { navigated.push(route); },
  });
  const tap = (data: unknown, deliveredAt = 1) => ({ identifier: 'quranheals.wird.daily', deliveredAt, data, isDefaultAction: true });
  beforeEach(() => {
    opened = [];
    navigated = [];
  });

  it('several أوراد: opens exactly the named one, on its current saved page (moved since scheduling)', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('a', 'Morning', 125), stop('b', 'Evening', 300)]));
    await handle()(tap({ v: 2, kind: 'wird', stopId: 'b' }));
    expect(opened).toEqual([expect.objectContaining({ id: 'b', page: 300 })]);
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('a', 'Morning', 125), stop('b', 'Evening', 301)]));
    await handle()(tap({ v: 2, kind: 'wird', stopId: 'b' }, 2));
    expect(opened[1]).toEqual(expect.objectContaining({ id: 'b', page: 301 }));
    expect(navigated).toEqual([]);
  });

  it('deleted since, or another owner\'s: أورادي وختماتي (never another ورد)', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('a', 'Morning', 125)]));
    await handle()(tap({ v: 2, kind: 'wird', stopId: 'gone' }));
    expect(opened).toEqual([]);
    expect(navigated).toEqual(['/my-reading']);
  });

  it('named no ورد (generic copy, or an older version\'s tap): with exactly one ورد, that one; otherwise أورادي وختماتي', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('a', 'Morning', 125)]));
    await handle()(tap({ v: 2, kind: 'wird' }));
    await handle()(tap({ v: 1, kind: 'wird' }, 2));
    expect(opened).toEqual([expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'a' })]);
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([stop('a', 'Morning', 125), stop('b', 'Evening', 300)]));
    await handle()(tap({ v: 2, kind: 'wird' }, 3));
    expect(navigated).toEqual(['/my-reading']);
  });

  it('a damaged ورد id is ignored, as an older version\'s tap', () => {
    expect(parseNotificationPayload({ v: 2, kind: 'wird', stopId: 42 })).toEqual({ kind: 'wird' });
    expect(parseNotificationPayload({ v: 2, kind: 'wird', stopId: 'x'.repeat(101) })).toEqual({ kind: 'wird' });
    expect(parseNotificationPayload({ v: 2, kind: 'wird', stopId: 'stop-1' })).toEqual({ kind: 'wird', stopId: 'stop-1' });
  });
});

describe('NotificationsProvider: the pending reminder follows the reading data, offline and on device only', () => {
  let root: ReactTestRenderer | undefined;
  let locale: ReturnType<typeof useAppLocale>;
  function Probe() {
    locale = useAppLocale();
    return null;
  }
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((done) => setTimeout(done, 0)); });
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
  });

  it('save a page, rename, switch, delete, sign in to an account, change language: the Wird reminder is rescheduled each time, once', async () => {
    const times = [0];
    const now = () => new Date(Date.UTC(2026, 9, 14, 12, 0, times[0]++));
    await saveReadingStop({ name: 'Evening', page: 125 }, { now, newId: () => 'e' });
    await act(async () => {
      root = create(createElement(AppLocaleProvider, null, createElement(NotificationsProvider, { api, verses, now: () => NOW }, createElement(Probe))));
    });
    await flush();
    expect(wirdRequest().content.body).toBe('Continue your Evening reciting from page 125.');
    const bodies = () => [...pending.values()].filter((r) => r.identifier.startsWith('quranheals.wird.')).map((r) => r.content.body);

    await act(async () => { await saveReadingStop({ name: 'Evening', page: 126 }, { now }); });
    await flush();
    expect(bodies()).toEqual(['Continue your Evening reciting from page 126.']);

    await act(async () => { await renameReadingStop('e', 'Night'); });
    await flush();
    expect(bodies()).toEqual(['Continue your Night reciting from page 126.']);

    await act(async () => { await saveReadingStop({ name: 'Morning', page: 3 }, { now, newId: () => 'm' }); await setActiveReadingStopId('e'); });
    await flush();
    expect(bodies()).toEqual(['Continue your Night reciting from page 126.']);
    expect(wirdRequest().content.data.stopId).toBe('e');

    await act(async () => { await removeReadingStop('e'); });
    await flush();
    expect(bodies()).toEqual(['Continue your Morning reciting from page 3.']);

    // Signed in: the account's own ورد (none yet): the generic copy, never the guest's.
    await act(async () => { setLocalDataOwnerState({ activeUserId: 'user-1', keptSeparate: [], resolved: true }); });
    await flush();
    expect(bodies()).toEqual(['Continue your Reciting and reconnect with the Quran.']);

    await act(async () => { setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true }); });
    await flush();
    await act(async () => locale.setLocale('ar'));
    await flush();
    expect(bodies()).toEqual(['أكمل ورد ⁨Morning⁩ من الصفحة ٣.']);
    expect(wirdRequest().content.title).toBe('وقت وردك القرآني');
    // One request, the same identifier, through every change.
    expect([...pending.keys()].filter((id) => id.startsWith('quranheals.wird.'))).toEqual(['quranheals.wird.daily']);
  });

  it('the user\'s saved times and switches are kept: nothing about the reminder settings changes with the reading data', async () => {
    // An existing user's saved choices (a custom time, a reminder turned off, Weekly).
    state.storage.set('quran-heals:notification-preferences:v1', JSON.stringify({
      wird: { enabled: true, frequency: 'daily', time: '06:15' },
      randomAyah: { enabled: false, frequency: 'daily', time: '08:00' },
      emotionCheckIn: { enabled: true, frequency: 'weekly', time: '21:00', weekday: 2 },
    }));
    await saveReadingStop({ name: 'Evening', page: 125 }, { newId: () => 'e' });
    await act(async () => {
      root = create(createElement(AppLocaleProvider, null, createElement(NotificationsProvider, { api, verses, now: () => NOW }, createElement(Probe))));
    });
    await flush();
    expect(wirdRequest().trigger).toEqual({ type: 'daily', hour: 6, minute: 15 });
    expect([...pending.keys()].some((id) => id.startsWith('quranheals.ayah.'))).toBe(false);
    expect(pending.get('quranheals.checkin.weekly')!.trigger).toEqual({ type: 'weekly', weekday: 2, hour: 21, minute: 0 });
    await act(async () => { await saveReadingStop({ name: 'Evening', page: 200 }); });
    await flush();
    expect(wirdRequest().trigger).toEqual({ type: 'daily', hour: 6, minute: 15 });
    expect(wirdRequest().content.body).toBe('Continue your Evening reciting from page 200.');
    const stored = JSON.parse(state.storage.get('quran-heals:notification-preferences:v1')!);
    expect(stored.wird).toMatchObject({ enabled: true, frequency: 'daily', time: '06:15' });
    expect(stored.randomAyah).toMatchObject({ enabled: false });
    expect(stored.emotionCheckIn).toMatchObject({ frequency: 'weekly', weekday: 2 });
  });
});
