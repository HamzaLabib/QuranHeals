import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => undefined } }));

import type { NotificationsApi, PendingNotification, ScheduleRequest } from '@/notifications/api';
import type { AyahQueue, AyahQueueStore } from '@/notifications/ayahQueue';
import { parseNotificationPayload } from '@/notifications/content';
import { DEFAULT_NOTIFICATION_PREFERENCES, applyReminderChange, completeSchedules } from '@/notifications/preferences';
import { IOS_PENDING_LIMIT, PENDING_BUDGET, createNotificationScheduler } from '@/notifications/scheduler';

/**
 * With the defaults on 2026-10-14 at noon: Wird Daily is one repeating
 * request, leaving PENDING_BUDGET - 1 = 59 dated slots, filled earliest-first.
 * Worked out by hand: Random Ayah daily from 10-15 to 11-27 (44 deliveries)
 * and Check-in every 3 days from 10-14 to 11-25 (15); the 60th would be the
 * Random Ayah of 11-28.
 */
const DEFAULT_RANDOM_AYAHS = 44;
const DEFAULT_CHECK_INS = 15;
import type { NotificationPermission, NotificationPreferences } from '@/notifications/types';

/**
 * The reconciliation engine (notifications/scheduler.ts) over a fake OS that
 * keeps pending requests by identifier, as iOS and Android do. Unit tests:
 * they prove what the app asks the OS to schedule, not delivery itself.
 */
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { process.env.TZ = originalTz; });

type Os = { permission: NotificationPermission; pending: Map<string, ScheduleRequest>; log: string[] };
let os: Os;
let queueStore: AyahQueueStore & { value: AyahQueue };
let now: Date;
let picks: number;

function fakeApi(): NotificationsApi {
  return {
    supported: true,
    getPermission: async () => os.permission,
    requestPermission: async () => os.permission,
    ensureChannels: async () => { os.log.push('channels'); },
    getPending: async () => [...os.pending.values()].map<PendingNotification>((r) => ({ identifier: r.identifier, data: r.content.data })),
    schedule: async (request) => { os.log.push(`+${request.identifier}`); os.pending.set(request.identifier, request); },
    cancel: async (id) => { os.log.push(`-${id}`); os.pending.delete(id); },
    getLastResponse: () => null,
    clearLastResponse: () => undefined,
    addResponseListener: () => ({ remove: () => undefined }),
    setForegroundPresentation: () => undefined,
    openSystemSettings: async () => undefined,
  };
}

/** A small stand-in Quran: every verse key resolves; picks walk through distinct keys of surah 2. */
const verses = {
  getVerseByKey: async (verseKey: string) => {
    const [surah, ayah] = verseKey.split(':').map(Number);
    return { surah, ayah, verseKey, arabicText: `نص ${verseKey}` };
  },
  getRandomVerseKey: async (excluded: string[]) => {
    for (;;) {
      picks += 1;
      const key = `2:${picks}`;
      if (!excluded.includes(key)) return key;
    }
  },
};

function makeScheduler() {
  return createNotificationScheduler({ api: fakeApi(), now: () => now, verses, ayahQueue: queueStore });
}
/**
 * The worked examples below use the settings every install from before 2026-10-15 still has saved: the Check-in Every
 * 3 days (its default then; a saved value is never changed). New installs default to Daily (see 'You Deserve Peace').
 */
const PREVIOUS_DEFAULTS: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, emotionCheckIn: { ...DEFAULT_NOTIFICATION_PREFERENCES.emotionCheckIn, frequency: 'every3days' } };
const prefsAt = (p: NotificationPreferences = PREVIOUS_DEFAULTS) => completeSchedules(p, now).preferences;
const ids = (prefix: string) => [...os.pending.keys()].filter((id) => id.startsWith(prefix)).sort();

beforeEach(() => {
  os = { permission: { status: 'granted', canAskAgain: true }, pending: new Map(), log: [] };
  queueStore = { value: { entries: {}, recent: [] }, async load() { return structuredClone(this.value); }, async save(q) { this.value = structuredClone(q); } };
  now = new Date(2026, 9, 14, 12, 0); // Wednesday
  picks = 0;
});

