/**
 * Pinch-to-zoom geometry for the Mushaf reader, kept pure so it can run as
 * worklets on the UI thread (MushafZoomView) and be tested directly.
 *
 * Coordinates are along one axis at a time. The page is a box of `size`
 * drawn inside a clipping viewport of `viewport`; `offset` is how far the
 * page's centre sits from the viewport's centre at 1× (negative when the
 * page is pinned to the top). The page scales about its own centre and is
 * then moved by a translation `t`.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
/** A pinch released at or below this snaps back to the fitted 1× view. */
export const ZOOM_SNAP = 1.02;

export function clampZoom(scale: number): number {
  'worklet';
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * The translations allowed at `scale`. A page larger than the viewport must
 * keep covering it (no paper edge pulled inward past the viewport's edge);
 * a smaller one must stay entirely inside it. Either way, never off screen.
 */
export function panBounds(size: number, viewport: number, offset: number, scale: number): { min: number; max: number } {
  'worklet';
  const slack = Math.abs(size * scale - viewport) / 2;
  return { min: -slack - offset, max: slack - offset };
}

export function clampPan(t: number, size: number, viewport: number, offset: number, scale: number): number {
  'worklet';
  if (scale <= MIN_ZOOM) return 0;
  const { min, max } = panBounds(size, viewport, offset, scale);
  return Math.min(max, Math.max(min, t));
}

/**
 * The translation that keeps the page point under the fingers' starting
 * midpoint (`startFocal`, relative to the page's centre at 1×) under their
 * current midpoint (`focal`) while the scale goes from `startScale` to
 * `scale`: zooming toward the fingers, and two-finger panning, in one step.
 */
export function zoomAbout(focal: number, startFocal: number, startT: number, startScale: number, scale: number): number {
  'worklet';
  return focal - (startFocal - startT) * (scale / startScale);
}

/** At 1×, a mostly horizontal drag this long turns the page. */
export const SWIPE_DISTANCE = 50;
/** A shorter drag still turns it when released this fast (pt/s) in the same direction: a quick flick of the thumb. */
export const FLICK_DISTANCE = 30;
export const FLICK_VELOCITY = 500;

/**
 * The page turn for a one-finger drag released at 1×: +1 next, -1 previous, 0 none.
 * The same in every language (the product decision; never inverted for RTL):
 * the finger moving left to right (positive x) is the NEXT page, right to left
 * the previous one. (The toolbar differs on purpose: its left arrow is next.)
 * Screen coordinates are never mirrored for RTL, so nothing here depends on
 * the layout direction. A drag that is not clearly horizontal (x at least
 * 1.5 × y), or too short and slow, is not a turn.
 */
export function swipeTurn(translationX: number, translationY: number, velocityX: number): -1 | 0 | 1 {
  'worklet';
  const distance = Math.abs(translationX);
  if (distance < Math.abs(translationY) * 1.5) return 0;
  const flick = distance >= FLICK_DISTANCE && Math.abs(velocityX) >= FLICK_VELOCITY && Math.sign(velocityX) === Math.sign(translationX);
  if (distance < SWIPE_DISTANCE && !flick) return 0;
  return translationX > 0 ? 1 : -1;
}
