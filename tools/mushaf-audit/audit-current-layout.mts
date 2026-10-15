// Geometry audit of the CURRENT Mushaf layout (QURAN_TEXT_SCALE, MIN_TILES_DOWN…), all 604 pages, in Node — for
// machines without Python. It imports the app's own geometry and placement code (pageGeometry.ts, ayahMarkers.ts,
// surahHeadingPlacement.ts, surahOpenings.ts), so it always measures the layout the app ships, and reads every glyph's
// real outlines from the 604 QCF V1 page fonts (contours that enclose area, as the Python audits do).
//
//   npx tsx tools/mushaf-audit/audit-current-layout.mts <fonts dir> <records-*.json.gz> <out.json> [--calibrate]
//
// Checks (each per page, all 604):
//   A. structure: 15 rows on pages 3–604 (text lines + Surah heading/Basmala slots fill every row), glyph codes in
//      their own page font (no fallback), 6,236 ayah-end markers, layout order;
//   B. horizontal: the outermost real ink of every line against the frame's inner rule (pt, at every page width);
//   C. clipping: every word's ink inside its drawn Text (advance ± QCF_V1_INK_OVERFLOW_EM; the line box ±
//      QCF_V1_INK_ROOM_V_EM, + QCF_V1_NORMAL_BOX_MARGIN_EM in Normal Mode), at the web and the native glyph placement;
//   D. neighbouring lines: word outlines of adjacent lines rasterised where their boxes overlap (shared ink pixels),
//      at every frame height the app uses (MIN_TILES_DOWN … 35 tiles); also each medallion against the lines next to it;
//   E. vertical: the first and last row's outermost ink (letters, marks, medallions, the Basmala, the Surah heading
//      band) against the frame's inner rule, with MUSHAF_TEXT_LIFT_PT, on web, iOS and Android placements, for every
//      page width × frame height.
// --calibrate also runs D on the PRINTED layout (scale 1, 29 tiles) to compare with audit_line_collisions.py's
// published result (outline intersections on pages 98, 213 and 341 only).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import {
  BORDER_TILES_DOWN,
  computePageLayout,
  MIN_TILES_DOWN,
  MUSHAF_TEXT_LIFT_PT,
  mushafTextLift,
  NATIVE_TEXT_LIFT_EM,
  NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH,
  PAGE_GEOMETRY,
  pageWidthOfText,
  PRINTED_TEXT_WIDTH_SHARE,
  QURAN_TEXT_SCALE,
} from '../../mobile/src/mushaf/pageGeometry';
import {
  getAyahMarker,
  MARKER_SCALE,
  QCF_V1_INK_OVERFLOW_EM,
  QCF_V1_INK_ROOM_V_EM,
  QCF_V1_LINE_BOX_EM,
  QCF_V1_NORMAL_BOX_MARGIN_EM,
  qcfV1AndroidRowShiftEm,
  qcfV1DrawnLineShiftEm,
  qcfV1IntendedBaselineUnits,
} from '../../mobile/src/mushaf/ayahMarkers';
import { IOS_MEDALLION_LIFT_UNITS, placeSurahHeading } from '../../mobile/src/mushaf/surahHeadingPlacement';
import { BASMALA_GLYPHS, isOpeningPage, surahOpeningSlots } from '../../mobile/src/mushaf/surahOpenings';

const [FONTS, RECORDS, OUT] = process.argv.slice(2);
const CALIBRATE = process.argv.includes('--calibrate');
// --lift-em X: E (vertical) with a lift of X × the letter size instead of MUSHAF_TEXT_LIFT_PT — to evaluate a proposal; the app is unchanged.
const LIFT_EM = process.argv.includes('--lift-em') ? Number(process.argv[process.argv.indexOf('--lift-em') + 1]) : null;
const UPM = 2048;
const FIT = 0.985; // QpcV1PageText.tsx
const OPENING_PAGE_SIZE_PER_WIDTH = 0.0692; // QpcV1PageText.tsx
const WORD_GAP_EM = 0.033; // QpcV1PageText.tsx
const TALLER_MAX_TILES_DOWN = 35; // app/(tabs)/mushaf.tsx
// Page widths the app shows (pt): small Android (274), iPhone SE (324), the current iPhones and Androids, tablets.
const WIDTHS = [268, 274, 317, 324, 354, 367, 378, 384, 387, 390, 396, 406, 424, 434, 442, 467, 681];
const TILES = Array.from({ length: TALLER_MAX_TILES_DOWN - MIN_TILES_DOWN + 1 }, (_, i) => MIN_TILES_DOWN + i);
const REF = 1000; // reference page width (pt) for scale-free measures
const LINE_BOX = QCF_V1_LINE_BOX_EM * 2048; // units
const RASTER_PX_PER_EM = 128; // collision raster: ~2× a 3× phone at the app's letter sizes (~23 pt ≈ 69 px)

// ── Fonts: cmap, hmtx, glyf outlines ────────────────────────────────────────────────────────────────────────────
type Pt = [number, number];
type Box4 = { xMin: number; xMax: number; yMin: number; yMax: number };
/** ink: every contour that encloses area; body: without stray specks (tiny contours the font stores far outside the glyph's advance). */
type Glyph = { advance: number; contours: Pt[][]; ink: Box4 | null; body: Box4 | null; specks: Box4[]; bbox: [number, number, number, number] };
const SPECK_MAX_UNITS = 128; // 1/16 em: a speck's width and height are both below this
const SPECK_OUTSIDE_UNITS = 512; // 1/4 em outside the advance
type Font = { glyph: (codePoint: number) => Glyph | null; sha256: string };

