import {
  assessCompass,
  headingCondition,
  headingRetryDelayMs,
  nextAligned,
  nextReassessAtMs,
  trackBestAccuracySince,
  BEST_CALIBRATION,
  HEADING_RETRY_DELAYS_MS,
  type CompassAssessment,
  type CompassInput,
  type HeadingCondition,
} from './compassReliability';
import { interpretHeading, newHeadingTracker, type CalibrationLevel, type HeadingTracker, type RawHeadingEvent } from './headingNormalize';
import type { HeadingSubscription, LocationSource } from './locationSourceTypes';
import {
  bearingUncertaintyDegrees,
  computeQibla,
  createCircularSmoother,
  isValidCoordinates,
  relativeQiblaAngle,
  toSigned180,
  turnHint,
  unwrapAngle,
  type Coordinates,
  type QiblaResult,
  type TurnHint,
} from './qiblaMath';

/**
 * The Qibla screen's whole lifecycle, without React (docs/qibla.md, "Architecture"): permission, one-shot position,
 * the heading subscription, its retries and the reliability assessment. useQiblaCompass.ts drives it from the
 * screen's focus and the app's state; tests drive it with fake timers and a fake LocationSource.
 *
 * Rules it keeps:
 * - The permission request is shown only from requestPermission() (a user action), never on its own.
 * - Position: one cached or one balanced fix per activation (reused for FIX_REUSE_MS), never a continuous watch.
 * - The heading stream runs only while active (screen focused AND app active) and is removed on deactivate/dispose,
 *   including a subscription that finishes starting after the screen was left.
 * - True heading only (headingNormalize.ts); the magnetic heading is never read.
 * - Silence is never confidence: assessments that change with time alone are re-evaluated by one timer
 *   (nextReassessAtMs), and time alone only ever lowers confidence.
 * - Coordinates live in this object's memory only. The snapshot and the diagnostics carry the bearing, never the
 *   position, and never the distance to the Kaaba either: bearing + distance would locate the user.
 */

export const FIX_MAX_AGE_MS = 10 * 60_000;
export const FIX_REUSE_MS = 10 * 60_000;
export const LAST_KNOWN_REQUIRED_ACCURACY_M = 5_000;
export const CURRENT_FIX_TIMEOUT_MS = 15_000;
/** Text and turn hints refresh at most this often; the dial gets every reading through onFrame. */
export const SNAPSHOT_THROTTLE_MS = 250;

export type QiblaPermissionPhase =
  | 'checking'
  /** Never asked: show the explanation card and its button. */
  | 'needsRequest'
  | 'requesting'
  | 'granted'
  /** Refused, but the system can still ask again. */
  | 'denied'
  /** Refused for good: only Settings can change it. */
  | 'blocked'
  /** No device location on this platform (web). */
  | 'unsupported';

export type QiblaLocationPhase = 'idle' | 'locating' | 'located' | 'servicesOff' | 'unavailable';

export type ManualPosition = {
  coordinates: Coordinates;
  /** The uncertainty to assume for the chosen place (a city's radius). */
  accuracyMeters: number;
  /** Shown as "Using {label}". */
  label: string;
};

/**
 * The Qibla for the position in use, as the screen may show it: the bearing only. No distance (with the bearing it
 * would locate the user) and no coordinates.
 */
export type QiblaView =
  | { kind: 'bearing'; bearing: number }
  | { kind: 'atKaaba' }
  | { kind: 'undefined'; reason: 'antipode' | 'pole' }
  | { kind: 'invalid' };

export function toQiblaView(result: QiblaResult): QiblaView {
  switch (result.kind) {
    case 'bearing':
      return { kind: 'bearing', bearing: result.bearing };
    case 'undefined':
      return { kind: 'undefined', reason: result.reason };
    default:
      return { kind: result.kind };
  }
}

