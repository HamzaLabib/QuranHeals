import type { RawHeadingEvent } from './headingNormalize';
import type { Coordinates } from './qiblaMath';

/**
 * The one boundary between the Qibla feature and the platform's location and compass (docs/qibla.md). The native
 * implementation (locationSource.native.ts) is the only file that imports expo-location; the default one
 * (locationSource.ts: web and tests) has no location at all. The controller (qiblaCompassController.ts) only ever sees
 * this interface, so its whole lifecycle is tested with fakes.
 *
 * Privacy: a fix's coordinates go from here to the controller's memory and nowhere else: no logging, storage, network
 * or synchronisation (enforced by tests/qiblaPrivacy.test.ts).
 */

export type QiblaPlatform = 'ios' | 'android' | 'web';

export type LocationPermission = {
  status: 'granted' | 'denied' | 'undetermined';
  /** False once the system will no longer show the request (the user must use Settings). */
  canAskAgain: boolean;
};

export type LocationFix = {
  coordinates: Coordinates;
  /** Horizontal accuracy radius in metres, when the platform reports one. */
  accuracyMeters: number | null;
};

export type HeadingSubscription = { remove(): void };

export interface LocationSource {
  readonly platform: QiblaPlatform;
  /** Whether this build can watch the heading at all (false on web). A device may still have no magnetometer. */
  readonly headingSupported: boolean;
  getPermission(): Promise<LocationPermission>;
  /** Shows the system request. Call only from a user action (the screen's explanation card). */
  requestPermission(): Promise<LocationPermission>;
  /** Whether the device's location services are on (a fix cannot succeed while they are off). */
  servicesEnabled(): Promise<boolean>;
  /** A cached fix no older than `maxAgeMs` and at least as accurate as `requiredAccuracyMeters`; no new GPS work. */
  getLastKnownFix(maxAgeMs: number, requiredAccuracyMeters: number): Promise<LocationFix | null>;
  /** One new fix at balanced accuracy (no continuous watching). May take a while; the controller adds a timeout. */
  getCurrentFix(): Promise<LocationFix | null>;
  /**
   * Starts the heading stream. `onError` is called when the stream ends with an error (iOS ends it on any CoreLocation
   * failure). Rejects when it cannot start (iOS: no permission or no heading hardware).
   */
  watchHeading(onEvent: (event: RawHeadingEvent) => void, onError: (reason: string) => void): Promise<HeadingSubscription>;
}
