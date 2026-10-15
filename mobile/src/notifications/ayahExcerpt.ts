/**
 * The Random Quran Ayah's notification body: the verified Arabic text from
 * quran.sqlite, unchanged — or, for a verse too long for a notification, an
 * exact excerpt of it.
 *
 * An excerpt is always a prefix of the stored text, cut immediately before a
 * space (U+0020, the only word separator in the Tanzil Uthmani text), so it
 * ends on a whole word with every diacritic and Quranic mark that belongs to
 * it: no letter is separated from its combining marks, and nothing is
 * normalized, removed or retyped. A space and "…" follow it to show the verse
 * continues; tapping the notification always opens the whole verse. The
 * stored text is never modified.
 *
 * The limit counts UTF-16 code units of the Quran text (diacritics included),
 * about four lines on a lock screen; the full verse is in the app.
 */
export const AYAH_NOTIFICATION_MAX_LENGTH = 220;
export const EXCERPT_MARKER = '…';

export type AyahExcerpt = { text: string; truncated: boolean };

export function ayahNotificationExcerpt(arabicText: string, maxLength: number = AYAH_NOTIFICATION_MAX_LENGTH): AyahExcerpt {
  if (arabicText.length <= maxLength) return { text: arabicText, truncated: false };
  // The last space at or before the limit: everything before it is whole words.
  let cut = arabicText.lastIndexOf(' ', maxLength);
  // Leading spaces never occur in the source; guard anyway so an excerpt is never empty.
  while (cut > 0 && arabicText[cut - 1] === ' ') cut -= 1;
  if (cut <= 0) {
    // A single "word" longer than the limit (never the case in the verified text): its first space after the limit.
    const next = arabicText.indexOf(' ', maxLength);
    if (next <= 0) return { text: arabicText, truncated: false };
    cut = next;
  }
  return { text: `${arabicText.slice(0, cut)} ${EXCERPT_MARKER}`, truncated: true };
}
