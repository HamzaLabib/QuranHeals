# Quran audio

Recitation in the Mushaf (play from a page, Listen from an ayah, automatic page turning),
a play button on the ayah screens, Settings → Quran → Favorite Reciter, and optional
offline downloads. MP3Quran is the provider; which recordings and surahs may be played is
decided by the audit in [source-audit.md](source-audit.md).

## Where things live (`mobile/src/audio/`)

| File | Role |
|---|---|
| `generated/reciterCatalog.ts` | Generated from `tools/quran-audio/audit-results.json`: the 17 reciters, each recording's folder, surahs recorded, where its timing comes from (`timingSource`), and per timed surah its timing fingerprint and file size. Do not edit by hand. |
| `generated/measuredTiming.ts` | Generated from `tools/quran-audio/measured-timing.json`: ayah timing measured by the audit for MP3Quran recordings that have no usable MP3Quran timing (Ali Al-Hudhaifi). Do not edit by hand. |
| `reciters.ts` | Catalogue helpers, the default and fallback reciter (Muhammad Siddiq Al-Minshawi), and `OFFLINE_DOWNLOADS_PERMITTED`. |
| `quranSequence.ts` | Canonical order (next/previous ayah across surahs, ends after An-Nas 6), a page's first ayah, an ayah's page. |
| `timing.ts` | Fetches MP3Quran timing, accepts it only if it matches the audited fingerprint and is well formed, stores it on the device. Measured timing is read from `generated/measuredTiming.ts` and verified the same way (never fetched or stored). |
| `engine.ts` | **The one playback engine**: a single store and a single native player for the whole app. |
| `expoOutput.ts` | expo-audio adapter: one `AudioPlayer`, background audio, lock-screen play/pause, exact seeks. |
| `sources.ts` | Provider seam: a downloaded file first, else MP3Quran's stream. |
| `downloads.ts`, `storage.ts`, `downloadStatus.ts` | Offline downloads (user-started, verified, resumable per surah) under `<documents>/quran-audio/`, and the Settings icon's state. **Turned on** (`OFFLINE_DOWNLOADS_PERMITTED = true`, owner decision 2026-10-24, on MP3Quran's published reuse statement; no recording-specific written permission). |
| `favoriteReciterPreference.ts`, `useFavoriteReciter.tsx` | The Favorite Reciter setting (device-local, like Keep Screen Awake; not synced). |
| `usePlayback.ts`, `format.ts`, `index.ts` | Hooks, labels, wiring. |

UI: `components/MushafAudioPlayer.tsx` (chip and window), `components/ReciterList.tsx`,
`components/AyahAudioButton.tsx`, `components/ReciterDownloadControl.tsx`, the Listen row
in `components/MushafAyahPopups.tsx`, and the wiring in `app/(tabs)/mushaf.tsx`,
`app/settings.tsx` and `components/AyahCard.tsx`.

No audio is bundled with the app and nothing is stored in MongoDB. The backend is not
involved.

## Behaviour

- **Play (headphones in the Mushaf's top bar).** Starts at the first ayah of the page shown
  and continues ayah after ayah and surah after surah. It stops after An-Nas 6. A surah's
  ayah 1 starts at the file's start, so the istiʿādha and Basmala are included. While
  playing, the headphones give way to the player's chip: its own Pause, then the Sheikh's
  name and the ayah number (a separate tap opens the window; its arrow is ⌄ closed, ⌃
  open). Paused, stopped, finished or stopped by an error, the chip goes and the
  headphones are back: a tap resumes from the paused position, retries after an error, or
  plays the page. Touch and hold the chip's Pause (or a paused recitation's headphones), or
  use the screen reader's Stop action, to stop and close the player.
- **Both reading modes.** The headphones, the chip and the window work the same in Normal
  Mode and full screen; switching modes never restarts or reloads the recitation.
- **Manual page changes** (swipes, the page selector, the Surah / Juz / Hizb lists) only change
  the page shown: a recitation carries on, never skips to that page, and stops being
  followed until Follow recitation (or a return to the recited page).
- **The audio window** (a tap on the chip), top to bottom: the Sheikh's name with its
  arrow (⌄ closed, ⌃ open; the 17 reciters, current one highlighted, coverage shown), the
  Surah and ayah being recited («سورة الفاتحة · الآية ٧» / "Al-Faatiha · Ayah 7"), its
  progress through the surah, then — from the right, in every app language (the Mushaf's
  direction) — Previous page, Previous ayah, Play/Pause, Next ayah, Next page (page jumps
  are double chevrons; previous glyphs point right, next glyphs left). The page buttons move
  the recitation itself: from the page being recited (not the page merely shown) to the
  adjacent page's first ayah, played at once (from a pause too), and the page follows
  again; unavailable while page 1 / page 604 is recited. No close
  button: a tap outside or Back hides it, without stopping the recitation; pausing from
  inside it keeps it open. Previous/Next play that ayah at once (also from a pause),
  across surahs and pages, and the page follows it; they are unavailable at Al-Fatiha 1
  and An-Nas 6. Directional icons are separate glyphs per direction, never mirrored or
  rotated with a style transform (react-native-svg would move the glyph out of its box).
