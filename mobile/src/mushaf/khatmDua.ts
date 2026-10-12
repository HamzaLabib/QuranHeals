/**
 * دعاء ختم القرآن: the optional supplication screen after page 604
 * (app/khatm-dua.tsx). Not Quran: it is never part of the Quran dataset,
 * search, page count (still 604) or ayah count (still 6,236), and it is
 * never shown as a page 605.
 *
 * The text is deliberately empty until a specific, documented printed
 * version is approved (docs/khatm-dua.md): the long du'a printed at the end
 * of many Mushafs circulates in several differing versions, and its common
 * attribution to Ibn Taymiyyah is rejected by scholars (Ibn Bāz, al-Albānī,
 * Ibn ʿUthaymīn, Bakr Abū Zayd). While it is null, page 604 shows no link and
 * the screen, if opened by URL, says it is not available yet.
 */
export type KhatmDuaText = {
  /** The du'a, one entry per printed paragraph, exactly as in `source`. */
  paragraphs: readonly string[];
  /** The printed edition it is transcribed from (title, publisher, year, page), shown under the du'a. */
  source: string;
};

export const KHATM_DUA: KhatmDuaText | null = null;

/** The du'a's text sizes (pt), smallest to largest; the screen opens on DEFAULT_KHATM_DUA_SIZE. */
export const KHATM_DUA_SIZES = [20, 23, 26, 30, 34] as const;
export const DEFAULT_KHATM_DUA_SIZE = 1;
