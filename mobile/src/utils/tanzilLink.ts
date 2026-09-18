import { verseKeyFromNumbers } from '@/services/quranReference';

const TANZIL_AYAH_BASE_URL = 'https://tanzil.net/#';

/**
 * Builds a deep link to this exact ayah on Tanzil's own reading view
 * (`https://tanzil.net/#<surah>:<ayah>`) — the "Read in Quran" action shown
 * on every ayah card. Distinct from the separate "Quran text: Tanzil ·
 * Uthmani 1.1" attribution link elsewhere on the card, which only points at
 * the Tanzil homepage and must not be duplicated/replaced by this.
 *
 * Reuses the exact same surah/ayah validation already used everywhere else
 * a verseKey is built (services/quranReference.ts's verseKeyFromNumbers:
 * surah 1-114, ayah a positive integer up to 286, the true maximum across
 * every surah) — never constructs a link from an out-of-range or malformed
 * reference. Returns `null` (never throws, never falls back to a different
 * ayah) for anything invalid, so the caller can simply hide/disable the
 * action instead of risking opening an incorrect page.
 */
export function buildTanzilAyahUrl(surahNumber: number, ayahNumber: number): string | null {
  try {
    const verseKey = verseKeyFromNumbers(surahNumber, ayahNumber);
    return `${TANZIL_AYAH_BASE_URL}${verseKey}`;
  } catch {
    return null;
  }
}
