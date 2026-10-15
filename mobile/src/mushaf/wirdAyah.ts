import { AYAH_MARKER_INK } from './generated/ayahMarkerInk';

/**
 * A ورد's ayah-level position: the ayah whose number (the separator medallion) was tapped and applied to it — "2:255".
 * Optional beside the stop's page, which stays the position every other screen uses: a page-only save, a Khatma's
 * return to page 1 or its undo to 604 clear it, so it never outlives the page it was saved on.
 *
 * Valid only where that ayah's number is printed: on the page holding its end marker (generated/ayahMarkerInk.ts,
 * read from the page fonts, the same table the medallions are drawn from). In this Mushaf no ayah runs onto the next
 * page, so that is also the page it starts on (navigation.ts pageOfAyah; checked over all 6,236 on 2026-10-15).
 */
export function isWirdAyahOnPage(ayahKey: unknown, page: number): ayahKey is string {
  return typeof ayahKey === 'string' && /^[1-9]\d{0,2}:[1-9]\d{0,2}$/.test(ayahKey) && AYAH_MARKER_INK[ayahKey]?.[0] === page;
}

/** The selected ورد's ayah whose number is on `page` (the gold medallion there), or null: none selected, page-only, or another page. */
export function wirdAyahOnPage(stop: { page: number; ayahKey?: string } | null | undefined, page: number): string | null {
  return stop && stop.page === page && isWirdAyahOnPage(stop.ayahKey, page) ? stop.ayahKey : null;
}
