import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ storage: new Map<string, string>(), fail: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => { if (state.fail) throw new Error('unavailable'); return state.storage.get(key) ?? null; },
    setItem: async (key: string, value: string) => { if (state.fail) throw new Error('unavailable'); state.storage.set(key, value); },
  },
}));

const {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCES_STORAGE_KEY,
  applyReminderChange,
  canSetTwiceTime,
  completeSchedules,
  loadNotificationPreferences,
  parseNotificationPreferences,
  saveNotificationPreferences,
} = await import('@/notifications/preferences');
const { NOTIFICATION_KINDS, REMINDER_FREQUENCIES, reminderFrequencies } = await import('@/notifications/types');

beforeEach(() => {
  state.storage.clear();
  state.fail = false;
});

const noon = new Date(2026, 9, 14, 12, 0);

describe('Defaults (only when nothing is saved)', () => {
  it('exactly three reminders: Wird Daily 21:00, Random Ayah Daily 08:00, You Deserve Peace (the Check-in) Daily 21:00 — all ON; its Twice Daily times 09:00 and 21:00', async () => {
    expect(NOTIFICATION_KINDS).toEqual(['wird', 'randomAyah', 'emotionCheckIn']);
    expect(await loadNotificationPreferences()).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      wird: { enabled: true, frequency: 'daily', time: { hour: 21, minute: 0 }, weekday: null, anchor: null, twice: null },
      randomAyah: { enabled: true, frequency: 'daily', time: { hour: 8, minute: 0 }, weekday: null, anchor: null, twice: null },
      emotionCheckIn: { enabled: true, frequency: 'daily', time: { hour: 21, minute: 0 }, weekday: null, anchor: null, twice: { morning: { hour: 9, minute: 0 }, evening: { hour: 21, minute: 0 } } },
    });
  });

  it('the frequencies, no Auto: Daily, Every 3 days, Weekly, then Twice Daily last — Twice Daily for the Check-in only', () => {
    expect(REMINDER_FREQUENCIES).toEqual(['daily', 'every3days', 'weekly', 'twiceDaily']);
    expect(reminderFrequencies('emotionCheckIn')).toEqual(['daily', 'every3days', 'weekly', 'twiceDaily']);
    expect(reminderFrequencies('wird')).toEqual(['daily', 'every3days', 'weekly']);
    expect(reminderFrequencies('randomAyah')).toEqual(['daily', 'every3days', 'weekly']);
  });

  it('an unreadable store means the defaults, never a throw', async () => {
    state.fail = true;
    await expect(loadNotificationPreferences()).resolves.toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    await expect(saveNotificationPreferences(DEFAULT_NOTIFICATION_PREFERENCES)).resolves.toBeUndefined();
  });
});

