// Every word's advance on every page, for mobile/tests/mushafSelectionAudit.test.ts: the Node equivalent of
// export_word_advances.py (same arguments, same output), for machines without Python and fontTools. It reads the
// font's best Unicode cmap (fontTools' getBestCmap order) and hmtx advances, in font units (2048 per em).
//
//   node tools/mushaf-audit/export-word-advances.mjs <fonts dir> <records-*.json.gz> <out.json> [--pages 1,2,5]
//
// Checked byte for byte against the Python tool's committed output (2026-10-14):
//   node tools/mushaf-audit/export-word-advances.mjs <fonts> <records> <out> --pages 1,2,5,50,61,237,466
//   must equal mobile/tests/fixtures/qpcV1WordAdvances.json exactly (see README).
// The full output holds no glyph codes but is large: keep it outside the repository and pass it as QPC_V1_ADVANCES.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [FONTS, RECORDS, OUT] = process.argv.slice(2);
const COUNTS = new URL('../quran-verification/surah-counts.json', import.meta.url);
const pagesArg = process.argv.indexOf('--pages');
const ONLY = pagesArg > 0 ? process.argv[pagesArg + 1].split(',').map(Number) : Array.from({ length: 604 }, (_, i) => i + 1);

function parseFont(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = {};
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])] = dv.getUint32(o + 8);
  }
  // cmap: fontTools getBestCmap order — (3,10), (0,6), (0,4), (3,1), (0,3), (0,2), (0,1), (0,0).
  const cmapAt = tables.cmap;
  const subtables = [];
  for (let i = 0; i < dv.getUint16(cmapAt + 2); i++) {
    const o = cmapAt + 4 + i * 8;
    subtables.push({ platform: dv.getUint16(o), encoding: dv.getUint16(o + 2), offset: cmapAt + dv.getUint32(o + 4) });
  }
  const order = [[3, 10], [0, 6], [0, 4], [3, 1], [0, 3], [0, 2], [0, 1], [0, 0]];
  const best = order.map(([p, e]) => subtables.find((s) => s.platform === p && s.encoding === e)).find(Boolean);
  if (!best) throw new Error('no usable cmap');
  const map = new Map();
  const format = dv.getUint16(best.offset);
  if (format === 4) {
    const segX2 = dv.getUint16(best.offset + 6);
    const ends = best.offset + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2), delta = dv.getInt16(deltas + s * 2), rangeAt = ranges + s * 2, range = dv.getUint16(rangeAt);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g;
        if (range === 0) g = (c + delta) & 0xffff;
        else {
          g = dv.getUint16(rangeAt + range + (c - start) * 2);
          if (g !== 0) g = (g + delta) & 0xffff;
        }
        if (g !== 0) map.set(c, g);
      }
    }
  } else if (format === 12) {
    const groups = dv.getUint32(best.offset + 12);
    for (let i = 0; i < groups; i++) {
      const o = best.offset + 16 + i * 12;
      const start = dv.getUint32(o), end = dv.getUint32(o + 4), gid = dv.getUint32(o + 8);
      for (let c = start; c <= end; c++) map.set(c, gid + (c - start));
    }
  } else throw new Error(`cmap format ${format}`);
  const numH = dv.getUint16(tables.hhea + 34);
  const advance = (g) => dv.getUint16(tables.hmtx + Math.min(g, numH - 1) * 4);
  return { map, advance };
}

const counts = JSON.parse(readFileSync(COUNTS, 'utf8')).counts;
const keys = counts.flatMap((n, s) => Array.from({ length: n }, (_, a) => `${s + 1}:${a + 1}`));
const recs = JSON.parse(gunzipSync(readFileSync(RECORDS)).toString('utf8')).filter((r) => r.record_type === 'mushaf_word' && r.mushaf_id === 2);
const byPage = new Map();
for (const r of recs) byPage.set(r.page_number, [...(byPage.get(r.page_number) ?? []), r]);
const out = {};
for (const page of ONLY) {
  const font = parseFont(readFileSync(`${FONTS}/p${page}.ttf`));
  const lines = new Map();
  for (const r of [...byPage.get(page)].sort((a, b) => a.position_in_page - b.position_in_page)) {
    let adv = 0;
    for (const ch of r.text) {
      const g = font.map.get(ch.codePointAt(0));
      if (g === undefined) throw new Error(`page ${page}: no glyph for U+${ch.codePointAt(0).toString(16)}`); // Python would raise KeyError too
      adv += font.advance(g);
    }
    if (!lines.has(r.line_number)) lines.set(r.line_number, []);
    lines.get(r.line_number).push([keys[r.verse_id - 1], r.position_in_verse, r.char_type_name === 'end' ? 'end' : 'word', adv]);
  }
  out[page] = [...lines.entries()].sort((a, b) => a[0] - b[0]);
}
writeFileSync(OUT, JSON.stringify(out));
console.log('pages', Object.keys(out).length);