function parseFont(buf: Buffer): Font {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables: Record<string, number> = {};
  for (let i = 0; i < dv.getUint16(4); i++) {
    const o = 12 + i * 16;
    tables[String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])] = dv.getUint32(o + 8);
  }
  // cmap, fontTools getBestCmap order (as export-word-advances.mjs).
  const cmapAt = tables.cmap;
  const subs: { p: number; e: number; at: number }[] = [];
  for (let i = 0; i < dv.getUint16(cmapAt + 2); i++) {
    const o = cmapAt + 4 + i * 8;
    subs.push({ p: dv.getUint16(o), e: dv.getUint16(o + 2), at: cmapAt + dv.getUint32(o + 4) });
  }
  const best = [[3, 10], [0, 6], [0, 4], [3, 1], [0, 3], [0, 2], [0, 1], [0, 0]].map(([p, e]) => subs.find((s) => s.p === p && s.e === e)).find(Boolean);
  if (!best) throw new Error('no usable cmap');
  const cmap = new Map<number, number>();
  const format = dv.getUint16(best.at);
  if (format === 4) {
    const segX2 = dv.getUint16(best.at + 6);
    const ends = best.at + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2), delta = dv.getInt16(deltas + s * 2), rangeAt = ranges + s * 2, range = dv.getUint16(rangeAt);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g = range === 0 ? (c + delta) & 0xffff : dv.getUint16(rangeAt + range + (c - start) * 2);
        if (range !== 0 && g !== 0) g = (g + delta) & 0xffff;
        if (g !== 0) cmap.set(c, g);
      }
    }
  } else if (format === 12) {
    for (let i = 0; i < dv.getUint32(best.at + 12); i++) {
      const o = best.at + 16 + i * 12;
      const start = dv.getUint32(o), end = dv.getUint32(o + 4), gid = dv.getUint32(o + 8);
      for (let c = start; c <= end; c++) cmap.set(c, gid + (c - start));
    }
  } else throw new Error(`cmap format ${format}`);
  const numH = dv.getUint16(tables.hhea + 34);
  const advance = (g: number) => dv.getUint16(tables.hmtx + Math.min(g, numH - 1) * 4);
  const longLoca = dv.getInt16(tables.head + 50) === 1;
  const loca = (g: number) => (longLoca ? dv.getUint32(tables.loca + g * 4) : dv.getUint16(tables.loca + g * 2) * 2);

  /** Raw contours (on-curve flags kept) of glyph g, components resolved. */
  function rawContours(g: number, depth = 0): { x: number; y: number; on: boolean }[][] {
    const start = loca(g), end = loca(g + 1);
    if (end <= start) return [];
    const at = tables.glyf + start;
    const n = dv.getInt16(at);
    if (n >= 0) {
      const endPts = Array.from({ length: n }, (_, i) => dv.getUint16(at + 10 + i * 2));
      const count = n ? endPts[n - 1] + 1 : 0;
      let p = at + 10 + n * 2;
      p += 2 + dv.getUint16(p);
      const flags: number[] = [];
      while (flags.length < count) {
        const f = buf[p++];
        flags.push(f);
        if (f & 8) for (let r = buf[p++]; r > 0; r--) flags.push(f);
      }
      const xs: number[] = [], ys: number[] = [];
      let v = 0;
      for (const f of flags) {
        if (f & 2) v += f & 16 ? buf[p++] : -buf[p++];
        else if (!(f & 16)) { v += dv.getInt16(p); p += 2; }
        xs.push(v);
      }
      v = 0;
      for (const f of flags) {
        if (f & 4) v += f & 32 ? buf[p++] : -buf[p++];
        else if (!(f & 32)) { v += dv.getInt16(p); p += 2; }
        ys.push(v);
      }
      const out = [];
      let s = 0;
      for (const e of endPts) {
        out.push(Array.from({ length: e - s + 1 }, (_, i) => ({ x: xs[s + i], y: ys[s + i], on: (flags[s + i] & 1) === 1 })));
        s = e + 1;
      }
      return out;
    }
    if (depth > 8) throw new Error('composite too deep');
    const out: { x: number; y: number; on: boolean }[][] = [];
    let p = at + 10;
    for (;;) {
      const flags = dv.getUint16(p), child = dv.getUint16(p + 2);
      p += 4;
      let dx: number, dy: number;
      if (flags & 1) { dx = dv.getInt16(p); dy = dv.getInt16(p + 2); p += 4; } else { dx = dv.getInt8(p); dy = dv.getInt8(p + 1); p += 2; }
      if (!(flags & 2)) throw new Error('composite point matching is not supported');
      let a = 1, b = 0, c = 0, d = 1;
      if (flags & 8) { a = d = dv.getInt16(p) / 16384; p += 2; }
      else if (flags & 0x40) { a = dv.getInt16(p) / 16384; d = dv.getInt16(p + 2) / 16384; p += 4; }
      else if (flags & 0x80) { a = dv.getInt16(p) / 16384; b = dv.getInt16(p + 2) / 16384; c = dv.getInt16(p + 4) / 16384; d = dv.getInt16(p + 6) / 16384; p += 8; }
      for (const contour of rawContours(child, depth + 1)) out.push(contour.map((q) => ({ x: a * q.x + c * q.y + dx, y: b * q.x + d * q.y + dy, on: q.on })));
      if (!(flags & 0x20)) break;
    }
    return out;
  }

  /** A contour as a polygon: quadratic curves sampled in 16 steps (as the Python audits' InkPen). */
  function polygon(raw: { x: number; y: number; on: boolean }[]): Pt[] {
    if (raw.length === 0) return [];
    const pts = raw.slice();
    let startIdx = pts.findIndex((q) => q.on);
    let first: { x: number; y: number };
    if (startIdx === -1) { first = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 }; startIdx = 0; }
    else first = pts[startIdx];
    const seq = [...pts.slice(startIdx), ...pts.slice(0, startIdx)];
    const out: Pt[] = [[first.x, first.y]];
    let cur = first;
    let ctrl: { x: number; y: number } | null = null;
    const curveTo = (q: { x: number; y: number }, to: { x: number; y: number }) => {
      for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; out.push([u * u * cur.x + 2 * u * t * q.x + t * t * to.x, u * u * cur.y + 2 * u * t * q.y + t * t * to.y]); }
      cur = to;
    };
    for (let i = seq[0] === first ? 1 : 0; i <= seq.length; i++) {
      const q = i === seq.length ? first : seq[i];
      const on = i === seq.length ? true : seq[i].on;
      if (on) {
        if (ctrl) { curveTo(ctrl, q); ctrl = null; } else { out.push([q.x, q.y]); cur = q; }
      } else if (ctrl) {
        const mid = { x: (ctrl.x + q.x) / 2, y: (ctrl.y + q.y) / 2 };
        curveTo(ctrl, mid);
        ctrl = q;
      } else ctrl = q;
    }
    return out;
  }

  const cache = new Map<number, Glyph>();
  return {
    sha256: createHash('sha256').update(buf).digest('hex'),
    glyph(cp) {
      const g = cmap.get(cp);
      if (g === undefined) return null;
      const hit = cache.get(g);
      if (hit) return hit;
      const contours = rawContours(g).map(polygon).filter((poly) => {
        let area = 0;
        for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; area += x0 * y1 - x1 * y0; }
        return poly.length > 2 && Math.abs(area / 2) > 1;
      });
      const boxOf = (polys: Pt[][]): Box4 | null => {
        const xs = polys.flat().map((p) => p[0]), ys = polys.flat().map((p) => p[1]);
        return xs.length ? { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) } : null;
      };
      const adv = advance(g);
      const isSpeck = (b: Box4) => b.xMax - b.xMin < SPECK_MAX_UNITS && b.yMax - b.yMin < SPECK_MAX_UNITS && (b.xMax < -SPECK_OUTSIDE_UNITS || b.xMin > adv + SPECK_OUTSIDE_UNITS);
      const boxes = contours.map((c) => boxOf([c])!);
      const at = tables.glyf + loca(g);
      const glyph: Glyph = {
        advance: adv,
        contours,
        ink: boxOf(contours),
        body: boxOf(contours.filter((_, i) => !isSpeck(boxes[i]))),
        specks: boxes.filter(isSpeck),
        bbox: loca(g + 1) > loca(g) ? [dv.getInt16(at + 2), dv.getInt16(at + 6), dv.getInt16(at + 4), dv.getInt16(at + 8)] : [0, 0, 0, 0],
      };
      cache.set(g, glyph);
      return glyph;
    },
  };
}

