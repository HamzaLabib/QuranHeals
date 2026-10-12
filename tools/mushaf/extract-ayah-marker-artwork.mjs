#!/usr/bin/env node
// Extracts the ayah-end medallion artwork for ALL 604 pages, so every page
// draws the same approved medallion page 61 does. (Phase 1D extracted page
// 61's artwork only, and every other page kept the QCF V1 font's plain
// marker glyph, tinted green.)
//
//   node tools/mushaf/fetch-quran-svg.mjs <dir>
//   node tools/mushaf/extract-ayah-marker-artwork.mjs <dir>
//
// Input: the 604 quran-ws/quran-svg v1.1.1 pages (Hafs / KFQC), each
// re-hashed here against quran-svg-v1.1.1.lock.json. Nothing is redrawn:
//  - The ornament: all 6,236 medallions on the 604 pages use one
//    byte-identical path (checked), page 61's. It is placed by page 61's
//    first transform (3:84), so every page shares page 61's frame.
//  - The number: each medallion carries its own tracing of its number. Per
//    ayah number (1–286) one occurrence is kept, copied verbatim with its
//    original placement inside its ornament: page 61's own where the number
//    is on page 61 (84–91, the approved reference), otherwise the most
//    typical one (the medoid of its width, height and centre in the frame).
// Each medallion is first assigned to the ayah whose clickable polygon
// contains it; every page must give exactly one per ayah, 6,236 in all.
//
// Output: mobile/src/mushaf/generated/ayahMarkerArtwork.ts (bundled) and
// tools/mushaf/ayah-marker-artwork.report.json (provenance and the per-page
// check, read by the tests; not bundled).
//
// Licensing: the artwork is the King Fahd Glorious Qur'an Printing Complex's
// (published terms allow use in apps and software), from the same release
// as the page-61 artwork the app already bundled.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] && resolve(process.argv[2]);
if (!dir) throw new Error('Usage: node tools/mushaf/extract-ayah-marker-artwork.mjs <dir from fetch-quran-svg.mjs>');
const lock = JSON.parse(readFileSync(new URL('./quran-svg-v1.1.1.lock.json', import.meta.url), 'utf8'));
const OUTPUT = fileURLToPath(new URL('../../mobile/src/mushaf/generated/ayahMarkerArtwork.ts', import.meta.url));
const REPORT = fileURLToPath(new URL('./ayah-marker-artwork.report.json', import.meta.url));
const REFERENCE_PAGE = 61;

const blobSha = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
function readPinned(sub, name) {
  const bytes = readFileSync(join(dir, sub, name));
  if (blobSha(bytes) !== lock[sub][name]) throw new Error(`${sub}/${name} does not match its pinned git blob SHA-1`);
  return bytes.toString('utf8');
}

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

const inverse = (m) => {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
};
const matrixText = (m) => `matrix(${m.map((v) => Number(v.toFixed(8))).join(' ')})`;
const round = (box) => Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Number(v.toFixed(3))]));

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

