# Android audio: phone test (2026-10-25)

Covers four things:
- closing the app ends its audio;
- a car or headset can't bring it back;
- another app's recording pauses the recitation, which doesn't resume on its own;
- background recitation continues across files, and the Mushaf reopens on the last page.

**Status:** built and emulator-tested. Physical-phone test **pending**. None of these issues is confirmed fixed until the phone checks below pass.

## The test APK

| | |
|---|---|
| File | `Working progress/Screenshots and Logs/android-ownership-2026-10-25/apk/QuranHeals-audio-test-2026-10-25-focus2-6efacac.apk` |
| SHA-256 | `744052e1ae9d9808b21f7501dd89842604b4f7e5daf6b1a1495abdf269f79544` |
| App | **QH Audio Test**, package `com.quranheals.app.audiotest`, release build (Hermes, `__DEV__` false), arm64-v8a and x86_64 |
| Contents | Commit **6efacac** (the swipe-away and last-page round), plus only this round's uncommitted changes: the audio-focus, keep-started and stale-start native patch, `engine.ts` and `expoOutput.ts`. Not included: the other uncommitted work in the tree (Memorization Mode, `MushafAudioPlayer.tsx`, `mushaf.tsx`, `settings.tsx`). |
| Signing | Local debug key (not EAS). It installs **beside** the real Quran Heals app, never over it, so the real app's ورد data is untouched. It replaces an earlier QH Audio Test in place. |
| Backend | `https://quran-heals-api.onrender.com`. OTA updates are disabled in this build, so the bundle tested is the bundle built. |
| Not for release | Separate package id, debug signature. Google sign-in won't work in it, because the OAuth client is bound to the real package and key. |

- **Don't use the APKs in `apk/superseded/`:**
  - the earlier swipe-away build has neither the audio-focus fix nor the background-load fix;
  - `DO-NOT-USE-included-other-uncommitted-work-focus.apk` also contains the other in-progress work;
  - `...-focus-6efacac-before-stale-start-fix.apk` could play over a recording that began right after play was pressed (B4).
- **Never install `EMULATOR-ONLY-norton-trust-x86_64.apk` on a phone.** It trusts this PC's Norton TLS-scanning root.

### Install

1. On the phone, allow installing unknown apps for the file manager or browser you'll use. With USB debugging instead: `adb install -r "<path to the APK>"`.
2. **Force-stop the real Quran Heals app before testing** (Settings → Apps → Quran Heals → Force stop). Two apps holding media sessions or audio focus would confuse these tests.
3. Open **QH Audio Test** and go to Mushaf. Optionally download the offline Mushaf so the pages draw. Audio streams either way.

## Checks (record pass or fail for each)

Use a reciter and surah that plays, for example Al-Minshawi. Unless a step says otherwise, start each test by playing from the Mushaf's headphones.

### A. Closing, background and controls

| # | Do | Expected |
|---|---|---|
| A1 | Press **Home** while it plays | It keeps playing. The notification shows pause. |
| A2 | Lock the screen | It keeps playing. Lock-screen pause and play work, and the app's button matches when you return. |
| A3 | Pause from the **notification** or media panel, then play from it | The app shows paused, then playing. Audio matches. |
| A4 | While playing, open **Recents and swipe the app away** | Audio stops at once. The notification and media panel controls disappear within about 1 s. Nothing plays afterwards, even after a minute. |
| A5 | Swipe away **just after** pressing play, while it is still loading (within half a second), and again exactly as one ayah ends | Nothing ever plays. |
| A6 | **Stop** playback in the app: pause, then **long-press the headphones**. Use other apps for 2+ minutes. Come back, play, then swipe the app away. | Audio stops at once. (This exact sequence failed before the last fix: see below.) |
| A7 | After A4: press play on wired or Bluetooth headphones, or on a car's controls | Nothing plays, and no notification appears. |
| A8 | **The car.** Play, swipe the app away, turn the car off, leave, come back and reconnect, with the car's auto-play on | Nothing plays. Repeat once more after an hour or more (the process will likely be gone by then). |
| A9 | Disconnect Bluetooth (turn the car or headphones off) **while playing in the background** | Playback pauses: no sound from the phone's speaker. The app shows paused. |
| A10 | Reopen the app after A4 and play | It plays normally, and the notification returns with working controls. |
| A11 | **Background across files:** play from page 1 (Al-Fatiha), press Home, and wait about a minute without opening the app | It carries on into Al-Baqarah by itself. Before this build it stopped after Al-Fatiha until the app was opened again. |

