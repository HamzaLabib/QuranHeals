import type { CalibrationLevel } from './headingNormalize';
import { toSigned180 } from './qiblaMath';

/**
 * How far the live compass may be trusted, from one snapshot of everything known (docs/qibla.md, "Reliability").
 * Pure: the screen's hook gathers the inputs, this decides.
 *
 * The rule the whole screen follows: a STEADY heading is not an ACCURATE heading. A magnet or a steel desk can hold the
 * needle perfectly still in the wrong place, and an Android phone lying still sends no events at all. So nothing here
 * looks at how stable or how quiet the readings are; only the platform's calibration signal (and whether that signal
 * can be believed), the position, the orientation and recent errors count. The input type has no stability field on
 * purpose.
 *
 *  - unavailable  no live compass: the bearing card only. Needle hidden.
 *  - calibrate    a compass exists but has nothing usable yet. Needle hidden.
 *  - approximate  a needle, dimmed and labelled approximate; never the "lined up" indication.
 *  - ready        every condition met; the "lined up" indication may show (with hysteresis). Even then it is NOT a
 *                 guarantee: iOS's best calibration level still allows up to 20° (expo-location's normalisation).
 */

export type CompassState = 'unavailable' | 'calibrate' | 'approximate' | 'ready';

export type CompassReason =
  /** No Qibla bearing to point at yet (no position, or at the Kaaba / its antipode / a pole). Set by the controller. */
  | 'noBearing'
  /** Web, no magnetometer, or a device class whose heading is not verified (Android large screens, N3). */
  | 'noHeadingSupport'
  | 'noPermission'
  /** The heading stream failed and the retries are used up. */
  | 'streamFailed'
  /** The heading stream ended with an error and is waiting to restart (HEADING_RETRY_DELAYS_MS). */
  | 'sensorErrorRetrying'
  /** Subscribed less than FIRST_EVENT_NUDGE_MS ago and nothing yet. */
  | 'starting'
  /** No event for a while: Android sends none until the azimuth moves about 2°. Ask for a small movement. */
  | 'waitingForMovement'
  | 'noHeadingEvents'
  /** Events arrive but without a true heading (Android before its GeomagneticField exists; iOS without a location). */
  | 'waitingForTrueHeading'
  | 'noTrueHeading'
  /** Calibration level 0. */
  | 'uncalibrated'
  | 'recentError'
  | 'lowAccuracy'
  /** The platform's accuracy value cannot be believed (stock expo-location on Android mixes in the accelerometer's). */
  | 'accuracyUntrusted'
  /** The position is too uncertain for the bearing itself (e.g. approximate location near Makkah). */
  | 'positionUncertain'
  | 'orientationUnverified'
  /** Best calibration, but not yet RE-REPORTED across READY_DWELL_MS (an unchanged last value is not a confirmation). */
  | 'settling'
  /**
   * A valid heading was received, but no event for STALE_READING_MS. NOT a sign of a bad sensor: Android sends no
   * events while the phone is still. Ask for a small movement to refresh; until fresh readings arrive, approximate
   * (silence never keeps or earns confidence).
   */
  | 'refreshNeeded'
  /** The position is a chosen city, not the device's: approximate until device diagnostics verify the native heading. */
  | 'manualPosition';

export type CompassInput = {
  nowMs: number;
  headingSupported: boolean;
  permissionGranted: boolean;
  /** When the current heading subscription started; null while not subscribed. */
  subscribedAtMs: number | null;
  /** When the current subscription delivered its first event; null before. */
  firstEventAtMs: number | null;
  /** The latest event's true heading (headingNormalize.ts), null when it had none. */
  trueHeading: number | null;
  accuracy: CalibrationLevel;
  /** Whether `accuracy` reflects the compass's own calibration on this platform build. */
  accuracyTrusted: boolean;
  /** The first event of the current run of best-calibration events (trackBestAccuracySince); null when not at best. */
  bestAccuracySinceMs: number | null;
  /** The latest event of that run; null when not at best. Together with the above: the best level was re-reported. */
  lastBestEventAtMs: number | null;
  /** The latest heading event of any kind in this subscription; null before the first. */
  lastEventAtMs: number | null;
  lastErrorAtMs: number | null;
  streamFailed: boolean;
  /** The stream ended with an error and a restart is scheduled. */
  retryPending: boolean;
  /** bearingUncertaintyDegrees() for the position in use; Infinity when unknown. */
  bearingUncertaintyDeg: number;
  /** Whether the heading's reference edge is known for the current device and orientation. */
  orientationVerified: boolean;
  /** Whether the position is a chosen city rather than the device's own fix. */
  manualPosition: boolean;
};

