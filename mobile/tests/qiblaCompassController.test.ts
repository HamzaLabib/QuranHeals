import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HEADING_RETRY_DELAYS_MS, READY_DWELL_MS, STALE_READING_MS } from '@/qibla/compassReliability';
import type { RawHeadingEvent } from '@/qibla/headingNormalize';
import type { LocationFix, LocationPermission, LocationSource, QiblaPlatform } from '@/qibla/locationSourceTypes';
import {
  CURRENT_FIX_TIMEOUT_MS,
  FIX_REUSE_MS,
  SNAPSHOT_THROTTLE_MS,
  createQiblaCompassController,
  type QiblaCompassController,
  type QiblaSnapshot,
} from '@/qibla/qiblaCompassController';
import { destinationPoint, KAABA } from '@/qibla/qiblaMath';

const CAIRO: LocationFix = { coordinates: { latitude: 30.0444, longitude: 31.2357 }, accuracyMeters: 20 };
const CAIRO_QIBLA = 136.137;

type Fake = {
  source: LocationSource;
  permission: LocationPermission;
  requestResult: LocationPermission;
  services: boolean;
  lastKnown: LocationFix | null;
  current: LocationFix | null | 'never' | 'reject';
  watchMode: 'resolve' | 'reject' | 'defer';
  calls: { getPermission: number; request: number; lastKnown: number; current: number; watch: number; remove: number };
  /** The latest stream's event and error callbacks. */
  emit: (event: Partial<RawHeadingEvent>) => void;
  fail: (reason?: string) => void;
  /** Every stream's event callback, oldest first (to send events to a stream that should be dead). */
  emitters: ((event: RawHeadingEvent) => void)[];
  resolveDeferred: () => void;
};

function makeFake(platform: QiblaPlatform = 'ios'): Fake {
  const fake = {
    permission: { status: 'granted', canAskAgain: true },
    requestResult: { status: 'granted', canAskAgain: true },
    services: true,
    lastKnown: CAIRO,
    current: null,
    watchMode: 'resolve',
    calls: { getPermission: 0, request: 0, lastKnown: 0, current: 0, watch: 0, remove: 0 },
    emitters: [],
  } as unknown as Fake;
  let onEvent: (event: RawHeadingEvent) => void = () => undefined;
  let onError: (reason: string) => void = () => undefined;
  fake.emit = (event) => onEvent({ trueHeading: 0, magHeading: 0, accuracy: 3, ...event });
  fake.fail = (reason = 'heading failure') => onError(reason);
  fake.resolveDeferred = () => undefined;
  const subscription = () => ({ remove: () => void (fake.calls.remove += 1) });
  fake.source = {
    platform,
    headingSupported: platform !== 'web',
    getPermission: async () => {
      fake.calls.getPermission += 1;
      return fake.permission;
    },
    requestPermission: async () => {
      fake.calls.request += 1;
      fake.permission = fake.requestResult;
      return fake.requestResult;
    },
    servicesEnabled: async () => fake.services,
    getLastKnownFix: async () => {
      fake.calls.lastKnown += 1;
      return fake.lastKnown;
    },
    getCurrentFix: () => {
      fake.calls.current += 1;
      if (fake.current === 'never') return new Promise(() => undefined);
      if (fake.current === 'reject') return Promise.reject(new Error('no fix'));
      return Promise.resolve(fake.current);
    },
    watchHeading: (eventCallback, errorCallback) => {
      fake.calls.watch += 1;
      onEvent = eventCallback;
      onError = errorCallback;
      fake.emitters.push(eventCallback);
      if (fake.watchMode === 'reject') return Promise.reject(new Error('HeadingUnavailable'));
      if (fake.watchMode === 'defer') return new Promise((resolve) => (fake.resolveDeferred = () => resolve(subscription())));
      return Promise.resolve(subscription());
    },
  };
  return fake;
}

let controller: QiblaCompassController | null = null;
let snapshots: QiblaSnapshot[] = [];

