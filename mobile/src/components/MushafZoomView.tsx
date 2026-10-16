import { useCallback, useImperativeHandle, useLayoutEffect, useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { clampPan, clampZoom, MIN_ZOOM, pagerOffset, pageSettle, ZOOM_SNAP, zoomAbout } from '@/mushaf/pageZoom';

type Size = { width: number; height: number };

type MushafZoomViewProps = {
  /** The clipping area the page may be zoomed and moved within. */
  viewport: Size;
  /** The page at 1×, centred across the viewport; pinned to its top unless `centered`. */
  page: Size;
  /** Centre the page vertically too (full-screen reading). */
  centered?: boolean;
  /** False while the page isn't drawn (loading, or not downloaded): swipes still turn it, pinches do nothing. */
  zoomable?: boolean;
  /** The page shown (centred); its neighbours wait beside it, drawn, for a swipe. */
  current: number;
  /** The first and last pages (1 and 604): nothing is drawn or reachable beyond them. */
  firstPage?: number;
  lastPage: number;
  /** One page's drawing: the current page's (`current` true, interactive) or a neighbour's (still, hidden from screen readers). */
  renderPage: (pageNumber: number, current: boolean) => ReactNode;
  /** After a swipe has settled on a neighbour: +1 next page (finger left to right), -1 previous page (right to left); see swipeTurn. */
  onSwipe: (delta: -1 | 1) => void;
  /** After a double-tap has reset the zoom. */
  onDoubleTap?: () => void;
  /**
   * At 1× only: a clear one-finger swipe down (full-screen reading's exit).
   * Off when absent. Never while zoomed: a downward drag then pans.
   */
  onSwipeDown?: () => void;
  /** A swipe down starting above this screen y (the status bar and the system's top-edge gestures) is ignored. */
  swipeDownFromY?: number;
  /** Whenever the page goes from 1× to zoomed in, or back. */
  onZoomChange?: (zoomed: boolean) => void;
  /** `reset()` returns to the fitted 1× page at once, e.g. before the page is refitted (full-screen reading). */
  ref?: Ref<MushafZoomHandle>;
};

type PagerStripProps = MushafZoomViewProps & {
  /** A swipe has settled on `target`: React will show it next (see MushafZoomView). */
  onTurned: (target: number) => void;
};

export type MushafZoomHandle = { reset: () => void };

/** A downward drag this long (and mostly vertical) is a swipe down; shorter ones are taps or small movements. */
export const SWIPE_DOWN_DISTANCE = 80;
const RESET = { duration: 180 };
/** A released page glides the rest of the way (or back) in this: quick, decelerating, never springy. */
export const PAGE_SETTLE = { duration: 240, easing: Easing.out(Easing.cubic) };

/**
 * Pinch-to-zoom and finger-following page turns for the Mushaf, scaling the
 * whole drawn page (paper, frame, heads, lines, medallions, page number) as
 * one picture: the QPC V1 text is never resized or reflowed, so its glyphs,
 * line breaks and word positions stay exactly as verified. Taps keep selecting
 * ayahs: the page's own touch targets scale with it.
 *
 * - Pinch zooms toward the fingers' midpoint and pans with them.
 * - Zoomed in: one finger moves around the page; a swipe never turns it.
 * - At 1×: a horizontal drag moves the page with the finger, its neighbour
 *   sliding in beside it (finger left to right: the next page, from the left;
 *   right to left: the previous one, from the right — mushaf/pageZoom.ts).
 *   Released, it glides on to that page (pageSettle: 50 pt, or a flick) or
 *   back. A new touch catches a gliding page where it is. Before page 1 and
 *   after 604 the page only gives a little. In full-screen reading, a swipe
 *   down leaves full screen (onSwipeDown).
 * - Double-tap (while zoomed) returns to the fitted page.
 * - The page can never be moved off screen (mushaf/pageZoom.ts).
 *
 * The current page and its two neighbours are drawn, each under its page
 * number, so the page a swipe lands on is the very drawing that slid in (no
 * redraw, no blank frame); any other page change starts at 1×.
 *
 * Runs on the UI thread (Reanimated worklets); only a settled page turn and
 * the zoomed/not-zoomed switch reach React.
 *
 * A page opened any other way than a swipe (a link, the selector, the index, a screen reader's page action) gets
 * a new strip, centred on it from its first frame. In the same strip, its newly mounted slots would take their
 * first position from the strip's previous page (off screen) and rely on their animated styles catching up on the
 * UI thread, which they sometimes never did: the page was drawn, but off screen, until the next drag (Android,
 * 2026-10-16: 4 of 40 jumps in a development build, 2 of 131 in a release build). A swipe moves the strip on the
 * UI thread before React draws the new neighbour, so it keeps its strip and the drawing that slid in. The strip's
 * state is all per page (1×, no drag, no glide), so nothing else changes.
 */
export function MushafZoomView(props: MushafZoomViewProps) {
  const { current } = props;
  // Pages swipes have settled on that React has yet to show, in order (as PagerStrip's `swiped`).
  const [turnedTo, setTurnedTo] = useState<number[]>([]);
  const [shown, setShown] = useState({ page: current, strip: 0 });
  // Applied while rendering (React's "adjust state when a prop changes").
  if (shown.page !== current) {
    const index = turnedTo.indexOf(current);
    setShown({ page: current, strip: index >= 0 ? shown.strip : shown.strip + 1 });
    setTurnedTo(index >= 0 ? turnedTo.slice(index + 1) : []);
  }
  const onTurned = useCallback((target: number) => setTurnedTo((pending) => [...pending, target]), []);
  return <PagerStrip key={shown.strip} {...props} onTurned={onTurned} />;
}

function PagerStrip({
  viewport, page, centered = false, zoomable = true, current, firstPage = 1, lastPage, renderPage, onSwipe, onTurned, onSwipeDown, swipeDownFromY = 0, onDoubleTap, onZoomChange, ref,
}: PagerStripProps) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const pinchStart = useSharedValue({ scale: 1, tx: 0, ty: 0, fx: 0, fy: 0 });
  const dragStart = useSharedValue({ tx: 0, ty: 0 });
  // The page strip: the page it is centred on, and how far a drag (or a glide) has moved it.
  const centre = useSharedValue(current);
  const shift = useSharedValue(0);
  const swipeStart = useSharedValue(0);
  // Where the strip was when the finger touched down (0, or a gliding page it caught).
  const touchShift = useSharedValue(0);
  const swiping = useSharedValue(false);
  // Where a released page is gliding: -1, 0 (back) or +1.
  const settling = useSharedValue(0);
  // Pages swipes have settled on that React has yet to show, in order.
  const swiped = useSharedValue<number[]>([]);
  const [zoomed, setZoomed] = useState(false);
  // A page shown starts at 1× (applied while rendering: React's "adjust state when a prop changes").
  const [zoomedPage, setZoomedPage] = useState(current);
  if (zoomedPage !== current) {
    setZoomedPage(current);
    setZoomed(false);
  }
  const reportZoom = (next: boolean) => {
    setZoomed(next);
    onZoomChange?.(next);
  };
  useImperativeHandle(ref, () => ({
    reset: () => {
      scale.set(MIN_ZOOM);
      tx.set(0);
      ty.set(0);
      reportZoom(false);
    },
  }));

  // A page shown: one a swipe already settled on (the strip is there), or one opened another way (arrows, search,
  // a link: the strip moves to it at once). Either way it starts at 1×.
  useLayoutEffect(() => {
    const pending = swiped.get();
    const index = pending.indexOf(current);
    if (index >= 0) swiped.set(pending.slice(index + 1));
    else {
      swiped.set([]);
      cancelAnimation(shift);
      centre.set(current);
      shift.set(0);
    }
    scale.set(MIN_ZOOM);
    tx.set(0);
    ty.set(0);
    // Only when the page changes; the shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // The page's centre, relative to the viewport's centre, at 1×.
  const offsetX = 0;
  const offsetY = centered ? 0 : page.height / 2 - viewport.height / 2;
  const centreX = viewport.width / 2 + offsetX;
  const centreY = viewport.height / 2 + offsetY;
  const { width: pageWidth, height: pageHeight } = page;
  const { width: viewportWidth, height: viewportHeight } = viewport;

  const pinch = Gesture.Pinch()
    .enabled(zoomable)
    .onStart((event) => {
      pinchStart.set({ scale: scale.get(), tx: tx.get(), ty: ty.get(), fx: event.focalX - centreX, fy: event.focalY - centreY });
    })
    .onUpdate((event) => {
      const start = pinchStart.get();
      const next = clampZoom(start.scale * event.scale);
      scale.set(next);
      tx.set(clampPan(zoomAbout(event.focalX - centreX, start.fx, start.tx, start.scale, next), pageWidth, viewportWidth, offsetX, next));
      ty.set(clampPan(zoomAbout(event.focalY - centreY, start.fy, start.ty, start.scale, next), pageHeight, viewportHeight, offsetY, next));
    })
    .onEnd(() => {
      const isZoomed = scale.get() > ZOOM_SNAP;
      if (!isZoomed) {
        scale.set(withTiming(MIN_ZOOM, RESET));
        tx.set(withTiming(0, RESET));
        ty.set(withTiming(0, RESET));
      }
      scheduleOnRN(reportZoom, isZoomed);
    });

  // Zoomed in: one finger moves around the page.
  const drag = Gesture.Pan()
    .enabled(zoomed)
    .maxPointers(1)
    .onStart(() => {
      dragStart.set({ tx: tx.get(), ty: ty.get() });
    })
    .onUpdate((event) => {
      const start = dragStart.get();
      const current = scale.get();
      tx.set(clampPan(start.tx + event.translationX, pageWidth, viewportWidth, offsetX, current));
      ty.set(clampPan(start.ty + event.translationY, pageHeight, viewportHeight, offsetY, current));
    });

  const turned = (delta: -1 | 1, target: number) => {
    swiped.set([...swiped.get(), target]);
    onTurned(target);
    onSwipe(delta);
  };
  /** Glides the strip to `delta` (-1, 0 or +1 page); on arriving at a neighbour, centres it there and tells React. */
  const settle = (delta: number) => {
    'worklet';
    const target = centre.get() + delta;
    const to = delta !== 0 && target >= firstPage && target <= lastPage ? delta : 0;
    settling.set(to);
    shift.set(withTiming(to * viewportWidth, PAGE_SETTLE, (finished) => {
      if (!finished || to === 0) return;
      // Centred on the new page and the offset cleared in the same frame: nothing moves on screen.
      centre.set(target);
      shift.set(0);
      settling.set(0);
      scheduleOnRN(turned, to as -1 | 1, target);
    }));
  };

  // At 1×: a clear, mostly horizontal one-finger drag moves the page with the finger.
  const swipe = Gesture.Pan()
    .enabled(!zoomed)
    .maxPointers(1)
    .activeOffsetX([-16, 16])
    .failOffsetY([-24, 24])
    // A touch holds a gliding page where it is (cancelling its glide), so a drag can pick it up without a jump.
    .onBegin(() => {
      cancelAnimation(shift);
      touchShift.set(shift.get());
    })
    .onStart((event) => {
      swiping.set(true);
      // From where the page is: the finger's first 16 pt (before the drag counted) don't make it jump.
      swipeStart.set(shift.get() - event.translationX);
    })
    .onUpdate((event) => {
      shift.set(pagerOffset(swipeStart.get() + event.translationX, centre.get(), firstPage, lastPage, viewportWidth));
    })
    .onEnd((event, success) => {
      // Judged on the finger's whole travel (swipeTurn's distances), from where the page was at touch down.
      // Cancelled (e.g. a second finger starting a pinch): back to the page it started on.
      settle(success ? pageSettle(touchShift.get() + event.translationX, event.translationY, event.velocityX) : 0);
    })
    .onFinalize(() => {
      // A touch that never became a drag (a tap, a vertical move) lets a page it held glide on where it was going.
      if (!swiping.get() && shift.get() !== 0) settle(settling.get());
      swiping.set(false);
    });

  // At 1× (full-screen reading): a clear swipe down. Activates only downward, fails on sideways movement,
  // so it never competes with page turns, and a tap never moves far enough to start it.
  const swipeDown = Gesture.Pan()
    .enabled(Boolean(onSwipeDown) && !zoomed)
    .maxPointers(1)
    .activeOffsetY(24)
    .failOffsetX([-24, 24])
    .onEnd((event, success) => {
      if (!success || !onSwipeDown) return;
      const startY = event.absoluteY - event.translationY;
      if (startY < swipeDownFromY) return;
      if (event.translationY >= SWIPE_DOWN_DISTANCE && event.translationY >= Math.abs(event.translationX) * 2) scheduleOnRN(onSwipeDown);
    });

  const doubleTap = Gesture.Tap()
    .enabled(zoomed)
    .numberOfTaps(2)
    .onEnd((_event, success) => {
      if (!success) return;
      scale.set(withTiming(MIN_ZOOM, RESET));
      tx.set(withTiming(0, RESET));
      ty.set(withTiming(0, RESET));
      scheduleOnRN(reportZoom, false);
      if (onDoubleTap) scheduleOnRN(onDoubleTap);
    });

  // The neighbours first and the current page last: drawn on top, and its zoom the last style set up.
  const pages = [current - 1, current + 1, current].filter((n) => n >= firstPage && n <= lastPage);
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, drag, swipe, swipeDown, doubleTap)}>
      <View testID="mushaf-zoom-viewport" collapsable={false} style={[styles.viewport, { height: viewportHeight, width: viewportWidth }]}>
        {pages.map((pageNumber) => (
          <PagerSlot
            key={pageNumber}
            pageNumber={pageNumber}
            current={pageNumber === current}
            centred={centered}
            viewport={viewport}
            page={page}
            centre={centre}
            shift={shift}
            scale={scale}
            tx={tx}
            ty={ty}>
            {renderPage(pageNumber, pageNumber === current)}
          </PagerSlot>
        ))}
      </View>
    </GestureDetector>
  );
}

