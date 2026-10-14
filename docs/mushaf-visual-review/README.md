# Mushaf redesign: visual review

Screenshots of the redesigned Mushaf reader (the uncommitted working tree on top of `529a724`), compared with the archived original (`529a724`, see `design-archive/`). Captured on 2026-10-14. No code, layout or Quran data was changed for this review.

## How these were captured, and what they are not

- **No device or simulator was available.** This is a Windows machine: there is no iOS Simulator, and no Android SDK, emulator or `adb`. **None of these screenshots is device- or simulator-verified.**
- Every screenshot comes from the **running Expo app** rendered as Expo web (React Native Web) in headless Chrome. The page text comes from the local development backend's relay (QPC V1 snapshot `de84dc6f…`), using the dev-only `/mushaf?page=N&source=online` route. Taps, drags and typing were real mouse and keyboard input sent through the Chrome DevTools protocol.
- Both apps ran side by side: the current tree on `:8081` and the original `529a724` on `:8082`.
- Nothing was drawn, retouched or mocked up. The composites (40–44) place two unaltered captures next to each other. Image 45 is a computed pixel diff.
- Phone sizes are emulated **browser viewports**. There is no status bar, notch, home indicator or safe-area insets, and no on-screen keyboard. Fonts are rendered by Chrome rather than iOS or Android, so text rendering, haptics, the native share sheet, gestures and the 350 ms tap feel all still need a real device (`docs/mushaf-device-testing.md`, N1–N10).
- The state was seeded in the browser's storage: an active ورد named "Fajr" (or "ورد الفجر" in Arabic), saved at page 120 unless noted. The Save in shot 16 was a guest favourite in the throwaway Chrome profile and used only the local development backend. No production service was used.
- `captures.json` lists every file with its app, viewport, locale, theme and page. `compare.json` lists the composites and the diff statistics.

## Index

### Main screen (current)
| # | File | What it shows |
|---|------|---------------|
| 01 | `01-current-page-125-normal.png` | Page 125 in normal mode, 390 × 844 @3×. The Surah name sits top-left and the juz' top-right; both are tappable. The page number ١٢٥ is below the frame, then the ورد pill ("Fajr ⌄") in the same place as before. The expand icon (maximize-2) is top-right. **The empty band** is below the pill, where the original bar was (56 pt + 8 pt margin, still reserved). |
| 02 | `02-current-page-1.png` | Page 1 (Al-Fātiḥa) with the approved rich illumination, unchanged. |
| 03 | `03-current-page-2.png` | Page 2, unchanged opening decoration. |
| 04 | `04-current-page-3.png` | Page 3, the first regular page. |
| 05 | `05-current-page-604.png` | Page 604: three Surah headings, then the إتمام الختمة / ورد / دعاء ختم القرآن row in the pill's place. |
| 06 | `06-current-page-125-full-screen.png` | Full screen: the back arrow and pill are hidden, and the collapse icon (minimize-2, arrows pointing in) takes the expand icon's place. |

