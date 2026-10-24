# Remaining missing surahs: search, verification and DEV activation (2026-10-24)

Local only. Nothing committed, pushed, built, deployed or published. The live review dashboard (127.0.0.1:8765) and every
review log and ledger were only read, never written. Release builds are unchanged: everything below is in
`mobile/src/audio/generated/timedPreview.ts`, which loads only when `__DEV__` is true.

**Result: 50 of the 123 unavailable reciter–surahs are now playable in development builds; 73 remain blocked.**

## Verification levels

| Level | Status |
|---|---|
| Source files: HTTP 200 without redirect at the recorded size; archive.org MD5; SHA-256 = the reviewed copy | all 46 new streamed files, live-checked 2026-10-24 |
| Format: CBR (Info/no Xing), no stream problems | all activated files |
| Same performance as the MP3Quran original (VBR replacements) | `compare.py` pieces in both directions, constant lag; trimmed parts of the original are silence (≥ 21 dB below the recitation) |
| VBR replacements: the copy's own alignment vs the original's accepted timing | every boundary within 100 ms of a constant offset (9 activated) |
| Voice (ECAPA window check vs MP3Quran centroids; controls Shuraim, Maher, Sudais, Juhani, Humaid, Yasser Al-Dosari) | every new Talib and Sobhi file |
| Alignment (MMS CTC, two configurations, structure, completeness) | every activated file |
| Risk policy (auto-accept-v2: only Very High needs a person) | dashboard for recordings it holds; the same rule (`riskOf`) for new packages |
| Listening | **none by me**. Reviewer 1 (Hamza) decisions exist for Ahmed Salama 1, 3, 6, 90, Sobhi 65, Talib 87, 88, 101 |
| Native playback, Android / iPhone | **UNVERIFIED** (no device test) |

## Final table

| Reciter | Before (DEV) | Discovered | Verified | Newly playable | DEV now | Still unavailable |
|---|---:|---|---:|---:|---:|---|
| Ahmed Mohamed Salama | 110 | 0 (existing recordings resolved) | 4 | 4 (1, 3, 6, 90) | **114** | — |
| Ahmed Al-Agamy | 113 | 2 CBR copies of 42 | 0 | 0 | 113 | 42 |
| Islam Sobhi | 80 | 29 CBR copies (archive.org) + Way2Quran 65 | 8 | 8 (23, 30, 57, 62, 65, 72, 95, 101) | **88** | 26 |
| Yasser Mahmoud Salama | 112 | CBR copies of 42 and 48 | 1 | 1 (42) | **113** | 48 |
| Saleh Al-Talib | 32 | 13 more archive.org `saqrsm` files; 20 files from other archive.org items | 37 | 37 | **69** | 45 |
| **Total** | | | **50** | **50** | | **73** |

### Why each remaining surah is blocked

**Ahmed Al-Agamy 42.** MP3Quran's file is VBR. quranicaudio's 160 kbps CBR file (`download.quranicaudio.com/quran/ahmed_ibn_3ali_al-3ajamy/042.mp3`) is the same performance (33/33 pieces both ways). Its own alignment disagrees with the original's accepted timing at 42:29 by 279 ms (3 boundaries over 100 ms), so neither is trusted without a person.

**Yasser Mahmoud Salama 48.** MP3Quran's file is VBR. Every CBR file found (archive.org `Yasser_Salama-MoroccoVoice`, `YasserSalama_201801`, `Yasser-Salammah`, `telawat_yassersalama`) is a different performance (1/23 pieces).

