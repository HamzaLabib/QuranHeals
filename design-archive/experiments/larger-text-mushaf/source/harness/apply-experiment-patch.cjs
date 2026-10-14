// Larger-text Mushaf experiment: patches a SCRATCH COPY of the app (never the repository). Inert without ?exp_* URL
// parameters: with none, the copy renders exactly as production. Usage: node apply-experiment-patch.cjs <copy>/mobile
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
function edit(rel, pairs) {
  const p = path.join(root, rel);
  let s = fs.readFileSync(p, 'utf8'); const nl = s.includes('\r\n') ? '\r\n' : '\n'; s = s.replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) { const c = s.split(a).length - 1; if (c !== 1) throw new Error(`${rel} count ${c}: ${a.slice(0, 90)}`); s = s.replace(a, b); }
  fs.writeFileSync(p, s.replace(/\n/g, nl));
}
edit('src/mushaf/pageGeometry.ts', [
  [`export const BORDER_TILES_ACROSS = 20;\n`, `/**
 * EXPERIMENT (scratch copy only, design-archive/experiments/larger-text-mushaf): read once from the web URL.
 *   exp_inset=<fraction of the page width>  the plain margin between the inner rule and the text, each side
 *                                           (printed: 25/593 = 0.04216); smaller = wider text area = larger glyphs
 *   exp_tiles=max | <n>                     Normal Mode frame height in whole border tiles (printed: 29)
 *   exp_noband=1                            Normal Mode without the retired bar's reserved 64 pt
 * Without them every value is the production one.
 */
export const EXPERIMENT = (() => {
  try {
    const q = new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? '');
    const inset = Number(q.get('exp_inset'));
    const tiles = q.get('exp_tiles');
    return {
      textInsetX: q.has('exp_inset') && Number.isFinite(inset) && inset > 0 ? inset : null,
      tiles: tiles === 'max' ? ('max' as const) : tiles && Number.isInteger(Number(tiles)) ? Number(tiles) : null,
      noBand: q.get('exp_noband') === '1',
    };
  } catch {
    return { textInsetX: null, tiles: null, noBand: false };
  }
})();

export const BORDER_TILES_ACROSS = 20;\n`],
  [`  textInsetX: 25 / 593,\n`, `  textInsetX: EXPERIMENT.textInsetX ?? 25 / 593,\n`],
]);
edit('src/app/(tabs)/mushaf.tsx', [
  [`import { BORDER_TILES_DOWN, computePageLayout } from '@/mushaf/pageGeometry';`, `import { BORDER_TILES_DOWN, computePageLayout, EXPERIMENT } from '@/mushaf/pageGeometry';`],
  [`  const viewportHeight = Math.max(0, area.height - (fullScreen ? FULL_SCREEN_BOTTOM_GAP + bottomInset : PAGE_PANEL_GAP + MUSHAF_PANEL_HEIGHT + MUSHAF_PANEL_MARGIN + bottomInset));
  const available = viewportHeight - (fullScreen ? 0 : WIRD_ROW_HEIGHT);
  const width = Math.floor(Math.max(0, Math.min(area.width - SIDE_MARGIN * 2, available / PAGE_ASPECT)));
  // Taller: at that same width, the tallest whole-tile frame that still fits.
  let tilesDown = BORDER_TILES_DOWN;
  while (taller && width > 0 && tilesDown < TALLER_MAX_TILES_DOWN && pageHeightFor(width, tilesDown + 1) <= available) tilesDown += 1;`,
  `  const band = !fullScreen && EXPERIMENT.noBand ? 0 : MUSHAF_PANEL_HEIGHT + MUSHAF_PANEL_MARGIN;
  const viewportHeight = Math.max(0, area.height - (fullScreen ? FULL_SCREEN_BOTTOM_GAP + bottomInset : PAGE_PANEL_GAP + band + bottomInset));
  const available = viewportHeight - (fullScreen ? 0 : WIRD_ROW_HEIGHT);
  // EXPERIMENT: a fixed frame height in Normal Mode (the page narrows if it does not fit, never cropped).
  const fixedTiles = !fullScreen && typeof EXPERIMENT.tiles === 'number' ? EXPERIMENT.tiles : null;
  const aspect = fixedTiles ? pageHeightFor(1000, fixedTiles) / 1000 : PAGE_ASPECT;
  const width = Math.floor(Math.max(0, Math.min(area.width - SIDE_MARGIN * 2, available / aspect)));
  // Taller: at that same width, the tallest whole-tile frame that still fits.
  let tilesDown = fixedTiles ?? BORDER_TILES_DOWN;
  const growTaller = taller || (!fullScreen && EXPERIMENT.tiles === 'max');
  while (growTaller && width > 0 && tilesDown < TALLER_MAX_TILES_DOWN && pageHeightFor(width, tilesDown + 1) <= available) tilesDown += 1;`],
]);
console.log('patched', root);
