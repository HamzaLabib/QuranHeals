# iOS development build with the exact-seek patch (2026-10-24)

**Status (2026-10-24): iOS platform-level DEV verification approved by the owner after listening on an iPhone.**
`VBR_SEEK_DEVICE_VERIFIED['avfoundation-precise']` is true (`mobile/src/audio/vbrSeek.ts`). Android (`'index'`) stays false.
See "Owner's iPhone results" at the end.

## The build

| | |
|---|---|
| EAS build | `f9ada32f-02aa-43a8-a1d5-0a68dd4842c8` (profile `development`, internal distribution) |
| Page | https://expo.dev/accounts/hamzalabib/projects/quran-heals/builds/f9ada32f-02aa-43a8-a1d5-0a68dd4842c8 |
| IPA copy | `%USERPROFILE%/Backups/quran-heals-ios-vbr-dev-build-20261024/quran-heals-dev-vbr-patched.ipa` (+ `SHA256SUMS`) |
| Devices | the existing ad hoc profile: the owner's two registered iPhones (identifiers in the EAS build page). No new registration. |
| Runtime version | `9314717e…` (fingerprint, includes the patched expo-audio): OTA updates for other builds never reach this binary |

**How it was built (isolated):**
1. A copy at `C:\qhb-ios\mobile`, with only the files git would upload (no `.env`, no ignored files).
2. Only the copy's `package.json` changed: `expo.autolinking.{ios,android}.buildFromSource: ["expo-audio"]`, plus an `eas-build-post-install` hook. The hook runs `apply.mjs --apply`, then `--check`, then greps both patched Swift files.
3. `apply.mjs --apply` was also run in the copy's own `node_modules`, so the local fingerprint matches EAS's.

The main tree's `package.json` and `node_modules` are unchanged; its expo-audio has no patch markers.

**First attempt `d8b92a69` failed** at Configure expo-updates. The patch had applied, but the runtime fingerprint differed
(`node_modules/expo-audio/ios` patched on EAS only). Fixed by step 3.

**Verified in the binary, not assumed:**
- EAS log (post-install hook): `patching: ios/AudioUtils.swift`, `patching: ios/AudioModule.swift`, `check passed`, and both greps returned 1.
- Pods: `Installing ExpoAudio (57.0.5)`. It is linked statically into the app executable; there is no `ExpoAudio.framework`.
- The `QuranHeals` executable in the IPA contains:
  - `quranHealsExactMp3Seek` and `avfoundation-precise`: the patch's constant;
  - `X-Quran-Heals-Mp3-Seek`: the marker the patch strips;
  - a reference to `AVURLAssetPreferPreciseDurationAndTimingKey`.

  An unpatched expo-audio has none of these.

## Install on the iPhone

1. On the iPhone, open the build page above in Safari (or scan its QR code from the computer), then tap **Install**.
   - It replaces the current Quran Heals development client: same bundle ID and team, so the app's data is kept.
   - If iOS asks for it: Settings → Privacy & Security → **Developer Mode** on, then restart the phone.
2. On the computer, in `QuranHeals\mobile` (PowerShell), stop any Metro on 8081 first. Then run:
   ```powershell
   $env:EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST='1'; npx expo start --dev-client --clear
   ```
   Without the variable, VBR surahs stay off even on this build.
3. Put the iPhone on the same Wi-Fi. Open Quran Heals, then pick the computer's server, or scan Metro's QR code with the Camera. Allow Local Network if asked.

## Tests on the iPhone

Since 2026-10-24 a reciter without a verified recording falls back to **Al-Minshawi**. So for every VBR case, the
player must show the reciter under test. **If it shows Muhammad Siddiq Al-Minshawi, the capability was not detected: stop.**

**1. Capability.** Settings → Favorite Reciter. Pass: Islam Sobhi **106** surahs (99 and 108 included) and Yasser
Mahmoud Salama **114** (48 included). With 104 and 113, the binary or the flag is not active: stop.

**2. Seek accuracy.**

Start each case from a stopped player: on the Mushaf page, tap the ayah, then Play. Listen to the first second, with
screen recording on.

Pass:
- the ayah's own first words;
- nothing of the previous ayah;
- the first syllable is not cut;
- the highlight is on that ayah.

| Reciter | Ayahs |
|---|---|
| Yasser Mahmoud Salama | 48:2, 48:15, 48:29 (last ayah, far seek) |
| Islam Sobhi | 99:1, 99:5, 108:2 |

Also note the seconds from Play until the voice is heard, for 48:29 (a far seek in a VBR file).

