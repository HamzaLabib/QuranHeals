# Findings: larger-text Mushaf, pages 4 and 604

All numbers were measured on the rendered captures (Expo Web in headless Chrome, at device-equivalent reading areas),
unless marked *calculated*. **No iPhone, Android device or simulator was used.** Every per-capture value is in
[calculations/measurements.md](calculations/measurements.md).

## 1. Recommendation: **LIMITED**

About **+5% larger Quran glyphs** is feasible on both pages, with every check passed: same text, same lines, no
clipping, no overlap, and clearances no tighter than the original's own. The gain is real but modest: on an iPhone 14,
glyphs go from 22.1 to 23.2 pt. It also depends on reclaiming the retired bar's 64 pt band. **+8% fails.** Two pages
cannot establish Quran-wide safety, and none of this is device-verified. It is not a recommendation to ship.

## 2. Results by candidate

| Candidate | Glyph scale (iPhone 14 / 16 Pro Max / Pixel) | Page 4 | Page 604 | Outcome |
|---|---|---|---|---|
| A original | 0% | PASS | PASS | Reference |
| B +3% | +3.0% / +3.0% / +3.0% | PASS | PASS | Feasible; small visible gain |
| **C +5%** | **+5.0% / +5.0% / +5.0%** | **PASS** | **PASS** | **Best demonstrably safe** |
| E +6.2% (balanced margins) | +6.2% | MARGINAL: right ink 3.8–4.0 pt from the rule, tighter than anywhere in the original | MARGINAL (Pixel: PASS) | Upper limit; not recommended |
| D +8% | +8.0% | **FAIL**: right ink 0.8–1.0 pt from the rule | MARGINAL: 2.0–2.6 pt | **FAIL**; kept as evidence only |
| F taller frame only | 0% | PASS | PASS | Shows that the frame alone adds space, not size |

**iPhone SE.** There the page is limited by height. Reclaiming the band therefore **widens the whole page** (317 → 357 pt),
and with it the glyphs (+12.6%, F: PASS). There is no room left for a taller frame (still 29 tiles). Narrowing the
margins on top (B–E, +16% to +20%) brings the lines closer relative to the glyph size (1.41–1.48 against 1.53) and is
MARGINAL. **On the SE, the best result is F: the band reclaimed, nothing else changed.**

## 3. The limits

**Horizontal: the binding limit.** The page width cannot grow, and the border tiles (5% of the width each side) are
ornament, so the only room is the plain side margin (4.2% of the width each side). Glyph scale k needs a side margin of
`(0.9 − 0.81568·k) ÷ 2` of the page width (*calculated*): 11.5 pt at +3%, 8.4 pt at +5%, 6.5 pt at +6.2%, and 3.7 pt at +8%
on a 384 pt page. The **ink reaches about 3 pt beyond the text area on the right** (line-initial letters and marks
such as the first ب, ظ, ح, أ of a line). This is so in the original too: 13.5 pt right against 16.1 pt left on an iPhone 14,
page 4. The right side therefore runs out first:

| Page 4, right side, ink → inner rule (pt) | SE | iPhone 14 | 16 Pro Max | Pixel |
|---|---|---|---|---|
| A original | 11.65 | 13.47 | 15.30 | 14.60 |
| B +3% | 8.65 | 8.80 | 9.63 | 9.27 |
| C +5% | 5.65 | 5.47 | 5.97 | 5.84 |
| E +6.2% | 3.65 | 3.80 | 3.97 | 3.94 |
| D +8% | **1.15** | **0.80** | **0.97** | **0.89** |

The original's own tightest clearance is page 4's top margin: 4.24 / 5.48 / 6.15 / 5.50 pt. C stays at that level, E goes
below it, and D nearly touches the rule (comparison 20).

**Vertical.** A larger glyph needs a proportionally larger line pitch. With the band kept, no iPhone has room for even
one more tile, except the 16 Pro Max (*calculated*: +3.8% at most). With the band reclaimed, iPhones fit 32–33 tiles,
enough for about +11% to +15%, so vertical space is not the limit once the band is gone. In every candidate the line
pitch ÷ glyph size stays at or above the original's 1.526 (C: 1.62 on the iPhone 14, 1.67 on the 16 Pro Max, 1.78 on
the Pixel), except on the SE (above).

**Reclaiming the 64 pt band is required** on every iPhone (*calculated*, `feasibility-by-phone.json`). With it, the ورد
pill moves down: its bottom ends 14.8 pt from the reading area's bottom on an iPhone 14 (75.6 today), 8.5 pt on a
16 Pro Max and 7.3 pt on an SE. The popups that open in the band today (page selector, ورد name field) would then open over the pill.

## 4. C (+5%) against the original (iPhone 14 reading area, 390 × 763)

