import { describe, expect, it } from 'vitest';

import {
  AT_KAABA_RADIUS_M,
  KAABA,
  bearingUncertaintyDegrees,
  computeQibla,
  createCircularSmoother,
  destinationPoint,
  distanceMeters,
  initialBearing,
  isValidCoordinates,
  normalize360,
  qiblaBearing,
  relativeQiblaAngle,
  shortestDelta,
  toSigned180,
  turnHint,
  unwrapAngle,
  type Coordinates,
} from '@/qibla/qiblaMath';

/**
 * An independent bearing: the direction to the Kaaba in the observer's tangent plane, from 3-D unit vectors (north
 * and east basis vectors), not the atan2 spherical-trigonometry formula qiblaMath uses. Two derivations agreeing to
 * 1e-9° on hundreds of points is the "independent implementation" check of docs/qibla.md.
 */
function vectorBearing(from: Coordinates, to: Coordinates): number {
  const rad = Math.PI / 180;
  const unit = (c: Coordinates) => [Math.cos(c.latitude * rad) * Math.cos(c.longitude * rad), Math.cos(c.latitude * rad) * Math.sin(c.longitude * rad), Math.sin(c.latitude * rad)];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const p = unit(from);
  const q = unit(to);
  const d = dot(p, q);
  const tangent = q.map((value, i) => value - d * p[i]);
  const phi = from.latitude * rad;
  const lambda = from.longitude * rad;
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  return ((Math.atan2(dot(tangent, east), dot(tangent, north)) / rad) % 360 + 360) % 360;
}

/** Deterministic pseudo-random points (no Math.random, so a failure is reproducible). */
function* points(count: number, seed = 20261106): Generator<Coordinates> {
  let s = seed;
  const next = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  for (let i = 0; i < count; i += 1) yield { latitude: -89 + next() * 178, longitude: -180 + next() * 360 };
}

// Kaaba 21.4225, 39.8262; city centres. Values computed by both derivations (they agree to 0.001°).
const CITIES: readonly [string, number, number, number][] = [
  ['Cairo', 30.0444, 31.2357, 136.137],
  ['London', 51.5074, -0.1278, 118.987],
  ['New York', 40.7128, -74.006, 58.482],
  ['Los Angeles', 34.0522, -118.2437, 23.857],
  ['Jakarta', -6.2088, 106.8456, 295.152],
  ['Karachi', 24.8607, 67.0011, 267.741],
  ['Istanbul', 41.0082, 28.9784, 151.621],
  ['Sydney', -33.8688, 151.2093, 277.5],
  ['Tokyo', 35.6762, 139.6503, 292.999],
  ['Cape Town', -33.9249, 18.4241, 23.353],
  ['Medina', 24.4686, 39.6142, 176.291],
  ['Reykjavik', 64.1466, -21.9426, 106.118],
  ['Kuala Lumpur', 3.139, 101.6869, 292.538],
  ['Lagos', 6.5244, 3.3792, 63.33],
  ['Moscow', 55.7558, 37.6173, 176.356],
  ['Toronto', 43.6532, -79.3832, 54.581],
];

// Published great-circle Qibla bearings (checked 2026-11-06): al-habib.info (New York 58.5°), timesprayer.com
// (London 118.99°), makkahcompass (Jakarta 295.2°, Sydney 277.5°). Agreement within 0.1°.
const PUBLISHED: readonly [string, number, number, number][] = [
  ['New York', 40.7128, -74.006, 58.5],
  ['London', 51.5057508064, -0.119819641113, 118.99],
  ['Jakarta', -6.2088, 106.8456, 295.2],
  ['Sydney', -33.8688, 151.2093, 277.5],
];