describe('Saved choices win, field by field', () => {
  it('an explicit OFF is kept (never treated as missing), with its frequency, time and weekday', async () => {
    const saved = applyReminderChange(DEFAULT_NOTIFICATION_PREFERENCES, 'wird', { enabled: false }, noon);
    const weekly = applyReminderChange(saved, 'randomAyah', { frequency: 'weekly', time: { hour: 6, minute: 45 }, weekday: 6 }, noon);
    await saveNotificationPreferences(weekly);
    const loaded = await loadNotificationPreferences();
    expect(loaded.wird.enabled).toBe(false);
    expect(loaded.randomAyah).toMatchObject({ enabled: true, frequency: 'weekly', time: { hour: 6, minute: 45 }, weekday: 6 });
    expect(JSON.parse(state.storage.get(NOTIFICATION_PREFERENCES_STORAGE_KEY)!).randomAyah.time).toBe('06:45');
  });

  it('a damaged field takes its default while every valid field is kept', () => {
    const parsed = parseNotificationPreferences({
      wird: { enabled: false, frequency: 'auto', time: '25:00', weekday: 9, anchor: '2026-02-30' },
      randomAyah: 'garbage',
      emotionCheckIn: { enabled: false, frequency: 'weekly', time: '07:05', weekday: 2, anchor: '2026-10-14' },
    });
    expect(parsed.wird).toEqual({ ...DEFAULT_NOTIFICATION_PREFERENCES.wird, enabled: false });
    expect(parsed.randomAyah).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.randomAyah);
    expect(parsed.emotionCheckIn).toEqual({ enabled: false, frequency: 'weekly', time: { hour: 7, minute: 5 }, weekday: 2, anchor: '2026-10-14', twice: DEFAULT_NOTIFICATION_PREFERENCES.emotionCheckIn.twice });
  });

  it('an install that saved the previous default (Every 3 days, before Twice Daily existed) keeps it exactly: never moved to Daily', async () => {
    // What the previous release stored on its first launch: no `twice` field yet.
    state.storage.set(NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify({
      schema: 1,
      wird: { enabled: true, frequency: 'daily', time: '21:00', weekday: null, anchor: null },
      randomAyah: { enabled: true, frequency: 'daily', time: '08:00', weekday: null, anchor: null },
      emotionCheckIn: { enabled: true, frequency: 'every3days', time: '21:00', weekday: null, anchor: '2026-10-14' },
    }));
    const loaded = await loadNotificationPreferences();
    expect(loaded.emotionCheckIn).toEqual({ enabled: true, frequency: 'every3days', time: { hour: 21, minute: 0 }, weekday: null, anchor: '2026-10-14', twice: { morning: { hour: 9, minute: 0 }, evening: { hour: 21, minute: 0 } } });
    expect(completeSchedules(loaded, noon).changed).toBe(false); // nothing to fill, nothing rewritten
    // Saved OFF, other times and Weekly are kept the same way.
    state.storage.set(NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify({ schema: 1, emotionCheckIn: { enabled: false, frequency: 'weekly', time: '19:30', weekday: 6, anchor: null } }));
    expect((await loadNotificationPreferences()).emotionCheckIn).toMatchObject({ enabled: false, frequency: 'weekly', time: { hour: 19, minute: 30 }, weekday: 6 });
  });

  it('Twice Daily is never accepted for the Wird or the Random Ayah (stored or chosen): their saved frequency stays', () => {
    const parsed = parseNotificationPreferences({ wird: { frequency: 'twiceDaily' }, randomAyah: { frequency: 'twiceDaily', twice: { morning: '07:00', evening: '20:00' } } });
    expect(parsed.wird).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.wird);
    expect(parsed.randomAyah).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.randomAyah);
    expect(applyReminderChange(DEFAULT_NOTIFICATION_PREFERENCES, 'wird', { frequency: 'twiceDaily' }, noon).wird).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.wird);
    expect(applyReminderChange(DEFAULT_NOTIFICATION_PREFERENCES, 'randomAyah', { twiceTime: { slot: 'morning', time: { hour: 6, minute: 0 } } }, noon).randomAyah).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.randomAyah);
  });
});

