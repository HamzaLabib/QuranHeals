# Mushaf prototype (`/mushaf`, page 61)

**Integrated (2026-10-13):** the reader is now the app's **Mushaf tab** (`app/(tabs)/mushaf.tsx`; see `docs/khatma.md` for the tabs, أورادي وختماتي and Khatmas). The tab bar is hidden on the Mushaf tab in both Normal Mode and full screen (`MUSHAF_TAB_OPTIONS`), so the reader keeps the whole screen and the page its approved size and geometry, unchanged. A tab bar under the reader had made the Normal Mode page up to 11.7% narrower on small iPhones (iPhone 15: 387 to 354 pt). The Back arrow returns to the tab shown before (`backBehavior="history"`, Home first); the bar returns on every other tab. The page design is unchanged. The historical notes below describe how it was built.

Originally an isolated prototype. One page (61, Aal-i-Imraan 3:84–3:91) with two interchangeable renderers inside the same measured page frame:

| Renderer | Text | Source | Status |
|---|---|---|---|
| **QPC V1** (default) | 1405 AH Madani Mushaf (Uthman Taha): the reference print | QCF V1 page font + Quran Foundation layout | Needs QF credentials on the backend (below) |
| **Quran SVG** (fallback, selectable) | Newer KFQC typesetting | `quran-ws/quran-svg` v1.1.1, pinned and hash-checked | Working |

The QPC V1 text is drawn only when the font is loaded **and** the layout passes a check against the verified Tanzil text. That check covers the same 8 ayahs, each ayah's word count, and one marker per ayah. Otherwise the SVG page is shown with a note.

## Sources

The complete offline Mushaf (all 604 pages, Quran Foundation Content Sync `mushafs:2`) is described in [mushaf-offline.md](mushaf-offline.md). Below: page 61 as first built.


- **Font:** `QCF_P061` version 5.10, © King Fahd Glorious Qur'an Printing Complex (produced by Harf Information Technology).
  - From Quran Foundation's documented CDN: `https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p61.ttf`.
  - 155,996 bytes; SHA-256 `34d6a665…51fc486`. The full hash is pinned in `mobile/src/mushaf/qpcV1Fonts.ts` and tested.
  - Bundled into the app at `mobile/assets/mushaf/qpc-v1/p61.ttf`. Only page 61 is bundled.
  - **Not in git.** The repository is public, and Quran Foundation's font terms allow the font only inside the app, never as a standalone download. The `.ttf` is git-ignored and restored by `mobile/scripts/restore-mushaf-fonts.mjs` from the CDN above, only if it matches the size and SHA-256 pinned in `mobile/assets/mushaf/qpc-v1/fonts.lock.json` (tracked).
  - It runs automatically:
    - `postinstall` (only warns if offline);
    - `pretest`, `prestart`, `preandroid`, `preios`, `preweb`;
    - the CI step *Restore pinned QCF V1 font*, before `npm ci`;
    - EAS Build's `eas-build-pre-install`. EAS uploads only what git keeps (`.gitignore`), so the builder downloads the font itself.
  - By hand: `npm run fonts:restore` in `mobile/`. If Quran Foundation ever changes the file, the script refuses it: review the new font, then update `fonts.lock.json` and `qpcV1Fonts.ts` together.
- **Layout:** Quran Foundation Content API, `GET /content/api/v4/verses/by_page/61?words=true&word_fields=code_v1,line_number,page_number&mushaf=2&per_page=50`.
  - Fetched by our backend (`backend/src/mushaf/qpcV1Layout.ts`) and served to the app at `GET /api/mushaf/qpc-v1/pages/61`. Only page 61 is served.
- **Expected line breaks:** our own transcription of `Reference Design.jpg`, in `mobile/src/mushaf/referencePage061.json`. It records each line's first word as an ayah plus a word number in the verified Tanzil text, and the line each ayah marker sits on.

## Reading view

