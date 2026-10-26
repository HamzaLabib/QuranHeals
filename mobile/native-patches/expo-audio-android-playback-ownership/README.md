# Native patch: the app owns its audio on Android (expo-audio 57.0.5)

**Status (2026-10-25): applied to `node_modules`, built into a local release APK, and measured on the Android 17
emulator (swipe-away, external media keys, the load race, reopening). Physical-phone test pending** (see "Device test"
below). Android only: no iOS file is touched.

## Why

| Symptom (Android) | Root cause |
|---|---|
| Audio keeps playing after the app is swiped away from Recents | Media3 1.9.0's default `MediaSessionService.onTaskRemoved` stops the service only when nothing plays (bytecode: `isPlaybackOngoing() && isAnySessionPlaying()` → return). expo-audio does not override it, so the foreground service, ExoPlayer and the app's JavaScript stay alive, and the engine keeps loading and playing the next ayahs. |
| A car's Bluetooth auto-play restarts audio after the app was closed | The same live process still has the media session; the car's PLAY reaches ExoPlayer directly, and the engine follows it as a lock-screen resume. |
| Leaving the car: audio carries on through the phone | ExoPlayer is built without `setHandleAudioBecomingNoisy(true)` (iOS pauses on a lost route by itself). |
| Another app's voice recording doesn't pause the recitation, or the recitation resumes by itself afterwards (2026-10-25) | expo-audio's AudioModule released audio focus whenever ExoPlayer stopped for a moment: any pause, every rebuffer, seek or ayah load. It asked for focus again only on JavaScript's `play`. A resume from the notification, lock screen, headset or car, or ExoPlayer resuming after a rebuffer, then played **without focus**, so a recording never reached it (reproduced on the emulator). With focus, it paused on a recording but **resumed by itself** when focus came back (`isPaused` → `play()` on `AUDIOFOCUS_GAIN`). It also requested `GAIN_TRANSIENT`, a type meant for short sounds. |
| Swipe-away didn't stop playback after a stop and a minute in the background (2026-10-25) | Android stops a started, non-foreground service of an idle app ("Stopping service due to app idle"). The service stayed only bound, and promotion back to the foreground never re-started it, so `onTaskRemoved` never came. |

## What it changes

Closing is enforced natively for the whole process (`QuranHealsPlaybackGate.kt`), never only by a JavaScript callback.

| File | Change |
|---|---|
| `QuranHealsPlaybackGate.kt` (new, copied in) | A process-wide gate. `close()` sets it closed and closes every live AudioPlayer. It opens again only when an activity of the app resumes (`ActivityLifecycleCallbacks`), so only reopening the app opens it. |
| `AudioPlayer.kt` | `setHandleAudioBecomingNoisy(true)`. Each player registers with the gate, and unregisters on release. While the gate is closed: `setMediaSource` refuses (a load or next ayah gets no source), `setActiveForLockScreen(true)` refuses (no controls, no service start), and a `playWhenReady` listener pauses any play at once, whoever asked: JavaScript, a notification action, a media session, a car or a headset. `closeForRemovedTask()` pauses, stops and clears the media items (a play that slips through has nothing to play), drops the controls flag, and sends `quranHealsTaskRemoved: true` to JavaScript. |
| `service/AudioControlsService.kt` | `onUpdateNotification` does nothing while the gate is closed: Media3 reports the session's last changes as it is released. Without this guard, Android refused a background `startForeground()` once on the emulator. `onTaskRemoved` closes the gate, removes the listener and the notification, releases the session (`stopForeground(REMOVE)`), unbinds every player and calls `stopSelf()`. In `onStartCommand`, a media button or notification action arriving with no app attached stops the service again. The app's own start (the `MediaSessionService` action) is left alone. |

**Audio focus (`QuranHealsAudioFocus.kt`, new, copied in), the app's only focus owner:**
- **expo-audio's own focus is off:** `requestAudioFocus` and `releaseAudioFocus` return at once.
- **Every play asks for long-form focus first** (`AUDIOFOCUS_GAIN`, no delayed gain), whoever asked for it. `AudioModule`'s `play` checks before playing, and the player's `playWhenReady` listener catches every other play (notification, session, car, a rebuffer).
- **Focus is kept while paused,** as ExoPlayer does. It is given back when playback is over (`clearLockScreenControls`: stop, the end of a single ayah) or the app is closed.
- **On a loss (`LOSS`, `LOSS_TRANSIENT`):** every player pauses, JavaScript is told (`quranHealsInterrupted`), and the app is **interrupted**. No play is allowed until the reader asks for one: `quranHealsClaimPlayback` from the app's buttons, the media session's `play()` / `setPlayWhenReady(true)` (notification, lock screen, headset, car), or the old notification actions. Focus coming back changes nothing.
- **A refused request** (during a call) interrupts too.
- **Ducking** is left to Android, with no pause.
- **Stale starts:**
  - A start the reader asked for **before** another app began recording never takes that recording's focus. Recordings are followed through `AudioRecordingCallback`, anonymised, and a newly started one is timed.
  - `mayPlay` refuses, and interrupts, when the reader's last claim is older than the latest recording start.
  - Reproduced on the emulator before this fix: play pressed, a recorder started 0.1 s later, and the recitation took the recorder's focus and played over it.
- **Limitation:** a recorder that requests no focus while the recitation already plays is not acted on. Android reports *a* recording, but pausing on that report alone was not built, because assistant microphones may report too.

**Kept started:** every promotion to the foreground for playback also calls `startService` (`quranHealsEnsureStarted`), so a swipe always reaches `onTaskRemoved`.

**Ordering:** `onTaskRemoved` runs on the main thread, and every JavaScript call into the player (`play`, `replace`, `seekTo`) is also run on the main thread. A JavaScript call therefore lands either before the close, which then undoes it, or after it, where the gate refuses it.

**JavaScript side:** `expoOutput.ts` maps the field to `OutputStatus.closed` and forgets its lock-screen state. `engine.ts` stops (a pending load or next ayah never plays) and pauses any playback it did not ask for.

**Reopening:** after `stopSelf()` and the unbind, the next play starts the service afresh: the binding is UNBOUND, so `bindWithService` runs `startService` with the app in the foreground. If the process ended instead, everything starts from scratch.

**Background playback is unchanged:** Home, Back, screen off and another app don't remove the task. Lock-screen and notification play/pause are still followed both ways.

## Commands

`apply.mjs --check | --apply | --verify | --revert`, the same way as `../expo-audio-exact-mp3-seek` (19 edits, 2 copied files). `AudioModule.kt` is shared with that patch: `--revert` here undoes only this patch's edits there. Revert this patch before the VBR one. `postinstall` applies the patch, and `eas-build-post-install` verifies it. It requires `expo.autolinking.android.buildFromSource` to include `expo-audio`, which it already does. The fingerprint runtime version changes, so binaries built before it never receive JS updates made after it.

## Device test

The steps are in `docs/audio/android-ownership-device-test-2026-10-25.md`.
