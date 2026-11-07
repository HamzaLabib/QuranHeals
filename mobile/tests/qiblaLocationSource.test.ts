import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The native boundary (src/qibla/locationSource.native.ts) against a mocked expo-location: foreground permission
 * only, one balanced fix, the heading passed through untouched (headingNormalize.ts decides what it means), and
 * the default (web/test) source with no location at all.
 */

const expoLocation = vi.hoisted(() => ({
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  requestBackgroundPermissionsAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
  watchHeadingAsync: vi.fn(),
  startLocationUpdatesAsync: vi.fn(),
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}));
vi.mock('expo-location', () => expoLocation);
const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({ Platform: platform }));

const location = (latitude: number, longitude: number, accuracy: number | null) => ({ coords: { latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: 0 });

beforeEach(() => {
  vi.resetModules();
  for (const fn of Object.values(expoLocation)) if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset();
  platform.OS = 'ios';
});

describe('locationSource.native', () => {
  it('reports its platform; heading supported', async () => {
    const { locationSource } = await import('@/qibla/locationSource.native');
    expect(locationSource.platform).toBe('ios');
    expect(locationSource.headingSupported).toBe(true);
    platform.OS = 'android';
    vi.resetModules();
    expect((await import('@/qibla/locationSource.native')).locationSource.platform).toBe('android');
  });

  it('maps the permission responses; uses FOREGROUND permission only', async () => {
    const { locationSource } = await import('@/qibla/locationSource.native');
    expoLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true, granted: false, expires: 'never' });
    expect(await locationSource.getPermission()).toEqual({ status: 'undetermined', canAskAgain: true });
    expoLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false, granted: false, expires: 'never' });
    expect(await locationSource.requestPermission()).toEqual({ status: 'denied', canAskAgain: false });
    expoLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true, granted: true, expires: 'never' });
    expect(await locationSource.getPermission()).toEqual({ status: 'granted', canAskAgain: true });
    expect(expoLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('one cached fix with the requested age and accuracy; one balanced fix; never a continuous watch', async () => {
    const { locationSource } = await import('@/qibla/locationSource.native');
    expoLocation.getLastKnownPositionAsync.mockResolvedValue(location(30.0444, 31.2357, 25));
    expect(await locationSource.getLastKnownFix(600_000, 5_000)).toEqual({ coordinates: { latitude: 30.0444, longitude: 31.2357 }, accuracyMeters: 25 });
    expect(expoLocation.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 600_000, requiredAccuracy: 5_000 });
    expoLocation.getCurrentPositionAsync.mockResolvedValue(location(51.5, -0.12, null));
    expect(await locationSource.getCurrentFix()).toEqual({ coordinates: { latitude: 51.5, longitude: -0.12 }, accuracyMeters: null });
    expect(expoLocation.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: expoLocation.Accuracy.Balanced });
    expect(expoLocation.watchPositionAsync).not.toHaveBeenCalled();
    expect(expoLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('no cached fix: null; a negative or missing accuracy becomes unknown (null), never 0', async () => {
    const { locationSource } = await import('@/qibla/locationSource.native');
    expoLocation.getLastKnownPositionAsync.mockResolvedValue(null);
    expect(await locationSource.getLastKnownFix(1, 1)).toBeNull();
    expoLocation.getCurrentPositionAsync.mockResolvedValue(location(1, 2, -1));
    expect((await locationSource.getCurrentFix())!.accuracyMeters).toBeNull();
  });

  it('services check passes through', async () => {
    const { locationSource } = await import('@/qibla/locationSource.native');
    expoLocation.hasServicesEnabledAsync.mockResolvedValue(false);
    expect(await locationSource.servicesEnabled()).toBe(false);
  });

  it('the heading is passed through untouched (true, magnetic, accuracy); errors and the subscription too', async () => {
    const { locationSource } = await import('@/qibla/locationSource.native');
    const remove = vi.fn();
    let callback: (h: { trueHeading: number; magHeading: number; accuracy: number }) => void = () => undefined;
    let errorHandler: (reason: string) => void = () => undefined;
    expoLocation.watchHeadingAsync.mockImplementation(async (cb, err) => {
      callback = cb;
      errorHandler = err;
      return { remove };
    });
    const events: unknown[] = [];
    const errors: string[] = [];
    const subscription = await locationSource.watchHeading((e) => events.push(e), (r) => errors.push(r));
    callback({ trueHeading: -1, magHeading: 120, accuracy: 3 });
    errorHandler('Heading failure');
    expect(events).toEqual([{ trueHeading: -1, magHeading: 120, accuracy: 3 }]);
    expect(errors).toEqual(['Heading failure']);
    subscription.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('a heading that cannot start rejects (the controller retries)', async () => {
    const { locationSource } = await import('@/qibla/locationSource.native');
    expoLocation.watchHeadingAsync.mockRejectedValue(new Error('HeadingUnavailable'));
    await expect(locationSource.watchHeading(() => undefined, () => undefined)).rejects.toThrow('HeadingUnavailable');
  });
});

describe('locationSource (web and tests): no location at all', () => {
  it('has no heading, no permission, no fix', async () => {
    const { locationSource } = await import('@/qibla/locationSource');
    expect(locationSource.platform).toBe('web');
    expect(locationSource.headingSupported).toBe(false);
    expect(await locationSource.getPermission()).toEqual({ status: 'denied', canAskAgain: false });
    expect(await locationSource.getLastKnownFix(1, 1)).toBeNull();
    expect(await locationSource.getCurrentFix()).toBeNull();
    await expect(locationSource.watchHeading(() => undefined, () => undefined)).rejects.toThrow();
    expect(expoLocation.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});