| Measurement | Original | C +5% | Difference |
|---|---|---|---|
| Quran glyph size | 22.08 pt | 23.19 pt | **+5.0%** |
| Widest line, ink extent (page 4) | 316.0 pt | 331.7 pt | +15.7 pt |
| Available text width | 313.2 pt | 328.9 pt | +15.7 pt |
| Plain side margin | 16.2 pt | 8.4 pt | −7.8 pt |
| Minimum horizontal clearance, ink → rule (page 4) | 13.5 pt | 5.5 pt | −8.0 pt |
| Minimum vertical clearance, ink → rule (page 4) | 5.5 pt (top) | 6.5 pt (top) | +1.0 pt |
| Medallion → rule (closest) | 18.6 pt | 10.9 pt | −7.7 pt |
| Frame width | 384 pt | 384 pt | 0 |
| Frame height | 556.8 pt (29 tiles) | 614.4 pt (32 tiles) | +57.6 pt |
| Line pitch ÷ glyph size | 1.526 | 1.619 | lines slightly more open |
| Quran lines (page 4 / page 604) | 15 / 9 | 15 / 9 | match |
| Each line = dataset, glyph for glyph | yes | yes | match |
| Page 604: headings / medallions | 3 / 15 | 3 / 15 | match |
| Page 604: heading band | 331.8 × 33.7 pt | 331.8 × 37.5 pt | same width; taller with the row |
| Page number below the frame | 10.4 pt | 10.4 pt | unchanged |

## 5. Quran integrity (all 54 captures)

- **Same text, same lines.** Every rendered Quran line was compared, as glyph strings, with the line in the verified
  relay dataset (`de84dc6f…`): page 4's 15 lines and page 604's 9 text lines. They are identical in every light capture
  (`linesMatchDataset`), so no word moved line, no word is missing and the order is unchanged. Each page also passed the
  app's own Tanzil check before it was drawn. The dark captures use the same code path but were not re-compared.
- **No new glyph source.** The same QCF V1 page fonts and glyphs are used, sized only by font size: no transform, no
  horizontal compression, no stretching. Justification is the production one.
- **Clipping.** A browser does not clip glyph ink the way iOS and Android `Text` boxes can, so these captures cannot
  prove the absence of native clipping. The ink room the reader reserves (`QCF_V1_INK_OVERFLOW_EM`,
  `QCF_V1_INK_ROOM_V_EM`) is in em, so it grows with the glyphs. In the 1:1 crops (comparison 21) the bottoms of ع ج م ح
  (يجعلون، أصابعهم، محيط) are intact in every candidate; غ and خ were not specifically cropped and need a visual check, and the line spacing is never tighter than today's, except on the SE.
- **Overlaps.** No Quran ink touches the inner rule in A–C or E. In D it comes within 0.8 pt. Medallions stay ≥ 5.9 pt
  from the rule in every candidate. Heading bands keep their width and their clearance to the inner rule: 5.7–6.9 pt each side, depending on the phone, the same in every candidate.

## 6. The frame (Phase 7)

The taller frame uses the border's existing repetition: whole square tiles added down each side, as Full Screen's Taller
frame already does in production. Corners, tile artwork and tile size are unchanged and nothing is stretched. It is a
design difference: the printed Mushaf has 29 tiles down, and this frame has 32 (iPhone 14), 33 (16 Pro Max) or 35 (Pixel).
The extra height opens the line spacing up to Taller's own 25% cap. On the Pixel the spacing is noticeably airier
(1.78 em), which may read as gaps; a lower cap would leave paper above and below instead. The Surah heading bands keep
their width and become as tall as the taller row (drawn as vector artwork for that box, as Taller already does); their
artwork is unchanged.

## 7. Uncertainty

- **Browser rendering, not native.** Chrome draws the glyphs: iOS's vertical glyph shift (`qcfV1DrawnLineShiftEm`),
  Android's unclipped ink copies, and native font rasterisation are not exercised. Native widths can differ by a fraction
  of a point. This matters most for C's 5.5 pt and E's 3.8 pt edge clearances.
- **Two pages.** Page 4 is a regular page and page 604 a special one. The widest-ink line-starts of other pages, for example
  lines beginning with ك or ل with marks, may come closer to the rule. A Quran-wide check of the right-side ink extent on all
  604 pages is needed before any decision.
- **The ink measurement** counts dark neutral pixels (colour range < 60, luminance < 110), with medallions and heading
  bands excluded by their DOM boxes, to ±1 device pixel.

## 8. If this were taken further (not done)

1. Run the same right-side ink measurement on all 604 pages at C, and on native iOS and Android builds.
2. Decide the band separately. It is the precondition here, and on its own it gives the SE +12.6%.
3. Consider C only with device screenshots, since its edge clearance equals the original's top margin, not more.