**3. Playback with these files.**

| Test | Pass |
|---|---|
| Full Surah, Sobhi 99 | every ayah highlighted in turn; stops after 99:8 |
| Full Surah, Yasser 48 | follows to 48:29 and stops |
| Repeat ×2 on Yasser 48:15 | the same ayah twice, each from its first word |
| Previous / Next inside Sobhi 99 | each ayah from its first word |
| Continuous Sobhi 98 → 99 → 100 | highlight follows; each surah starts at its own opening |
| Lock the phone during Yasser 48, wait 2 minutes | playback and ayah advance continue |

**4. CBR regression (must sound exactly as before).**

| Test | Pass |
|---|---|
| Maher 2:255 start | first words of the ayah |
| Minshawi: one whole Mushaf page, continuous | each ayah in order; the page turns |
| Ahmed Mohamed Salama 1:1 | first words |
| Talib 12:1 | first words |
| Restart Metro **without** the variable, then Sobhi 21:1 | the recitation's opening, never the introduction |

**5. Decide.**
- All of 1–4 pass: set `VBR_SEEK_DEVICE_VERIFIED['avfoundation-precise']` to true in `mobile/src/audio/vbrSeek.ts`. Only the owner, or on the owner's word.
- Any VBR case clearly off: the iOS method fails. The flag stays false; record the case and the offset heard.
- Any CBR regression: stop. Uninstall, then reinstall the previous development build (`3e72e4d3…`, 2026-10-15).

## Owner's iPhone results (2026-10-24)

Physical iPhone, EAS development build `f9ada32f`, Metro with `EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST=1`. All passed:

| Check | Result |
|---|---|
| Yasser Mahmoud Salama 48 | PASS |
| Islam Sobhi 99 and 108 | PASS |
| Ahmed Al-Agamy 42:29 and 42:53 | PASS |
| Saleh Al-Talib 12:1 | PASS, in Saleh's own voice (after the JS fix below) |
| Mushaf page 235 | PASS: Al-Minshawi for Hud 11:118–123, then Saleh from Yusuf 12:1 |
| Maher Al-Muaiqly 2:255 (CBR) | PASS |
| Repeat, Full Surah, Previous / Next, continuous, background / lock screen | PASS |
| Reciter order (… Yasser, Naina, Sobhi, Saleh) | PASS |

**What the iOS flag covers.** It is a platform-level result for the AVFoundation precise-timing method. On a patched
iPhone development binary, the flag now does what the test flag did: it lets the app use the VBR timing
(`generated/vbrTiming.ts`, dashboard-accepted timing). That covers 27 recordings:
- Ahmed Al-Agamy 42 (MP3Quran's own file, in place of the quranicaudio CBR copy);
- Yasser Mahmoud Salama 48;
- Islam Sobhi 21, 23, 25, 29, 30, 38, 47, 48, 49, 52, 57, 62, 72, 95, 98, 99, 100, 101, 104, 105, 106, 107, 108, 110 and 111. Where a CBR copy plays today, the original file replaces it.

Every surah still needs its accepted timing to match the catalogue file's fingerprint (`withVbrSeek`), and the binary
must report the patch. Release builds use none of it (`__DEV__` gate; no release binary has the patch).

**Not individually listened to on iOS:** the 27 recordings except the ones in the table. These are Yasser 48, Sobhi 99
and 108, and Agamy 42 at ayahs 29 and 53 (the rest of Agamy 42 was not heard). Their timing is the dashboard's
accepted timing; the iPhone result verifies the seek method, not each recording.

**Saleh Al-Talib 12 (not a VBR recording).** It failed first: endless loading, or what looked like Al-Minshawi.
- **Cause:** its archive.org host (`ia600903`) takes 7–9 s before the first byte of every request. iOS makes several requests before it can play, so the load exceeded the 20 s limit, and each retry restarted the download.
- **Fix (JavaScript only, `src/audio/expoOutput.ts`):**
  - a retry of the same file continues the native load already in progress;
  - seeks have the same 20 s limit.
- **Result:** it now passes on the iPhone.
- **Not the patch:** the file is CBR 128 kbps and never carries the native patch's marker, so it is independent of VBR seeking.
- **Still open:** the slow host remains a performance concern (a slow start, about 8 s for a far seek inside surah 12). Its source was deliberately not changed.

## Not done

- Android stays unverified: its seek accuracy was measured on the emulator, but nobody has listened on a device (`vbr-native-dev-build-2026-10-24.md`).
- VBR seeking stays development-only. Nothing in production changes.
- The two pending dashboard package imports are untouched.
