// How many Android headings leave their approved place (to keep 0.5 pt from the raised rows), and by how much.
const base = new URL('../../../mobile/', import.meta.url).href;
const { placeSurahHeading } = await import(base + 'src/mushaf/surahHeadingPlacement.ts');
const { surahHeadingShift } = await import(base + 'src/mushaf/ayahMarkers.ts');
const { computePageLayout, QURAN_TEXT_SCALE } = await import(base + 'src/mushaf/pageGeometry.ts');
const { readFileSync } = await import('node:fs');
const hs = JSON.parse(readFileSync(new URL(base + 'tests/fixtures/headingNeighbours.json'), 'utf8'));
let moved = 0, total = 0, maxPt = 0, maxEm = 0; const pages = new Set();
for (const w of [268, 360, 384, 393, 412, 434]) for (const tiles of [31, 33, 35]) {
  const L = computePageLayout(w, tiles), printed = computePageLayout(w).linePitch;
  for (const h of hs) {
    if (h.opening) continue;
    const fontSize = L.text.width * h.sizePerTextWidth, rowPitch = L.linePitch;
    const rowTop = (l: number) => (l - 1) * rowPitch;
    const p = placeSurahHeading({ page: h.page, line: h.line, os: 'android', fontSize, rowPitch, rowTop, textWidth: L.text.width, textHeight: L.text.height });
    const pref = rowTop(h.line) + surahHeadingShift(h.page, 'android', fontSize, rowPitch);
    total++; const d = pref - p.top;
    if (Math.abs(d) > 1e-6) { moved++; pages.add(h.page); maxPt = Math.max(maxPt, Math.abs(d)); maxEm = Math.max(maxEm, Math.abs(d) / fontSize); }
  }
}
console.log(`android headings moved from their place: ${moved}/${total} (pages ${[...pages].join(',')}), at most ${maxPt.toFixed(2)} pt = ${maxEm.toFixed(3)} em`);
