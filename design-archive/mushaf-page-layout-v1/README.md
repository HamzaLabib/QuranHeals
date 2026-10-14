# Mushaf page layout v1 (geometry before the 2026-10-14 redesign)

The printed-page geometry, frame, scaling, text placement and hit-testing of the QPC V1 (1405 AH) Mushaf, from
revision `529a724`. The authoritative description of how these were measured and audited is `references/docs/mushaf.md`.

## The model (`pageGeometry.ts`)

All proportions come from the reference scan of page 61 (707 × 1024 px), reduced to fractions of the page width so
every size scales together:

- **Frame:** a tiled border, `BORDER_TILES_ACROSS` 20 × `BORDER_TILES_DOWN` 29 (`FRAME_ASPECT` = 29/20); tile = frame
  width ÷ 20. Full screen (Taller) adds whole tiles down (up to `TALLER_MAX_TILES_DOWN`, line spacing ≤ 1.25 × printed).
- **Header row** (Surah left, juz' right, Hizb label centred when one starts) **above** the frame; its sides inset by
  one tile (`headerSideInset`).
- **Text area** inside the frame (`textSideInset`, `textVerticalInset`), 15 rows; `linePitch` = text height ÷ 15.
  The Quran text is drawn `MUSHAF_TEXT_LIFT_PT` (4 pt) above the printed text area (a uniform, documented adjustment).
- **Page number below the frame, outside it** (`layout.pageNumber.y` > frame bottom).
- `computePageLayout(width, tilesDown)` returns every box; `fitInside` keeps aspect.

QPC V1 text (`QpcV1PageText.tsx`): each line is measured once at a reference size, the font size is set so the widest
line fills the text width × `FIT` 0.985; glyph boxes carry ink room (`QCF_V1_INK_OVERFLOW_EM`, `QCF_V1_INK_ROOM_V_EM`,
Normal Mode `boxMarginEm`) so no mark is clipped; iOS/Android baseline corrections (`qcfV1DrawnLineShiftEm`,
`qcfV1AndroidRowShiftEm`); pages 1–2 centred in their ornament with their own size (`OPENING_PAGE_SIZE_PER_WIDTH`).
Taps: `lineAtY` (nearest drawn line) then `ayahAtLineX` (word boxes; gaps go to the nearer word) in `qpcV1Layout.ts`.

## Numbers

[`geometry-and-calculations/baseline-geometry.json`](geometry-and-calculations/baseline-geometry.json) holds every
constant and `computePageLayout` box at page widths 300–434 pt, the Taller frames, and the Normal Mode fit on eight
representative phones (iPhone SE to 16 Pro Max, small/Pixel-size/narrow Android). It is computed from the **archived**
`pageGeometry.ts`, not the live app:

```sh
npx --prefix backend tsx design-archive/mushaf-page-layout-v1/geometry-and-calculations/compute-baseline.mts
```

Facts it records (2026-10-14): on the iPhone SE, iPhone 13 mini and small Androids the page is **height-limited**
(the bar's reserved space decides its size); on 390 pt and wider iPhones and Pixel-size Android, **width-limited**.
Frame bottom to page-number top: 7.2 pt (268-pt page) to 11.7 pt (434-pt page). Text area bottom to frame bottom:
17.9 to 29.0 pt.

## Files

`original-source/`: `mobile/src/mushaf/pageGeometry.ts`, `components/MushafPageView.tsx`, `QpcV1PageText.tsx`,
`MushafSvgText.tsx`, `MushafBorder.tsx`, `AyahMarkerOrnament.tsx`, `mushaf/borderPattern.ts`, `ayahMarkers.ts`,
`qpcV1Layout.ts`, `qpcV1Selection.ts`, `qpcV1Fonts.ts`, `headerFonts.ts`, `pressLocation.ts`, `appearance.ts`,
`mushafPage.ts` (juz' table, Arabic-Indic digits), `hizbQuarters.ts`, `surahOpenings.ts`, `generated/hizbQuarters.ts`,
`generated/surahStartPages.ts`. The reader's page fit is in `../mushaf-navigation-v1/original-source/mobile/src/app/(tabs)/mushaf.tsx`.

`tests/`: `mushafGeometry`, `mushafBorder`, `mushafAppearance`, `mushafAllPages` (604 pages), `qpcV1Android`,
`qpcV1GlyphBounds`, `qpcV1VerticalPosition`, `mushafSelectionAudit`, `androidRenderingAudit`, `hizbQuarters`.

`references/`: `docs/mushaf.md`, `tools/mushaf-audit/README.md`, `tools/mushaf-audit/vertical-position.report.json`.

## Restore

Copy `original-source/` back to the same paths (or `git checkout 529a724 -- <path>`); then run the archived tests and,
with the local snapshot, the six 604-page tests (`tools/mushaf-audit/README.md`).
