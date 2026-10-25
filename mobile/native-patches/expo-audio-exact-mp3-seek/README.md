# Native patch: exact seeking in VBR MP3 files (expo-audio 57.0.5)

**Status (2026-10-24, owner-approved development test):**

| Platform | Verification | `VBR_SEEK_DEVICE_VERIFIED` |
|---|---|---|
| iOS (`'avfoundation-precise'`) | **Verified on a physical iPhone.** EAS development build `f9ada32f…` from an isolated copy (`C:\qhb-ios\mobile`); the patch strings were found in the IPA's executable; the owner listened and approved platform-level DEV verification (`docs/audio/ios-vbr-dev-build-2026-10-24.md`). | `true` |
| Android (`'index'`) | **Emulator measurements passed; listening on a physical device pending.** One debug development client from an isolated copy (`C:\qhb\mobile`), measured on the emulator (`docs/audio/vbr-native-dev-build-2026-10-24.md`). | `false` (disabled) |

- The VBR timing still loads in development builds only (`__DEV__` is false in a release, whatever the binary), and
  the device-test flag `EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST` counts only in development builds (`vbrSeek.ts`).

**Integrated into the main project (2026-10-24).** Every binary built from `mobile/` now carries the patch; it only
changes playback of sources the app marks, and the app marks none unless the capability checks in `vbrSeek.ts` pass:
- `package.json` `postinstall` runs `apply.mjs --apply` after every `npm install` / `npm ci` (local, CI and EAS), so the
  locally computed fingerprint runtime version matches the one EAS builds, as `eas update` requires.
- `package.json` `eas-build-post-install` runs `apply.mjs --verify`: the EAS build stops unless all six edits are present,
  `XingTocStrippingDataSource.java` is byte-identical, and both platforms build expo-audio from source.
- `apply.mjs` refuses any expo-audio other than 57.0.5, so an upgrade fails the install instead of shipping unpatched.
- Patched sources are byte-identical to those of the tested builds (`C:\qhb-ios\mobile`, EAS `f9ada32f` iOS and
  `2df4712e` Android). Fingerprints after a clean `npm ci` (Windows, 2026-10-24): Android `38f1e416…` → `80848c9e…`,
  iOS `c1843132…` → `72410942…`. Binaries built before this change never receive an update made after it.
- `npm run postinstall` re-applies; `apply.mjs --revert` restores the original expo-audio (then remove the
  `buildFromSource` setting and the two scripts to go back entirely).

**Required: build expo-audio from source.** Expo SDK 57 links expo-audio as a precompiled library
(`node_modules/expo-audio/local-maven-repo`). A build without the setting below contains none of the patch, which was
verified on a first build. The main project's `package.json` has it:

```json
"expo": { "autolinking": { "android": { "buildFromSource": ["expo-audio"] }, "ios": { "buildFromSource": ["expo-audio"] } } }
```

`apply.mjs --check` prints a NOTE when this is missing; `--verify` fails.

**Android build used** (debug, x86_64, development client, before the integration):
1. `robocopy` `mobile/` to `C:\qhb\mobile`, outside OneDrive.
2. `apply.mjs --apply`, then the `buildFromSource` setting above (copy only).
3. `CI=1 npx expo prebuild --platform android --no-install`, then restore the copy's `package.json` scripts.
4. Debug-only Norton trust: `android/app/src/debug/res/xml/network_security_config.xml` + `res/raw/norton_root.pem`, referenced from the debug manifest.
5. `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT ./gradlew assembleDebug -PreactNativeArchitectures=x86_64`.

The APK is archived in `%USERPROFILE%/Backups/quran-heals-vbr-dev-build-20261024/`.

**iOS build used** (EAS development build, isolated copy, `post-install` hook running `apply.mjs`): step by step in
`docs/audio/ios-vbr-dev-build-2026-10-24.md`, "How it was built".

## Why it is needed

Thirty-two MP3Quran files of Islam Sobhi (29), Yasser Mahmoud Salama (42, 48) and Ahmed Al-Agamy (42) are LAME VBR
with a Xing table of contents. expo-audio cannot seek them to an ayah:

