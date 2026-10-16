import { requireOptionalNativeModule } from 'expo';
import { useEffect } from 'react';
import { AppState, Dimensions, Platform } from 'react-native';

import { createOrientationController, type OrientationApi } from './orientationController';

/**
 * expo-screen-orientation, loaded only where its native module is in the binary: it requires that module as soon as it
 * is imported, so a binary built before it was added (an older development client) would otherwise fail at startup.
 * There the policy simply doesn't run, and the manifest's portrait applies as before.
 */
async function loadAndroidApi(): Promise<OrientationApi | null> {
  if (!requireOptionalNativeModule('ExpoScreenOrientation')) return null;
  const ScreenOrientation = await import('expo-screen-orientation');
  return {
    current: async () => {
      const lock = await ScreenOrientation.getOrientationLockAsync();
      if (lock === ScreenOrientation.OrientationLock.PORTRAIT_UP) return 'portrait';
      if (lock === ScreenOrientation.OrientationLock.DEFAULT) return 'any';
      return 'other';
    },
    request: (request) => (request === 'any' ? ScreenOrientation.unlockAsync() : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)),
  };
}

/**
 * The device's orientation policy (layout/orientationPolicy.ts), applied once at startup and again only when the
 * physical screen changes (a foldable folded or unfolded) or the app returns to the foreground. Android only: iOS's
 * policy is static (app.json). Never reacts to the window's size, so split screen and resizable windows don't lock.
 */
export function useDeviceOrientationPolicy() {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    let cancelled = false;
    let remove = () => {};
    void loadAndroidApi().then((api) => {
      if (!api || cancelled) return;
      const controller = createOrientationController(api, Platform.OS);
      void controller.sync(Dimensions.get('screen'));
      const dimensions = Dimensions.addEventListener('change', ({ screen }) => {
        void controller.sync(screen);
      });
      const appState = AppState.addEventListener('change', (state) => {
        if (state === 'active') void controller.sync(Dimensions.get('screen'), true);
      });
      remove = () => {
        dimensions.remove();
        appState.remove();
      };
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      remove();
    };
  }, []);
}
