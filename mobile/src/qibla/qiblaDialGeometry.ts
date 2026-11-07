/**
 * The Qibla compass dial's geometry (QiblaCompassDial.tsx), pure so it can be tested without React Native. The dial is
 * drawn on a DIAL_VIEWBOX square; angles are degrees clockwise from its top, like bearings.
 */

export const DIAL_VIEWBOX = 200;
export const DIAL_CENTER = DIAL_VIEWBOX / 2;

/** Each reading eases in over this long (none with Reduce Motion); the controller already smooths the readings. */
export const DIAL_ANIMATION_MS = 120;

/** Tick marks every 10°, longer every 30°: [angle, inner radius]. */
export const DIAL_TICKS: readonly [number, number][] = Array.from({ length: 36 }, (_, i) => [i * 10, i % 3 === 0 ? 80 : 85] as [number, number]);

/** A point on the dial at `angle` degrees clockwise from its top, `radius` from the centre. */
export function dialPoint(angle: number, radius: number): [number, number] {
  const radians = (angle * Math.PI) / 180;
  return [DIAL_CENTER + radius * Math.sin(radians), DIAL_CENTER - radius * Math.cos(radians)];
}
