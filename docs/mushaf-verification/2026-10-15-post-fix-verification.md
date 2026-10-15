# Post-fix verification: Mushaf bottom-frame crossings — 2026-10-15

**Result: PASS (automated).** The approved correction removes every frame crossing on iOS and Android, on all 604 pages, at every supported page width and frame height. It creates no new top-frame collision, overlap or clipping, and changes nothing else in the approved design. Not verified on a physical device.

- **Fixes:** issues 1 and 2 of `2026-10-15-final-604-page-verification.md`; that report and its results (`results/2026-10-15-current-layout-audit.json`) are kept unchanged as the pre-fix evidence. Issue 3 (the stale vertical-position test) is also resolved here.
- **Post-fix results:** `results/2026-10-15-post-fix-layout-audit.json` (no glyph codes).

## The change

**Sign and coordinate system, checked first.**
- `MushafPageView` draws the whole text area at `top = text.y − lift`, with y downward. A larger lift moves every line, Surah heading, Basmala, medallion, highlight and tap target up together.
- Bottom clearance therefore grows and top clearance shrinks by the same amount. This is the model `audit-current-layout.mts` uses (`text.y − lift + y`).

**New:** `mushafTextLift(textWidth, os)` in `mobile/src/mushaf/pageGeometry.ts`.
- **iOS and Android:** `NATIVE_TEXT_LIFT_EM` (0.26) × the nominal letter size.
  - The nominal size is `NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH` (0.0692) × the text-area width: the median letter size of pages 3–604 at the +5% layout.
  - A page's own size is only measured after it is drawn, so the container cannot use it. This gives every page of a width the same lift.
  - Measured as a share of each page's own letter size: **0.247–0.276**.
- **Web:** unchanged, `MUSHAF_TEXT_LIFT_PT` = 4 pt. The web draws at the layout's own baseline, and a larger lift would push its first line into the top rule.

| | Page width | Lift before | Lift after |
|---|---|---|---|
| iPhone SE | 324 pt | 4 pt | 4.99 pt |
| iPhone 15/16 | 387 pt | 4 pt | 5.96 pt |
| iPhone 16 Pro | 396 pt | 4 pt | 6.10 pt |
| Android tablet | 681 pt | 4 pt | 10.49 pt |

**Applied wherever the frame's edge is needed in text-area coordinates:**
- the text area itself (`MushafPageView`);
- the header touch areas (`MushafPageView`);
- pages 1–2's centring on the frame (`QpcV1PageText`);
- Surah heading placement (`surahHeadingPlacement.ts`).

**Deliberately unchanged: the page fitter** (`app/(tabs)/mushaf.tsx` `textBottomFor`).
- It still chooses the page width and tile count on the 4 pt basis.
- Using the new lift there would have widened the iPhone SE page from 324 to 325 pt: an approved-geometry change, caught by `mushafScreen.test.ts`.
- On native, the text is now drawn higher than the fitter assumes, so it ends even further above the page selector's card.

**Not changed:** Quran text, data, QCF fonts and glyphs, letter size (+5%), the 15-line grid, line spacing, horizontal positions, the frame, tiles, page width, ornaments, medallions and the gold Wird indicator.

## Before / after (pt, ink to the frame's inner rule)

### The 8 pages that crossed (bottom, last line, Normal Mode)

Negative = past the rule. Rounding ±0.01 pt.

| Page (ayah, word) | iPhone 15/16 | iPhone 16 Pro |
|---|---|---|
| 5 (2:29, 19) | 0.06 → 2.02 | −0.03 → 2.07 |
| 142 (6:118, 8) | −0.11 → 1.85 | −0.20 → 1.90 |
| 202 (9:99, 27) | −0.11 → 1.85 | −0.21 → 1.89 |
| 381 (27:55, 9) | −0.21 → 1.75 | −0.31 → 1.79 |
| 459 (39:10, 19) | −0.36 → 1.60 | −0.46 → 1.64 |
| 553 (62:8, 17) | −0.70 → 1.26 | −0.81 → 1.29 |
| 556 (64:9, 27) | −0.22 → 1.74 | −0.32 → 1.78 |
| 560 (66:7, 10) | −1.24 → 0.72 | −1.36 → 0.74 |

