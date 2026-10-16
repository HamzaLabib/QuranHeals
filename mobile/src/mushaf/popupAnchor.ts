import type { Box } from './pageGeometry';

type Point = { x: number; y: number };

/**
 * The page's box on screen (window coordinates) at 1×: centred across the reading area, which starts under the top
 * safe area and the Back row and after the left safe area; pinned to the area's top in Normal Mode, centred in its
 * viewport in full screen (MushafZoomView).
 */
export function pageBoxOnScreen(args: {
  area: { width: number };
  insets: { top: number; left: number };
  barHeight: number;
  page: { width: number; height: number };
  viewportHeight: number;
  fullScreen: boolean;
}): Box {
  const { area, insets, barHeight, page, viewportHeight, fullScreen } = args;
  return {
    x: insets.left + (area.width - page.width) / 2,
    y: insets.top + barHeight + (fullScreen ? (viewportHeight - page.height) / 2 : 0),
    width: page.width,
    height: page.height,
  };
}

/**
 * A popup's anchor (the tapped point) after the page was refitted (rotation, window resizing): the same point of the
 * page, which scales as one picture, so it stays at the ayah that was tapped. Null when either box is empty.
 */
export function remapAnchor(anchor: Point, from: Box, to: Box): Point | null {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return null;
  return {
    x: to.x + ((anchor.x - from.x) * to.width) / from.width,
    y: to.y + ((anchor.y - from.y) * to.height) / from.height,
  };
}

export function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
