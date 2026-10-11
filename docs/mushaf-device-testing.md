# Mushaf `/mushaf` — real-device testing (phase 2A)

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
| 1 | QPC V1 loads | Open `/mushaf` | *Script* shows "1405 Mushaf (QPC V1)" selected and no "not available" note. The credit under the page names Quran Foundation and the King Fahd Complex. |
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
