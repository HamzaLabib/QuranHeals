# Mushaf `/mushaf` — real-device testing

## Current build: testing on the iPhone (development build already installed)

The development build runs the current JavaScript from Metro: no new build is needed. The app is portrait only; an iPad runs it in iPhone compatibility mode.

**On the PC**
1. Same Wi-Fi as the iPhone. Check that `mobile/.env` has `EXPO_PUBLIC_API_URL=http://<this PC's Wi-Fi IP>:4000` (`ipconfig` shows the IP); fix it if the address changed.
2. Allow ports 4000 and 8081 through the firewall if not done yet (the administrator command under "One-time setup" below).
3. Backend: `cd backend && npm run dev`. The offline relay needs a synced layout in `backend/data/mushaf-sync/`; it is there from the last Content Sync.
4. Check from the iPhone's Safari: `http://<PC IP>:4000/api/mushaf/qpc-v1/offline/manifest` should show JSON with `"pagesCount":604`.
5. Metro: `cd mobile && npx expo start --dev-client --clear`. `--clear` makes sure the new code is served.

**On the iPhone**
1. Open **Quran Heals (development)**, choose the PC's server or scan Metro's QR code, and allow **Local Network** if asked.
2. Open the Mushaf: in Safari type `quranheals://mushaf` and confirm *Open in "Quran Heals"*. Page 61 opens.
3. **Normal Mode, page 61:**
   - Back on the left, Expand on the right, and nothing between them: no selector, no measurement text.
   - The page, the sage ورد pill and the cream Option A toolbar below it.
4. **Full screen, page 61:** tap Expand.
   - The page grows taller (on a 6.1″ iPhone about 12% taller, with the lines further apart), letter size unchanged, the whole page visible.
   - Only the Minimize icon at the top right. Exit with Minimize, or with a downward swipe at 1×.
5. **Install the offline Mushaf** (layout and page fonts, about 115 MB):
   - Go to any page not yet downloaded, for example `quranheals://mushaf?page=2`, and tap *Download for offline reading*.
   - Wait for "The complete Mushaf is ready for offline reading". The page fonts come from Quran Foundation's CDN, so the iPhone needs internet access too.
6. **Check these pages** (`quranheals://mushaf?page=N`, or Search → Page Number). Each must open; none may say "This page can't be shown".

   | Page | What to check |
   |---|---|
   | 1 | Al-Fātiḥah: the letters are the size of other pages, every line is centred, and the block (heading, then the 7 ayahs) sits in the middle of the frame. Only a heading (its Basmala is ayah 1). |
   | 2 | The start of Al-Baqarah: the heading «سورة البقرة», then the Basmala on its own line, then the ayahs, centred like page 1. |
   | 50 | Āl ʿImrān at the top: heading on line 1, Basmala on line 2. |
   | 106 | Al-Māʾidah mid-page: 4:176 ends, then heading and Basmala, then 5:1. |
   | 187 | At-Tawbah: a heading but **no** Basmala. |
   | 604 | Al-Ikhlāṣ, Al-Falaq, An-Nās: three headings, each followed by its Basmala. |

7. **On those pages and on page 61, in Light and Dark:**
   - Zoom to 2× and 3×: all harakat, hamzas and madd signs are whole.
   - Tap an ayah: it highlights and the lightbulb lights.
   - **Arrows:** the **left** arrow goes to the **next** page (61 → 62); the **right** arrow to the **previous** (61 → 60). On page 1 the right arrow is disabled; on page 604 the left arrow is.
   - **Swipes:** see step 8.
   - Save a ورد, then switch to it from the pill.
   - **Full screen is Taller on every page** (rolled out to all 604): open full screen on each page of the table. The frame grows, the lines spread evenly, the letters keep their size, and the whole page with its border stays visible. Pages 1–2 keep their compact centred block; only the frame grows.