### Every supported configuration (worst page of 604)

| Device / mode | Top before → after | Bottom before → after | Crossings before → after |
|---|---|---|---|
| iPhone SE, Normal | 6.44 → 5.44 | −0.39 → 0.60 | 1 → 0 |
| iPhone SE, Full screen | 8.06 → 7.06 | 0.50 → 1.46 | 0 → 0 |
| iPhone 13 mini, Normal | 7.89 → 6.23 | −0.97 → 0.68 | 4 → 0 |
| iPhone 13 mini, Full screen | 9.72 → 8.07 | 0.50 → 1.65 | 0 → 0 |
| iPhone 14, Normal | 9.10 → 7.18 | −0.56 → 1.35 | 2 → 0 |
| iPhone 14, Full screen | 10.38 → 8.46 | 0.50 → 1.73 | 0 → 0 |
| iPhone 15/16, Normal | 8.56 → 6.60 | −1.24 → 0.72 | 7 → 0 |
| iPhone 15/16, Full screen (33 / 34 tiles) | 9.85 → 7.89 / 10.50 → 8.53 | 0.05 → 1.80 / 0.50 → 1.74 | 0 → 0 |
| iPhone 16 Pro, Normal | 8.87 → 6.76 | −1.37 → 0.74 | 8 → 0 |
| iPhone 16 Pro, Full screen | 10.19 → 8.08 | −0.05 → 1.84 | 1 → 0 |
| iPhone Plus, Normal | 10.52 → 7.98 | −1.04 → 1.50 | 3 → 0 |
| iPhone Plus, Full screen | 11.93 → 9.40 | 0.38 → 1.91 | 0 → 0 |
| iPhone 16 Pro Max, Normal | 10.87 → 8.18 | −1.16 → 1.53 | 5 → 0 |
| iPhone 16 Pro Max, Full screen | 12.32 → 9.63 | 0.29 → 1.95 | 0 → 0 |
| Android 320/360×640, Normal | 5.76 → 5.54 | 0.29 → 0.51 | 0 → 0 |
| Android 320/360×640, Full screen | 7.59 → 7.36 | 0.97 → 1.19 | 0 → 0 |
| Android 360×800, Normal / Full screen | 10.38 → 8.92 / 10.97 → 9.51 | 0.50 → 1.59 / 0.50 → 1.54 | 0 → 0 |
| Android 412, Normal (3-button) / gesture | 12.49 → 10.23 / 13.17 → 10.91 | 0.50 → 1.82 / 0.50 → 1.76 | 0 → 0 |
| Android tablet, portrait (~680 pt) | 20.26 → 13.76 | −5.23 → 1.27 | 36 → 0 |

**All iOS and Android combinations audited:** 17 page widths (268–681 pt) × 31–35 tiles, 170 combinations.
- **Crossings:** 0 (before: 422 page crossings, in 74 of the 170 combinations).
- **Smallest bottom clearance:** 0.50 pt (page 560 on a 268-pt page).
- **Smallest top clearance:** 4.42 pt (before: 5.76 pt on the real phone configurations).

**Notes:**
- The pre-fix 0.50 pt values were Surah heading bands pinned at their 0.5 pt minimum against the bottom frame; they now have room.
- The tightest top on the iPhone 15/16 is page 187's Surah heading band, 6.60 pt below the rule.
- The web is unchanged (fixed 4 pt): its known top touches at the two smallest page widths (268, 274 pt) remain, as before.

## No new defect

| Check (all 604 pages) | Before | After |
|---|---|---|
| Top-frame collisions, iOS and Android | 0 | **0** (minimum 4.42 pt) |
| Surah heading clearance (114 headings × 91 sizes/frames, iOS, Android, web) | pass | **pass** |
| Neighbouring-line outline intersections, 31–35 tiles | 0 | **0** |
| Medallion overlaps with neighbouring lines | 0 | **0** |
| Clipping (77,429 words, ink inside the drawn Text, both modes, web and native placement) | 0 | **0** |
| Rows inside the page, rows one pitch apart, headings and Basmala in their slots (`mushafAllPages`, 9 frames) | pass | **pass** |
| Ayah selection on all 604 pages, iOS/Android/web, both modes (`mushafSelectionAudit`) | pass | **pass** |
| Pages 1–2 centred on the frame's ornamental circle | pass | **pass** |
| Page width and tile count on every phone | approved | **unchanged** |
| Horizontal clearances | unchanged by design | **unchanged** |

