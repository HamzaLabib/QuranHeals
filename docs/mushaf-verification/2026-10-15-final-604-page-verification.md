# Final 604-page Mushaf verification — 2026-10-15

**Verdict: FAIL.** One verified defect class needs a decision before public release: on current iPhones in Normal Mode, a last-line descender crosses the frame's inner rule on 8 pages (worst: page 560, 1.4 pt). Everything else passed automated verification. The proposed fix changes the approved layout and was **not applied**. No physical device was used.

- **Code verified:** `main` at `f0b5ad8` (clean tree; only the user's own `README.md` edit was present).
- **Layout data:** Content Sync snapshot 547617, content version `de84dc6fa58675669b4f5c30`. This is the version production serves now (`/api/mushaf/qpc-v1/offline/manifest`, read-only GET, 200, sequence 547620, same version): 604 pages, 6,236 ayahs, 83,665 words.
- **Fonts:** the 604 QCF V1 page fonts from Quran Foundation's public CDN (the app's own download source), kept outside the repository. Page 61 equals its pinned SHA-256 (`fonts.lock.json`). The other fonts have no pinned hash in the app; the app accepts them by glyph coverage, which check A repeats. All 604 hashes are in the results file (hash of hashes `2d6c2475…`). `export-word-advances.mjs` output from these fonts equals the committed fixture byte for byte.
- **Results file:** `results/2026-10-15-current-layout-audit.json` (no glyph codes).

## Phase 1 — previous verification

- `docs/mushaf-larger-text-review/audit-checkpoint/` exists but is **empty** (`results/`, `results/superseded/`, `scripts/` created 2026-10-14 19:35; nothing tracked, nothing in git history). Nothing could be resumed.
- Other evidence found:
  - the larger-text experiment (outside the repo, `My App/design-archive/experiments/larger-text-mushaf/`): pages 4 and 604 only, browser captures. It states that "a Quran-wide check of the right-side ink extent on all 604 pages is needed";
  - three Chrome profiles in `%TEMP%/quran-heals-audit` from an earlier browser audit, with no results;
  - commit `78fcd0d` (the +5% text): "Final browser visual audits and native-device verification remain pending."
- **Reusable as is:** checks that do not depend on the page geometry (Quran text equality, glyph coverage, ayah selection logic).
- **Not reusable:** the 2026-10-12 Python geometry results (`tools/mushaf-audit/README.md`), `vertical-position.report.json` and `android-rendering.report.json`. They model the printed 29-tile layout and the printed side margin (16.2 pt), not the shipped +5% layout (8.4 pt margin, 31–35 tiles).
- **Python is not installed on this machine**, so the Python audits could not be re-run. They were replaced by a Node audit, `tools/mushaf-audit/audit-current-layout.mts`. It imports the app's own geometry and placement code and is calibrated against the Python tool's published result (see Phase 2).

## A. Page verification

| | Pages |
|---|---|
| Pages verified (automated) | **604 / 604** |
| Pages passed | **559** |
| Pages failed | **8** — 5, 142, 202, 381, 459, 553, 556, 560 (issue 1) |
| Pages not tested (automated) | **0** |
| Pages requiring manual inspection | **37** — 36 with right-edge ink under 4 pt from the rule (issue 4) and page 158 (issue 5) |
| Physical-device verification | **0 / 604** (not performed) |

**Automated coverage, every page:**
- rendering by the app's own components (`mushafAllPages.test.ts`);
- the reader's Tanzil check;
- ayah selection on all 604 pages (`mushafSelectionAudit.test.ts`);
- Android's unclipped glyph copies (`qpcV1Android.test.ts`);
- Hizb starts;
- the Node geometry audit (structure, horizontal, clipping, neighbouring lines, vertical);
- visual inspection of model renders of the flagged regions.

## B. Quran integrity

**Database integrity pass (text):**

| Check | Result |
|---|---|
| Surahs validated | **114 / 114** |
| Ayahs validated | **6,236 / 6,236** |
| Canonical source | Tanzil Uthmani 1.1, SHA-256 `6933e133…ec5f`: matches its pin |
| Bundled `quran.sqlite` against the source (`generate-sqlite.mjs --verify`) | 6,236 exact matches, 0 mismatches, 0 missing, 0 duplicate, 0 invalid, 0 empty; SQLite `integrity_check` ok |
| Backend corpus validation (`validate:quran:source`, no database) | valid: 0 duplicates, 0 gaps, 0 checksum failures; 6,236 translations |
| Backend Quran data tests (`tests/quran-data`) | 19 files, 170 tests passed |
| Verification suites (`tools/quran-verification`, `tools/quran-import`) | 35 / 38 passed; the 3 failures are a toolchain guard, not text (issue 7) |
| King Fahd comparison | Unchanged reference evidence: 2,498 orthographic review cases, retained and unresolved by design (`tools/quran-verification/output/`). Not a regression; no text was changed. |

