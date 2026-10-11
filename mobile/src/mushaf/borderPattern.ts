/**
 * The page frame's ornamental border, traced from the reference print
 * (`Reference Design.jpg`, page 61): a ring of square tiles one band wide,
 * 20 across × 29 down, between a double brown rule.
 *
 * Measured by rectifying the scan's frame (it is skewed ~0.3°) and
 * averaging the 36 horizontal and 54 vertical edge tiles; every number
 * below is a fraction of one tile (≈ 29.6 px in the scan). Along each
 * edge, in band coordinates (u along the band, v across it from the outer
 * edge):
 *
 *  - Rules: v 0–0.135 and 0.865–1 (≈ 4 px each), cream between them.
 *  - Rhombus on every tile boundary: brown, 0.5 wide × 0.54 tall, split
 *    along the band axis by a bar into two triangles with ochre-cream
 *    centres.
 *  - Four pointed green leaves around each rhombus, slanting 40° from the
 *    band axis, each edged in mint. Between two rhombi their leaves form an
 *    X at the tile centre, with pale mint wedges above and below it and
 *    cream along the axis.
 *  - Corner tiles: the X on the diagonals with three leaves, toward the two
 *    neighbouring rhombi; the outer one is only a pale halo, as printed.
 *
 * Output is one SVG path per ink in a 20 × 29 viewBox (tile units), so the
 * whole border draws as six shapes: no tile seams, crisp at any scale.
 * Built once; it is static.
 */

export type BorderInk = 'rule' | 'cream' | 'mint' | 'green' | 'brown' | 'ochre';

/** Inks sampled from the scan (solid areas, not anti-aliased edges). */
export const BORDER_INKS: Readonly<Record<BorderInk, string>> = {
  rule: '#826641',
  cream: '#FCF9E0',
  mint: '#D9EDCF',
  green: '#55804E',
  brown: '#76603A',
  ochre: '#EBDDA9',
};

/** Paint order, back to front. */
export const BORDER_INK_ORDER: readonly BorderInk[] = ['cream', 'mint', 'green', 'brown', 'ochre', 'rule'];

export type BorderPattern = {
  across: number;
  down: number;
  /** Each ink's path; `rule` and `cream` use even-odd fill (rings). */
  paths: Readonly<Record<BorderInk, string>>;
  counts: { junctions: number; rhombi: number; leaves: number };
};

/** Rule thickness, as a fraction of the tile (4 px of 29.65). */
export const BORDER_RULE = 0.135;

// ── Motif, in band coordinates of one tile ─────────────────────────────
const AXIS = 0.5; // band axis (v)
/** Pattern area between the cream gaps inside the rules. */
const MOTIF_REACH = 0.3;
const RHOMBUS = { halfWidth: 0.25, halfHeight: 0.272, stroke: 0.085, bar: 0.036 };
/** Leaves flank each rhombus side; offsets from the rhombus centre, and slant from the band axis (measured 38–41°). */
const LEAF = { du: 0.262, dv: 0.168, length: 0.38, width: 0.1, slant: (40 * Math.PI) / 180 };
const HALO = { length: 0.44, width: 0.13 };
/** Corner leaves: on the diagonals, centred this far from the tile centre (each axis). */
const CORNER_LEAF = 0.19;
const CORNER_LEAF_LENGTH = 0.32;
/** Half-width of a junction's mint wedge where it meets the cream gap. */
const WEDGE_REACH = 0.13;

type Point = readonly [number, number];
const fmt = (n: number) => {
  const s = n.toFixed(3);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};
const pt = ([x, y]: Point) => `${fmt(x)} ${fmt(y)}`;
const polygon = (points: readonly Point[]) => `M${points.map(pt).join('L')}Z`;

/**
 * A leaf from `from` to `to`, `width` across: two cubic sides with
 * controls at a quarter and three quarters of its length, so the flanks
 * run nearly straight and the tips are sharp, like the printed strokes.
 */
function lens(from: Point, to: Point, width: number) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  // A cubic with both controls offset by k bulges 3k/4 at its middle.
  const k = (2 / 3) * width;
  const nx = (-dy / length) * k;
  const ny = (dx / length) * k;
  const at = (t: number, side: number): Point => [from[0] + dx * t + nx * side, from[1] + dy * t + ny * side];
  return `M${pt(from)}C${pt(at(0.25, 1))} ${pt(at(0.75, 1))} ${pt(to)}C${pt(at(0.75, -1))} ${pt(at(0.25, -1))} ${pt(from)}Z`;
}

/** A leaf and its mint halo centred at `centre`, along the unit direction `dir` (frame coordinates). */
function leaf(centre: Point, dir: Point, length: number) {
  const along = (l: number): [Point, Point] => [
    [centre[0] - (dir[0] * l) / 2, centre[1] - (dir[1] * l) / 2],
    [centre[0] + (dir[0] * l) / 2, centre[1] + (dir[1] * l) / 2],
  ];
  const scale = length / LEAF.length;
  return { leaf: lens(...along(length), LEAF.width), halo: lens(...along(HALO.length * scale), HALO.width) };
}

