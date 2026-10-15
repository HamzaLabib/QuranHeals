# Experiment: larger-text Mushaf (pages 4 and 604)

**Status: experiment only. Nothing here is used by the app.** The live Mushaf is unchanged; this folder is outside
`mobile/`, so it is not compiled, linted, tested or bundled. Created 2026-10-14.

**Question.** Can pages 4 and 604 show noticeably larger Quran text inside a frame that uses more of the screen's height?
The constraints are the same verified text, the same words on each line, the same line order, the real QPC V1 glyphs,
unchanged ornaments, no stretching and no clipping.

**Answer, in short:** [findings.md](findings.md). About **+5% is feasible and passes every check** on these two pages
(iPhone 14, iPhone 16 Pro Max and Pixel-sized reading areas). +6.2% is marginal, and **+8% fails**: its ink reaches
within 1 pt of the inner rule. Recommendation: **LIMITED**.

## Why the obvious approach cannot work

The page is already as wide as the phone allows (3 pt from each edge), and every element of it is sized from that
width. Scaling the whole page up is therefore impossible on most phones (see the earlier whole-page investigation).
The QPC V1 glyph size is set by the **text area's width**: in `QpcV1PageText`, the widest line fills the width
(`fontSize = 100 × width × 0.985 ÷ widest line at size 100`). Larger glyphs need a wider text area, at the same page width.

## What the experiment changes (two geometry parameters only)

| Parameter | Production | Experiment | What it is |
|---|---|---|---|
| Plain side margin inside the inner rule (`PAGE_GEOMETRY.textInsetX`) | 25/593 of the page width (16.2 pt at 384 pt) | reduced so the text area is k × wider | The empty paper between the frame's inner rule and the text. It is **not** an ornament. |
| Frame height in Normal Mode | 29 border tiles | the tallest whole-tile frame that fits (as Full Screen's existing "Taller" frame already does), up to 35 | More of the same square tiles down the sides. Never stretched. |
| The retired bar's reserved 64 pt | kept | reclaimed (the ورد pill keeps its own row) | Without it, no iPhone has room for even one extra tile. |

Unchanged: the page width, the border tiles and their size, the top/bottom text margin, the QPC V1 fonts and glyphs,
each line's words and order, justification, medallions, Surah heading artwork, the opening pages, the page number below
the frame, the running heads, the ورد pill, navigation, and every other reader feature.

Candidates by target glyph scale k: **A** original · **B** +3% · **C** +5% · **E** +6.2% (side margin = top/bottom
margin, the widest "balanced" text area) · **D** +8% · **F** the taller frame alone at the printed glyph size.

## How it was rendered (real renderer, isolated)

1. A **scratch copy** of the app outside the repository (identical to the repository's renderer files; it differs
   only by the unrelated Keep Screen Awake files). Nothing in the repository was patched.
2. [`source/harness/apply-experiment-patch.cjs`](source/harness/apply-experiment-patch.cjs) patches that copy:
   [`source/pageGeometry.patch`](source/pageGeometry.patch) and [`source/mushaf.patch`](source/mushaf.patch). The
   patch reads `?exp_inset`, `?exp_tiles` and `?exp_noband` from the web URL. **Without them it is inert:** the copy
   then renders exactly as production (candidate A).
3. The local backend's relay served the verified QPC V1 snapshot (version `de84dc6fa58675669b4f5c30`). Each page passed
   the app's own check against the Tanzil text before drawing, as in production.
4. [`source/harness/capture-exp.mjs`](source/harness/capture-exp.mjs) opened `/mushaf?page=N&source=online&exp_…` in
   headless Chrome (Expo Web), took the screenshots, and recorded the DOM geometry and each line's glyphs.
5. [`source/harness/analyze-exp.mjs`](source/harness/analyze-exp.mjs) measured the Quran ink in the screenshots'
   own pixels against the frame's inner rule. [`source/harness/compare-exp.mjs`](source/harness/compare-exp.mjs) built
   the comparisons from the captures only: equal-size panels and 1:1 device-pixel crops. Nothing was enlarged or redrawn.
6. [`source/harness/exp-calc.mts`](source/harness/exp-calc.mts) computes feasibility per phone from the repository's
   `pageGeometry.ts` ([`calculations/feasibility-by-phone.json`](calculations/feasibility-by-phone.json)).

Reproduce: copy `mobile/` outside OneDrive (Metro cannot crawl OneDrive's folders), `npm ci`, then
`node source/harness/apply-experiment-patch.cjs <copy>/mobile`. Start `backend` (`npx tsx src/server.ts`, with the local
snapshot) and `CI=1 EXPO_PUBLIC_API_URL=http://localhost:4000 npx expo start --web --port 8081` in the copy, then run
the three harness scripts in order. Their paths at the top of each file need adjusting. `cdp.mjs` uses Node's built-in
WebSocket and an installed Chrome.

## Contents

| Path | What |
|---|---|
| [findings.md](findings.md) | Results, limits, evidence and the recommendation |
| [calculations/measurements.md](calculations/measurements.md) | Every measurement per page × phone × candidate, with verdicts |
| `calculations/measurements.json`, `verdicts.json`, `captures-raw.json`, `feasibility-by-phone.json` | Raw data (DOM geometry, per-line glyphs, the dataset lines) |
| `screenshots/` | The 54 captures and their index (`screenshots/README.md`): no longer in Git since 2026-10-15 (the previous commits hold them). Preserved locally, verified file by file, in `My App/Working progress/Audit Reports/larger-text-mushaf-screenshots/` |
| `comparisons/` | 14 side-by-side images and 3 sets of 1:1 crops |
| `source/` | The harness, the patch, and `current-renderer-snapshot/` (the live geometry files at the time, with `SHA256SUMS`; working-tree copies, not Git-verified) |

The permanent archive of the production geometry is [`../../mushaf-page-layout-v1/`](../../mushaf-page-layout-v1/README.md),
verified by `node design-archive/verify-archive.mjs`. This experiment does not change it.
