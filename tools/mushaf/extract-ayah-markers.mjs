#!/usr/bin/env node
// Extracts the ayah-end medallions (ornament + number artwork) from the
// bundled Quran SVG page so the QPC V1 renderer can draw them in place of
// the QCF V1 font's own marker glyph. Phase 1D: page 61 only.
//
//   node tools/mushaf/extract-ayah-markers.mjs
//
// Input: mobile/src/mushaf/generated/hafsKfqcPage061.ts — the original
// quran-ws/quran-svg v1.1.1 bytes, re-hashed here against the pinned SHA-256.
// Nothing is redrawn: the ornament and number paths are copied verbatim,
// with the transforms that place them on the page. Each marker is assigned
// to the ayah whose clickable polygon contains it, and the result must be
// one marker per ayah, in reading order.
//
// Licensing: the artwork is the King Fahd Glorious Qur'an Printing Complex's
// (published terms allow use in apps and software), the same artwork the app
// already bundles as its Quran SVG fallback page.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../../mobile/src/mushaf/generated/hafsKfqcPage061.ts', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../../mobile/src/mushaf/generated/ayahMarkers061.ts', import.meta.url));

const module = readFileSync(SOURCE, 'utf8');
const literal = (name) => JSON.parse(module.match(new RegExp(`\\b${name}: ("(?:[^"\\\\]|\\\\.)*")`))[1]);
const svg = literal('svg');
const mapping = JSON.parse(literal('mappingJson'));
const pinned = module.match(/svgSha256: '([0-9a-f]{64})'/)[1];
const page = Number(module.match(/\bpage: (\d+),/)[1]);
if (createHash('sha256').update(svg, 'utf8').digest('hex') !== pinned) throw new Error('Bundled SVG does not match its pinned SHA-256');

// ── Affine transforms (SVG order: a b c d e f) ──────────────────────────
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
function parseTransform(text) {
  let m = [1, 0, 0, 1, 0, 0];
  for (const [, op, args] of text.matchAll(/(matrix|translate|scale)\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    const step = op === 'matrix' ? v : op === 'translate' ? [1, 0, 0, 1, v[0], v[1] ?? 0] : [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    m = multiply(m, step);
  }
  return m;
}
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ── Path bounds (curves sampled finely; enough for a bounding box) ──────
function pathPoints(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);
  const points = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0;
  const num = () => Number(tokens[i++]);
  const curve = (p0, p1, p2, p3) => {
    for (let t = 0; t <= 1; t += 1 / 16) {
      const u = 1 - t;
      points.push(p3
        ? [u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0], u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]]
        : [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toLowerCase()) {
      case 'm': x = ox + num(); y = oy + num(); sx = x; sy = y; points.push([x, y]); cmd = rel ? 'l' : 'L'; break;
      case 'l': x = ox + num(); y = oy + num(); points.push([x, y]); break;
      case 'h': x = ox + num(); points.push([x, y]); break;
      case 'v': y = oy + num(); points.push([x, y]); break;
      case 'c': { const p1 = [ox + num(), oy + num()], p2 = [ox + num(), oy + num()], p3 = [ox + num(), oy + num()]; curve([x, y], p1, p2, p3); [cx, cy] = p2; [x, y] = p3; break; }
      case 's': { const p1 = [2 * x - cx, 2 * y - cy], p2 = [ox + num(), oy + num()], p3 = [ox + num(), oy + num()]; curve([x, y], p1, p2, p3); [cx, cy] = p2; [x, y] = p3; break; }
      case 'q': { const p1 = [ox + num(), oy + num()], p2 = [ox + num(), oy + num()]; curve([x, y], p1, p2); [cx, cy] = p1; [x, y] = p2; break; }
      case 'z': x = sx; y = sy; break;
      default: throw new Error(`Unsupported path command ${cmd}`);
    }
  }
  return points;
}
function bounds(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

// ── Ayah polygons (page coordinates), for assigning each marker ─────────
const polygons = mapping.map((entry) => ({
  verseKey: `${entry.surahNumber}:${entry.ayahNumber}`,
  ayah: entry.ayahNumber,
  rings: entry.polygon.split(/Z/i).map((ring) => (ring.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)).filter((ring) => ring.length >= 6)
    .map((ring) => ring.reduce((pts, value, index) => (index % 2 ? (pts[pts.length - 1].push(value), pts) : (pts.push([value]), pts)), [])),
}));
function inside(rings, [px, py]) {
  return rings.some((ring) => {
    let hit = false;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a], [xb, yb] = ring[b];
      if (ya > py !== yb > py && px < ((xb - xa) * (py - ya)) / (yb - ya) + xa) hit = !hit;
    }
    return hit;
  });
}