### B. Voice recording in another app

Use the voice recorder you actually use: for example WhatsApp or Telegram voice notes (hold the microphone button), Samsung Voice Recorder, or Google Recorder. Record a few seconds each time.

| # | Do | Expected |
|---|---|---|
| B1 | **Record while it plays.** Quran playing in the background, open the recorder, record about 10 s, stop. Stay out of QH Audio Test for another 20 s. | The recitation pauses **when the recording starts**. It stays silent while you record **and after you stop**: it never resumes on its own. |
| B2 | **Resume by hand.** After B1, open QH Audio Test. | The top bar shows the **headphones**, read out as "Play" (paused, not stopped), at the ayah where it stopped. Press them and it carries on from the same place. Pressing play in the **notification** after B1 also resumes it. |
| B3 | **Record during an ayah transition.** Play from page 1 and press Home. Watch the notification's title and start recording **the moment it changes from Al-Fatiha 1:7 to Al-Baqara 2:1**, or just before (a new file loads there). If the reciter list offers one with a file per ayah (Ali Abdullah Jaber may be one; not checked in this build), also try it, starting the recording right as one ayah ends. | Nothing plays during or after the recording. The app shows paused on the new ayah. Pressing ▶ plays from there. |
| B4 | **Record right after pressing play.** Press the Mushaf's play and switch to the recorder within a second, before the recitation is heard. Record about 20 s. Halfway through, open QH Audio Test and go back to the recorder. Then stop. | Nothing plays during the recording, including when you look at the app. The app shows paused ("Play"), and the recorder keeps recording. Pressing play yourself *during* a recording does play: that is your choice. |
| B5 | **Pause and resume from the notification, then record.** Pause and play from the notification or headphones first, then record as in B1. | Same as B1. This was the case that reproduced your report before the fix. |
| B6 | Get a **phone call** (or ring the phone) while it plays. Answer, hang up. | The recitation pauses and doesn't resume after the call. |
| B7 | **Navigation voice.** Google Maps directions while it plays. | The recitation gets **quieter** for the announcement and carries on. No pause. |
| B8 | Any recorder in B1 that **doesn't** pause the recitation | **Note which app.** It most likely records without requesting audio focus (see "What can and can't be detected"). |

If anything fails, note the step, the app used, the phone model and Android version. With USB debugging, right after the failure: `adb shell dumpsys audio > audio.txt` (it shows who held audio focus) and `adb logcat -d > log.txt`.

### C. Mushaf last page

| # | Do | Expected |
|---|---|---|
| C1 | Play from page 50 and let the recitation turn to page 52. Swipe the app away and reopen it from the launcher | The Mushaf opens on **page 52**. No ورد page or Khatma changes (My Reciting shows the same as before). |
| C2 | Swipe pages by hand to page 80. Swipe the app away and reopen | It opens on page 80. |
| C3 | Background only: page 30, Home, reopen | Page 30, as before. |

## What can and can't be detected (Android)

- **Detected reliably: apps that request audio focus.** Android tells the app holding focus when another app takes it:
  - for a recording: voice-note apps, recorders, voice search and calls;
  - for its own playback: another player or a video.
  
  The recitation then pauses and stays paused until the reader presses play. Most voice-note and recorder apps request focus, since that's how they silence other audio, but it is each app's choice.
- **Not acted on: a recorder that requests no focus while the recitation already plays.** Android reports that *a* recording is active, anonymised: since Android 10, apps don't get other apps' recording details. But a recording without a focus request doesn't pause other apps, and this app doesn't pause on that report alone (see below). The recitation carries on during such a recording; FocusRec on the emulator showed this (below).
- **Ducking requests** (navigation voice, some notification sounds) lower the volume. Android does this by itself, and the recitation doesn't pause.
- **A start that is still pending when a recording begins** (B4: play pressed, a recorder started before the recitation was heard) is refused. The app is told about active recordings, anonymised: how many, never which app. So a start the reader asked for *before* the recording began never takes the recorder's focus, and the app shows paused.
  - Before this fix, the emulator showed the recitation requesting focus after the recorder had it, taking it (the recorder received `AUDIOFOCUS_LOSS`) and playing over the recording, both with the recorder in front and after returning to the app. The background-load fix had made this happen without the app even being reopened.
  - A play pressed *after* the recording began is the reader's choice and plays.
  - Limitation: a recording that starts in the second between pressing play and the first sound blocks that start too, so press play again. That includes an always-on assistant microphone, if a device reports one.