function start(fake: Fake, options: { largeScreen?: boolean; active?: boolean } = {}) {
  controller = createQiblaCompassController({
    source: fake.source,
    now: () => Date.now(),
    timers: { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    largeScreen: options.largeScreen ?? false,
  });
  snapshots = [];
  controller.subscribe((s) => snapshots.push(s));
  if (options.active !== false) controller.setActive(true);
  return controller;
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const snap = () => controller!.getSnapshot();

/** Best-calibration readings re-reported across the dwell (iOS: ready). */
async function readyReadings(fake: Fake, heading = CAIRO_QIBLA) {
  fake.emit({ trueHeading: heading, accuracy: 3 });
  await advance(1_000);
  fake.emit({ trueHeading: heading, accuracy: 3 });
  await advance(READY_DWELL_MS);
  fake.emit({ trueHeading: heading, accuracy: 3 });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
});

afterEach(() => {
  controller?.dispose();
  controller = null;
  vi.useRealTimers();
});

describe('permission: requested only from a user action', () => {
  it('never asked: needsRequest, and nothing is requested, located or watched by itself', async () => {
    const fake = makeFake();
    fake.permission = { status: 'undetermined', canAskAgain: true };
    start(fake);
    await flush();
    expect(snap().permission).toBe('needsRequest');
    expect(fake.calls).toMatchObject({ request: 0, lastKnown: 0, current: 0, watch: 0 });
    expect(snap().compass).toMatchObject({ state: 'unavailable', reasons: ['noBearing'] });
  });

  it('requestPermission (the button): asks once, then locates and starts the heading', async () => {
    const fake = makeFake();
    fake.permission = { status: 'undetermined', canAskAgain: true };
    start(fake);
    await flush();
    await controller!.requestPermission();
    await flush();
    expect(fake.calls.request).toBe(1);
    expect(snap().permission).toBe('granted');
    expect(snap().location).toBe('located');
    expect(fake.calls.watch).toBe(1);
  });

  it('refused but askable: denied; refused for good: blocked (Settings only, the request is never shown)', async () => {
    const fake = makeFake();
    fake.permission = { status: 'undetermined', canAskAgain: true };
    fake.requestResult = { status: 'denied', canAskAgain: true };
    start(fake);
    await flush();
    await controller!.requestPermission();
    expect(snap().permission).toBe('denied');
    fake.requestResult = { status: 'denied', canAskAgain: false };
    await controller!.requestPermission();
    expect(snap().permission).toBe('blocked');
    await controller!.requestPermission();
    expect(fake.calls.request).toBe(2); // not shown again once blocked
    expect(fake.calls.watch).toBe(0);
    expect(snap().compass.reasons).toEqual(['noBearing']);
  });

  it('is ignored while the screen is not active, and when already granted', async () => {
    const fake = makeFake();
    fake.permission = { status: 'undetermined', canAskAgain: true };
    start(fake, { active: false });
    await controller!.requestPermission();
    expect(fake.calls.request).toBe(0);
    fake.permission = { status: 'granted', canAskAgain: true };
    controller!.setActive(true);
    await flush();
    await controller!.requestPermission();
    expect(fake.calls.request).toBe(0);
  });

  it('re-checks on every activation (it may have changed in Settings)', async () => {
    const fake = makeFake();
    fake.permission = { status: 'denied', canAskAgain: false };
    start(fake);
    await flush();
    expect(snap().permission).toBe('blocked');
    controller!.setActive(false);
    fake.permission = { status: 'granted', canAskAgain: true };
    controller!.setActive(true);
    await flush();
    expect(snap().permission).toBe('granted');
    expect(fake.calls.getPermission).toBe(2);
    expect(fake.calls.watch).toBe(1);
  });

  it('web: unsupported, no permission call, no heading; a chosen city still gives the bearing', async () => {
    const fake = makeFake('web');
    start(fake);
    await flush();
    expect(snap().permission).toBe('unsupported');
    expect(fake.calls.getPermission).toBe(0);
    controller!.chooseManualPosition({ coordinates: CAIRO.coordinates, accuracyMeters: 30_000, label: 'Cairo' });
    await flush();
    expect(snap().qibla).toMatchObject({ kind: 'bearing' });
    expect(snap().compass).toMatchObject({ state: 'unavailable', reasons: ['noHeadingSupport'] });
    expect(fake.calls.watch).toBe(0);
  });
});

describe('position: one fix, no continuous watching', () => {
  it('a cached fix is used without asking for a new one', async () => {
    const fake = makeFake();
    start(fake);
    await flush();
    expect(fake.calls).toMatchObject({ lastKnown: 1, current: 0 });
    expect(snap().qibla).toMatchObject({ kind: 'bearing' });
    expect((snap().qibla as { bearing: number }).bearing).toBeCloseTo(CAIRO_QIBLA, 2);
  });

  it('no cached fix: one balanced fix; it is reused for FIX_REUSE_MS across visits, then renewed', async () => {
    const fake = makeFake();
    fake.lastKnown = null;
    fake.current = CAIRO;
    start(fake);
    await flush();
    expect(fake.calls.current).toBe(1);
    controller!.setActive(false);
    controller!.setActive(true);
    await flush();
    expect(fake.calls.current).toBe(1);
    controller!.setActive(false);
    await advance(FIX_REUSE_MS);
    controller!.setActive(true);
    await flush();
    expect(fake.calls.current).toBe(2);
  });

  it('a fix that never comes times out after CURRENT_FIX_TIMEOUT_MS: unavailable, no heading; Try Again asks again', async () => {
    const fake = makeFake();
    fake.lastKnown = null;
    fake.current = 'never';
    start(fake);
    await flush();
    expect(snap().location).toBe('locating');
    await advance(CURRENT_FIX_TIMEOUT_MS);
    expect(snap().location).toBe('unavailable');
    expect(fake.calls.watch).toBe(0);
    fake.current = CAIRO;
    controller!.retry();
    await flush();
    expect(snap().location).toBe('located');
    expect(fake.calls.watch).toBe(1);
  });

  it('a failing fix: unavailable', async () => {
    const fake = makeFake();
    fake.lastKnown = null;
    fake.current = 'reject';
    start(fake);
    await flush();
    expect(snap().location).toBe('unavailable');
  });

  it('location services off: servicesOff, and no fix is attempted', async () => {
    const fake = makeFake();
    fake.services = false;
    start(fake);
    await flush();
    expect(snap().location).toBe('servicesOff');
    expect(fake.calls).toMatchObject({ lastKnown: 0, current: 0, watch: 0 });
  });

  it('at the Kaaba: no bearing and no heading stream', async () => {
    const fake = makeFake();
    fake.lastKnown = { coordinates: destinationPoint(KAABA, 90, 30), accuracyMeters: 10 };
    start(fake);
    await flush();
    expect(snap().qibla).toMatchObject({ kind: 'atKaaba' });
    expect(snap().compass.reasons).toEqual(['noBearing']);
    expect(fake.calls.watch).toBe(0);
  });

  it('the snapshot never carries the coordinates', async () => {
    const fake = makeFake();
    start(fake);
    await flush();
    await readyReadings(fake);
    for (const s of [...snapshots, snap()]) {
      const text = JSON.stringify(s);
      expect(text).not.toMatch(/30\.04|31\.23|latitude|longitude|coordinates/);
    }
  });
});

describe('heading lifecycle: only while active, always cleaned up', () => {
  it('starts after the fix, stops on deactivate, restarts on activate', async () => {
    const fake = makeFake();
    start(fake);
    await flush();
    expect(fake.calls.watch).toBe(1);
    controller!.setActive(false);
    expect(fake.calls.remove).toBe(1);
    expect(snap().active).toBe(false);
    controller!.setActive(true);
    await flush();
    expect(fake.calls.watch).toBe(2);
  });

  it('a stream that finishes starting after the screen was left is removed at once', async () => {
    const fake = makeFake();
    fake.watchMode = 'defer';
    start(fake);
    await flush();
    expect(fake.calls.watch).toBe(1);
    controller!.setActive(false);
    fake.resolveDeferred();
    await flush();
    expect(fake.calls.remove).toBe(1);
  });

  it('events from a removed stream are ignored', async () => {
    const fake = makeFake();
    start(fake);
    await flush();
    const oldStream = fake.emitters[0];
    controller!.setActive(false);
    controller!.setActive(true);
    await flush();
    oldStream({ trueHeading: 10, magHeading: 0, accuracy: 3 });
    await flush();
    expect(snap().compass.reasons).toEqual(['starting']);
    expect(snap().heading).toBeNull();
  });

  it('dispose removes the stream, clears every timer and stops notifying', async () => {
    const fake = makeFake();
    start(fake);
    await flush();
    fake.emit({ trueHeading: 100, accuracy: 3 });
    await flush();
    const count = snapshots.length;
    controller!.dispose();
    expect(fake.calls.remove).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    fake.emit({ trueHeading: 120, accuracy: 3 });
    await advance(60_000);
    expect(snapshots.length).toBe(count);
  });

  it('leaves no timers behind when inactive (no polling, nothing waking the phone)', async () => {
    const fake = makeFake();
    start(fake);
    await flush();
    await readyReadings(fake);
    controller!.setActive(false);
    await advance(SNAPSHOT_THROTTLE_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Android large screens: bearing only, the heading is never watched (N3)', async () => {
    const fake = makeFake('android');
    start(fake, { largeScreen: true });
    await flush();
    expect(snap().qibla).toMatchObject({ kind: 'bearing' });
    expect(snap().compass).toMatchObject({ state: 'unavailable', reasons: ['noHeadingSupport'] });
    expect(fake.calls.watch).toBe(0);
  });

  it('iPad: watched, but capped at approximate (orientation unverified)', async () => {
    const fake = makeFake('ios');
    start(fake, { largeScreen: true });
    await flush();
    await readyReadings(fake);
    expect(snap().compass).toMatchObject({ state: 'approximate', reasons: ['orientationUnverified'] });
    expect(snap().aligned).toBe(false);
  });
});

describe('silence and missing events', () => {
  it('no event: starting → move-your-phone nudge at 4 s → unavailable at 12 s, by timers alone', async () => {
    const fake = makeFake();
    start(fake);
    await flush();
    expect(snap().compass.reasons).toEqual(['starting']);
    await advance(4_000);
    expect(snap().compass.reasons).toEqual(['waitingForMovement']);
    await advance(8_000);
    expect(snap().compass).toMatchObject({ state: 'unavailable', reasons: ['noHeadingEvents'], needle: 'hidden' });
  });

  it('a ready compass goes stale after STALE_READING_MS without readings; the "lined up" indication goes with it', async () => {
    const fake = makeFake();
    start(fake);
    await flush();
    await readyReadings(fake);
    expect(snap().compass.state).toBe('ready');
    expect(snap().aligned).toBe(true);
    await advance(STALE_READING_MS);
    expect(snap().compass).toMatchObject({ state: 'approximate', reasons: ['refreshNeeded'] });
    expect(snap().aligned).toBe(false);
    fake.emit({ trueHeading: CAIRO_QIBLA, accuracy: 3 }); // one fresh reading: the dwell must be re-earned
    await flush();
    expect(snap().compass.reasons).toEqual(['settling']);
  });
});

describe('true heading only, by platform', () => {
  it('Android: -1 before the declination field means no true north; the magnetic heading is never used', async () => {
    const fake = makeFake('android');
    start(fake);
    await flush();
    fake.emit({ trueHeading: -1, magHeading: 120, accuracy: 3 });
    await flush();
    expect(snap().heading).toBeNull();
    expect(snap().compass.reasons).toEqual(['waitingForTrueHeading']);
    await advance(12_000);
    expect(snap().compass).toMatchObject({ state: 'unavailable', reasons: ['noTrueHeading'] });
  });

  it('Android: once true north exists, a negative value is a real heading', async () => {
    const fake = makeFake('android');
    start(fake);
    await flush();
    fake.emit({ trueHeading: 10, accuracy: 2 });
    await flush();
    fake.emit({ trueHeading: -4, accuracy: 2 });
    await advance(5_000); // let the smoothing settle
    fake.emit({ trueHeading: -4, accuracy: 2 });
    await flush();
    expect(snap().heading).toBeCloseTo(356, 0);
  });

  it('Android: perfect readings are still capped at approximate (accuracy untrusted); never "lined up"', async () => {
    const fake = makeFake('android');
    start(fake);
    await flush();
    await readyReadings(fake);
    expect(snap().compass).toMatchObject({ state: 'approximate', reasons: ['accuracyUntrusted'], needle: 'dimmed' });
    expect(snap().aligned).toBe(false);
    expect(snap().turn).toEqual({ direction: 'ahead', degrees: 0 });
  });

  it('iOS: ready only after the best calibration is re-reported across the dwell; then "lined up" within 5°', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    fake.emit({ trueHeading: CAIRO_QIBLA, accuracy: 3 });
    await flush();
    expect(snap().compass.reasons).toEqual(['settling']);
    expect(snap().aligned).toBe(false);
    await advance(READY_DWELL_MS + 1_000); // time alone does not confirm
    expect(snap().compass.state).toBe('approximate');
    fake.emit({ trueHeading: CAIRO_QIBLA, accuracy: 3 });
    await flush();
    expect(snap().compass.state).toBe('ready');
    expect(snap().aligned).toBe(true);
  });

  it('iOS: a reading without true north hides the needle at once (no old direction kept)', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    await readyReadings(fake);
    fake.emit({ trueHeading: -1, accuracy: 3 });
    await flush();
    expect(snap().heading).toBeNull();
    expect(snap().compass).toMatchObject({ state: 'calibrate', needle: 'hidden' });
    expect(snap().aligned).toBe(false);
  });

  it('calibration level 0 hides the needle; 1–2 dim it', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    fake.emit({ trueHeading: 100, accuracy: 0 });
    await flush();
    expect(snap().compass).toMatchObject({ state: 'calibrate', reasons: ['uncalibrated'], needle: 'hidden' });
    expect(snap().turn).toBeNull();
    fake.emit({ trueHeading: 100, accuracy: 2 });
    await flush();
    expect(snap().compass).toMatchObject({ state: 'approximate', reasons: ['lowAccuracy'], needle: 'dimmed' });
    expect(snap().turn).toMatchObject({ direction: 'right' });
  });
});

