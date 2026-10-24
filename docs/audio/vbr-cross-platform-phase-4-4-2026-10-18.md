# VBR seeking across Android and iOS — Phase 4.4 (2026-10-18)

The question: can the app seek the 32 recovered VBR recordings to an exact ayah on Android and iOS while streaming the
**original, unmodified MP3Quran files** from their existing URLs?

**Answer:**
- **Android:** yes, but not with the app's current player as it is. It needs a small native addition: a data source that gives the player an exact seek table, while every audio byte still comes from MP3Quran's unchanged URL. This was verified with the real Android extractor; its playback-level counterpart was verified on the emulator.
- **iOS:** unknown. No iOS device or Mac was available.

Investigation only: no change to the app's player, catalogues or timing; nothing committed, built or deployed; no
recording enabled or approved. Evidence record: `tools/quran-audio/audit-data/vbr-cross-platform-2026-10-18.json`.

## A. Platform findings

**Installed versions:** Expo SDK 57.0.29, expo-audio 57.0.5, React Native 0.86.3; on Android, androidx.media3 1.9.0.

### Android (confirmed)

- **How expo-audio loads audio:** `ProgressiveMediaSource.Factory(dataSourceFactory)` with Media3's default extractors, configured nowhere. The app seeks with `seekTo(t, 0, 0)` (`mobile/src/audio/expoOutput.ts`). expo-audio offers no JavaScript API for extractor flags, the data source or seek metadata.
- **How Media3 1.9.0 chooses a seeker:** ID3 seek metadata (MLLT) first, then the seek frame (Xing, Info, VBRI), then a constant-bitrate assumption. All 32 files carry an Xing table, so Media3 uses `XingSeeker`, which interpolates a 100-entry table.
- **The seek error on the originals:**
  - **Measured on the emulator with MP3Quran's own URLs** (experiment E3): seconds early or late, matching the Phase 4.3 extractor-level prediction within 7–52 ms. That spread is within the measurement's resolution.
- **Seeks into buffered audio don't reset the error:** Media3 seeks inside its already-buffered audio (up to 50 s ahead) using the existing timestamps (`ProgressiveMediaPeriod.seekInsideBufferUs`), and otherwise reloads through the extractor. Measured on the emulator:
  - seeks to the first ayahs, inside the buffer loaded from the file's start, were exact;
  - seeks inside a buffer loaded after an earlier wrong seek **inherited that seek's error.**
  - For example, Islam Sobhi 74's last ayah came out at −0.906 s, the previous seek's error, where a fresh seek predicts +0.426 s.
  - So the error depends on buffer state. That rules out any JavaScript-side compensation.
- **No configuration fixes it** (E1): Media3's constant-bitrate and index-seeking flags change nothing for these files, because index seeking applies only when the seeker is unseekable, and the Xing table is seekable.

### iOS (unknown; source-level only)

- **How expo-audio loads audio:** `AVURLAsset(url:options:)` with only HTTP headers in the options (`AudioUtils.createAVPlayerItem`). So `AVURLAssetPreferPreciseDurationAndTimingKey` keeps its default, `false`. Seeks use `seek(to:toleranceBefore: .zero, toleranceAfter: .zero)`.
- **What Apple documents:** precise timing for some formats (MP3 among them) may require reading the entire file. Without the precise-timing key, AVFoundation may estimate positions in a VBR MP3.
- **What is not known:** whether AVFoundation reads the Xing table, an ID3 MLLT frame, or scans frames for these files; and how large the error is. That requires a device.
- **Not tested:** no Mac, simulator or iPhone was available. **Actual iOS seeking accuracy is unverified** for every option below.

### Expo constraints

Any player-side fix needs native code (a local Expo module, or a patch to expo-audio) and therefore new development and production native builds. Under this phase's rules, nothing native was built.

## B. Experimental evidence