- **What the app is not told:** a recorder that starts while the recitation is **already playing** and requests no focus. The app *is* now told that a recording is active, anonymised. But pausing on every reported recording, with no focus request behind it, was not built: assistant or hotword microphones may report too and would interrupt the recitation. Earlier wording in this document said Android tells apps nothing about recordings; that was wrong.

## What the emulator already showed (Android 17, AVD "Error", the emulator-only twin of this build)

These results are measured but are not a phone result. The system state was read from `dumpsys media_session`, `notification`, `audio` (players and the audio-focus stack) and `activity services`.

The other recording app was **FocusRec**, a small test app built for this: it records from the microphone and requests focus like a voice-note app (`GAIN_TRANSIENT`), exclusively, or not at all.

**Before this build (previous test APK):**
- **Recording while playing:** paused, but it **resumed by itself** when the recording ended.
- **After a pause and resume from the notification or headphones:** the app played **without holding audio focus**, so a recording **didn't pause it**. This reproduced your report.
- **Background recitation:** stopped at the end of Al-Fatiha until the app was reopened.
- **Swipe-away after "stop in the app, then 1+ minute in the background, then play":** **didn't stop**. Android had idle-stopped the playback service ("Stopping service due to app idle"), and a service in that state never receives the swipe.

**This build:** the checks below ran on an emulator twin of the APK.
- **First pass:** a build that, by accident, also contained the other uncommitted work.
- **Re-run on the exact source of this APK** (6efacac plus this round's changes), with identical native code:
  - recording pauses and doesn't resume;
  - the reader's play resumes from the same position;
  - a system-controls resume followed by a recording pauses;
  - the swipe stops everything, even from the background;
  - external play after closing does nothing;
  - no crash.
- **Not re-run on that source:** the idle-stop sequence (adb couldn't operate this build's stop control). Its native code is identical to the build it passed on.
- **Focus while playing:** the app holds long-form focus (`GAIN`, previously `GAIN_TRANSIENT`).
- **Recording while playing**, with `GAIN_TRANSIENT` or `GAIN_TRANSIENT_EXCLUSIVE`: paused at once. Still paused 16 s after the recording ended, with focus back with the app. The app showed paused. Pressing play (the headphones, labelled "Play"), or the notification's play, resumed from the same position.
- **Pause and resume from the system controls, then record:** focus is kept and the recording pauses it. It doesn't resume afterwards.
- **Recording started 0.2, 0.5, 1 and 2 s after pressing play** (audio starts about 0.5–0.8 s after the tap): nothing played during the 20 s recording or after it. A control run without recording played.
- **Recording started the moment the next file began loading** (background, Al-Fatiha → Al-Baqarah): stayed paused on 2:1 during the recording and after it.
- **A recorder that requests no focus:** the recitation kept playing, as expected (the limitation above).
- **Background recitation** continued from Al-Fatiha into Al-Baqarah without opening the app.
- **Play pressed, then a recording started 0.1 s later; the app reopened 6 s into the recording, which was still running:**
  - **Before the stale-start fix:** the recitation was already playing while the recorder was in front. The system focus log showed the recitation requesting focus after the recorder. FocusRec received `AUDIOFOCUS_LOSS` and the recitation played over it.
  - **After:**
    - Nothing played in front of the recorder or after returning to the app.
    - The recorder kept focus (no loss), and the Quran app made no focus request.
    - The app logged `active recordings on the device: 1`, the other app's recording.
    - It showed paused ("Play") and stayed paused after the recording ended.
    - Pressing play during a recording played.
  - **Re-checked after this change:** a normal start, and a recording while playing (paused, no resume).
- **Swipe-away:**
  - Still works after a stop, an idle stop of the service and a new play.
  - External play keys after closing did nothing.
  - Reopening and playing works. No crash.
- **The final phone APK** installs and launches on the emulator without a crash.

**Not testable on the emulator:**
- real voice-note apps (WhatsApp, Telegram, vendor recorders);
- phone calls;
- real Bluetooth (car auto-play, the disconnect pause);
- navigation ducking;
- a per-ayah reciter's transition (covered by unit tests only);
- listening to the audio;
- other Android versions and manufacturer builds;
- the cold-start page after a recitation (C1).