describe('Defaults, scheduled only with OS permission', () => {
  it('ON by default does not bypass the OS: undetermined or denied → nothing scheduled, and the state says why', async () => {
    for (const status of ['undetermined', 'denied'] as const) {
      os.permission = { status, canAskAgain: status === 'undetermined' };
      const result = await makeScheduler().reconcile({ preferences: prefsAt(), locale: 'en' });
      expect(os.pending.size).toBe(0);
      expect(result.states).toEqual({ wird: { state: 'needsPermission' }, randomAyah: { state: 'needsPermission' }, emotionCheckIn: { state: 'needsPermission' } });
    }
  });

  it('granted: Wird one daily 21:00 request, Check-in every 3 days at 21:00, Random Ayah one dated request per day at 08:00', async () => {
    const result = await makeScheduler().reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(os.pending.get('quranheals.wird.daily')?.trigger).toEqual({ type: 'daily', hour: 21, minute: 0 });
    const checkIns = ids('quranheals.checkin.');
    expect(checkIns).toHaveLength(DEFAULT_CHECK_INS);
    expect(checkIns.at(-1)).toBe('quranheals.checkin.d.2026-11-25');
    expect(checkIns.slice(0, 3)).toEqual(['quranheals.checkin.d.2026-10-14', 'quranheals.checkin.d.2026-10-17', 'quranheals.checkin.d.2026-10-20']);
    const ayahs = ids('quranheals.ayah.');
    expect(ayahs).toHaveLength(DEFAULT_RANDOM_AYAHS);
    expect(ayahs.at(-1)).toBe('quranheals.ayah.2026-11-27');
    expect(os.pending.size).toBe(1 + DEFAULT_RANDOM_AYAHS + DEFAULT_CHECK_INS);
    expect(os.pending.size).toBe(PENDING_BUDGET);
    expect(ayahs[0]).toBe('quranheals.ayah.2026-10-15'); // 08:00 today has passed
    const first = os.pending.get(ayahs[0])!;
    expect(first.trigger).toEqual({ type: 'date', date: new Date(2026, 9, 15, 8, 0) });
    expect(result.states.randomAyah).toEqual({ state: 'scheduled', pending: DEFAULT_RANDOM_AYAHS });
    expect(result.states.emotionCheckIn).toEqual({ state: 'scheduled', pending: DEFAULT_CHECK_INS });
  });

  it('never more than the budget (60, below the iOS limit of 64), whatever the frequencies; every dated run reaches the same horizon', async () => {
    expect(PENDING_BUDGET).toBeLessThan(IOS_PENDING_LIMIT);
    const combos: [string, string, string][] = [];
    for (const w of ['daily', 'every3days', 'weekly']) for (const r of ['daily', 'every3days', 'weekly']) for (const c of ['daily', 'every3days', 'weekly', 'twiceDaily']) combos.push([w, r, c]);
    for (const [w, r, c] of combos) {
      os.pending.clear();
      let p = prefsAt();
      p = applyReminderChange(p, 'wird', { frequency: w as never }, now);
      p = applyReminderChange(p, 'randomAyah', { frequency: r as never }, now);
      p = applyReminderChange(p, 'emotionCheckIn', { frequency: c as never }, now);
      await makeScheduler().reconcile({ preferences: p, locale: 'en' });
      // Twice Daily: two repeating requests.
      const repeating = (w !== 'every3days' ? 1 : 0) + (c === 'twiceDaily' ? 2 : c !== 'every3days' ? 1 : 0);
      // The budget is always used in full: the dated runs fill what the repeating requests leave.
      expect(os.pending.size, `${w}/${r}/${c}`).toBe(PENDING_BUDGET);
      expect([...os.pending.keys()].filter((id) => /\.(daily|weekly|twice\.morning|twice\.evening)$/.test(id))).toHaveLength(repeating);
      // Same horizon: no dated run ends more than one of its own intervals before another's last entry.
      const lastOf = (prefix: string) => Math.max(...[...os.pending.values()].filter((q) => q.identifier.startsWith(prefix) && q.trigger.type === 'date').map((q) => (q.trigger as { date: Date }).date.getTime()));
      const ends = ([['quranheals.wird.d.', w], ['quranheals.checkin.d.', c], ['quranheals.ayah.', r]] as const)
        .filter(([prefix, f]) => prefix === 'quranheals.ayah.' || f === 'every3days')
        .map(([prefix, f]) => ({ end: lastOf(prefix), step: (f === 'daily' ? 1 : f === 'every3days' ? 3 : 7) * 86_400_000 }));
      const horizon = Math.max(...ends.map((e) => e.end));
      for (const { end, step } of ends) expect(horizon - end, `${w}/${r}/${c}`).toBeLessThanOrEqual(step + 3_600_000);
    }
  });
});

