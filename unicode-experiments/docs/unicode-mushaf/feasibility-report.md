# Unicode 604-page Mushaf — prototype and feasibility report

**Date:** 2026-10-15 · **Status:** prototype, development builds only · **Verdict: CONDITIONAL** (§12)

> **Phase 2 update (device readiness, 2026-10-15):** see §15 below, and the companion documents
> [licensing.md](licensing.md), [device-testing-checklist.md](device-testing-checklist.md) and
> [migration-plan.md](migration-plan.md).

The production QPC V1 (QCF) reader is unchanged and stays the default. Nothing was committed, pushed, deployed or
built for release. No backend, database, sync or production setting was touched.

## 1. What was built

A second renderer for the existing Mushaf tab that draws the **verified Tanzil text** (the app's SQLite, 114 Surahs,
6,236 ayahs) in a **Unicode Quran font**, on the **1405 AH Madina Mushaf's own 604 pages and 15 lines**, inside the
**unchanged production page**: the green-and-gold frame, paper colours, running heads, page number, navigation,
popups, ورد pill, zoom, swipe and full screen are all the production components.

| Piece | Where |
|---|---|
| Renderer (drop-in for `QpcV1PageText`) | `mobile/src/components/UnicodeMushafPageText.tsx` |
| Layout engine (pure, deterministic) | `mobile/src/mushaf/unicode/layout.ts` |
| Text integrity check before drawing | `mobile/src/mushaf/unicode/integrity.ts` |
| Display encoding for KFGQPC fonts | `mobile/src/mushaf/unicode/encoding.ts` |
| Tajweed colours | `mobile/src/mushaf/unicode/tajweed.ts` |
| Fonts (download + verify / bundled dev asset) | `mobile/src/mushaf/unicode/font.ts` |
| Prototype settings (device-only) | `mobile/src/mushaf/unicode/settings.ts` |
| Generated tables | `mobile/src/mushaf/unicode/generated/*.ts` |
| Generators and audits | `tools/unicode-mushaf/` (README there) |

**How to try it (development build, or `npm run web`):** open the Mushaf tab; a development-only chip row appears in
the top bar: **QCF V1 / Unicode** (renderer), **KFGQPC / Amiri** (font) and **Tajweed Colors: Off / ألوان التجويد:
إيقاف**. Or open `/mushaf?page=3&renderer=unicode`. The choices are kept on the device only, never synced.

### Why not a WebView

The brief suggested embedding quran-madina-html through a WebView. It was evaluated and **not used**:

- `react-native-webview` is not installed; adding it needs a **new native build** of every dev client.
- The reader's page is inside `MushafZoomView` (Gesture Handler pinch, pan, double-tap and swipe-to-turn). A WebView
  consumes touches natively, which conflicts with those gestures, and three pages are mounted at once (the page and
  its neighbours for swipes): three WebViews, each tens of MB on Android.
- Every tap would cross a message bridge before the production popups could open; a zoomed WebView is a scaled
  bitmap (blurry at 3×).
- The library's renderer is small (one 1,300-line file): its value is the **Madina05 layout data** and its approach.
  The prototype uses that layout data and reimplements rendering natively with the same idea, so every production
  feature works unchanged and nothing crosses a JavaScript boundary. No account token, encryption key or reflection
  data is involved in rendering at all.

The library's justification also squeezes glyphs horizontally (CSS `scaleX` down to 0.68; median 0.96) — the
distortion the brief excludes. The prototype never distorts a glyph (§5).

## 2. quran-madina-html investigation

- Repository `tarekeldeeb/quran-madina-html` v1.0.1, commit `bed882fc` (2026-08-14), pinned by SHA-256
  (`tools/unicode-mushaf/madina05.lock.json`).
- **Licence:** "Waqf" General Public License 2.0. Use and redistribution are allowed; **modified works may be
  redistributed only under Waqf**, crediting the original and stating the modifications. The derived layout file
  carries that notice. The layout itself comes from the library's build: an OCR glyph database of the King Fahd
  print (`AyahInfo_1024.db` from murtraja/quran-android-images-helper) whose own licence is not stated — **needs
  confirmation before a release**.
