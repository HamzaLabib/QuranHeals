# Agamy 42, Yasser 48, Islam Sobhi: engineering the remaining gaps (2026-10-24)

Local only: nothing committed, built, deployed or published. The review dashboard, its review logs and ledgers were
only read. Scope is limited to Islam Sobhi's missing surahs, Yasser Mahmoud Salama 48 and Ahmed Al-Agamy 42.

## Development coverage

| Reciter | Before | Now (current dev client) | After the native patch + device verification |
|---|---:|---:|---:|
| Ahmed Al-Agamy | 113 | **114** | 114 (42 then from MP3Quran's own file) |
| Yasser Mahmoud Salama | 113 | 113 | **114** (+48) |
| Islam Sobhi | 88 | **104** | **106** (+99, +108) |

Every other reciter is unchanged (before/after below). Release builds are unchanged: 1,148 surahs.

## Still unavailable

| Surah | Blocker |
|---|---|
| Yasser 48 | MP3Quran's file is VBR. Native exact seeking is prepared (below); it needs a build and device tests. The only CBR copies found are a different performance (1/23 pieces); they were not used with the old timestamps. |
| Sobhi 99, 108 | VBR originals, verified clean (text, structure, openings); waiting on the native patch. The CBR copies are unusable: 99's is a broken stream; 108's has junk before its first frame and comes from an item labelled as another reciter. |
| Sobhi 17 | Unresolved structure. The two alignment configurations disagree by 5.0–12.7 s at 17:22, 58, 88 (extra audio). Seen in the original and in its CBR copy, which is also a different edit. Needs a person. |
| Sobhi 24 | Unresolved structure. Configurations disagree by 3.1–11.2 s at 24:9, 34, 37, 41, 42, 57. The copy and the accepted timing disagree by 1.7 s (24:34) and 5.1 s (24:57). Needs a person. |
| Sobhi 74 | The original's opening may be clipped: sound in its first 50 ms, recitation level within 100 ms. The copy is a broken VBR stream. Needs a person to listen. |
| Sobhi 109 | The original begins at full recitation level (opening clipped; ayah 1 itself complete from 1.9 s). The copy has audio before it that runs into the recitation, so its start cannot be located by measurement. Needs a person. |
| Sobhi 37 | No complete recording in his voice. islamicbulletin 037 is his voice (97 % of windows) but a damaged VBR stream, and partial: text fails from about 37:67. Way2Quran 037 is mostly other voices (27 % Sobhi); 037-001 ends at 37:102. |
| Sobhi 39 | No complete recording. aldorar's «سورة الزمر» is his voice (100 %) but only 39:71–75 match. The archive.org takes start at 39:47. Way2Quran 039 is Yasser Al-Dosari's voice (56/60 windows). |
| Sobhi 40 | archive.org «سورة غافر (كاملة)»: his voice (100 % of windows, 0.86) and complete text, but the alignment is unresolved. Configurations disagree by 3.0, 9.9 and 15.9 s at 40:15, 16, 34, and five starts cut into the ayah's first sound (40:32, 63, 64, 68, 71). Needs a person on those 8 starts. Way2Quran 040 is Yasser Al-Dosari's voice. |
| Sobhi 45 | Voice not established. islamicbulletin 045 is 45 % his windows, mixed with others; Way2Quran 045 is 55 %. |

## What was done

### Agamy 42

The 279 ms "discrepancy" at 42:29 is one shallow pause, not a conflict. In the quranicaudio CBR copy (the same performance, 33/33 pieces both ways):
- ayah 28 ends by 557.85 s;
- the quiet run lasts 557.90–558.30 s;
- ayah 29 is voiced from 558.35 s.

The copy's aligner put the start at 558.30 s (no pause found). A recorded repair (`surah-sources/boundary-repairs.json`) moves it to 558.02 s, which is also the accepted original start at the measured offset. 42:2 and 42:33 lie inside their pauses in the copy.

The accepted timing of MP3Quran's original was found to start 42:33 **80 ms into the ayah's first sound**. A second repair, for the original's file, moves it into the pause (607.20 s). It is used only by the VBR route.

### Islam Sobhi: the copies with an introduction (21, 25, 29, 38, 47, 48, 49, 52, 110, 111)

Each copy is the same performance as the MP3Quran file at a constant lag of 9.6–15.3 s.
- The audio before the lag ends in silence (digital zero, or at least 25 dB down).
- The first recitation sound after the lag falls where the original's does, within 20 ms.

So the recitation's opening is at the lag. The app now plays ayah 1 from that **opening point**: a new optional per-surah field, `openingMs`. It is absent for every existing surah, which keeps 0:00.

The timing is each copy's own fresh alignment, cross-checked against the original's accepted timing. Both agree within 30 ms, except 21 and 38, where the differences lie inside pauses. 48's own aligner put ayah 1's onset in the silence before the recitation, so it takes the original's accepted timing moved by the offset (`transfers`), allowed only while the copy's own alignment agrees within 100 ms (here 20 ms).

### Islam Sobhi: other copies (98, 100, 104–107)

These are the same performance at constant offsets of −480 to +20 ms; the "partly" verdict before was an artefact of short files. Their own alignments agree with the accepted timing within 20 ms.

100 and 104 squeezed ayah 1 in their own alignment. They take the original's accepted timing by offset; for 100 that is Reviewer 1's reviewed timing.

### Clipped-onset check on every new start

`cliptest.py` checks 1,689 starts: all 27 VBR originals and all 24 copies.
- Three late starts were repaired from the other independent timing: 21:3 (120 ms) and 21:98 (60 ms) in the original, 21:27 (60 ms) in the copy.
- Two flags remain:
  - 21:22, at most 20 ms: within the one-frame landing tolerance of every seek;
  - 38:37: a false positive, the start lies in a low unvoiced stretch.

### Native VBR seeking (Android implemented and desktop-verified; iOS prepared and unverified)

See `mobile/native-patches/expo-audio-exact-mp3-seek/README.md` and `DEVICE-TEST-PLAN.md`.

**The defect.** media3 1.9.0 (expo-audio 57.0.5) seeks these files through the interpolated Xing table, up to 7.0 s wrong. Its index-seeking flag is ignored while the Xing seeker is seekable.

**The fix.** A DataSource (Android) serves the stream with the Xing table removed in the first frame. Media3 then uses its exact index seeker, and the original file is unchanged.

**Desktop verification** (real extractor, 32 files, 1,148 ayah starts):
- every frame time is exact to 0.06 ms;
- it lands at most 26 ms after the target;
- the served bytes are identical to the reference rewrite.

**Scope.** Only for sources the app marks with a header, which the native player strips. Behind capability detection in the app: a development build, a patched binary, and a device-verified method or the test flag. In tests, release builds and today's binaries it is inert.

**iOS.** The patch sets `AVURLAssetPreferPreciseDurationAndTimingKey` for marked sources. Its accuracy is unknown until measured on an iPhone.

## Approval needed

1. **Native development build.** Apply the patch, then build an Android and an iOS development client.
2. **Device tests.** Run `DEVICE-TEST-PLAN.md` on both platforms, then flip `VBR_SEEK_DEVICE_VERIFIED` per platform.
3. **Dashboard import.** The new packages are pending import into the dashboard (`Working progress/Audio packages pending import/ajmi-42-cbr-2026-10-24`, `sobhi-cbr-copies-2-2026-10-24`), as before.
4. **Rights.** None of the copies' hosts grants app use: archive.org items carry no licence, and quranicaudio allows personal use only. Development only.

## Preservation (before → after)

**Baseline.** Captured before any change:
- `tests/fixtures/audio-baseline-2026-10-24.json`: every playable surah's fingerprint, size and file, in development and release composition;
- SHA-256 of 2,100 audio data, review and package files;
- the full test run.

**Coverage.** `tests/audioBaselineProtection.test.ts` passes. Every baseline surah keeps its timing fingerprint, size and file; release is identical; additions are only Sobhi's missing surahs and Agamy 42; no count decreased.

| Reciter | DEV before | DEV after |
|---|---:|---:|
| Minshawi, Husary, Abdul Basit, Banna, Sufi, Ahmed M. Salama, Hudhaifi, Shuraim, Maher, Shatri, Jaber, Basfar, Naina | 114 each | 114 each |
| Ahmed Al-Agamy | 113 | 114 |
| Islam Sobhi | 88 | 104 |
| Yasser Mahmoud Salama | 113 | 113 |
| Saleh Al-Talib | 69 | 69 |

**Files.**
- Of the 2,100 baseline files, changed: `generated/timedPreview.ts` and `surah-sources/stream-urls.json`, additions only.
- Added: `generated/vbrTiming.ts` and 16 new review packages.
- Removed: none.
- No review log, acceptance or override ledger, registry or inventory file changed.

**Code paths.**
- CBR: `ayahStartMs` returns exactly what it did unless `openingMs` is set. The registry's CBR test is unchanged; a VBR file becomes ayah-ready only with the explicit `vbrIndexSeek` mark. The output passes `{ uri }` exactly as before unless the URL is listed.
- Regression tests: `audioVbrSeekAndOpening.test.ts` and `audioOpeningPoint.test.ts`.

## Tests

- **Targeted audio tests:** pass.
- **Full suite:** 201 of 204 files pass.
  - The 3 failures (`audioSingleReview`, `mushafAutoDownload`, `offlineFonts`) pass when run alone: CPU-load timeouts, as recorded before.
  - The earlier unrelated failures from other sessions now pass.
- **TypeScript:** 0 errors.
- **Lint:** 0 problems.
