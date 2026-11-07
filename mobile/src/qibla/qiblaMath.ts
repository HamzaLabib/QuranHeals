/**
 * Qibla geometry: pure functions, no React Native, no I/O. Everything here runs on the device; no coordinate ever
 * leaves this module except as a return value (docs/qibla.md, "Privacy").
 *
 * Model: a sphere of the IUGG mean Earth radius and the great circle through the observer and the Kaaba, the
 * conventional Qibla definition. Bearings are degrees clockwise from TRUE north, in [0, 360).
 */

export type Coordinates = { latitude: number; longitude: number };

/** The Kaaba: 21°25′21″N 39°49′34″E (the centre of the structure). A few metres either way changes no bearing outside Makkah. */
export const KAABA: Readonly<Coordinates> = Object.freeze({ latitude: 21.4225, longitude: 39.8262 });

/** IUGG mean Earth radius, metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

/** Within this distance of the Kaaba (or within the position's own accuracy, if larger) there is no meaningful bearing. */
export const AT_KAABA_RADIUS_M = 100;

/** Within this distance of the Kaaba's antipode every direction is (almost) equally the Qibla. */
export const ANTIPODE_RADIUS_M = 100_000;

/** Within this many degrees of latitude of a pole, "clockwise from true north" has no stable meaning. */
export const POLE_LATITUDE_MARGIN_DEG = 0.01;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function isValidCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== 'object' || value === null) return false;
  const { latitude, longitude } = value as Partial<Coordinates>;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Any finite angle into [0, 360). NaN for a non-finite input. Never returns 360 or -0. */
export function normalize360(degrees: number): number {
  if (!Number.isFinite(degrees)) return Number.NaN;
  const r = ((degrees % 360) + 360) % 360;
  // (-1e-15 % 360) + 360 rounds to exactly 360; and -0 should read as 0.
  return r >= 360 || r === 0 ? 0 : r;
}

/** Any finite angle into (-180, 180]. Positive = clockwise. */
export function toSigned180(degrees: number): number {
  const r = normalize360(degrees);
  return r > 180 ? r - 360 : r;
}

/** The shortest signed turn from `from` to `to`, in (-180, 180]. Positive = clockwise (to the right). */
export function shortestDelta(from: number, to: number): number {
  return toSigned180(to - from);
}

/** Great-circle (haversine) distance in metres. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const phi1 = a.latitude * RAD;
  const phi2 = b.latitude * RAD;
  const dPhi = phi2 - phi1;
  const dLambda = (b.longitude - a.longitude) * RAD;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial great-circle bearing from `from` to `to`, degrees clockwise from true north in [0, 360);
 * null when it is undefined (invalid input, the same point, or `from` at a pole).
 */
export function initialBearing(from: Coordinates, to: Coordinates): number | null {
  if (!isValidCoordinates(from) || !isValidCoordinates(to)) return null;
  if (Math.abs(from.latitude) >= 90 - POLE_LATITUDE_MARGIN_DEG) return null;
  if (distanceMeters(from, to) < 1e-6) return null;
  const phi1 = from.latitude * RAD;
  const phi2 = to.latitude * RAD;
  const dLambda = (to.longitude - from.longitude) * RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalize360(Math.atan2(y, x) * DEG);
}

/** The point `distance` metres from `from` along the great circle leaving it at `bearing` (degrees from true north). */
export function destinationPoint(from: Coordinates, bearing: number, distance: number): Coordinates {
  const delta = distance / EARTH_RADIUS_M;
  const theta = bearing * RAD;
  const phi1 = from.latitude * RAD;
  const lambda1 = from.longitude * RAD;
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * sinPhi2);
  return { latitude: phi2 * DEG, longitude: toSigned180(lambda2 * DEG) };
}

export function qiblaBearing(position: Coordinates): number | null {
  return initialBearing(position, KAABA);
}

export type QiblaResult =
  | { kind: 'bearing'; bearing: number; distanceMeters: number }
  /** At (or, given the position's accuracy, possibly at) the Kaaba: face it directly; no needle. */
  | { kind: 'atKaaba'; distanceMeters: number }
  /** No usable bearing here: near the Kaaba's antipode, or at a pole. */
  | { kind: 'undefined'; reason: 'antipode' | 'pole'; distanceMeters: number }
  | { kind: 'invalid' };