**Mushaf layout integrity pass (page-to-ayah):**

| Check | Result |
|---|---|
| Word records | 83,665; every glyph code is in its own page's font (0 missing, so no fallback font) |
| Ayah-end separators | 6,236, one per ayah; all drawn at each test size (`mushafAllPages`) |
| Ordering | ayah order never decreases through any page or across pages (0 errors) |
| Reader's Tanzil check | passes on all 604 pages (with the Basmala rule) |
| Surah openings | 114 headings, 112 Basmalas; every empty line on pages 3–604 is one of them |
| Hizb quarters | 240 starts, each start ayah's first word on its stated page |

**Not machine-verifiable (unchanged since 2026-10-12):** that each QCF glyph's outline spells its Tanzil word letter by letter. There is no machine-readable correspondence. The glyphs are Quran Foundation's authentic QCF V1 fonts, used without substitution, normalisation or transformation.

**Visual rendering pass:** reported separately in C.

## C. Visual design

All lengths are on a 387-pt page (iPhone 15/16) unless stated; horizontal results scale with the page width.

| Area | Result |
|---|---|
| Typography (+5%) | Letter size = text width × 0.985 ÷ the widest line, from `QURAN_TEXT_SCALE` 1.05: about 23.2 pt on a 387-pt page. No transform or stretching anywhere. Pages 1–2 keep their approved printed size. PASS |
| 15-line layout | Pages 3–604: 15 rows each (text lines plus heading and Basmala slots). Pages 1–2: their own centred composition. Rows exactly one pitch apart (`mushafAllPages`). PASS |
| Borders | Whole square tiles only (`computePageLayout`); 31–35 tiles; the inner box and rules are unchanged in width. PASS |
| Clipping (native Text boxes) | 0 of 77,429 words have ink outside their drawn Text: ±2.4 em horizontally; line box ± 0.5 em (+0.25 em in Normal Mode) vertically; at web and native glyph placement, both modes. Android: every glyph has its exact unclipped copy. PASS |
| Horizontal ink against the inner rule (letters) | No page touches. Side margin 8.42 pt; tightest right edge 1.58 pt (page 319, line 1), tightest left edge 5.59 pt (page 535, line 6); 36 pages under 4 pt. Manual check: issue 4 |
| Stray specks | 1,809 tiny contours stored far from their glyphs in the fonts; 2 are drawn beyond the inner rule (pages 158 and 556). Issue 5 |
| Diacritics and neighbouring lines | 0 rasterised outline intersections between adjacent lines at 31, 32, 33, 34 and 35 tiles (45, 9, 0, 0, 0 envelope candidates). 0 medallion overlaps with neighbouring lines. PASS |
| Vertical ink against the inner rule | iPhone Normal Mode: **8 pages cross at the bottom** (issue 1). Android phones: clear in every configuration. Full screen: clear except page 560 on the 16 Pro (−0.05 pt). Top edge: clear on all native placements (minimum 5.76 pt, small Android). FAIL |
| Surah headings and Basmala | In their slots on every page; heading bands inside the frame on every phone configuration (only an Android-tablet width reaches it: issue 2). PASS |
| Ayah-number ornaments | One authentic medallion per ayah (6,236), sized on its own ring, never overlapping a neighbouring line. PASS |
| Light / Dark | Covered by component tests (gold and medallions in both; `mushafAppearance`). Device rendering not verified. PASS (automated) |
| Right-to-left | Lines drawn right to left (`row-reverse`, `space-between`); each multi-glyph word's glyphs ordered right to left. PASS |

**How the geometry audit was validated.** With the Python tool's own row pitch, the Node audit reproduces its published neighbouring-line intersections on pages 98, 213 and 341, in the same order of size, with 263 envelope candidates (Python: 270). It also finds 4 extra sub-device-pixel touches, because its raster is finer. Envelope and placement models follow `QpcV1PageText.tsx` exactly, through its imports.

**Device configurations audited.** Every page width from 268 to 681 pt (17 widths) × 31–35 tiles, on web, iOS and Android glyph placements. The real phones, from the documented layout table, are tabulated in `results/` (vertical section).

## D. Wird indicator (gold medallion)

