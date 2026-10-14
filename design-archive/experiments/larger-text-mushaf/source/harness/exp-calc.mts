// Larger-text experiment: feasibility per phone, from the repository's own geometry (pageGeometry.ts copy) and the
// reader's fit constants (mushaf.tsx). Glyph size ∝ text-area width (QpcV1PageText: widest line fills the width).
import { writeFileSync } from 'node:fs';
import { computePageLayout, PAGE_GEOMETRY as G } from '../../../../../mobile/src/mushaf/pageGeometry.ts';

const SIDE = 3, BACK = 36, GAP = 4, BAND = 64, WIRD = 32, FS_GAP = 4;
const TALLER_MAX_PITCH = 1.25;
const base = computePageLayout(1000);
const ASPECT = base.page.height / 1000;
const TEXT_W = base.text.width / 1000; // 0.81568 of the page width
const PITCH = base.linePitch / 1000; // printed pitch per unit width
const INSET_Y = G.textInsetY; // top/bottom plain margin inside the inner rule, per unit width
const furniture = (base.page.height - base.frame.height) / 1000; // heads above + page number below

/** Page height per unit width with a `tiles`-tall frame. */
const pageAspect = (tiles: number) => furniture + tiles / 20;
/** Line pitch per unit width with a `tiles`-tall frame (text inset Y unchanged). */
const pitchFor = (tiles: number) => (tiles / 20 - 2 * G.tile - 2 * INSET_Y) / 15;
/** Smallest whole-tile frame whose line pitch keeps the printed pitch ÷ glyph size at glyph scale k. */
const tilesNeeded = (k: number) => { let t = 29; while (pitchFor(t) < k * PITCH - 1e-9) t++; return t; };
/** The plain side margin (per unit width) that makes the text area k × the original. */
const insetFor = (k: number) => (1 - 2 * G.tile - k * TEXT_W) / 2;

const phones = [
  { name: 'iPhone SE 375×667', w: 375, h: 667, top: 20, bottom: 0 },
  { name: 'iPhone 13 mini 375×812', w: 375, h: 812, top: 50, bottom: 34 },
  { name: 'iPhone 14/16e 390×844', w: 390, h: 844, top: 47, bottom: 34 },
  { name: 'iPhone 15/16 393×852', w: 393, h: 852, top: 59, bottom: 34 },
  { name: 'iPhone 16 Pro 402×874', w: 402, h: 874, top: 62, bottom: 34 },
  { name: 'iPhone 15/16 Plus 430×932', w: 430, h: 932, top: 59, bottom: 34 },
  { name: 'iPhone 16 Pro Max 440×956', w: 440, h: 956, top: 62, bottom: 34 },
  { name: 'Android 360×800 (gesture)', w: 360, h: 800, top: 24, bottom: 24 },
  { name: 'Android Pixel 412×915 (gesture)', w: 412, h: 915, top: 24, bottom: 24 },
  { name: 'Android 360×640 (3-button)', w: 360, h: 640, top: 24, bottom: 48 },
  // The Expo web captures: no status bar or safe areas.
  { name: 'WEB 375×667', w: 375, h: 667, top: 0, bottom: 0 },
  { name: 'WEB 390×844', w: 390, h: 844, top: 0, bottom: 0 },
  { name: 'WEB 440×956', w: 440, h: 956, top: 0, bottom: 0 },
  { name: 'WEB 412×915', w: 412, h: 915, top: 0, bottom: 0 },
];
const KS = [1.03, 1.05, 1.08];
const modes = {
  normalWithBand: (p: typeof phones[number]) => p.h - p.top - BACK - (GAP + BAND + p.bottom) - WIRD,
  normalNoBand: (p: typeof phones[number]) => p.h - p.top - BACK - (GAP + p.bottom) - WIRD,
  fullScreen: (p: typeof phones[number]) => p.h - p.top - BACK - (FS_GAP + p.bottom),
};

const rows = [];
for (const p of phones) {
  const W = Math.floor(Math.min(p.w - 2 * SIDE, modes.normalWithBand(p) / ASPECT)); // today's normal-mode width
  const row: Record<string, unknown> = { phone: p.name, pageWidth: W, textWidth: +(TEXT_W * W).toFixed(1), sideMarginNow: +(G.textInsetX * W).toFixed(1) };
  for (const [mode, avail] of Object.entries(modes)) {
    const a = avail(p);
    // Tallest whole-tile frame at this width (never wider than today's page; no shrinking for height).
    let t = 29; while (pageAspect(t + 1) * W <= a && pitchFor(t + 1) / PITCH <= TALLER_MAX_PITCH) t++;
    const fits29 = pageAspect(29) * W <= a + 1e-9;
    // Vertical limit: largest k whose needed frame fits.
    const kV = fits29 ? (pitchFor(t) / PITCH) : 0;
    row[`${mode}.maxTiles`] = fits29 ? t : '<29';
    row[`${mode}.kVertical`] = +kV.toFixed(3);
    for (const k of KS) row[`${mode}.k${k}`] = fits29 && tilesNeeded(k) <= t ? `ok (${tilesNeeded(k)} tiles)` : `no (needs ${tilesNeeded(k)}, max ${fits29 ? t : '<29'})`;
  }
  // Horizontal: side margin left at k (pt), and the k at which the side margin equals the top/bottom margin (balanced).
  for (const k of KS) row[`sideMargin.k${k}`] = +(insetFor(k) * W).toFixed(2);
  row.kBalanced = +((1 - 2 * G.tile - 2 * INSET_Y) / TEXT_W).toFixed(4);
  rows.push(row);
}
const summary = {
  geometry: { pageAspect29: ASPECT, textWidthPerWidth: TEXT_W, sideMarginPerWidth: G.textInsetX, topBottomMarginPerWidth: INSET_Y, tilePerWidth: G.tile, printedPitchPerWidth: PITCH },
  tilesNeeded: Object.fromEntries(KS.map((k) => [k, tilesNeeded(k)])),
  insetPerWidth: Object.fromEntries(KS.map((k) => [k, insetFor(k)])),
  rows,
};
writeFileSync(process.argv[2] ?? 'exp-calc.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary.geometry), JSON.stringify(summary.tilesNeeded), JSON.stringify(summary.insetPerWidth));
console.table(rows.map((r) => ({ phone: r.phone, W: r.pageWidth, band: r['normalWithBand.maxTiles'], kVband: r['normalWithBand.kVertical'], noBand: r['normalNoBand.maxTiles'], kVnoBand: r['normalNoBand.kVertical'], fs: r['fullScreen.maxTiles'], kVfs: r['fullScreen.kVertical'], m3: r['sideMargin.k1.03'], m5: r['sideMargin.k1.05'], m8: r['sideMargin.k1.08'] })));
