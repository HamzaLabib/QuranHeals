// Recomputes the Mushaf page geometry of revision 529a724 from the ARCHIVED source (not the live app), at real phone
// sizes, and writes baseline-geometry.json beside this file. Run from the repository root:
//   npx --prefix backend tsx design-archive/mushaf-page-layout-v1/geometry-and-calculations/compute-baseline.mts
// Inactive archive tooling: nothing in mobile/ imports it.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BORDER_TILES_ACROSS, BORDER_TILES_DOWN, computePageLayout, FRAME_ASPECT, MUSHAF_TEXT_LIFT_PT, PAGE_GEOMETRY,
} from '../original-source/mobile/src/mushaf/pageGeometry.ts';

// The reader's page fit (fitMushafPage in original-source/mobile/src/app/(tabs)/mushaf.tsx), with its constants as
// archived there, reproduced here for numbers only. Normal Mode: Back row 36, page, ورد row 32, gap 4, bar 56 + 8.
const SIDE_MARGIN = 3;
const BACK_BAR_HEIGHT = 36;
const PAGE_PANEL_GAP = 4;
const MUSHAF_PANEL_HEIGHT = 56;
const MUSHAF_PANEL_MARGIN = 8;
const WIRD_ROW_HEIGHT = 32;
const PAGE_ASPECT = computePageLayout(1000).page.height / 1000;
function fitNormal(area: { width: number; height: number }, bottomInset: number) {
  const viewportHeight = Math.max(0, area.height - (PAGE_PANEL_GAP + MUSHAF_PANEL_HEIGHT + MUSHAF_PANEL_MARGIN + bottomInset));
  const available = viewportHeight - WIRD_ROW_HEIGHT;
  const width = Math.floor(Math.max(0, Math.min(area.width - SIDE_MARGIN * 2, available / PAGE_ASPECT)));
  return { viewportHeight, available, width, height: (computePageLayout(1000).page.height / 1000) * width, limitedBy: area.width - SIDE_MARGIN * 2 <= available / PAGE_ASPECT ? 'width' : 'height' };
}

// Representative phones: screen points, top and bottom safe-area insets.
const DEVICES = [
  { name: 'iPhone SE (3rd gen)', width: 375, height: 667, top: 20, bottom: 0 },
  { name: 'iPhone 13 mini', width: 375, height: 812, top: 50, bottom: 34 },
  { name: 'iPhone 16 / 15 / 14', width: 390, height: 844, top: 47, bottom: 34 },
  { name: 'iPhone 16 Pro', width: 402, height: 874, top: 62, bottom: 34 },
  { name: 'iPhone 16 Pro Max', width: 440, height: 956, top: 62, bottom: 34 },
  { name: 'Android small (360 × 640)', width: 360, height: 640, top: 24, bottom: 48 },
  { name: 'Android Pixel-size (412 × 915)', width: 412, height: 915, top: 24, bottom: 24 },
  { name: 'Android narrow (320 × 640)', width: 320, height: 640, top: 24, bottom: 48 },
];

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundAll = (value: unknown): unknown => (typeof value === 'number' ? round(value) : Array.isArray(value) ? value.map(roundAll) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundAll(v)])) : value);

const baseline = {
  revision: '529a7241d9d79717df9ead4ac85e814be00cb3b1',
  source: 'original-source/mobile/src/mushaf/pageGeometry.ts (archived copy)',
  constants: { BORDER_TILES_ACROSS, BORDER_TILES_DOWN, FRAME_ASPECT, MUSHAF_TEXT_LIFT_PT, PAGE_GEOMETRY, PAGE_ASPECT, readerFit: { SIDE_MARGIN, BACK_BAR_HEIGHT, PAGE_PANEL_GAP, MUSHAF_PANEL_HEIGHT, MUSHAF_PANEL_MARGIN, WIRD_ROW_HEIGHT } },
  layoutAtWidth: Object.fromEntries([300, 320, 354, 369, 384, 396, 406, 434].map((w) => [w, computePageLayout(w)])),
  tallerFrames: Object.fromEntries([29, 31, 33, 35].map((t) => [t, computePageLayout(384, t)])),
  normalModeFit: DEVICES.map((d) => {
    const area = { width: d.width, height: d.height - d.top - BACK_BAR_HEIGHT };
    const fit = fitNormal(area, d.bottom);
    const layout = computePageLayout(fit.width);
    return {
      device: d.name, screen: `${d.width} × ${d.height}`, area, ...fit,
      frame: layout.frame, text: layout.text, pageNumber: layout.pageNumber, linePitch: layout.linePitch,
      // Space below the page number's box to the bottom of the page box, and the frame's bottom to the number's top.
      frameBottomToPageNumberTop: layout.pageNumber.y - (layout.frame.y + layout.frame.height),
      textBottomToFrameBottom: layout.frame.y + layout.frame.height - (layout.text.y + layout.text.height),
    };
  }),
};
const out = join(dirname(fileURLToPath(import.meta.url)), 'baseline-geometry.json');
writeFileSync(out, `${JSON.stringify(roundAll(baseline), null, 2)}\n`);
console.log(`wrote ${out}`);
