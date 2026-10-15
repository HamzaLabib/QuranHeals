import AsyncStorage from '@react-native-async-storage/async-storage';

import { initialAnchor, parseCivilDate, weekdayOfDate } from './recurrence';
import {
  NOTIFICATION_KINDS,
  TWICE_DAILY_KINDS,
  WEEKDAYS,
  reminderFrequencies,
  type LocalTime,
  type NotificationKind,
  type NotificationPreferences,
  type ReminderFrequency,
  type ReminderPreference,
  type TwiceDailySlot,
  type TwiceDailyTimes,
  type Weekday,
} from './types';

/**
 * The three reminders' settings: a purely local device preference, like Keep
 * Screen Awake — never synced, never sent anywhere, the same for a guest and
 * every account on this device (the reminders themselves carry no account
 * data: see content.ts). One versioned key, the project's convention.
 *
 * Defaults (only for a field never saved — an explicit OFF, or any other
 * saved value, is kept for good):
 *  - Wird Reminder: ON, Daily, 21:00 (all of the user's أوراد: one reminder).
 *  - Random Quran Ayah: ON, Daily, 08:00 (the whole verified Quran).
 *  - Emotional Check-in (You Deserve Peace): ON, Daily, 21:00; Twice Daily, when chosen, 09:00 and 21:00. (Until
 *    2026-10-15 Every 3 days: an install that saved that keeps it — a saved value is never changed.)
 * ON here is only the wish: nothing is shown until the OS allows
 * notifications, and the app never asks for that on launch.
 */
export const NOTIFICATION_PREFERENCES_STORAGE_KEY = 'quran-heals:notification-preferences:v1';

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  wird: { enabled: true, frequency: 'daily', time: { hour: 21, minute: 0 }, weekday: null, anchor: null, twice: null },
  randomAyah: { enabled: true, frequency: 'daily', time: { hour: 8, minute: 0 }, weekday: null, anchor: null, twice: null },
  emotionCheckIn: { enabled: true, frequency: 'daily', time: { hour: 21, minute: 0 }, weekday: null, anchor: null, twice: { morning: { hour: 9, minute: 0 }, evening: { hour: 21, minute: 0 } } },
};

const sameTime = (a: LocalTime, b: LocalTime) => a.hour === b.hour && a.minute === b.minute;

export function formatStoredTime(time: LocalTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export function parseStoredTime(value: unknown): LocalTime | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function isValidTime(time: unknown): time is LocalTime {
  if (!time || typeof time !== 'object') return false;
  const { hour, minute } = time as LocalTime;
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** A frequency this reminder offers (Twice Daily only where TWICE_DAILY_KINDS allows it). */
function isFrequency(value: unknown, kind: NotificationKind): value is ReminderFrequency {
  return typeof value === 'string' && (reminderFrequencies(kind) as readonly string[]).includes(value);
}

/** Two valid, different times; otherwise the default pair (a damaged or equal pair would schedule one reminder twice). */
function parseTwice(raw: unknown, fallback: TwiceDailyTimes | null): TwiceDailyTimes | null {
  if (!fallback) return null;
  const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const morning = parseStoredTime(entry.morning);
  const evening = parseStoredTime(entry.evening);
  if (!morning || !evening || sameTime(morning, evening)) return { morning: { ...fallback.morning }, evening: { ...fallback.evening } };
  return { morning, evening };
}

function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && (WEEKDAYS as readonly number[]).includes(value);
}

function parseOne(raw: unknown, fallback: ReminderPreference, kind: NotificationKind): ReminderPreference {
  if (!raw || typeof raw !== 'object') return { ...fallback, twice: parseTwice(null, fallback.twice) };
  const entry = raw as Record<string, unknown>;
  return {
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : fallback.enabled,
    frequency: isFrequency(entry.frequency, kind) ? entry.frequency : fallback.frequency,
    time: parseStoredTime(entry.time) ?? fallback.time,
    weekday: isWeekday(entry.weekday) ? entry.weekday : fallback.weekday,
    anchor: typeof entry.anchor === 'string' && parseCivilDate(entry.anchor) ? entry.anchor : fallback.anchor,
    twice: parseTwice(entry.twice, fallback.twice),
  };
}

/** Each field validated on its own: a damaged or missing field takes its default, every valid one is kept. Never throws. */
export function parseNotificationPreferences(raw: unknown): NotificationPreferences {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = {} as NotificationPreferences;
  for (const kind of NOTIFICATION_KINDS) result[kind] = parseOne(source[kind], DEFAULT_NOTIFICATION_PREFERENCES[kind], kind);
  return result;
}

function serialize(preferences: NotificationPreferences): string {
  const out: Record<string, unknown> = { schema: 1 };
  for (const kind of NOTIFICATION_KINDS) {
    const p = preferences[kind];
    out[kind] = {
      enabled: p.enabled, frequency: p.frequency, time: formatStoredTime(p.time), weekday: p.weekday, anchor: p.anchor,
      ...(TWICE_DAILY_KINDS.includes(kind) && p.twice ? { twice: { morning: formatStoredTime(p.twice.morning), evening: formatStoredTime(p.twice.evening) } } : {}),
    };
  }
  return JSON.stringify(out);
}

/** The stored settings (defaults where nothing valid is saved). Never throws. */
export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY);
    return raw === null ? parseNotificationPreferences(null) : parseNotificationPreferences(JSON.parse(raw));
  } catch {
    return parseNotificationPreferences(null);
  }
}

