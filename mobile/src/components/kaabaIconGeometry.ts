/**
 * The Kaaba icon's drawing (components/KaabaIcon.tsx), as plain data so tests and the design preview render exactly
 * what the app renders. An original, simple drawing: the cube in a three-quarter view from a little above (a shallow
 * roof, the front face and the side face in three shades of black), the gold band of the kiswa about a quarter of the
 * way down, and the gold door on the front face, raised off the ground near the corner. On a 24 × 24 grid like the
 * app's other icons; every point stays within x 3–21, y 4.5–19.5 (centred), plus half the outline.
 *
 * The colours are the icon's own identity (black and gold), not palette tokens, so it reads the same in Light and
 * Dark. Only the thin outline takes a theme colour, so the black cube never disappears into the dark background.
 *
 * Used on Home's Qibla Direction button only; the compass itself uses a needle.
 */

export const KAABA_ICON_VIEWBOX = '0 0 24 24';

export const KAABA_COLORS = {
  /** The front face, darkest: the face we look at. */
  front: '#171717',
  /** The side face, a step lighter, so the corner between the faces reads. */
  side: '#262626',
  /** The roof: only a little lighter, so the cube never reads as a parcel. */
  top: '#333333',
  gold: '#C9A24A',
  /** The band on the side face, in shade. */
  goldShade: '#A8873A',
} as const;

export type KaabaColor = keyof typeof KAABA_COLORS;

export type Point = readonly [number, number];

export type KaabaShape = { id: string; points: readonly Point[]; fill: KaabaColor };

/** The cube: left edge x = 3, near corner x = 14 (front face 11 wide), right edge x = 21 (side face 7 wide). */
const LEFT = 3;
const CORNER = 14;
const RIGHT = 21;
/** Top edges: the far corners at 6, the near corner at 7.5, so the roof is shallow (back corner at 4.5); bottom at 18–19.5. Centred on y = 12. */
const FAR_TOP = 6;
const NEAR_TOP = 7.5;
const HEIGHT = 12;
const BACK_TOP = 2 * FAR_TOP - NEAR_TOP;
const BACK_X = LEFT + RIGHT - CORNER;

const round = (n: number) => Math.round(n * 100) / 100;
const pt = (x: number, y: number): Point => [round(x), round(y)];

/** The y of the front face's top edge at x (it runs from the left top corner down to the near corner). */
export function frontTopY(x: number): number {
  return FAR_TOP + ((x - LEFT) * (NEAR_TOP - FAR_TOP)) / (CORNER - LEFT);
}
/** The y of the side face's top edge at x (from the near corner up to the right top corner). */
export function sideTopY(x: number): number {
  return NEAR_TOP + ((x - CORNER) * (FAR_TOP - NEAR_TOP)) / (RIGHT - CORNER);
}

/** The band: from 2.4 to 3.8 below the top edges. */
const BAND_FROM = 2.4;
const BAND_TO = 3.8;

/** The door: x 10.6–12.6 on the front face, from 6.0 to 10.4 below the top edge (so it stands off the ground). */
const DOOR_LEFT = 10.6;
const DOOR_RIGHT = 12.6;
const DOOR_FROM = 6.0;
const DOOR_TO = 10.4;

const band = (x1: number, x2: number, topY: (x: number) => number): Point[] => [
  pt(x1, topY(x1) + BAND_FROM),
  pt(x2, topY(x2) + BAND_FROM),
  pt(x2, topY(x2) + BAND_TO),
  pt(x1, topY(x1) + BAND_TO),
];

export const KAABA_SHAPES: readonly KaabaShape[] = [
  { id: 'top', fill: 'top', points: [pt(LEFT, FAR_TOP), pt(BACK_X, BACK_TOP), pt(RIGHT, FAR_TOP), pt(CORNER, NEAR_TOP)] },
  { id: 'front', fill: 'front', points: [pt(LEFT, FAR_TOP), pt(CORNER, NEAR_TOP), pt(CORNER, NEAR_TOP + HEIGHT), pt(LEFT, FAR_TOP + HEIGHT)] },
  { id: 'side', fill: 'side', points: [pt(CORNER, NEAR_TOP), pt(RIGHT, FAR_TOP), pt(RIGHT, FAR_TOP + HEIGHT), pt(CORNER, NEAR_TOP + HEIGHT)] },
  { id: 'bandFront', fill: 'gold', points: band(LEFT, CORNER, frontTopY) },
  { id: 'bandSide', fill: 'goldShade', points: band(CORNER, RIGHT, sideTopY) },
  {
    id: 'door',
    fill: 'gold',
    points: [
      pt(DOOR_LEFT, frontTopY(DOOR_LEFT) + DOOR_FROM),
      pt(DOOR_RIGHT, frontTopY(DOOR_RIGHT) + DOOR_FROM),
      pt(DOOR_RIGHT, frontTopY(DOOR_RIGHT) + DOOR_TO),
      pt(DOOR_LEFT, frontTopY(DOOR_LEFT) + DOOR_TO),
    ],
  },
];

/** The cube's outer edge, for the theme-coloured outline. */
export const KAABA_SILHOUETTE: readonly Point[] = [
  pt(LEFT, FAR_TOP),
  pt(BACK_X, BACK_TOP),
  pt(RIGHT, FAR_TOP),
  pt(RIGHT, FAR_TOP + HEIGHT),
  pt(CORNER, NEAR_TOP + HEIGHT),
  pt(LEFT, FAR_TOP + HEIGHT),
];

/** The outline's width on the 24 grid (it scales with the icon: about 0.7 px at the Home button's 22 pt). */
export const KAABA_OUTLINE_WIDTH = 0.75;

/**
 * The outline's colour (owner-approved 2026-11-06, option B): the palette's textSecondary in Light (unchanged), the
 * icon's own gold in Dark, where black on the navy button needs a light edge and gold reads as part of the Kaaba.
 */
export function kaabaOutlineColor(theme: 'light' | 'dark', palette: { textSecondary: string }): string {
  return theme === 'dark' ? KAABA_COLORS.gold : palette.textSecondary;
}

export function toPointsAttribute(points: readonly Point[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}
