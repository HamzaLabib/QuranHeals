// Measures each light-mode capture's actual ink against the frame's inner rule (pixels of the real screenshots), with
// the DOM geometry recorded at capture time. Writes calculations/measurements.json and measurements.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { driver, launch } from './cdp.mjs';

const OUT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const S = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const raw = JSON.parse(readFileSync(`${OUT}/calculations/captures-raw.json`, 'utf8'));
const SCALE = { 'small-iphone-se': 2, 'standard-iphone-14': 3, 'large-iphone-16-pro-max': 3, 'android-pixel': 2.625 };
const FURNITURE = (18 / 593) * 1.6 + 20.6 / 593 + 16 / 593 + (18 / 593) * 1.6; // heads + gap above, gap + page number below
const TILE = 0.05, INSET_Y = 10 / 593, INSET_X = 25 / 593;

const browser = await launch({ port: 9341, profile: `${S}chrome-analyze` });
const d = driver(browser);
const out = [];
try {
  await d.viewport({ width: 800, height: 600, scale: 1 });
  await d.goto('about:blank');
  for (const r of raw.results.filter((x) => !x.dark)) {
    const m = r.measure;
    const W = m.page.width;
    const tiles = Math.round((m.page.height / W - FURNITURE) * 20);
    const insetX = r.params.includes('exp_inset=') ? Number(/exp_inset=([0-9.]+)/.exec(r.params)[1]) : INSET_X;
    const headerH = W * (18 / 593) * 1.6;
    const frameY = m.page.y + headerH + W * (20.6 / 593);
    const inner = { left: m.page.x + TILE * W, right: m.page.x + W - TILE * W, top: frameY + TILE * W, bottom: frameY + (W * tiles) / 20 - TILE * W };
    const excluded = [...m.rows.flatMap((row) => row.markers), ...m.headings.map((h) => h.ornament ?? h.rect)];
    const sc = SCALE[r.viewportId];
    const png = `data:image/png;base64,${readFileSync(`${OUT}/screenshots/${r.file}`).toString('base64')}`;
    const ink = await d.evaluate(`(async () => {
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = ${JSON.stringify(png)}; });
      const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const s = ${sc};
      const inner = ${JSON.stringify(inner)};
      const ex = ${JSON.stringify(excluded)};
      const L = Math.ceil(inner.left * s) + 2, R = Math.floor(inner.right * s) - 2, T = Math.ceil(inner.top * s) + 2, B = Math.floor(inner.bottom * s) - 2;
      const data = x.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
      const inEx = (px, py) => ex.some((e) => px >= e.x * s - 1 && px <= (e.x + e.width) * s + 1 && py >= e.y * s - 1 && py <= (e.y + e.height) * s + 1);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
      for (let py = T; py <= B; py++) for (let px = L; px <= R; px++) {
        const k = (py * img.naturalWidth + px) * 4; const r = data[k], g = data[k + 1], b = data[k + 2];
        // Quran ink: dark and neutral (the paper is cream; medallions and heading bands are excluded by box).
        if (0.299 * r + 0.587 * g + 0.114 * b < 110 && Math.max(r, g, b) - Math.min(r, g, b) < 60 && !inEx(px, py)) {
          count++; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
      }
      return { count, minX: minX / s, maxX: maxX / s, minY: minY / s, maxY: maxY / s };
    })()`);
    const markers = m.rows.flatMap((row) => row.markers);
    const fontSize = m.rows[0].fontSizes[0];
    const textW = m.text.width;
    const pitch = m.text.height / 15;
    const headingGaps = m.headings.map((h) => {
      const o = h.ornament ?? h.rect;
      return { id: h.id, ornament: o, clearToInnerLeft: +(o.x - inner.left).toFixed(2), clearToInnerRight: +(inner.right - (o.x + o.width)).toFixed(2) };
    });
    out.push({
      file: r.file, page: r.page, viewport: r.viewport, viewportId: r.viewportId, candidate: r.candidate, kTarget: r.kTarget,
      pageWidth: W, pageHeight: m.page.height, frameTiles: tiles, frameWidth: W, frameHeight: +((W * tiles) / 20).toFixed(2),
      innerWidth: +(inner.right - inner.left).toFixed(2), innerHeight: +(inner.bottom - inner.top).toFixed(2),
      textAreaWidth: textW, textAreaHeight: m.text.height, sideMarginPt: +(insetX * W).toFixed(2), topBottomMarginPt: +(INSET_Y * W).toFixed(2),
      fontSize, linePitch: +pitch.toFixed(3), pitchPerEm: +(pitch / fontSize).toFixed(4),
      quranLines: m.rows.length, linesMatchDataset: r.linesMatch, headings: m.headings.length, medallions: markers.length,
      inkPixels: ink.count,
      inkWidth: +(ink.maxX - ink.minX).toFixed(2),
      inkClearLeft: +(ink.minX - inner.left).toFixed(2), inkClearRight: +(inner.right - ink.maxX).toFixed(2),
      inkClearTop: +(ink.minY - inner.top).toFixed(2), inkClearBottom: +(inner.bottom - ink.maxY).toFixed(2),
      medallionClearLeft: markers.length ? +(Math.min(...markers.map((b) => b.x)) - inner.left).toFixed(2) : null,
      medallionClearRight: markers.length ? +(inner.right - Math.max(...markers.map((b) => b.x + b.width))).toFixed(2) : null,
      headingGaps,
      pageNumberBelowFrame: m.pageNumber ? +(m.pageNumber.y - (frameY + (W * tiles) / 20)).toFixed(2) : null,
      pillTop: m.pill?.y ?? null, pillBottomToViewport: m.pill ? +(m.viewport.height - (m.pill.y + m.pill.height)).toFixed(2) : null,
      viewportHeight: m.viewport.height,
    });
    console.log(r.file, 'ink L/R/T/B', out.at(-1).inkClearLeft, out.at(-1).inkClearRight, out.at(-1).inkClearTop, out.at(-1).inkClearBottom);
  }
} finally {
  writeFileSync(`${OUT}/calculations/measurements.json`, `${JSON.stringify(out, null, 1)}\n`);
  browser.close();
}
