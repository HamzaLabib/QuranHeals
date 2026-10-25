# Release device checklist (full feature scope)

One list of every physical-device test the release still needs, grouped by what each needs. Emulators, the Node test
suite and successful packaging do not count as device evidence. Record results only from real devices, and never mark
a check passed without doing it.

**Record the binary for every result.** Use the line at the bottom of **Settings → Quran Sources & Credits**, for
example `v1.0.0 · runtime 80848c9e · embedded · exact MP3 seek: index`. Copy it with each result.

Expected on binaries built from this revision (clean-install fingerprints, 2026-10-24):

| Platform | Runtime | Exact MP3 seek |
|---|---|---|
| Android | `80848c9e` | `index` |
| iOS | `72410942` | `avfoundation-precise` |

If a later commit changes native configuration, the runtime changes too: record whatever the build line shows.

**Data safety.**
- Never uninstall an app whose data you need: uninstalling deletes it.
- Tests marked **fresh install** need a device or account you can wipe.
- Use dedicated test Apple and Google accounts for sign-in and deletion.

---

## A. Possible now with the existing development clients (no new build)

| Client | Build | Where |
|---|---|---|
| Android | EAS `2df4712e`, patched, all ABIs, installs over the preview build | `C:/Users/hamza/Backups/quran-heals-android-vbr-dev-build-20261024/` (checksum OK) |
| iPhone | EAS `f9ada32f`, patched | already on both iPhones |

Both load the **current** JavaScript from Metro, so they exercise this revision's app code on a patched player. They do
not test the release binary (section B).

### A1. Android exact-VBR listening

Follow `docs/audio/android-vbr-listening-test-2026-10-24.md` exactly: Metro on 8082 with `EXPO_PUBLIC_AUDIO_VBR_SEEK_TEST=1`.

**Pass:** every row passes, and the player names the reciter under test (never Al-Minshawi).

**Afterwards:** on your approval only, `VBR_SEEK_DEVICE_VERIFIED.index` becomes `true`. That is platform evidence for
the player, not for individual recordings (section C).

### A2. Offline recitation downloads (Android and iPhone)

Start Metro normally, without flags. On a phone with at least 2 GB free:

| # | Step | Pass |
|---|---|---|
| D1 | Settings → Favorite Reciter → Al-Minshawi; tap the download icon | The sheet says "107 of 114 surahs, about … GB" and lists the surahs not included; it never says "complete Quran" |
| D2 | Favorite Reciter → Abdul Basit; open the sheet | "Download the complete Quran … all 114 surahs" |
| D3 | On mobile data, tap Download | It asks first; Cancel starts nothing |
| D4 | On Wi-Fi, Download Abdul Basit; watch | Progress shows surahs done and a percentage; the icon becomes a spinner |
| D5 | Pause, then Resume | It stops, then continues from the next unfinished surah; no surah counts until verified |
| D6 | Airplane mode mid-download | An error with Try again; back online, Try again continues |
| D7 | Force-quit mid-download, reopen | It shows partly downloaded; Download continues from where it stopped |
| D8 | When done | The check icon appears; "Downloaded: the complete Quran (114 surahs) · <size>" |
| D9 | Airplane mode, force-quit, reopen; play 2:255, 36:1 and 114:1 with Abdul Basit | Plays from the device, highlight follows, no network error |
| D10 | Delete (confirm) | Files are removed; the storage total drops; the icon returns to Download |
| D11 | Storage full (optional: a near-full device) | A storage message, no crash, nothing shown as downloaded |

### A3. Password-speed benchmark (development clients)

1. Start Metro with `EXPO_PUBLIC_KDF_BENCHMARK=1` (PowerShell: `$env:EXPO_PUBLIC_KDF_BENCHMARK='1'; npx expo start --dev-client --clear`).
2. Open the app and wait about a minute.
3. The Metro terminal prints `[pbkdf2] native|js 210000 iterations: …ms` and `… 600000 iterations: …ms`, three times each.
4. Record the median of each, per device, and whether it says `native` or `js`.