// ── Layout data ──────────────────────────────────────────────────────────────────────────────────────────────────
type Rec = { verse_id: number; text: string; char_type_name: string; page_number: number; line_number: number; position_in_page: number; position_in_verse: number; mushaf_id: number; record_type: string };
const counts: number[] = JSON.parse(readFileSync(new URL('../quran-verification/surah-counts.json', import.meta.url), 'utf8')).counts;
const verseKeys = counts.flatMap((n, s) => Array.from({ length: n }, (_, a) => `${s + 1}:${a + 1}`));
const records: Rec[] = JSON.parse(gunzipSync(readFileSync(RECORDS)).toString('utf8')).filter((r: Rec) => r.record_type === 'mushaf_word' && r.mushaf_id === 2);
const byPage = new Map<number, Rec[]>();
for (const r of records) byPage.set(r.page_number, [...(byPage.get(r.page_number) ?? []), r]);
const basmalaFont = parseFont(readFileSync(`${FONTS}/p1.ttf`));
const basmalaInk = BASMALA_GLYPHS.map((ch) => basmalaFont.glyph(ch.codePointAt(0)!)!.ink!);
const BAS = { yMin: Math.min(...basmalaInk.map((i) => i.yMin)), yMax: Math.max(...basmalaInk.map((i) => i.yMax)) };

/** A word's glyphs placed right to left (the first glyph at the right), in font units from the word's left edge. */
type Placed = { glyph: Glyph; x: number };
function placeWord(font: Font, text: string, page: number): { glyphs: Placed[]; advance: number; missing: string[] } {
  const glyphs = [...text].map((ch) => ({ ch, glyph: font.glyph(ch.codePointAt(0)!) }));
  const missing = glyphs.filter((g) => !g.glyph).map((g) => `U+${g.ch.codePointAt(0)!.toString(16)}`);
  const ok = glyphs.filter((g) => g.glyph) as { ch: string; glyph: Glyph }[];
  const advance = ok.reduce((s, g) => s + g.glyph.advance, 0);
  let x = 0;
  const placed: Placed[] = [];
  for (const g of [...ok].reverse()) { placed.push({ glyph: g.glyph, x }); x += g.glyph.advance; }
  if (missing.length && page) return { glyphs: placed, advance, missing };
  return { glyphs: placed, advance, missing };
}

type Word = { kind: string; verseKey: string; position: number; advance: number; glyphs: Placed[]; ink: Box4 | null; body: Box4 | null; specks: Box4[]; bboxY: [number, number] };
type PageModel = { page: number; lines: Map<number, Word[]>; widest: number; missing: string[]; sha256: string; slots: ReturnType<typeof surahOpeningSlots> };