- **Listen (ayah popup, fifth action after Reflection, Save, Copy, Share).** Starts at that
  ayah and continues the same way. The Apply-to-ورد popup (an ayah's number) is unchanged.
- **Voice.** Play and Listen use the reciter currently in the player (including an up-next
  choice). Otherwise they use the Favorite Reciter. Choosing in the player never changes
  the setting, and closing the player drops that choice.
- **Page turning.** While following, the page turns when the recitation reaches the next
  page's first ayah. It waits until any open popup, sheet or guide is closed. A swipe or
  jump elsewhere stops following (the page is never pulled back). Follow recitation in
  the chip, or swiping back to that page, resumes it. The recited ayah is highlighted
  with the selection highlight.
- **Changing the reciter during playback.** The current ayah always finishes in its own
  voice; the new reciter is shown as "Up next" and takes over at the next ayah. Repeated
  changes keep the last one. Next/previous applies it at once. Pausing keeps it. A
  reciter without a verified recording of the coming surah is refused with a notice. If
  playback reaches a surah the current voice lacks, it stops with a message. Another
  voice is never substituted.
- **Ayah screens.** The play button beside Copy plays the displayed ayah once in the
  Favorite Reciter, then stops. It offers pause and play again. Leaving the ayah stops it.
- **Failures.** Network failures retry twice by themselves (after 1.5 s and 4 s), then
  show Try again, which restarts the ayah from its start. Timing that no longer matches
  the audit is refused.
- **Listening never touches reading progress:** no ورد, Khatma or last browsed page is
  saved by playback or by automatic page turns.
- **Background.** Audio continues with the screen locked and in other apps (iOS
  `UIBackgroundModes: audio`; Android media-playback foreground service). Play/pause shows
  on the lock screen and in Android's media notification. expo-audio offers no
  next/previous track buttons there. Calls and other interruptions pause playback, and the
  player follows the device's state.

## Offline downloads

**Turned on** since 2026-10-24: the owner's decision (Hamza) to enable downloads on the basis
of MP3Quran's published reuse statement (https://www.mp3quran.net/eng/privacy, "Copyrights").
No recording-specific written permission has been obtained. Only MP3Quran catalogue files can
be stored (`tools/quran-audio/providers.mjs` grants offline storage to no other provider);
development previews from other providers never download. Setting `OFFLINE_DOWNLOADS_PERMITTED`
back to false turns downloads off: the icon then shows as unavailable and nothing can start,
while files already stored can still be deleted.

The sheet shows the real coverage: "the complete Quran" only for a reciter whose 114 surahs
all have verified timing (and, once downloaded, only when all 114 are stored); otherwise
"{n} of 114 surahs" and the list of surahs not included.

A small icon beside Settings → Quran → Favorite Reciter (the offline Mushaf row's own icons:
Download, a spinner while downloading, the accent check once every playable surah is
stored and verified, the alert after a failure); a tap opens a small sheet. Only the Favorite Reciter can be downloaded, and only
its surahs with verified timing (any missing ones are listed before downloading). The size
is shown first. Wi-Fi is recommended: on mobile data or an unknown connection the app asks
first. A download shows progress and can be paused, resumed, cancelled or retried. Each
file is verified (exact size and MP3 header) before it counts, and timing is stored with
it. After a restart, a download continues from the next unfinished surah. Files go in the
app's documents directory, not the cache. Total storage and per-reciter deletion are
shown. Nothing downloads by itself.

## Native build impact

`expo-audio` (~57.0.5) is a new native module, configured in `app.json` with the microphone
and recording **disabled** (`microphonePermission: false`, `recordAudioAndroid: false`):

- iOS gains `UIBackgroundModes: [audio]` and no microphone usage string.
- Android gains `MODIFY_AUDIO_SETTINGS`, `FOREGROUND_SERVICE` and
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, plus expo-audio's media-playback service; no
  `RECORD_AUDIO`.

**New iOS and Android binaries are required.** The runtime-version fingerprint changes, so
an OTA update cannot reach existing builds. Google Play will ask for the media-playback
foreground-service declaration in the Play Console.

## Device checks still to do

Automated tests cover the engine rules, catalogue, timing verification, downloads,
Settings and the Mushaf wiring. None of the following has been run on a device or
emulator yet:

1. Playback starts, and page 3's Play begins at 2:6 (audibly: «إِنَّ ٱلَّذِينَ كَفَرُوا۟»).
2. Seeking lands at the ayah start on iOS (AVPlayer) and Android (ExoPlayer) with
   MP3Quran's CBR files.
3. The page turns at the right moment across a page boundary (e.g. 2:5 → 2:6).
4. A reciter change mid-ayah takes effect only at the boundary, with a short gap.
5. Lock screen, phone call, headphones unplugged, app in background for more than
   3 minutes (Android).
6. Airplane mode with a downloaded surah plays; without one, it shows the network
   message.
7. Download pause, resume, cancel, delete, and restart mid-download.
8. Maher Al-Muaiqly's riwaya: listen at 18:1–2 and 36:52 for Hafs's sakt (Quran Foundation labels
   the same performance Hafs; MP3Quran labels it only «المصحف المجود»).
9. Ali Al-Hudhaifi (measured timing): a few ayah starts and single-ayah stops, including a
   surah's last ayah and a page turn (see source-audit.md, "Listening checks").
10. The boundaries listed for review in source-audit.md ("Boundaries left for review").
11. Mushaf layout unchanged with the chip shown (page size, QCF glyph positions),
   compared against the approved screenshots.