| Device | Pass (proposed; your decision) |
|---|---|
| Slowest supported Android | 600,000 with `native` ≤ 1.5 s |
| Slowest iPhone | 600,000 with `native` ≤ 1.5 s |
| Web (if reflections unlock on web; `npx expo start --web`) | Record the `js` time. Development JS is slower than production, so a production web check is also needed before deciding. |

If a device shows `js` on iOS or Android, the native module is missing from that build: report it, don't time it.

The result decides whether `DEFAULT_KDF_ITERATIONS` rises for **new** wraps. Existing keys keep their stored count,
and no reflection is affected.

### A4. Offline Mushaf automatic download (preview build)

Use the existing preview APK `678279fd`, only on a device whose Quran Heals data can be lost, because it needs a
fresh install. Run P1–P7 in `docs/mushaf-device-testing.md`, "Production automatic offline download".

**Pass:** all seven on Android **and** iPhone (an iPhone preview build would be needed).

**Afterwards:** on your approval only, `PRODUCTION_AUTO_DOWNLOAD_RELEASED = true` (`mobile/src/mushaf/offline/autoDownloadConfig.ts`).
The tests for the released state already exist (`mushafAutoDownload.test.ts`).

---

## B. Needs fresh release-candidate binaries (EAS preview or production profile from the final commit)

**Not started (paid builds).** For each build:
- Confirm the EAS log shows `verified: expo-audio 57.0.5 patched (6 edits, 1 file) and built from source on android and ios`.
- Confirm the build line matches the table above. Its exact-seek method comes from the compiled native module, so
  `index` / `avfoundation-precise` (not `none`) proves the patch is in that binary, not only in the sources.

| # | Area | Steps | Pass |
|---|---|---|---|
| B1 | Launch | Fresh install, guest | Home loads; no crash; Settings opens |
| B2 | Reading | Emotion → ayah; Quran list; Mushaf pages 1, 2, 61, 300, 604; zoom; full screen; Juz'/Hizb navigation | Every page draws with its own font; navigation correct |
| B3 | Catalogue audio | Maher 2:255 from stopped; Repeat ×2; Full Surah on 112; Previous/Next; lock the phone 2 min during 2:255 | Each ayah starts on its first word; continues while locked; lock-screen shows the reciter |
| B4 | Fallback | Favorite Reciter Islam Sobhi; play 37:1 | Al-Minshawi recites; Favorite Reciter stays Sobhi |
| B5 | Memorization Mode | Settings → Quran → Memorization Mode on; Eye on page 61; hide/reveal, hold for Show All / Hide All; page 604 controls; the guide; turn it off | Matches the guide; off removes the Eye; nothing else changes |
| B6 | Meanings / Surah Preview | Open both sheets on page 2 in English and Arabic; Settings → Meanings off | Content shows; Arabic right to left; off hides the Meanings button |
| B7 | Downloads | Repeat A2 D1, D4, D8, D9 on the binary | As in A2 |
| B8 | Offline Mushaf, manual | Settings → Offline Mushaf → Download; airplane mode; read | Pages offline |
| B9 | Credits | Quran Sources & Credits | MP3Quran, Quran Foundation, King Fahd, Tafsir Center and Quranpedia credited; build line correct |
| B10 | Reminders, sharing | A reminder fires; Share Studio image of an ayah | Works as before |

---

## C. Recording-specific listening checks (per surah; releases timing)

Separate from the player tests above.

- **Recording and timing validation** is already per surah and automatic: the audited file and size, review
  acceptance, and fingerprint recomputed from the deltas. The generator checks it.
- **Player capability** (CBR seeking, VBR exact seeking, background) is per platform and per binary: sections A1
  and B.
- **Listening a surah** proves only that surah.

Procedure and record format: `docs/audio/timing-release-device-tests.md`. Each entry binds reciter, surah,
fingerprint, size (and URL for timed previews), platform, device, date, build, runtime and the build line's exact-seek
method. You write it by hand; no tool writes or approves it.