function modelPage(page: number): PageModel {
  const font = parseFont(readFileSync(`${FONTS}/p${page}.ttf`));
  const lines = new Map<number, Word[]>();
  const missing: string[] = [];
  for (const r of [...(byPage.get(page) ?? [])].sort((a, b) => a.position_in_page - b.position_in_page)) {
    const placed = placeWord(font, r.text, page);
    missing.push(...placed.missing.map((m) => `line ${r.line_number}: ${m}`));
    const union = (pick: (g: Glyph) => Box4 | null) => {
      const inks = placed.glyphs.filter((g) => pick(g.glyph)).map((g) => { const b = pick(g.glyph)!; return { xMin: g.x + b.xMin, xMax: g.x + b.xMax, yMin: b.yMin, yMax: b.yMax }; });
      return inks.length ? { xMin: Math.min(...inks.map((i) => i.xMin)), xMax: Math.max(...inks.map((i) => i.xMax)), yMin: Math.min(...inks.map((i) => i.yMin)), yMax: Math.max(...inks.map((i) => i.yMax)) } : null;
    };
    const ink = union((g) => g.ink), body = union((g) => g.body);
    const specks = placed.glyphs.flatMap((g) => g.glyph.specks.map((b) => ({ xMin: g.x + b.xMin, xMax: g.x + b.xMax, yMin: b.yMin, yMax: b.yMax })));
    const bboxY: [number, number] = [Math.min(...placed.glyphs.map((g) => g.glyph.bbox[2])), Math.max(...placed.glyphs.map((g) => g.glyph.bbox[3]))];
    const word: Word = { kind: r.char_type_name === 'end' ? 'end' : 'word', verseKey: verseKeys[r.verse_id - 1], position: r.position_in_verse, advance: placed.advance, glyphs: placed.glyphs, ink, body, specks, bboxY };
    if (!lines.has(r.line_number)) lines.set(r.line_number, []);
    lines.get(r.line_number)!.push(word);
  }
  const widest = Math.max(...[...lines.values()].map((ws) => ws.reduce((s, w) => s + w.advance, 0)));
  const slots = surahOpeningSlots({ lines: [...lines.entries()].map(([line, words]) => ({ line, words })) } as never);
  return { page, lines, widest, missing, sha256: font.sha256, slots };
}

/** Words placed on a line: left edge x (pt, from the text area's left), font size known. */
function placeLine(model: PageModel, words: Word[], textWidth: number, size: number): number[] {
  const em = size / UPM;
  const widths = words.map((w) => w.advance * em);
  const opening = isOpeningPage(model.page);
  const gap = opening ? WORD_GAP_EM * size : words.length > 1 ? (textWidth - widths.reduce((a, b) => a + b, 0)) / (words.length - 1) : 0;
  let right = opening ? (textWidth + widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1)) / 2 : textWidth;
  return widths.map((w) => { const left = right - w; right = left - gap; return left; });
}

const fontSizeOf = (model: PageModel, textWidth: number) =>
  isOpeningPage(model.page) ? pageWidthOfText(textWidth) * PRINTED_TEXT_WIDTH_SHARE * OPENING_PAGE_SIZE_PER_WIDTH : (textWidth * FIT) / (model.widest / UPM);

// ── Rasterised outline overlap (D) ─────────────────────────────────────────────────────────────────────────────
type Shape = { polys: Pt[][] }; // in pt, y down
function cover(shape: Shape, x0: number, y0: number, w: number, h: number, step: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) * step;
    const xs: { x: number; dir: number }[] = [];
    for (const poly of shape.polys) {
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push({ x: ax + ((y - ay) / (by - ay)) * (bx - ax), dir: by > ay ? 1 : -1 });
      }
    }
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k].dir;
      if (wind === 0) continue;
      const from = Math.max(0, Math.ceil((xs[k].x - x0) / step - 0.5)), to = Math.min(w - 1, Math.floor((xs[k + 1].x - x0) / step - 0.5));
      for (let i = from; i <= to; i++) out[j * w + i] = 1;
    }
  }
  return out;
}
function sharedPixels(a: Shape, b: Shape, box: [number, number, number, number], step: number): number {
  const [x0, x1, y0, y1] = box;
  const w = Math.ceil((x1 - x0) / step), h = Math.ceil((y1 - y0) / step);
  if (w <= 0 || h <= 0) return 0;
  const ca = cover(a, x0, y0, w, h, step), cb = cover(b, x0, y0, w, h, step);
  let n = 0;
  for (let i = 0; i < ca.length; i++) if (ca[i] && cb[i]) n++;
  return n;
}
const wordShape = (w: Word, left: number, baseline: number, em: number): Shape => ({
  polys: w.glyphs.flatMap((g) => g.glyph.contours.map((poly) => poly.map(([x, y]) => [left + (g.x + x) * em, baseline - y * em] as Pt))),
});

// ── Run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const t0 = Date.now();
const models: PageModel[] = [];
// One page at a time: its outlines are only needed for D (neighbouring lines), then only the ink boxes are kept.
const neighbourRuns = TILES.map((t) => collisions(QURAN_TEXT_SCALE, t));
const calibrationRuns = CALIBRATE ? [collisions(1, BORDER_TILES_DOWN), collisions(1, 30), collisions(1, BORDER_TILES_DOWN, true), collisions(1, 30, true)] : [];
for (let page = 1; page <= 604; page++) {
  const m = modelPage(page);
  for (const run of [...neighbourRuns, ...calibrationRuns]) run.add(m);
  for (const w of [...m.lines.values()].flat()) w.glyphs = [];
  models.push(m);
}

