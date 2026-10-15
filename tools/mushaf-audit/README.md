# QPC V1 glyph audits (all 604 pages)

These scripts check the Mushaf renderer's text geometry against the real fonts and layout. Re-run them after any change to how `QpcV1PageText` sizes, places or boxes glyphs.

Inputs (neither is in the repository):
- **The 604 QCF V1 page fonts**, from Quran Foundation's public CDN. `fetch-qcf-fonts.mjs` downloads them outside the repo (the system temp folder by default).
- **The Content Sync layout snapshot** (`backend/data/mushaf-sync/records-*.json.gz`, gitignored), from a local backend sync.

Requirements: Python 3 with `fontTools`, plus Pillow for the outline check.

```sh
node tools/mushaf-audit/fetch-qcf-fonts.mjs /tmp/qcf
python tools/mushaf-audit/audit_glyph_bounds.py /tmp/qcf backend/data/mushaf-sync/records-<seq>.json.gz /tmp/glyph-bounds.json
python tools/mushaf-audit/audit_line_collisions.py /tmp/qcf backend/data/mushaf-sync/records-<seq>.json.gz /tmp/collisions.json
```

## Horizontal ink and the per-word record (2026-10-12)

```sh
python tools/mushaf-audit/audit_ink_overflow.py /tmp/qcf backend/data/mushaf-sync/records-<seq>.json.gz /tmp/ink.json --write-marker-ink
python tools/mushaf-audit/verify_words.py /tmp/qcf backend/data/mushaf-sync/records-<seq>.json.gz /tmp/word-audit
```

- **`audit_ink_overflow.py`:** each word's real ink (contours that enclose area) against its advance, the first and last word of each line against the frame, and every glyph code against its own page font. With `--write-marker-ink` it regenerates `mobile/src/mushaf/generated/ayahMarkerInk.ts` (each ayah marker's ring, which sizes and centres its medallion).
- **`verify_words.py`:** one record per word occurrence (`words.jsonl.gz`), a per-page table (`pages.csv`) and `summary.json`. Each record has page, line, ayah, position, glyph codes, font (family and SHA-256), the Tanzil word it stands for, and PASS / FAIL / REVIEW / UNVERIFIED for text, glyph, spelling, fragment, render, separator and native. Its docstring explains each check. The output holds glyph codes (Quran Foundation content), so keep it outside the repository.

Results, 2026-10-12 (604 fonts, Content Sync snapshot 547614):
- **Cause of the iPhone defects:** each word is a native Text exactly as wide as its glyph's advance, and iOS and Android draw a Text only inside its frame. 54,025 of 83,665 words have ink outside their advance: the dots and tooth of an initial ت (39:57 تَقُولَ on page 465 read as نقول), the kasra and hamza under إ, dots under an initial ب or ي, the hamzat al-wasl, and every waqf sign. At 62 px per em, 45,664 words lost pixels; 15,116 of them below the baseline. Vertically, ink comes within 1 font unit of the line box on pages 322, 323 and 466 (5 words at risk of losing a pixel row to pixel snapping).
- **Fix:** each drawn glyph's Text extends 2.4 em left and right and 0.5 em above and below with a cancelling negative margin, so nothing moves (`QCF_V1_INK_OVERFLOW_EM`, `QCF_V1_INK_ROOM_V_EM`). Now 0 of 83,665 words lose a pixel, even with the frame shrunk 1.5 device pixels for snapping.
- **Record:**
  - text PASS 83,665;
  - glyph PASS 83,665, with no code missing from its page font, so no fallback;
  - render PASS 83,665;
  - separator PASS 6,236;
  - fragment REVIEW 87 (tiny contours stored about 2 em from their word in the fonts; drawn as the font defines them);
  - spelling UNVERIFIED and native UNVERIFIED for every word (see below).
- **Line edges:** on 3 lines (pages 18, 105, 540), edge ink reaches up to 0.7 % of the page width into the inner frame's inset.
- **Not verified by any tool here:**
  - That each glyph's outline spells its Tanzil word letter by letter. There is no machine-readable correspondence, and no complete authentic image of the 1405 AH print was available to compare against.
  - The quran-svg KFGQPC pages are a later printing: 56 ayah endings on 25 pages fall one page apart.
  - Native rendering on a device.

## Vertical room per line, Normal Mode (2026-10-12)

```sh
python tools/mushaf-audit/audit_vertical_boxes.py /tmp/qcf backend/data/mushaf-sync/records-<seq>.json.gz /tmp/vertical.json
```

For every line of every page, it measures the deepest and highest real ink against the glyph Text box. The slack is converted to device pixels at Normal-Mode letter sizes on an iPhone SE (2×), a 393-pt iPhone and a 440-pt Pro Max (3×). Pages 1 and 565 (USE_TYPO_METRICS) are also checked with their glyphs set 306.5 units lower. PASS needs at least 1.5 device pixels at the top and the bottom.