type PagerSlotProps = {
  pageNumber: number;
  current: boolean;
  centred: boolean;
  viewport: Size;
  page: Size;
  centre: SharedValue<number>;
  shift: SharedValue<number>;
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  children: ReactNode;
};

/**
 * One page in the strip: a viewport-wide place, one viewport width from its
 * neighbours (the next page to the left, the previous to the right), moved
 * with the strip. Only the current page zooms, takes touches and is read by
 * screen readers.
 */
function PagerSlot({ pageNumber, current, centred, viewport, page, centre, shift, scale, tx, ty, children }: PagerSlotProps) {
  const width = viewport.width;
  const place = useAnimatedStyle(() => ({
    transform: [{ translateX: (centre.get() - pageNumber) * width + shift.get() }],
  }), [pageNumber, width]);
  const zoom = useAnimatedStyle(() => ({
    transform: current
      ? [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }]
      : [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }],
  }), [current]);
  return (
    <Animated.View
      testID={`mushaf-pager-${pageNumber}`}
      pointerEvents={current ? 'auto' : 'none'}
      accessibilityElementsHidden={!current}
      importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
      style={[styles.slot, centred && styles.centered, { height: viewport.height, width }, place]}>
      <Animated.View testID={current ? 'mushaf-zoom-page' : undefined} style={[{ height: page.height, width: page.width }, zoom]}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centered: {
    justifyContent: 'center',
  },
  viewport: {
    overflow: 'hidden',
  },
  slot: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    top: 0,
  },
});