// A. Structure.
const structure = { pages: 604, wordRecords: records.length, missingGlyphs: [] as string[], rowsNot15: [] as number[], ayahEnds: 0, layoutOrderErrors: [] as number[], fontSha256: {} as Record<number, string> };
for (const m of models) {
  structure.fontSha256[m.page] = m.sha256;
  structure.missingGlyphs.push(...m.missing.map((x) => `page ${m.page} ${x}`));
  structure.ayahEnds += [...m.lines.values()].flat().filter((w) => w.kind === 'end').length;
  const used = new Set([...m.lines.keys(), ...m.slots.map((s) => s.line)]);
  if (!isOpeningPage(m.page) && (used.size !== 15 || [...used].some((l) => l < 1 || l > 15))) structure.rowsNot15.push(m.page);
}
// Layout order: verse ids never decrease through a page and across pages.
let lastVerse = 0;
for (let page = 1; page <= 604; page++) {
  for (const r of [...(byPage.get(page) ?? [])].sort((a, b) => a.position_in_page - b.position_in_page)) {
    if (r.verse_id < lastVerse) structure.layoutOrderErrors.push(page);
    lastVerse = r.verse_id;
  }
}

// B. Horizontal ink against the inner rule (proportional to the page width: computed at 1000, reported in pt).
const refLayout = computePageLayout(REF, MIN_TILES_DOWN);
const sideInsetRef = (refLayout.text.x - refLayout.inner.x); // text area → inner rule, each side
const specks: { page: number; line: number; verseKey: string; position: number; leftFrac: number; rightFrac: number; sizePtAt387: number }[] = [];
const horizontal = models.map((m) => {
  const size = fontSizeOf(m, refLayout.text.width), em = size / UPM;
  let right = -Infinity, left = Infinity, rightLine = 0, leftLine = 0;
  for (const [ln, words] of m.lines) {
    const lefts = placeLine(m, words, refLayout.text.width, size);
    words.forEach((w, i) => {
      // Specks (stray contours far outside the advance) are reported separately, below.
      for (const sp of w.specks) specks.push({ page: m.page, line: ln, verseKey: w.verseKey, position: w.position, leftFrac: (sideInsetRef + lefts[i] + sp.xMin * em) / REF, rightFrac: (sideInsetRef - (lefts[i] + sp.xMax * em - refLayout.text.width)) / REF, sizePtAt387: +(Math.max(sp.xMax - sp.xMin, sp.yMax - sp.yMin) * em / REF * 387).toFixed(2) });
      if (!w.body) return;
      const r = lefts[i] + w.body.xMax * em, l = lefts[i] + w.body.xMin * em;
      if (r > right) { right = r; rightLine = ln; }
      if (l < left) { left = l; leftLine = ln; }
    });
  }
  // Clearance to the inner rule, as a fraction of the page width.
  return { page: m.page, rightFrac: (sideInsetRef - (right - refLayout.text.width)) / REF, rightLine, leftFrac: (sideInsetRef + left) / REF, leftLine };
});
const hWorstRight = horizontal.reduce((a, b) => (b.rightFrac < a.rightFrac ? b : a));
const hWorstLeft = horizontal.reduce((a, b) => (b.leftFrac < a.leftFrac ? b : a));
const horizontalSummary = {
  sideMarginFraction: sideInsetRef / REF,
  worstRight: { page: hWorstRight.page, line: hWorstRight.rightLine, fraction: hWorstRight.rightFrac },
  worstLeft: { page: hWorstLeft.page, line: hWorstLeft.leftLine, fraction: hWorstLeft.leftFrac },
  ptByWidth: Object.fromEntries(WIDTHS.map((w) => [w, { margin: +(sideInsetRef / REF * w).toFixed(2), minRight: +(hWorstRight.rightFrac * w).toFixed(2), minLeft: +(hWorstLeft.leftFrac * w).toFixed(2) }])),
  under4PtAt387: horizontal.filter((h) => Math.min(h.rightFrac, h.leftFrac) * 387 < 4).map((h) => ({ page: h.page, rightPt: +(h.rightFrac * 387).toFixed(2), rightLine: h.rightLine, leftPt: +(h.leftFrac * 387).toFixed(2), leftLine: h.leftLine })),
  specks: { count: specks.length, beyondInnerRule: specks.filter((x) => x.leftFrac <= 0 || x.rightFrac <= 0).map((x) => ({ ...x, leftPtAt387: +(x.leftFrac * 387).toFixed(2), rightPtAt387: +(x.rightFrac * 387).toFixed(2) })) },
  pagesTouching: horizontal.filter((h) => h.rightFrac <= 0 || h.leftFrac <= 0).map((h) => h.page),
  tightest10: [...horizontal].sort((a, b) => Math.min(a.rightFrac, a.leftFrac) - Math.min(b.rightFrac, b.leftFrac)).slice(0, 10)
    .map((h) => ({ page: h.page, rightPtAt387: +(h.rightFrac * 387).toFixed(2), rightLine: h.rightLine, leftPtAt387: +(h.leftFrac * 387).toFixed(2), leftLine: h.leftLine })),
};

