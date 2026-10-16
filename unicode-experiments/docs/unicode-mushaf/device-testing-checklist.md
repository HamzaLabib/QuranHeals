# Unicode Mushaf — physical-device testing checklist

Everything here is **UNVERIFIED** until done on real hardware. Automated checks (unit tests and headless Chrome)
cannot show how CoreText (iOS) or Minikin (Android) draw the font. Record each result with the device model, OS
version, app language, theme and a screenshot.

Devices: iPhone (any current), **Samsung Galaxy S22 Ultra**, **Huawei Nova**, and one tablet (iPad: the app runs in
iPhone compatibility mode, `supportsTablet` is not set; Android tablet: portrait).

## 0. Setup (no new build needed)

The prototype adds no native module, so the **development build already installed** runs it from Metro.

1. PC and phone on the same Wi-Fi. `cd QuranHeals/mobile && npx expo start --dev-client --clear` (`--clear` matters on
   OneDrive: it avoids stale bundles).
2. Open **Quran Heals (development)** and connect to Metro. The backend is **not** needed for Unicode pages (they read
   the local SQLite); start it only to test sign-in or sync.
3. The phone needs internet **once**: the KFGQPC font downloads from Quran Foundation's CDN (243 KB, SHA-256 checked),
   then works offline.
4. Open the Mushaf tab. The top bar shows development chips: **QCF / Uni** (renderer), **KF / Amiri** (font), **✓**
   (rendering check), **Tajweed Colors / ألوان التجويد** (filled = On). Tap **QCF** to switch to **Uni**.
   Deep link: `quranheals://mushaf?page=3&renderer=unicode`.

## 1. Rendering check mode (gives numbers, not impressions)

Tap **✓**. Every word's slot is outlined in red and every line's baseline in blue; after the page has drawn, a badge
at the top-left of the page reads, for example:

`p3: 127 words · width Δmax 0.40 px, mean 0.10, >1px 0 · baseline Δmax 0.00 px · touching 0`

Metro's terminal also logs `[mushaf] unicode check {…}` for every page. Copy the line for each page below into the
results table.

