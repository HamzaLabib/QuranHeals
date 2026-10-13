import { describe, expect, it } from 'vitest';

import { UMM_AL_QURA_RAMADAN } from '@/mushaf/generated/ummAlQuraRamadan';
import { classifyRamadan, localCivilDate } from '@/mushaf/ramadan';

/** Ramadan classification of a completed Khatma: Umm al-Qura, by the device's local civil date. */

const umalqura = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', timeZone: 'UTC' });
const icuMonth = (iso: string) => {
  const parts = Object.fromEntries(umalqura.formatToParts(Date.parse(`${iso}T12:00:00Z`)).map((p) => [p.type, p.value]));
  return { year: Number.parseInt(parts.year, 10), month: Number.parseInt(parts.month, 10) };
};

describe('the Umm al-Qura table', () => {
  it('covers 1400–1500 AH in order, each Ramadan 29 or 30 days', () => {
    expect(UMM_AL_QURA_RAMADAN[0][0]).toBe(1400);
    expect(UMM_AL_QURA_RAMADAN.at(-1)![0]).toBe(1500);
    UMM_AL_QURA_RAMADAN.forEach(([year, start, end], i) => {
      if (i > 0) expect(year).toBe(UMM_AL_QURA_RAMADAN[i - 1][0] + 1);
      const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
      expect([29, 30]).toContain(days);
    });
  });

  it('agrees with ICU`s islamic-umalqura calendar on every day from 1980 to 2077', () => {
    let mismatches = 0;
    for (let t = Date.UTC(1980, 7, 1); t <= Date.UTC(2077, 7, 1); t += 86_400_000) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const icu = icuMonth(iso);
      const ours = classifyRamadan(iso);
      if (ours.ramadan !== (icu.month === 9) || (ours.ramadan && ours.hijriYear !== icu.year)) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });
});

describe('classifying a completion date', () => {
  it.each([
    ['2025-02-28', false, null], // 30 Shaʿbān 1446
    ['2025-03-01', true, 1446], // 1 Ramaḍān
    ['2025-03-29', true, 1446], // last day
    ['2025-03-30', false, null], // ʿĪd al-Fiṭr
    ['2027-02-07', false, null],
    ['2027-02-08', true, 1448],
    ['2027-03-08', true, 1448],
    ['2027-03-09', false, null],
    ['2030-12-26', true, 1452], // a Ramadan spanning the Gregorian new year
    ['2031-01-01', true, 1452],
    ['2026-07-15', false, null],
  ])('%s → ramadan %s', (date, ramadan, year) => {
    expect(classifyRamadan(date)).toEqual({ ramadan, hijriYear: year });
  });

  it('dates outside the table, or malformed, are not Ramadan', () => {
    expect(classifyRamadan('1970-01-01')).toEqual({ ramadan: false, hijriYear: null });
    expect(classifyRamadan('2099-01-01')).toEqual({ ramadan: false, hijriYear: null });
    expect(classifyRamadan('yesterday')).toEqual({ ramadan: false, hijriYear: null });
  });

  it('uses the LOCAL civil date, not UTC: late evening and early morning stay on their own local day', () => {
    // Built from local fields, so this holds in whatever time zone the tests run.
    expect(localCivilDate(new Date(2025, 1, 28, 23, 59))).toBe('2025-02-28');
    expect(localCivilDate(new Date(2025, 2, 1, 0, 1))).toBe('2025-03-01');
    expect(classifyRamadan(localCivilDate(new Date(2025, 1, 28, 23, 59))).ramadan).toBe(false);
    expect(classifyRamadan(localCivilDate(new Date(2025, 2, 1, 0, 1))).ramadan).toBe(true);
    expect(classifyRamadan(localCivilDate(new Date(2025, 2, 29, 23, 59))).ramadan).toBe(true);
    expect(classifyRamadan(localCivilDate(new Date(2025, 2, 30, 0, 0))).ramadan).toBe(false);
  });
});