// C. Clipping: ink inside each word's drawn Text (em units; scale-free).
const clipping = { wordsChecked: 0, horizontalOutside: [] as string[], vertical: {} as Record<string, { outside: number; examples: string[] }> };
for (const mode of ['normal', 'fullScreen'] as const) {
  for (const placement of ['web', 'native'] as const) {
    const key = `${mode}/${placement}`;
    clipping.vertical[key] = { outside: 0, examples: [] };
    const room = (QCF_V1_INK_ROOM_V_EM + (mode === 'normal' ? QCF_V1_NORMAL_BOX_MARGIN_EM : 0)) * UPM;
    for (const m of models) {
      const baselineFromTop = qcfV1IntendedBaselineUnits(m.page) + (placement === 'native' ? qcfV1DrawnLineShiftEm(m.page, 'ios') * UPM : 0);
      for (const [ln, words] of m.lines) for (const w of words) {
        if (!w.ink || w.kind === 'end') continue;
        const top = baselineFromTop - w.ink.yMax, bottom = baselineFromTop - w.ink.yMin; // units below the line box top
        if (top < -room || bottom > LINE_BOX + room) {
          clipping.vertical[key].outside++;
          if (clipping.vertical[key].examples.length < 10) clipping.vertical[key].examples.push(`page ${m.page} line ${ln} ${w.verseKey}#${w.position}`);
        }
      }
    }
  }
}
const overflow = QCF_V1_INK_OVERFLOW_EM * UPM;
for (const m of models) for (const [ln, words] of m.lines) for (const w of words) {
  if (w.kind === 'end') continue;
  clipping.wordsChecked++;
  if (w.ink && (w.ink.xMin < -overflow || w.ink.xMax > w.advance + overflow)) clipping.horizontalOutside.push(`page ${m.page} line ${ln} ${w.verseKey}#${w.position}`);
}

// D. Neighbouring lines.
function collisions(scale: number, tiles: number, pythonPitch = false) {
  const width = REF;
  const L = computePageLayout(width, tiles);
  // The layout at `scale`: the text area QURAN_TEXT_SCALE / scale narrower or wider (scale 1 = the printed layout).
  const textWidth = scale === QURAN_TEXT_SCALE ? L.text.width : (L.text.width / QURAN_TEXT_SCALE) * scale;
  // pythonPitch: audit_line_collisions.py's own model, whose text height subtracts the vertical inset twice (2.6 % tighter rows).
  const pitch = (pythonPitch ? L.text.height - 2 * width * PAGE_GEOMETRY.textInsetY : L.text.height) / 15;
  const printed = computePageLayout(width).linePitch;
  let candidates = 0;
  const hits: { page: number; line: number; sharedPx: number; sharedDevicePx3x: number }[] = [];
  const medallionHits: { page: number; line: number; verseKey: string; sharedPx: number }[] = [];
  const add = (m: PageModel) => {
    const size = isOpeningPage(m.page) ? pageWidthOfText(textWidth) * PRINTED_TEXT_WIDTH_SHARE * OPENING_PAGE_SIZE_PER_WIDTH : (textWidth * FIT) / (m.widest / UPM);
    const em = size / UPM;
    const rowPitch = isOpeningPage(m.page) ? Math.min(pitch, printed) : pitch;
    const step = size / RASTER_PX_PER_EM;
    const placed = new Map<number, { w: Word; left: number; baseline: number }[]>();
    for (const [ln, words] of m.lines) {
      const lefts = placeLine(m, words, textWidth, size);
      const baseline = (ln - 0.5) * rowPitch - (LINE_BOX / 2) * em + qcfV1IntendedBaselineUnits(m.page) * em;
      placed.set(ln, words.map((w, i) => ({ w, left: lefts[i], baseline })));
    }
    for (const [ln, upper] of placed) {
      const lower = placed.get(ln + 1);
      if (!lower) continue;
      for (const a of upper) for (const b of lower) {
        if (a.w.kind === 'end' || b.w.kind === 'end' || !a.w.ink || !b.w.ink) continue;
        const ax0 = a.left + a.w.ink.xMin * em, ax1 = a.left + a.w.ink.xMax * em, bx0 = b.left + b.w.ink.xMin * em, bx1 = b.left + b.w.ink.xMax * em;
        if (ax1 <= bx0 || bx1 <= ax0) continue;
        const aBottom = a.baseline - a.w.ink.yMin * em, bTop = b.baseline - b.w.ink.yMax * em;
        if (aBottom <= bTop) continue;
        candidates++;
        const shared = sharedPixels(wordShape(a.w, a.left, a.baseline, em), wordShape(b.w, b.left, b.baseline, em), [Math.max(ax0, bx0), Math.min(ax1, bx1), bTop, aBottom], step);
        if (shared > 0) hits.push({ page: m.page, line: ln, sharedPx: shared, sharedDevicePx3x: +(shared * (69 / RASTER_PX_PER_EM) ** 2).toFixed(2) });
      }
    }
    // Medallions (MARKER_SCALE of the ring, the ornament's own proportions) against the ink of the lines above/below.
    for (const [ln, row] of placed) for (const mk of row) {
      if (mk.w.kind !== 'end') continue;
      const marker = getAyahMarker(m.page, mk.w.verseKey);
      if (!marker) continue;
      const hgt = (marker.ink.yMax - marker.ink.yMin) * em * MARKER_SCALE;
      const wid = hgt * (marker.ornamentBox.width / marker.ornamentBox.height);
      const cx = mk.left + ((marker.ink.xMin + marker.ink.xMax) / 2) * em, cy = mk.baseline - ((marker.ink.yMax + marker.ink.yMin) / 2) * em;
      const box: Shape = { polys: [[[cx - wid / 2, cy - hgt / 2], [cx + wid / 2, cy - hgt / 2], [cx + wid / 2, cy + hgt / 2], [cx - wid / 2, cy + hgt / 2]]] };
      for (const other of [placed.get(ln - 1), placed.get(ln + 1)]) for (const o of other ?? []) {
        if (o.w.kind === 'end' || !o.w.ink) continue;
        const ox0 = o.left + o.w.ink.xMin * em, ox1 = o.left + o.w.ink.xMax * em, oy0 = o.baseline - o.w.ink.yMax * em, oy1 = o.baseline - o.w.ink.yMin * em;
        if (ox1 <= cx - wid / 2 || cx + wid / 2 <= ox0 || oy1 <= cy - hgt / 2 || cy + hgt / 2 <= oy0) continue;
        const shared = sharedPixels(box, wordShape(o.w, o.left, o.baseline, em), [Math.max(ox0, cx - wid / 2), Math.min(ox1, cx + wid / 2), Math.max(oy0, cy - hgt / 2), Math.min(oy1, cy + hgt / 2)], step);
        if (shared > 0) medallionHits.push({ page: m.page, line: ln, verseKey: mk.w.verseKey, sharedPx: shared });
      }
    }
  };
  return { add, result: () => ({ scale, tiles, pythonPitch, lineOpennessVsPrint: +((pitch / printed) / scale).toFixed(4), envelopeCandidates: candidates, outlineIntersections: hits.length, pages: [...new Set(hits.map((h) => h.page))], hits, medallionOverlaps: medallionHits.length, medallionExamples: medallionHits.slice(0, 20) }) };
}
const neighbours = neighbourRuns.map((r) => r.result());
const calibration = CALIBRATE ? calibrationRuns.map((r) => r.result()) : null;