Checks per surah and platform:
- **`ayah-starts`:** the first, a middle and the last ayah begin on their first word, with the reciter named.
- **`full-surah`:** plays to the end, highlights in turn, stops after the last ayah.
- **`background`:** locked for 2 minutes, it continues.
- **VBR also `far-seek`:** start the last ayah directly and note the delay.

### Proposed evidence standard (a decision for you; not implemented)

Today's gate requires a passed per-surah record on both platforms. That is the most direct evidence, but costly
across 399 surahs. A practical alternative that keeps the meanings separate:

1. **Release condition:** per-surah validation (automatic, already done) **and** the platform player record for
   that playback class (CBR, or VBR on that platform) on the release runtime **and** a per-reciter listening sample:
   - at least 3 surahs per reciter: the longest, the shortest, and one with a Reviewer 1 correction or repaired
     boundary;
   - every surah whose acceptance is **automatic only** (nobody listened) gets at least its first and last ayah
     heard.
2. **Labels stay honest:**
   - "timing reviewed (Reviewer 1 / automatic)" per surah;
   - "player verified on Android/iOS" per platform;
   - "listened on device" only for surahs actually heard.
   - A sampled surah is never called listened or verified.
3. **Re-test triggers:** new timing (fingerprint change), a new file, or a new runtime (native change) invalidates
   the affected records.

Adopting it means changing the generator's `devices` gate and the record format. Ask for it explicitly; until then
the per-surah gate stays.

---

## D. Apple and Google sign-in and account deletion

**Needs:** the backend deployed with `POST /api/auth/challenge`, plus release-candidate binaries. Google's native
redirect needs the real client IDs in the EAS environment. Keep `AUTH_NONCE_REQUIRED` unset or `off` throughout.

| # | Steps | Pass |
|---|---|---|
| S1 | iPhone: Sign in with Apple (test Apple ID), first time | Signed in. Render log: `auth: apple sign-in bound to a challenge (nonce raw)` or `(nonce sha256)`; the newest `authchallenges` document has `consumedAt` and `consumedForm`. **Record which form**: it settles how Apple's native flow signs the nonce. |
| S2 | Android and iPhone: Sign in with Google (test account) | Signed in. Log: `auth: google sign-in bound to a challenge (nonce raw)` |
| S3 | Web (if offered): Sign in with Google | The popup opens on the first tap (not blocked); log shows bound |
| S4 | Cancel the provider sheet, then sign in again | The second attempt succeeds (a new challenge); no error shown for the cancel |
| S5 | Airplane mode, tap Sign in, then back online and retry | A clear failure, then success; never stuck loading |
| S6 | Two devices, same account | Favorites, preferences, Wirds and reflections (after the sync password) sync both ways |
| S7 | Delete account, Apple (credential stored at sign-in) | Deleted; Apple ID settings → "Sign in with Apple" no longer lists Quran Heals |
| S8 | Delete account, Google | Asks for a fresh Google sign-in, then deletes; signing in again creates a new account |
| S9 | An older installed build (any from before this change) signs in | Still works: log `not bound to a challenge` (proves compatibility while enforcement is off) |

**After S1–S3 pass, and only when every supported build sends challenges:** set `AUTH_NONCE_REQUIRED=on` and repeat
S1, S2 and S9. S9 must then fail, which is expected.

---

## E. Summary of what each result unlocks

| Result | Unlocks (each still needs your explicit approval) |
|---|---|
| A1 | `VBR_SEEK_DEVICE_VERIFIED.index = true` |
| A3 | A decision on `DEFAULT_KDF_ITERATIONS` |
| A4 | `PRODUCTION_AUTO_DOWNLOAD_RELEASED = true` |
| B (all) | Submission of that binary, together with the open permissions |
| C records | Rerun `generate-timing-release.mjs`; review the `timingRelease.ts` diff |
| D S1–S3, S9 | Later, `AUTH_NONCE_REQUIRED=on` |