- **Data:** per ayah, its page and, per line, its text and a stretch factor (`Madina05-<font>-<size>.json`, ~1.9 MB
  each). Text is Tanzil Uthmani with build-inserted tatweels and, for some fonts, font-specific text changes (the
  Uthman font replaces every ٱ with ا — a change to the Quran text).
- **Coverage:** 604 pages; 15 lines on pages 3–604; pages 1–2 as a centred 8-line block.

## 3. Quran text integrity (text validation — separate from rendering)

The prototype stores **no Quran text**. The layout lists verse indexes and Tanzil token ranges; the words always
come from the verified SQLite.

| Check | Result |
|---|---|
| Madina05's text vs verified Tanzil, every ayah, letter and mark (ignoring tatweel, spaces and its 199 ۞ signs, which our export does not have) | **6,236 / 6,236 identical** |
| Every Tanzil token placed exactly once, in reading order, pages and lines never going back | 81,812 / 81,812 |
| One ayah number per ayah, after its last word | 6,236 / 6,236 (1 added, see §4) |
| Surah headings / Basmala lines | 114 / 112, every one on an empty line |
| Page starts vs the reader's navigation (`generated/pageStarts.ts`) | 604 / 604 |
| Each page's loaded text vs the text the layout was generated from (FNV-1a per page; refused otherwise) | 604 / 604 |
| Drawn words on all 604 pages, kashida removed, reassembled per ayah = the verified ayah (minus the Basmala Tanzil prefixes to 112 first ayahs) | 6,236 / 6,236, byte for byte, both fonts |
| A changed diacritic or a dropped word in the source | refused (test) |
| Copy from the popup (web, clipboard read back) | exactly the verified 2:6, with U+0652 / U+06DF intact |

**Where the drawn characters differ from the stored text, and why that is safe:**

1. **Kashida** (U+0640) inserted for justification, only at legal joining points. Removing them gives back the
   verified word exactly; checked on every drawn word.
2. **KFGQPC display encoding.** KFGQPC's own text gives the two sukun signs each other's code points relative to
   Tanzil: Tanzil U+0652 (the Madina head-of-khah sukun) is KFGQPC U+06E1, and Tanzil U+06DF (round zero, a letter
   written but not read) is KFGQPC U+0652. Verified against KFGQPC's own text (`hafsData_v18`) word by word over the
   77,135 words whose letters match: **all 36,901** Tanzil U+0652 → KFGQPC U+06E1, **all 3,988** U+06DF → U+0652,
   **no exception**. Tanzil never uses U+06E1, so the swap is one-to-one: every drawn line maps back to the verified
   bytes (tested on all 6,236 ayahs). Applied to drawn characters only; copy, share, favorites and reflections use
   the verified text. Without it, KFGQPC fonts draw **every sukun as the round "silent letter" sign** — an
   orthographic error, not a cosmetic one.

Nothing else is re-encoded. KFGQPC's own text is a different edition (other pause signs, context-dependent tanween
forms), so a full conversion would not be exact and was rejected.

## 4. Madina05 vs the app's 1405 AH QCF V1 layout (all 604 pages)

Compared word by word with the local Content Sync snapshot (`tools/unicode-mushaf/compare-layouts.mjs`;
report in `Working progress/Screenshots and Logs/unicode-mushaf-prototype-2026-10-15/`).

| | Result |
|---|---|
| Page boundaries (first ayah of every page) | **604 / 604 identical** |
| Words on the same page | 77,433 / 77,433 |
| Words on the same page **and line**, pages 3–604 | all but **1** (13:37, below) |
| Ayah numbers on the same line, pages 3–604 | all but **1** (13:37, missing in Madina05) |
| Pages 1–2 | identical line breaks; Madina05 numbers its centred block 1–8, QCF V1 uses rows 9–15 of the grid |
| Heading/Basmala slots on a QCF V1 text line | 0 |
| Ayah number on the page of its QCF medallion (so ورد ayah positions carry over) | 6,236 / 6,236 |

**Madina05 defect at 13:37 (page 254), corrected in the generator and listed in the generated file:** it split the
pair «بَعْدَ مَا» (one word in the print and in QCF V1) across lines 6–7, and dropped the ayah's number. The second
token is kept on the first's line; the number is placed after the ayah's last word.

