# Android audio ownership and Mushaf last page: phone test (2026-10-25)

**Status:** built and emulator-tested. Physical-phone test **pending**. None of the four reported issues is confirmed fixed until the phone checks below pass.

## The test APK

| | |
|---|---|
| File | `Working progress/Screenshots and Logs/android-ownership-2026-10-25/apk/QuranHeals-audio-ownership-test-2026-10-25.apk` |
| SHA-256 | `f667f2f40ba9bf6cf295aaa1d9747ae7867f4a495b83f02f1126ce402fbc6de5` |
| App | **QH Audio Test**, package `com.quranheals.app.audiotest`, release build (Hermes, `__DEV__` false), arm64-v8a and x86_64 |
| Contents | Working tree on 89d5c34 with every uncommitted change of 2026-10-25: both expo-audio native patches, engine and output changes, and the last-page change |
| Signing | Local debug key (not EAS). It installs **beside** the real Quran Heals app, never over it, so the real app's ورد data is untouched. |
| Backend | `https://quran-heals-api.onrender.com`. OTA updates are disabled in this build, so the bundle tested is the bundle built. |
| Not for release | Separate package id, debug signature. Google sign-in won't work in it, because the OAuth client is bound to the real package and key. |

The file `EMULATOR-ONLY-norton-trust-x86_64.apk` in the same folder trusts this PC's Norton TLS-scanning root. **Never install it on a phone.**

### Install

1. On the phone, allow installing unknown apps for the file manager or browser you'll use. With USB debugging instead: `adb install -r "<path to the APK>"`.
2. **Force-stop the real Quran Heals app before testing** (Settings → Apps → Quran Heals → Force stop). Two apps holding media sessions would confuse the Bluetooth tests.
3. Open **QH Audio Test** and go to Mushaf. Optionally download the offline Mushaf so the pages draw. Audio streams either way.

## Checks (record pass or fail for each)

Use a reciter and surah that plays, for example Al-Minshawi on any page. Before each test, play from the Mushaf's headphones.

| # | Do | Expected |
|---|---|---|
| 1 | Press **Home** while it plays | It keeps playing. The notification shows pause. |
| 2 | Lock the screen | It keeps playing. Lock-screen pause and play work, and the app's button matches when you return. |
| 3 | Pause from the **notification** or media panel, then play from it | The app shows paused (headphones), then playing (the reciter chip). Audio matches. |
| 4 | While playing, open **Recents and swipe the app away** | Audio stops at once. The notification and media panel controls disappear within about 1 s. Nothing plays afterwards, even after a minute. |
| 5 | Swipe away **just after** pressing play, while it is still loading (within half a second), and again exactly as one ayah ends | Nothing ever plays. |
| 6 | After 4: press play on wired or Bluetooth headphones, or on a car's controls | Nothing plays, and no notification appears. |
| 7 | **The car.** Play, swipe the app away (4), turn the car off, leave, come back and reconnect, with the car's auto-play on | Nothing plays. Repeat once more after an hour or more (the process will likely be gone by then). |
| 8 | Disconnect Bluetooth (turn the car or headphones off) **while playing in the background** | Playback pauses: no sound from the phone's speaker. The app shows paused. |
| 9 | Reopen the app after 4 and play | It plays normally, and the notification returns with working controls. |
| 10 | Play from page 50 and let the recitation turn to page 52. Swipe the app away and reopen it from the launcher | The Mushaf opens on **page 52**. No ورد page or Khatma changes (My Reciting shows the same as before). |
| 11 | Swipe pages by hand to page 80. Swipe the app away and reopen | It opens on page 80. |
| 12 | Background only: page 30, Home, reopen | Page 30, as before. |

If anything fails, note the step, the phone model and Android version, and whether the process was still alive. With USB, `adb shell pidof com.quranheals.app.audiotest` and `adb logcat -d > log.txt` right after the failure help most.

## What the emulator already showed (Android 17, AVD "Error", the emulator-only twin of this build)

These results are measured but are not a phone result. The system state was read from `dumpsys media_session`, `notification`, `audio` and `activity services`.

- **Background:** with Home, playback continued (position 21 s → 36 s) with the foreground service and notification in place.
- **Swipe from Recents (real launcher gesture), while playing in the background:** within 1–2 s there was no session, no notification, no running player and no service. 22 s later, nothing had returned. No crash, and no refused foreground-service start after the final guard.
- **External play after closing:** `cmd media_session dispatch play`, `KEYCODE_MEDIA_PLAY` and `KEYCODE_MEDIA_PLAY_PAUSE` played nothing. Android reported `Last MediaButtonReceiver: null` and `Media button session is null`. With the process killed after closing, the same keys didn't even start the process.
- **The race (task removed 0–3 s after pressing play, same live process):** playback starts about 0.5–0.8 s after the tap, so removals at 0, 0.15 and 0.4 s fell during the load, and those at 0.8, 1.5 and 3 s during playback. Every case had zero players, sessions and notifications over the next 25 s (longer than the 20 s load timeout). A control run without removal played.
- **Reopen in the same process:** playback, session, notification and foreground service all returned.
- **System pause and play stay in sync:** the session showed PAUSED and the app labelled the headphones "Play" (paused, not idle). After the system play, the session was PLAYING and the app showed its playing chip.
- **The final phone APK:** installs and launches on the emulator without a crash.
- **Not testable on the emulator:**
  - Real Bluetooth: a car, AVRCP auto-play, and the "becoming noisy" pause on disconnect.
  - Listening to the audio itself.
  - Other Android versions and manufacturer builds. Some vendors kill or keep processes differently, or show their own media panels.
  - The cold-start page after a recitation (step 10).
