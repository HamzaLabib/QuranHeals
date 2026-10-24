# VBR exact seeking: native development build and tests (2026-10-24)

Owner-approved development testing. No production build, no OTA update, nothing committed, pushed or published. The
live review dashboard was only read.

## Builds

| Platform | Result |
|---|---|
| Android | **Built**: debug development client, x86_64, with the patch, from an isolated copy (`C:\qhb\mobile`). Installed on the `Error` AVD (emulator-5560) with `install -r`, app data kept. The previous client and its data are backed up in `%USERPROFILE%/Backups/quran-heals-pre-vbr-build-20261024T130419Z/android-Error/`; the new APK is in `…/quran-heals-vbr-dev-build-20261024/`. |
| iOS | **Not built**: this is a Windows machine with no Mac. Steps are below. Nothing about iOS seeking is verified. |

**Found and fixed during the build: the first APK contained none of the patch.** Expo SDK 57 links expo-audio as a
precompiled AAR. `expo.autolinking.android.buildFromSource: ["expo-audio"]` (set in the build copy only) makes Gradle
compile the patched sources. The rebuilt APK contains `XingTocStrippingDataSource`, the constant and the marker, and the
patched Kotlin compiled. `apply.mjs --check` now warns when the setting is missing.

**Isolation.** The main tree's `node_modules` and `package.json` are untouched. The temporary test screens (`seek-lab`,
`vbr-check`) exist only in the build copy. The debug-only Norton trust lives in the copy's `android/app/src/debug`.

## Android: is the patch active?

- **Binary.** The installed binary reports `quranHealsExactMp3Seek = "index"`. The marker header never reached the lab server, so it is stripped before any request.
- **App with `EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST=1`.**
  - Development coverage: Ahmed Al-Agamy 114, Yasser Mahmoud Salama 114, Islam Sobhi 106, Saleh Al-Talib 69, every other reciter 114. The order is the approved 17.
  - 27 files are marked for exact seeking: Sobhi 25, Yasser 48, Agamy 42.
- **Without the flag** (tests, release, unpatched binaries): Agamy 114, Yasser 113, Sobhi 104, and nothing marked.

## Android: seek accuracy (seek lab)

**Method.**
- The emulator's audio output is recorded through WASAPI loopback.
- Each burst's end is located in the decoded MP3Quran original and compared with the player's reported position.
- Capture blocks with a discontinuity are excluded.
- Targets lie 1–9 s inside the requested ayahs, so the cut falls in voiced audio.
- Each run's latency is calibrated by unseeked bursts and by CBR files.
- **Pass mark: ±60 ms.**