export type CompassAssessment = {
  state: CompassState;
  /** The reasons for the state, most important first; empty only when ready. */
  reasons: CompassReason[];
  needle: 'hidden' | 'dimmed' | 'full';
};

export const FIRST_EVENT_NUDGE_MS = 4_000;
export const FIRST_EVENT_GIVE_UP_MS = 12_000;
export const READY_DWELL_MS = 2_000;
export const RECENT_ERROR_MS = 5_000;
export const STALE_READING_MS = 10_000;
export const MAX_POSITION_UNCERTAINTY_DEG = 3;
export const BEST_CALIBRATION: CalibrationLevel = 3;

function assessment(state: CompassState, reasons: CompassReason[]): CompassAssessment {
  const needle = state === 'ready' ? 'full' : state === 'approximate' ? 'dimmed' : 'hidden';
  return { state, reasons, needle };
}

export function assessCompass(input: CompassInput): CompassAssessment {
  const now = input.nowMs;
  if (!input.headingSupported) return assessment('unavailable', ['noHeadingSupport']);
  if (!input.permissionGranted) return assessment('unavailable', ['noPermission']);
  if (input.streamFailed) return assessment('unavailable', ['streamFailed']);
  if (input.retryPending) return assessment('calibrate', ['sensorErrorRetrying']);

  if (input.subscribedAtMs === null) return assessment('calibrate', ['starting']);
  const sinceSubscribed = Math.max(0, now - input.subscribedAtMs);

  if (input.firstEventAtMs === null) {
    if (sinceSubscribed >= FIRST_EVENT_GIVE_UP_MS) return assessment('unavailable', ['noHeadingEvents']);
    return assessment('calibrate', [sinceSubscribed >= FIRST_EVENT_NUDGE_MS ? 'waitingForMovement' : 'starting']);
  }

  if (input.trueHeading === null || !Number.isFinite(input.trueHeading)) {
    if (sinceSubscribed >= FIRST_EVENT_GIVE_UP_MS) return assessment('unavailable', ['noTrueHeading']);
    return assessment('calibrate', ['waitingForTrueHeading']);
  }

  if (input.accuracy === 0) return assessment('calibrate', ['uncalibrated']);

  const reasons: CompassReason[] = [];
  if (input.lastErrorAtMs !== null && now - input.lastErrorAtMs < RECENT_ERROR_MS) reasons.push('recentError');
  if (!input.accuracyTrusted) reasons.push('accuracyUntrusted');
  if (input.accuracy < BEST_CALIBRATION) reasons.push('lowAccuracy');
  else {
    const since = input.bestAccuracySinceMs;
    const last = input.lastBestEventAtMs;
    if (since === null || last === null || last - since < READY_DWELL_MS) reasons.push('settling');
  }
  if (input.lastEventAtMs === null || now - input.lastEventAtMs >= STALE_READING_MS) reasons.push('refreshNeeded');
  if (!(input.bearingUncertaintyDeg <= MAX_POSITION_UNCERTAINTY_DEG)) reasons.push('positionUncertain');
  if (input.manualPosition) reasons.push('manualPosition');
  if (!input.orientationVerified) reasons.push('orientationUnverified');

  return reasons.length > 0 ? assessment('approximate', reasons) : assessment('ready', []);
}

/**
 * The next moment the assessment can change with no new event (time alone), or null. The controller sets one timer
 * for it instead of polling. Time alone only ever moves towards LESS confidence (starting → nudge → give up; a quiet
 * heading needing a refresh), except a recent error expiring, which still needs fresh readings to reach ready.
 * Completing the dwell is NOT here: it needs a new reading.
 */