describe('Qibla bearing', () => {
  it('uses the Kaaba at 21.4225 N, 39.8262 E', () => {
    expect(KAABA).toEqual({ latitude: 21.4225, longitude: 39.8262 });
    expect(Object.isFrozen(KAABA)).toBe(true);
  });

  it.each(CITIES)('%s: %f, %f → %f° from true north', (_name, latitude, longitude, expected) => {
    const bearing = qiblaBearing({ latitude, longitude });
    expect(bearing).not.toBeNull();
    expect(Math.abs(shortestDelta(bearing!, expected))).toBeLessThan(0.001);
  });

  it.each(PUBLISHED)('%s matches the published bearing within 0.1°', (_name, latitude, longitude, published) => {
    expect(Math.abs(shortestDelta(qiblaBearing({ latitude, longitude })!, published))).toBeLessThanOrEqual(0.1);
  });

  it('agrees with the independent vector derivation everywhere (500 points, 1e-9°)', () => {
    for (const p of points(500)) {
      const bearing = qiblaBearing(p);
      if (bearing === null) continue;
      expect(Math.abs(shortestDelta(bearing, vectorBearing(p, KAABA))), JSON.stringify(p)).toBeLessThan(1e-9);
    }
  });

  it('is always in [0, 360)', () => {
    for (const p of points(500, 7)) {
      const bearing = qiblaBearing(p);
      if (bearing === null) continue;
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });

  it('points due east/west along the Kaaba\'s parallel only near it, and due south straight north of it', () => {
    // On the Kaaba's meridian, north of it: due south; south of it: due north.
    expect(qiblaBearing({ latitude: 50, longitude: KAABA.longitude })).toBeCloseTo(180, 9);
    expect(qiblaBearing({ latitude: -10, longitude: KAABA.longitude })).toBeCloseTo(0, 9);
    // Just west of Makkah on its latitude: essentially east (a great circle, so very slightly north of east).
    const nearWest = qiblaBearing({ latitude: KAABA.latitude, longitude: KAABA.longitude - 0.5 })!;
    expect(nearWest).toBeGreaterThan(89);
    expect(nearWest).toBeLessThan(90);
  });

  it('handles the antimeridian (longitudes ±180) identically', () => {
    expect(qiblaBearing({ latitude: -17, longitude: 180 })).toBeCloseTo(qiblaBearing({ latitude: -17, longitude: -180 })!, 9);
    expect(qiblaBearing({ latitude: -17, longitude: 179.9999 })).toBeCloseTo(qiblaBearing({ latitude: -17, longitude: -179.9999 })!, 3);
  });

  it('is undefined at a pole, at the Kaaba itself and for invalid input', () => {
    expect(initialBearing({ latitude: 90, longitude: 0 }, KAABA)).toBeNull();
    expect(initialBearing({ latitude: -89.995, longitude: 10 }, KAABA)).toBeNull();
    expect(initialBearing(KAABA, KAABA)).toBeNull();
    for (const bad of [
      { latitude: Number.NaN, longitude: 0 },
      { latitude: 0, longitude: Number.POSITIVE_INFINITY },
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      null,
      undefined,
      { latitude: '21', longitude: 39 },
    ]) {
      expect(isValidCoordinates(bad)).toBe(false);
      expect(qiblaBearing(bad as Coordinates)).toBeNull();
    }
  });
});

describe('computeQibla: the special places', () => {
  it('a normal place: a bearing and the distance', () => {
    const result = computeQibla({ latitude: 30.0444, longitude: 31.2357 });
    expect(result.kind).toBe('bearing');
    if (result.kind !== 'bearing') return;
    expect(result.bearing).toBeCloseTo(136.137, 2);
    // Independent of haversine: the spherical law of cosines on the same sphere.
    const rad = Math.PI / 180;
    const cosines = 6_371_008.8 * Math.acos(Math.sin(30.0444 * rad) * Math.sin(KAABA.latitude * rad) + Math.cos(30.0444 * rad) * Math.cos(KAABA.latitude * rad) * Math.cos((KAABA.longitude - 31.2357) * rad));
    expect(result.distanceMeters).toBeCloseTo(cosines, 0);
    expect(result.distanceMeters / 1000).toBeGreaterThan(1_280); // Cairo–Makkah ≈ 1,287 km
    expect(result.distanceMeters / 1000).toBeLessThan(1_295);
  });

  it('at the Kaaba (within 100 m, or within the position\'s own accuracy): no bearing', () => {
    const inHaram = destinationPoint(KAABA, 45, 60);
    expect(computeQibla(inHaram).kind).toBe('atKaaba');
    const outside = destinationPoint(KAABA, 45, AT_KAABA_RADIUS_M + 50);
    expect(computeQibla(outside).kind).toBe('bearing');
    // 2 km away but the position is only good to 3 km: the Kaaba may be anywhere around us.
    const twoKm = destinationPoint(KAABA, 200, 2_000);
    expect(computeQibla(twoKm, 3_000).kind).toBe('atKaaba');
    expect(computeQibla(twoKm, 50).kind).toBe('bearing');
  });

  it('near the antipode (every direction ≈ the Qibla): undefined', () => {
    const antipode = { latitude: -KAABA.latitude, longitude: KAABA.longitude - 180 };
    expect(computeQibla(antipode)).toMatchObject({ kind: 'undefined', reason: 'antipode' });
    expect(computeQibla(destinationPoint(antipode, 0, 50_000))).toMatchObject({ kind: 'undefined', reason: 'antipode' });
    expect(computeQibla(destinationPoint(antipode, 0, 300_000)).kind).toBe('bearing');
  });

  it('at a pole: undefined', () => {
    expect(computeQibla({ latitude: 90, longitude: 0 })).toMatchObject({ kind: 'undefined', reason: 'pole' });
    expect(computeQibla({ latitude: -90, longitude: 0 })).toMatchObject({ kind: 'undefined', reason: 'pole' });
  });

  it('invalid input', () => {
    expect(computeQibla({ latitude: 200, longitude: 0 })).toEqual({ kind: 'invalid' });
  });
});

describe('distance and destination', () => {
  it('distance is symmetric and matches known values', () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    expect(distanceMeters(london, KAABA)).toBeCloseTo(distanceMeters(KAABA, london), 6);
    expect(distanceMeters(london, KAABA) / 1000).toBeGreaterThan(4_780);
    expect(distanceMeters(london, KAABA) / 1000).toBeLessThan(4_800); // published ≈ 4,793 km
  });

  it('destinationPoint is the inverse of distance + bearing', () => {
    for (const p of points(100, 3)) {
      if (Math.abs(p.latitude) > 85) continue;
      for (const bearing of [0, 37, 90, 181, 270, 359]) {
        const q = destinationPoint(p, bearing, 25_000);
        expect(distanceMeters(p, q)).toBeCloseTo(25_000, 3);
        expect(Math.abs(shortestDelta(initialBearing(p, q)!, bearing))).toBeLessThan(1e-6);
        expect(isValidCoordinates(q)).toBe(true);
      }
    }
  });
});