**Conclusion:** after that correction, the prototype reproduces the QCF V1 page and line breaks exactly on every page.

## 5. Layout and justification

- **One letter size on every page:** font size = text width ÷ 21 em. In a Unicode font the print's lines have very
  different natural widths (90% between 13.8 and 20.1 em; widest line per page 12.8–21.3 em), so fitting each page
  separately would change the letter size by up to 66% from page to page.
- **Justified edge to edge, glyphs never distorted:** gaps grow to 0.42 em, then **kashida** (up to 4 tatweels per
  word, widest words first; up to 8 on sparse lines), then the gaps take the rest. Over-long lines tighten their gaps
  and are drawn slightly smaller as a whole — **7 lines** in the whole Mushaf (smallest ×0.962). Widest gap anywhere:
  **1.01 em**. Kashida points (68,517 of 77,881 word groups) are checked by shaping each word with 1, 2 and 3
  tatweels; 2,311 words whose first tatweel would narrow them (a KFGQPC kaf form) are never elongated.
- **Centred as printed:** pages 1–2, Basmala lines, and 53 short Surah-final lines.
- Positions come from **HarfBuzz** widths (the shaper of Android and Chrome) measured at build time, not from
  on-device measuring: the page is identical in Normal Mode and full screen and with Tajweed on or off.
