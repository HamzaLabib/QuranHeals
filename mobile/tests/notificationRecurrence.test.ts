import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { civilDateOf, initialAnchor, nextOccurrences, parseCivilDate } from '@/notifications/recurrence';
import type { ReminderPreference } from '@/notifications/types';

/**
 * The reminder calendar (notifications/recurrence.ts), in a time zone with
 * daylight saving (America/New_York: 2026-03-08 02:00 → 03:00, 2026-11-01
 * 02:00 → 01:00) so DST is exercised for real, not mocked.
 */
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { process.env.TZ = originalTz; });

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const pref = (p: Partial<ReminderPreference>): ReminderPreference => ({ enabled: true, frequency: 'daily', time: { hour: 21, minute: 0 }, weekday: null, anchor: null, twice: null, ...p });
const dates = (list: { date: string }[]) => list.map((o) => o.date);

describe('Daily', () => {
  it('every calendar day at the chosen local time, starting today when the time is still ahead', () => {
    const list = nextOccurrences(pref({}), at(2026, 10, 14, 12), 3);
    expect(dates(list)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16']);
    for (const o of list) expect([o.at.getHours(), o.at.getMinutes()]).toEqual([21, 0]);
  });

  it('starts tomorrow once today\'s time has passed (strictly after now)', () => {
    expect(dates(nextOccurrences(pref({}), at(2026, 10, 14, 21, 0), 1))).toEqual(['2026-10-15']);
    expect(dates(nextOccurrences(pref({}), at(2026, 10, 14, 20, 59), 1))).toEqual(['2026-10-14']);
  });

  it('crosses month and year ends', () => {
    expect(dates(nextOccurrences(pref({}), at(2026, 12, 30, 22), 3))).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
    expect(dates(nextOccurrences(pref({}), at(2028, 2, 28, 22), 2))).toEqual(['2028-02-29', '2028-03-01']);
  });
});

describe('Every 3 days', () => {
  it('every third calendar day from the stored anchor, at the local time', () => {
    const list = nextOccurrences(pref({ frequency: 'every3days', anchor: '2026-10-14' }), at(2026, 10, 14, 12), 4);
    expect(dates(list)).toEqual(['2026-10-14', '2026-10-17', '2026-10-20', '2026-10-23']);
  });

  it('keeps the same cycle days whatever day it is asked (a stable anchor), across month and year ends', () => {
    const p = pref({ frequency: 'every3days', anchor: '2026-12-27' });
    expect(dates(nextOccurrences(p, at(2026, 12, 29), 3))).toEqual(['2026-12-30', '2027-01-02', '2027-01-05']);
    expect(dates(nextOccurrences(p, at(2027, 1, 2, 22), 1))).toEqual(['2027-01-05']);
  });

  it('stays at 21:00 local across the spring-forward and fall-back days (not a 72-hour interval)', () => {
    const spring = nextOccurrences(pref({ frequency: 'every3days', anchor: '2026-03-06' }), at(2026, 3, 5), 3);
    expect(dates(spring)).toEqual(['2026-03-06', '2026-03-09', '2026-03-12']);
    for (const o of spring) expect(o.at.getHours()).toBe(21);
    // 72 calendar hours minus the lost hour.
    expect(spring[1].at.getTime() - spring[0].at.getTime()).toBe(71 * 3600_000);
    const fall = nextOccurrences(pref({ frequency: 'every3days', anchor: '2026-10-30' }), at(2026, 10, 29), 2);
    expect(dates(fall)).toEqual(['2026-10-30', '2026-11-02']);
    for (const o of fall) expect(o.at.getHours()).toBe(21);
    expect(fall[1].at.getTime() - fall[0].at.getTime()).toBe(73 * 3600_000);
  });

  it('a damaged anchor never stops the reminder: a fresh cycle starts from the next possible time', () => {
    const list = nextOccurrences(pref({ frequency: 'every3days', anchor: 'not-a-date' }), at(2026, 10, 14, 22), 2);
    expect(dates(list)).toEqual(['2026-10-15', '2026-10-18']);
  });

  it('initialAnchor: today when the time is still ahead, otherwise tomorrow', () => {
    expect(initialAnchor({ hour: 21, minute: 0 }, at(2026, 10, 14, 20))).toBe('2026-10-14');
    expect(initialAnchor({ hour: 21, minute: 0 }, at(2026, 10, 14, 21))).toBe('2026-10-15');
    expect(initialAnchor({ hour: 8, minute: 0 }, at(2026, 12, 31, 9))).toBe('2027-01-01');
  });
});

describe('Weekly', () => {
  it('only on the chosen weekday (1 = Sunday … 7 = Saturday)', () => {
    // 2026-10-14 is a Wednesday.
    const sunday = nextOccurrences(pref({ frequency: 'weekly', weekday: 1 }), at(2026, 10, 14), 3);
    expect(dates(sunday)).toEqual(['2026-10-18', '2026-10-25', '2026-11-01']);
    for (const o of sunday) expect([o.at.getDay(), o.at.getHours()]).toEqual([0, 21]);
    expect(dates(nextOccurrences(pref({ frequency: 'weekly', weekday: 4 }), at(2026, 10, 14, 12), 1))).toEqual(['2026-10-14']);
    expect(dates(nextOccurrences(pref({ frequency: 'weekly', weekday: 4 }), at(2026, 10, 14, 22), 1))).toEqual(['2026-10-21']);
  });

  it('changing the weekday moves only the day', () => {
    expect(dates(nextOccurrences(pref({ frequency: 'weekly', weekday: 6 }), at(2026, 10, 14), 2))).toEqual(['2026-10-16', '2026-10-23']);
  });
});

describe('DST policy for times that do not exist or happen twice', () => {
  it('a nonexistent 02:30 on the spring-forward day is delivered that day, shifted forward by the gap (03:30)', () => {
    const [o] = nextOccurrences(pref({ time: { hour: 2, minute: 30 } }), at(2026, 3, 8, 0), 1);
    expect(o.date).toBe('2026-03-08');
    expect([o.at.getHours(), o.at.getMinutes()]).toEqual([3, 30]);
  });

  it('a repeated 01:30 on the fall-back day is delivered once, at its first (earlier, daylight-time) occurrence', () => {
    const list = nextOccurrences(pref({ time: { hour: 1, minute: 30 } }), at(2026, 11, 1, 0), 2);
    expect(dates(list)).toEqual(['2026-11-01', '2026-11-02']);
    // 05:30 UTC = 01:30 EDT (the first 01:30), not 06:30 UTC (EST).
    expect(list[0].at.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});

describe('Time zone change', () => {
  it('the same settings computed in a new zone give the same local clock time there', () => {
    const before = nextOccurrences(pref({}), at(2026, 10, 14, 12), 1)[0];
    process.env.TZ = 'Asia/Riyadh';
    try {
      const after = nextOccurrences(pref({}), new Date(2026, 9, 14, 12), 1)[0];
      expect(after.at.getHours()).toBe(21);
      expect(after.at.getTime()).not.toBe(before.at.getTime());
    } finally {
      process.env.TZ = 'America/New_York';
    }
  });
});

describe('Civil dates', () => {
  it('formats and validates YYYY-MM-DD strictly', () => {
    expect(civilDateOf(at(2026, 1, 5))).toBe('2026-01-05');
    expect(parseCivilDate('2026-02-29')).toBeNull();
    expect(parseCivilDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseCivilDate('2026-13-01')).toBeNull();
    expect(parseCivilDate(20261014)).toBeNull();
  });
});