export type QiblaSnapshot = {
  active: boolean;
  permission: QiblaPermissionPhase;
  location: QiblaLocationPhase;
  positionSource: 'device' | 'manual' | null;
  manualLabel: string | null;
  qibla: QiblaView | null;
  bearingUncertaintyDeg: number;
  compass: CompassAssessment;
  /** Smoothed true heading, when the needle may show. */
  heading: number | null;
  relativeAngle: number | null;
  turn: TurnHint | null;
  /** "Lined up with the Qibla bearing": only ever true in the ready state. */
  aligned: boolean;
  /** Waiting to restart the heading after a stream error. */
  headingRetry: { attempt: number } | null;
};

/** Every heading reading, for the dial's animation (not throttled). */
export type HeadingFrame = {
  heading: number;
  /** The dial's rotation, unwrapped so an animation never spins the long way across north: -heading, continued. */
  dialRotation: number;
};

export type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type QiblaControllerDeps = {
  source: LocationSource;
  now: () => number;
  timers: Timers;
  /** A tablet-class screen (layout/orientationPolicy.isLargeScreen). */
  largeScreen: boolean;
};

/**
 * Everything the development diagnostics panel shows (app/qibla-diagnostics.tsx, development builds only). Like the
 * snapshot: no coordinates and no distance. The magnetic heading appears here for comparison ONLY; no decision reads it.
 */
export type QiblaDiagnostics = {
  platform: LocationSource['platform'];
  largeScreen: boolean;
  headingSupported: boolean;
  accuracyTrusted: boolean;
  orientationVerified: boolean;
  active: boolean;
  permission: QiblaPermissionPhase;
  location: QiblaLocationPhase;
  position: {
    source: 'device' | 'manual' | null;
    /** Whether a device fix is held in memory (used or not). */
    deviceFixAvailable: boolean;
    deviceFixAccuracyMeters: number | null;
    deviceFixAgeMs: number | null;
    manualLabel: string | null;
  };
  qibla: QiblaView | null;
  bearingUncertaintyDeg: number;
  heading: {
    subscribed: boolean;
    starting: boolean;
    subscribedForMs: number | null;
    /** How long after subscribing the first event came; null before it. */
    firstEventAfterMs: number | null;
    msSinceLastEvent: number | null;
    eventsThisSubscription: number;
    eventsLastFiveSeconds: number;
    /** The latest event exactly as the platform sent it. */
    rawTrueHeading: number | null;
    rawMagHeading: number | null;
    rawAccuracy: number | null;
    /** headingNormalize.ts's reading of it (null = no true north). */
    trueHeading: number | null;
    smoothedHeading: number | null;
    /** True minus magnetic, in (-180, 180]: the declination the platform applied. Null without both. */
    trueMinusMagneticDeg: number | null;
    /** Android: whether a value other than -1 has been seen (from then on -1 is a real heading). */
    androidTrueNorthSeen: boolean;
  };
  errors: {
    total: number;
    consecutiveFailures: number;
    maxRetries: number;
    retryPending: boolean;
    streamFailed: boolean;
    msSinceLastError: number | null;
    lastReason: string | null;
  };
  compass: CompassAssessment;
  condition: HeadingCondition;
  relativeAngle: number | null;
  turn: TurnHint | null;
  aligned: boolean;
};

export type QiblaCompassController = {
  getSnapshot(): QiblaSnapshot;
  /** For the development diagnostics panel; computed on demand, never pushed anywhere. */
  getDiagnostics(): QiblaDiagnostics;
  subscribe(listener: (snapshot: QiblaSnapshot) => void): () => void;
  onFrame(listener: (frame: HeadingFrame) => void): () => void;
  /** True while the screen is focused AND the app is active. */
  setActive(active: boolean): void;
  /** Shows the system permission request; only from a user action, and only when it can still be shown. */
  requestPermission(): Promise<void>;
  /** The user's Try Again: a new fix if there is none, and a fresh heading stream after a failure. */
  retry(): void;
  chooseManualPosition(position: ManualPosition): void;
  chooseDevicePosition(): void;
  dispose(): void;
};