/** The Qibla for a position, with the special places handled. `accuracyMeters` is the position's own radius, if known. */
export function computeQibla(position: Coordinates, accuracyMeters?: number | null): QiblaResult {
  if (!isValidCoordinates(position)) return { kind: 'invalid' };
  const distance = distanceMeters(position, KAABA);
  const accuracy = typeof accuracyMeters === 'number' && Number.isFinite(accuracyMeters) && accuracyMeters > 0 ? accuracyMeters : 0;
  if (distance <= Math.max(AT_KAABA_RADIUS_M, accuracy)) return { kind: 'atKaaba', distanceMeters: distance };
  if (distance >= Math.PI * EARTH_RADIUS_M - ANTIPODE_RADIUS_M) return { kind: 'undefined', reason: 'antipode', distanceMeters: distance };
  const bearing = qiblaBearing(position);
  if (bearing === null) return { kind: 'undefined', reason: 'pole', distanceMeters: distance };
  return { kind: 'bearing', bearing, distanceMeters: distance };
}

/**
 * How far off the Qibla bearing can be, in degrees, when the position is only known to within `accuracyMeters`:
 * the largest bearing change over eight points that far away (N, NE, … NW). Exact rather than the planar
 * atan(accuracy / distance), so it also grows correctly towards the antipode and includes meridian convergence.
 * 180 when the Kaaba (or a pole) could be inside that radius; Infinity when the accuracy is unknown.
 */
export function bearingUncertaintyDegrees(position: Coordinates, accuracyMeters: number | null | undefined): number {
  if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) return Number.POSITIVE_INFINITY;
  const centre = qiblaBearing(position);
  if (centre === null) return 180;
  if (accuracyMeters === 0) return 0;
  if (distanceMeters(position, KAABA) <= accuracyMeters) return 180;
  let worst = 0;
  for (let direction = 0; direction < 360; direction += 45) {
    const shifted = qiblaBearing(destinationPoint(position, direction, accuracyMeters));
    if (shifted === null) return 180;
    worst = Math.max(worst, Math.abs(shortestDelta(centre, shifted)));
  }
  return worst;
}

/**
 * The needle's angle on screen, clockwise from the top of the phone: where the Qibla is relative to where the phone
 * points. `heading` is the phone's TRUE heading. Also the dial's needle angle, since the dial rotates by -heading.
 */
export function relativeQiblaAngle(qibla: number, heading: number): number {
  return normalize360(qibla - heading);
}

export type TurnHint = { direction: 'right' | 'left' | 'ahead'; degrees: number };

/** "Turn N° right/left", rounded to whole degrees. Right = clockwise, in every language (RTL never mirrors it). */
export function turnHint(qibla: number, heading: number): TurnHint {
  const signed = shortestDelta(heading, qibla);
  const degrees = Math.round(Math.abs(signed));
  if (degrees === 0) return { direction: 'ahead', degrees: 0 };
  return { direction: signed > 0 ? 'right' : 'left', degrees };
}

/**
 * Continues an unbounded angle so an animation always takes the short way: 350° → 10° becomes 350 → 370, never a
 * 340° spin back. `previous` is the last unwrapped value (null for the first sample).
 */
export function unwrapAngle(previous: number | null, next: number): number {
  const target = normalize360(next);
  if (previous === null || !Number.isFinite(previous)) return target;
  return previous + shortestDelta(normalize360(previous), target);
}

export type CircularSmoother = {
  /** Feeds one angle (degrees) observed at `timeMs`; returns the smoothed angle in [0, 360). */
  update(angle: number, timeMs: number): number;
  reset(): void;
};

/**
 * Exponential smoothing of an angle on the unit circle (sin/cos), so 359° and 1° average to 0°, not 180°. The weight
 * depends on the time since the last sample (time constant `tauMs`), so irregular sensor rates smooth the same way.
 * Smoothing only reduces jitter: it never makes a reading more trustworthy (see compassReliability.ts).
 */
export function createCircularSmoother(tauMs: number): CircularSmoother {
  let x = 0;
  let y = 0;
  let lastTime: number | null = null;
  let lastAngle = 0;
  return {
    update(angle, timeMs) {
      const a = normalize360(angle);
      if (Number.isNaN(a)) return lastAngle;
      const sx = Math.cos(a * RAD);
      const sy = Math.sin(a * RAD);
      if (lastTime === null || !(tauMs > 0)) {
        x = sx;
        y = sy;
      } else {
        const dt = Math.max(0, timeMs - lastTime);
        const alpha = 1 - Math.exp(-dt / tauMs);
        x += alpha * (sx - x);
        y += alpha * (sy - y);
      }
      lastTime = timeMs;
      // Two opposite readings can cancel out; keep the last direction rather than report noise.
      if (Math.hypot(x, y) > 1e-6) lastAngle = normalize360(Math.atan2(y, x) * DEG);
      return lastAngle;
    },
    reset() {
      x = 0;
      y = 0;
      lastTime = null;
      lastAngle = 0;
    },
  };
}