const MARK = /<g class="ayah-mark"><g class="ayah-mark-ornament" transform="([^"]+)"><path d="([^"]+)" fill="#231f20" fill-rule="evenodd" \/><\/g><g transform="([^"]+)"[^>]*><path d="([^"]+)" fill="#231f20" fill-rule="evenodd" \/><\/g><\/g>/g;

let ornamentPath = null;
let reference = null; // page 61, 3:84: the shared frame
const occurrences = new Map(); // ayah number → [{ page, verseKey, rel, numberPath }]
const pages = [];
for (let page = 1; page <= 604; page++) {
  const name = String(page).padStart(3, '0');
  const svg = readPinned('svg', `${name}.svg`);
  const mapping = JSON.parse(readPinned('json', `${name}.json`));
  const polygons = mapping.map((entry) => ({
    verseKey: `${entry.surahNumber}:${entry.ayahNumber}`,
    ayah: entry.ayahNumber,
    rings: entry.polygon.split(/Z/i).map((ring) => (ring.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)).filter((ring) => ring.length >= 6)
      .map((ring) => ring.reduce((pts, value, index) => (index % 2 ? (pts[pts.length - 1].push(value), pts) : (pts.push([value]), pts)), [])),
  }));
  const pageTransform = parseTransform(svg.match(/<svg[^>]*>\s*<g transform="([^"]+)"/)[1]);
  const groups = [...svg.matchAll(MARK)];
  const allGroups = (svg.match(/class="ayah-mark"/g) ?? []).length;
  if (groups.length !== allGroups || groups.length !== mapping.length) throw new Error(`Page ${page}: ${groups.length} medallions read, ${allGroups} in the SVG, ${mapping.length} ayahs`);
  ornamentPath ??= groups[0][2];
  const ornamentPoints = pathPoints(ornamentPath);
  const found = groups.map(([, ornamentTransform, path, numberTransform, numberPath]) => {
    if (path !== ornamentPath) throw new Error(`Page ${page}: a medallion with a different ornament`);
    const ornamentMatrix = multiply(pageTransform, parseTransform(ornamentTransform));
    const box = bounds(ornamentPoints.map((p) => apply(ornamentMatrix, p)));
    const centre = [box.x + box.width / 2, box.y + box.height / 2];
    const owners = polygons.filter((polygon) => inside(polygon.rings, centre));
    if (owners.length !== 1) throw new Error(`Page ${page}: medallion at ${centre} lies in ${owners.length} ayah polygons`);
    // The number's placement relative to its own ornament (artwork coordinates).
    const rel = multiply(inverse(parseTransform(ornamentTransform)), parseTransform(numberTransform));
    return { verseKey: owners[0].verseKey, ayah: owners[0].ayah, ornamentMatrix, rel, numberPath };
  });
  const keys = found.map((m) => m.verseKey);
  const expected = polygons.map((p) => p.verseKey);
  if (new Set(keys).size !== keys.length || [...keys].sort().join() !== [...expected].sort().join()) throw new Error(`Page ${page}: medallions ${keys} ≠ ayahs ${expected}`);
  for (const m of found) {
    const list = occurrences.get(m.ayah) ?? [];
    list.push({ page, verseKey: m.verseKey, rel: m.rel, numberPath: m.numberPath });
    occurrences.set(m.ayah, list);
    if (page === REFERENCE_PAGE && m.verseKey === '3:84') reference = m;
  }
  pages.push({ page, verseKeys: expected });
}
if (!reference) throw new Error('Page 61 medallion 3:84 not found');

// Shared frame: page 61's first medallion, exactly as phase 1D placed it.
const ornamentBox = bounds(pathPoints(ornamentPath).map((p) => apply(reference.ornamentMatrix, p)));

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const numbers = [];
for (let ayah = 1; ayah <= 286; ayah++) {
  const list = occurrences.get(ayah);
  if (!list) throw new Error(`No medallion for ayah number ${ayah}`);
  const measured = list.map((o) => {
    const matrix = multiply(reference.ornamentMatrix, o.rel);
    return { ...o, matrix, box: bounds(pathPoints(o.numberPath).map((p) => apply(matrix, p))) };
  });
  const mw = median(measured.map((o) => o.box.width)), mh = median(measured.map((o) => o.box.height));
  const mx = median(measured.map((o) => o.box.x + o.box.width / 2)), my = median(measured.map((o) => o.box.y + o.box.height / 2));
  const score = (o) => Math.abs(o.box.width - mw) + Math.abs(o.box.height - mh) + Math.abs(o.box.x + o.box.width / 2 - mx) + Math.abs(o.box.y + o.box.height / 2 - my);
  // Page 61 is the approved reference: its own tracings (84–91) are kept; elsewhere the most typical one.
  const chosen = measured.find((o) => o.page === REFERENCE_PAGE) ?? measured.reduce((best, o) => (score(o) < score(best) - 1e-9 ? o : best));
  numbers.push({
    ayah,
    numberTransform: matrixText(chosen.matrix),
    numberPath: chosen.numberPath,
    numberBox: round(chosen.box),
    source: { page: chosen.page, verseKey: chosen.verseKey },
    occurrences: list.length,
  });
}

const total = pages.reduce((sum, p) => sum + p.verseKeys.length, 0);
if (total !== 6236) throw new Error(`${total} medallions, expected 6236`);

const artwork = {
  source: { repository: lock.repository, tag: lock.tag, commit: lock.commit, edition: lock.edition },
  ornamentSha256: sha256(ornamentPath),
  ornamentPath,
  ornamentTransform: matrixText(reference.ornamentMatrix),
  ornamentBox: round(ornamentBox),
  numbers: numbers.map(({ ayah, numberTransform, numberPath, numberBox, source }) => ({ ayah, numberTransform, numberPath, numberBox, source })),
};
writeFileSync(OUTPUT, `// GENERATED by tools/mushaf/extract-ayah-marker-artwork.mjs — do not edit.
// Ayah-end medallion artwork for all 604 pages, copied verbatim from
// ${lock.repository} ${lock.tag} (${lock.edition}, commit ${lock.commit}):
// the one ornament all 6,236 medallions share, in page 61's frame, and one
// tracing of each ayah number 1–286 (its page in \`source\`).
// Artwork © King Fahd Glorious Qur'an Printing Complex (free for use in apps and software).
import type { AyahMarkerArtworkSet } from '../ayahMarkers';

export const AYAH_MARKER_ARTWORK: AyahMarkerArtworkSet = ${JSON.stringify(artwork, null, 1)};
`);
writeFileSync(REPORT, JSON.stringify({
  generatedBy: 'tools/mushaf/extract-ayah-marker-artwork.mjs',
  source: artwork.source,
  ornamentSha256: artwork.ornamentSha256,
  medallions: total,
  pages: pages.length,
  numbers: numbers.map(({ ayah, source, occurrences: n }) => ({ ayah, source, occurrences: n })),
  pageMedallions: Object.fromEntries(pages.map((p) => [p.page, p.verseKeys])),
}) + '\n');
console.log(`${total} medallions on ${pages.length} pages, one ornament (${artwork.ornamentSha256.slice(0, 12)}…), numbers 1–286 → ${OUTPUT}`);
