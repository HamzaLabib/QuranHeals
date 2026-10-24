import { spacing } from '@/constants/theme';
import { computePageLayout } from '@/mushaf/pageGeometry';

/**
 * Kept free between a feature button and the ورد pill: the pill's touch target reaches 8 pt beyond its sides and a
 * button's 4 pt (BUTTON_SLOP), so this leaves 4 pt between the two touch targets. (Meanings' approved clearance.)
 */
export const PILL_CLEARANCE = 16;
/** A feature button's touch target beyond its left and right edges (Meanings' approved touch target). */
export const BUTTON_SLOP = 4;
const TOUCH_TARGET = 44;
/**
 * The narrowest the ورد pill is ever made for Surah Preview to fit (its capsule, chevron and a few letters of the name
 * before “…”), even arrow-only. Where the buttons would leave it less, Surah Preview is not shown (Meanings always is):
 * a case for design approval, never an overlap.
 */
export const MIN_PILL_WIDTH = 72;

/** A laid-out box in the reading area's coordinates. */
export type Box = { left: number; top: number; width: number; height: number };

/** A button's place and vertical touch target. */
export type ButtonPlace = { left: number; top: number; slopTop: number; slopBottom: number };

/**
 * The distance of both feature buttons from their side of the reading area: Meanings' approved x, the page frame's left
 * edge — (areaWidth − pageWidth) / 2 + frame.x, the page being centred — and Surah Preview's mirror image of it from
 * the right. On page 604 the buttons sit under إتمام الختمة and the du'a (each spacing.md in from the ورد row's ends),
 * so never further in than those: min(that, rowLeft + spacing.md), as approved for Meanings.
 */
export function edgeInset(args: { areaWidth: number; pageWidth: number; tilesDown: number; rowLeft: number; page604: boolean }): number {
  const { areaWidth, pageWidth, tilesDown, rowLeft, page604 } = args;
  const usual = (areaWidth - pageWidth) / 2 + computePageLayout(pageWidth, tilesDown).frame.x;
  return page604 ? Math.min(usual, rowLeft + spacing.md) : usual;
}

/**
 * The buttons' line: centred on the ورد pill's line, never above `minTop` (the page's lower edge; page 604: the lower
 * edge of إتمام الختمة and the du'a), with a 44-pt touch target — upward as far as allowed, the rest downward.
 */
function onPillLine(pill: Box, height: number, minTop: number): Pick<ButtonPlace, 'top' | 'slopTop' | 'slopBottom'> {
  const top = Math.max(minTop, pill.top + pill.height / 2 - height / 2);
  const slopTop = Math.max(0, Math.min(TOUCH_TARGET - height, top - minTop));
  return { top, slopTop, slopBottom: Math.max(0, TOUCH_TARGET - height - slopTop) };
}

/**
 * The reader's feature buttons on the ورد pill's line, in the same physical order in every language (never mirrored):
 * Meanings on the LEFT at its approved x (`inset` from the left), the ورد pill where it always is (centred), Surah
 * Preview on the RIGHT, `inset` from the right edge. Meanings is placed whatever Surah Preview does; Surah Preview is
 * null when it would come within PILL_CLEARANCE of the pill as laid out (the pill is first narrowed to `pillCap` for
 * it, a long name ending in “…”), so nothing ever overlaps.
 */
export function placeFeatureButtons(args: {
  pill: Box;
  inset: number;
  areaWidth: number;
  minTop: number;
  meanings: { width: number; height: number } | null;
  preview: { width: number; height: number } | null;
}): { meanings: ButtonPlace | null; preview: ButtonPlace | null } {
  const { pill, inset, areaWidth, minTop, meanings, preview } = args;
  const meaningsPlace = meanings ? { left: inset, ...onPillLine(pill, meanings.height, minTop) } : null;
  let previewPlace: ButtonPlace | null = null;
  if (preview) {
    const left = areaWidth - inset - preview.width;
    const clearOfPill = left >= pill.left + pill.width + PILL_CLEARANCE;
    const clearOfMeanings = !meanings || left >= inset + meanings.width + 2 * BUTTON_SLOP + 4;
    if (clearOfPill && clearOfMeanings) previewPlace = { left, ...onPillLine(pill, preview.height, minTop) };
  }
  return { meanings: meaningsPlace, preview: previewPlace };
}

/**
 * Which buttons keep their label beside the ورد pill as it is laid out: each on its own side, only while its labelled
 * width stays PILL_CLEARANCE clear of the pill; otherwise it is drawn arrow-only. Read from the pill's measured box
 * (its name, language, font size and screen), never from the name's length. The pill's width never depends on this
 * (its cap is the arrow-only buttons', pillCap), so the labels follow the pill and never switch back and forth.
 */
export function labelledButtons(args: { pill: Box; inset: number; areaWidth: number; meaningsWidth: number | null; previewWidth: number | null }): { meanings: boolean; preview: boolean } {
  const { pill, inset, areaWidth, meaningsWidth, previewWidth } = args;
  // Half a point of slack: a pill exactly at its cap is not a collision.
  const EPS = 0.5;
  return {
    meanings: meaningsWidth !== null && inset + meaningsWidth + PILL_CLEARANCE <= pill.left + EPS,
    preview: previewWidth !== null && areaWidth - inset - previewWidth >= pill.left + pill.width + PILL_CLEARANCE - EPS,
  };
}

/**
 * The widest the ورد pill (centred on `rowCentre`) may be for the buttons beside it: PILL_CLEARANCE from Meanings'
 * right edge and, when Surah Preview is shown, from its left edge. A longer ورد name then ends in “…”, as it does at
 * its own maximum. `previewFits` is false where that would leave the pill under MIN_PILL_WIDTH: Surah Preview is then
 * not shown and the cap is Meanings' alone. The reader passes the buttons' arrow-only widths: their labels give way
 * to the name first (labelledButtons), and the name is shortened only where even arrow-only buttons need the room.
 */
export function pillCap(args: { inset: number; areaWidth: number; rowCentre: number; meaningsWidth: number | null; previewWidth: number | null }): { maxWidth: number | null; previewFits: boolean } {
  const { inset, areaWidth, rowCentre, meaningsWidth, previewWidth } = args;
  const leftHalf = meaningsWidth === null ? Infinity : rowCentre - (inset + meaningsWidth + PILL_CLEARANCE);
  const rightHalf = previewWidth === null ? Infinity : areaWidth - inset - previewWidth - PILL_CLEARANCE - rowCentre;
  const withPreview = 2 * Math.min(leftHalf, rightHalf);
  const previewFits = previewWidth !== null && withPreview >= MIN_PILL_WIDTH;
  const half = previewFits ? Math.min(leftHalf, rightHalf) : leftHalf;
  return { maxWidth: Number.isFinite(half) ? Math.max(0, Math.floor(2 * half)) : null, previewFits };
}
