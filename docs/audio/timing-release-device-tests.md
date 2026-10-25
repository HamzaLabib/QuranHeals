# Releasing reviewed, VBR and timed-preview timing: device tests

Release builds play reviewed, VBR and timed-preview ayah timing only from `mobile/src/audio/generated/timingRelease.ts`.
That file is written by `tools/quran-audio/development/generate-timing-release.mjs`, and only for surahs that pass
every gate:

- timing fingerprint;
- review;
- integrity;
- provider permission;
- attribution;
- a physical-device record for that exact timing.

The generator does not change the development files, and nothing is ever released by a tool on its own.

Status on 2026-10-24: 0 of 399 reviewed, 0 of 27 VBR and 0 of 177 timed-preview surahs released.
- Reviewed and VBR fail only `devices`.
- Timed previews also fail `provider` and `attribution`: Way2Quran and Assabile do not permit streaming, and archive.org
  and QuranicAudio are not recorded providers.

## The record

`tools/quran-audio/development/timing-device-tests.json` is written by the owner from real device sessions. Never
fill it from tests, emulators or memory.

```json
{
  "kind": "audio-timing-device-tests",
  "entries": [
    {
      "reciterId": "banna", "surah": 2, "fingerprint": "f57a611f", "bytes": 129018069,
      "android": { "passed": true, "device": "Pixel 7 (Android 16)", "testedOn": "2026-11-02", "build": "EAS <build id>", "runtime": "80848c9e", "nativeSeek": "index", "checks": ["ayah-starts", "full-surah", "background"] },
      "ios": { "passed": true, "device": "iPhone 14 (iOS 26)", "testedOn": "2026-11-02", "build": "EAS <build id>", "runtime": "72410942", "nativeSeek": "avfoundation-precise", "checks": ["ayah-starts", "full-surah", "background"] }
    }
  ]
}
```

- `runtime` and `nativeSeek` come from the build line at the bottom of Settings → Quran Sources & Credits on the
  tested phone. `nativeSeek` must be that platform's patched player (Android `index`, iOS `avfoundation-precise`):
  `none` means an unpatched binary, and its result does not count.
- A timed-preview entry also needs `"url"`, the exact file URL from `timedPreview.ts`.
- One entry per reciter and surah. Duplicates, a malformed file or an unknown `kind` release nothing.
- **Limit:** the generator checks that `runtime` is present and well formed, but cannot compare it with the binary you
  will ship. When native code changes (a new runtime on the build line), test the released surahs again on the new
  binary and update their entries: this is procedure, not enforced by the tool.
- `fingerprint` and `bytes` must equal the surah's current values in `reviewedTiming.ts`, `vbrTiming.ts` or
  `timedPreview.ts`. If the timing is regenerated, the entry no longer matches and the surah must be tested again.
- **Reviewed (CBR) surahs and timed previews** need Android **and** iOS.
- **VBR surahs** are released per platform that passed, and their checks must also include `far-seek`. The app plays
  them only on a binary whose exact-seek method is device-verified (`VBR_SEEK_DEVICE_VERIFIED` in
  `mobile/src/audio/vbrSeek.ts`; Android `index` is still `false`).

## What counts as passing, per surah and platform

Use a production-profile or preview build that contains the patch (`apply.mjs --verify` ran in its EAS log), not a
development build with the test flag.

| Check | Pass |
|---|---|
| `ayah-starts` | From a stopped player, start at least 3 ayahs (the first, one in the middle, the last). Each begins on its own first word: nothing missing, nothing of the previous ayah, highlight on that ayah. The player names the reciter under test, not Al-Minshawi. |
| `full-surah` | Full Surah plays to the end; every ayah is highlighted in turn; it stops after the last ayah. |
| `background` | Lock the screen mid-surah for 2 minutes: audio and ayah advance continue; the lock-screen controls show the reciter. |
| `far-seek` (VBR only) | Start the last ayah directly: note the seconds until audio; the first word is correct. |

## Then

1. Run `node tools/quran-audio/development/generate-timing-release.mjs --report <file.json>` from the repository root.
   It prints how many surahs are released and which gates still fail.
2. Review the diff of `timingRelease.ts`, run the mobile tests (`audioTimingRelease.test.ts` checks the file equals the
   generator's output), and build a new release candidate.

The full device programme, including the player tests that are separate from these recording checks, is in
`docs/release-device-checklist.md`. Its section C proposes an evidence standard.

**Scale:** a per-surah record for all 399 reviewed surahs is a large test effort. A sampled, per-reciter or
platform-level standard would be an owner decision that changes the `devices` gate in the generator. It has not been
made, so the gate stays per surah.

## Class records: the minimum device evidence (2026-10-25)

The device gate checks **native playback compatibility**: that this app's patched player, on this platform, handles a
kind of file from a host. Timing accuracy is checked per surah by the review gates, not here. So besides per-surah
entries, the generator accepts one record per **playback class**:

| Class | What it covers | Samples per platform | Extra check |
|---|---|---|---|
| `mp3quran-cbr` | the 399 reviewed-timing surahs (MP3Quran CBR files) | 2 reviewed surahs, different reciters | — |
| `mp3quran-vbr` | the 27 VBR surahs | 2 VBR surahs (e.g. `yasser-salama:48`, `ajmi:42`) | `far-seek` |
| `host:way2quran` | 105 timed previews from Way2Quran | 2 | — |
| `host:assabile` | 10 timed previews from Assabile | 2 | — |
| `host:archive` | 61 timed previews from archive.org | 2 (e.g. one Sobhi, one Talib) | — |
| `host:quranicaudio` | 1 timed preview (`ajmi:42`) | 1 | — |

```json
{
  "kind": "audio-timing-device-tests",
  "entries": [],
  "classes": [
    { "class": "mp3quran-cbr",
      "android": { "passed": true, "device": "…", "testedOn": "YYYY-MM-DD", "build": "EAS <id>", "runtime": "8 hex", "nativeSeek": "index", "checks": ["ayah-starts", "full-surah", "background"], "samples": ["banna:2", "yasser-salama:1"] },
      "ios": { "passed": true, "device": "…", "testedOn": "YYYY-MM-DD", "build": "EAS <id>", "runtime": "8 hex", "nativeSeek": "avfoundation-precise", "checks": ["ayah-starts", "full-surah", "background"], "samples": ["banna:2", "yasser-salama:1"] } }
  ]
}
```

- Every sample must be a real member of that class. A sample from another class, too few samples, or two records for
  one class release nothing.
- A class pass is **player evidence** for that class and platform. It never says a surah was listened to, and the
  release report names the basis: `class mp3quran-cbr verified …`.
- VBR on Android additionally needs `VBR_SEEK_DEVICE_VERIFIED.index = true` (`mobile/src/audio/vbrSeek.ts`), which is
  your approval after the Android listening test.
- Ali Jaber's per-ayah recording has its own record, `tools/quran-audio/per-ayah/device-tests/jaber.json` (kind
  `per-ayah-device-tests`; android and ios each `{ passed: true, background: true, device, testedOn }`).

**Where to test.** Release builds contain only released surahs, so the first tests use the existing patched
development clients (Android `2df4712e`, iPhone `f9ada32f`) with Metro. They load every layer and use the same patched
player. Record each result with that client's build line. Then generate the release and build the release
candidate, and re-check one sample per class on the candidate (`docs/release-device-checklist.md`, section B).