export function nextReassessAtMs(input: CompassInput): number | null {
  if (!input.headingSupported || !input.permissionGranted || input.streamFailed || input.retryPending || input.subscribedAtMs === null) return null;
  const candidates: number[] = [];
  const noUsableHeading = input.firstEventAtMs === null || input.trueHeading === null || !Number.isFinite(input.trueHeading);
  if (noUsableHeading) {
    if (input.firstEventAtMs === null) candidates.push(input.subscribedAtMs + FIRST_EVENT_NUDGE_MS);
    candidates.push(input.subscribedAtMs + FIRST_EVENT_GIVE_UP_MS);
  } else {
    if (input.lastErrorAtMs !== null) candidates.push(input.lastErrorAtMs + RECENT_ERROR_MS);
    if (input.lastEventAtMs !== null) candidates.push(input.lastEventAtMs + STALE_READING_MS);
  }
  const future = candidates.filter((t) => t > input.nowMs);
  return future.length > 0 ? Math.min(...future) : null;
}

/**
 * The heading's condition in one word, keeping apart what the owner asked to keep apart (2026-11-06):
 *  - noInitialHeading  nothing usable received yet in this subscription (starting, waiting, never came);
 *  - sensorError       the stream reported an error (retrying, recently recovered, or given up);
 *  - poorAccuracy      the platform EXPLICITLY reported low or no calibration;
 *  - quiet             a valid heading was received but nothing recently: ask for a small movement, NOT a bad sensor;
 *  - limited           readings are fine but something else caps it (untrusted accuracy, position, orientation, city,
 *                      still settling);
 *  - unavailable       no compass here (no bearing, unsupported, no permission);
 *  - ok                ready.
 * An explicit poor reading outranks quiet: it is the last thing the platform actually said.
 */
export type HeadingCondition = 'unavailable' | 'sensorError' | 'noInitialHeading' | 'poorAccuracy' | 'quiet' | 'limited' | 'ok';

export function headingCondition(assessment: CompassAssessment): HeadingCondition {
  const has = (...reasons: CompassReason[]) => reasons.some((r) => assessment.reasons.includes(r));
  if (assessment.state === 'ready') return 'ok';
  if (has('noBearing', 'noHeadingSupport', 'noPermission')) return 'unavailable';
  if (has('streamFailed', 'sensorErrorRetrying', 'recentError')) return 'sensorError';
  if (has('starting', 'waitingForMovement', 'noHeadingEvents', 'waitingForTrueHeading', 'noTrueHeading')) return 'noInitialHeading';
  if (has('uncalibrated', 'lowAccuracy')) return 'poorAccuracy';
  if (has('refreshNeeded')) return 'quiet';
  return 'limited';
}

/**
 * The start of the current run of best-calibration readings; null as soon as one is not the best. A silence of
 * STALE_READING_MS or more between two best readings breaks the run too: silence is never continuity, so the dwell
 * must be earned again after it.
 */
export function trackBestAccuracySince(
  previousSinceMs: number | null,
  previousBestEventAtMs: number | null,
  accuracy: CalibrationLevel,
  nowMs: number,
): number | null {
  if (accuracy !== BEST_CALIBRATION) return null;
  if (previousSinceMs === null || previousBestEventAtMs === null || nowMs - previousBestEventAtMs >= STALE_READING_MS) return nowMs;
  return previousSinceMs;
}

/** "Lined up with the Qibla bearing": enter within 5°, leave beyond 8°. Only ever in the ready state. */
export const ALIGN_ENTER_DEG = 5;
export const ALIGN_EXIT_DEG = 8;

/**
 * Whether to show "Lined up with the Qibla bearing". `relativeAngle` is the Qibla relative to the phone's heading
 * (qiblaMath.relativeQiblaAngle). Leaves at once when the compass stops being ready, whatever the angle. The
 * thresholds compare the reading with the bearing; they say nothing about the reading's own error.
 */
export function nextAligned(wasAligned: boolean, state: CompassState, relativeAngle: number): boolean {
  if (state !== 'ready' || !Number.isFinite(relativeAngle)) return false;
  const off = Math.abs(toSigned180(relativeAngle));
  return off <= (wasAligned ? ALIGN_EXIT_DEG : ALIGN_ENTER_DEG);
}

/** Retries after the heading stream ends with an error (iOS ends it on any CoreLocation failure, e.g. interference). */
export const HEADING_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 8_000, 8_000];

/** The wait before retry number `failures` (1 = after the first failure); null once the retries are used up. */
export function headingRetryDelayMs(failures: number): number | null {
  if (!Number.isInteger(failures) || failures < 1) return null;
  return HEADING_RETRY_DELAYS_MS[failures - 1] ?? null;
}