describe('Idempotent reconciliation', () => {
  it('a second run with nothing changed schedules and cancels nothing', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    os.log = [];
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(os.log.filter((entry) => entry !== 'channels')).toEqual([]);
  });

  it('turning one reminder OFF cancels only its own notifications; the others keep every entry (and may extend into the freed slots)', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    const checkInsBefore = ids('quranheals.checkin.');
    os.log = [];
    const off = applyReminderChange(prefsAt(), 'randomAyah', { enabled: false }, now);
    const result = await scheduler.reconcile({ preferences: off, locale: 'en' });
    const cancelled = os.log.filter((entry) => entry.startsWith('-'));
    expect(cancelled.every((entry) => entry.startsWith('-quranheals.ayah.'))).toBe(true);
    expect(cancelled).toHaveLength(DEFAULT_RANDOM_AYAHS);
    expect(ids('quranheals.ayah.')).toEqual([]);
    expect(ids('quranheals.wird.')).toEqual(['quranheals.wird.daily']);
    // Every earlier Check-in is still there, untouched; only later dates were added at the end.
    const checkInsAfter = ids('quranheals.checkin.');
    expect(checkInsAfter.slice(0, checkInsBefore.length)).toEqual(checkInsBefore);
    expect(checkInsAfter).toHaveLength(PENDING_BUDGET - 1);
    expect(os.log.filter((entry) => entry.startsWith('+')).every((entry) => entry.startsWith('+quranheals.checkin.d.') && entry > `+${checkInsBefore.at(-1)}`)).toBe(true);
    expect(result.states.randomAyah).toEqual({ state: 'off' });
  });

  it('turning it back ON restores the saved frequency and time (and the same preselected verses)', async () => {
    const scheduler = makeScheduler();
    const custom = applyReminderChange(prefsAt(), 'randomAyah', { time: { hour: 6, minute: 30 } }, now);
    await scheduler.reconcile({ preferences: custom, locale: 'en' });
    const versesBefore = ids('quranheals.ayah.').map((id) => os.pending.get(id)!.content.data.verseKey);
    const off = applyReminderChange(custom, 'randomAyah', { enabled: false }, now);
    await scheduler.reconcile({ preferences: off, locale: 'en' });
    const on = applyReminderChange(off, 'randomAyah', { enabled: true }, now);
    await scheduler.reconcile({ preferences: on, locale: 'en' });
    const first = os.pending.get(ids('quranheals.ayah.')[0])!;
    expect(first.trigger).toEqual({ type: 'date', date: new Date(2026, 9, 15, 6, 30) });
    expect(ids('quranheals.ayah.').map((id) => os.pending.get(id)!.content.data.verseKey)).toEqual(versesBefore);
  });

  it('changing the Wird time replaces only the Wird request', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    os.log = [];
    await scheduler.reconcile({ preferences: applyReminderChange(prefsAt(), 'wird', { time: { hour: 5, minute: 15 } }, now), locale: 'en' });
    expect(os.log).toEqual(['-quranheals.wird.daily', '+quranheals.wird.daily']);
    expect(os.pending.get('quranheals.wird.daily')?.trigger).toEqual({ type: 'daily', hour: 5, minute: 15 });
  });

  it('Weekly uses one repeating request on the chosen weekday; changing the weekday replaces it', async () => {
    const scheduler = makeScheduler();
    let p = applyReminderChange(prefsAt(), 'wird', { frequency: 'weekly', weekday: 1 }, now);
    await scheduler.reconcile({ preferences: p, locale: 'en' });
    expect(os.pending.get('quranheals.wird.weekly')?.trigger).toEqual({ type: 'weekly', weekday: 1, hour: 21, minute: 0 });
    expect(os.pending.has('quranheals.wird.daily')).toBe(false);
    p = applyReminderChange(p, 'wird', { weekday: 6 }, now);
    await scheduler.reconcile({ preferences: p, locale: 'en' });
    expect(os.pending.get('quranheals.wird.weekly')?.trigger).toEqual({ type: 'weekly', weekday: 6, hour: 21, minute: 0 });
  });

  it('Wird and Check-in both at 21:00 on the same day are two separate requests; neither replaces the other', async () => {
    await makeScheduler().reconcile({ preferences: prefsAt(), locale: 'en' });
    const checkIn = os.pending.get('quranheals.checkin.d.2026-10-14')!;
    const wird = os.pending.get('quranheals.wird.daily')!;
    expect((checkIn.trigger as { date: Date }).date).toEqual(new Date(2026, 9, 14, 21, 0));
    expect(wird.trigger).toEqual({ type: 'daily', hour: 21, minute: 0 });
    expect(parseNotificationPayload(checkIn.content.data)).toEqual({ kind: 'emotionCheckIn' });
    expect(parseNotificationPayload(wird.content.data)).toEqual({ kind: 'wird' });
  });

  it('a pending request this app did not create is never touched', async () => {
    os.pending.set('someone-else', { identifier: 'someone-else', kind: 'wird', content: { title: 'x', body: 'y', data: {} }, trigger: { type: 'daily', hour: 1, minute: 0 } });
    await makeScheduler().reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(os.pending.has('someone-else')).toBe(true);
  });

  it('a damaged or duplicated pending entry of ours is repaired', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    const wird = os.pending.get('quranheals.wird.daily')!;
    os.pending.set('quranheals.wird.daily', { ...wird, content: { ...wird.content, data: { ...wird.content.data, sig: 'stale' } } });
    os.pending.set('quranheals.wird.d.2026-10-20', { ...wird, identifier: 'quranheals.wird.d.2026-10-20' });
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(ids('quranheals.wird.')).toEqual(['quranheals.wird.daily']);
    expect(os.pending.get('quranheals.wird.daily')!.content.data.sig).not.toBe('stale');
  });
});