**Islam Sobhi (26).**
- 21, 25, 29, 38, 47, 48, 49, 52, 109, 110, 111: the CBR copies are the same performance but add 9.6–22.8 s of audible audio before the recitation (within a few dB of the recitation's level). Ayah 1 plays from 0:00 under the opening rule, so that audio would play first.
- 17: the CBR copy is the same performance, but 32 of its 110 boundaries disagree with the accepted timing by more than 250 ms (a different edit).
- 24: the CBR copy disagrees at 2 boundaries, by up to 5.1 s at 24:57.
- 74: the CBR copy is not the same performance (2/11 pieces).
- 98, 99, 104, 105, 106, 107, 108: the copies match only partly (4–5 of 5–6 pieces): same performance not established.
- 100: same performance, timing agrees within 11 ms, but the copy's alignment collapsed an ayah: Very High start 100:2 awaits a person. Reviewer 1's timing of the VBR original could be carried over by the offset instead (owner decision).
- 37, 39, 40, 45: no usable recording. Way2Quran's 39 and 40 are nearest **Yasser Al-Dosari's** voice (56/60 and 51/60 windows), 37 is mixed (27 % Sobhi), 45 is unresolved (55 %). No other complete take was found: islamicbulletin's 37 (792 s) and aldorar's 39 (474 s) are probably partial; 40 «كاملة» was 73 % his voice in Phase 4.6; islamicbulletin's 45 (680 s) is a lead not yet checked.

**Saleh Al-Talib (45).**
- 90, 103: a Very High start (90:13, 103:2) awaits a person (archive.org `saqrsm`).
- 108: voice not established (19 s, 2 windows, margin 0.06 over a control): Very High by the voice gate.
- 33, 36, 53: candidates fail the text check. HaramainTaleb 33 has ayahs 1–11 at near-zero scores (missing); 36 (HaramainTaleb, and Way2Quran = Assabile) has runs of failing ayahs (41–54; 61–83); 53 has scattered failures.
- 31, 40, 41, 42, 49, 50, 52, 66, 111: the only candidates (HaramainTaleb) are not consistently his voice (33–74 % of windows); 42 is also VBR.
- 23: the only file is probably partial (not processed).
- 2–11, 13, 15–18, 20, 22, 24, 26–28, 30, 35, 37, 43, 54, 64, 65, 96: no candidate found (2: MP3Quran's unlisted 002 skips passages). Leads not yet worked: the dated daily-prayer items on archive.org (`alTalib*`, `alt1439`) could hold complete short surahs (64–66, 96).

## What was done

1. **Ahmed Mohamed Salama 1, 3, 6, 90.** Reviewer 1 (Hamza) had already decided all four Very High starts on 2026-10-24 01:47–01:51Z (1:2, 3:2, 6:2 confirmed; 90:13 corrected from 62,830 to 62,330 ms). The timed preview was generated from the packages and never read the dashboard. `surah-sources/generate-timed-preview.mjs --config` now reads the dashboard's accepted timing (`acceptedTiming`, the same function as `generate-reviewed-timing.mjs`). The 110 existing surahs are byte-identical; the four use Reviewer 1's times.
2. **Talib archive.org 24 and Sobhi Way2Quran 65.** These were already fully accepted in the dashboard, blocked only by rights, which do not block a development preview. archive.org `/download/` URLs answer 302, and the app refuses redirects, so `surah-sources/stream-urls.json` maps each file to the item's storage node (`ia800606.us.archive.org/7/items/saqrsm/…`). Each mapping was checked (200, size, MD5, SHA-256). If a node moves, the stream check refuses it and nothing else plays.
3. **Talib, 13 more `saqrsm` files** (Phase 4.6 had screened them out only for too few transcription windows). Fetched (MD5 OK), aligned with `run-batch.mjs --source … --no-basmala` (new opt-in passthrough: prayer recordings recite no Basmala aloud), voice-gated, and packaged in `Working progress/Audio packages pending import/saleh-talib-archive-2026-10-24`. 10 activated.
4. **Talib, other items** (discovery: the HaramainTaleb compilation and single-surah items). Voice check, alignment and a per-ayah text and pace check (any ayah under 0.25, or a pace outlier, rejects the file). Activated: 12 (`SheikhTalibSurahs626991-114`, Fajr 12–16 Jan 2013), 19 (`SheikhTalibSurahMaryam`), 21 (`SuratAlAnbeyaShikhSalihAlTalib1436`). Packages: `…/saleh-talib-other-2026-10-24`. Note: 12 is probably several consecutive Fajr prayers joined; 12:69 (a likely join) has no pause.
5. **VBR recordings.** expo-audio 57.0.5 is unchanged: Android builds `ProgressiveMediaSource` with default extractors (no `FLAG_ENABLE_INDEX_SEEKING`), and iOS creates `AVURLAsset` without `AVURLAssetPreferPreciseDurationAndTimingKey`. Exact seeking in the originals therefore needs a native patch, a rebuild and real-device seek tests on both platforms (Phase 4.3/4.4 measured −8.3…+5.4 s on Android). Not done: native work needs approval. Instead, CBR copies of the same performances were found, checked as above, aligned, and packaged in `…/vbr-cbr-copies-2026-10-24`. MP3Quran's originals were not modified or re-encoded.

## App changes (DEV behaviour only)

- `reciters.ts` `withTimedPreview`: a reciter with a catalogue recording now gains preview surahs, but only where it has no other timing. Its `surahs` stays MP3Quran's list, so no MP3Quran URL is ever built for an unlisted surah.
- `timedPreview.ts` `isPreviewSurah`; `timing.ts`, `availability.ts` dispatch per surah; `sourceRegistry.ts` builds no MP3Quran source for a preview surah; `downloads.ts` never stores one (downloads stay off).
- `TimedPreviewSurah` records `reviewer1` / `automatic` counts.

Controls, Quran text, Mushaf geometry, reciter order, on-hold reciters (Rifaat, Gebril), offline switch: unchanged.

## Policy notes for the owner

- **21 activated surahs are from packages not yet in the dashboard** (Talib 13, Sobhi 7, Yasser 1). They follow the same rule as auto-accept-v2 (no Very High start) but have no ledger entry. To bring them under the dashboard, add these to `dashboard.config.json` `sources` after a rehearsal, as with Ahmed Salama:
  `{ "id": "saleh-talib-archive", "kind": "review-packages", "phase": "saleh-talib-archive", "dir": "../../Audio packages pending import/saleh-talib-archive-2026-10-24" }` (and likewise `saleh-talib-other-2026-10-24` and `vbr-cbr-copies-2026-10-24`).
- **Identity** rests on voice comparison and hosting labels for all new Talib and Sobhi files (prayer recordings of unstated date, uploaded by individuals or Haramain Recordings). It is not proof of who recites.
- **Rights: none of these sources grants app use.** archive.org items: no licence (`saqrsm`, `HaramainTaleb`, `SheikhTalib*`, `islam-sobhi_2022xx/2024xx`, `YasserSalama_201801`). Way2Quran: personal and non-commercial use; contact them for large-scale use. Release builds play none of it.

## Tests

- `npx vitest run`: 197 of 200 files pass. The 3 failing files are outside audio and were changed by another session today: `ayahLinkNavigation` (`Volume2` missing from the icon mock; `AyahExperience.tsx` 06:53), `reflectionReportSeparation` (`ReportIssueSheet.tsx` 06:52) and `wordMeaningsReader` (imports modules that do not exist).
- `tsc --noEmit`: 2 errors, both in `tests/wordMeaningsReader.test.ts` (same cause).
- `expo lint`: 2 errors, on temporary render-counter lines in `src/mushafFeatures/MushafFeatureLayer.tsx:79` and `src/app/(tabs)/mushaf.tsx:511` (both edited by another session during this run; not audio).
- Audio tests updated: `audioTimedPreview` (mixed reciters, registry, generated catalogue), `audioReviewedTiming` (DEV coverage), `audioSurahSources`.

Restart Metro with `--clear` before trying it on a device.
