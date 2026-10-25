import { pageNumberTouchBox } from '@/components/MushafPageView';
import { computePageLayout } from '@/mushaf/pageGeometry';

/** Below this, Show All / Hide All would not keep two usable halves (each a 44-pt touch target wide). */
export const MIN_ALL_WIDTH = 88;
/** Show All / Hide All's text may shrink to this share of its size to fit beside the page number (never less). */
export const ALL_MIN_FONT_SCALE = 0.75;

/** A box in the reading area's coordinates. */
export type Box = { left: number; top: number; width: number; height: number };

/** A control on the page number's line: its box, and its touch target's reach above it (the page number's). */
export type LinePlace = Box & { slopTop: number };

export type MemorizationPlacement = {
  /** The page number's touch area (never covered). */
  number: Box;
  /**
   * Show All / Hide All right beside the page number — on its left where there is room, else on its right — as wide as
   * it needs or, where the side is narrower, as wide as the side allows (its text shrinking, at most to
   * ALL_MIN_FONT_SCALE); null where neither side leaves MIN_ALL_WIDTH (it then goes to the top bar).
   */
  all: (LinePlace & { shrunk: boolean }) | null;
};

const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Show All / Hide All on the page number's line (Memorization Mode on), from the page's real geometry (the page
 * number's own touch area, MushafPageView.pageNumberTouchBox) and the measured boxes of anything else on that line
 * (`obstacles`, with their touch targets: page 604's إتمام الختمة and دعاء ختم القرآن), never fixed coordinates: right
 * beside the page number, never past the page's edge or into an obstacle, nothing below the page (the ورد row and its
 * buttons are there) or into the Quran text (above: the page number's own reach). The page itself is never moved or
 * resized. (The Eye is always in the top bar, never here.)
 */
export function placeMemorizationControls(args: {
  areaWidth: number;
  pageWidth: number;
  tilesDown: number;
  /** The page's top in the reading area (0 in Normal Mode; centred in its viewport in full screen). */
  pageTop: number;
  allWidth: number | null;
  obstacles?: readonly Box[];
}): MemorizationPlacement {
  const { areaWidth, pageWidth, tilesDown, pageTop, allWidth, obstacles = [] } = args;
  const pageLeft = (areaWidth - pageWidth) / 2;
  const own = pageNumberTouchBox(computePageLayout(pageWidth, tilesDown));
  const number = { left: pageLeft + own.left, top: pageTop + own.top, width: own.width, height: own.height };
  const reach = { top: number.top - own.slopTop, height: number.height + own.slopTop };
  const place = (left: number, width: number): LinePlace => ({ left, top: number.top, width, height: number.height, slopTop: own.slopTop });
  const right = number.left + number.width;

  let all: MemorizationPlacement['all'] = null;
  if (allWidth !== null) {
    const blockers = obstacles.filter((box) => overlaps({ left: pageLeft, width: pageWidth, ...reach }, box));
    // Each side's room: from the page number's edge to the page's edge or the nearest obstacle on the line. A blocker
    // reaching past that edge (into the page number's own touch area) leaves no room at all.
    const leftRoom = number.left - Math.max(pageLeft, ...blockers.filter((box) => box.left < number.left).map((box) => Math.min(number.left, box.left + box.width)));
    const rightRoom = Math.min(pageLeft + pageWidth, ...blockers.filter((box) => box.left + box.width > right).map((box) => Math.max(right, box.left))) - right;
    const fits = (room: number) => Math.min(allWidth, room) >= MIN_ALL_WIDTH && Math.min(allWidth, room) >= allWidth * ALL_MIN_FONT_SCALE;
    for (const side of ['left', 'right'] as const) {
      const room = side === 'left' ? leftRoom : rightRoom;
      if (!fits(room)) continue;
      const width = Math.min(allWidth, room);
      all = { ...place(side === 'left' ? number.left - width : right, width), shrunk: width < allWidth - 0.5 };
      break;
    }
  }
  return { number, all };
}
