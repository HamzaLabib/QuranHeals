import type { CivilDate, LocalTime, ReminderPreference, Weekday } from './types';

/**
 * The reminder calendar, in the device's local time (its current time zone).
 * Pure and deterministic: every function takes `now` and returns local
 * instants built from calendar fields (`new Date(y, m, d, hour, minute)`),
 * never from adding hours to a timestamp — so "every 3 days at 21:00" stays
 * at 21:00 across daylight-saving changes, month ends and year ends.
 *
 *  - Daily: every local calendar day at `time`.
 *  - Weekly: every `weekday` (1 = Sunday … 7 = Saturday) at `time`.
 *  - Every 3 days: the local dates `anchor`, anchor + 3, anchor + 6, … (counted
 *    in calendar days, not 72-hour periods) at `time`. The anchor is set when
 *    the frequency is chosen (initialAnchor: today if the time is still
 *    ahead, otherwise tomorrow) and then kept: changing only the time keeps
 *    the same days; choosing Every 3 days again starts a new cycle.
 *
 * DST policy (the ECMAScript local-time rules, identical on Hermes and V8):
 *  - a time that does not exist on a spring-forward day (e.g. 02:30 when
 *    clocks jump 02:00 → 03:00) is delivered that day, shifted forward by the
 *    gap (03:30);
 *  - a time that happens twice on a fall-back day (e.g. 01:30) is delivered
 *    once, at its first (earlier) occurrence.
 *
 * A time zone change is picked up the next time the schedule is reconciled
 * (launch or return to the app): dated reminders are rebuilt in the new
 * zone. Daily and Weekly reminders that the OS repeats itself already follow
 * the device's current local time.
 */

const MS_PER_DAY = 86_400_000;

type CivilFields = { year: number; month: number; day: number };

export function civilDateOf(date: Date): CivilDate {
  return formatCivil({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

function formatCivil({ year, month, day }: CivilFields): CivilDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → its fields, or null for anything that is not a real calendar date. */
export function parseCivilDate(value: unknown): CivilFields | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** A calendar-day count (no time zone, no DST): consecutive dates differ by exactly 1. */
function dayNumber({ year, month, day }: CivilFields): number {
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

function fromDayNumber(n: number): CivilFields {
  const date = new Date(n * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** 1 = Sunday … 7 = Saturday. */
function weekdayOf(fields: CivilFields): Weekday {
  return (new Date(Date.UTC(fields.year, fields.month - 1, fields.day)).getUTCDay() + 1) as Weekday;
}

/** The local instant of `time` on a date (see the DST policy above). */
export function localInstant(fields: CivilFields, time: LocalTime): Date {
  return new Date(fields.year, fields.month - 1, fields.day, time.hour, time.minute, 0, 0);
}

/** Today's weekday on this device (the default when Weekly is first chosen). */
export function weekdayOfDate(date: Date): Weekday {
  return (date.getDay() + 1) as Weekday;
}

/** The first date of a new every-3-days cycle: today if `time` is still ahead today, otherwise tomorrow. */
export function initialAnchor(time: LocalTime, now: Date): CivilDate {
  const today = parseCivilDate(civilDateOf(now))!;
  const first = localInstant(today, time).getTime() > now.getTime() ? today : fromDayNumber(dayNumber(today) + 1);
  return formatCivil(first);
}

export type Occurrence = { date: CivilDate; at: Date };

/**
 * The next `count` occurrences strictly after `now`, oldest first. Every 3
 * days without a valid anchor falls back to a fresh one (initialAnchor), so a
 * damaged stored value never stops a reminder.
 */
export function nextOccurrences(preference: Pick<ReminderPreference, 'frequency' | 'time' | 'weekday' | 'anchor'>, now: Date, count: number): Occurrence[] {
  const result: Occurrence[] = [];
  if (count <= 0) return result;
  const today = dayNumber(parseCivilDate(civilDateOf(now))!);
  const anchor = preference.frequency === 'every3days'
    ? dayNumber(parseCivilDate(preference.anchor) ?? parseCivilDate(initialAnchor(preference.time, now))!)
    : 0;
  const weekday = preference.weekday ?? weekdayOfDate(now);
  // Bounded: at most one match every 7 days, plus today.
  const lastDay = today + count * 7 + 7;
  for (let n = today; n <= lastDay && result.length < count; n += 1) {
    const fields = fromDayNumber(n);
    if (preference.frequency === 'weekly' && weekdayOf(fields) !== weekday) continue;
    if (preference.frequency === 'every3days' && (n < anchor || (n - anchor) % 3 !== 0)) continue;
    const at = localInstant(fields, preference.time);
    if (at.getTime() <= now.getTime()) continue;
    result.push({ date: formatCivil(fields), at });
  }
  return result;
}