- **Android.** `ProgressiveMediaSource` uses media3 1.9.0's default `Mp3Extractor`, which interpolates the 100-point
  Xing table. On these files the label of the frame reached after a seek is wrong by up to **2.6 s (Yasser 48), 4.6 s
  (Agamy 42) and 7.0 s (Sobhi 17)** (real extractor on the JVM, every ayah start).
  `FLAG_ENABLE_INDEX_SEEKING` alone does nothing: in 1.9.0 it applies only when the file's own seeker is not seekable,
  and a Xing seeker with a table is seekable.
- **iOS.** `AVURLAsset` is created without `AVURLAssetPreferPreciseDurationAndTimingKey`. The unpatched player's VBR
  seeking accuracy on iPhone was never measured; the patched build was verified by listening (Status above).

No JavaScript setting reaches either: the fix is native.

## What it changes (marked sources only)

A source plays through the patch only when the app passes the header `X-Quran-Heals-Mp3-Seek: index`. The header is
removed before any request. Every other source, including every CBR file and every production recording, is built
exactly as before.

| Platform | Change |
|---|---|
| Android | `XingTocStrippingDataSource` serves the stream with the first frame's Xing header **without its table of contents**: the flag is cleared, the fields after it move up, and zeros pad the frame to its own length. The Xing seeker keeps the exact duration (frame count) but is no longer seekable, so `FLAG_ENABLE_INDEX_SEEKING` makes media3 build an exact time-to-byte index. Nothing is stored; every byte after the first frame is the original, at its own position. Constant `quranHealsExactMp3Seek = "index"`. Adds `media3-extractor` (same version) to expo-audio's dependencies. |
| iOS | `AVURLAssetPreferPreciseDurationAndTimingKey: true` for marked sources. Constant `quranHealsExactMp3Seek = "avfoundation-precise"`. **Verified on a physical iPhone** (Status above). |

The app (`src/audio/vbrSeek.ts`, `reciters.ts`) uses the VBR timing (`generated/vbrTiming.ts`) only when:
- it is a development build;
- the binary reports the constant;
- that platform's method is marked verified (`VBR_SEEK_DEVICE_VERIFIED`), or the device-test flag `EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST=1` is set.

## Evidence (desktop, before any build)

`test/StripTest.java` runs the patch's own `XingTocStrippingDataSource` with the real media3 1.9.0 classes (JVM,
`android.jar` stubs, `test/android/net/Uri.java` stand-in), on all 32 VBR files.

**Byte checks.**
- The whole stream served equals the reference rewrite byte for byte.
- Opens at 13 positions (inside the ID3 tag, inside the Xing frame, at and after the head, mid-file, near the end) serve the same bytes.

**Extractor checks.**
- `IndexSeeker` is chosen, with the Xing duration.
- At every one of 1,148 ayah starts, the first sample kept after a seek carries its true time to within **0.06 ms**.
- It lands at most **26 ms** (one frame) after the target, the same as the CBR production path.

**Not covered by these desktop checks.** Decoder, audio sink and device timing; network behaviour; iOS (verified
later on an iPhone, see Status).

## Use (after approval only)

```bash
node native-patches/expo-audio-exact-mp3-seek/apply.mjs --check    # anchors found, nothing written
node native-patches/expo-audio-exact-mp3-seek/apply.mjs --apply    # edits node_modules/expo-audio (keeps *.qh-orig)
# then a native development build (EAS or local), with EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST=1 for the device test
node native-patches/expo-audio-exact-mp3-seek/apply.mjs --revert   # undo, then rebuild
```

`npm install` reinstalls the unpatched expo-audio. The patch is deliberately not wired into `postinstall` or EAS, so a
build made for another reason never includes it by accident. Wire it in only once the device tests pass and the owner
decides.

## Known costs

- **Android, cold far seek.** The index is built as the file is read. A seek past the read part downloads up to that point before audio starts: about 1 MB per minute of these files, e.g. about 28 MB to start Sobhi 21 at its last ayah. Later seeks within the read part are immediate.
- **iOS.** Precise timing may make AVFoundation read much of the file before it is ready to play: measure the load time.
