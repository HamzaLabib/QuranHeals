/**
 * The three local reminder types (Settings: Emotions → Emotional Check-in;
 * Quran → Wird Reminder and Random Quran Ayah). Each has its own switch,
 * frequency, time, weekday and every-3-days anchor; none is ever derived
 * from another. See docs/notifications.md.
 */
export type NotificationKind = 'wird' | 'randomAyah' | 'emotionCheckIn';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['wird', 'randomAyah', 'emotionCheckIn'];

/**
 * The choices: there is no "Auto" (the defaults are simply applied once, on first use). Twice Daily is the Emotional
 * Check-in's only (reminderFrequencies): the Wird Reminder and the Random Quran Ayah keep the first three.
 */
export type ReminderFrequency = 'daily' | 'every3days' | 'weekly' | 'twiceDaily';
export const REMINDER_FREQUENCIES: readonly ReminderFrequency[] = ['daily', 'every3days', 'weekly', 'twiceDaily'];

/** The reminders that offer Twice Daily. */
export const TWICE_DAILY_KINDS: readonly NotificationKind[] = ['emotionCheckIn'];

/** A reminder's frequencies, in the order Settings lists them: Twice Daily last, and only where it is offered. */
export function reminderFrequencies(kind: NotificationKind): readonly ReminderFrequency[] {
  return TWICE_DAILY_KINDS.includes(kind) ? REMINDER_FREQUENCIES : REMINDER_FREQUENCIES.filter((frequency) => frequency !== 'twiceDaily');
}

/** A local clock time, minutes after midnight (0–1439): the stored format is "HH:MM" (see preferences.ts). */
export type LocalTime = { hour: number; minute: number };

/** 1 = Sunday … 7 = Saturday, as expo-notifications' weekly trigger (and iOS's Calendar) numbers them. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** A local calendar date, "YYYY-MM-DD". */
export type CivilDate = string;

export type ReminderPreference = {
  /** The user's wish. Not OS permission and not "something is scheduled": see NotificationPermission and ReminderScheduleState. */
  enabled: boolean;
  frequency: ReminderFrequency;
  time: LocalTime;
  /** Weekly only; kept when another frequency is chosen so returning to Weekly restores it. Null until Weekly is first chosen. */
  weekday: Weekday | null;
  /** Every 3 days only: the first local date of the cycle; occurrences fall on this date + 3k days. Kept like `weekday`. */
  anchor: CivilDate | null;
  /**
   * Twice Daily only (TWICE_DAILY_KINDS; null for the other reminders): its two times, never the same, each edited on
   * its own. Kept when another frequency is chosen, like `weekday`, and separate from `time`, so neither overwrites the
   * other.
   */
  twice: TwiceDailyTimes | null;
};

export type TwiceDailyTimes = { morning: LocalTime; evening: LocalTime };
export type TwiceDailySlot = keyof TwiceDailyTimes;

export type NotificationPreferences = Record<NotificationKind, ReminderPreference>;

/** Operating-system authorization, kept apart from the user's wish (ReminderPreference.enabled). */
export type NotificationPermission = {
  status: 'granted' | 'denied' | 'undetermined' | 'unsupported';
  /** False once the OS will no longer show its prompt (iOS after one answer, Android 13+ after two denials): only device Settings can change it. */
  canAskAgain: boolean;
};

/**
 * What is actually registered with the OS for one type after the last reconciliation:
 * 'scheduled' (with how many pending entries), 'off' (the user turned it off),
 * 'needsPermission' (wanted, but the OS does not allow notifications),
 * 'unsupported' (web), 'error' (the last attempt failed; retried on the next foreground).
 */
export type ReminderScheduleState =
  | { state: 'scheduled'; pending: number }
  | { state: 'off' }
  | { state: 'needsPermission' }
  | { state: 'unsupported' }
  | { state: 'error' };