| # | Experiment | Files | Method | Result | Reproducible |
|---|---|---|---|---|---|
| E1 | Media3 MP3 flags | Islam Sobhi 17 (original) | The real Media3 1.9.0 `Mp3Extractor` on the JVM (`audit/seek-probe`), flags 0, 1, 2, 4, 5, 7 | `XingSeeker` every time, with identical seek points: **no flag helps** | Yes: `java -Dmp3flags=N … SeekProbe` |
| E2 | Exact seek table injected in front of the unchanged stream (Option B, Android) | All 32 | Rebuilt ID3 tag (original tag + MLLT + TLEN) in memory, then the **original bytes unchanged** (`SeekProbe virtual:…`); real `Mp3Extractor` | `MlltSeeker` in 32 of 32; **4,379 seeks between −0.5 and +25.6 ms** (production constant-bitrate files measure 0 to +26.1 ms). The stream is byte-identical to the Phase 4.3 MLLT copy in 32 of 32. Seek table: 1–105 KB per file, 937 KB in all | Yes: `audit/seek-probe/README.md` |
| E3 | Real playback on the Android emulator | Islam Sobhi 17 and 74, Yasser Salama 42, each as original (MP3Quran URL), MLLT copy and CBR copy | Isolated temporary screen (removed) using expo-audio exactly as the app does. The emulator's output was captured on the host, and each burst matched against the decoded source. Clock-free end-of-burst method, about ±20–40 ms resolution | **Original:** fresh seeks −7.000 to +5.328 s, matching extractor predictions. **MLLT copy:** −35 to +1 ms. **CBR copy:** −5 to +28 ms. Details below | Yes: `audit/seek-lab/README.md` |
| E4 | Byte-range HLS playlist over the unchanged MP3 (no native code) | The same 3 files, segments on MP3Quran URLs and on local copies | 6 s segments of whole frames with exact `EXTINF`; the same lab | **Not viable:** playback stalled after 15 of 24 bursts and produced almost no audio (11 of 254 and 12 of 274 captured seconds), with both remote and local segments. Cause not established. RFC 8216 also requires ID3 timestamps in MP3 segments, which the originals lack, so iOS compliance is doubtful | Yes |

**E3 detail.** Measured start error, with the extractor-level prediction for a fresh seek (Phase 4.3) in brackets:

| Recording | Original (MP3Quran URL) | MLLT copy | CBR copy |
|---|---|---|---|
| Islam Sobhi 17 | −2.513 s [−2.490], −7.000 s [−6.985], +5.328 s [+5.353], −4.659 s [−4.614], −1.259 s [−1.207]; −4.645 s at ayah 111, inherited from the previous seek (in-buffer) [fresh: −4.392]; −0.006 s at ayah 1, in the initial buffer | −14 to −35 ms (9 seeks) | −5 to +18 ms (9) |
| Yasser Salama 42 | −0.666 s [−0.654], +1.913 s [+1.926], −4.087 s [−4.078], −0.914 s [−0.902], −0.716 s [−0.695]; −0.010 s at ayah 2, in the initial buffer | −13 to +1 ms (6)* | +8 to +26 ms (6)* |
| Islam Sobhi 74 | −0.614 s [−0.598], −0.917 s [−0.910], −0.557 s [−0.544]; −0.906 s at ayah 56, inherited in-buffer [fresh: +0.426]; +0.005 to +0.015 s in the initial buffer | not measurable (capture drop-outs; short slices matched near the targets) | +16 to +28 ms (7) |

\* Yasser Salama 42 opens with silence, so its baseline was taken as the median of the other runs (±20 ms).

E3 is an emulator measurement, not a physical-device test.

## C. Decision matrix

| | Android accuracy | iOS accuracy | Original audio preserved | Source URLs unchanged | Hosting modified audio | Native code | New native builds | Performance | Maintenance | Still to verify |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** Original files, current player | **Fails**: seconds off (measured), and the error depends on buffer state | Unknown | Yes | Yes | No | No | No | Unchanged | None | iOS (likely inaccurate) |
| **B** Original files + native exact-seek support | **Within one frame** (extractor, E2); the emulator equivalent is within about 35 ms (E3, MLLT copy = the same bytes) | Unknown. A candidate is the precise-timing key; it needs a test, and may read the whole file before seeking | Yes | Yes | No. Only a seek table (byte offsets, metadata derived from the files) is shipped | Yes: an Android data-source wrapper; iOS to be decided | Yes (dev + production) | +1–105 KB table per recording; HTTP range requests as now; no extra audio data | Medium: patch or module tied to the expo-audio / Media3 version, with regression tests | Native implementation; physical Android devices; iOS |
| **C** MLLT copies (Phase 4.3) | Within one frame (extractor); about 35 ms (emulator, measured) | Unknown; probably unchanged (iOS is not known to read MLLT) | Yes (identical decoded audio) | No | **Yes, permission needed** | No | No | +1–105 KB of tag per file | Low | Hosting rights; iOS |
| **D** CBR copies (Phase 4.3) | 0 to +26 ms (extractor); −5 to +28 ms (emulator, measured) | Expected exact (byte arithmetic), **unverified** | No: re-encoded, 24.5–39 dB SNR | No | **Yes, permission needed** | No | No | Files 35 % larger; timestamps shifted by the measured +25.06 ms | Low | Hosting rights; listening for quality; iOS |
| **E** Byte-range HLS over the original | **Fails** (stalls, no audio; E4) | Doubtful (spec violation) | Yes | Yes (playlist hosted) | No | No | No | One request per segment | Medium | Not pursued |
| **E′** JavaScript seek compensation | **Unsafe**: in-buffer seeks inherit errors (E3, source) | Unknown | Yes | Yes | No | No | No | n/a | High (tied to Media3 internals) | Rejected |