/** Where an edge's local (u, v) lands in the frame (tile units). */
type Place = (u: number, v: number) => Point;

/** The split rhombus at u = `at`: brown body (even-odd, with two holes) and the holes' ochre. */
function rhombus(place: Place, at: number) {
  const { halfWidth: w, halfHeight: h, stroke, bar } = RHOMBUS;
  const body = [place(at, AXIS - h), place(at + w, AXIS), place(at, AXIS + h), place(at - w, AXIS)];
  // Each hole: the triangle between the bar and the two sides, inset by the stroke.
  const slope = h / w;
  const inset = stroke * Math.hypot(1, slope); // vertical offset of a side moved inward by `stroke`
  const holes = [-1, 1].map((side) => {
    const apexV = AXIS + side * (h - inset);
    const baseV = AXIS + side * bar;
    const halfBase = (h - inset - bar) / slope;
    return polygon([place(at, apexV), place(at + halfBase, baseV), place(at - halfBase, baseV)]);
  });
  return { body: polygon(body) + holes.join(''), holes: holes.join('') };
}

/** Unit vector from local (u, v) to (u + du, v + dv), in frame coordinates. */
function direction(place: Place, du: number, dv: number): Point {
  const [x0, y0] = place(0, 0);
  const [x1, y1] = place(du, dv);
  const length = Math.hypot(x1 - x0, y1 - y0);
  return [(x1 - x0) / length, (y1 - y0) / length];
}

export function buildBorderPattern(across: number, down: number): BorderPattern {
  const r = BORDER_RULE;
  const ring = (inset: number) => polygon([[inset, inset], [across - inset, inset], [across - inset, down - inset], [inset, down - inset]]);
  const paths: Record<BorderInk, string[]> = { rule: [], cream: [], mint: [], green: [], brown: [], ochre: [] };
  paths.rule.push(ring(0), ring(r), ring(1 - r), ring(1));
  paths.cream.push(ring(r), ring(1 - r));

  const edges: { place: Place; length: number }[] = [
    { place: (u, v) => [u, v], length: across }, // top
    { place: (u, v) => [u, down - v], length: across }, // bottom
    { place: (u, v) => [v, u], length: down }, // left
    { place: (u, v) => [across - v, u], length: down }, // right
  ];
  let junctions = 0;
  let rhombi = 0;
  for (const { place, length } of edges) {
    for (let boundary = 1; boundary < length; boundary++) {
      const { body, holes } = rhombus(place, boundary);
      paths.brown.push(body);
      paths.ochre.push(holes);
      rhombi++;
      // Four leaves, one beside each rhombus side; those that
      // would fall in a corner tile are replaced by the corner's own.
      for (const su of [-1, 1]) {
        const u = boundary + su * LEAF.du;
        if (u < 1 || u > length - 1) continue;
        for (const sv of [-1, 1]) {
          const { leaf: shape, halo } = leaf(place(u, AXIS + sv * LEAF.dv), direction(place, su * Math.cos(LEAF.slant), -sv * Math.sin(LEAF.slant)), LEAF.length);
          paths.green.push(shape);
          paths.mint.push(halo);
        }
      }
    }
    // Pale mint wedges above and below each junction, cream along the axis.
    for (let tile = 1; tile < length - 1; tile++) {
      const at = tile + 0.5;
      for (const sv of [-1, 1]) {
        paths.mint.push(polygon([place(at, AXIS), place(at + WEDGE_REACH, AXIS + sv * MOTIF_REACH), place(at - WEDGE_REACH, AXIS + sv * MOTIF_REACH)]));
      }
      junctions++;
    }
  }

  // Corners: three leaves on the diagonals toward the two neighbouring
  // rhombi; the outer one is left out, as printed.
  const corners: Place[] = [
    (u, v) => [u, v],
    (u, v) => [across - u, v],
    (u, v) => [u, down - v],
    (u, v) => [across - u, down - v],
  ];
  // Here (u, v) are both measured from the frame corner; 0.5, 0.5 is the corner tile's centre.
  const c = 0.5;
  for (const place of corners) {
    for (const [du, dv] of [[1, -1], [1, 1], [-1, 1]]) {
      const { leaf: shape, halo } = leaf(place(c + du * CORNER_LEAF, c + dv * CORNER_LEAF), direction(place, du, dv), CORNER_LEAF_LENGTH);
      paths.green.push(shape);
      paths.mint.push(halo);
    }
    // Where a fourth leaf would be, only its pale halo.
    paths.mint.push(leaf(place(c - CORNER_LEAF, c - CORNER_LEAF), direction(place, -1, -1), CORNER_LEAF_LENGTH).halo);
    junctions++;
  }

  const joined = Object.fromEntries(Object.entries(paths).map(([ink, parts]) => [ink, parts.join('')])) as Record<BorderInk, string>;
  return { across, down, paths: joined, counts: { junctions, rhombi, leaves: paths.green.length } };
}