### Navigation selectors (current)
| # | File | What it shows |
|---|------|---------------|
| 07 | `07-current-surah-list.png` | Tap on the Surah name: the searchable Surah list, opened at the current Surah. |
| 08 | `08-current-juz-list.png` | Tap on the juz': the 30 juz', searchable by number. |
| 09 | `09-current-hizb-list.png` | Page 22 shows a Hizb label ("الحزب ٣") in the centre of the header. Tapping it opens the list of 60 Hizbs with the current one highlighted. The label appears only on pages where it is printed. |
| 10 / 10b | `10-current-page-selector.png`, `10b-…close-up.png` | Tap on the page number: the compact selector at the current page, with no arrow. The Surah is on the left, the juz' on the right, and the RTL slider has its olive thumb. |
| 11 / 11b | `11-current-slider-higher-page.png`, `11b-…close-up.png` | Dragged left to page 301 (Al-Kahf, Juz' 15): **←** appears left of the number. This only previews the page; the page behind does not change until release/confirm. |
| 12 / 12b | `12-current-slider-lower-page.png`, `12b-…close-up.png` | Dragged right to an earlier page: **→** appears right of the number. |
| 13 | `13-current-page-typed.png` | Tap on the number and type 200 (At-Tawba, Juz' 10, ←). The field uses the reader's cream/olive field colours. *A browser shows no software keyboard, so the keyboard placement is unverified.* |

### Ayah interactions (current)
| # | File | What it shows |
|---|------|---------------|
| 14 | `14-current-ayah-actions-unsaved.png` | Tap on an ayah's words: the ayah is highlighted and the popup appears near it with **Reflection, Save, Share** in that order. The heart is an outline. |
| 15 | `15-current-ayah-actions-close-up.png` | Close-up: the lit yellow lamp (the original bar's `ReflectionBulbIcon`, lit), the heart, and Share (`share-2`). |
| 16 / 16b | `16-current-ayah-actions-saved.png`, `16b-…close-up.png` | The same ayah after Save: the heart is filled and the label reads "Saved". |
| 17 / 17b | `17-current-separator-apply.png`, `17b-…close-up.png` | Tap on an ayah-number medallion: only **"Apply to Fajr Wird"** and **X**, with no Reflection, Save or Share. |

### Appearance, language and sizes (current)
| # | File | What it shows |
|---|------|---------------|
| 18 | `18-current-dark-page-125.png` | Dark mode. |
| 19 | `19-current-dark-ayah-actions.png` | Dark-mode ayah popup. |
| 20 | `20-current-dark-page-selector.png` | Dark-mode page selector at a later page. **Note:** the thumb is a pale sage in dark mode, not the light-mode olive. |
| 21 | `21-current-arabic-page-125.png` | Arabic interface: the printed page is identical, and the pill reads "ورد الفجر". |
| 22 | `22-current-arabic-ayah-actions.png` | Arabic popup (خاطرة، حفظ، مشاركة), right-to-left with icons on the right. |
| 23 | `23-current-arabic-separator-apply.png` | Arabic Apply popup: "تطبيق على ورد الفجر". The name already contains ورد, so the word is not repeated. |
| 24 | `24-current-arabic-page-selector.png` | Arabic page selector: the same physical layout (Surah left, juz' right, page 1 at the slider's right end). An earlier page shows →. |
| 25 | `25-current-small-iphone-375x667.png` | 375 × 667 @2× (iPhone SE size). The page is height-limited here, and the band sits below the pill. |
| 26 | `26-current-large-iphone-430x932.png` | 430 × 932 @3× (Pro Max size). |
| 27 | `27-current-android-412x915.png` | 412 × 915 @2.625× (a common Android size). This is a Chrome viewport, not Android. |

### Original (529a724)
| # | File | What it shows |
|---|------|---------------|
| 28 / 28b | `28-before-page-125-saved-here.png`, `28b-before-bar-close-up.png` | The original floating bar (next, lamp, bookmark, search, previous). Page 125 **is** the ورد's saved page, so the bookmark is **filled yellow**. |
| 29 | `29-current-page-125-saved-here.png` | The current app in the same state: **nothing shows that this page is the saved page.** |
| 30 | `30-before-page-125-not-saved.png` | Original, with the ورد saved elsewhere: an outline bookmark. |
| 31 | `31-before-ayah-selected.png` | Original: a tap selected the ayah and lit the bar's lamp, with no popup. |
| 32 | `32-before-search-sheet.png` | Original: the search sheet (page number or Surah name). |
| 33 | `33-before-small-iphone-375x667.png` | Original at 375 × 667 (compare with 25). |

### Side-by-side comparisons and geometry evidence
| # | File | What it shows |
|---|------|---------------|
| 40 | `40-compare-panel-vs-navigation.png` | 30 vs 01: the bar removed and navigation moved into the page furniture. |
| 41 | `41-compare-bookmark-indicator.png` | 28 vs 29: the filled bookmark, and its absence now. |
| 42 | `42-compare-ayah-tap.png` | 31 vs 14: the lamp lit in the bar, compared with the action popup. |
| 43 | `43-compare-search-vs-page-selector.png` | 32 vs 10: the search sheet compared with the compact selector. |
| 44 | `44-compare-small-iphone.png` | 33 vs 25: the small viewport. The page and pill are in the same place, and the bar's area is now empty. |
| 45 | `45-diff-page-region-before-vs-current.png` | **Pixel diff** of 30 vs 01 (same state, 1170 × 2300 device px, from the top down to the pill). Pixels that differ are marked red over a faded copy of the current screen. **Only 838 px differ, all inside the top-right expand icon** (box 1070,26 to 1125,81; the icon changed by design). **0 px differ** in the header labels, frame, Quran text, page number and ورد pill. The frame geometry and page layout are unchanged at this size. |

## What the review shows

1. **Page geometry is unchanged** (45: pixel-identical below the header icons at 390 × 844; 44: the same placement at 375 × 667). The page number already sat outside the frame in the original.
2. **The empty band** (01, 25, 26, 27, 44) is the original bar's reserved 64 pt, now empty. Reclaiming it would enlarge the page on height-limited screens (25), and the pill's position depends on it. It has been left unchanged pending device verification.
3. **The saved-page indicator is lost** (41). The original filled bookmark meant "this page is the active ورد's saved page". The current screen shows the ورد's name but not whether this page is its saved page.
4. **Ayah actions** match the specification: three actions on words (14–16, 19, 22) and two controls on the separator (17, 23).
5. **Dark mode thumb colour** (20): pale sage rather than olive. Flagged for a design decision, not changed.
6. **Still needs a real device:** safe areas, the software keyboard with the page field (13), the native share sheet, haptics, tap timing, and Android rendering (27 is Chrome).