export async function saveNotificationPreferences(preferences: NotificationPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFICATION_PREFERENCES_STORAGE_KEY, serialize(preferences));
  } catch {
    // Non-fatal: the in-memory choice still applies this session.
  }
}

/**
 * Fills what the schedule needs and was never set — an every-3-days anchor,
 * a weekly weekday — once, so the first cycle is fixed and saved rather than
 * recomputed on every launch. Values already set are never changed.
 */
export function completeSchedules(preferences: NotificationPreferences, now: Date): { preferences: NotificationPreferences; changed: boolean } {
  let changed = false;
  const next = { ...preferences };
  for (const kind of NOTIFICATION_KINDS) {
    const p = preferences[kind];
    if (p.frequency === 'every3days' && p.anchor === null) {
      next[kind] = { ...p, anchor: initialAnchor(p.time, now) };
      changed = true;
    } else if (p.frequency === 'weekly' && p.weekday === null) {
      next[kind] = { ...p, weekday: weekdayOfDate(now) };
      changed = true;
    }
  }
  return { preferences: changed ? next : preferences, changed };
}

/** Whether `time` may be set as this Twice Daily slot: never the same as the other one (it would be one reminder twice). */
export function canSetTwiceTime(preference: ReminderPreference, slot: TwiceDailySlot, time: LocalTime): boolean {
  if (!preference.twice || !isValidTime(time)) return false;
  return !sameTime(time, preference.twice[slot === 'morning' ? 'evening' : 'morning']);
}

/** One reminder's settings after a change from Settings; the other two are returned untouched (the same objects). */
export function applyReminderChange(
  preferences: NotificationPreferences,
  kind: NotificationKind,
  change: { enabled?: boolean; frequency?: ReminderFrequency; time?: LocalTime; weekday?: Weekday; twiceTime?: { slot: TwiceDailySlot; time: LocalTime } },
  now: Date,
): NotificationPreferences {
  const current = preferences[kind];
  const next: ReminderPreference = { ...current };
  if (change.enabled !== undefined) next.enabled = change.enabled;
  if (change.time !== undefined && isValidTime(change.time)) next.time = { hour: change.time.hour, minute: change.time.minute };
  if (change.weekday !== undefined && isWeekday(change.weekday)) next.weekday = change.weekday;
  // One Twice Daily time at a time; the single time (`time`) is never touched by it. The same time as the other slot is refused.
  if (change.twiceTime !== undefined && current.twice && canSetTwiceTime(current, change.twiceTime.slot, change.twiceTime.time)) {
    const { slot, time } = change.twiceTime;
    next.twice = { ...current.twice, [slot]: { hour: time.hour, minute: time.minute } };
  }
  if (change.frequency !== undefined && isFrequency(change.frequency, kind) && change.frequency !== current.frequency) {
    next.frequency = change.frequency;
    // Choosing Every 3 days starts a new cycle from the next time it can occur; Weekly starts on today's weekday unless one was chosen before.
    if (change.frequency === 'every3days') next.anchor = initialAnchor(next.time, now);
    if (change.frequency === 'weekly' && next.weekday === null) next.weekday = weekdayOfDate(now);
  }
  return { ...preferences, [kind]: next };
}