describe('Races', () => {
  it('rapid changes are serialized and end on the last one, with no duplicates', async () => {
    const scheduler = makeScheduler();
    const runs = [5, 6, 7, 8].map((hour) => scheduler.reconcile({ preferences: applyReminderChange(prefsAt(), 'wird', { time: { hour, minute: 0 } }, now), locale: 'en' }));
    await Promise.all(runs);
    expect(ids('quranheals.wird.')).toEqual(['quranheals.wird.daily']);
    expect(os.pending.get('quranheals.wird.daily')?.trigger).toEqual({ type: 'daily', hour: 8, minute: 0 });
    expect(ids('quranheals.ayah.')).toHaveLength(DEFAULT_RANDOM_AYAHS);
    expect(new Set(ids('quranheals.ayah.').map((id) => os.pending.get(id)!.content.data.verseKey)).size).toBe(DEFAULT_RANDOM_AYAHS);
    expect(os.pending.size).toBe(PENDING_BUDGET);
  });
});

describe('Permission changes', () => {
  it('granted later: the next reconciliation schedules everything ON; revoked: everything is removed', async () => {
    os.permission = { status: 'denied', canAskAgain: false };
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(os.pending.size).toBe(0);
    os.permission = { status: 'granted', canAskAgain: true };
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(os.pending.size).toBe(PENDING_BUDGET);
    os.permission = { status: 'denied', canAskAgain: false };
    const result = await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(os.pending.size).toBe(0);
    expect(result.states.wird).toEqual({ state: 'needsPermission' });
  });

  it('an OFF reminder reports off even without permission (the wish, not the OS)', async () => {
    os.permission = { status: 'undetermined', canAskAgain: true };
    const result = await makeScheduler().reconcile({ preferences: applyReminderChange(prefsAt(), 'wird', { enabled: false }, now), locale: 'en' });
    expect(result.states.wird).toEqual({ state: 'off' });
    expect(result.states.randomAyah).toEqual({ state: 'needsPermission' });
  });
});