describe('Twice Daily (You Deserve Peace)', () => {
  const twice = (p = DEFAULT_NOTIFICATION_PREFERENCES) => applyReminderChange(p, 'emotionCheckIn', { frequency: 'twiceDaily' }, noon);

  it('chosen: 09:00 and 21:00 by default; each time changes on its own, and the single time is never touched', () => {
    const chosen = twice();
    expect(chosen.emotionCheckIn).toMatchObject({ frequency: 'twiceDaily', time: { hour: 21, minute: 0 }, twice: { morning: { hour: 9, minute: 0 }, evening: { hour: 21, minute: 0 } } });
    const morning = applyReminderChange(chosen, 'emotionCheckIn', { twiceTime: { slot: 'morning', time: { hour: 7, minute: 30 } } }, noon);
    expect(morning.emotionCheckIn.twice).toEqual({ morning: { hour: 7, minute: 30 }, evening: { hour: 21, minute: 0 } });
    const evening = applyReminderChange(morning, 'emotionCheckIn', { twiceTime: { slot: 'evening', time: { hour: 22, minute: 15 } } }, noon);
    expect(evening.emotionCheckIn.twice).toEqual({ morning: { hour: 7, minute: 30 }, evening: { hour: 22, minute: 15 } });
    expect(evening.emotionCheckIn.time).toEqual({ hour: 21, minute: 0 });
    // The other reminders are the very same objects.
    expect(evening.wird).toBe(DEFAULT_NOTIFICATION_PREFERENCES.wird);
    expect(evening.randomAyah).toBe(DEFAULT_NOTIFICATION_PREFERENCES.randomAyah);
  });

  it('the same time for both is refused (it would be one reminder twice); an invalid time too', () => {
    const chosen = twice();
    expect(canSetTwiceTime(chosen.emotionCheckIn, 'morning', { hour: 21, minute: 0 })).toBe(false);
    expect(canSetTwiceTime(chosen.emotionCheckIn, 'evening', { hour: 9, minute: 0 })).toBe(false);
    expect(canSetTwiceTime(chosen.emotionCheckIn, 'morning', { hour: 8, minute: 0 })).toBe(true);
    expect(applyReminderChange(chosen, 'emotionCheckIn', { twiceTime: { slot: 'morning', time: { hour: 21, minute: 0 } } }, noon).emotionCheckIn).toEqual(chosen.emotionCheckIn);
    expect(applyReminderChange(chosen, 'emotionCheckIn', { twiceTime: { slot: 'evening', time: { hour: 25, minute: 0 } } }, noon).emotionCheckIn).toEqual(chosen.emotionCheckIn);
    // A stored pair that is equal or damaged takes the default pair, never one reminder twice.
    expect(parseNotificationPreferences({ emotionCheckIn: { frequency: 'twiceDaily', twice: { morning: '10:00', evening: '10:00' } } }).emotionCheckIn.twice).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.emotionCheckIn.twice);
    expect(parseNotificationPreferences({ emotionCheckIn: { frequency: 'twiceDaily', twice: { morning: '7:00' } } }).emotionCheckIn.twice).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.emotionCheckIn.twice);
  });

  it('switching away and back keeps both times; changing the single time while away never changes them', () => {
    const edited = applyReminderChange(applyReminderChange(twice(), 'emotionCheckIn', { twiceTime: { slot: 'morning', time: { hour: 6, minute: 45 } } }, noon), 'emotionCheckIn', { twiceTime: { slot: 'evening', time: { hour: 20, minute: 10 } } }, noon);
    for (const frequency of ['daily', 'every3days', 'weekly'] as const) {
      const away = applyReminderChange(edited, 'emotionCheckIn', { frequency }, noon);
      const retimed = applyReminderChange(away, 'emotionCheckIn', { time: { hour: 18, minute: 0 } }, noon);
      expect(retimed.emotionCheckIn.time, frequency).toEqual({ hour: 18, minute: 0 });
      const back = applyReminderChange(retimed, 'emotionCheckIn', { frequency: 'twiceDaily' }, noon);
      expect(back.emotionCheckIn.twice, frequency).toEqual({ morning: { hour: 6, minute: 45 }, evening: { hour: 20, minute: 10 } });
      expect(back.emotionCheckIn.time, frequency).toEqual({ hour: 18, minute: 0 });
    }
  });

  it('both times are saved and restored after a restart (the stored "HH:MM" pair), with the frequency, switch and single time', async () => {
    const edited = applyReminderChange(applyReminderChange(twice(), 'emotionCheckIn', { twiceTime: { slot: 'morning', time: { hour: 6, minute: 5 } } }, noon), 'emotionCheckIn', { twiceTime: { slot: 'evening', time: { hour: 23, minute: 55 } } }, noon);
    await saveNotificationPreferences(edited);
    const stored = JSON.parse(state.storage.get(NOTIFICATION_PREFERENCES_STORAGE_KEY)!);
    expect(stored.emotionCheckIn.twice).toEqual({ morning: '06:05', evening: '23:55' });
    expect(stored.wird.twice).toBeUndefined(); // only where Twice Daily exists
    vi.resetModules();
    const fresh = await import('@/notifications/preferences');
    expect((await fresh.loadNotificationPreferences()).emotionCheckIn).toEqual(edited.emotionCheckIn);
  });
});