// E. Vertical frame clearance.
type Edge = { top: number; bottom: number; topWhat?: string; bottomWhat?: string };
function rowExtents(m: PageModel, width: number, tiles: number, os: 'web' | 'ios' | 'android'): { first: Edge; last: Edge; firstRow: number; lastRow: number } {
  const L = computePageLayout(width, tiles);
  const textWidth = L.text.width, height = L.text.height;
  const size = fontSizeOf(m, textWidth), em = size / UPM;
  // The app's own lift (pageGeometry.ts mushafTextLift), unless --lift-em evaluates a proposal.
  const lift = LIFT_EM === null ? mushafTextLift(textWidth, os) : LIFT_EM * size;
  if (os !== 'web') { liftEmSeen.min = Math.min(liftEmSeen.min, lift / size); liftEmSeen.max = Math.max(liftEmSeen.max, lift / size); }
  const pitch = height / Math.max(15, m.lines.size);
  const opening = isOpeningPage(m.page);
  const printed = computePageLayout(width).linePitch;
  const rowPitch = opening ? Math.min(pitch, printed) : pitch;
  const used = [...m.lines.keys(), ...m.slots.map((s) => s.line)];
  const openingDrop = opening ? (qcfV1DrawnLineShiftEm(m.page, os) + qcfV1AndroidRowShiftEm(m.page, os)) * size : 0;
  const blockTop = opening ? (height - (Math.max(...used) - Math.min(...used) + 1) * rowPitch) / 2 - (Math.min(...used) - 1) * rowPitch + lift - openingDrop : 0;
  const rowTop = (line: number) => blockTop + (line - 1) * rowPitch;
  // Baseline of a Quran row (text-area coordinates): the line box centred in the row; iOS draws lower; Android moves the row.
  const quranBaseline = (line: number, fontPage: number) =>
    rowTop(line) + rowPitch / 2 - (LINE_BOX / 2) * em + qcfV1IntendedBaselineUnits(fontPage) * em + (qcfV1DrawnLineShiftEm(fontPage, os) + qcfV1AndroidRowShiftEm(fontPage, os)) * size;
  const ext = new Map<number, Edge>();
  const grow = (line: number, top: number, bottom: number, what = '') => {
    const e = ext.get(line) ?? { top: Infinity, bottom: -Infinity };
    ext.set(line, { top: Math.min(e.top, top), bottom: Math.max(e.bottom, bottom), topWhat: top < e.top ? what : e.topWhat, bottomWhat: bottom > e.bottom ? what : e.bottomWhat });
  };
  for (const [ln, words] of m.lines) {
    const base = quranBaseline(ln, m.page);
    for (const w of words) {
      if (w.kind === 'end') {
        const marker = getAyahMarker(m.page, w.verseKey);
        if (!marker) continue;
        // The medallion's baseline: web the intended one; iOS the reported one (up to IOS_MEDALLION_LIFT_UNITS above the
        // drawn glyphs); Android the moved row's intended one (= the drawn glyphs).
        const intended = rowTop(ln) + rowPitch / 2 - (LINE_BOX / 2) * em + qcfV1IntendedBaselineUnits(m.page) * em + qcfV1AndroidRowShiftEm(m.page, os) * size;
        const bases = os === 'ios' ? [base - IOS_MEDALLION_LIFT_UNITS * em, base - 399 * em] : [intended];
        for (const b of bases) {
          const half = ((marker.ink.yMax - marker.ink.yMin) * em * MARKER_SCALE) / 2, c = b - ((marker.ink.yMax + marker.ink.yMin) / 2) * em;
          grow(ln, c - half, c + half, `medallion ${w.verseKey}`);
        }
      } else if (w.ink) grow(ln, base - w.ink.yMax * em, base - w.ink.yMin * em, `word ${w.verseKey}#${w.position}`);
    }
  }
  for (const slot of m.slots) {
    if (slot.kind === 'basmala') {
      const base = quranBaseline(slot.line, 1);
      grow(slot.line, base - BAS.yMax * em, base - BAS.yMin * em, 'basmala');
    } else if (opening) {
      grow(slot.line, rowTop(slot.line) + rowPitch * 0.1, rowTop(slot.line) + rowPitch * 0.9); // compact cartouche, 0.8 of the row
    } else {
      const top = placeSurahHeading({ page: m.page, line: slot.line, os, fontSize: size, rowPitch, rowTop, textWidth, textHeight: height }).top;
      grow(slot.line, top, top + rowPitch, 'heading band'); // the band: the row's full height
    }
  }
  const rows = [...ext.keys()].sort((a, b) => a - b);
  const firstRow = rows[0], lastRow = rows[rows.length - 1];
  // Into frame coordinates: the text area drawn MUSHAF_TEXT_LIFT_PT higher; clearance to the inner rule's inner edge.
  const toTop = (y: number) => L.text.y - lift + y - L.inner.y;
  const toBottom = (y: number) => L.inner.y + L.inner.height - (L.text.y - lift + y);
  return { first: { top: toTop(ext.get(firstRow)!.top), bottom: 0, topWhat: ext.get(firstRow)!.topWhat }, last: { top: 0, bottom: toBottom(ext.get(lastRow)!.bottom), bottomWhat: ext.get(lastRow)!.bottomWhat }, firstRow, lastRow };
}
const liftEmSeen = { min: Infinity, max: -Infinity };
// Per-page clearances (pt) for the configurations most phones use: iPhone 15/16 and 16 Pro, Normal Mode (31 tiles).
const KEY_CONFIGS = [['ios', 387, 31], ['ios', 396, 31]] as const;
const keyPages: Record<string, Record<number, [top: number, bottom: number]>> = {};
const vertical: Record<string, unknown>[] = [];
const verticalTouching = new Set<number>();
for (const os of ['web', 'ios', 'android'] as const) {
  for (const width of WIDTHS) for (const tiles of TILES) {
    let minTop = Infinity, minTopPage = 0, minBottom = Infinity, minBottomPage = 0;
    const touching: { page: number; edge: string; pt: number; what?: string; row: number }[] = [];
    let minTopWhat: string | undefined, minBottomWhat: string | undefined;
    for (const m of models) {
      const e = rowExtents(m, width, tiles, os);
      if (KEY_CONFIGS.some(([o, w, t]) => o === os && w === width && t === tiles)) (keyPages[`${os} ${width}/${tiles}`] ??= {})[m.page] = [+e.first.top.toFixed(2), +e.last.bottom.toFixed(2)];
      if (e.first.top < minTop) { minTop = e.first.top; minTopPage = m.page; minTopWhat = e.first.topWhat; }
      if (e.last.bottom < minBottom) { minBottom = e.last.bottom; minBottomPage = m.page; minBottomWhat = e.last.bottomWhat; }
      if (e.first.top <= 0) touching.push({ page: m.page, edge: 'top', pt: +e.first.top.toFixed(2), what: e.first.topWhat, row: e.firstRow });
      if (e.last.bottom <= 0) touching.push({ page: m.page, edge: 'bottom', pt: +e.last.bottom.toFixed(2), what: e.last.bottomWhat, row: e.lastRow });
      if (e.first.top <= 0 || e.last.bottom <= 0) verticalTouching.add(m.page);
    }
    vertical.push({ os, width, tiles, minTopPt: +minTop.toFixed(2), minTopPage, minTopWhat, minBottomPt: +minBottom.toFixed(2), minBottomPage, minBottomWhat, pagesTouching: touching });
  }
}