| Recording (patched, original VBR file) | Clean bursts | Error after calibration |
|---|---:|---|
| Yasser 48 (ayahs 2, 15, 29; 3 each) | 9 | −8 to +2 ms (calibrated by the run's unseeked burst); −48 to −24 ms (by its CBR bursts) |
| Agamy 42 (ayahs 29, 33, 53) | 3 | −21 to −13 ms |
| Sobhi 21 (ayahs 3, 50, 112; the 112 seek is 23 min into the file) | 7 | −24 to −14 ms |
| Sobhi 99 (ayahs 2, 5) | 3 | −22 to −7 ms |
| Sobhi 108 (ayah 3) | 3 | −20 to −13 ms |
| Sobhi 57 (ayah 10) | 3 | −18 to +3 ms |
| **Controls: the same files, unpatched** | 6 | **−3.6 s, −1.8 s, −1.6 s, −1.2 s, −1.1 s, +1.6 s** |

- **Calibration.** Unseeked bursts and CBR bursts disagree by up to about 25 ms within a run, which bounds the method's resolution. Every patched burst is within 60 ms under either calibration.
- **Not measured** (no clean burst): Sobhi 99:8 and 108:2. Earlier runs at low emulator volume or with capture drop-outs were discarded.
- **Desktop evidence.** The real extractor on all 32 files, 1,148 ayah starts: exact to 0.06 ms, landing at most 26 ms after the target.

## Android: the app's own playback path (engine → timing → source → marker → native)

A temporary screen ran 22 cases through `audioEngine`:

| Check | Result |
|---|---|
| Start at the requested ayah: Yasser 48:2, 15, 29; Agamy 42:29, 33, 53; Sobhi 99:2, 5, 108:2, 3, 21:50 | every case reached `playing` at the requested ayah and advanced to the next ayah at the right moment |
| CBR regression: Maher 48:15, 48:29 (production); Minshawi 99:2, 1:1 (production); Ahmed Salama 112:1 (timed preview); Talib 12:2 (archive.org copy) | every case played and advanced as before |
| Repeat Ayah on Sobhi 99:5 | played and moved on to 99:6 (a repeat does not change the position, so this log cannot count repetitions) |
| Full Surah, Sobhi 108 | 108:1 → 108:2 → 108:3 → ended (did not run into 109) |
| Next / Previous on Yasser 48:15 | 48:15 → 48:16 → 48:15 |
| Reciter switch during Sobhi 99:2 to Maher | took effect at the next ayah boundary (99:4, Maher) |
| Continuous across files: Sobhi 98:8 → 99:1 | crossed into 99, the next file, as expected |
| Background and lock screen: Yasser 48 (patched VBR) | the media session stayed `PLAYING` after Home and with the screen off; audio was continuous for 60 s; ayah changes kept the timing's own lengths (21.0 / 25.6 / 31.8 / 8.5 s observed against 20.9 / 25.6 / 31.9 / 8.5 s) |
| Mushaf screen during VBR playback | player chip "Yasser Mahmoud Salama · 2"; 48:2 highlighted on page 511 |

- The app-path audio offsets could not be measured: the capture clock drifted with drop-outs, so correlations stayed below 0.7. App-level accuracy therefore rests on the seek lab, which uses the same native call with the same marker.

**Start-up delay** (time until the engine reports `playing`, Wi-Fi through Norton):

| Case | Delay |
|---|---|
| Most cases, VBR included | 0.3–0.7 s |
| Agamy 42:33 | 3.2 s |
| Agamy 42:53 (cold, 16 min into a 20 MB VBR file) | 8.0 s |
| Existing CBR: Maher 48:15 (first request) | 5.2 s |
| Existing CBR: Talib 12 (archive.org) | 10.4 s |

The far cold seek costs what the patch's index seeking predicts. Whether 8 s is acceptable is the owner's call; it is
within the app's 20 s load limit.

**Not checked by ear.** That each ayah begins with its first word, with nothing missing or duplicated, is supported by the
timing work (alignment, the clipped-onset check, cross-checks) and the measured seek accuracy. **Nobody has listened** on
the patched build.

**Native crash: React Native, not audio, present before the patch.** A SIGSEGV in React Native Fabric's
`MountingCoordinator::pullTransaction` on the JS thread (`mqt_v_js`). The emulator's crash records (`dumpsys dropbox
data_app_native_crash`) hold **four** of these, not one, all with the same stack:

| Time (2026-10-24) | Installed client |
|---|---|
| 08:05:16 | the previous, unpatched client (install path `~~ieNUnS…`, replaced at 09:23) |
| 10:16:55, 10:22:46, 10:31:20 | the patched client (`~~fjpIF80…`) |

- `libreactnative.so` in the backed-up previous client and in the patched APK is **byte-identical** (same SHA-256, BuildId
  `0ee9df27…`). The patch changes only expo-audio.
- None of the four stacks (99 frames each) contains an audio, media3 or ExoPlayer frame: Fabric commit → mount →
  `pullTransaction`, called from Hermes.
- Three of the four fall in 10:16–10:31, when JS bundles were being reloaded and another session's Metro was switching
  the client (see Interference).

Conclusion: no evidence of an audio regression. It is a development-mode Fabric crash that the unpatched client had
already shown. The previous client was not reinstalled for a comparison run: the crash record already gives that
comparison, and a reinstall would put the emulator's app data at risk.

**Interference.** Another session (Surah Preview, on the owner's request) loaded its Metro onto emulator-5560 twice
around 10:20–10:30. Those runs were discarded and repeated, and the session has stopped.

## iOS: exact steps (owner)

1. On the main tree, after approval: add the `buildFromSource` setting (README) to `mobile/package.json`, plus a post-install hook so EAS applies the patch:
   `"eas-build-post-install": "node native-patches/expo-audio-exact-mp3-seek/apply.mjs --apply"`.
2. Register the iPhone: `npx eas device:create`.
3. Build: `npx eas build --profile development --platform ios`.
4. Install the build on the iPhone.
5. Start Metro on the Mac or PC: `EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST=1 npx expo start --dev-client`.
6. Run `native-patches/expo-audio-exact-mp3-seek/DEVICE-TEST-PLAN.md` §1–5. The reciter list must show Yasser 114 and Sobhi 106; otherwise the binary is not patched.
7. Leave `VBR_SEEK_DEVICE_VERIFIED['avfoundation-precise']` false unless every case starts on its first word with nothing of the previous ayah. Load time on long files matters here, because precise timing may read much of the file first.

## Dashboard import rehearsal (not applied)

**Snapshot.** `pre-ajmi-sobhi-import-20261024T131025Z`: 1,431 files, verified, chains intact. It was restored twice
into scratch, and the current dashboard code was run on ports 8781/8782. Every writable path was in the rehearsal
folder.

| | Without the packages (A) | With `ajmi-42-cbr` + `sobhi-cbr-copies-2` (B) |
|---|---:|---:|
| Recordings | 1,143 | 1,159 (+16: Agamy 42, Sobhi 21, 25, 29, 38, 47, 48, 49, 52, 98, 104–107, 110, 111) |
| Starts accepted automatically | 37,101 | 37,675 (+574 = the new recordings' starts) |
| Starts reviewed by Reviewer 1 | 9,469 | 9,469 |
| Very High awaiting / exceptions / manual queue | 144 / 287 / 431 | 144 / 287 / 431 |
| Import problems | 2 | 2 |

**What B kept intact.**
- 298 of 298 review logs byte-identical; the Rifaat data identical.
- The auto-acceptance, opening-rule and owner-override ledgers keep the snapshot as an exact prefix.
- Additions only for the 16 new recordings.
- 0 existing recordings changed.
- A second start wrote nothing.

**Found and fixed.** The timed-preview generator applied repairs, opening points and transfers only to packages not yet
in the dashboard, so an import would have reverted them. `adjust()` now applies them to both. With rehearsal B as the
dashboard, the generated `timedPreview.ts` is identical to the installed one in every file, size, fingerprint, timing
and opening point. Only the evidence text and the reviewer/automatic counts change.

**Ready for separate approval.** To import live: stop the dashboard, take a fresh snapshot, then add to `dashboard.config.json` `sources`:

```json
{ "id": "ajmi-42-cbr", "kind": "review-packages", "phase": "ajmi-42-cbr", "dir": "../../Audio packages pending import/ajmi-42-cbr-2026-10-24" }
{ "id": "sobhi-cbr-copies-2", "kind": "review-packages", "phase": "sobhi-cbr-copies-2", "dir": "../../Audio packages pending import/sobhi-cbr-copies-2-2026-10-24" }
```

Then restart the dashboard. The other three pending sets (`saleh-talib-archive`, `saleh-talib-other`, `vbr-cbr-copies`) were not part of this rehearsal.

## Tests (2026-10-24, after the build)

| Check | Result |
|---|---|
| Audio-related test files | 36 of 36 pass (543 tests), including baseline protection |
| TypeScript | 0 errors |
| Lint | 0 problems |
| Full suite | 203 of 205 files pass |

**The full-suite failures are concurrency, not regressions.**
- The 2 failing files (`homeTabsKhatma`, `myReadingScreen`) pass alone, 95 of 95.
- The 3 files that failed in the previous run (`audioSingleReview`, `mushafAutoDownload`, `offlineFonts`) passed in this one.
- The failing set changes from run to run under machine load: three emulators, Gradle, and other sessions editing shared files during the runs.
- **Re-run with 2 workers (`npx vitest run --maxWorkers=2`): 205 of 205 files, 3,670 tests pass.** The failures depend on concurrency; none is a regression.
