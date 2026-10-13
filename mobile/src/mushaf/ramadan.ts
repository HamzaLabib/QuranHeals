import { UMM_AL_QURA_RAMADAN } from './generated/ummAlQuraRamadan';

/**
 * Whether a completed Khatma falls in Ramadan (أورادي وختماتي statistics).
 *
 * Policy (docs/khatma.md):
 *  - The day is the device's LOCAL civil date at the moment of confirmation
 *    (midnight to midnight in the device's time zone), never UTC, the
 *    Wird's name or the date the Wird was created.
 *  - The calendar is Umm al-Qura (the Saudi official calendar, ICU's
 *    `islamic-umalqura`), from a fixed table (generated/ummAlQuraRamadan.ts,
 *    1400–1500 AH) so every device classifies the same date the same way,
 *    whatever its Intl support. Local moon sighting can differ by a day at
 *    either end of Ramadan; the Islamic day's start at sunset is not used.
 *  - A date outside the table is not Ramadan (the table runs to 2077).
 */
export type RamadanClassification = { ramadan: true; hijriYear: number } | { ramadan: false; hijriYear: null };

/** YYYY-MM-DD of `date` in the device's local time zone. */
export function localCivilDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Classifies a local civil date (YYYY-MM-DD). */
export function classifyRamadan(civilDate: string): RamadanClassification {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(civilDate)) return { ramadan: false, hijriYear: null };
  // ISO dates compare correctly as strings.
  let low = 0;
  let high = UMM_AL_QURA_RAMADAN.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [year, start, end] = UMM_AL_QURA_RAMADAN[middle];
    if (civilDate < start) high = middle - 1;
    else if (civilDate > end) low = middle + 1;
    else return { ramadan: true, hijriYear: year };
  }
  return { ramadan: false, hijriYear: null };
}