All automated; all passed in this run (`wirdAyahMarker.test.ts` with the real pages, `mushafScreen.test.ts`, `readingStops.test.ts`, `khatmas.test.ts`, `readingSync.test.ts`).

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Apply on an ayah number turns that separator gold | PASS | "Apply: that ayah's medallion turns gold at once…" |
| 2 | Moves when the saved position changes | PASS | "Apply on another ayah moves it…" |
| 3 | Previous separator returns to normal | PASS | same test; per-ayah colour-only snapshots |
| 4 | Persists after navigation, restart and sync | PASS | "only on its saved page…"; "restored after a restart"; "follows changes made elsewhere (account sync…)"; account download of `ayahKey` |
| 5 | Switching Wirds shows the selected Wird's position | PASS | "switching ورد shows that ورد's own ayah…" |
| 6 | No incorrect simultaneous highlights | PASS | `wirdAyahOnPage`: only the selected Wird, only its page; one gold per page |
| 7 | Deleting a Wird removes its highlight | PASS | "…deleting the ورد clears it"; "deleting the ورد removes it with its ayah" |
| 8 | Gold preserves the QCF separator geometry | PASS | colours only: glyph, line and medallion boxes unchanged, every ayah of real pages 1, 2, 4, 61 and 604 |
| 9 | Light and Dark | PASS | approved gold palette; Dark Mode tests |
| 10 | Reflection, Save and Share unaffected | PASS | medallion takes no touch; taps reach the line (Apply / X, Reflection / Save / Share) |

**Needs a physical device:** how the gold actually renders, natively, in Light and Dark (colour and anti-aliasing).

## E. Remaining issues

1. **MEDIUM — the last line's descender crosses the frame's inner rule on iPhones (Normal Mode).**
   - **Pages and amounts:** 8 pages; how far past the rule, by device:

     | Device (Normal Mode) | Pages (pt past the rule) |
     |---|---|
     | iPhone 15/16 | 560 (1.24), 553 (0.70), 459 (0.36), 556 (0.22), 381 (0.21), 142 (0.11), 202 (0.11) |
     | iPhone 16 Pro | the same, up to 1.37, plus page 5 (0.04) |
     | 13 mini, 14, Plus, Pro Max, SE | 1–5 pages each |
     | Full screen | only page 560 on the 16 Pro (0.05) |
     | Android phones | none |

   - **Glyphs:** always a long descender on line 15, for example the tail of the final م in كُنتُمْ (66:7, word 10) on page 560.
   - **Evidence:** results file, vertical configurations.
   - **Model renders** (outside the repository; reproducible): page 560 crosses at the iPhone placement and clears by about 6 pt at the web placement.
   - **Root cause:**
     - the iPhone draws QPC glyphs 0.376 em below the layout's baseline (`qcfV1DrawnLineShiftEm`, measured from screenshots; Android rows follow it);
     - the only compensation is the fixed `MUSHAF_TEXT_LIFT_PT` = 4 pt (documented as temporary);
     - the drop grows with the letter size and the lift does not.
   - **History:** pre-existing. The 2026-10-12 report pinned the same pages (7 at 396 pt, page 560 at −1.22 pt) as "reported to the user, not adjusted". The +5% layout neither caused nor fixed it.
   - **Proposed minimal fix (needs approval; changes the approved layout):** on iOS and Android only, a lift of about 0.26 × the letter size instead of 4 pt. Evaluated with `--lift-em 0.26`: 0 touches on iOS and Android at every width × 31–35 tiles; bottom ≥ 0.54 pt, top ≥ 4.43 pt. Keep the web at 4 pt, since the larger lift would push its first line into the top rule.
   - **Confirm on a device either way:** pages 560 and 553 on an iPhone 15/16 or 16 Pro.
2. **MEDIUM (scope) — Android tablets.** In portrait, a tablet gets about a 680-pt page at 31 tiles. The fixed lift then leaves 36 pages crossing at the bottom (page 560: 5.2 pt) and one heading band (page 506: 0.4 pt). iPad is not affected: `supportsTablet` is not enabled, so iPads run the iPhone layout. The fix in 1 resolves it; alternatively restrict Android tablets.
3. **MEDIUM (evidence) — stale vertical-position evidence.**
   - **Problem:** `tools/mushaf-audit/vertical-position.report.json` (2026-10-12) describes the pre-+5%, 29-tile layout. `mobile/tests/qpcV1VerticalPosition.test.ts` still pins it, so that test passes against outdated evidence. `android-rendering.report.json` is from the same date.
   - **Action:** regenerate with the current layout (the Python tools need their geometry updated), or pin the test to the new Node results.
