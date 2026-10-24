# Ali Abdullah Jaber (علي عبد الله جابر): per-ayah development preview (Phase 3, 2026-10-23)

Owner request: add Sheikh Ali Abdullah Jaber to the development app on the per-ayah architecture built for Mohamed
Gebril, verify every file automatically, and send only Very High Risk items and unresolved exceptions to the dashboard,
under the unchanged policy auto-accept-v2. Nothing is committed, published or in a release; offline downloads stay off.

## Verification levels

| Level | Status |
|---|---|
| Source (listing, MD5 checksums, HTTP answers, sizes) | all 6,349 files |
| Audio analysis (MP3 structure, decode, silences, edges, durations, duplicates) | all files |
| Text evidence (CTC alignment + transcription vs. the expected ayah, neighbours, far control) | all files; not a verification |
| Identity (each file located in MP3Quran's Hafs recording of the same surah) | all 114 surahs |
| Dashboard | rehearsed on a restored copy of the real data, then live (:8765), results identical |
| Native playback (Android, iPhone) | **UNVERIFIED** |
| Listening | none |

## Source

- `https://everyayah.com/data/Ali_Jaber_64kbps/`: 6,349 MP3s = 6,236 ayahs + 113 `SSS000` files (002–114, **including 009000**; no 001000), plus `audhubillah.mp3`, `bismillah.mp3`, folders `merged/`, `zips/`. No `mistakes/` folder.
- All fetched: HTTP 200, `audio/mpeg`, byte ranges, listed sizes, no redirects. **All 6,349 MD5s match `000_checksum.md5`.**
- Format: every file 22,050 Hz stereo, 64 kbps CBR; no ID3 tags; no stream errors; none under 1 s. 64 kbps used (no 128 kbps set exists).
- The 113 `SSS000` files are **one byte-identical Basmala recording**. `009000.mp3` is that Basmala (score 0.634 vs 0.318 for the isti'adha): never played, At-Tawbah opens without it.
- Identity and riwaya: MP3Quran's علي جابر (reciter 76, moshaf 76, "حفص عن عاصم - مرتل", 114 surahs) is the reference. **5,916 of 6,236 ayah files (94.9 %) are found, every 3 s chunk in order, in MP3Quran's file of the same surah**: the same performance. Not found:
  - **Al-Fatiha (all 7) and Al-Baqarah (all 286)**: another performance of the whole surah. EveryAyah's 1:1 is 13.2 s and carries 1.3 s of extra voiced audio before the Basmala (probably the isti'adha).
  - 27 isolated ayahs: 4:11, 10:40, 11:34, 11:38, 11:63, 11:81, 11:89, 11:123, 74:41–56, 88:14, 89:23, 90:1.
- Rights: **not established** (EveryAyah publishes no licence; MP3Quran's site-wide permission covers its own files). Development preview only.

## Results

| | Count |
|---|---|
| Surahs | 114 of 114, every file set complete (Full Surah available) |
| Ayah files found / valid (playable) | 6,236 / 6,236; plus 112 Basmala files played; invalid 0 |
| Checked automatically | 6,348 played files (+ 009000 identified) |
| File tiers | Very High 57 · High 599 · Medium 0 · Low 5,692 |
| Dashboard starts (6,236) | **57 Very High (manual)**; accepted automatically: **577 High, 0 Medium, 110 Check, 5,492 Routine** (6,179) |
| Unresolved exceptions | 0 |
| **Manual listening** | **57** |

Graded tiers (new, `per-ayah/classify.mjs`), following `review/manual/very-high.mjs`: only credible structural
evidence is Very High. Weak text scores, silences and similar uncertainty are not. Gebril's packages are unchanged (ungraded: all 777 flagged ayahs Very High).

Very High (57):
- identity: the 27 isolated ayahs above; `identity-sample` 1:1 and 2:1 (listen once to confirm the voice for Al-Fatiha and Al-Baqarah; their other 291 ayahs are High, `identity-surah`);
- another ayah fits as well (text 9, transcript 14): 26:100, 26:138, 31:5, 37:25, 37:69, 42:2, 53:54, 55:0 (Basmala, on 55:1), 56:35, 56:54, 69:2, 75:35, 78:5, 81:11, 81:17, 86:12, 93:8, 101:2, 102:4;
- voiced audio outside the ayah: 1:1, 81:11, 86:12 (before), 9:12, 10:70, 114:6 (after);
- abnormal length for the words: 4:7, 4:85, 8:16, 20:53, 43:33, 66:5.

High (599, accepted automatically, never verified): 291 `identity-surah` (1 and 2) and weak text evidence
(transcript-weak 278, text-weak 133, text-part 46, text-ambiguous 27). Text thresholds were calibrated on this
recording's own wrong-text controls: score ≥ 0.47, transcript similarity ≥ 0.48 (the controls' 99.9th percentiles).

## Dashboard: live state after the import

Backups: `pre-jaber-20261023T230638Z` (verified, 1,041 files, chains intact) and the server's own `pre-opening-rule-20261023T234219Z`.
Rehearsal on a restored copy: the pre-Gebril code gave the baseline, then the new code was run; then the live server.
- All 254 review-data files byte-identical; both ledgers append-only (old entries intact), hash chains verified.
- The 801 existing recordings: per-recording progress identical. Existing queue unchanged: Muhammad Rifaat 144 Very High + 285 exceptions (the 608 backlog of 2026-10-23 less the 179 reviewed since). 7,065 reviewed starts unchanged.
- Added: 11,638 automatic acceptances (Gebril 5,459, Jaber 6,179) and 224 opening amendments (112 each).
- Queue now: Rifaat 144 + 285 exceptions, Gebril 777, Jaber 57.
- The 133 import problems ("package changed after the review began") pre-date this work.

## App

No new player: Jaber is a second entry in `generated/perAyahPreview.ts` (development only), played by the same
per-ayah adapter. Reciter lists: "Development preview · All 114 surahs" / «معاينة للتطوير · …».