describe('Random Quran Ayah queue', () => {
  it('each delivery carries its own verse identity (type, key, surah, ayah, version), all distinct', async () => {
    await makeScheduler().reconcile({ preferences: prefsAt(), locale: 'en' });
    const payloads = ids('quranheals.ayah.').map((id) => os.pending.get(id)!.content.data);
    for (const data of payloads) {
      expect(data).toMatchObject({ v: 2, kind: 'randomAyah' });
      expect(parseNotificationPayload(data)).toEqual({ kind: 'randomAyah', verseKey: data.verseKey, surah: data.surah, ayah: data.ayah });
    }
    expect(new Set(payloads.map((d) => d.verseKey)).size).toBe(DEFAULT_RANDOM_AYAHS);
    expect(queueStore.value.entries['2026-10-15']).toBe(payloads[0].verseKey);
  });

  it('an App Language change rewrites the copy but keeps every preselected verse, and the Arabic text untouched', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    const before = new Map(ids('quranheals.ayah.').map((id) => [id, os.pending.get(id)!.content]));
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'ar' });
    for (const [id, content] of before) {
      const after = os.pending.get(id)!.content;
      expect(after.data.verseKey).toBe(content.data.verseKey);
      // The verse itself is untouched; only its reference under it follows the language.
      expect(after.body.split('\n\n')[0]).toBe(content.body.split('\n\n')[0]);
      expect(content.title).toBe('A Verse for You Today');
      expect(after.title).toBe('آية من القرآن لك اليوم');
      const [surah, ayah] = String(content.data.verseKey).split(':');
      expect(content.body.endsWith(`\n\n${surah === '2' ? 'Al-Baqara' : '?'} · ${surah}:${ayah}`)).toBe(true);
      expect(after.body.endsWith(`\n\nسورة البقرة · الآية ${ayah.replace(/\d/g, (x) => '٠١٢٣٤٥٦٧٨٩'[Number(x)])}`)).toBe(true);
    }
    expect(os.pending.get('quranheals.wird.daily')!.content.title).toBe('وقت وردك القرآني');
  });

  it('the next day, delivered entries drop off, new dates are added only at the far end, and existing ones keep their verses (no duplicates, no repeat of recent verses)', async () => {
    const scheduler = makeScheduler();
    // The saved settings (with the Check-in cycle fixed on first launch) stay the same from one day to the next.
    const saved = prefsAt();
    await scheduler.reconcile({ preferences: saved, locale: 'en' });
    const yesterday = new Map(ids('quranheals.ayah.').map((id) => [id, os.pending.get(id)!.content.data.verseKey]));
    // The 10-14 Check-in and the 10-15 Random Ayah were delivered (the OS drops them); a day passes.
    os.pending.delete('quranheals.checkin.d.2026-10-14');
    os.pending.delete('quranheals.ayah.2026-10-15');
    now = new Date(2026, 9, 15, 12, 0);
    os.log = [];
    await scheduler.reconcile({ preferences: saved, locale: 'en' });
    const today = ids('quranheals.ayah.');
    expect(today[0]).toBe('quranheals.ayah.2026-10-16');
    // Only new far-end dates are added; nothing nearer is cancelled or rebuilt.
    expect(os.log.filter((e) => e.startsWith('-'))).toEqual([]);
    const added = os.log.filter((e) => e.startsWith('+quranheals.ayah.')).map((e) => e.slice(1));
    expect(added.length).toBeGreaterThan(0);
    for (const id of added) expect(id > 'quranheals.ayah.2026-11-27').toBe(true);
    for (const id of today.filter((id) => !added.includes(id))) expect(os.pending.get(id)!.content.data.verseKey).toBe(yesterday.get(id));
    for (const id of added) expect([...yesterday.values()]).not.toContain(os.pending.get(id)!.content.data.verseKey as string);
    expect(os.pending.size).toBe(PENDING_BUDGET);
    expect(queueStore.value.recent).toContain(yesterday.get('quranheals.ayah.2026-10-15'));
  });

  it('a lost queue store still keeps the verses already scheduled (read back from the pending payloads)', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    const before = ids('quranheals.ayah.').map((id) => os.pending.get(id)!.content.data.verseKey);
    queueStore.value = { entries: {}, recent: [] };
    os.log = [];
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(os.log.filter((e) => e !== 'channels')).toEqual([]);
    expect(ids('quranheals.ayah.').map((id) => os.pending.get(id)!.content.data.verseKey)).toEqual(before);
  });

  it('a verse that cannot be read is skipped and reported, without blocking the other reminders', async () => {
    const failing = createNotificationScheduler({
      api: fakeApi(), now: () => now, ayahQueue: queueStore,
      verses: { ...verses, getVerseByKey: async () => { throw new Error('database unavailable'); } },
    });
    const result = await failing.reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(result.states.randomAyah).toEqual({ state: 'error' });
    expect(result.states.wird).toEqual({ state: 'scheduled', pending: 1 });
    expect(ids('quranheals.ayah.')).toEqual([]);
  });
});

describe('Time zone change', () => {
  it('dated reminders are rebuilt at the same local clock time in the new zone; repeating ones are left to the OS', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    const verse = os.pending.get('quranheals.ayah.2026-10-15')!.content.data.verseKey;
    process.env.TZ = 'Asia/Riyadh';
    try {
      now = new Date(2026, 9, 14, 13, 0);
      os.log = [];
      await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
      const rebuilt = os.pending.get('quranheals.ayah.2026-10-15')!;
      expect((rebuilt.trigger as { date: Date }).date.getHours()).toBe(8);
      expect(rebuilt.content.data.verseKey).toBe(verse);
      expect(os.log).not.toContain('-quranheals.wird.daily');
    } finally {
      process.env.TZ = 'America/New_York';
    }
  });
});