| Reading | Pass | Investigate |
|---|---|---|
| width Δmax | ≤ 1 px | > 1 px: the platform shapes the word differently from HarfBuzz (expected 0 on Android; small on iOS) |
| >1px | 0–2 | many: report the page |
| touching | 0 | any: neighbouring words collide (screenshot that line) |
| baseline Δmax | ≈ 0 | a constant ≈ 0.08 em: only padding in the coordinates (harmless). On iOS, trust the screenshot over this number (onTextLayout did not match TextKit's drawing for the QCF fonts) |
| visual | each word centred in its red box; the blue line along the letters' base | glyphs sitting high or low in the boxes |

## 2. Critical pages, both fonts

For pages **1, 2, 3, 5, 187, 319, 560, 595, 604**, plus **236** (the Amiri fallback word in 12:11), **525** (52:37)
and **254** (the 13:37 correction):

- [ ] 15 lines (pages 1–2: their centred block in the ornamental circle); same line breaks as QCF V1 (switch QCF ⇄ Uni
      on the same page and compare the first and last word of each line).
- [ ] **Joining:** no letter of a word drawn detached; zoom to 3×.
- [ ] **Harakat and marks** whole and on their letters: sukun as the small head-of-khah (not a circle); the round zero
      only over silent letters (e.g. «كَفَرُوا۟» on page 3); hamza, madda, dagger alif, small high meem (iqlab), pause signs.
- [ ] **No fragmentation** (pages 3 and 595 on the S22 Ultra): no cut-off dots, kasras or tails at word edges.
- [ ] **Kashida:** elongations look like strokes joining letters; no gaps inside words.
- [ ] **Baseline:** medallions centred on the line; the Amiri words on 236 and 525 sit on the same baseline.
- [ ] Page **560**: the last line clear of the bottom frame (Normal and full screen).
- [ ] **Surah headings and Basmalas** centred in their rows, not touching the line above or below (pages 187, 595, 604).

## 3. Tajweed Colors

- [ ] Toggle ON/OFF on pages 3 and 595: **no word moves** (compare screenshots; ✓ mode boxes must not move).
- [ ] With colours ON, zoom to 3×: **no letter separated from its neighbour at a colour boundary** (Android especially:
      React Native puts each coloured run in its own span), and no mark detached from its letter.
- [ ] Colours readable in Light and Dark; grey "not pronounced" letters still legible.
- [ ] The gold ورد medallion unchanged with colours ON.

## 4. Interactions (Unicode renderer)

- [ ] Tap a word → popup with Reflection, Save, Copy, Share; the ayah highlighted on all its lines.
- [ ] Copy → paste into Notes: identical to the ayah screen's text (sukun and round zero are the standard characters).
- [ ] Share → the existing Share Studio card; Save → heart fills; Reflection opens the editor.
- [ ] Tap a medallion → Apply to ورد; the medallion turns gold; switching ورد moves or clears the gold.
- [ ] Page 604 → إتمام الختمة flow unchanged.
- [ ] Swipes (left→right = next), pinch zoom to 3×, double-tap reset, full screen and swipe-down exit, Keep Screen Awake.
- [ ] Surah / juz' / Hizb lists and the page selector open the right pages.
- [ ] First-use guide (Help icon): steps 5–6 point at a word and a medallion of the current page.
- [ ] Deep links: `quranheals://mushaf?page=61&ayah=3:84` highlights 3:84.

## 5. Device settings that change text (Samsung especially)

- [ ] Settings → Display → Font size and style: **largest** size and a **non-default font style** → no change (the
      Mushaf ignores system font scaling, `allowFontScaling={false}`).
- [ ] **Bold font** ON → words must not collide (✓ mode: touching 0).
- [ ] **High contrast fonts** (Accessibility) ON → legible, no collisions.
- [ ] Display size / screen zoom at maximum → the page refits; no clipping.
- [ ] Dark mode and the app's Dark Appearance.

## 6. Performance and offline

- [ ] First Unicode page after launch appears within ~1 s once the font is cached; swiping feels as smooth as QCF.
- [ ] Airplane mode after the first launch: Unicode pages still open (font cached, text local).
- [ ] Memory: no growth after swiping 50 pages (Xcode / Android Studio memory graph, if available).

## Results table (fill in)

| Device / OS | Page | Font | Tajweed | ✓ badge line | Visual notes | Pass? |
|---|---|---|---|---|---|---|
| | | | | | | |

## 7. Visual candidates (2026-10-15, visual-candidates.md)

The font chip cycles **C2·Mad** (default, natural fitting) → **C·Mad✦** → **B·Mad** → **A·KF+** → **KF** → **Am**.

- [ ] **C2 vs C** on pages 5, 69, 595 and 604: C2 has no long stretched words; judge whether its short lines (centred, up
      to 2 em short) and gaps read more naturally than C's elongations, next to QCF V1.
- [ ] **C2 edges:** the text reaches 1% into the paper margin: nothing may touch the inner frame rule (medallions at a
      line's left end especially).

- [ ] Pages 3, 5, 595 and 604 in each of C, B, A: compare with QCF V1 (switch Uni → QCF on the same page). Note which
      reads most like the printed Mushaf.
- [ ] **C — elongations:** each elongated word stretches one connection smoothly (no gap, no flat bar, no break in the
      letter); no tatweel bar visible anywhere in C (a visible bar means the font's rule did not apply on that device).
- [ ] **C/B — iOS baseline:** QH Old Madina is moved 0.2 em down on iOS only (predicted from its metrics, not measured).
      In ✓ mode the letters must sit on the blue baseline and medallions be centred on the line; report any constant
      offset with a screenshot.
- [ ] **C/B — pause signs** (ۖ ۗ ۚ ۛ) sit over the end of the word before them, not between words.
- [ ] 11:41 (page 226) and 12:11 (page 236): the one word in Amiri Quran sits on the line's baseline.
