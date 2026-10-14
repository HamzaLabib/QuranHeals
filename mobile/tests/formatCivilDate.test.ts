import { afterEach, describe, expect, it } from 'vitest';

import { formatCivilDate } from '@/utils/formatDate';

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe('formatCivilDate (a Khatma record`s stored localDate)', () => {
  it('shows the stored calendar day in every time zone, never the day before or after', () => {
    for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Riyadh', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      expect(formatCivilDate('2026-10-13', 'en')).toBe('Oct 13, 2026');
      expect(formatCivilDate('2026-01-01', 'en')).toBe('Jan 1, 2026');
      expect(formatCivilDate('2026-12-31', 'en')).toBe('Dec 31, 2026');
      // Arabic: the localized medium date (day/month/year, with its own direction marks), nothing else in it.
      expect(formatCivilDate('2026-10-13', 'ar').replace(/[\u200e\u200f\u061c]/g, '')).toBe('13/10/2026');
      expect(formatCivilDate('2026-10-13', 'ar-EG').replace(/[\u200e\u200f\u061c]/g, '')).toBe('١٣/١٠/٢٠٢٦');
    }
  });

  it('returns a malformed value as given rather than throwing', () => {
    expect(formatCivilDate('', 'en')).toBe('');
    expect(formatCivilDate('13/10/2026', 'ar')).toBe('13/10/2026');
  });
});