describe('Unsupported platform (web)', () => {
  it('schedules nothing and says so', async () => {
    const scheduler = createNotificationScheduler({ api: { ...fakeApi(), supported: false }, now: () => now, verses, ayahQueue: queueStore });
    const result = await scheduler.reconcile({ preferences: prefsAt(), locale: 'en' });
    expect(result.permission.status).toBe('unsupported');
    expect(result.states.wird).toEqual({ state: 'unsupported' });
    expect(os.pending.size).toBe(0);
  });
});

describe('the final approved wording (2026-10-17): Check-in reminders already scheduled with the previous copy', () => {
  /** The copy the previous release scheduled for this reminder. */
  const OLD = {
    en: { title: 'You Deserve Peace \u2764\uFE0F', body: 'How are you feeling today? Let the Quran bring comfort to your heart.' },
    ar: { title: 'تستحق الطمأنينة \u2764\uFE0F', body: 'كيف تشعر اليوم؟ دع القرآن يطمئن قلبك.' },
  } as const;
  const NEW = {
    en: { title: 'You Deserve Peace \u2764\uFE0F', body: "Whatever you're feeling, there's something in the Quran that speaks to your heart." },
    ar: { title: 'تستحق السكينة \u2764\uFE0F', body: 'مهما كان شعورك، في القرآن ما يلامس قلبك.' },
  } as const;
  const checkIn = 'quranheals.checkin.';

  for (const locale of ['en', 'ar'] as const) {
    for (const frequency of ['every3days', 'daily', 'weekly'] as const) {
      it(`${locale}, ${frequency}: only the Check-in requests are replaced, with the same identifiers and times — no duplicates, nothing else touched, then nothing more`, async () => {
        const preferences = prefsAt({ ...DEFAULT_NOTIFICATION_PREFERENCES, emotionCheckIn: { ...DEFAULT_NOTIFICATION_PREFERENCES.emotionCheckIn, frequency } });
        await makeScheduler().reconcile({ preferences, locale });
        const before = new Map([...os.pending].map(([id, r]) => [id, structuredClone(r)]));
        const mine = [...before.keys()].filter((id) => id.startsWith(checkIn));
        expect(mine.length).toBeGreaterThan(0);
        // What an install from before this change holds: the old copy, signed with it.
        for (const id of mine) {
          const request = os.pending.get(id)!;
          const sig = String(request.content.data.sig);
          expect(sig).toContain(`${NEW[locale].title}|${NEW[locale].body}`);
          os.pending.set(id, { ...request, content: { ...request.content, ...OLD[locale], data: { ...request.content.data, sig: sig.replace(`${NEW[locale].title}|${NEW[locale].body}`, `${OLD[locale].title}|${OLD[locale].body}`) } } });
        }
        os.log = [];
        await makeScheduler().reconcile({ preferences, locale });
        // The same identifiers, nothing added or lost, and the same trigger for each.
        expect([...os.pending.keys()].sort()).toEqual([...before.keys()].sort());
        for (const [id, request] of before) expect(os.pending.get(id)!.trigger, id).toEqual(request.trigger);
        // Only the Check-in requests were cancelled and re-added, each once; the Wird and Random Ayah requests untouched.
        expect(os.log.filter((entry) => entry !== 'channels').every((entry) => entry.slice(1).startsWith(checkIn))).toBe(true);
        expect(os.log.filter((entry) => entry.startsWith('+')).sort()).toEqual(mine.map((id) => `+${id}`).sort());
        expect(os.log.filter((entry) => entry.startsWith('-')).sort()).toEqual(mine.map((id) => `-${id}`).sort());
        for (const [id, request] of before) if (!id.startsWith(checkIn)) expect(os.pending.get(id), id).toEqual(request);
        // Now in the new copy, opening the emotions list as before.
        for (const id of mine) {
          const { content } = os.pending.get(id)!;
          expect(content).toMatchObject(NEW[locale]);
          expect(parseNotificationPayload(content.data)).toEqual({ kind: 'emotionCheckIn' });
        }
        // Idempotent: a further run changes nothing.
        os.log = [];
        await makeScheduler().reconcile({ preferences, locale });
        expect(os.log.filter((entry) => entry !== 'channels')).toEqual([]);
      });
    }
  }
});