**Light and Dark:** the geometry is the same in both, since Appearance changes colours only. The Dark Mode tests (page, medallions, gold Wird indicator) pass.

## Tests

| Command | Result |
|---|---|
| `npx tsx tools/mushaf-audit/audit-current-layout.mts <qcf> <records-547617> <out> --calibrate` | 0 iOS/Android crossings; calibration unchanged (pages 98, 213, 341 with the Python model's pitch) |
| `cd mobile && QPC_V1_ADVANCES=<export> npx vitest run` | **152 files, 2,698 passed, 1 skipped** (the legal-site test, which needs `../quranhealslegal`); every 604-page test ran |
| `cd mobile && npx tsc --noEmit` | clean |
| `cd mobile && npx expo lint` | clean |

**Regression test** (`mobile/tests/qpcV1VerticalPosition.test.ts`):
- **Now checks:** the post-fix 604-page results, pinned to the app's constants (`NATIVE_TEXT_LIFT_EM`, `NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH`, `MUSHAF_TEXT_LIFT_PT`, `QURAN_TEXT_SCALE`, `MIN_TILES_DOWN`, the inset and boxes).
- **It asserts:** zero iOS/Android crossings at every width × frame; bottom ≥ 0.5 pt, top ≥ 4.4 pt; zero clipping; zero neighbouring-line intersections; the web's known touches only at 268/274 pt.
- **No longer pinned:** the 2026-10-12 report (`tools/mushaf-audit/vertical-position.report.json`, kept as evidence).

## Still to confirm on a device

The iPhone glyph placement used here is the app's own measured model (`qcfV1DrawnLineShiftEm`), not a fresh device measurement. Confirm on an iPhone 15/16 or 16 Pro, Normal Mode, Light and Dark:
- **pages 560 and 553:** the last line clear of the bottom rule;
- **page 187:** heading band clear of the top;
- **pages 1, 2 and 604:** composition unchanged.

On an Android phone, check page 560. If an Android tablet is in scope, check page 560 there too.

## Files changed

**App (lift):**
- `mobile/src/mushaf/pageGeometry.ts`: `NATIVE_TEXT_LIFT_EM`, `NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH`, `mushafTextLift`; `MUSHAF_TEXT_LIFT_PT` documented as the web's.
- `mobile/src/components/MushafPageView.tsx`: the text area and header touch areas use `mushafTextLift`.
- `mobile/src/components/QpcV1PageText.tsx`: pages 1–2's centring uses `mushafTextLift`.
- `mobile/src/mushaf/surahHeadingPlacement.ts`: frame bounds use `mushafTextLift`.
- `mobile/src/app/(tabs)/mushaf.tsx`: the page fitter keeps the approved 4 pt basis (comment only; the code is unchanged in effect).
- `mobile/src/mushaf/ayahMarkers.ts`: comments only.

**Tests (now mirror the per-platform lift):**
- `mobile/tests/qpcV1VerticalPosition.test.ts`: rewritten report section, plus the pages 1–2 formula.
- `mobile/tests/mushafScreen.test.ts`
- `mobile/tests/surahHeadingClearance.test.ts`
- `mobile/tests/mushafAllPages.test.ts`
- `mobile/tests/mushafSelectionAudit.test.ts`
- `mobile/tests/openingPages.test.ts`
- `mobile/tests/surahOpenings.test.ts`
- `mobile/tests/mushafGeometry.test.ts` (comment only)

**Audit and docs:**
- `tools/mushaf-audit/audit-current-layout.mts`: uses the app's `mushafTextLift`; records the lift constants, the lift's share of each page's letter size, and per-page clearances for iPhone 15/16 and 16 Pro.
- `tools/mushaf-audit/README.md`
- `docs/mushaf.md`: dated update.
- `docs/mushaf-verification/2026-10-15-post-fix-verification.md`: this report.
- `docs/mushaf-verification/results/2026-10-15-post-fix-layout-audit.json`

Not committed, pushed, deployed or built.
