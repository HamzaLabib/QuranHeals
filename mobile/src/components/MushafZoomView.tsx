import { useImperativeHandle, useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { clampPan, clampZoom, MIN_ZOOM, swipeTurn, ZOOM_SNAP, zoomAbout } from '@/mushaf/pageZoom';

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
  /** At 1×: a horizontal swipe. +1 next page (finger left to right), -1 previous page (right to left); see swipeTurn. */
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
  children: ReactNode;
};

export type MushafZoomHandle = { reset: () => void };

/** A downward drag this long (and mostly vertical) is a swipe down; shorter ones are taps or small movements. */
export const SWIPE_DOWN_DISTANCE = 80;
const RESET = { duration: 180 };

/**
 * Pinch-to-zoom for the Mushaf page, 1×–3×, scaling the whole drawn page
 * (paper, frame, heads, lines, medallions, page number) as one picture: the
 * QPC V1 text is never resized or reflowed, so its glyphs, line breaks and
 * word positions stay exactly as verified. Taps keep selecting ayahs: the
 * page's own touch targets scale with it.
 *
 * - Pinch zooms toward the fingers' midpoint and pans with them.
 * - Zoomed in: one finger moves around the page; a swipe never turns it.
 * - At 1×: a horizontal swipe turns the page (in step with the arrows); in
 *   full-screen reading, a swipe down leaves full screen (onSwipeDown).
 * - Double-tap (while zoomed) returns to the fitted page.
 * - The page can never be moved off screen (mushaf/pageZoom.ts).
 * The parent remounts this view per page (key), so a new page starts at 1×.
 *
 * Runs on the UI thread (Reanimated worklets); only the page turn and the
 * zoomed/not-zoomed switch reach React.
 */
export function MushafZoomView({ viewport, page, centered = false, zoomable = true, onSwipe, onSwipeDown, swipeDownFromY = 0, onDoubleTap, onZoomChange, ref, children }: MushafZoomViewProps) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const pinchStart = useSharedValue({ scale: 1, tx: 0, ty: 0, fx: 0, fy: 0 });
  const dragStart = useSharedValue({ tx: 0, ty: 0 });
  const [zoomed, setZoomed] = useState(false);
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

  // At 1×: a clear, mostly horizontal one-finger swipe turns the page.
  const swipe = Gesture.Pan()
    .enabled(!zoomed)
    .maxPointers(1)
    .activeOffsetX([-16, 16])
    .failOffsetY([-24, 24])
    .onEnd((event, success) => {
      // Not when cancelled, e.g. by a second finger starting a pinch.
      if (!success) return;
      const delta = swipeTurn(event.translationX, event.translationY, event.velocityX);
      if (delta !== 0) scheduleOnRN(onSwipe, delta);
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

  const transform = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, drag, swipe, swipeDown, doubleTap)}>
      <View testID="mushaf-zoom-viewport" collapsable={false} style={[styles.viewport, centered && styles.centered, { height: viewportHeight, width: viewportWidth }]}>
        <Animated.View testID="mushaf-zoom-page" style={[{ height: pageHeight, width: pageWidth }, transform]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  centered: {
    justifyContent: 'center',
  },
  viewport: {
    alignItems: 'center',
    overflow: 'hidden',
  },
});
