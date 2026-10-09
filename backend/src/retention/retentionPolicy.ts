/**
 * Approved retention periods (docs/data-retention.md) and the date rules
 * every cleanup uses. Pure: no I/O, no clock — callers pass `now`.
 *
 * Every deadline is computed so that a record is never removed early:
 * a record becomes eligible only once `now >= deadline`, and calendar
 * arithmetic that lands on a day the target month doesn't have (for
 * example 29 February plus one year) rolls FORWARD to the 1st of the next
 * month, never back. All dates are UTC.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Pending, expired, superseded, locked (or verified but never completed) deletion cases: 30 days after the code expired. */
export const UNCOMPLETED_CASE_RETENTION_DAYS = 30;
/** Completed deletion cases: 60 days after completion. */
export const COMPLETED_CASE_RETENTION_DAYS = 60;
/** Minimal deletion audit entries: 3 years. */
export const AUDIT_RETENTION_YEARS = 3;
/** Issue reports: 12 months from submission. */
export const ISSUE_REPORT_RETENTION_MONTHS = 12;
/** The longest single preservation hold; a hold can be renewed, never made indefinite. */
export const MAX_HOLD_DAYS = 365;

function daysInMonthUTC(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * `date` plus `months` calendar months, at the same UTC time of day. When
 * the target month is too short for the day (31 Jan + 1 month, 29 Feb + 12
 * months), the result is the 1st of the following month — later, never
 * earlier, than a naive clamp.
 */
export function addCalendarMonthsUTC(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = date.getUTCDate();
  const timeOfDay = date.getTime() - Date.UTC(year, date.getUTCMonth(), day);
  if (day > daysInMonthUTC(targetYear, targetMonth)) {
    return new Date(Date.UTC(targetYear, targetMonth + 1, 1) + timeOfDay);
  }
  return new Date(Date.UTC(targetYear, targetMonth, day) + timeOfDay);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Parses an ISO timestamp; null when missing or invalid, so callers can refuse to remove what they cannot date. */
export function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isDue(deadline: Date, now: Date): boolean {
  return now.getTime() >= deadline.getTime();
}

export function issueReportDeadline(createdAt: Date): Date {
  return addCalendarMonthsUTC(createdAt, ISSUE_REPORT_RETENTION_MONTHS);
}

export function auditEntryDeadline(at: Date): Date {
  return addCalendarMonthsUTC(at, AUDIT_RETENTION_YEARS * 12);
}

export function completedCaseDeadline(completedAt: Date): Date {
  return addDays(completedAt, COMPLETED_CASE_RETENTION_DAYS);
}

export function uncompletedCaseDeadline(codeExpiresAt: Date): Date {
  return addDays(codeExpiresAt, UNCOMPLETED_CASE_RETENTION_DAYS);
}
