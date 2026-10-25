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

## What it changes

Closing is enforced natively for the whole process (`QuranHealsPlaybackGate.kt`), never only by a JavaScript callback.

| File | Change |
|---|---|
| `QuranHealsPlaybackGate.kt` (new, copied in) | A process-wide gate. `close()` sets it closed and closes every live AudioPlayer. It opens again only when an activity of the app resumes (`ActivityLifecycleCallbacks`), so only reopening the app opens it. |
| `AudioPlayer.kt` | `setHandleAudioBecomingNoisy(true)`. Each player registers with the gate, and unregisters on release. While the gate is closed: `setMediaSource` refuses (a load or next ayah gets no source), `setActiveForLockScreen(true)` refuses (no controls, no service start), and a `playWhenReady` listener pauses any play at once, whoever asked: JavaScript, a notification action, a media session, a car or a headset. `closeForRemovedTask()` pauses, stops and clears the media items (a play that slips through has nothing to play), drops the controls flag, and sends `quranHealsTaskRemoved: true` to JavaScript. |
| `service/AudioControlsService.kt` | `onUpdateNotification` does nothing while the gate is closed: Media3 reports the session's last changes as it is released. Without this guard, Android refused a background `startForeground()` once on the emulator. `onTaskRemoved` closes the gate, removes the listener and the notification, releases the session (`stopForeground(REMOVE)`), unbinds every player and calls `stopSelf()`. In `onStartCommand`, a media button or notification action arriving with no app attached stops the service again. The app's own start (the `MediaSessionService` action) is left alone. |

**Ordering:** `onTaskRemoved` runs on the main thread, and every JavaScript call into the player (`play`, `replace`, `seekTo`) is also run on the main thread. A JavaScript call therefore lands either before the close, which then undoes it, or after it, where the gate refuses it.

**JavaScript side:** `expoOutput.ts` maps the field to `OutputStatus.closed` and forgets its lock-screen state. `engine.ts` stops (a pending load or next ayah never plays) and pauses any playback it did not ask for.

**Reopening:** after `stopSelf()` and the unbind, the next play starts the service afresh: the binding is UNBOUND, so `bindWithService` runs `startService` with the app in the foreground. If the process ended instead, everything starts from scratch.

**Background playback is unchanged:** Home, Back, screen off and another app don't remove the task. Lock-screen and notification play/pause are still followed both ways.

## Commands

`apply.mjs --check | --apply | --verify | --revert`, the same way as `../expo-audio-exact-mp3-seek`. `postinstall` applies the patch, and `eas-build-post-install` verifies it. It requires `expo.autolinking.android.buildFromSource` to include `expo-audio`, which it already does. The fingerprint runtime version changes, so binaries built before it never receive JS updates made after it.

## Device test

The steps are in `docs/audio/android-ownership-device-test-2026-10-25.md`.