## D. Recommendation

1. **Android: Option B.**
   - **How it works:** stream the original MP3Quran file, and add a small native data source that serves an in-memory ID3 tag with the exact MLLT seek table and duration. Everything after the tag comes from MP3Quran's unchanged URL by range request.
   - **Why it ranks first:**
     - **Accuracy:** the same as the production files.
     - **Audio:** authentic and unchanged.
     - **Rights:** no modified file is hosted.
     - **Shipped data:** a seek table of at most 105 KB per recording.
   - **Evidence:** E2 at extractor level; E3 at playback level through the equivalent MLLT bytes.
   - **Cost:** native code and new builds.
2. **iOS: decide after a device test.** First measure the originals on a real iPhone with the current app. If they are inaccurate, test `AVURLAssetPreferPreciseDurationAndTimingKey = true`, which is native, for both accuracy and start-up and data cost. Only if both fail, consider a native AVFoundation loader, or Option D with MP3Quran's written permission.
3. **Until then:** the 32 stay listening candidates with `playbackBlocked`, as they are now. Their timestamps are valid on the original's timeline and need no change for Option B.
4. **If MP3Quran grants permission to host modified files,** Option D becomes the simplest cross-platform route (lossy), and Option C the lossless route for Android.

## E. Implementation plan (not started)

1. **iOS evidence first** (Mac + iOS device or simulator).
   - Play the originals with the current app build and measure decoded output against the source, as in the seek lab. The output could be captured on the Mac (e.g. a loopback audio driver), or the app could log the AVPlayer item's timing.
   - Then repeat with the precise-timing key in a throwaway native build. Measure accuracy, time to first audio and bytes downloaded per seek.
2. **Seek tables.**
   - Generate one MLLT payload per VBR recording with `audit/vbr_recover.py` (`mllt_payload`).
   - Ship them with the recording's catalogue entry (generated data, 937 KB for the 32), or serve them from the backend.
   - Record each table's file size and first-bytes fingerprint. The native side refuses the table if the live file differs, and the stream check already verifies size.
3. **Android native data source.** Probably a `patch-package` change to expo-audio, or a local Expo module wrapping its data source factory, where `ProgressiveMediaSource.Factory` is built:
   - if a table is registered for the URL, fetch the original's ID3 tag (byte range 0..tag length);
   - serve [tag + MLLT + TLEN] from memory, and map every later read to the original offset minus the inserted length;
   - otherwise, pass everything through unchanged, so the 1,148 production files are unaffected.
   - The JavaScript side registers tables by URL before loading.
4. **Builds:** a new development client, then a production build through EAS. Each needs owner approval; none was made in this phase.
5. **Tests:**
   - the JVM probe in `virtual:` mode for all 32 (already passing);
   - the emulator seek lab against the real data source;
   - at least two physical Android devices;
   - Listen to Ayah, Repeat, Full Surah, highlighting, pause and resume, and seeking between ayahs;
   - a regression of production constant-bitrate playback through the pass-through path;
   - start-up time and data per seek.
6. **Rights:** confirm with MP3Quran that streaming its original files with a locally added seek table is within its terms. No audio is redistributed, and offline downloads stay off.
7. **Release gate:** listening approval of each surah, plus the device verification above. Only then lift `playbackBlocked`, through a tooling change that is reviewed and tested like the Phase 4.3 refusal.

## Tests run in this phase

- **Executed:**
  - the real-extractor probe (flags, and the virtual stream on all 32);
  - the emulator seek lab (3 files × 3 variants, plus a rerun, plus 2 HLS runs);
  - the repository's probe source compiles;
  - `audit/test_vbr_recover.py` (5) and `alignment/test_flag_boundaries.py` (3);
  - all 12 audio test files (226 passed);
  - TypeScript and lint: clean;
  - full suite: 3,128 passed and 37 failed. The 37 are exactly the known Mushaf renderer failures.
- **Integrity:**
  - production catalogue, timing and audit data equal HEAD; the development timing is unchanged;
  - the temporary lab screen was removed, and nothing is staged.
- **Not run:**
  - any iOS test;
  - any physical Android device;
  - any native implementation.

## Changes in this phase

**New tools:**
- `audit/hls_byterange.py`;
- `audit/seek-lab/` (server, recorder, analysis, the screen as `.txt`, README).

**Changed tools:** `audit/seek-probe/SeekProbe.java` (`-Dmp3flags`, `virtual:` input) and its README; a row in `tools/quran-audio/README.md`.

**New evidence:** `audit-data/vbr-cross-platform-2026-10-18.json`.

**Scratch tooling:** `soundcard` was installed in the scratch alignment environment only.

**Not changed:**
- the app's audio code;
- the catalogues and timing;
- the review packages and verdict system;
- the Phase 4.1–4.3 results;
- the scratch audio.
