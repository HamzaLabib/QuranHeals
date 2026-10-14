# Mushaf navigation v1 (retired 2026-10-14)

The reader's navigation and interaction design before the 2026-10-14 redesign, from revision `529a724`.

## What it was

A floating, rounded, icon-only bar above the bottom safe area (`MushafControlPanel.tsx`), 56 pt high, 8 pt above the
inset, in this fixed physical order, left to right:

1. **Next page** (lucide `arrow-left`): the Mushaf is read right to left.
2. **Reflection** (`ReflectionBulbIcon`): grey outline (`bulbOff`) until an ayah is selected; then lit, outlined in the
   panel's `saved` green with the glass filled `activeFill` (#FFC000) and rays. Opened the Reflection sheet.
3. **Save a reading stop** (lucide `bookmark`, centre): opened a compact name field above the bar (prefilled with the
   active ورد's name). Saving stored **this page** (never an ayah) to the ورد of that name (`saveWirdPage`), creating
   it when new and making it active; a brief "Saved" (`SAVED_TOAST_MS` 1800 ms). The bookmark was filled green while
   this page was the active ورد's saved page. Also the only way the ورد list's **Add** created a ورد.
4. **Search** (lucide `search`): the search sheet (`MushafSearchSheet.tsx`) with two tabs: page number (Western or
   Arabic-Indic digits, `parsePageNumber`) and Surah (`surahSearch.ts`, Arabic and English, normalised).
5. **Previous page** (lucide `arrow-right`).

Plus: Back (top left, Normal Mode) and Expand / Collapse (top right, lucide `maximize` / `minimize`); the ورد pill
under the page (`MushafWirdSelector.tsx`, kept unchanged by the redesign); finger-following page swipes and pinch/double-tap
zoom (`MushafZoomView.tsx`, `pageZoom.ts`); page 604's إتمام الختمة and دعاء ختم القرآن links beside the pill.

Taps on the Quran text selected an ayah (highlight); the bar's lamp then lit. Taps on headings, the page number and the
frame did nothing.

## Page fit (in `mushaf.tsx`, `fitMushafPage`)

```text
viewportHeight = area.height − (PAGE_PANEL_GAP 4 + MUSHAF_PANEL_HEIGHT 56 + MUSHAF_PANEL_MARGIN 8 + bottomInset)   (Normal)
               = area.height − (FULL_SCREEN_BOTTOM_GAP 4 + bottomInset)                                          (full screen)
available      = viewportHeight − WIRD_ROW_HEIGHT 32                                                               (Normal)
page width     = floor(min(area.width − 2 × SIDE_MARGIN 3, available ÷ PAGE_ASPECT))
page height    = page width × computePageLayout(1000, tilesDown).page.height ÷ 1000
Taller (full screen): the most whole border tiles down (29 printed … TALLER_MAX_TILES_DOWN) that fit, line spacing ≤ 1.25 × printed
```

`area` is the space under the Back row (`BACK_BAR_HEIGHT` 36). Numbers for real phones:
[`../mushaf-page-layout-v1/geometry-and-calculations/baseline-geometry.json`](../mushaf-page-layout-v1/geometry-and-calculations/baseline-geometry.json).

## Files

`original-source/` (repository paths): `mobile/src/app/(tabs)/mushaf.tsx` (the reader), `components/MushafControlPanel.tsx`,
`MushafSearchSheet.tsx`, `MushafWirdSelector.tsx`, `MushafZoomView.tsx`, `ReflectionBulbIcon.tsx`, `FavoriteButton.tsx`,
`KhatmaReachedSheet.tsx`, `mushaf/surahSearch.ts`, `pageNumber.ts`, `pageZoom.ts`, `screenOptions.ts`, `readingStops.ts`,
`constants/mushafTheme.ts`, `localization/messages.ts` (its `mushaf` section holds the bar's labels).

`tests/`: `mushafScreen.test.ts` (the bar, search, save, swipes, zoom: the full behaviour), `mushafZoom.test.ts`,
`surahSearch.test.ts`, `khatmDua.test.ts`, `textFieldColors.test.ts`, and the helpers `gestureSimulator.ts`,
`syntheticQpcPage61.ts` they need.

`references/`: `docs/mushaf-reader-architecture.md`, `docs/mushaf-device-testing.md`.

## Dependencies

React Native, `react-native-gesture-handler`, `react-native-reanimated`, `lucide-react-native`, `react-native-svg`,
`expo-router`, and the app modules these files import (unchanged unless listed above).

## What replaced it (2026-10-14)

`MushafControlPanel.tsx` and `MushafSearchSheet.tsx` were then removed from `mobile/src/components/` (they exist only
here and in Git). Their roles moved onto the page: the Surah / juz' / Hizb lists, the compact page selector, the ayah's
Reflection · Save popup and the separator's Apply-to-ورد (see `docs/mushaf.md`, "Navigation and actions"). The bar's
ورد name field survives unchanged as `MushafStopNameField.tsx` (the ورد list's Add uses it), and the bar's reserved
space (56 + 8 pt) is still kept so the page size and the ورد pill did not move. The bar's labels are still in
`messages.ts` (the page actions use `nextPage` / `previousPage`).

## Restore

Copy the files in `original-source/` back to their paths (or `git checkout 529a724 -- <path>`), then in the reader
render `MushafControlPanel` and `MushafSearchSheet` again in place of the new popups, and run the archived
`mushafScreen.test.ts` in `mobile/tests/`.