8. **Swipes, on the phone itself.** Reload the app first, so it has the latest code. This needs no new build: the fix is JavaScript and a screen option the existing build already supports.
   1. Open page 61 at 1×, in English, Normal Mode.
   2. Put a finger in the middle of the page and swipe **left to right**, at normal speed: page **62**. Exactly one page; the app must **not** start sliding back to Home.
   3. Swipe **right to left**: back to **61**. Again: **60**.
   4. Repeat 2–3 starting near the screen's **left edge** (the old back-swipe area): it must turn the page, not go back to Home.
   5. Quick short flicks both ways: one page each.
   6. Tap an ayah, make small wobbles and a vertical drag: no page turn; the tap selects the ayah.
   7. Pinch to 2×, drag sideways both ways: the page pans, no turn. Double-tap: back to 1×. Swipe: turns again.
   8. Tap Expand (full screen) and repeat 2–7; then swipe down from the middle: it leaves full screen.
   9. Switch the app to Arabic (Settings) and repeat 2–8: the directions are the same.
   10. Page 1: right to left does nothing. Page 604: left to right does nothing.
   11. With a ورد active, swipe a few pages: the pill keeps the same ورد.
9. **Tall-screen check (Android):** on the tallest phone available, open full screen on page 61 and page 106. The line spacing must look like the iPhone's, not stretched: it is capped at 25% over the printed page, and extra height stays as paper around the page.
10. **Pages with the tightest marks** (the audit's closest neighbouring-line marks): 322, 323 and 466. Zoom to 3× and check that every mark on lines 14–15 of 322 and 323, and on line 7 of 466, is whole and separate from the next line.
11. **دعاء ختم القرآن:** not visible yet. Page 604 shows no link until a source for the text is approved (`docs/khatm-dua.md`).
12. Note any failure with a screenshot and the page number.


Status: **pending**. Everything below has been verified in a browser (Expo web, headless Chrome, real touch events at 320, 390 and 820 pt). No physical iPhone, Android phone or iPad has run the approved page yet.

## Why a new development build is needed

- The app has local native modules (`mobile/modules/quran-heals-pbkdf2`, `quran-heals-share-files`), so **Expo Go cannot run it**.
- The installed **preview** builds can't show the page either:
  - They were built from commit `84d3c5c`, before the Mushaf work, which is not yet committed.
  - They are release bundles pointed at the hosted backend, which serves no QPC V1 layout. Render is unchanged by design.
- **No `development` EAS build exists yet**, so one is needed per platform.
  - The `development` profile in `eas.json` already exists: dev client, internal distribution, `local` API URL policy.
  - **Starting it needs approval.**
  - The iPhone used for the internal preview builds is already registered for ad hoc installs.

```sh
cd mobile
eas build --profile development --platform ios       # iPhone (and iPad, in iPhone compatibility mode; see below)
eas build --profile development --platform android   # Android phone / tablet
```

Install each from the link or QR code that EAS shows. A development build stays valid for later JavaScript changes: Metro serves the code. Rebuild only when native configuration or native dependencies change. (`runtimeVersion` follows the native fingerprint.)

## One-time setup on the development PC

1. **Same Wi-Fi.** The PC is on `192.168.0.122` (Wi-Fi, Private network profile). `mobile/.env` already points the app there: `EXPO_PUBLIC_API_URL=http://192.168.0.122:4000`.
   - The address comes from DHCP. If it changes, update `mobile/.env` and restart Metro: the URL is fixed into the bundle when Metro starts.
2. **Firewall.** Windows currently has **no inbound rule** for Node, port 4000 (backend) or port 8081 (Metro), and blocks inbound connections by default, so phones can't connect yet. In an **administrator** PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "Quran Heals dev (API 4000, Metro 8081)" -Direction Inbound -Protocol TCP -LocalPort 4000,8081 -Profile Private -Action Allow
   ```
   Remove it after testing with `Remove-NetFirewallRule -DisplayName "Quran Heals dev (API 4000, Metro 8081)"`.
3. **Backend** (it has the Quran Foundation production credentials in `backend/.env`; they never reach the app):
   ```sh
   cd backend && npm run dev
   node ../tools/mushaf/verify-qpc-v1-page.mjs http://localhost:4000   # expect PASS
   ```
4. **Check from the phone's browser:** open `http://192.168.0.122:4000/api/mushaf/qpc-v1/pages/61`. It should show JSON with `"page":61`. If it times out, the firewall (step 2) or the Wi-Fi is the problem, not the app.
5. **Metro:**
   ```sh
   cd mobile && npx expo start --dev-client
   ```

## Opening `/mushaf` on a device

1. Open the **Quran Heals (development)** app. Its launcher lists the PC's Metro server when both are on the same Wi-Fi; tap it, or scan the QR code in the Metro terminal.
   - On iPhone, allow **Local Network** access when asked. Without it the app can't reach the PC.
2. Go to the screen. It isn't linked from the app yet:
   - **iPhone/iPad:** type `quranheals://mushaf` in Safari's address bar and confirm *Open in "Quran Heals"*.
   - **Android:** open `quranheals://mushaf` from a link (for example a note or message to yourself), or with a USB cable: `adb shell am start -a android.intent.action.VIEW -d "quranheals://mushaf"`.
3. To look at earlier designs side by side: `quranheals://mushaf?background=original&markers=qpc-glyph` (phase 1C) or `quranheals://mushaf?background=original` (new medallions on Original Cream).

What the platform setup already allows:
- iOS: `NSAllowsLocalNetworking` permits the plain-`http` LAN backend.
- Android: development (debug) builds allow plain `http`. If Android alone can't load the page, check this first.

**iPad:** `app.json` does not set `ios.supportsTablet`, so on an iPad the app runs in **iPhone compatibility mode** (an iPhone-sized window). That's enough to check the page's rendering, but it is not a tablet layout. For a true tablet layout use an Android tablet, or set `supportsTablet` (a native change that needs a new build; separate approval).

## Checklist

Record the device, OS version and screen size for each run. Use the approved default (no URL parameters).

| # | Check | How | Pass when |
|---|---|---|---|
| 1 | QPC V1 loads | Open `/mushaf` | *Script* shows "1405 Mushaf (QPC V1)" selected and no "not available" note. No credit under the page: Home's last line names Tanzil, Quran Foundation and the King Fahd Complex, and *Quran Sources & Credits* opens `/credits`. |
| 2 | 15 lines, verified breaks | Compare with `mushaf-1d-screenshots/07-updated-qpc-v1-phone-390.png` | Same 15 lines and words per line. Line 1 starts قُلْ ءَامَنَّا, line 15 ends with medallion ٩١. |
| 3 | Calligraphy and diacritics sharp | Zoom the phone's screenshot | No blurry or clipped glyphs; diacritics are not cut off at line tops. |
| 4 | Medallions aligned | Look at all 8 (٨٤–٩١) | Each is centred on the line, between its neighbouring words, not touching them. Dark top and bottom caps, mint sides, cream centre, dark number. **Watch vertical position:** native sets it from the platform's reported baseline, which has never run on a device. |
| 5 | All 8 ayahs selectable | Tap a word in each ayah | The reference line under the page shows 3:84 … 3:91. |
| 6 | Highlighting | Tap 3:84 (lines 1–4) and 3:91 (lines 14–15) | A soft green band covers that ayah's words on every line it spans, and nothing else. |
| 7 | Medallion taps | Tap each medallion | It selects the ayah that the medallion ends. |
| 8 | No accidental selections | Tap the border, the corners, the margins inside the frame, the headings, the page number | The selection doesn't change. |
| 9 | Add Reflection | Select 3:86 → *Write a reflection* | The existing sheet opens for 3:86. |
| 10 | Reading stops | Save "Ramadan", rename it to "Ramadan night", reopen the screen | The stop is listed for page 61 under the new name. |
| 11 | Warm Cream | Compare with screenshot 07 | The paper is a warm cream (`#F9EFD2`), not white or yellow; it looks the same in the phone's light and dark mode. |
| 12 | Narrow phone | The smallest phone available (≈ 320–375 pt) | The whole page fits the width, without horizontal scrolling. |
| 13 | Tablet | Android tablet (or iPad in compatibility mode) | The page is capped at 520 pt and centred. |
| 14 | Fallback | Switch *Script* to "Quran SVG" | The newer-print page shows, with its own line breaks and taps working; the paper is the same Warm Cream. |
| 15 | Offline behaviour | Stop the backend, reopen the screen | Within the layout's keep-until date the QPC page still shows from the device's copy; after it, the SVG page shows with a note. Nothing crashes. |
| 16 | Languages | Settings → Arabic, then Egyptian Arabic | The screen's text is translated; the page itself is identical. |

Report any failure with a screenshot and the check number.

## Reader layout, zoom and Back (final UI)

These have only run in a browser with emulated safe areas (`mushaf-final-ui-screenshots/`). The rows above that mention the *Script* selector, the reference line under the page or the stops list predate the full-screen reader; for the reader itself, use these:

| # | Check | How | Pass when |
|---|---|---|---|
| R1 | Safe areas | iPhone with Dynamic Island; Android with gesture navigation and with 3-button navigation | The Back arrow sits just under the status bar or Island, the page right under it. The bar floats just above the home indicator or navigation bar and never covers it. |
| R2 | Back | Tap the arrow; open `/mushaf` from a link on a cold start and tap it; use Android's Back | Back to the previous screen; Home when there is none; Android Back works as before. |
| R3 | Pinch | Spread two fingers on the page, then bring them together | Smooth zoom toward the fingers, 1× to 3×, never below 1×. No ayah gets selected and the page doesn't turn. |
| R4 | Sharpness at 3× | Zoom to 3× on iPhone and Android | Glyphs and medallions stay acceptably sharp. **Watch iOS:** a scaled view may be drawn from its 1× image, which looks soft. If it does, re-render the page at the zoom level once the pinch ends. |
| R5 | Pan | Zoomed in, drag with one finger in every direction | The page follows and stops at its edges; it never leaves the screen and never turns. |
| R6 | Swipe at 1× | Swipe left to right, then right to left, from the middle and from the left edge | Left to right: next page; right to left: previous. Never returns to Home. Vertical drags and taps don't turn. |
| R7 | Android edge Back | With gesture navigation, swipe from the screen's left or right edge | The system Back gesture still works; a swipe that starts a little inside the edge turns the page. |
| R8 | Double-tap | Zoomed in, double-tap | Back to the full page; the selection is unchanged. |
| R9 | Selection under zoom | At 2× and 3×, tap words and medallions | Each selects its own ayah, the highlight lines up, and the lightbulb opens the Reflection sheet for that ayah. |
| R10 | Lightbulb | Select, tap the selected ayah again, turn the page | Lit with rays when selected; grey with no rays after clearing or turning. The bar doesn't shift. |
| R11 | Keyboard | Open the search and bookmark fields | The keyboard never hides the field. |
| R13 | Full-screen reading | Tap the top-right Expand icon; pinch, pan, swipe and select there; Collapse; repeat with Android's Back | Only the page and Collapse remain. Everything works in full screen. Collapse (or the first Android Back) restores Back, the bar and the ورد pill with the same page, selection and ورد; nothing jumps or reloads. |
| R14 | Full-screen swipe down | In full screen at 1×: swipe down from the middle; then a short drag; then from the very top edge; then zoom in and drag down; then double-tap and swipe down | Exits only on the clear swipe down at 1×. The top-edge swipe opens the system's Notification Centre or shade instead. Zoomed, the page pans. Double-tap only resets the zoom. |
| R15 | One background | Light and Dark, Normal and full screen | No seam between the screen and the page, including behind the status bar and the home indicator or navigation bar. The bar is still clearly visible. |
| R16 | Taller full screen (dev build) | On page 61, tap Expand. Full screen is Taller automatically, and there is no selector or measurement text at the top. Normal Mode is always Traditional. | A taller frame of the same tiles, evenly spaced lines, every medallion on its word, the whole page visible. Judge whether the extra spacing reads better. |
| R17 | No clipped marks (iOS and Android) | Open page 61, then pages 3, 255, 322 and 466 (offline Mushaf installed). Take a phone screenshot of each and zoom into it. Check 3:90 «ٱلضَّآلُّونَ» and «وَأُو۟لَـٰٓئِكَ» on line 13, 3:84 «أُنزِلَ» on line 1, and 39:71 «مِّنكُمْ» on page 466 line 7. Repeat in Dark Mode, in full screen, at 2× and 3× (full screen on page 61 is the Taller page). | Every harakah, shadda, sukun, hamza, madd sign and small letter is whole. The damma on أُ shows its full top, the letter tails below the line are complete, and nothing is flattened at the top or bottom of a line. Compare with `mushaf-diacritics-fix-screenshots/`. |
| R20 | Whole words at word edges (iOS and Android) | Reload the development build (shake → Reload, so it picks up the 2026-10-12 renderer). Open page 465 and zoom into line 1: «تَقُولَ» (39:57). Then pages 322, 323 and 466, and 1–2. Check every word that starts with إ, ب, ي, ت or م, every ٱ, and each small waqf sign (صلى ج قلى م). Repeat in Dark Mode and Full-Screen, at 1×, 2× and 3× zoom. | The ت of تَقُولَ has its tooth and both dots, so it cannot read as نقول. The kasra and hamza under every إ, the dots under ب and ي, the hamzat al-wasl, every waqf sign, and the lower tails of م ع ج ح خ غ are complete. Compare with `mushaf-rendering-fix-screenshots/30-…` and `31-…`. |
| R21 | Same medallion on every page | Pages 1, 2, 50, 61, 106, 187, 322, 323, 465, 466 and 604, in Light and Dark. | Every ayah end is the gold-and-green medallion of page 61, with its own number (page 1: ١–٧, page 2: ١–٥, page 465: ٥٧–٦٧). No plain green outline anywhere. |
| R22 | Bottom and top of every line, Normal Mode (iOS and Android) | **First restart Metro with a cleared cache** (`npx expo start -c` in `mobile/`), then reload the development build, because Metro may not see file changes in the OneDrive folder. In Normal Mode, open page 466 and zoom into line 7 (39:71 «رُسُلٌ مِّنكُمْ»). Then page 322 line 15 and page 323 line 15 (the صلى signs), page 13 line 4, page 1 line 13 and page 465 line 1. Repeat in Dark Mode, at 1×, 2× and 3× zoom. | The lower tails and bowls of م ع ج ح خ غ are whole, and so is every dot, kasra, tanween and hamza under a letter; nothing is flattened at a line's bottom. Every waqf sign and upper mark is whole at a line's top. Lines are where they were: same spacing and letter size as before (compare `mushaf-normal-box-screenshots/`). |
| R23 | (Superseded by R24) Normal Mode: each page's text centred in the printed frame, then 1 pt higher | Restart Metro with `npx expo start -c` and reload. In Normal Mode, open page 5 and compare with your earlier screenshot. Then pages 560, 307, 431, 61, 322, 323, 465, 466, 1 and 2, in Light and Dark, and turn through a few pages in a row. | On page 5 the text sits visibly higher than before: about as much space above the first line as below the last, and the last line no longer near the lower border. On every page, top and bottom look about even and nothing touches the border. The page, page number and ورد pill are where they were. Turning pages, the text block moves only slightly (at most a sixth of a line). Full-Screen looks exactly as before. |
| R24 | (Superseded by R25) Device-measured baseline correction | — | No effect on the iPhone; removed. |
| R25 | Uniform 4 pt lift of the Quran text, Normal and Full-Screen (temporary) | Restart Metro with `npx expo start -c` and reload. In Normal Mode screenshot pages 5, 13, 61 and 466; then the same in Full-Screen. Also pages 1, 2 and 560, and tap an ayah on each. | All Quran text, headings, Basmala and medallions are 4 pt (12 px at 3×) higher than in the previous screenshots; frame, page number and ورد pill unchanged. Expected on an iPhone 16 Pro (above / below): page 5 ≈14.2 / 0.05 pt, 13 ≈13.7 / 2.2, 61 ≈12.8 / 4.1, 466 ≈13.9 / 2.3. Page 560's last line still reaches the inner rule (≈1.2 pt). Tapping an ayah highlights exactly its words. No letter or mark is cut. |
| R26 | Ayah selection follows the drawn words, Normal and Full-Screen | Restart Metro with `npx expo start -c` and reload. On page 5 tap 2:25 (lines 1–4) and 2:29 (last word of line 13 to line 15), then 2:26; on page 61 tap 3:84 and 3:85; on page 466 an ayah sharing a line; on pages 1, 2 and 50. Tap low on a word and high on a word. Repeat in Full-Screen and after turning pages. | The green band sits on the selected words as drawn, letters' bodies inside it, not shifted up over the line above. It starts and ends with the ayah's own words (including its medallion), meets the next ayah halfway and never covers its words. Taps anywhere on a word select that word's ayah, never the line below or above. |
| R27 | Android: every glyph drawn, iPhone-matched baseline | Android 15+ emulator or phone (ideally a 360×780 and a 412×915, and the smallest available). Restart Metro with `npx expo start -c`. Pages 5, 11, 61, 307, 322, 323, 343, 431, 465, 466 and 560, in Normal and Full-Screen, Light and Dark. Compare with the iPhone screenshots of the same pages. | No letter or mark cut: the ت of تَقُولَ (465), the kasra under إِ, the waqf signs (11, 2:70), the highest marks (322, 323), the lowest (466). Quran and Basmala baselines match the approved iPhone position; do not apply the rejected uniform 4.5 pt upward shift. Medallions stay on their lines; taps select the ayah and its highlight follows the words. |
| R28 | Android: resolve mathematical frame contacts on native pixels | On a 432×960 device near 3.333×, inspect Normal Mode pages 5, 26, 65, 142, 202, 381, 459, 467, 550, 553, 556 and 560, especially the last line against the lower rule; page 560 is the worst modeled case. Repeat pages 65, 550 and 556 on the smallest device (about 320×640 at 1.5–2×), including page 556's left edge. Check both navigation modes, Light/Dark and Full-Screen; compare the same pages with the approved iPhone appearance. Save native-resolution screenshots. | Record whether Quran ink actually merges with or crosses the decorative rule, versus remaining visibly separate after native rasterization. The model predicts geometric bottom overlap on pages 5, 26, 142, 202, 381, 459, 467, 553, 556 and 560; pages 65 and 550 are within the one-pixel guard but geometrically clear. Page 556's left edge is geometrically clear by about 0.31 pt and is a rounding-risk check. Any visible overlap is an open issue; do not hide it with an unreviewed offset. |
| R29 | Android: RTL neighboring-line ink | In Normal Mode, inspect page 98 lines 2–3, page 213 lines 9–10, and page 341 lines 7–8 at native resolution. Repeat in Full-Screen on a phone that grows beyond 29 tiles. | The two lines' letters and marks remain visually distinct. The outline model finds only three tiny Traditional-layout intersections (11, 1 and 41 pixels at 2048 pixels per em) and none from 30 through 35 tiles; record any visible merge without changing the approved line spacing. |
| R19 | Taller on every page | Full screen on pages 1, 2, 50, 61, 106, 187, 322, 466 and 604, on an iPhone, a small Android and a tall Android | Taller where it fits (iPhone 393: 33 tiles), never more than 35 tiles; small phones fall back to Traditional; the whole page and border always visible; letter size as in Normal Mode. |
| R18 | Pages 1–2 and Surah openings (offline Mushaf installed) | Open pages 1, 2, 50, 106, 187 and 604 | Pages 1–2: the letters are the same size as on other pages, each line is centred, and the block sits in the middle of the frame. Every opening shows the Surah's name on its heading line and the Basmala on its own line (none before At-Tawbah on page 187). Each page opens; none says "This page can't be shown". |
| R12 | Credits | Home → *Quran Sources & Credits* → each link | The page lists Tanzil, Quran Foundation and the King Fahd Complex; each link opens in the browser. Check qurancomplex.gov.sa opens from your region. |