describe('angles', () => {
  it('normalize360 maps everything into [0, 360), never 360 or -0', () => {
    expect(normalize360(0)).toBe(0);
    expect(Object.is(normalize360(-0), 0)).toBe(true);
    expect(normalize360(360)).toBe(0);
    expect(normalize360(720)).toBe(0);
    expect(normalize360(-720)).toBe(0);
    expect(normalize360(-1)).toBe(359);
    expect(normalize360(-359)).toBe(1);
    expect(normalize360(361.5)).toBe(1.5);
    expect(normalize360(-1e-15)).toBe(0);
    expect(normalize360(Number.NaN)).toBeNaN();
    expect(normalize360(Number.POSITIVE_INFINITY)).toBeNaN();
    for (let d = -720; d <= 720; d += 0.25) {
      const r = normalize360(d);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });

  it('toSigned180 maps into (-180, 180], positive = clockwise', () => {
    expect(toSigned180(180)).toBe(180);
    expect(toSigned180(-180)).toBe(180);
    expect(toSigned180(181)).toBe(-179);
    expect(toSigned180(359)).toBe(-1);
    expect(toSigned180(-90)).toBe(-90);
    for (let d = -720; d <= 720; d += 0.5) {
      const r = toSigned180(d);
      expect(r).toBeGreaterThan(-180);
      expect(r).toBeLessThanOrEqual(180);
    }
  });

  it('shortestDelta crosses 0°/360° the short way', () => {
    expect(shortestDelta(350, 10)).toBe(20);
    expect(shortestDelta(10, 350)).toBe(-20);
    expect(shortestDelta(359, 1)).toBe(2);
    expect(shortestDelta(0, 180)).toBe(180);
    expect(shortestDelta(90, 90)).toBe(0);
  });

  it('relative angle = normalize(qibla − heading)', () => {
    expect(relativeQiblaAngle(136, 136)).toBe(0);
    expect(relativeQiblaAngle(136, 100)).toBe(36);
    expect(relativeQiblaAngle(10, 350)).toBe(20); // across north
    expect(relativeQiblaAngle(350, 10)).toBe(340);
    expect(relativeQiblaAngle(0, 0.5)).toBe(359.5);
  });

  it('turn hint: right = clockwise, left = counter-clockwise, whole degrees, ahead when it rounds to 0', () => {
    expect(turnHint(136, 100)).toEqual({ direction: 'right', degrees: 36 });
    expect(turnHint(100, 136)).toEqual({ direction: 'left', degrees: 36 });
    expect(turnHint(10, 350)).toEqual({ direction: 'right', degrees: 20 });
    expect(turnHint(350, 10)).toEqual({ direction: 'left', degrees: 20 });
    expect(turnHint(136, 136.4)).toEqual({ direction: 'ahead', degrees: 0 });
    expect(turnHint(0, 180).degrees).toBe(180);
  });
});

describe('unwrapAngle: the needle never spins the long way across north', () => {
  it('350 → 10 → 350 moves +20 then −20, not ±340', () => {
    let value = unwrapAngle(null, 350);
    expect(value).toBe(350);
    value = unwrapAngle(value, 10);
    expect(value).toBe(370);
    value = unwrapAngle(value, 350);
    expect(value).toBe(350);
  });

  it('many turns accumulate; every step is the short one', () => {
    let value: number | null = null;
    let previous = 0;
    for (let i = 0; i <= 1440; i += 7) {
      const heading = normalize360(i);
      const next = unwrapAngle(value, heading);
      if (value !== null) expect(Math.abs(next - previous)).toBeLessThanOrEqual(180);
      expect(normalize360(next)).toBeCloseTo(heading, 9);
      previous = next;
      value = next;
    }
    expect(value).toBeGreaterThan(1400); // four full turns clockwise
  });

  it('a non-finite previous value restarts cleanly', () => {
    expect(unwrapAngle(Number.NaN, 15)).toBe(15);
  });
});

describe('circular smoothing', () => {
  it('averages across north correctly (359° and 1° → 0°, never 180°)', () => {
    const smoother = createCircularSmoother(150);
    smoother.update(359, 0);
    const result = smoother.update(1, 150);
    expect(Math.abs(toSigned180(result))).toBeLessThan(1);
  });

  it('the first sample is taken as is; it converges towards a new steady value', () => {
    const smoother = createCircularSmoother(150);
    expect(smoother.update(90, 0)).toBeCloseTo(90, 9);
    let value = 0;
    for (let t = 50; t <= 2_000; t += 50) value = smoother.update(100, t);
    expect(value).toBeCloseTo(100, 3);
  });

  it('the weight depends on elapsed time, not on the number of samples', () => {
    const fast = createCircularSmoother(150);
    const slow = createCircularSmoother(150);
    fast.update(0, 0);
    slow.update(0, 0);
    let fastValue = 0;
    for (let t = 10; t <= 300; t += 10) fastValue = fast.update(20, t);
    const slowValue = slow.update(20, 300);
    expect(fastValue).toBeCloseTo(slowValue, 6);
  });

  it('ignores a non-finite sample and resets', () => {
    const smoother = createCircularSmoother(150);
    smoother.update(45, 0);
    expect(smoother.update(Number.NaN, 10)).toBeCloseTo(45, 9);
    smoother.reset();
    expect(smoother.update(200, 20)).toBeCloseTo(200, 9);
  });
});

describe('bearing uncertainty from the position\'s accuracy', () => {
  const cairo = { latitude: 30.0444, longitude: 31.2357 };

  it('is about atan(accuracy / distance) far from the antipode', () => {
    const distance = distanceMeters(cairo, KAABA);
    const planar = (Math.atan(3_000 / distance) * 180) / Math.PI;
    const exact = bearingUncertaintyDegrees(cairo, 3_000);
    expect(exact).toBeGreaterThan(planar * 0.8);
    expect(exact).toBeLessThan(planar * 1.3);
  });

  it('is small for an approximate location far away, and large for one near Makkah', () => {
    expect(bearingUncertaintyDegrees({ latitude: 51.5074, longitude: -0.1278 }, 3_000)).toBeLessThan(0.1); // London, coarse
    expect(bearingUncertaintyDegrees(destinationPoint(KAABA, 30, 20_000), 3_000)).toBeGreaterThan(3); // 20 km from the Kaaba, coarse
    expect(bearingUncertaintyDegrees(destinationPoint(KAABA, 30, 20_000), 20)).toBeLessThan(0.2); // same place, precise
  });

  it('is 180 when the Kaaba is within the radius, 0 for an exact position, Infinity when unknown', () => {
    expect(bearingUncertaintyDegrees(destinationPoint(KAABA, 0, 1_000), 5_000)).toBe(180);
    expect(bearingUncertaintyDegrees(cairo, 0)).toBe(0);
    expect(bearingUncertaintyDegrees(cairo, null)).toBe(Number.POSITIVE_INFINITY);
    expect(bearingUncertaintyDegrees(cairo, -5)).toBe(Number.POSITIVE_INFINITY);
    expect(bearingUncertaintyDegrees(cairo, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
  });

  it('a 30 km city radius is fine in Europe and not near Makkah (the manual-city case)', () => {
    expect(bearingUncertaintyDegrees({ latitude: 48.8566, longitude: 2.3522 }, 30_000)).toBeLessThan(1); // Paris
    expect(bearingUncertaintyDegrees({ latitude: 21.5433, longitude: 39.1728 }, 30_000)).toBeGreaterThan(3); // Jeddah
  });
});