`/mushaf` (or `/mushaf?page=N`) is a full-screen reader:
- **Back arrow:** a plain `arrow-left` in a 36-pt row under the status bar, always shown, with no circle, background or label. Its touch target reaches 44 × 44 pt (8 pt up into the status-bar area, never down onto the page). It goes back to the previous screen, or to Home if there is none (`utils/goBackOrHome.ts`). Android's own Back works as before.
- **Page:** directly under that row, at the largest size that fits above the space reserved at the bottom (where the retired floating bar was: 56 + 8 pt, kept so the page and the ورد pill don't move), in its own proportions (never cropped or stretched), 3 pt from the screen's sides. The surah and juz heads, the border and the page number all stay. On phones the width decides the size, so any spare height sits below the page. Examples:
  - iPhone 393 pt: 387 × 623 pt, with 27 pt above the bar.
  - Android 412 dp: 406 × 653.
  - Small phones and tablets: the height decides.
- **No credit under the page:** the sources are credited at the bottom of Home and in full on `/credits` (see "Authorization and terms").
- **Navigation and actions (2026-10-14 redesign).** The floating bar (next/previous page, Reflection, ورد save, search) is retired; its code, tests and maths are preserved, verified and restorable in `design-archive/mushaf-navigation-v1/`. Everything now happens on the page itself, through transparent touch areas over the printed furniture (`MushafPageView` `navigation`), which move, resize or redraw nothing and never reach over the Quran text:

| Tap | Opens | Notes |
|---|---|---|
| Surah name (top left) | Surah list (`MushafIndexSheet`) | All 114, searchable in Arabic or English (`mushaf/surahSearch.ts`); opens the Surah's first page (one beginning partway down a page opens that page) |
| juz' (top right) | juz' list | 30, searchable by number (Western or Arabic-Indic digits); each opens its first page |
| Hizb label (top centre, where printed) | Hizb list | 60 whole Hizbs only, never the quarter markers; each opens its first page |
| Page number (under the frame) | Compact page selector (`MushafPageSelector`) | See below |
| An ayah's words | Reflection · Save (`MushafAyahActions`) | Exactly two. Reflection: the retired bar's lit lamp exactly (`ReflectionBulbIcon` lit, size 23, the `saved` green outline, the `activeFill` #FFC000 glass) and the existing Reflection editor. Save: the Favorites heart (filled when saved) and the existing Favorites toggle (the ayah fetched with `getAyah`, as on the ayah screens). Neither touches a ورد or a Khatma. |
| An ayah's number (the separator medallion) | Apply to [ورد] · X (`MushafWirdApply`) | Saves **this page** to the active ورد (read from storage at the tap, the ورد list's own source of truth), through the reader's one save path (page 604's Khatma rules included). Closes when saved; on failure it stays open with the reason. No active ورد: the button is "New reading stop on this page" and opens the ورد name field. Wirds store pages, not ayahs (`docs/auth-and-sync/reading-sync.md`). |

  - **Ayah popups open 350 ms after the tap** (`DOUBLE_TAP_MS`): a double-tap (the zoom reset) opens none, and a popup never opens over another page. A tap outside dismisses it (the ayah is then no longer selected). Placed above the tap when there is room, otherwise below, inside the safe areas.
  - **Page selector:** a slim card 14 pt from the screen's sides, at the bottom. Top row, physically fixed in every language: the selected page's Surah on the LEFT, the page number in the CENTRE (tap to type one: Western or Arabic-Indic digits, 1–604), its juz' on the RIGHT, both from the page's first ayah (`mushaf/navigation.ts`, `generated/pageStarts.ts`; a page belongs to the Surah and juz' at its top, the running heads' rule). Below, one RTL slider with a 22-pt olive thumb: page 1 at the right end, 604 at the left; dragging left raises the page; whole pages only; a screen reader's increment / decrement step one page. Sliding and typing only preview (no page is read or drawn). The one way to go is the arrow beside the number: a later page shows a left arrow on the number's left (← 200), an earlier one a right arrow on its right (60 →), the same page none (`mushaf/pageSelector.ts`). A tap outside closes it and changes nothing.
  - **Screen readers:** the page has next / previous page actions (also on a page not yet downloaded), replacing the bar's arrows.
  - **The ورد name field** (`MushafStopNameField`, the retired bar's, unchanged): opened by the ورد list's "New reading stop on this page" (or the pill when there are none). It saves this page to the ورد of that name, creating it when new; "Saved" shows briefly.
  - **Colours:** every popup uses the reader's own panel colours (`MUSHAF_PANEL_COLORS`), Light and Dark; its fields keep the reader's cream / olive field colours (`MUSHAF_FIELD_COLORS`).
  - **Not changed:** the page geometry, the Quran text and its line breaks, the opening pages and the Surah headings, the ورد pill, swipes and zoom. The investigated text enlargement (2–4 %) and extra bottom space (8–12 pt) were not applied: the vertical audit leaves 0.6 pt above the text at 387 pt (negative on narrow pages), so either would need native-device checks first (`design-archive/design-ideas/README.md`).
- **Full-screen reading:** a plain `maximize-2` icon (outward diagonal arrows) at the top right, opposite Back, with a 44-pt target.
  - **Hidden:** Back and the ورد pill. Only the page and a `minimize-2` icon (inward arrows) in the same place remain.
  - **Fitting (approved: fit the entire page):** at 1× the whole page shows, centred in the space between the Collapse row and the bottom safe area, at the largest size that fits without cropping or stretching. It is never zoomed to fill. Pinch to 3× and pan for closer reading; double-tap returns to the fitted page.
  - **Sizes:** the page is refitted down to the bottom safe area. On phones the width already limits it, so it stays the same size (iPhone 393 pt: 387 × 623), but a zoomed page can use the freed space. On tablets it grows (iPad 820 pt: 621 → 681 pt wide).
  - **Kept:** zoom, pan, double-tap, 1× swipes and ayah taps all work as usual. Switching modes first returns the zoom to 1× and keeps the page, the selected ayah and the active ورد; an open popup closes. The heads, page number and ayah popups work in both modes.
  - **Leaving full screen:**
    - The `minimize` icon at the top right stays as a permanent exit and works at any zoom.
    - A clear one-finger swipe down at 1× (at least 80 pt, mostly vertical) also exits. It is ignored when it starts within 24 pt of the top safe area (Notification Centre, the status bar) and while the Reflection sheet is open.
    - Zoomed in, a downward drag pans instead, and double-tap only resets the zoom.
    - Taps, sideways page turns and small movements never exit.
  - **Back:** Android's Back leaves full screen first; the next Back navigates as usual.
  - **Persistence:** none. The reader always opens in Normal Mode.
- **One background:** the whole reading screen, including the safe areas and the space around the page, is the page's own paper colour from the appearance preset (`#F9EFD2` Warm Cream, `#222820` Warm Midnight Olive). The page has no visible edge, and the border keeps its approved inks in both themes.
  - **The ورد pill** is a matching part of the page: solid, a shade off the paper, with a faint border and an almost invisible shadow. (These were also the retired bar's colours.)
  - **Light:** `#F3E8CB` on `#F9EFD2`, border `#E5D8B9`, dark-olive icons and pill text `#3B4630`.
  - **Dark:** `#30382F` on `#222820`, border `#434D40`, ivory icons and text `#F1E9D6`.
  - **Reflection lamp** (in the ayah popup): always lit, outlined in the panel's `saved` green (Light `#3E6B4B`, Dark `#8EA68A`) with the `#FFC000` glass.
- **Larger Quran text (candidate C, approved 2026-10-14; experiment and evidence in `design-archive/experiments/larger-text-mushaf/`, review in `docs/mushaf-larger-text-review/`):**
  - **Glyphs 5% larger** (`QURAN_TEXT_SCALE` = 1.05, `pageGeometry.ts`): the text area is 1.05 × the print's on the same page width. The extra width comes only from the plain paper margin between the frame's inner rule and the text (`textInsetX`: 16.2 → 8.4 pt on a 384-pt page). The page width, border tiles, inner edge, top and bottom margins, running heads and page number are unchanged. `QURAN_TEXT_SCALE` = 1 restores the printed proportions; the original geometry is archived in `design-archive/mushaf-page-layout-v1/`.
  - **Line spacing never tighter than the print, relative to the glyphs:** QPC pages always have at least `MIN_TILES_DOWN` (31) tiles, the first frame whose pitch is ≥ 1.05 × the printed pitch. Where the height is short (iPhone SE, small Android), the page is narrowed until that frame fits.
  - **The retired bar's 64 pt is reclaimed:** Normal Mode's page reaches down to the ورد row, 4 pt above the bottom safe area.
  - **The page selector never covers the text in Normal Mode** (as before): the text ends at least 4 pt above where its card opens (`SELECTOR_TEXT_CLEARANCE`, `PAGE_SELECTOR_CARD_HEIGHT`). Where the reclaimed height would bring it lower, the frame has a tile less, and on the shortest screens the page is a little narrower. In full screen the card opens over the last lines, as it always has.
  - **Normal Mode and full screen show the glyphs at the same size** on a device: both use Normal Mode's page width. Full screen's extra height goes only to more tiles and wider line spacing.
  - **Pages 1–2** keep their approved composition exactly: their letter size is taken on the printed text width (`openingPageSize`, `QpcV1PageText.tsx`), so it does not grow; the ornamental circle and cartouche are sized from the frame and page width as before.
  - **Glyph size against the previous layout:** +5.0% on every width-limited phone (all current iPhones but the SE, Pixel-size and 360×800 Android). Height-limited phones gain more in Normal Mode, because the reclaimed band widens their page: iPhone SE +7.3% (324-pt page, was 317), 320/360×640 Android +7.4% (274, was 268). There, full screen is smaller than the previous full screen, which was wider than Normal Mode (SE 369 pt, small Android 314–328 pt); it now matches Normal Mode.
- **Taller, in both modes (approved design; Normal Mode since candidate C):**
  - **Normal Mode** uses the tallest whole-tile frame that fits above the ورد row (31–35 tiles).
  - **Full screen** uses the tallest that fits down to the bottom safe area, at the same width: the same tiles repeated further, the lines spread evenly. The frame grows up to `TALLER_MAX_TILES_DOWN` (35).
  - **Where it applies:** all 604 pages, in every build (development, preview, production). Approved 2026-10-12; the page-61 / development-only gate (`TALLER_FULL_SCREEN_PAGES`) was removed.
  - **Cap on very tall screens:** the line spacing grows at most 25% over the printed page's (`TALLER_MAX_LINE_SPACING` = 1.25, giving 35 tiles). The approved reference, page 61 on a 393-pt iPhone, is +15%. Before the cap, a tall 412-pt Android reached 40 tiles (+42%) and showed large gaps. Height beyond the cap is plain paper around the centred page. The cap is a ratio, not a phone size, so it carries over to tablets unchanged.
  - **No layout choice:** there is no selector, measurement readout or setting in any build. The layout follows the mode and the space available.
- **Development aid:** `?source=online`, in development builds only, reads any page straight from the backend's Content Sync relay. The chunk is verified like a download and kept in memory only (`mushaf/offline/devRelayPage.ts`), so pages can be checked where the offline store doesn't exist, such as a browser.
- **How the Taller page is built** (every page, QPC renderer, both modes):
  - **What changes:** the same page with a taller frame. Whole border tiles are repeated down the sides (`computePageLayout(width, tilesDown)`, never stretched), and the 15 lines are spaced to fill it.
  - **What doesn't:** the glyphs, line breaks, word order, medallions, heads and page number. The highlight keeps the printed band height.
  - **How tall:** computed from the actual space (`fitMushafPage`). Normal Mode's room sets the page width (at least a 31-tile frame must fit); then, in each mode, the tallest whole-tile frame (31–35) that still shows the whole page. No device height or line position is hard-coded. The Quran SVG page (page 61 before its font loads) keeps the printed 29-tile frame.
  - **Line spacing:** the text area's height ÷ 15 is the pitch. Every row is exactly one pitch tall, and each glyph's full font box (`QCF_V1_LINE_BOX_EM`) is centred in its row, so baselines are exactly one pitch apart on every page. Headings and Basmalas take their own line slots in the same grid; pages 1–2 keep their own centred block.
  - **Results** (frame tiles, Normal / full screen):
    - iPhone 15/16 (393 pt) and 16 Pro: 31 / 33–34. iPhone 14 (390 pt): 32 / 34. iPhone 15/16 Plus and 16 Pro Max: 32 / 34. iPhone 13 mini: 31 / 34.
    - Android 412 dp: 35 / 35 (gesture navigation; capped), 34 / 35 (3-button). Android 360 × 800: 34 / 35.
    - iPhone SE: 31 / 34 on a 324-pt page. 320/360 × 640 Android (3-button): 31 / 35 on a 274-pt page. Tablets (where the height limits the page): 31, plus what full screen's height fits.
- **Selecting:** a tap on an ayah selects it and opens its popup (above); dismissing the popup clears the selection, and so does turning the page.
- **Active reading stop (ورد)** (`MushafWirdSelector`): a small pill, "ورد الفجر ⌄", centred in the row under the page.
  - **Space:** the page always leaves a 32-pt row free for it (`WIRD_ROW_HEIGHT`). On phones the width limits the page, so this costs nothing there; on tablets and small phones the page is slightly smaller. While zoomed the pill is hidden.
  - **The list:** tapping the pill lists every stop with its page, the active one checked. The list scrolls, stays on screen, and closes on a choice, a tap outside or Back. A last row opens the ورد name field for a new stop. With no stops, the pill itself opens that field.
  - **Switching:** choosing a stop makes it active and opens its saved page. **No stop's page changes**: a page is saved only by an explicit save (Apply on a separator, or the ورد name field), so each stop keeps its own page.
  - **Persistence:** the active stop's id is stored on the device (`quran-heals:mushaf-active-reading-stop:v1`, `readingStops.ts`). On opening without `?page=`, the reader opens the active stop's page — unless this device browsed to another page after that stop's last save: the last browsed page (`quran-heals:mushaf-last-page:v1`, `mushaf/lastBrowsedPage.ts`, device-only, never synced) then opens, so browsing survives a restart. A page the reader opens by itself is not recorded as a browse (a page the recitation turned to is, since 2026-10-25), and browsing never changes a stop's page, cycle or Khatmas. A stop saved with the name field becomes the active one, and removing the active stop clears it. The list re-reads the stops each time it opens.
  - **Progress and Khatmas (2026-10-13):** each stop's saved page is its progress, and its cycles and completed Khatmas are kept beside it (`mushaf/khatmas.ts`, `docs/khatma.md`). A save (Apply, or the name field) that takes the active ورد from an earlier page to 604 offers «ما شاء الله، أتممت ختم القرآن» (إتمام الختمة / ليس الآن); showing page 604 never does. The list's last row opens أورادي وختماتي.
- **Search** (retired with the bar; archived): page numbers are now typed in the page selector, and Surahs are searched in the Surah list, with the same matching (`mushaf/surahSearch.ts`):
  - Arabic ignores diacritics and tatweel, unifies alef and hamza forms, and treats ى as ي and ة as ه.
  - English ignores case, hyphens and apostrophes, and treats Tanzil-spelling variants as the same ("baqarah", "Imran", "Yasin").
  - Partial names match, and a Surah number matches.
  - **First pages:** generated from Tanzil's 604-page table (`tools/quran-import/generate-surah-pages.mjs` → `mushaf/generated/surahStartPages.ts`; page starts `generate-page-starts.mjs` → `generated/pageStarts.ts`). They match Quran Foundation's QCF V1 (1405 AH) pages on every page start and every Surah's first page (checked 2026-10-11 and, for all 604 page starts, 2026-10-14 in `mushafNavigation.test.ts`).
  - **Navigation only:** opening a page never touches a stop, progress or Khatma.
- **Pinch-to-zoom** (`MushafZoomView`, geometry in `mushaf/pageZoom.ts`):
  - **What scales:** the whole drawn page, as one picture, from 1× (fitted) to 3×. The QPC V1 text is never resized or reflowed: glyphs, line breaks, medallions, the border and the touch areas all scale together.
  - **Gestures:** a pinch zooms toward the fingers' midpoint. Zoomed in, one finger pans the page, which can never leave the screen. A double-tap returns to 1× and leaves the selection as it was. A pinch released near 1× snaps back.
  - **Taps and turning:** taps select the same ayah at any zoom. A new page always starts at 1×.
  - **Implementation:** React Native Gesture Handler and Reanimated, both already native dependencies, so no new build is needed. Pinch and pan run as UI-thread worklets; only page turns and the zoomed/not-zoomed state reach React.
- **Swiping:** at 1× only, one page per swipe. A finger moving **left to right** goes to the **next** page; **right to left** goes to the **previous** one. This is the same in every language and is never inverted for RTL (`mobile/src/mushaf/pageZoom.ts`, `swipeTurn`).
  - **What turns:** a mostly horizontal drag of at least 50 pt, or a quick flick of at least 30 pt released at 500 pt/s or faster.
  - **What doesn't:** taps (they keep selecting ayahs), small or slow movements, mostly vertical drags, and a touch the system cancels. A second finger cancels the swipe and starts a pinch.
  - **Zoomed:** a drag moves the page instead.
- **No swipe-back on this screen:** on iOS 26, react-native-screens makes the system back swipe work from anywhere on the screen by default. It took the page's left-to-right swipe, cancelled it and began returning to Home. Under RTL it would take right-to-left swipes. The reader's route therefore sets `gestureEnabled: false` and `fullScreenGestureEnabled: false` (`mobile/src/mushaf/screenOptions.ts`, used in `app/_layout.tsx`). The Back arrow and Android's Back still leave the reader.
- **Which pages show:** every page draws from the offline Mushaf (layout and page font). Page 61 also works online, with the Quran SVG fallback. A page that isn't downloaded offers the offline download in its place.
- **Not on this screen:** the old title, the hint, the renderer switch and the reading-stops list (with rename and remove). The stops are still saved, and `readingStops.ts` still offers rename and remove.

## Page design

- **Border:** `mobile/src/mushaf/borderPattern.ts`, drawn by `MushafBorder`. Traced from `Reference Design.jpg` by rectifying the scan's frame and averaging its 90 edge tiles.
  - 20 × 29 square tiles between the double brown rule (≈ 4 px each at the scan's scale).
  - A split brown rhombus with ochre-cream centres on every tile boundary. Four mint-edged green leaves around each rhombus, at 40°, forming an X at each tile centre. Corners have three leaves, as printed.
  - Output is one vector path per ink (six in all) in a 20 × 29 viewBox: no tile seams, sharp at any size. It is built once (about 90 KB of path data).
  - The border sits under the text and takes no touches; screen readers skip it.
- **Running heads and page number:** Amiri Bold (SIL Open Font License 1.1, `@expo-google-fonts/amiri`, one weight bundled, ~400 KB). It is loaded separately from the QPC V1 font, so if it fails only the heads fall back to the system font. Never used for Quran text.
  - The print's own calligraphic heads are artwork. Glyph fonts for surah and juz' names exist (distributed by Tarteel QUL), but they are not on Quran Foundation's documented CDN, so their licence would need checking separately before use.
- **Ayah markers:** see *Appearance presets* below. By default, the QCF V1 font's own marker glyph, tinted green: a ringed circle, not the print's medallion.

## Appearance presets (reversible)

Everything switchable is in `mobile/src/mushaf/appearance.ts`. One object picks what `/mushaf` shows.

**Approved design (phase 2A, default):** QPC V1 text, traditional medallions, Warm Cream, original ink, the phase-1C border and headings.

```ts
export const MUSHAF_APPEARANCE_APPROVED = { background: 'warm', markers: 'traditional', ink: 'original' };
export const MUSHAF_APPEARANCE_PHASE_1C = { background: 'original', markers: 'qpc-glyph', ink: 'original' };
export const MUSHAF_APPEARANCE_DEFAULT = MUSHAF_APPEARANCE_APPROVED;
```

**Dark Mode (phase 2C, Warm Midnight Olive):** the page follows the app's **Appearance** setting (System, Light, Dark; Light by default).

```ts
export const MUSHAF_APPEARANCE_DARK = { background: 'midnight', markers: 'traditional', ink: 'midnight', border: 'original' };
```

| | Light (approved) | Dark (approved) |
|---|---|---|
| Paper | `#F9EFD2` Warm Cream | `#222820` Warm Midnight Olive |
| Quran ink | `#231F20` | `#F1E9D6` (colour only; glyphs, positions and line breaks identical) |
| Heads and page number | `#2B2A26` | `#F1E9D6` |
| Selection highlight | `#5B8F6A` at 18 % | `#8EA68A` at 30 % |
| Border | the approved border | **the same border, same colours** (`border: 'original'`) |
| Medallions | traditional | traditional (dark number `#231F20` on cream) |

- **Light Mode is pixel-identical to the approved phase 1D page.**
- **Alternative border:** gold `#A99A70` and sage `#8EA68A` (`MUSHAF_BORDER_STYLES.midnight`) is a separate, reversible option, **not adopted**. Compare it in `mushaf-2c-screenshots/10-…png`; adopt it with `border: 'midnight'` in `MUSHAF_APPEARANCE_DARK`.
- **Quran SVG fallback in Dark Mode:** its ink fill is recoloured (`tintSvgInk`); every path is unchanged.
- **Preview:** `?scheme=dark` (or `light`) previews either mode without changing the setting.

How to restore an earlier design:

| To get | Do |
|---|---|
| The phase-1C page (pixel-identical: verified at 320, 390 and 820 pt and the SVG fallback) | Set `MUSHAF_APPEARANCE_DEFAULT = MUSHAF_APPEARANCE_PHASE_1C`. |
| Original Cream with the new medallions | Set it to `{ background: 'original', markers: 'traditional', ink: 'original' }`. |
| The Quran SVG renderer | Use the *Script* switch on the screen. It is also used automatically whenever QPC V1 can't be shown. |

Never edit a preset's values: a new look is a new preset.

For side-by-side previews, the route takes the same names as URL parameters, e.g. `/mushaf?background=original&markers=qpc-glyph`. Unknown values are ignored. There are no on-page controls.

Screenshots: `mushaf-1c-screenshots/` (phase 1C) and `mushaf-1d-screenshots/` (the approved comparison), next to the repository.

### Backgrounds

The page background is one opaque fill on the page view (`MushafPageView`). There is no gradient, texture, transparency or overlay; the text area and the border's interior are transparent over it.

| Preset | Constant | Paper | CIELAB |
|---|---|---|---|
| Original Cream | `MUSHAF_BACKGROUND_ORIGINAL` | `#F9F5DA` (= `REFERENCE_COLORS.paper`), opaque | L 96.2, a −3.1, b 13.5 |
| Warm Cream (approved, default) | `MUSHAF_BACKGROUND_WARM` | `#F9EFD2`, opaque | L 94.6, a −1.3, b 15.4 |

The reference scan's paper measures L 95.9 / b 14.6 inside its frame and L 94.2 / b 16.3 outside it; Warm Cream sits between the two. The border's own cream (`#FCF9E0`), the medallions and the text are the same under both. `mushafAppearance.test.ts` pins Original Cream's exact value.

### Ayah-end medallions (QPC V1 renderer)

| Preset | Look |
|---|---|
| `qpc-glyph` | The QCF V1 marker glyph tinted `#3E7D57` (phase 1C). |
| `quran-svg` | The Quran SVG page's medallion and number artwork, coloured as on that page: ornament `#3E7D57`, number `#231F20`. |
| `traditional` (approved, default) | The same artwork in the print's colours. Caps (top and bottom): outline `#3F3723`, fill `#857850`. Sides: outline `#4E8160`, mint crescents `#9EC498`. Centre: `#FBF7E4`. Number: `#231F20`. Flat bands, no gradients. |

How a medallion replaces the glyph without touching Quran text:

1. `tools/mushaf/extract-ayah-markers.mjs` copies the ornament path and each ayah's number path **verbatim** from the bundled, hash-pinned Quran SVG page, with their original transforms. It writes `mobile/src/mushaf/generated/ayahMarkers061.ts`.
   - Each marker is assigned to the ayah whose clickable polygon contains it. The script fails unless there is exactly one per ayah, in reading order.
2. In `QpcV1PageText`, the marker glyph stays in its line, unchanged: same character, font and size. So word positions, justification and taps are still the font's. It is only painted `transparent`.
3. `AyahMarkerOrnament` draws that ayah's medallion over the glyph's ink box:
   - Centred on the ink, which is known from the font: `QCF_V1_METRICS` in `mushaf/ayahMarkers.ts`.
   - 1.1 × the ink's height, which is 0.82 of the line pitch, like the print.
   - Inside the glyph's advance, so it never reaches neighbouring words.
   - It takes no touches; a tap on it selects its ayah through the line, as before.
4. Baseline: iOS and Android report it with `onTextLayout`. The web uses the CSS rule; Chrome measured 19 px for the computed 19.25.
5. An ayah without artwork keeps its glyph. Only page 61 has artwork so far.

The artwork is the King Fahd Complex's: the same artwork the app already bundles and credits as its Quran SVG page.

### Pages 1–2, Surah headings and the Basmala (2026-10-12)

- **Pages 1–2** (Al-Fātiḥah and the start of Al-Baqarah):
  - Text uses the regular pages' letter size (0.0692 of the text width, the median over pages 3–604). It used to be fitted to their short lines, making it 1.5× too large.
  - Each line is centred, with the regular gap between words.
  - The block of heading, Basmala and lines is centred on the page, instead of sitting low in Quran Foundation's 15-line grid (page 1 is on lines 9–15, page 2 on 10–15).
- **Surah openings** (`mushaf/surahOpenings.ts`) are read from the layout's empty lines, as in the print:
  - Mid-page: the heading, then the Basmala.
  - One empty line at the top of a page: the Basmala, with the heading on the page before.
  - Empty lines at the end of a page: the next Surah's heading and Basmala.
  - Surah 9 has a heading only; Surah 1 has a heading only, because its Basmala is ayah 1.
  - Checked on all 604 pages (`tests/mushafAllPages.test.ts`, `tools/mushaf-audit/audit-surah-openings.mts`): 114 headings and 112 Basmalas, every empty line accounted for, and 21 openings split across two pages.
- **The Basmala** is drawn in QPC V1's own glyphs: the four words of 1:1 from page 1's font (U+FB51–FB54), centred. Without that font the line stays empty, never drawn in another font.
- **The heading** is the Surah's name in the running heads' font, centred in its existing empty line. An original Quran Heals vector ornament is drawn behind it, entirely inside that line; it does not move the heading, Quran text, Basmala, or page geometry. The SVG uses newly authored paths, not copied page artwork.
- **Tanzil check, fixed for every Surah opening:** the reader's per-page check (`checkAgainstTanzil`) now counts words with the offline validator's rule (`mushafWordCount`).
  - Tanzil opens ayah 1 of 112 Surahs with the Basmala, and a few word pairs are a single word in the Mushaf.
  - The old raw count refused all 99 pages holding a Surah opening, which on devices showed "This page can't be shown".
  - All 604 pages now pass.

### Original Surah heading ornament and outstanding page illumination

Decision (2026-10-12): add one original, reusable Surah heading ornament while retaining the approved name font, 4 pt text positioning, authentic QPC V1 Basmala and existing pages 1–2 layout. The frame sits in the existing empty heading line, takes no layout space, has no pointer events, and uses the configured Mushaf ink colour.

#### Artwork and font provenance/licensing

| Source | What it is | Finding |
|---|---|---|
| QUL Surah Header font ([458](https://qul.tarteel.ai/resources/font/458), `QCF_SurahHeader_COLOR`) | Frame and name, as a font | **Rejected.** The frame is "design elements by pikisuperstar on Freepik" (stock art), only 21 Surahs are included, and it's a third-party modification of a King Fahd Complex font: "printing and publishing not permitted without prior permission" from the Complex and Dar Almarifa. |
| QUL Surah Name font V1 ([456](https://qul.tarteel.ai/resources/font/456)) | 1405H-style names, all 114, no frame | **Unverified.** No author, source or licence in the file ("Font generated by IcoMoon"), and none on the page. |
| [quran-ws/quran-svg](https://github.com/quran-ws/quran-svg), pinned v1.1.1 (`3ff27b46cecb0c0519d77531d9c868a579d1f623`), `hafs-kfqc` / `1441-AI-hafs.zip` | 1441H King Fahd Complex page masters, including calligraphic Surah names | **Not used.** The repository's [licence](https://github.com/quran-ws/quran-svg/blob/3ff27b46cecb0c0519d77531d9c868a579d1f623/LICENSE) and [notice](https://github.com/quran-ws/quran-svg/blob/3ff27b46cecb0c0519d77531d9c868a579d1f623/NOTICE.md) distinguish Quran.ws-authored metadata/tools from publisher-owned page artwork. The notice quotes general Complex permission for software and digital publishing, but does not explicitly resolve extracting, isolating, modifying and redistributing calligraphy as a separate asset. Quran.ws licensing notes scan-derived header permissions are still being settled with publishers; those scans are a separate lineage from the 1441H page masters. The Complex licensing page could not be independently fetched from the development environment, so derivative-calligraphy rights remain unverified. No page artwork or isolated calligraphy was copied. |
| [Amiri](https://github.com/aliftype/amiri), distributed by `@expo-google-fonts/amiri@0.4.1` | Existing Amiri Bold font (`Amiri_700Bold.ttf`) used for running heads and Surah names | **Permitted for commercial app bundling under SIL OFL 1.1.** The package's `LICENSE_FONT` expressly allows the font to be embedded, redistributed and sold with software, but not sold by itself; each copy must contain the copyright notice and full licence, and the font remains under the OFL. The byte-identical package licence is bundled at `mobile/assets/licenses/OFL-Amiri.txt` and referenced by the app asset manifest; the in-app Credits page identifies the authors and links to the project and licence. |
| Quran Heals Surah ornament | One reusable vector frame | **Original.** Newly authored SVG path and circle geometry in `mobile/src/components/SurahHeaderOrnament.tsx`; paired side flourishes are mirrored in code. No external artwork or font outlines are used. Amiri renders the existing metadata-sourced Surah names; it is not used for Quran text. |
| King Fahd Complex developer page (`qurancomplex.gov.sa/en/techquran/dev/`) | — | Unreachable from the development network (connection refused). To be checked from a network that can reach it. |
| Quran Foundation documentation | — | Documents no heading or illumination asset for any edition. |
| Rechecked 2026-10-12: King Fahd Complex `qurancomplex.gov.sa`, `nashr.qurancomplex.gov.sa` (publishing fonts), `dm.qurancomplex.gov.sa`, `fonts.qurancomplex.gov.sa` | — | All time out from the development network (they appear geo-blocked). Still to be fetched from a network that can reach them. |
| Rechecked 2026-10-12: Quran Foundation font CDN | `QCF_BSML` or a Surah-header font for V1 | None: every candidate path is a 404. The font guide lists page fonts only. |
| Quran Foundation "Mushaf images" (Mushaf IDs 10–12) | Per-verse Tajweed images | Not page artwork and not 1405H: no frames or illumination. |
| MushafDatabase SVG (`mushafdatabase/MushafDatabase-Ligature-Based-SVG`) | Page SVGs from the Complex's digital-Mushaf portal | The print year isn't stated (the portal publishes the 1441H masters); Surah names in the header area, no frame, no page 1–2 illumination. |

The calligraphy and decoration on the 1441H page masters are not needed for this implementation. The 1405H publisher artwork remains unused. Pages 1–2 illumination is a separate future enhancement and requires its own rights-cleared source.

### Uniform 4 pt lift of the Quran text, Normal and Full-Screen (2026-10-12; temporary, awaiting iPhone confirmation)

- **Background:** the iPhone draws each QPC V1 glyph's baseline about 0.376 em (≈8.4 pt) below the layout's (screenshots of pages 5, 61, 466).
  - A device-measured correction (an `onTextLayout` probe) had no effect on the iPhone. The screenshots moved only by the removal of the per-page centring and the 1 pt lift. It has been **removed**, so it cannot stack with this lift.
  - The medallions are placed from the marker's iOS `onTextLayout` baseline. On page 61 they sit ≈0.26 em above the drawn word baseline, so that report is not the drawn baseline either (or never arrives). The root cause is still open.
- **Change:** `MUSHAF_TEXT_LIFT_PT = 4` (`pageGeometry.ts`), applied once in `MushafPageView`: the whole text area is drawn 4 pt above the printed layout's, on every page, in Normal and Full-Screen.
  - Everything belonging to the Quran text is inside that area and moves with it: lines, Surah headings, Basmala, medallions, highlights, line tap targets, and pages 1–2 with their own composition.
  - Unchanged: frame, page size, letter size, line and word spacing, and Full-Screen's frame and scaling. To revert, set the constant to 0.
- **Vertical offsets in effect:** only this lift.
  - Removed: the per-page centring (`normalTextShift`), the 1 pt lift (`NORMAL_TEXT_LIFT_PT`) and the device baseline correction.
  - Unchanged from before: medallions placed from the marker's reported baseline (`reportedBaseline`, web: `cssBaseline`); the glyph boxes' vertical ink room.
- **Audit** (`tools/mushaf-audit/audit_vertical_position.py`, report `vertical-position.report.json`): all 604 pages, 77,433 glyphs (every letter and mark), medallions, headings and Basmala. It covers page widths 268–681 pt and Normal plus every Full-Screen frame (29–35 tiles), at two glyph placements: intended (web, and the model for Android) and the iPhone's measured placement.
  - Clipping: none, in either mode or placement.
  - iPhone placement: nothing reaches the top. At the bottom, 7 pages still reach the frame's inner edge on a 396-pt page: 142, 202, 381, 459, 553, 556 and 560 (worst −1.22 pt, page 560). There are 11 on a 434-pt page, 1 (560) on an iPhone SE.
  - iPhone 16 Pro (396 pt), above / below: page 5 14.19 / 0.05; page 13 13.69 / 2.18; page 61 12.76 / 4.06; page 466 13.94 / 2.26.
  - Intended placement: clear from a 354-pt page up. On an iPhone SE page (317 pt), pages 44, 49, 236 and 307 reach the top edge by up to 0.23 pt; on a 268-pt Android page, 37 pages by up to 0.81 pt.
- **Update 2026-10-15 — proportional lift on iOS and Android (approved):** the fixed 4 pt left the last line's descenders across the frame's inner rule on 8 pages of current iPhones in Normal Mode (worst page 560, −1.37 pt on a 16 Pro) and on 36 pages of an Android tablet, because the iPhone's drop (0.376 em, Android's rows follow it) grows with the letter size. `mushafTextLift(textWidth, os)` (`pageGeometry.ts`) now gives `NATIVE_TEXT_LIFT_EM` (0.26) × the nominal letter size (`NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH` × the text width) on iOS and Android, and keeps `MUSHAF_TEXT_LIFT_PT` (4 pt) on the web. Every place that needs the frame's edge in text-area coordinates uses it (MushafPageView, pages 1–2's centring, Surah heading placement). The page fitter keeps choosing the frame on the 4 pt basis, so page widths and tile counts are exactly as approved. Result (`docs/mushaf-verification/2026-10-15-post-fix-verification.md`): 0 crossings on iOS and Android at every width and frame height; `vertical-position.report.json` above describes the earlier layout and is kept as evidence only (no longer pinned by a test).
- **Browser note:** headless Chrome on Windows draws every line 0.71 pt higher than the layout.

### Ayah selection follows the drawn words (2026-10-12; awaiting iPhone confirmation)

- **Root cause:**
  - **Vertical (iPhone):** the highlight band (92 % of the printed line pitch) was centred on its line's row, where the layout puts the line. iOS draws QPC V1 glyphs 0.376 em (≈8.5 pt) lower in that row, so the band sat high: over the line above's descenders, with the selected words' lower half outside it. Taps used the rows too, so a tap low on a word could land on the next line.
  - **Horizontal (all platforms):** the band ran exactly from the first to the last word's advance box. QPC V1 glyphs draw ink outside their advance (at line starts up to 0.44 em, 99th percentile), so letters and marks at the band's ends stuck out. It also stopped exactly at a medallion's advance, narrower than the medallion.
- **Fix** (`QpcV1PageText`, `qpcV1Layout.ts` `selectionSpan`, `lineAtY`, `qpcV1Selection.ts`, `ayahMarkers.ts` `qcfV1DrawnLineShiftEm`). One geometry for the highlight and the taps: the words as drawn.
  - **Vertically:** the band and the tap lines are centred on the drawn line, the row centre plus `qcfV1DrawnLineShiftEm(page, platform)` × font size.
    - iOS: from the font's own metrics, the rule TextKit follows (OS/2 line at the bottom of the box): 770 units for 603 fonts, the value measured on the iPhone. Page 237's comes from its own metrics and is not measured.
    - Elsewhere: 0.
  - **Horizontally:** the rendered word boxes plus each end word's real ink (`generated/qpcV1SelectionInk.ts`, from `tools/mushaf-audit/generate_selection_ink.py`; 8,836 words where a selection can end) or its medallion's box.
    - Each end reaches halfway into the gap to a neighbouring ayah's word (never into that word's box). At a line's edge it reaches half the line's word gap, at most into the text area's margin.
  - **Taps:** a tap selects the line drawn nearest to it (`lineAtY`), then the ayah at that point (unchanged).
  - **Unchanged:** the text, its 4 pt lift, the frame, sizes, spacing, headings, Basmala and medallion positions.
- **Audit** (`mobile/tests/mushafSelectionAudit.test.ts`): the real component, given the word positions the platform lays out, and every ayah selected.
  - All 604 pages (`QPC_V1_ADVANCES` from `tools/mushaf-audit/export_word_advances.py`): 6,236 ayahs × Normal/Full-Screen × iOS/intended placement = 24,944 selections, 55,064 highlighted lines and 991,410 taps (each word: centre, near the band's top and bottom). **0 failures.**
  - 186 line ends where the end word's ink reaches further than the highlight may go: 182 are an ayah's first word whose ink reaches back over the previous ayah's medallion (as printed), 4 are line-edge ink past the text margin. The highlight stops at the neighbour or the margin, by design.
  - A committed fixture (pages 1, 2, 5, 50, 61, 237, 466) runs always, at 317, 396 and 434-pt pages.

### Android: unclipped Quran glyphs (2026-10-12; native verification pending)

- **Cause:** React Native 0.86 draws `<Text>` on Android with `ReactTextView` (`enablePreparedTextLayout` is off by default). Its `onDraw` calls `TextView.onDraw`, which clips horizontally to the content box (AOSP `TextView.java`, `onDraw`: `clipLeft = compoundPaddingLeft`, `clipRight = width − compoundPaddingRight`; top and bottom are unclipped when not scrolled). So the iOS ink room (horizontal padding) drew nothing on Android.
- **Fix, Android only** (`QpcV1PageText` `androidInk`):
  - Each drawn word's in-flow Text stays as on iOS (advance, line box, layout, taps) but transparent.
  - A copy draws the glyph from a content box spanning the advance ± `QCF_V1_INK_OVERFLOW_EM`, with no horizontal padding, centred (the same place), and the same vertical room.
  - The copy is not touchable and not read by screen readers. The hidden ayah-end glyphs (under their medallions) have no copy. Basmala glyphs work the same way.
  - iOS is unchanged.
- **Verified in tests:** `tests/qpcV1Android.test.ts`, all 604 pages (local snapshot), every one of the 77,429 Quran words plus the Basmala.
- **Still to do:** **not yet run on an Android emulator or device.**

### Android: exhaustive rendering audit and the iPhone baseline (2026-10-12; native verification pending)

- **Rendering path (verified from the React Native 0.86 sources in `node_modules`):**
  - `ReactTextView` (`AppCompatTextView`) draws through Android's `TextView`, because `enablePreparedTextLayout` is off by default. Gravity defaults to `TOP|START`; `textAlign: 'center'` maps to `CENTER_HORIZONTAL`. `ReactTextView` itself clips to its padding box only when `overflow` is not visible.
  - Parents don't clip (`ReactViewGroup.initView`: `clipChildren = false`). The zoom viewport clips only at the page's outer edge.
  - Line height: `CustomLineHeightSpan` rounds it up (`ceil`) and puts half the leading above the font's ascent and half below (CSS). With `includeFontPadding: false`, the first line starts at the content top.
  - Measured width: right-to-left text is never a `BoringLayout`, so the in-flow word is `ceil(advance px)` wide.
  - Not in the repo (AOSP / Skia, from their published sources):
    - `TextView.onDraw` clips horizontally to the compound padding, and vertically to the view when not scrolled.
    - Skia uses the OS/2 typo metrics when `USE_TYPO_METRICS` is set (pages 1 and 565), hhea otherwise.
    - `getFontMetricsInt` rounds the metrics to pixels; the audit tries every rounding direction.
- **The dual-layer method is kept; there is no second mechanism.** The transparent in-flow word keeps the layout, its taps and its box. The copy has the same font, size and line box, and the same content top, so the same baseline. It is centred in the advance ± 2.4 em, which differs from the in-flow run by at most half a pixel. QPC V1 glyphs carry their own tashkeel, so marks can't drift from their letters.
- **Glyph order (audit correction):** QPC V1 codes are Arabic presentation forms (bidi AL). A word of several glyphs (4,579, mostly a word plus its waqf sign) is drawn right to left, confirmed on the iPhone screenshots: the waqf sign sits at the word's left.
  - The earlier tools (`audit_ink_overflow.py`, `verify_words.py`) compose them left to right. Their horizontal per-word figures for those words are mirrored. The neighboring-line collision audit now reverses the presentation forms for its raster check.
  - The Android audit and `generate_selection_ink.py` (regenerated: 8,836 words) use the drawn order. The worst overflow becomes 2.155 em (page 11, 2:70, a waqf sign): still within the 2.4 em room, on iPhone too.
- **Change (Android only): the Quran lines where the approved iPhone draws them** (`ANDROID_MATCHES_IPHONE_BASELINE`, `qcfV1AndroidRowShiftEm`).
  - Android draws the glyphs where the layout means them, 0.376 em above the iPhone. With the approved 4 pt lift (set for the iPhone), Android text sat about 4.5 pt higher than on the iPhone, and on small screens page 307 and others crossed the top rule (up to 1.7 pt).
  - The Quran and Basmala rows now move down by the iPhone's amount, from each font's metrics (770 units; page 237 1051.5). Medallions, highlights and taps are in those rows. Headings keep theirs. iOS and the web are unchanged.
- **Audit** (`tools/mushaf-audit/audit_android_rendering.py`, report `android-rendering.report.json`, checked by `mobile/tests/androidRenderingAudit.test.ts`). The matrix is 104 configurations from the app's `fitMushafPage`:
  - 320×640, 360×780, 384×854, 393×852, 412×915 and 432×960 dp;
  - status bar 24 dp, cutouts 36 / 52 dp; gesture or three-button navigation;
  - densities 1.5–3.5×, including 2.625 and 2.8125×;
  - Normal (pages 251–426 dp) and Full-Screen (29–35 tiles).
  - **Drawable room:** every one of the 77,429 word occurrences (88,444 glyphs) and the Basmala, in all four directions, allowing 1.5 px of snapping. No ink is clipped. Minimum room:

    | Direction | Minimum room | Where |
    |---|---|---|
    | Left | 3.69 px | p11 2:70, 251-dp page at 1.5× |
    | Right | 6.92 px | |
    | Top | 10.6 px | |
    | Bottom | 10.9 px | |
  - **Frame:**
    - Nothing reaches the top. The right edge is clear.
    - Page 556's left edge remains geometrically clear by about 0.31 pt in the closest matrix case (251 dp page width at 1.5×). The conservative result is −0.53 px after the one-pixel rounding guard, so this is a pixel-rounding risk, not a modeled glyph-border overlap.
    - Across the 104 configurations, 436 page/configuration bottom checks fall inside the one-pixel rounding guard. Of those, 222 have a negative geometric clearance in the font-outline model; the other 214 are near-border/rounding risks. This is the same iPhone-matched baseline geometry, not a native Android observation:

      | Page | Minimum geometric bottom clearance | Configurations inside 1 px / geometric overlap |
      |---|---:|---:|
      | 5 | −0.26 pt | 35 / 16 |
      | 26 | −0.12 pt | 32 / 8 |
      | 65 | +0.18 pt | 12 / 0 |
      | 142 | −0.43 pt | 42 / 22 |
      | 202 | −0.43 pt | 42 / 22 |
      | 381 | −0.54 pt | 42 / 32 |
      | 459 | −0.70 pt | 45 / 32 |
      | 467 | −0.06 pt | 23 / 8 |
      | 550 | +0.06 pt | 16 / 0 |
      | 553 | −1.05 pt | 47 / 44 |
      | 556 | −0.54 pt | 42 / 32 |
      | 560 | −1.62 pt | 54 / 46 |

      The worst case is page 560 on a 426 dp page at 3.333× in Normal Mode. Page 65 and page 550 are not geometric overlaps; their closest clearances are below one device pixel. The other negative values describe intersections predicted by the measured glyph outlines, not proof of visible contact on a device.
    - The iPhone-position audit flags the same bottom pages at corresponding widths (for example, pages 142, 202, 381, 459, 553, 556 and 560 at 396 pt). Pages 5, 26, 65, 467 and 550 enter the contact set at wider page widths. No Android-only upward offset was added: that would move text away from the approved iPhone baseline. Native screenshots must settle whether the modeled intersections are visible.
  - **Neighboring word ink:** the RTL outline audit uses the app's word order and opening-page sizing, ignores hidden ayah-end glyph ink, and checks every Full-Screen tile count from 29 through 35. Traditional (29 tiles) has 270 conservative word-envelope candidates and three outline intersections (pages 98, 213 and 341); at the font-outline raster's 2048-pixel-per-em scale they cover 11, 1 and 41 pixels respectively. Tile counts 30–31 have 71 and 15 envelope candidates but no outline intersections; 32–35 have none. These subpixel-area contour contacts still need native visual confirmation; line spacing was not changed.
  - **Selection** (`mushafSelectionAudit.test.ts`, Android added): 37,416 selections, 82,596 lines, 1,493,400 taps over iOS, Android and the web: 0 failures.
- **Border contacts, investigated (2026-10-12).** Exact geometry, no rounding allowance.
  - Every bottom contact is the descender of a letter body on line 15, never a medallion or a mark.
  - The contacts grow with the screen. The 4 pt lift is a fixed distance, while the iPhone's drop (0.376 em) grows with the letter size: at 251 dp every page clears; at 426 dp page 560 reaches 1.62 pt into the inner rule.
  - Android and iPhone are identical here (`ANDROID_MATCHES_IPHONE_BASELINE`), so these are the approved iPhone geometry, not an Android defect.
  - Gap to the inner rule (pt; negative = the descender crosses into the rule), on a 251 / 354 / 387 / 426-dp page:

    | Page | 251 dp | 354 dp | 387 dp | 426 dp |
    |---|---|---|---|---|
    | 5 | 1.49 | 0.46 | 0.14 | −0.25 |
    | 26 | 1.57 | 0.58 | 0.26 | −0.12 |
    | 65 | 1.75 | 0.83 | 0.53 | 0.18 |
    | 142 | 1.39 | 0.32 | −0.02 | −0.43 |
    | 202 | 1.39 | 0.32 | −0.03 | −0.43 |
    | 381 | 1.33 | 0.23 | −0.12 | −0.54 |
    | 459 | 1.23 | 0.10 | −0.26 | −0.69 |
    | 467 | 1.61 | 0.63 | 0.31 | −0.06 |
    | 550 | 1.68 | 0.73 | 0.42 | 0.06 |
    | 553 | 1.02 | −0.20 | −0.59 | −1.05 |
    | 556 | 1.32 | 0.22 | −0.13 | −0.54 |
    | 560 | 0.69 | −0.67 | −1.10 | −1.62 |

  - Within ±1 device pixel these are near-border positions, a rounding risk only: 5, 26, 65, 142, 202, 467, 550, and 381/556 below about 400 dp. Beyond a pixel the descender overlaps the rule: 553 and 560 from 354 dp, 459, and 381/556 at 426 dp.
  - **Page 556, left edge:** a small mark above line 3's last word (64:2) sits 0.714 em past its advance, as printed. It clears the inner rule by 0.31–0.53 pt (proportional to the page), the same on iPhone: near-border, a rounding risk at 1.5× only.
  - **Not changed.** Clearing every bottom contact on Android would take an Android-only lift of about 1.6 pt at 426 dp. That moves Android away from the approved iPhone position, the opposite of `ANDROID_MATCHES_IPHONE_BASELINE`. It is left for the side-by-side native comparison.
- **Neighbouring words:** 483 adjacent pairs have touching ink (388 of them a medallion, drawn at 1.1× its ring, against a word). That is the printed composition, the same on both platforms; the copies add no overlap of their own.
- **Medallions (difference from the iPhone):** Android places each medallion at the baseline it reports, which is the drawn baseline, so exactly over the font's own ring. On the iPhone the reported baseline is not the drawn one: two clean measurements put the medallion 400–500 units (0.2–0.25 em) higher than the ring. Android is not made to copy that; compare on a device (R27).
- **Not verified:** native Android rendering. That covers the real Skia metrics and rounding, `TextView`'s clip, the copy's exact pixel position, fonts loading, the row shift and whether the modeled frame and line contacts are visible on a device. It needs an emulator or a phone (checklist R27–R29).

### Hizb and quarter-Hizb labels in the header (2026-10-12)

- **What:** on a page where a Hizb, or its quarter, half or three quarters, starts, the header shows the label between the Surah and the juz', centred and a little smaller (0.85), on their baseline. Examples: الحزب الثاني, ربع الحزب الأول, نصف الحزب الأول, ثلاثة أرباع الحزب الأول. Shown in Normal Mode only; other pages and Full-Screen are unchanged. It is a marker of the start, not a running indicator.
- **Quarter 106 (15:49):** confirmed by a second King Fahd source, the Complex's own page artwork of the later 1441 AH print (quran-svg, page 264), where the ۞ also stands at the start of 15:49.
- **Data:** `mobile/src/mushaf/generated/hizbQuarters.ts`, built by `tools/quran-import/generate-hizb-quarters.mjs` (`--verify` / `--generate`) from the pinned Tanzil `quran-data.xml`: `<hizbs>` for the 240 starts, `<pages>` for their pages.
  - **One documented correction:** quarter 106 starts at 15:49, not Tanzil's 15:50. The ۞ is printed on 15:49's first word «نَبِّئْ» (QCF V1 page 264), and Quran Foundation's verse metadata agrees.
- **Verified:**
  - All 240 starts match Quran Foundation's `rub_el_hizb_number` metadata.
  - Every start that does not open a Surah carries the ۞ on its first word in the QCF V1 glyphs (checked visually; starts that open a Surah have its heading instead, as printed).
  - Every page matches the QCF V1 page of the start ayah's first word.
  - Each of the 240 pages holds exactly one start, so 364 pages have no label.
  - The table: `mushaf-hizb-labels-screenshots/verification-240-quarters.md`.
- **Layout:** in the browser at iPhone SE width, the longest labels keep at least 53 pt clear of the Surah and juz' on all 240 pages. The label is one line (`adjustsFontSizeToFit` as a native safeguard).

### Glyph boxes and line spacing (the clipped-marks fix, 2026-10-12)

- **Box:** every QPC V1 glyph is drawn in a Text box exactly the font's whole line tall (`QCF_V1_LINE_BOX_EM`, 1.914 em: ascent 2541 + descent 1378 of 2048 units), centred in its line's row.
- **Why:** iOS and Android draw a Text only inside its bounds. The former 1.3 em box cut off ink above and below it: the tops of harakat stacked on a hamza or shadda, and letter tails and kasra below the line.
  - That was 19,977 of 88,444 glyphs, on all 604 pages, by up to 0.31 em.
  - The web lets text overflow, so browser screenshots never showed it.
- **Audit:** all 604 fonts (`tools/mushaf-audit/`) show every glyph inside its font's ascent and descent, so the box contains every mark.
- **Nothing moves:** a centred box keeps the baseline at (ascent − descent) ÷ 2 below the row's centre. The box overlaps the neighbouring rows invisibly; it takes no touches.
- **Line spacing:** baselines are exactly one pitch apart (text-area height ÷ 15) on every line, measured by baseline (in the app: 33.953–33.969 px for a 33.96 px pitch). Each line keeps the slot of its line number, so Surah-heading and Basmala lines keep their space. Mobile-Optimized spreads its extra height evenly by enlarging the pitch.
- **Still open, separate from this fix:**
  - Pages 1–2 are fitted larger than in print (their short lines fill the text width).
  - Mid-page Surah heading and Basmala artwork isn't drawn yet; the slots are left empty.

### Quran ink

`MUSHAF_INKS.original` (`#231F20`) is the only ink. Measured against the scan at the same scale:
- The darkest text pixels match (11.0 vs 11.7 of 255).
- The print covers about 5% more area with ink once its filled medallions are excluded (12.0% vs 10.6% before excluding them).

That extra weight comes from ink spread in printing and the scan's softness, not from a lighter ink. A darker colour would not thicken the strokes, and the glyphs themselves are never emboldened, stroked or layered.
- **Taps on the web:** Pressable's `onPress` gets the DOM click there, with `offsetX/Y` rather than `locationX/Y`; `mushaf/pressLocation.ts` reads either.

## Authorization and terms

- **Fonts** ([Mushaf fonts and images](https://api-docs.quran.foundation/legal/mushaf-fonts-and-images/)): caching or bundling is allowed while the developer maintains an active Developer Console account, with visible credit to Quran Foundation. Fonts may be distributed only inside the app.
  - The account is active (Quran Heals, server client, content scope).
  - Quran Foundation and the King Fahd Complex are credited at the bottom of Home and on `/credits` (Quran Sources & Credits). Quran Foundation's terms ask for credit "in a reasonably accessible place in the Application or its associated credits".
  - Tanzil (Quran text) asks that "its source (Tanzil Project) is clearly indicated, and a link is made to tanzil.net". It is named on Home, and `/credits` links to tanzil.net and its licence. Each ayah card also still shows "Quran text: Tanzil · Uthmani 1.1".
- **Layout data** ([developer terms](https://api-docs.quran.foundation/legal/developer-terms/)): this is Quran Foundation content.
  - It may not be stored longer than one week unless obtained through Content Sync, and Content Sync does not cover verse or word layout (only translations, tafsirs, recitations and articles).
  - So the backend caches a page in memory for 24 hours, and the app keeps its copy until the server's `keepUntil` (≤ 7 days), then deletes it. Nothing is written to MongoDB, and no QF data is committed to this repository; tests use synthetic layouts.
- **King Fahd Complex:** the font's copyright is the Complex's ("All rights reserved"). Quran Foundation's terms don't address it.
  - The Complex's published digital-copy terms allow use in apps and software, but that statement is attached to its 1441 AH digital copy.
  - Written confirmation for the QCF V1 fonts is **still outstanding** and recommended before a public release.

## Configuring the backend (local development only)

Add the Quran Foundation **server** credentials to `backend/.env`, which is gitignored:

```text
QF_ENV=prelive            # or production — never mix the two sets
QF_CLIENT_ID=<from the Quran Foundation Developer Console>
QF_CLIENT_SECRET=<from the Quran Foundation Developer Console>
```

Then run `npm run dev` in `backend/`, open `/mushaf` in a development build pointing at that backend, and run:

```sh
node tools/mushaf/verify-qpc-v1-page.mjs http://localhost:4000
```

It reports PASS or each difference against the 15 reference line breaks, the 8 marker lines, and Tanzil word counts. It stores nothing.

Rules for these credentials:

- The secret stays on the backend: never in `mobile/`, `EXPO_PUBLIC_*`, logs or tests.
- Render's production environment is not changed in this phase.
- Without credentials, the endpoint answers 503 and the app shows the SVG page.

## Troubleshooting a 503

The app always gets the same generic 503. The backend logs the reason on one line, without credentials, tokens, query strings or response bodies:

```text
QPC V1 layout for page 61 unavailable: category=<…> stage=<token|content> env=<prelive|production> status=<HTTP> path=<…>
```

| category | Meaning |
|---|---|
| `not_configured` | No `QF_CLIENT_ID`/`QF_CLIENT_SECRET`. |
| `auth` | Token refused (`stage=token`), or content refused even with a fresh token. Check that the credentials belong to `QF_ENV`; pre-live and production clients differ. |
| `upstream` | Quran Foundation answered with an error (`status`). |
| `network` / `timeout` | No answer (`code` = system error such as `ENOTFOUND`). |
| `malformed` | An answer we couldn't use. |
| `validation` | The layout failed our checks; nothing is shown rather than a doubtful page. |

**Known issue (observed 2026-10-11): Pre-live returns 404 for this route.**

- The current Pre-live credentials get a valid `content` token. Pre-live answers routes **without** a path parameter: `/content/api/v4/chapters`, `/juzs`, `/resources/languages` and `/verses/random` all return 200.
- It answers **every** route with a path parameter with 404 "The requested resource could not be found". That includes `/chapters/3`, `/verses/by_key/3:84` and the documented `/verses/by_page/61`, with or without query parameters.
- The request matches the [Page Layout guide](https://api-docs.quran.foundation/docs/tutorials/fonts/page-layout/): mushaf 2 = QCF V1, `words=true`, `code_v1`, `line_number`.
- These credentials are Pre-live only (the production token endpoint answers `invalid_client`).
- `/quran/verses/code_v1?page_number=61` works on Pre-live but has no line numbers, so the page's line layout can't be built from it without guessing.
- To proceed: use production credentials locally (`QF_ENV=production`), or ask Quran Foundation about the Pre-live 404s.

## Storage and the full reader (later)

- **Superseded (2026-10-12):** the released app will include all 604 pages and fonts. See `docs/mushaf-bundling.md` for the measured sizes, the packaging approach and the terms to settle first. Until that phase, pages are downloaded and cached as below.
- About 157 KB per page as TTF, 94.9 MB for 604 pages (54 MB compressed).
- Layout per page: a few KB, re-fetched at least weekly under Quran Foundation's terms.
- Keep page assets separate from the Quran SQLite database.

### Surah headings: Option A ornament, full width, following the drawn lines (2026-10-12; awaiting approval)

- **Ornament** (`SurahHeaderOrnament.tsx`): an original vector drawing, laid out for its box rather than scaled from a fixed picture. Gold-framed cartouche, emerald end panels with gold arabesque, gold stems with floral medallions.
  - It spans 96 % of the frame's inner width and the heading row's full height.
  - The central panel has no fill: the page's own paper shows behind the name, in Light and Dark.
  - Every name's ink clears it (`surahHeaderOrnament.test.ts`, all 114 headings).
- **Position** (`mushaf/surahHeadingPlacement.ts`, `placeSurahHeading`): each heading (ornament and name together) starts at the approved place.
  - That place is moved down with the Quran lines as the platform draws them (iOS 0.376 em; Android the same; the web 0), plus 4.5 % of the row (`surahHeadingShift`).
  - It is then kept 0.5 pt (`HEADING_INK_CLEARANCE_PT`) clear of the real ink next to it, placed as each platform draws it. That ink is the lowest ink of the line above, and the Basmala below (or, for Surahs 1 and 9, the Quran line below). The frame's inner edge also counts.
  - The neighbouring ink comes from `generated/surahHeadingNeighbours.ts` (`tools/mushaf-audit/generate_heading_neighbours.py`; `--check` verifies it against the page fonts and layout).
  - A heading moves from its approved place only when that place is not clear. One with less than 1 pt of room is centred in it: only page 506 (Surah 47) on a 434-pt page, 0.48 pt each side (approved exception).
  - iOS draws ayah medallions from the baseline it reports, 399–500 units above the drawn one (measured). For a Quran line below a heading, its medallions are taken 500 units higher on iOS (pages 1 and 187).
  - Before this, on the iPhone the ornament covered the descenders and medallions of the line above, on all 79 headings with a line above (page 293, ayah 111).
- **Checks** (`surahHeadingClearance.test.ts`): all 114 headings × 21 page sizes and frames (Normal 251–434 pt, Full-Screen 29–35 tiles) × iOS, Android and the web.
  - Each check uses the real neighbouring ink, computed independently from the fixture, against the frame's inner edge too.
  - Result: 0.5 pt or more everywhere, except page 506 at 434 pt (0.479 pt each side). Every heading stays inside the frame's inner edge.
  - `mushafAllPages.test.ts` now tells the two boundaries apart. Quran and Basmala rows stay exactly on their grid rows inside the text area. Headings sit where the placement puts them, and may reach past the text area but stay 0.5 pt inside the frame's inner edge.

### Pages 1–2: the ornamental circle (2026-10-12; awaiting visual approval)

- **Design** (`OpeningPageOrnament.tsx`, in `MushafPageView` when pages 1–2 show in the QPC V1 fonts):
  - A large emerald-and-gold circle centred in the frame: outer radius 0.485 of the inner frame width, band 9.5 % of it. The band carries a gold vine, rosettes and leaves, beaded gold rims and an outer lace.
  - Floral crests above and below; side crests on the band.
  - Emerald quarter-fans in the four inner corners.
  - The centre is open (the page's paper), in Light and Dark.
  - The same design in Normal and Full-Screen, centred in the frame.
- **Text**: the verified QPC V1 lines of the 1405 print, unchanged: Hafs numbering (on page 1 the Basmala is ayah 1, not repeated), line breaks, letter size, word spacing, medallions, the printed line spacing.
  - The block is centred on the circle as drawn: the text area's 4 pt lift taken back, less the platform's drawn drop.
  - The title is the compact Option A cartouche (0.40 of the page width, 0.8 of a row).
  - Selection, highlights and taps are the regular rows'.
- **Checks** (`tests/openingPages.test.ts`): every line's ink (end words and medallions included), the Basmala, the cartouche and the name are inside the circle's opening on iOS, Android and the web, page widths 251–434, Normal and Full-Screen. The least clearance is the cartouche, 4.2–7.2 pt (by page width).
  - The circle, crests and corner ornaments stay inside the frame, and the corners stay clear of the circle.
  - Data: `fixtures/openingPagesInk.json` (`tools/mushaf-audit/generate_opening_ink.py`).
- **Differences from the reference image (deliberate):** the verified Hafs numbering and line breaks (the image counts Al-Fatiha differently and repeats the Basmala); running heads and the page number kept outside the frame; side crests on the band (only about 5 pt from the circle to the frame at the sides).