const SMOOTHING_TAU_MS = 150;

export function createQiblaCompassController(deps: QiblaControllerDeps): QiblaCompassController {
  const { source, now, timers, largeScreen } = deps;

  // Android large screens: bearing only until their heading and orientation are verified on a device (N3).
  const headingSupported = source.headingSupported && !(source.platform === 'android' && largeScreen);
  // Phones are portrait-locked, so the heading's reference edge is the top of the phone. Tablets rotate: unverified.
  const orientationVerified = !largeScreen;
  // Stock expo-location on Android reports the accelerometer's OR the magnetometer's accuracy: not believable.
  const accuracyTrusted = source.platform === 'ios';

  let disposed = false;
  let active = false;
  let activation = 0;

  let permission: QiblaPermissionPhase = source.platform === 'web' ? 'unsupported' : 'checking';
  let location: QiblaLocationPhase = 'idle';
  let fix: { coordinates: Coordinates; accuracyMeters: number | null; atMs: number } | null = null;
  let locating = false;
  let manual: ManualPosition | null = null;
  let useManual = false;

  // Heading stream.
  let headingToken = 0;
  let subscription: HeadingSubscription | null = null;
  let starting = false;
  let subscribedAtMs: number | null = null;
  let firstEventAtMs: number | null = null;
  let tracker: HeadingTracker = newHeadingTracker();
  let trueHeading: number | null = null;
  let accuracy: CalibrationLevel = 0;
  let bestSinceMs: number | null = null;
  let lastBestEventAtMs: number | null = null;
  let lastEventAtMs: number | null = null;
  let lastRawEvent: RawHeadingEvent | null = null;
  let eventsThisSubscription = 0;
  let recentEventTimes: number[] = [];
  let lastErrorAtMs: number | null = null;
  let lastErrorReason: string | null = null;
  let totalErrors = 0;
  let failures = 0;
  let streamFailed = false;
  let retryTimer: unknown = null;
  const smoother = createCircularSmoother(SMOOTHING_TAU_MS);
  let smoothedHeading: number | null = null;
  let unwrapped: number | null = null;
  let aligned = false;

  let reassessTimer: unknown = null;
  let throttleTimer: unknown = null;
  let lastEmitAtMs = Number.NEGATIVE_INFINITY;
  let lastStructuralKey = '';
  let lastSnapshot: QiblaSnapshot | null = null;
  const listeners = new Set<(snapshot: QiblaSnapshot) => void>();
  const frameListeners = new Set<(frame: HeadingFrame) => void>();

  const clear = (handle: unknown) => {
    if (handle !== null) timers.clearTimeout(handle);
  };

  function positionInUse(): { coordinates: Coordinates; accuracyMeters: number | null; manual: boolean } | null {
    if (useManual && manual) return { coordinates: manual.coordinates, accuracyMeters: manual.accuracyMeters, manual: true };
    if (fix) return { coordinates: fix.coordinates, accuracyMeters: fix.accuracyMeters, manual: false };
    return null;
  }

  function currentQibla(): QiblaResult | null {
    const position = positionInUse();
    return position ? computeQibla(position.coordinates, position.accuracyMeters) : null;
  }

  function compassInput(nowMs: number, uncertainty: number, manualPosition: boolean): CompassInput {
    return {
      nowMs,
      headingSupported,
      permissionGranted: permission === 'granted',
      subscribedAtMs: subscription || starting ? subscribedAtMs : null,
      firstEventAtMs,
      trueHeading,
      accuracy,
      accuracyTrusted,
      bestAccuracySinceMs: bestSinceMs,
      lastBestEventAtMs,
      lastEventAtMs,
      lastErrorAtMs,
      streamFailed,
      retryPending: retryTimer !== null,
      bearingUncertaintyDeg: uncertainty,
      orientationVerified,
      manualPosition,
    };
  }

  function buildSnapshot(): { snapshot: QiblaSnapshot; input: CompassInput | null } {
    const nowMs = now();
    const position = positionInUse();
    const qibla = position ? computeQibla(position.coordinates, position.accuracyMeters) : null;
    const uncertainty = position ? bearingUncertaintyDegrees(position.coordinates, position.accuracyMeters) : Number.POSITIVE_INFINITY;
    let compass: CompassAssessment;
    let input: CompassInput | null = null;
    if (!qibla || qibla.kind !== 'bearing') {
      compass = { state: 'unavailable', reasons: ['noBearing'], needle: 'hidden' };
    } else {
      input = compassInput(nowMs, uncertainty, position!.manual);
      compass = assessCompass(input);
    }
    const showNeedle = compass.needle !== 'hidden' && smoothedHeading !== null && qibla?.kind === 'bearing';
    const relativeAngle = showNeedle ? relativeQiblaAngle((qibla as { bearing: number }).bearing, smoothedHeading!) : null;
    aligned = relativeAngle === null ? false : nextAligned(aligned, compass.state, relativeAngle);
    const snapshot: QiblaSnapshot = {
      active,
      permission,
      location,
      positionSource: position ? (position.manual ? 'manual' : 'device') : null,
      manualLabel: position?.manual ? manual!.label : null,
      qibla: qibla ? toQiblaView(qibla) : null,
      bearingUncertaintyDeg: uncertainty,
      compass,
      heading: showNeedle ? smoothedHeading : null,
      relativeAngle,
      turn: showNeedle ? turnHint((qibla as { bearing: number }).bearing, smoothedHeading!) : null,
      aligned,
      headingRetry: retryTimer !== null ? { attempt: failures } : null,
    };
    return { snapshot, input };
  }

  function structuralKey(s: QiblaSnapshot): string {
    return JSON.stringify([
      s.active,
      s.permission,
      s.location,
      s.positionSource,
      s.manualLabel,
      s.qibla?.kind,
      s.qibla?.kind === 'bearing' ? Math.round(s.qibla.bearing * 10) : null,
      s.compass.state,
      s.compass.reasons,
      s.aligned,
      s.turn?.direction ?? null,
      s.headingRetry?.attempt ?? null,
    ]);
  }

  function deliver(snapshot: QiblaSnapshot) {
    lastSnapshot = snapshot;
    lastEmitAtMs = now();
    lastStructuralKey = structuralKey(snapshot);
    for (const listener of listeners) listener(snapshot);
  }

  function scheduleReassess(input: CompassInput | null) {
    clear(reassessTimer);
    reassessTimer = null;
    if (!active || !input) return;
    const at = nextReassessAtMs(input);
    if (at === null) return;
    reassessTimer = timers.setTimeout(() => {
      reassessTimer = null;
      update();
    }, Math.max(0, at - now()));
  }

  /** Recomputes; delivers structural changes at once and heading-only changes at most every SNAPSHOT_THROTTLE_MS. */
  function update() {
    if (disposed) return;
    const { snapshot, input } = buildSnapshot();
    scheduleReassess(input);
    const structural = structuralKey(snapshot) !== lastStructuralKey;
    if (structural || now() - lastEmitAtMs >= SNAPSHOT_THROTTLE_MS) {
      clear(throttleTimer);
      throttleTimer = null;
      deliver(snapshot);
      return;
    }
    lastSnapshot = snapshot;
    if (throttleTimer === null) {
      throttleTimer = timers.setTimeout(() => {
        throttleTimer = null;
        if (!disposed) deliver(buildSnapshot().snapshot);
      }, Math.max(0, SNAPSHOT_THROTTLE_MS - (now() - lastEmitAtMs)));
    }
  }

  function resetHeadingReadings() {
    subscribedAtMs = null;
    firstEventAtMs = null;
    tracker = newHeadingTracker();
    trueHeading = null;
    accuracy = 0;
    bestSinceMs = null;
    lastBestEventAtMs = null;
    lastEventAtMs = null;
    lastRawEvent = null;
    eventsThisSubscription = 0;
    recentEventTimes = [];
    smoother.reset();
    smoothedHeading = null;
    unwrapped = null;
    aligned = false;
  }

  function stopHeading() {
    headingToken += 1;
    const current = subscription;
    subscription = null;
    starting = false;
    clear(retryTimer);
    retryTimer = null;
    if (current) {
      try {
        current.remove();
      } catch {
        // Removing a finished stream can throw on some platforms; it is gone either way.
      }
    }
    resetHeadingReadings();
  }

  function canStartHeading(): boolean {
    return (
      !disposed &&
      active &&
      headingSupported &&
      permission === 'granted' &&
      !streamFailed &&
      subscription === null &&
      !starting &&
      retryTimer === null &&
      currentQibla()?.kind === 'bearing'
    );
  }

  function onHeadingEvent(token: number, event: RawHeadingEvent) {
    if (token !== headingToken || disposed) return;
    const nowMs = now();
    const reading = interpretHeading(source.platform === 'ios' ? 'ios' : 'android', event, tracker);
    firstEventAtMs ??= nowMs;
    lastEventAtMs = nowMs;
    lastRawEvent = event;
    eventsThisSubscription += 1;
    recentEventTimes.push(nowMs);
    while (recentEventTimes.length > 0 && nowMs - recentEventTimes[0] > 5_000) recentEventTimes.shift();
    // `failures` is NOT reset here: a stream that keeps failing right after a reading gets at most
    // HEADING_RETRY_DELAYS_MS.length restarts per visit (or per Try Again), never an endless restart loop.
    trueHeading = reading.trueHeading;
    accuracy = reading.accuracy;
    bestSinceMs = trackBestAccuracySince(bestSinceMs, lastBestEventAtMs, accuracy, nowMs);
    lastBestEventAtMs = accuracy === BEST_CALIBRATION ? nowMs : null;
    if (trueHeading === null) {
      // No true north in this reading: drop the needle rather than keep an old direction.
      smoother.reset();
      smoothedHeading = null;
      unwrapped = null;
    } else {
      smoothedHeading = smoother.update(trueHeading, nowMs);
      unwrapped = unwrapAngle(unwrapped, smoothedHeading);
      const frame: HeadingFrame = { heading: smoothedHeading, dialRotation: -unwrapped };
      for (const listener of frameListeners) listener(frame);
    }
    update();
  }

  function onHeadingFailure(token: number, reason: unknown) {
    if (token !== headingToken || disposed) return;
    stopHeading();
    lastErrorAtMs = now();
    // A platform error message (e.g. "Heading unavailable"); never contains a position. Shown by the diagnostics only.
    lastErrorReason = (reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'error').slice(0, 200);
    totalErrors += 1;
    failures += 1;
    const delay = headingRetryDelayMs(failures);
    if (delay === null) {
      streamFailed = true;
    } else {
      retryTimer = timers.setTimeout(() => {
        retryTimer = null;
        startHeading();
        update();
      }, delay);
    }
    update();
  }

  function startHeading() {
    if (!canStartHeading()) return;
    const token = ++headingToken;
    resetHeadingReadings();
    starting = true;
    subscribedAtMs = now();
    source
      .watchHeading(
        (event) => onHeadingEvent(token, event),
        (reason) => onHeadingFailure(token, reason),
      )
      .then(
        (sub) => {
          if (token !== headingToken || disposed) {
            // Left (or restarted) while it was starting: never leave a stream running.
            try {
              sub.remove();
            } catch {
              // already gone
            }
            return;
          }
          subscription = sub;
          starting = false;
          update();
        },
        (error: unknown) => {
          if (token !== headingToken || disposed) return;
          starting = false;
          onHeadingFailure(token, error);
        },
      );
    update();
  }

  async function ensurePosition(myActivation: number) {
    const ready = useManual && manual ? 'manual' : fix && now() - fix.atMs < FIX_REUSE_MS ? 'cached' : null;
    if (ready) {
      if (ready === 'cached') location = 'located';
      if (myActivation === activation && !disposed) startHeading();
      update();
      return;
    }
    if (locating) return;
    locating = true;
    location = 'locating';
    update();
    try {
      const enabled = await source.servicesEnabled().catch(() => true);
      if (!enabled) {
        location = 'servicesOff';
        return;
      }
      let found = await source.getLastKnownFix(FIX_MAX_AGE_MS, LAST_KNOWN_REQUIRED_ACCURACY_M).catch(() => null);
      if (!found) found = await withTimeout(source.getCurrentFix(), CURRENT_FIX_TIMEOUT_MS).catch(() => null);
      if (found && isValidCoordinates(found.coordinates)) {
        // Kept even if the screen was left meanwhile: it saves the next visit a new fix. Memory only.
        fix = { coordinates: found.coordinates, accuracyMeters: found.accuracyMeters, atMs: now() };
        location = 'located';
      } else {
        location = 'unavailable';
      }
    } finally {
      locating = false;
      if (myActivation === activation && !disposed) {
        startHeading();
        update();
      }
    }
  }

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const handle = timers.setTimeout(() => resolve(null), ms);
      promise.then(
        (value) => {
          timers.clearTimeout(handle);
          resolve(value);
        },
        (error: unknown) => {
          timers.clearTimeout(handle);
          reject(error);
        },
      );
    });
  }

  function applyPermission(status: 'granted' | 'denied' | 'undetermined', canAskAgain: boolean) {
    permission = status === 'granted' ? 'granted' : status === 'undetermined' ? 'needsRequest' : canAskAgain ? 'denied' : 'blocked';
  }

  /** Read through a function: TypeScript cannot see that applyPermission() changed `permission` after an await. */
  function isGranted(): boolean {
    return permission === 'granted';
  }

  async function activate() {
    const myActivation = ++activation;
    failures = 0;
    streamFailed = false;
    lastErrorAtMs = null;
    if (source.platform === 'web') {
      permission = 'unsupported';
      update();
      return;
    }
    permission = 'checking';
    update();
    const result = await source.getPermission().catch(() => null);
    if (myActivation !== activation || disposed) return;
    if (!result) {
      permission = 'needsRequest';
      update();
      return;
    }
    applyPermission(result.status, result.canAskAgain);
    update();
    if (isGranted()) await ensurePosition(myActivation);
  }

  function deactivate() {
    activation += 1;
    stopHeading();
    clear(reassessTimer);
    reassessTimer = null;
    update();
  }

  return {
    getSnapshot() {
      return lastSnapshot ?? buildSnapshot().snapshot;
    },
    getDiagnostics() {
      const nowMs = now();
      const snapshot = lastSnapshot ?? buildSnapshot().snapshot;
      // The live assessment (the snapshot may be up to SNAPSHOT_THROTTLE_MS old).
      const position = positionInUse();
      const uncertainty = position ? bearingUncertaintyDegrees(position.coordinates, position.accuracyMeters) : Number.POSITIVE_INFINITY;
      const compass =
        snapshot.qibla?.kind === 'bearing' && position ? assessCompass(compassInput(nowMs, uncertainty, position.manual)) : snapshot.compass;
      const rawTrue = lastRawEvent?.trueHeading ?? null;
      const rawMag = lastRawEvent?.magHeading ?? null;
      const trueMinusMagneticDeg =
        trueHeading !== null && typeof rawMag === 'number' && Number.isFinite(rawMag) && rawMag >= 0 ? toSigned180(trueHeading - rawMag) : null;
      return {
        platform: source.platform,
        largeScreen,
        headingSupported,
        accuracyTrusted,
        orientationVerified,
        active,
        permission,
        location,
        position: {
          source: position ? (position.manual ? 'manual' : 'device') : null,
          deviceFixAvailable: fix !== null,
          deviceFixAccuracyMeters: fix?.accuracyMeters ?? null,
          deviceFixAgeMs: fix ? nowMs - fix.atMs : null,
          manualLabel: position?.manual ? manual!.label : null,
        },
        qibla: snapshot.qibla,
        bearingUncertaintyDeg: uncertainty,
        heading: {
          subscribed: subscription !== null,
          starting,
          subscribedForMs: subscribedAtMs !== null ? nowMs - subscribedAtMs : null,
          firstEventAfterMs: firstEventAtMs !== null && subscribedAtMs !== null ? firstEventAtMs - subscribedAtMs : null,
          msSinceLastEvent: lastEventAtMs !== null ? nowMs - lastEventAtMs : null,
          eventsThisSubscription,
          eventsLastFiveSeconds: recentEventTimes.filter((t) => nowMs - t <= 5_000).length,
          rawTrueHeading: typeof rawTrue === 'number' ? rawTrue : null,
          rawMagHeading: typeof rawMag === 'number' ? rawMag : null,
          rawAccuracy: typeof lastRawEvent?.accuracy === 'number' ? lastRawEvent.accuracy : null,
          trueHeading,
          smoothedHeading,
          trueMinusMagneticDeg,
          androidTrueNorthSeen: tracker.sawValidTrueHeading,
        },
        errors: {
          total: totalErrors,
          consecutiveFailures: failures,
          maxRetries: HEADING_RETRY_DELAYS_MS.length,
          retryPending: retryTimer !== null,
          streamFailed,
          msSinceLastError: lastErrorAtMs !== null ? nowMs - lastErrorAtMs : null,
          lastReason: lastErrorReason,
        },
        compass,
        condition: headingCondition(compass),
        relativeAngle: snapshot.relativeAngle,
        turn: snapshot.turn,
        aligned: snapshot.aligned,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    setActive(next) {
      if (disposed || next === active) return;
      active = next;
      if (next) void activate();
      else deactivate();
    },
    async requestPermission() {
      if (disposed || !active) return;
      if (permission !== 'needsRequest' && permission !== 'denied') return;
      const myActivation = activation;
      permission = 'requesting';
      update();
      const result = await source.requestPermission().catch(() => null);
      if (disposed) return;
      if (result) applyPermission(result.status, result.canAskAgain);
      else permission = 'needsRequest';
      update();
      if (isGranted() && myActivation === activation && active) await ensurePosition(myActivation);
    },
    retry() {
      if (disposed || !active) return;
      failures = 0;
      streamFailed = false;
      lastErrorAtMs = null;
      clear(retryTimer);
      retryTimer = null;
      if (permission === 'granted' && !positionInUse()) {
        void ensurePosition(activation);
        return;
      }
      startHeading();
      update();
    },
    chooseManualPosition(position) {
      if (disposed || !isValidCoordinates(position.coordinates)) return;
      manual = position;
      useManual = true;
      stopHeading(); // a new bearing: start the readings over
      startHeading();
      update();
    },
    chooseDevicePosition() {
      if (disposed) return;
      useManual = false;
      stopHeading();
      if (active && permission === 'granted') void ensurePosition(activation);
      startHeading();
      update();
    },
    dispose() {
      if (disposed) return;
      active = false;
      activation += 1;
      stopHeading();
      clear(reassessTimer);
      clear(throttleTimer);
      reassessTimer = null;
      throttleTimer = null;
      disposed = true;
      listeners.clear();
      frameListeners.clear();
      fix = null;
      manual = null;
    },
  };
}