describe('"Lined up with the Qibla bearing": hysteresis, ready only', () => {
  it('enters within 5°, stays within 8°, leaves beyond 8°', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    const at = async (heading: number) => {
      // Many readings so the smoothing reaches the heading.
      for (let i = 0; i < 20; i += 1) {
        fake.emit({ trueHeading: heading, accuracy: 3 });
        await advance(200);
      }
    };
    await at(CAIRO_QIBLA - 6);
    expect(snap().compass.state).toBe('ready');
    expect(snap().aligned).toBe(false);
    await at(CAIRO_QIBLA - 4);
    expect(snap().aligned).toBe(true);
    await at(CAIRO_QIBLA - 7.5);
    expect(snap().aligned).toBe(true);
    await at(CAIRO_QIBLA - 9);
    expect(snap().aligned).toBe(false);
  });
});

describe('stream errors and retries', () => {
  it('iOS cannot start the stream: retries after 2, 4, 8, 8, 8 s, then unavailable; Try Again starts over', async () => {
    const fake = makeFake('ios');
    fake.watchMode = 'reject';
    start(fake);
    await flush();
    expect(fake.calls.watch).toBe(1);
    expect(snap().headingRetry).toEqual({ attempt: 1 });
    for (const [i, delay] of HEADING_RETRY_DELAYS_MS.entries()) {
      await advance(delay - 1);
      expect(fake.calls.watch).toBe(i + 1);
      await advance(1);
      expect(fake.calls.watch).toBe(i + 2);
    }
    expect(snap().compass).toMatchObject({ state: 'unavailable', reasons: ['streamFailed'] });
    expect(snap().headingRetry).toBeNull();
    await advance(60_000);
    expect(fake.calls.watch).toBe(HEADING_RETRY_DELAYS_MS.length + 1); // gave up: no more attempts
    fake.watchMode = 'resolve';
    controller!.retry();
    await flush();
    expect(fake.calls.watch).toBe(HEADING_RETRY_DELAYS_MS.length + 2);
    expect(snap().compass.reasons).toEqual(['starting']);
  });

  it('a stream that ends with an error (interference) is removed, the needle hidden, and restarted after 2 s', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    await readyReadings(fake);
    fake.fail();
    await flush();
    expect(fake.calls.remove).toBe(1);
    expect(snap().compass.needle).toBe('hidden');
    expect(snap().aligned).toBe(false);
    await advance(2_000);
    expect(fake.calls.watch).toBe(2);
    // Back, but within RECENT_ERROR_MS of the error: approximate at best.
    await readyReadings(fake);
    expect(snap().compass.state).toBe('ready'); // 3+ s of readings after a 2 s wait: the error is 5 s old
  });

  it('a stream that fails right after every reading is not restarted forever (at most 5 restarts per visit)', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    for (let i = 0; i < 10; i += 1) {
      fake.emit({ trueHeading: 100, accuracy: 3 });
      fake.fail();
      await advance(10_000);
    }
    expect(fake.calls.watch).toBe(HEADING_RETRY_DELAYS_MS.length + 1);
    expect(snap().compass.reasons).toEqual(['streamFailed']);
  });

  it('leaving the screen cancels a pending retry; coming back starts fresh', async () => {
    const fake = makeFake('ios');
    fake.watchMode = 'reject';
    start(fake);
    await flush();
    controller!.setActive(false);
    await advance(30_000);
    expect(fake.calls.watch).toBe(1);
    fake.watchMode = 'resolve';
    controller!.setActive(true);
    await flush();
    expect(fake.calls.watch).toBe(2);
    expect(snap().headingRetry).toBeNull();
  });
});

