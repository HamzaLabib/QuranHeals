import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Dimensions, type AppStateStatus } from 'react-native';

import { isLargeScreen } from '@/layout/orientationPolicy';

import { locationSource as platformLocationSource } from './locationSource';
import type { LocationSource } from './locationSourceTypes';
import {
  createQiblaCompassController,
  type HeadingFrame,
  type ManualPosition,
  type QiblaDiagnostics,
  type QiblaSnapshot,
} from './qiblaCompassController';

/**
 * The Qibla screen's compass (qiblaCompassController.ts), active only while the screen is focused AND the app is
 * active: leaving the screen, opening another app, the lock screen or iOS Control Centre (AppState "inactive") all stop
 * the heading stream, and coming back restarts it (re-checking the permission, which may have changed in Settings).
 * Unmounting deactivates it, which removes the stream and every timer it set; deactivation is reversible, so a
 * development double-mount (effects run, cleaned up, run again) is safe too. `source` is read once, at mount.
 */

const TIMERS = {
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Android reports "unknown" before its first state: the screen was just opened by a tap, so the app is in use. */
export function isAppActive(state: AppStateStatus | null | undefined): boolean {
  return state === 'active' || state === 'unknown' || state == null;
}

export type QiblaCompass = {
  snapshot: QiblaSnapshot;
  requestPermission: () => void;
  retry: () => void;
  chooseManualPosition: (position: ManualPosition) => void;
  chooseDevicePosition: () => void;
  /** Every heading reading, for the dial's animation; returns the unsubscribe function. */
  onFrame: (listener: (frame: HeadingFrame) => void) => () => void;
  /** The development diagnostics read-out (no coordinates, no distance); computed when called. */
  getDiagnostics: () => QiblaDiagnostics;
};

export function useQiblaCompass(source: LocationSource = platformLocationSource): QiblaCompass {
  const [controller] = useState(() =>
    createQiblaCompassController({
      source,
      now: () => Date.now(),
      timers: TIMERS,
      largeScreen: isLargeScreen(Dimensions.get('screen')),
    }),
  );
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot());
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(() => isAppActive(AppState.currentState));

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(isAppActive(state)));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    controller.setActive(focused && appActive);
  }, [controller, focused, appActive]);

  // Unmount: stop everything (stream, retries, timers). Separate from the effect above so it also runs when the
  // screen is removed while still focused.
  useEffect(() => () => controller.setActive(false), [controller]);

  const requestPermission = useCallback(() => {
    void controller.requestPermission();
  }, [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const chooseManualPosition = useCallback((position: ManualPosition) => controller.chooseManualPosition(position), [controller]);
  const chooseDevicePosition = useCallback(() => controller.chooseDevicePosition(), [controller]);
  const onFrame = useCallback((listener: (frame: HeadingFrame) => void) => controller.onFrame(listener), [controller]);
  const getDiagnostics = useCallback(() => controller.getDiagnostics(), [controller]);

  return { snapshot, requestPermission, retry, chooseManualPosition, chooseDevicePosition, onFrame, getDiagnostics };
}
