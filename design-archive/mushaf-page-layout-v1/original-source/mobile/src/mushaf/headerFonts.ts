/**
 * The printed page's running heads (surah, juz') and page number, set in
 * Amiri Bold: a classical Naskh close to the 1405 print's calligraphic
 * heads, under the SIL Open Font License 1.1 (from @expo-google-fonts/amiri;
 * only this one weight is bundled, ~400 KB). Never used for Quran text.
 *
 * Loaded separately from the QPC V1 page fonts so a failure here only
 * falls back to the system font and never affects the Quran text.
 */
export const MUSHAF_HEADER_FONT_FAMILY = 'Amiri_700Bold';

export const MUSHAF_HEADER_FONTS = {
  [MUSHAF_HEADER_FONT_FAMILY]: require('@expo-google-fonts/amiri/700Bold/Amiri_700Bold.ttf'),
};