// ── Markers ─────────────────────────────────────────────────────────────
const pageTransformText = svg.match(/<svg[^>]*>\s*<g transform="([^"]+)"/)[1];
const pageTransform = parseTransform(pageTransformText);
const groups = [...svg.matchAll(/<g class="ayah-mark"><g class="ayah-mark-ornament" transform="([^"]+)"><path d="([^"]+)" fill="#231f20" fill-rule="evenodd" \/><\/g><g transform="([^"]+)"[^>]*><path d="([^"]+)" fill="#231f20" fill-rule="evenodd" \/><\/g><\/g>/g)];
if (groups.length !== mapping.length) throw new Error(`${groups.length} markers for ${mapping.length} ayahs`);
const ornamentPath = groups[0][2];
if (groups.some((g) => g[2] !== ornamentPath)) throw new Error('Markers do not share one ornament');
const ornamentPoints = pathPoints(ornamentPath);

const markers = groups.map(([, ornamentTransform, , numberTransform, numberPath]) => {
  const ornamentMatrix = multiply(pageTransform, parseTransform(ornamentTransform));
  const numberMatrix = multiply(pageTransform, parseTransform(numberTransform));
  const ornamentBox = bounds(ornamentPoints.map((p) => apply(ornamentMatrix, p)));
  const numberBox = bounds(pathPoints(numberPath).map((p) => apply(numberMatrix, p)));
  const centre = [ornamentBox.x + ornamentBox.width / 2, ornamentBox.y + ornamentBox.height / 2];
  const owners = polygons.filter((polygon) => inside(polygon.rings, centre));
  if (owners.length !== 1) throw new Error(`Marker at ${centre} lies in ${owners.length} ayah polygons`);
  const round = (box) => Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Number(v.toFixed(3))]));
  return {
    verseKey: owners[0].verseKey,
    ayah: owners[0].ayah,
    // Full transforms from the artwork's own coordinates to the page's (0 0 345 550).
    ornamentTransform: `matrix(${ornamentMatrix.map((v) => Number(v.toFixed(8))).join(' ')})`,
    numberTransform: `matrix(${numberMatrix.map((v) => Number(v.toFixed(8))).join(' ')})`,
    numberPath,
    ornamentBox: round(ornamentBox),
    numberBox: round(numberBox),
  };
}).sort((a, b) => a.ayah - b.ayah);

const keys = markers.map((m) => m.verseKey);
if (new Set(keys).size !== keys.length || keys.join() !== polygons.map((p) => p.verseKey).join()) {
  throw new Error(`Markers ${keys.join(',')} do not match the page's ayahs ${polygons.map((p) => p.verseKey).join(',')}`);
}

writeFileSync(OUTPUT, `// GENERATED by tools/mushaf/extract-ayah-markers.mjs — do not edit.
// Ayah-end medallions copied verbatim from the bundled quran-ws/quran-svg v1.1.1
// page ${page} (hafsKfqcPage061.ts, SVG SHA-256 ${pinned}).
// Artwork © King Fahd Glorious Qur'an Printing Complex (free for use in apps and software).
import type { AyahMarkerArtwork } from '../ayahMarkers';

export const AYAH_MARKERS_061: AyahMarkerArtwork = ${JSON.stringify({ page, svgSha256: pinned, ornamentPath, markers }, null, 2)};
`);
console.log(`Wrote ${markers.length} markers (${keys.join(' ')}) to ${OUTPUT}`);
for (const m of markers) console.log(m.verseKey, 'ornament', m.ornamentBox, 'number', m.numberBox);