describe('You Deserve Peace: Daily by default, and Twice Daily (2026-10-15)', () => {
  const checkIn = 'quranheals.checkin.';
  const withCheckIn = (change: Parameters<typeof applyReminderChange>[2], base = prefsAt(DEFAULT_NOTIFICATION_PREFERENCES)) => applyReminderChange(base, 'emotionCheckIn', change, now);
  const twiceDaily = () => withCheckIn({ frequency: 'twiceDaily' });

  it('a new install (the defaults): one Check-in request, repeated daily at 21:00 by the OS; the Random Ayah gets the slots it no longer uses', async () => {
    const result = await makeScheduler().reconcile({ preferences: prefsAt(DEFAULT_NOTIFICATION_PREFERENCES), locale: 'en' });
    expect(ids(checkIn)).toEqual(['quranheals.checkin.daily']);
    expect(os.pending.get('quranheals.checkin.daily')!.trigger).toEqual({ type: 'daily', hour: 21, minute: 0 });
    expect(os.pending.get('quranheals.wird.daily')!.trigger).toEqual({ type: 'daily', hour: 21, minute: 0 });
    expect(ids('quranheals.ayah.')).toHaveLength(PENDING_BUDGET - 2);
    expect(os.pending.size).toBe(PENDING_BUDGET);
    expect(result.states.emotionCheckIn).toEqual({ state: 'scheduled', pending: 1 });
  });

  it('Twice Daily: two requests, each repeated daily by the OS at its own time (09:00 and 21:00 by default), the same approved copy, both opening the emotion list', async () => {
    for (const locale of ['en', 'ar'] as const) {
      os.pending.clear();
      const result = await makeScheduler().reconcile({ preferences: twiceDaily(), locale });
      expect(ids(checkIn)).toEqual(['quranheals.checkin.twice.evening', 'quranheals.checkin.twice.morning']);
      expect(os.pending.get('quranheals.checkin.twice.morning')!.trigger).toEqual({ type: 'daily', hour: 9, minute: 0 });
      expect(os.pending.get('quranheals.checkin.twice.evening')!.trigger).toEqual({ type: 'daily', hour: 21, minute: 0 });
      const copy = locale === 'en'
        ? { title: 'You Deserve Peace \u2764\uFE0F', body: "Whatever you're feeling, there's something in the Quran that speaks to your heart." }
        : { title: 'تستحق السكينة \u2764\uFE0F', body: 'مهما كان شعورك، في القرآن ما يلامس قلبك.' };
      for (const id of ids(checkIn)) {
        expect(os.pending.get(id)!.content, `${locale} ${id}`).toMatchObject(copy);
        expect(parseNotificationPayload(os.pending.get(id)!.content.data)).toEqual({ kind: 'emotionCheckIn' });
      }
      expect(result.states.emotionCheckIn).toEqual({ state: 'scheduled', pending: 2 });
      // Two of the budget's slots, never any dated one: the Wird keeps its request, the Random Ayah the rest.
      expect(os.pending.size).toBe(PENDING_BUDGET);
      expect(ids('quranheals.ayah.')).toHaveLength(PENDING_BUDGET - 3);
    }
  });

  it('each time changes only its own request; the other one, the Wird and the Random Ayah are untouched', async () => {
    const scheduler = makeScheduler();
    const base = twiceDaily();
    await scheduler.reconcile({ preferences: base, locale: 'en' });
    const before = new Map([...os.pending].map(([id, r]) => [id, structuredClone(r)]));
    os.log = [];
    await scheduler.reconcile({ preferences: withCheckIn({ twiceTime: { slot: 'morning', time: { hour: 7, minute: 30 } } }, base), locale: 'en' });
    expect(os.log.filter((e) => e !== 'channels')).toEqual(['-quranheals.checkin.twice.morning', '+quranheals.checkin.twice.morning']);
    expect(os.pending.get('quranheals.checkin.twice.morning')!.trigger).toEqual({ type: 'daily', hour: 7, minute: 30 });
    for (const [id, request] of before) if (id !== 'quranheals.checkin.twice.morning') expect(os.pending.get(id), id).toEqual(request);
  });

  it('switching frequencies replaces only the Check-in requests — never a duplicate, never a stale one — and the times come back', async () => {
    const scheduler = makeScheduler();
    let p = twiceDaily();
    p = withCheckIn({ twiceTime: { slot: 'morning', time: { hour: 8, minute: 15 } } }, p);
    p = withCheckIn({ twiceTime: { slot: 'evening', time: { hour: 20, minute: 45 } } }, p);
    await scheduler.reconcile({ preferences: p, locale: 'en' });
    const others = () => [...os.pending.keys()].filter((id) => !id.startsWith(checkIn)).sort();
    for (const [frequency, expected] of [
      ['daily', ['quranheals.checkin.daily']],
      ['twiceDaily', ['quranheals.checkin.twice.evening', 'quranheals.checkin.twice.morning']],
      ['weekly', ['quranheals.checkin.weekly']],
      ['twiceDaily', ['quranheals.checkin.twice.evening', 'quranheals.checkin.twice.morning']],
      ['every3days', null],
      ['twiceDaily', ['quranheals.checkin.twice.evening', 'quranheals.checkin.twice.morning']],
    ] as const) {
      p = withCheckIn({ frequency }, p);
      await scheduler.reconcile({ preferences: p, locale: 'en' });
      const mine = ids(checkIn);
      if (expected) expect(mine, frequency).toEqual(expected);
      else expect(mine.every((id) => id.startsWith('quranheals.checkin.d.')) && mine.length > 0, frequency).toBe(true);
      expect(new Set(mine).size, frequency).toBe(mine.length);
      expect(os.pending.size, frequency).toBeLessThanOrEqual(PENDING_BUDGET);
      if (frequency === 'twiceDaily') {
        expect(os.pending.get('quranheals.checkin.twice.morning')!.trigger).toEqual({ type: 'daily', hour: 8, minute: 15 });
        expect(os.pending.get('quranheals.checkin.twice.evening')!.trigger).toEqual({ type: 'daily', hour: 20, minute: 45 });
      }
      expect(others().filter((id) => id.startsWith('quranheals.wird.'))).toEqual(['quranheals.wird.daily']);
    }
  });

  it('turning it off cancels both; on again restores both; permission revoked removes both; repeated runs change nothing', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: twiceDaily(), locale: 'en' });
    const off = withCheckIn({ enabled: false }, twiceDaily());
    const result = await scheduler.reconcile({ preferences: off, locale: 'en' });
    expect(ids(checkIn)).toEqual([]);
    expect(result.states.emotionCheckIn).toEqual({ state: 'off' });
    expect(ids('quranheals.wird.')).toEqual(['quranheals.wird.daily']);
    await scheduler.reconcile({ preferences: twiceDaily(), locale: 'en' });
    expect(ids(checkIn)).toEqual(['quranheals.checkin.twice.evening', 'quranheals.checkin.twice.morning']);
    os.log = [];
    for (let i = 0; i < 3; i++) await scheduler.reconcile({ preferences: twiceDaily(), locale: 'en' });
    expect(os.log.filter((e) => e !== 'channels')).toEqual([]);
    os.permission = { status: 'denied', canAskAgain: false };
    await scheduler.reconcile({ preferences: twiceDaily(), locale: 'en' });
    expect(os.pending.size).toBe(0);
  });

  it('a language change rewrites both, in place (same identifiers and times)', async () => {
    const scheduler = makeScheduler();
    await scheduler.reconcile({ preferences: twiceDaily(), locale: 'en' });
    await scheduler.reconcile({ preferences: twiceDaily(), locale: 'ar' });
    expect(ids(checkIn)).toEqual(['quranheals.checkin.twice.evening', 'quranheals.checkin.twice.morning']);
    for (const id of ids(checkIn)) expect(os.pending.get(id)!.content.title).toBe('تستحق السكينة \u2764\uFE0F');
  });

  it('equal times (never saved, but defended): one request, never the same reminder twice', async () => {
    const p = twiceDaily();
    const equal = { ...p, emotionCheckIn: { ...p.emotionCheckIn, twice: { morning: { hour: 21, minute: 0 }, evening: { hour: 21, minute: 0 } } } };
    await makeScheduler().reconcile({ preferences: equal, locale: 'en' });
    expect(ids(checkIn)).toEqual(['quranheals.checkin.twice.morning']);
    expect(os.pending.size).toBe(PENDING_BUDGET);
  });

  it('times around midnight and across a daylight-saving change: the OS-repeated daily triggers carry only the local hour and minute', async () => {
    let p = twiceDaily();
    p = withCheckIn({ twiceTime: { slot: 'morning', time: { hour: 0, minute: 5 } } }, p);
    p = withCheckIn({ twiceTime: { slot: 'evening', time: { hour: 23, minute: 55 } } }, p);
    now = new Date(2026, 10, 1, 1, 30); // America/New_York, the fall-back day
    await makeScheduler().reconcile({ preferences: p, locale: 'en' });
    expect(os.pending.get('quranheals.checkin.twice.morning')!.trigger).toEqual({ type: 'daily', hour: 0, minute: 5 });
    expect(os.pending.get('quranheals.checkin.twice.evening')!.trigger).toEqual({ type: 'daily', hour: 23, minute: 55 });
  });
});
