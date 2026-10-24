# Device test plan: exact VBR seeking (after an approved native build)

Owner-run. Do every step on **one Android device or emulator** and **one physical iPhone**. Record the results in
`tools/quran-audio/development/device-tests.json` (or a note): date, device, OS, build id, step and result.

## 0. Build (needs the owner's approval)

1. `node native-patches/expo-audio-exact-mp3-seek/apply.mjs --check`, then `--apply`.
2. Build a development client for Android and for iOS.
3. Start Metro with `EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST=1 npx expo start --dev-client --clear`.

Without the variable the VBR surahs stay unavailable, even on the patched binary.

## 1. The capability is detected

Settings → reciter list, development build:

| Reciter | Without the patch or flag (today) | With both |
|---|---|---|
| Islam Sobhi | 104 of 114 | 106 of 114 (+99, +108) |
| Yasser Mahmoud Salama | 113 | 114 (+48) |
| Ahmed Al-Agamy | 114 (42 from the quranicaudio CBR copy) | 114 (42 from MP3Quran's own file) |

All other reciters: unchanged counts. Any other change is a failure: stop.

## 2. Seek accuracy (the core test)

For each case below:
1. Start playback at the ayah from the Mushaf page (tap the ayah, then Play), from a stopped player.
2. Listen to the first second.

**Pass:**
- the first words heard are the ayah's own first words;
- nothing of the previous ayah is heard;
- the first syllable is not cut;
- the highlight is on that ayah.

| Case | Why |
|---|---|
| Yasser 48:2, 48:15, 48:29 | the only route for 48 |
| Agamy 42:29, 42:33 (repaired starts), 42:53 (last) | repaired boundaries, far seek |
| Sobhi 21:3, 21:50, 21:112 | 28 MB file, far seek (Sobhi 17 is excluded) |
| Sobhi 99:1, 99:5; 108:2 | the two surahs that only this patch enables |
| Sobhi 57:10 | an original that replaces a CBR copy |

**Android, measured.** Run `tools/quran-audio/audit/seek-lab` on the emulator: WASAPI loopback capture plus end-of-burst analysis.
- Pass: every start within **60 ms** of the timing (the Phase 4.8.5 policy).
- Today's unpatched build would be seconds off on the same cases. Measure one of them first, as a control.

**iPhone, by ear and screen recording.**
- Same pass criteria.
- If any case is clearly off, the iOS method fails: leave `VBR_SEEK_DEVICE_VERIFIED['avfoundation-precise']` false.

## 3. Load time (records the costs)

| Platform | Case | Record |
|---|---|---|
| Android | cold start at Sobhi 21:112 on Wi-Fi and on mobile data | seconds until audio |
| iPhone | Sobhi 21:1, and 21:112 | seconds until audio |

The app gives up after 20 s (`LOAD_TIMEOUT_MS`). Record it if that happens.

## 4. Playback features with VBR files

| Test | Pass |
|---|---|
| Repeat Ayah ×2 on Sobhi 21:50 | the same ayah twice, each from its start |
| Full Surah: Sobhi 99 | follows every ayah and stops after the last |
| Continuous across files: Sobhi 98 (CBR copy) → 99 (VBR original) → 100 (CBR copy) | the highlight follows; each surah starts at its own opening |
| Reciter switch: Sobhi 99 → Maher | Maher plays the same ayah |
| Background and lock screen: play Yasser 48, lock the phone, wait 2 minutes | playback and the ayah advance continue |

## 5. Regression: CBR playback must be unchanged

| Test | Pass |
|---|---|
| Maher 2:255 (production CBR) start | as before |
| Minshawi: a whole Mushaf page | as before |
| Ahmed Mohamed Salama 1 (timed preview, CBR) start | as before |
| Sobhi 21 (CBR copy with an introduction), with the flag OFF | plays from the recitation's opening at 11.95 s, never the introduction |
| Talib 12 (archive.org) start | as before |

## 6. Decide

- **All of 2–5 pass on a platform:** set that platform's entry in `src/audio/vbrSeek.ts` `VBR_SEEK_DEVICE_VERIFIED` to true. Then the flag is no longer needed for that platform.
- **Any failure:** keep it false. Optionally `apply.mjs --revert` and rebuild.

Nothing here touches release builds: the VBR timing loads only in development builds.