describe('manual position (a chosen city)', () => {
  it('gives the bearing and a live but capped compass when the heading is available (never ready)', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    controller!.chooseManualPosition({ coordinates: { latitude: 48.8566, longitude: 2.3522 }, accuracyMeters: 30_000, label: 'Paris' });
    await flush();
    await readyReadings(fake, 119);
    expect(snap()).toMatchObject({ positionSource: 'manual', manualLabel: 'Paris' });
    expect(snap().compass).toMatchObject({ state: 'approximate', reasons: ['manualPosition'] });
    expect(snap().aligned).toBe(false);
  });

  it('without permission: bearing only (no stream)', async () => {
    const fake = makeFake('ios');
    fake.permission = { status: 'denied', canAskAgain: false };
    start(fake);
    await flush();
    controller!.chooseManualPosition({ coordinates: { latitude: 48.8566, longitude: 2.3522 }, accuracyMeters: 30_000, label: 'Paris' });
    await flush();
    expect(snap().qibla).toMatchObject({ kind: 'bearing' });
    expect(snap().compass).toMatchObject({ state: 'unavailable', reasons: ['noPermission'] });
    expect(fake.calls.watch).toBe(0);
  });

  it('switching back to the device position starts the readings over', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    controller!.chooseManualPosition({ coordinates: { latitude: 48.8566, longitude: 2.3522 }, accuracyMeters: 30_000, label: 'Paris' });
    await flush();
    controller!.chooseDevicePosition();
    await flush();
    expect(snap().positionSource).toBe('device');
    expect(fake.calls.remove).toBeGreaterThanOrEqual(2);
    expect(snap().compass.reasons).toEqual(['starting']);
  });

  it('rejects invalid coordinates', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    controller!.chooseManualPosition({ coordinates: { latitude: 120, longitude: 0 }, accuracyMeters: 30_000, label: 'x' });
    expect(snap().positionSource).toBe('device');
  });
});

