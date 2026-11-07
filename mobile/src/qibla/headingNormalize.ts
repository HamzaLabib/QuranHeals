import { normalize360 } from './qiblaMath';

/**
 * Turns expo-location's heading events into a TRUE heading we can use, or null. Written against expo-location 57's
 * native source (docs/qibla.md, "Verified native behaviour"):
 *
 * - iOS (CoreLocation `CLHeading.trueHeading`): 0–359.9, or negative when true north could not be determined.
 * - Android (LocationModule.kt): `(magnetic + declination) % 360`, or exactly -1 until a GeomagneticField exists. Kotlin's
 *   `%` keeps the sign, so a REAL heading can be negative (magnetic 1°, declination -5° gives -4) and can even be
 *   exactly -1. So -1 means "no true north" only until the first other value: from then on the field exists for the
 *   rest of the subscription (it is cleared only when the watch is removed) and every value is a real heading.
 *
 * Never falls back to the magnetic heading: magnetic north is not true north without the declination.
 */

export type HeadingPlatform = 'ios' | 'android';

export type RawHeadingEvent = { trueHeading: number; magHeading: number; accuracy: number };

/** Per subscription. Start a new one (`newHeadingTracker()`) for every watchHeadingAsync call. */
export type HeadingTracker = { sawValidTrueHeading: boolean };

export function newHeadingTracker(): HeadingTracker {
  return { sawValidTrueHeading: false };
}

export const ANDROID_NO_TRUE_HEADING = -1;

export type InterpretedHeading = {
  /** True heading in [0, 360), or null when this event has none. */
  trueHeading: number | null;
  /** expo-location's 0–3 calibration level (0 = none/unreliable, 3 = best), clamped; 0 for anything malformed. */
  accuracy: CalibrationLevel;
};

export type CalibrationLevel = 0 | 1 | 2 | 3;

export function toCalibrationLevel(value: unknown): CalibrationLevel {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const level = Math.round(value);
  if (level <= 0) return 0;
  if (level >= 3) return 3;
  return level as CalibrationLevel;
}

/** Reads one event. Mutates `tracker` (Android's first-valid rule). */
export function interpretHeading(platform: HeadingPlatform, event: RawHeadingEvent, tracker: HeadingTracker): InterpretedHeading {
  const accuracy = toCalibrationLevel(event?.accuracy);
  const raw = event?.trueHeading;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { trueHeading: null, accuracy };

  if (platform === 'ios') {
    if (raw < 0) return { trueHeading: null, accuracy };
    return { trueHeading: normalize360(raw), accuracy };
  }

  // Android. The native value is always within (-360, 360); anything else is malformed and changes nothing.
  if (raw <= -360 || raw >= 360) return { trueHeading: null, accuracy };
  if (!tracker.sawValidTrueHeading) {
    if (raw === ANDROID_NO_TRUE_HEADING) return { trueHeading: null, accuracy };
    tracker.sawValidTrueHeading = true;
  }
  return { trueHeading: normalize360(raw), accuracy };
}
