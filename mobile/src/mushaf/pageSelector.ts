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
/** The name already says ورد / Wird: "Apply to Morning Wird", never "… Wird Wird". */
const namesWird = (name: string) => /(^|[^\p{L}])(wird|(ال)?ورد)([^\p{L}]|$)/iu.test(name);

/** The separator popup's button: "Apply to [name] Wird", or "Apply to [name]" when the name already names a ورد. */
export function applyToWirdLabel(name: string, labels: { applyToWird: string; applyToNamedWird: string }): string {
  const template = namesWird(name) ? labels.applyToNamedWird : labels.applyToWird;
  return template.replace('{name}', isolate(name));
}
