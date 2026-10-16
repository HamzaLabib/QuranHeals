import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createOrientationController, type CurrentRequest } from '@/layout/orientationController';
import { isLargeScreen, LARGE_SCREEN_MIN_SHORTEST_SIDE, orientationRequestFor } from '@/layout/orientationPolicy';

const appJson = JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf-8')).expo;
const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

describe('native tablet configuration (app.json)', () => {
  it('enables the iPad natively, with multitasking (no full-screen requirement)', () => {
    expect(appJson.ios.supportsTablet).toBe(true);
    expect(appJson.ios.isTabletOnly).toBeUndefined();
    expect(appJson.ios.requireFullScreen).toBeUndefined();
  });

  it('keeps the static portrait request: the iPhone list, and the Android manifest (phones portrait from the first frame)', () => {
    expect(appJson.orientation).toBe('portrait');
    expect(appJson.android.screenOrientation).toBeUndefined();
  });

  it('uses expo-screen-orientation without its initialOrientation plugin (an iOS initial mask would override the per-device plist lists)', () => {
    expect(packageJson.dependencies['expo-screen-orientation']).toMatch(/^~57\./);
    const plugins = (appJson.plugins as unknown[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins).not.toContain('expo-screen-orientation');
  });
});

describe('orientation policy: by the physical screen, never the window', () => {
  const phones = [{ width: 360, height: 800 }, { width: 393, height: 852 }, { width: 448, height: 998 }, { width: 412, height: 915 }];
  const tablets = [{ width: 744, height: 1133 }, { width: 800, height: 1280 }, { width: 1280, height: 800 }, { width: 1032, height: 1376 }, { width: 600, height: 960 }];

  it('600 dp shortest side is the threshold (Android sw600dp), in either orientation', () => {
    expect(LARGE_SCREEN_MIN_SHORTEST_SIDE).toBe(600);
    expect(isLargeScreen({ width: 599, height: 1000 })).toBe(false);
    expect(isLargeScreen({ width: 600, height: 1000 })).toBe(true);
    expect(isLargeScreen({ width: 1000, height: 600 })).toBe(true);
    expect(isLargeScreen({ width: 0, height: 0 })).toBe(false);
    expect(isLargeScreen({ width: Number.NaN, height: 900 })).toBe(false);
  });

  it('Android: phones keep portrait, tablets (any manufacturer, any Android version) ask for any orientation', () => {
    for (const screen of phones) expect(orientationRequestFor('android', screen)).toBe('portrait');
    for (const screen of tablets) expect(orientationRequestFor('android', screen)).toBe('any');
  });

  it('a foldable is a phone folded and a tablet unfolded', () => {
    expect(orientationRequestFor('android', { width: 344, height: 882 })).toBe('portrait'); // cover screen
    expect(orientationRequestFor('android', { width: 673, height: 841 })).toBe('any'); // inner screen
  });

  it('iOS and web never lock at runtime (the iPhone and iPad lists in Info.plist decide)', () => {
    expect(orientationRequestFor('ios', { width: 393, height: 852 })).toBeNull();
    expect(orientationRequestFor('ios', { width: 820, height: 1180 })).toBeNull();
    expect(orientationRequestFor('web', { width: 1280, height: 800 })).toBeNull();
  });
});

function fakeActivity(initial: CurrentRequest) {
  let current = initial;
  const api = {
    current: vi.fn(async () => current),
    request: vi.fn(async (request: 'portrait' | 'any') => {
      current = request;
    }),
  };
  return { api, get current() { return current; } };
}

describe('orientation controller: few native calls, no loops', () => {
  const phone = { width: 393, height: 852 };
  const tablet = { width: 800, height: 1280 };
  const tabletLandscape = { width: 1280, height: 800 };

  it('a phone (already portrait from its manifest) is read once and never changed', async () => {
    const device = fakeActivity('portrait');
    const controller = createOrientationController(device.api, 'android');
    await controller.sync(phone);
    await controller.sync(phone);
    expect(device.api.current).toHaveBeenCalledTimes(1);
    expect(device.api.request).not.toHaveBeenCalled();
  });

  it('a tablet is unlocked once; rotating it (sides swap) makes no further native call', async () => {
    const device = fakeActivity('portrait');
    const controller = createOrientationController(device.api, 'android');
    await controller.sync(tablet);
    expect(device.api.request).toHaveBeenCalledExactlyOnceWith('any');
    await controller.sync(tabletLandscape);
    await controller.sync(tablet);
    expect(device.api.current).toHaveBeenCalledTimes(1);
    expect(device.api.request).toHaveBeenCalledTimes(1);
  });

  it('a foldable: unfolded unlocks, folded locks portrait again', async () => {
    const device = fakeActivity('portrait');
    const controller = createOrientationController(device.api, 'android');
    await controller.sync({ width: 673, height: 841 });
    expect(device.current).toBe('any');
    await controller.sync({ width: 344, height: 882 });
    expect(device.current).toBe('portrait');
    expect(device.api.request.mock.calls).toEqual([['any'], ['portrait']]);
  });

  it('returning to the foreground re-reads the activity, correcting one the system recreated (back on the manifest portrait)', async () => {
    const device = fakeActivity('portrait');
    const controller = createOrientationController(device.api, 'android');
    await controller.sync(tablet);
    device.api.request.mockClear();
    await device.api.request('portrait'); // the recreated activity
    device.api.request.mockClear();
    await controller.sync(tablet, true);
    expect(device.api.request).toHaveBeenCalledExactlyOnceWith('any');
    await controller.sync(tablet, true);
    expect(device.api.request).toHaveBeenCalledTimes(1);
  });

  it('a failed call is retried on the next sync; calls never overlap', async () => {
    const device = fakeActivity('portrait');
    device.api.request.mockRejectedValueOnce(new Error('no activity'));
    const controller = createOrientationController(device.api, 'android');
    await controller.sync(tablet);
    expect(device.current).toBe('portrait');
    await controller.sync(tablet);
    expect(device.current).toBe('any');
  });

  it('iOS: never calls native code', async () => {
    const device = fakeActivity('other');
    const controller = createOrientationController(device.api, 'ios');
    await controller.sync({ width: 820, height: 1180 }, true);
    expect(device.api.current).not.toHaveBeenCalled();
    expect(device.api.request).not.toHaveBeenCalled();
  });
});

describe('the policy is applied at the root, from the screen (not the window), on Android only', () => {
  const hook = readFileSync(resolve(__dirname, '../src/layout/useDeviceOrientationPolicy.ts'), 'utf-8');
  const root = readFileSync(resolve(__dirname, '../src/app/_layout.tsx'), 'utf-8');

  it('reads Dimensions "screen", never "window"', () => {
    expect(hook).toMatch(/Dimensions\.get\('screen'\)/);
    expect(hook).not.toMatch(/Dimensions\.get\('window'\)|useWindowDimensions/);
    expect(hook).toMatch(/if \(Platform\.OS !== 'android'\) return undefined;/);
    // Loaded only where the binary has the native module: an older binary keeps the manifest's portrait instead of failing.
    expect(hook).toMatch(/if \(!requireOptionalNativeModule\('ExpoScreenOrientation'\)\) return null;/);
    expect(hook).not.toMatch(/^import .*expo-screen-orientation/m);
  });

  it('runs once in the themed root', () => {
    expect(root.match(/useDeviceOrientationPolicy\(\);/g)).toHaveLength(1);
  });
});