describe('notifications: structure at once, heading text throttled, every reading to the dial', () => {
  it('heading-only changes reach listeners at most every SNAPSHOT_THROTTLE_MS; the dial gets every reading', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    fake.emit({ trueHeading: 90, accuracy: 2 });
    await flush();
    const frames: number[] = [];
    controller!.onFrame((f) => frames.push(f.heading));
    const before = snapshots.length;
    for (let i = 1; i <= 20; i += 1) {
      fake.emit({ trueHeading: 90 + i * 0.1, accuracy: 2 });
      await advance(10);
    }
    expect(frames).toHaveLength(20);
    expect(snapshots.length - before).toBeLessThanOrEqual(2);
    await advance(SNAPSHOT_THROTTLE_MS);
    expect(snapshots.at(-1)!.heading).toBeCloseTo(snap().heading!, 6);
  });

  it('the dial rotation is unwrapped across north (no 340° spin)', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    const rotations: number[] = [];
    controller!.onFrame((f) => rotations.push(f.dialRotation));
    for (const heading of [350, 355, 0, 5, 10, 5, 0, 355, 350]) {
      fake.emit({ trueHeading: heading, accuracy: 2 });
      await advance(1_000);
    }
    for (let i = 1; i < rotations.length; i += 1) expect(Math.abs(rotations[i] - rotations[i - 1])).toBeLessThan(30);
  });
});