4. **LOW — tight right edges.** 36 pages have line-initial letter ink within 4 pt of the right rule on a 387-pt page (min 1.58 pt: page 319 line 1, ك). The experiment estimated 5.5 pt from page 4 alone. No ink touches.
   - **Visual check on a device:** pages 319, 347, 524, 349, 234, 593.
   - **Full list:** results `horizontal.under4PtAt387`.
5. **LOW — two font specks inside the border band.**
   - Page 158 line 1 (7:58, word 9) and page 556 line 3 (64:2, word 5).
   - Each is a 0.5–0.7-pt dot that the font stores 1.5–1.8 em from its glyph, drawn 4–8 pt into the border band.
   - A pre-existing font artifact (one of the "fragment" contours flagged in 2026-10-12).
   - **Recommendation:** check on a device. The fonts must not be modified; if hiding them is wanted, it needs a renderer decision.
6. **LOW — web build on the smallest widths only.** At 268/274-pt pages, the first line touches the top rule on 17–25 pages. This is the web placement only; native small Android is clear (5.76 pt).
7. **LOW (tooling) — SQLite generator reproducibility tests.**
   - **Problem:** 3 tests refuse to rebuild because they pin Node 24.15 / SQLite 3.51.3, while `.nvmrc` pins Node 24.21 (SQLite 3.53.4). CI does not run them.
   - **Not affected:** the read-only bundle verification passes.
   - **Action:** align the pins (re-baseline on 24.21 or document the build toolchain).
8. **LOW (test flake).** `startupRegression.test.ts` "LAN URL is allowed" exceeded its 5-s timeout once (5.06 s) during the full run under load; it passed 3/3 alone. Unrelated to the Mushaf.
9. **INFO — physical devices.** No iPhone or Android device was used. The iPhone glyph placement used here is the app's own measured model, not a fresh measurement.

## F. Release verdict

**FAIL.** Issue 1 is a verified geometric defect on current iPhones in Normal Mode: ink crosses the frame's inner rule on 8 pages, as modelled with the app's own iPhone placement. It needs either the proposed lift change (your approval) or an explicit acceptance after device screenshots of pages 560 and 553. Issues 2–3 should be addressed alongside it. With issue 1 resolved or accepted, the remaining automated verification is a **PASS**, with physical-device checks still required:
- pages 560, 553, 319, 347, 158 and 556;
- pages 1, 2, 4, 61 and 604 in Light and Dark;
- the gold medallion on device.

## Commands and results

| Command | Result |
|---|---|
| `node tools/mushaf-audit/fetch-qcf-fonts.mjs <scratch>/qcf` | 604 downloaded |
| `node tools/mushaf-audit/export-word-advances.mjs <qcf> <records> <out>` (+ `--pages 1,2,5,50,61,237,466`) | 604 pages; fixture byte-identical |
| `NODE_OPTIONS=--max-old-space-size=6144 npx tsx tools/mushaf-audit/audit-current-layout.mts <qcf> <records> docs/mushaf-verification/results/2026-10-15-current-layout-audit.json --calibrate` | completed (~75 s); deterministic (two runs identical) |
| same with `--lift-em 0.24` / `0.26` (proposal only) | iOS/Android: 0 touches |
| `cd mobile && QPC_V1_ADVANCES=<out> npx vitest run tests/mushafAllPages.test.ts tests/hizbQuarters.test.ts tests/qpcV1Android.test.ts tests/mushafSelectionAudit.test.ts` | 4 files, 15 / 15 passed, 0 skipped (1,018 s) |
| `cd mobile && npx vitest run` (the other 148 files, snapshot present) | 2,681 passed, 1 skipped (legal-site test), 1 timed out once (issue 8; 3/3 on re-run) |
| `cd mobile && npx tsc --noEmit` / `npx expo lint` | clean / clean |
| `node tools/quran-import/generate-sqlite.mjs --verify` | 6,236 exact, 0 mismatches |
| `node --test tools/quran-verification/*.test.mjs tools/quran-import/sqlite.test.mjs` | 35 / 38 (issue 7) |
| `cd backend && npm run validate:quran:source` | valid (its tracked report was rewritten with identical content and restored) |
| `cd backend && npx vitest run tests/quran-data` | 19 files, 170 / 170 |

**No changes to app code, Quran text, datasets, fonts, layout or design.** Added: `tools/mushaf-audit/audit-current-layout.mts`, its README section, and this report with its results file.