- **Medallions:** the production traditional medallion (same artwork, same colours, gold for the active ورد's ayah)
  in a slot of its own in the line, so taps, highlight and the gold work as in the QCF reader.
- **Opening pages and headings:** pages 1–2 inside the production ornamental circle and cartouche; Surah headings
  use the production traditional band, centred in their row (the QCF reader's ink-based heading placement is
  QCF-specific and was not ported).

## 6. Fonts

| Font | Tanzil text as is | Look | Licence | Decision |
|---|---|---|---|---|
| **KFGQPC HAFS Uthmanic Script v18** (QF CDN) | **No** — sukun signs swapped; U+06DF, U+06EB, U+06E3 drawn as a placeholder circle (3,972 word groups) | The Madina Mushaf's own type | KFGQPC EULA + QF font terms (as the QCF fonts) | **Default, with the display encoding (§3)** — then only 2 words fail |
| KFGQPC v22 (Tarteel QUL CDN) | No — same as v18 | same | unclear redistribution | rejected |
| KFGQPC v1.001 (library's WOFF2) | U+06DF yes; U+06EB/U+06E3 no; **no tatweel glyph at all** | Madina | unverified source; WOFF2→TTF conversion would modify it | rejected |
| **Amiri Quran** (OFL) | **Yes, every sign** (0 failures) | Naskh (Bulaq), not Madina | OFL 1.1, free to bundle | second font + KFGQPC's fallback |
| Amiri Quran Colored | yes | Naskh | OFL | rejected for Tajweed: colours marks by glyph type (vowels red, pause signs blue…), **not by recitation rule** |
| KFGQPC Uthman Taha Naskh ("Uthman") | **No** — lacks ٱ (4,829 ayahs) and most pause marks | Madina-like | KFGQPC EULA | rejected (the library rewrites ٱ→ا for it) |
| me_quran | yes | older Naskh | "free for non-commercial use" | rejected (licence) |

The reference screenshot (`Reference Designs/mushaf.jpg`) is a KFGQPC-Hafs-style page; KFGQPC v18 with the display
encoding matches it best. **Fallback:** the only two words KFGQPC cannot draw from Tanzil's encoding —
«تَأْمَ۫نَّا» (12:11, U+06EB) and «ٱلْمُصَۣيْطِرُونَ» (52:37, U+06E3) — are drawn in Amiri Quran on the same baseline
(KFGQPC's edition writes different signs there, so they are not re-encoded).

A new automated audit (`measure-widths.py`) fails the build when any in-word mark maps to a non-mark glyph — it
reproduces exactly the visual findings above. HarfBuzz alone did not reveal them (KFGQPC's placeholder is merged into
the base letter's cluster and the fonts have no dotted circle).

**Font delivery in the prototype:** KFGQPC v18 is downloaded once from QF's documented CDN, accepted only with the
pinned size and SHA-256, and kept in the app's documents (offline afterwards); it is not in the repository or binary
(QF terms; the repository is public). Amiri Quran is a development dependency (`@expo-google-fonts/amiri-quran@0.4.1`,
OFL), bundled in development builds only.

## 7. Tajweed Colors · ألوان التجويد (prototype only, OFF by default)

- **Source:** cpfair/quran-tajweed (CC BY 4.0), rule-based decision trees for Hafs — 18 rules (ghunnah, idghām ×5,
  ikhfāʾ ×2, iqlāb, madd ×5, qalqalah, hamzat al-waṣl, lām shamsiyyah, silent letters), 60,057 annotations. Re-running
  its classifier reproduces the published file exactly.
- **Carried onto the verified text** through an exact character alignment (its 2017 Tanzil copy differs only by
  tatweels, pause tokens and three spaces); every annotation must cover the same letters, then is widened to whole
  letters (14,137 of 60,057) so a colour never separates a letter from its marks.
- **Valid rules, not whole words:** spot-checked on page 595 — hamzat al-waṣl and lām shamsiyyah grey, ghunnah on
  «ٱلنَّهَارِ», madd muttaṣil in «ٱلسَّمَآءِ», qalqalah on «قَدْ», idghām in «نَفْسٍ وَمَا».
- **Palette** (Dar al-Maʿrifah convention): reds/oranges for madd by length, green nasalisation, blue qalqalah, grey
  unpronounced; separate Light and Dark values (Dark checked on Warm Midnight Olive).
- **Layout identical ON/OFF:** the same characters in the same Text at the same positions (component test compares
  every word's position, size and font; web check: the first word of line 5 at the same pixel). The ورد's gold
  medallion is unaffected (checked with Tajweed ON).
- **Settings:** labelled "Tajweed Colors" / «ألوان التجويد», On/Off; device-only key; would move to Settings → Quran
  after approval.

## 8. Existing features (compatibility layer)

The renderer plugs into `MushafPageView`'s `renderText` slot, so the reader's own code keeps doing everything else.

| Feature | Status | Evidence |
|---|---|---|
| Surah / juz' / Hizb lists, page selector, running heads, page number | unchanged components | screenshots |
| Swipe (left→right = next), pinch zoom, double-tap, full screen, Keep Screen Awake | unchanged | web swipe check; full-screen shots |
| First-use guide | example word and medallion registered | component code; guide targets |
| Tap ayah → Reflection · Save · Copy · Share popup | works | web: popup opens, highlight on, dismiss clears |
| Copy | verified text | web: clipboard = SQLite 2:6 exactly |
| Tap medallion → Apply to ورد / new ورد | works | web: popup, name field, ورد saved |
| Gold ayah medallion for the active ورد | works, one per page | web + component test |
| Khatma, reading stops, page/ayah persistence, sync | unchanged code paths (same pages and ayah keys) | ayah numbers on the same pages as QCF V1 (6,236/6,236) |
| Deep links `/mushaf?page=N&ayah=S:A` | work | web: 61→3:84 highlighted, 604→114:1 highlighted |
| Reflections/encryption, favorites, أورادي وختماتي, reminders, language and translations | not involved in rendering; unchanged | — |
| Light / Dark palettes, frame, paper | production values | screenshots |

## 9. Verification performed

**Automated (local):**
- `tests/unicodeMushafIntegrity.test.ts` (17) and `tests/unicodeMushafPage.test.ts` (5): **22/22 pass** — all §3
  checks, encoding round trip, both fonts on all 604 pages, layout bounds, and the critical pages 1, 2, 3, 5, 187, 319,
  560, 595, 604 in nine real text areas (iPhone 393 Normal/full screen, tall Android 412, iPhone SE, 360-pt Android,
  320-pt, Pro Max, tablet 820): every row inside the page, every word inside its line, one medallion per number.
- Full mobile suite: **2,712 passed**, 1 skipped, **10 failed — all in `preferencesSyncLifecycle.test.ts`**, a
  pre-existing timing failure unrelated to this work (its first test exceeds the 5 s timeout on this machine; it
  passes 18/18 with `--testTimeout=30000`, and neither it nor anything it imports is among the changed files; it
  was not re-run on the last commit `545d2d9` itself).
- `tsc --noEmit` clean; ESLint clean on all changed files. All four generators regenerate byte for byte.
- **Web (headless Chrome, Expo web dev server, no backend):** 35 screenshots — pages 1, 2, 3, 5, 187, 319, 560, 595,
  604 in Light, Tajweed ON, Dark, Dark + Tajweed, full screen, 360/384/393/820-pt widths, Amiri — each with an
  automated DOM check: **0 overlapping words, 0 words outside the text area**. 11/11 interaction checks pass.
  Screenshots and logs: `Working progress/Screenshots and Logs/unicode-mushaf-prototype-2026-10-15/`.

**Not verified — no physical device or emulator was available (no Android SDK on this machine):**
- iOS (CoreText) and Android (Minikin/HarfBuzz) rendering, including the Samsung Galaxy S22 Ultra and Huawei Nova.
  The "S22 Ultra 384" and "Android 360" screenshots are **Chrome at those widths, not devices**.
- Whether Arabic letters stay joined across Tajweed colour boundaries on Android and iOS. On Android every nested
  Text fragment gets size/font spans (React Native 0.86 `TextLayoutManager`), i.e. separate measuring runs; Chrome
  keeps letters joined, devices must be checked.
- The vertical baseline of KFGQPC Hafs on iOS (the QCF fonts needed a 0.376 em correction there).
- Native font download/caching, memory, and frame times on devices.

## 10. Android fragmentation (pages 3, 595) and page 560

The QCF defects came from one native Text per QCF glyph clipped to the glyph's advance. The prototype draws each word
group as one Text inside a box 0.6 em wider on each side and the font's full line box tall (every KFGQPC glyph lies
within ascent + descent except 5 by at most 0.008 em, covered by a 0.08 em margin), so no ink is outside its box and
no padding is relied on (Android clips inside padding). Expected to resolve the fragmentation, **but this is
unverified on devices**. Page 560: last line well clear of the bottom frame in every width checked (web).

## 11. Performance, size, offline

- Layout: median **0.2 ms** per page, max 2.3 ms; integrity check 0.06 ms (desktop Node; phones slower, still far
  below a frame).
- Web: first page ~1.3 s from opening the reader (SQLite worker start + font download); neighbouring pages 0.1–0.25 s.
- **Release bundle: unchanged.** The reader reaches the prototype only through
  `typeof __DEV__ !== 'undefined' && __DEV__ ? require(…) : null`; Metro inlines `__DEV__` and constant-folds this to
  `null` before collecting dependencies (checked with Metro's own transform plugins), and every other reference is
  `import type`. Development bundle: +~1.8 MB of generated tables and the Amiri Quran TTF.
- Offline: layout, widths and Tajweed are bundled (dev); the Quran text is the local SQLite; KFGQPC v18 is cached
  after its first download (needs network once — production would bundle it, see §13).
- Text never shows before its font: a page is drawn only once its font is registered and its text has passed the check.

## 12. Verdict: **CONDITIONAL**

Suitable for migration, with these conditions:

1. **Device verification** on iPhone, Samsung Galaxy S22 Ultra and Huawei Nova (critical pages, Tajweed ON/OFF,
   baseline, joining across colours, performance).
2. **Licensing:** written confirmation from KFGQPC for KFGQPC v18 (same open item as the QCF fonts); confirm Waqf GPL
   compatibility of distributing the derived layout, and the licence of the OCR data behind it; credit cpfair (CC BY)
   and Amiri (OFL) in Quran Sources & Credits.
3. **Accept the documented differences from the print:** Unicode type with kashida justification instead of the
   calligrapher's elongations; Tanzil's single tanween forms (KFGQPC's print distinguishes stacked and staggered
   tanween by context, which Tanzil does not encode); two words in a fallback font; headings centred rather than
   ink-placed.

What it already achieves: exact page and line fidelity to the 1405 AH Mushaf (after one documented correction),
byte-exact Quran text with every display change reversible and tested, the production design and features, Tajweed
from real rules with identical layout, and a release bundle untouched.

## 13. Remaining work for a full migration (estimate)

| Work | Estimate |
|---|---|
| Device testing and fixes (iOS baseline, Android spans, S22 Ultra / Nova) | 3–5 days |
| Bundle KFGQPC v18 (git-ignored, restored by hash like `p61.ttf`), offline from first launch | 1 day |
| Tajweed Colors into Settings → Quran (setting, sync decision, credits, legend) | 1–2 days |
| Surah heading placement tuned for the Unicode font; pages 1–2 sizing review | 1–2 days |
| Make Unicode the default with QCF as fallback; remove the offline QCF download path or keep it | 2–3 days |
| Production bundle-size check, accessibility review, credits page, store screenshots | 1–2 days |
| Licence confirmations (KFGQPC, Waqf, OCR data) | external |

## 14. Files

**Modified:** `mobile/src/app/(tabs)/mushaf.tsx` (development-gated renderer branch and chips),
`mobile/package.json` and `mobile/package-lock.json` (dev dependency `@expo-google-fonts/amiri-quran@0.4.1`).

**Added:** `mobile/src/components/UnicodeMushafPageText.tsx`; `mobile/src/mushaf/unicode/` (`index.ts`, `data.ts`,
`layout.ts`, `words.ts`, `encoding.ts`, `integrity.ts`, `tajweed.ts`, `font.ts`, `settings.ts`, `marker.ts`,
`generated/madina05Layout.ts`, `generated/hafsWordWidths.ts`, `generated/amiriWordWidths.ts`,
`generated/tajweedRules.ts`); `mobile/tests/unicodeMushafIntegrity.test.ts`, `mobile/tests/unicodeMushafPage.test.ts`;
`tools/unicode-mushaf/` (`README.md`, `madina05.lock.json`, `madina05.mjs`, `compare-layouts.mjs`,
`generate-layout.mjs`, `generate-tajweed.mjs`, `measure-widths.py`); this report.

**Phase 2 added:** `mobile/src/mushaf/unicode/diagnostics.ts`; `docs/unicode-mushaf/licensing.md`,
`device-testing-checklist.md`, `migration-plan.md`. **Phase 2 modified:** `UnicodeMushafPageText.tsx` (Android
hardening, ✓ check mode), `app/(tabs)/mushaf.tsx` (✓ chip, compact chips), the generators and generated tables (Tanzil
notice), `tests/unicodeMushafPage.test.ts` (+2 tests), `tests/mushafScreen.test.ts` (+1 release-gate test),
`docs/mushaf-device-testing.md` (pointer).

## 15. Phase 2 — device readiness (2026-10-15)

**No physical device or emulator was used** (none available; no Android SDK on the development PC). Everything below is
code, automated tests, headless Chrome, or analysis.

**Builds.** The prototype adds no native module (Amiri Quran is a font asset; everything else was already in the app),
so the **existing development build** runs it from Metro on iPhone and Android. No new build was made. The
development chips are compact and fit a 360-pt phone in English and Arabic (checked, no overlap): **QCF / Uni**,
**KF / Amiri**, **✓** (rendering check) and **Tajweed Colors · ألوان التجويد** (filled = On). In release bundles none of
them exist (new test in `mushafScreen.test.ts`, which runs as a release bundle with `__DEV__` false, even with
`?renderer=unicode`).

**Rendering hardening (code changes):**
- `includeFontPadding: false` on every Quran word (Android otherwise adds the font's extra top/bottom padding and moves
  the baseline away from iOS and the layout).
- `ellipsizeMode="clip"`: a word can never be replaced by "…"; if a platform's advance were ever wider than its generous
  box, the problem shows plainly.
- **Baseline prediction:** the rule that exactly explains the QCF V1 iPhone offset (TextKit places the OS/2 typo line;
  0.376 em for the QCF fonts, whose hhea and typo metrics differ) predicts **0.000 em for KFGQPC v18 and Amiri Quran**,
  whose hhea and typo metrics are identical (2400/1200 and 1815/634). Prediction, to be confirmed on devices.
- **Joining across Tajweed colours:** colour runs only ever change between whole letters (base and marks), never
  between a letter and its diacritic (tested over all 604 pages). Chrome keeps letters joined across them (zoomed
  screenshots). On Android, React Native 0.86 gives every coloured run its own size/font spans; Minikin shapes each
  run within its whole word's context, so joining is expected to hold — **unverified on hardware**.
- **Rendering check mode (✓):** outlines every word's and medallion's slot and each line's baseline, and compares what
  the platform laid out (`onTextLayout`: width, baseline) with the layout. It reports per page (badge plus Metro
  log): width Δ, words off by more than 1 px, baseline Δ, and neighbouring words that would touch. This turns device
  testing into numbers. `diagnostics.ts` is tested; react-native-web has no `onTextLayout`, so the badge appears only on
  iOS and Android, while the outlines also show on the web (screenshot `check-mode-p003.png`: boxes and baselines
  match the glyphs).

**Licensing (verified from the texts; nothing contacted):** see [licensing.md](licensing.md). Production blockers:
KFGQPC confirmation for the font (shared with QCF V1); the Madina05 licence (Waqf in `LICENSE.md` vs ISC in
`package.json` and its README), and shipping a Waqf data file; and the **OCR data behind Madina05**, which is
unlicensed and derived from images rendered with KFGQPC's own fonts, so the page/line layout ultimately reflects
KFGQPC's page composition. CC BY credit is required for the Tajweed data, and the OFL notice for Amiri. Generated
tables now also carry the Tanzil notice.

**Re-verification after the changes:** 35 headless-Chrome shots (fresh Metro, `--clear`), 35 clean (0 overlaps, 0
outside); 11/11 interaction checks pass (popup, highlight, Copy = verified text, Apply to ورد, gold medallion, Tajweed
positions unchanged, swipe). Screenshots and logs: `Working progress/Screenshots and Logs/unicode-mushaf-readiness-2026-10-15/`.

**Migration:** [migration-plan.md](migration-plan.md). Fonts go through the hash-pinned, git-ignored restore pipeline;
the tables become on-demand JSON assets; QCF V1 stays as an automatic per-page fallback and a user setting; **no user
data needs migrating** (ورد = page + ayahKey; Khatma, favorites and reflections are renderer-independent; every ayah
number on the same page as in QCF V1); rollback by EAS Update in minutes, with nothing lost.

## 16. Phase 3 — matching QCF V1 (2026-10-15)

Requested: the Unicode rendering as close as possible to QCF V1. Full findings, screenshots and the evaluation are in
[visual-candidates.md](visual-candidates.md).

- **Font research** (actual files): DigitalKhatt Old Madina (OFL, drawn from the Madina Mushaf in Uthman Taha's hand,
  6,162 glyphs with the calligrapher's graded elongations) is by far the closest to QCF V1. The KFGQPC Unicode fonts
  (v18, v22, v1.001) are typographic and lighter; Uthman Taha Naskh cannot draw the text; Amiri is Naskh.
- **Three candidates** built into the prototype (chip **A·KF+ / B·Mad / C·Mad✦ / KF / Am**): A enhanced KFGQPC, B QH
  Old Madina with spacing, **C QH Old Madina with calligraphic justification** (one connection per word takes the font's
  own longer form, through tatweels the font draws as nothing — an OFL derivative, `build-madina-font.py`).
- **Recommendation: C.** It reads like the Madina Mushaf: same hand as QCF V1, heavy strokes, natural elongations,
  median gap 0.31 em. Remaining differences are listed in visual-candidates.md §5; it is not QCF V1's own glyph
  drawings.
- **Integrity:** all renderings pass the full 604-page text check; Copy returns the verified text; Tajweed ON never
  moves a word; 35/35 web shots clean and 11/11 interactions pass with C. Full suite: 2,723 passed; the 10 failures are
  the pre-existing `preferencesSyncLifecycle` timeout.
- **Still unverified on devices**, as everything in this prototype: iOS may place QH Old Madina's baseline ~0.2 em
  higher (its OS/2 typo line gap is 200 against hhea 0) — the ✓ check mode will show it.