describe('silence after a valid heading (Android sends nothing while the phone is still)', () => {
  it('is "quiet": asks for a small movement, keeps the last direction dimmed, and never claims poor calibration', async () => {
    const fake = makeFake('android');
    start(fake);
    await flush();
    fake.emit({ trueHeading: 100, accuracy: 3 });
    await advance(1_000);
    fake.emit({ trueHeading: 100, accuracy: 3 });
    await advance(STALE_READING_MS);
    const d = controller!.getDiagnostics();
    expect(d.compass).toMatchObject({ state: 'approximate', needle: 'dimmed' });
    expect(d.compass.reasons).toContain('refreshNeeded');
    expect(d.compass.reasons).not.toContain('lowAccuracy');
    expect(d.compass.reasons).not.toContain('uncalibrated');
    expect(d.condition).toBe('quiet');
    expect(snap().heading).toBeCloseTo(100, 0); // the last direction is kept (dimmed), not thrown away
  });

  it('iOS: after a quiet spell, ready needs fresh evidence (the dwell is re-earned), never time alone', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    await readyReadings(fake);
    expect(snap().compass.state).toBe('ready');
    await advance(STALE_READING_MS);
    expect(controller!.getDiagnostics().condition).toBe('quiet');
    await advance(60_000);
    expect(snap().compass.state).toBe('approximate'); // still: time alone restores nothing
    fake.emit({ trueHeading: CAIRO_QIBLA, accuracy: 3 });
    await flush();
    expect(snap().compass.reasons).toEqual(['settling']);
    await advance(READY_DWELL_MS);
    fake.emit({ trueHeading: CAIRO_QIBLA, accuracy: 3 });
    await flush();
    expect(snap().compass.state).toBe('ready');
  });

  it('a pending restart after an error reads as a sensor error, not as "no heading yet"', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    fake.fail('Heading failure');
    await flush();
    expect(snap().compass).toMatchObject({ state: 'calibrate', reasons: ['sensorErrorRetrying'], needle: 'hidden' });
    expect(controller!.getDiagnostics().condition).toBe('sensorError');
  });
});

