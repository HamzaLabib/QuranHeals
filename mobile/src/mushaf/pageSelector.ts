import { MUSHAF_PAGE_COUNT } from './mushafPage';

/**
 * The compact page selector's rules (components/MushafPageSelector.tsx), physical and the same in every language:
 *  - The slider runs right to left, as the Mushaf is read: page 1 at its RIGHT end, page 604 at its LEFT. Dragging
 *    left raises the page, right lowers it. Whole pages only.
 *  - The one navigation arrow sits beside the selected number: a higher page than the one being read shows a
 *    LEFT-pointing arrow on the number's LEFT ("← 200"); a lower page a RIGHT-pointing arrow on its RIGHT ("60 →");
 *    the same page, none. Never mirrored for Arabic or English.
 */

export type ArrowSide = 'left' | 'right' | null;

export function navigationArrow(selectedPage: number, currentPage: number): ArrowSide {
  if (selectedPage > currentPage) return 'left';
  if (selectedPage < currentPage) return 'right';
  return null;
}

const clampPage = (page: number) => Math.min(MUSHAF_PAGE_COUNT, Math.max(1, page));

/** The page under `x` points from the track's left edge, on a track `width` wide: page 604 at x = 0, page 1 at x = width. */
export function pageAtTrackX(x: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(x)) return 1;
  const fromRight = Math.min(1, Math.max(0, (width - x) / width));
  return clampPage(1 + Math.round(fromRight * (MUSHAF_PAGE_COUNT - 1)));
}

/** Where a page sits on the track, in points from its left edge (the inverse of pageAtTrackX). */
export function trackXOfPage(page: number, width: number): number {
  if (!(width > 0)) return 0;
  return ((MUSHAF_PAGE_COUNT - clampPage(page)) / (MUSHAF_PAGE_COUNT - 1)) * width;
}

/** Unicode first-strong isolate: a ورد name in either script reads in its own direction inside the label. */
const isolate = (text: string) => `⁨${text}⁩`;

/**
 * The separator popup's button: "Apply to [name]" / «حفظ في [name]», with the ورد's own name exactly as saved. Nothing
 * is added around it ("Wird" / «ورد» never), whatever the name says, so every ورد's button reads the same way.
 */
export function applyToWirdLabel(name: string, labels: { applyToWird: string }): string {
  return labels.applyToWird.replace('{name}', isolate(name));
}