const result = {
  generatedBy: 'tools/mushaf-audit/audit-current-layout.mts',
  layout: { liftEmOverride: LIFT_EM, NATIVE_TEXT_LIFT_EM, NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH, QURAN_TEXT_SCALE, MIN_TILES_DOWN, TALLER_MAX_TILES_DOWN, MUSHAF_TEXT_LIFT_PT, textInsetX: PAGE_GEOMETRY.textInsetX, FIT, rasterPxPerEm: RASTER_PX_PER_EM, widths: WIDTHS, tiles: TILES },
  structure: { ...structure, fontSha256: undefined, fontsHashOfHashes: createHash('sha256').update(Object.values(structure.fontSha256).join('\n')).digest('hex') },
  horizontal: horizontalSummary,
  clipping,
  neighbours,
  calibration,
  vertical: { liftAsShareOfLetterSize: { min: +liftEmSeen.min.toFixed(4), max: +liftEmSeen.max.toFixed(4), note: 'native placements; web uses MUSHAF_TEXT_LIFT_PT' }, keyPages, pagesTouchingAnywhere: [...verticalTouching].sort((a, b) => a - b), configs: vertical },
  perPage: models.map((m, i) => ({ page: m.page, rows: m.lines.size + m.slots.length, textLines: m.lines.size, slots: m.slots.map((s) => `${s.kind}@${s.line}`), rightPtAt387: +(horizontal[i].rightFrac * 387).toFixed(2), leftPtAt387: +(horizontal[i].leftFrac * 387).toFixed(2) })),
  fontSha256: structure.fontSha256,
  seconds: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ structure: result.structure, horizontal: { ...horizontalSummary, ptByWidth: undefined }, clipping: { ...clipping, horizontalOutside: clipping.horizontalOutside.length }, neighbours: neighbours.map((n) => ({ tiles: n.tiles, openness: n.lineOpennessVsPrint, candidates: n.envelopeCandidates, intersections: n.outlineIntersections, pages: n.pages, medallionOverlaps: n.medallionOverlaps })), calibration: calibration?.map((n) => ({ tiles: n.tiles, pythonPitch: n.pythonPitch, candidates: n.envelopeCandidates, intersections: n.outlineIntersections, pages: n.pages })), verticalTouching: result.vertical.pagesTouchingAnywhere, seconds: result.seconds }, null, 1));