describe('Schedule fields', () => {
  it('completeSchedules fixes an Every-3-days anchor once, and never changes one already set', () => {
    // An Every-3-days Check-in without its cycle yet (the previous default, as first loaded).
    const every3 = { ...DEFAULT_NOTIFICATION_PREFERENCES, emotionCheckIn: { ...DEFAULT_NOTIFICATION_PREFERENCES.emotionCheckIn, frequency: 'every3days' as const } };
    expect(completeSchedules(DEFAULT_NOTIFICATION_PREFERENCES, noon).changed).toBe(false); // the defaults need nothing filled
    const first = completeSchedules(every3, noon);
    expect(first.changed).toBe(true);
    expect(first.preferences.emotionCheckIn.anchor).toBe('2026-10-14');
    expect(first.preferences.wird).toBe(DEFAULT_NOTIFICATION_PREFERENCES.wird);
    const again = completeSchedules(first.preferences, new Date(2026, 9, 20));
    expect(again.changed).toBe(false);
    expect(again.preferences.emotionCheckIn.anchor).toBe('2026-10-14');
  });

  it('choosing Every 3 days starts a new cycle at the next possible time; changing only the time keeps the cycle', () => {
    const late = new Date(2026, 9, 14, 22, 0);
    const chosen = applyReminderChange(DEFAULT_NOTIFICATION_PREFERENCES, 'wird', { frequency: 'every3days' }, late);
    expect(chosen.wird.anchor).toBe('2026-10-15');
    const retimed = applyReminderChange(chosen, 'wird', { time: { hour: 6, minute: 0 } }, new Date(2026, 9, 16));
    expect(retimed.wird.anchor).toBe('2026-10-15');
  });

  it('choosing Weekly starts on today\'s weekday unless one was chosen before; returning keeps the earlier weekday', () => {
    const weekly = applyReminderChange(DEFAULT_NOTIFICATION_PREFERENCES, 'wird', { frequency: 'weekly' }, noon); // Wednesday
    expect(weekly.wird.weekday).toBe(4);
    const sunday = applyReminderChange(weekly, 'wird', { weekday: 1 }, noon);
    const daily = applyReminderChange(sunday, 'wird', { frequency: 'daily' }, noon);
    expect(daily.wird).toMatchObject({ frequency: 'daily', weekday: 1 });
    expect(applyReminderChange(daily, 'wird', { frequency: 'weekly' }, noon).wird.weekday).toBe(1);
  });

  it('a change touches only its own reminder (the other two are the very same objects)', () => {
    const next = applyReminderChange(DEFAULT_NOTIFICATION_PREFERENCES, 'randomAyah', { time: { hour: 7, minute: 15 } }, noon);
    expect(next.wird).toBe(DEFAULT_NOTIFICATION_PREFERENCES.wird);
    expect(next.emotionCheckIn).toBe(DEFAULT_NOTIFICATION_PREFERENCES.emotionCheckIn);
    expect(next.randomAyah.time).toEqual({ hour: 7, minute: 15 });
  });

  it('invalid times and weekdays are ignored', () => {
    const next = applyReminderChange(DEFAULT_NOTIFICATION_PREFERENCES, 'wird', { time: { hour: 24, minute: 0 }, weekday: 8 as never }, noon);
    expect(next.wird).toEqual(DEFAULT_NOTIFICATION_PREFERENCES.wird);
  });
});
