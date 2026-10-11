/**
 * Smart ayah links: `https://quran-heals-api.onrender.com/ayah/<surah>/<ayah>`.
 *
 * The host is the existing production API (backend/src/appLinks/appLinks.ts
 * serves the iOS/Android verification files and the store redirect there).
 * It must match `ios.associatedDomains` and the Android intent filter in
 * app.json — tests/ayahLink.test.ts checks that. A link carries only the
 * Quran reference: no user, reflection, emotion or tracking data.
 */
export const AYAH_LINK_HOST = 'quran-heals-api.onrender.com';

/**
 * Ayahs per surah, 1–114 (6,236 in total), matching the bundled verified
 * quran.sqlite and backend/assets/quran/surah-counts.json (Tanzil
 * quran-data.xml) — both checked in tests/ayahLink.test.ts.
 */
export const SURAH_AYAH_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98,
  135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88,
  75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29,
  22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31,
  50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8,
  19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];

/** True only for an ayah that exists: surah 1–114 and ayah within that surah. */
export function isExistingAyah(surah: number, ayah: number): boolean {
  return Number.isInteger(surah) && Number.isInteger(ayah) && surah >= 1 && surah <= SURAH_AYAH_COUNTS.length
    && ayah >= 1 && ayah <= SURAH_AYAH_COUNTS[surah - 1];
}

/** The shareable HTTPS link for one ayah, or null for a reference that doesn't exist. */
export function buildAyahLink(surah: number, ayah: number): string | null {
  return isExistingAyah(surah, ayah) ? `https://${AYAH_LINK_HOST}/ayah/${surah}/${ayah}` : null;
}

/**
 * Route params from `/ayah/<surah>/<ayah>` → a canonical verse key, or null.
 * Strict: plain digits without leading zeros, and an ayah that exists.
 * Expo Router may hand a param as a string or (repeated) array.
 */
export function parseAyahLinkParams(surah: unknown, ayah: unknown): string | null {
  if (typeof surah !== 'string' || typeof ayah !== 'string') return null;
  if (!/^[1-9]\d{0,2}$/.test(surah) || !/^[1-9]\d{0,2}$/.test(ayah)) return null;
  const surahNumber = Number(surah);
  const ayahNumber = Number(ayah);
  return isExistingAyah(surahNumber, ayahNumber) ? `${surahNumber}:${ayahNumber}` : null;
}