describe('diagnostics read-out (development panel)', () => {
  it('raw true and magnetic heading, their difference, accuracy, event timing; the magnetic value is not used', async () => {
    const fake = makeFake('android');
    start(fake);
    await flush();
    fake.emit({ trueHeading: 103.5, magHeading: 98, accuracy: 2 });
    await advance(1_500);
    const d = controller!.getDiagnostics();
    expect(d.heading).toMatchObject({ rawTrueHeading: 103.5, rawMagHeading: 98, rawAccuracy: 2, trueHeading: 103.5, eventsThisSubscription: 1, androidTrueNorthSeen: true, subscribed: true });
    expect(d.heading.trueMinusMagneticDeg).toBeCloseTo(5.5, 6);
    expect(d.heading.msSinceLastEvent).toBe(1_500);
    expect(d.heading.eventsLastFiveSeconds).toBe(1);
    expect(d).toMatchObject({ platform: 'android', accuracyTrusted: false, orientationVerified: true, largeScreen: false, headingSupported: true, permission: 'granted', location: 'located' });
  });

  it('Android -1 before true north: no true heading and no difference shown', async () => {
    const fake = makeFake('android');
    start(fake);
    await flush();
    fake.emit({ trueHeading: -1, magHeading: 98, accuracy: 3 });
    await flush();
    const d = controller!.getDiagnostics();
    expect(d.heading).toMatchObject({ rawTrueHeading: -1, trueHeading: null, trueMinusMagneticDeg: null, androidTrueNorthSeen: false });
  });

  it('errors and retries: count, consecutive failures of the maximum, pending retry, last reason', async () => {
    const fake = makeFake('ios');
    fake.watchMode = 'reject';
    start(fake);
    await flush();
    await advance(500);
    const d = controller!.getDiagnostics();
    expect(d.errors).toMatchObject({ total: 1, consecutiveFailures: 1, maxRetries: HEADING_RETRY_DELAYS_MS.length, retryPending: true, streamFailed: false, lastReason: 'HeadingUnavailable', msSinceLastError: 500 });
  });

  it('the fix: whether one is held, its accuracy radius and age; never where it is, never the distance', async () => {
    const fake = makeFake('ios');
    start(fake);
    await flush();
    await advance(2_000);
    const d = controller!.getDiagnostics();
    expect(d.position).toEqual({ source: 'device', deviceFixAvailable: true, deviceFixAccuracyMeters: 20, deviceFixAgeMs: 2_000, manualLabel: null });
    expect(d.qibla).toEqual({ kind: 'bearing', bearing: expect.any(Number) });
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/30\.04|31\.23|latitude|longitude|coordinates|distance/i);
  });
});