| Box | iPhone SE | iPhone 393 | Pro Max 440 |
|---|---|---|---|
| Font's line (1.914 em; Normal until 2026-10-12, Full-Screen still) | 14 lines on 13 pages under 1.5 px (min 0.02 px) | 7 lines on pages 1, 13, 322, 323, 324, 466 (min 0.03 px) | 7 lines (min 0.04 px) |
| Normal container (+0.25 em above and below, `QCF_V1_NORMAL_BOX_MARGIN_EM`) | 0 (min 8.6 px) | 0 (min 15.9 px) | 0 (min 17.8 px) |

The tightest are page 466 line 7 (the tail of م in 39:71, 1 font unit above the box's bottom) and page 322 line 15 (the top of a صلى sign, 1 unit under its top). Full-Screen keeps the font's line, with the 0.5 em painting room (`QCF_V1_INK_ROOM_V_EM`) added on 2026-10-12.

## Vertical position of the text (2026-10-12)

- **`audit_vertical_position.py`** (`<fonts dir> <records-*.json.gz> <report.json> [--lift PT] [--device-baseline UNITS]`): with the app's `MUSHAF_TEXT_LIFT_PT`, the outermost ink of every page against the frame's inner edges. It covers every page width the app shows, Normal and every Full-Screen frame, at the intended glyph placement and the iPhone's measured one (3311 units below the line box top), plus every word and Basmala glyph's ink against its paintable box. Its report, `vertical-position.report.json`, holds no glyph codes. It describes the printed 29-tile layout before the larger text and the 2026-10-15 proportional lift, and is kept as evidence only; `mobile/tests/qpcV1VerticalPosition.test.ts` now checks `audit-current-layout.mts`'s results instead. Results: `docs/mushaf.md`.

## Ayah selection (2026-10-12)

- **`generate_selection_ink.py`** (`<fonts dir> <records-*.json.gz>`): writes `mobile/src/mushaf/generated/qpcV1SelectionInk.ts`, the ink past the advance of the words where a selection can end.
- **`export_word_advances.py`** (`<fonts dir> <records> <out.json> [--pages …]`): every word's advance, for `mobile/tests/mushafSelectionAudit.test.ts`. Keep the full export outside the repo; run the audit with `QPC_V1_ADVANCES=<path>`. With `--pages` it wrote the committed fixture `mobile/tests/fixtures/qpcV1WordAdvances.json`.
- **`export-word-advances.mjs`** (same arguments and output): the Node equivalent, for machines without Python. Checked on 2026-10-14: with `--pages 1,2,5,50,61,237,466` its output equals the committed fixture byte for byte (page 237 included, the font with different metrics), and two full runs give the same file.

## Current layout, in Node (2026-10-15)

The Python audits above model the PRINTED geometry (29 tiles, the printed side margin). Since the larger text (`QURAN_TEXT_SCALE` 1.05, `MIN_TILES_DOWN` 31) their frame and spacing results no longer describe the app. **`audit-current-layout.mts`** imports the app's own geometry and placement code (`pageGeometry.ts`, `ayahMarkers.ts`, `surahHeadingPlacement.ts`, `surahOpenings.ts`), so it always measures what ships, and reads every glyph's real outlines (contours that enclose area) from the 604 fonts. No Python needed.

```sh
NODE_OPTIONS=--max-old-space-size=6144 npx tsx tools/mushaf-audit/audit-current-layout.mts /tmp/qcf backend/data/mushaf-sync/records-<seq>.json.gz <out.json> --calibrate [--lift-em X]
```

- **Checks:** structure (15 rows, glyph coverage, 6,236 ayah ends, order); horizontal ink against the inner rule (stray "speck" contours reported apart); clipping against each word's drawn Text; neighbouring-line outline intersections and medallion overlaps at 31–35 tiles; vertical ink of the first and last rows (letters, medallions, Basmala, heading band) against the inner rule on web, iOS and Android placements, for 17 page widths × 31–35 tiles.
- **Calibration:** `--calibrate` also runs the neighbouring-line check on the printed layout. With `audit_line_collisions.py`'s own row pitch (its text height subtracts the vertical inset twice) it finds the published intersections on pages 98, 213 and 341, in the same order of size, plus four sub-device-pixel touches from its finer raster (128 px/em).
- **`--lift-em X`:** evaluates a lift of X × the letter size instead of `MUSHAF_TEXT_LIFT_PT` (vertical check only); the app is unchanged.
- Its output holds no glyph codes. Results of 2026-10-15: `docs/mushaf-verification/`.

## Running the six 604-page Mushaf tests (mobile)

Six tests in `mobile/tests` skip unless these local, uncommitted inputs exist (Quran Foundation content stays out of the repository):

| Test | Needs |
|---|---|
| `mushafAllPages.test.ts` (3 tests), `hizbQuarters.test.ts` (1, the snapshot part), `qpcV1Android.test.ts` (1, all pages) | the snapshot `backend/data/mushaf-sync/records-*.json.gz` |
| `mushafSelectionAudit.test.ts` (1, all pages) | the snapshot, the 604 fonts, and the advances export in `QPC_V1_ADVANCES` |

```sh
# 1. Snapshot: QF_ENV=production, QF_CLIENT_ID and QF_CLIENT_SECRET in backend/.env (never committed), then
cd backend && npm run mushaf:sync -- --report && cd ..
# 2. Fonts (public CDN, outside the repo) and the advances export (Python tool or its Node equivalent)
node tools/mushaf-audit/fetch-qcf-fonts.mjs /tmp/qcf
node tools/mushaf-audit/export-word-advances.mjs /tmp/qcf backend/data/mushaf-sync/records-<seq>.json.gz /tmp/qpc-v1-advances.json
# 3. Everything, nothing skipped but the legal-site test (it needs ../quranhealslegal checked out)
cd mobile && QPC_V1_ADVANCES=/tmp/qpc-v1-advances.json npm test
```

Check the snapshot is the one devices receive: the `--report` version must equal `version` in the production manifest (`/api/mushaf/qpc-v1/offline/manifest`). Last run, 2026-10-14: sequence 547617, version `de84dc6fa58675669b4f5c30`, 604 pages, 6,236 ayahs, 83,665 words; all six passed (the selection audit about 5 minutes).

## Android (2026-10-12)

- **`audit_android_rendering.py`** (`<fonts dir> <records> <android-matrix.json> <report.json>`): every word occurrence's ink against the Android copy's drawable box, in each of 104 configurations. It also checks the first and last lines and the line ends against the frame, with the Android baseline rules. The matrix comes from `mobile/tests/mushafScreen.test.ts` ("Android screen matrix", `ANDROID_MATRIX_OUT=<path>`). The report is `android-rendering.report.json`.
- **Glyph order:** a word of several glyphs is drawn right to left (Arabic presentation forms). `audit_ink_overflow.py` and `verify_words.py` still compose such words left to right, so their horizontal per-word figures for those 4,579 words are mirrored. The Android audit, selection-ink generator and neighboring-line raster audit use the RTL order.

## Also

- **`audit-surah-openings.mts`** (`npx tsx`): Surah headings and Basmala slots on every page.
- **`mobile/tests/mushafAllPages.test.ts`:** runs whenever a local snapshot exists. It covers the reader's Tanzil check on all 604 pages and the opening slots.

## What they check
- **`audit_glyph_bounds.py`:** every glyph's outline against its Text box (the former 1.3 em box and the current full-line box), and the first and last lines against the frame. It also reports line counts and font sizes.
- **`audit_line_collisions.py`:** neighbouring word outlines, with RTL glyph order, page-order word placement, the app's pages 1–2 sizing, and hidden marker glyphs excluded. It checks every frame height from 29 through 35 tiles.

## Results after the 604-page Taller rollout, 2026-10-12

The heights are Traditional (29 tiles), Taller on a 393-pt iPhone (33), and the Taller cap (35, `TALLER_MAX_TILES_DOWN`).

- **Glyph boxes:** 88,444 glyphs on 604 pages (83,665 layout records; some records hold two glyphs). None is outside its Text box (`QCF_V1_LINE_BOX_EM`), and no first-line or last-line ink reaches the frame at any of the three heights.
- **Neighbouring word ink:** Traditional (29 tiles) has 270 conservative word-envelope candidates and 3 rasterised-outline intersections (pages 98, 213 and 341; 11, 1 and 41 pixels at 2048 pixels per em). At 30 and 31 tiles, there are 71 and 15 envelope candidates but no outline intersections; 32–35 tiles have neither.
- **Rendering:** `mobile/tests/mushafAllPages.test.ts` renders all 604 pages at four real text areas: 387-pt page at 29 and 33 tiles, 406-pt at 35, and 314-pt at 29. It checks:
  - every glyph is drawn once, in layout order, with the full glyph box;
  - all 6,236 ayah separators are drawn, at each size;
  - lines are exactly one pitch apart;
  - headings and Basmalas are in their slots;
  - pages 1–2 keep their printed spacing and stay centred.

## Earlier results, 2026-10-12
- **Fonts:** 603 fonts use ascent 2541 and descent 1378 per 2048 units; page 237 uses 2327 and 1331. Every glyph lies inside its font's ascent and descent.
- **Text boxes:**
  - The former 1.3 em box had 19,977 of 88,444 glyphs partly outside it, on every page.
  - The current box (`QCF_V1_LINE_BOX_EM`, 1.914 em) has none outside.
- **Frame:** no first-line or last-line ink reaches the frame.
- **Neighbouring word ink (RTL rerun):** the previous left-to-right result is superseded. The app-ordered audit reports three tiny Traditional-layout outline intersections (pages 98, 213 and 341) and none at 30–35 tiles. Their visibility at native Android pixel scale is not verified.
- **Pages 1–2:** these render about 1.5× larger than other pages, because their short lines are fitted to the full text width. This is a known layout difference, not clipping.
