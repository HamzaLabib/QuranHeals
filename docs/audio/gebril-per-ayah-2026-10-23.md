# Mohamed Gebril (محمد جبريل): per-ayah development preview and risk-based review (2026-10-23)

Owner request, 2026-10-23: add Mohamed Gebril to the **development** app with ayah-by-ayah playback, and put only the
automatically identified high-risk ayahs in the audio review dashboard. Nothing is committed, published or in a release.

## Verification levels

| Level | Status |
|---|---|
| Source data (listing, checksums, HTTP answers, sizes) | checked for all 6,349 files |
| Automated audio analysis (MP3 structure, decode, silences, edges, durations, duplicates) | done for all files |
| Automated text evidence (CTC alignment + transcription against the expected ayah, its neighbours and a far control) | done for all files; **not a verification** |
| Automated tests (engine, catalogue, dashboard, classifier) | pass (below) |
| Dashboard integration | checked on an isolated scratch instance (:8771), not on the live :8765 |
| Native playback (Android emulator, iPhone) | **UNVERIFIED**: not run |
| Listening | **none**: 777 ayahs await the owner |

## Source

- `https://everyayah.com/data/Muhammad_Jibreel_128kbps/` (preferred; `_64kbps` exists too). Files `SSSAAA.mp3`; `SSS000.mp3` is the surah's Basmala.
- Listing: 6,349 MP3s = **6,236 ayahs** + 112 Basmala files (none for 9) + `001000.mp3`. Also a stray `038003.mp3.mp3002.mp3`, folders `mistakes/`, `zips/`, `PageMp3s/`, and `000_checksum.md5` (6,237 entries: the ayahs and `001000`).
- All 6,349 fetched: HTTP 200, `audio/mpeg`, byte ranges, the listed sizes, no redirects. A missing file answers 404 (no redirect to another reciter, unlike MP3Quran). No byte-identical duplicates.
- Checksums: 6,236 match. **8:73 does not**: the checksum is that of `mistakes/008073.mp3` (155,774 bytes); the live file is a 355,877-byte VBR LAME 3.100 replacement tagged "Surah Anfal Ayah 73 / everyayah.com", dated 2023-01-22 (all others 2023-01-18).
- `001000.mp3` is the **isti'adha** (score 0.65 against 0.51 for the Basmala; transcription "a'dbiallahminalshyqanalrjiym"). It is not played: Al-Fatiha's Basmala is its ayah 1.
- Identity: artist tag "Muhammad Jibreel"; album tag "(C) VerseByVerseQuran.Com" on 9 files; **one file (5:53) is tagged "Sudais"**.
- Riwaya: Hafs by inference only (EveryAyah prefixes its non-Hafs sets, e.g. "(Warsh)"; this one has no prefix, and the folder has exactly the Kufan 6,236). Not confirmed by ear.
- Rights: **not established.** EveryAyah publishes no licence or terms (home page, `/terms`, `/about`: none). The tags claim "(C) VerseByVerseQuran.Com". Development preview only.

## Results

| | Count |
|---|---|
| Files available and readable | 6,348 of 6,348 played (6,236 ayahs + 112 Basmala) |
| Surahs with a complete file set (Full Surah available) | 114 |
| LOW risk files | 5,570 |
| HIGH risk files | 778 (771 ayahs, 7 Basmala files) |
| HIGH risk **ayahs in the dashboard** (Basmala risk counted on ayah 1) | **777**, in 103 surahs |
| Accepted automatically (low risk, administrative) | 5,459 |

Reasons (a file may have several): text-weak 416, transcript-weak 478, text-part 261, text-ambiguous 146,
transcript-mismatch 46, text-mismatch 18, extra-before 31, extra-after 23, format 31, lead-silence 27, duration 19,
batch 17, cut-end 16, cut-start 14, internal-silence 8, splice 4, near-duplicate 2, stray-name 2, checksum 1,
mistakes-folder 1, tag-album 1, trail-silence 1, clipping 1.

Notable:
- **Misplaced splits between adjacent ayahs** (cut-end on one, cut-start on the next, usually with extra audio or an abnormal length): 4:52/53, 4:120/121, 16:43/44, 20:33/34, 26:92/93, 26:157/158, 37:151/152, 56:22/23, 56:49/50, 56:60/61, 73:12/13, 107:4/5. Listen to these pairs first.
- **Another source**: 4:60–4:87 are 11,025 Hz mono 16 kbps (all other files 44.1 kHz stereo 128 kbps).
- **Edited or replaced files**: splices in 12:51, 12:75, 35:45, 39:73; isolated encoding batch in 2:40, 2:219, 2:253, 4:1, 5:53, 7:146, 11:84, 11:97, 11:119, 17:44, 33:71, 66:12; 8:73 (above).
- **Text mismatches** (another ayah fits at least as well): 4:131, 9:74, 9:83, 9:99, 9:104, 9:114, 9:118, 10:9, 26:126, 31:5, 55:0 (Basmala), 74:20, 77:12, 78:5, 93:8, 94:5, 101:2, 102:4. Several are near-identical texts (94:5/94:6); in Surah 9 the model reads the quiet files poorly (124 of 129 still score best on their own text: no shift).
- 38:2 and 38:3: named by the stray file.

Most of the 777 are **weak text evidence** (the model's score below the wrong-text controls' 99.9th percentile, 0.40),
not detected faults: 457 files have only weak-text reasons, with a median margin of 0.18 over the best other text.
They stay HIGH under the rule (uncertain = high). If the owner wants fewer, a relaxation to consider (not applied):
treat a weak score as LOW when it beats every other text by ≥ 0.15 and both halves are found.

## Method

`tools/quran-audio/per-ayah/` (README there): fetch → scan → text verification (GPU, 33 min) → classify → dashboard
packages → app catalogue. LOW only when every check passes clearly. Text thresholds are calibrated on the recording's
own wrong-text controls (each ayah's audio scored against a far ayah of similar length); duration is compared with
the 300 ayahs nearest in letter count (local fit, surah pace removed). Risk report:
`tools/quran-audio/audit-data/gebril-per-ayah-risk-2026-10-23.json`.

## App (development builds only)

- New `mobile/src/audio/perAyah.ts`: a per-ayah source (one file per ayah, the Basmala file before ayah 1 except 1 and 9). No timestamps are invented: each ayah spans its own file.
- The engine plays the ayah's file(s), then the next ayah's file without leaving playback (the next file is preloaded); Repeat seeks back to 0 on a one-file ayah, replays Basmala + ayah 1 for ayah 1 with its count kept; Full Surah stops after the last ayah; reciter changes take over at the next ayah boundary; a file whose loaded length differs from its scanned length by more than max(500 ms, 5 %) is refused.
- `RECITERS` adds the preview reciters only when `__DEV__` (`withPerAyahPreview`); the data `generated/perAyahPreview.ts` (109 KB) is required only under `__DEV__`. Reciter lists show "Development preview · All 114 surahs" / «معاينة للتطوير · …».
- Production registry, catalogue, providers, permissions and publication gates are unchanged. Offline downloads stay off.

## Dashboard

114 standard review packages (`source: per-ayah`) in `Working progress/Screenshots and Logs/gebril-per-ayah-review-2026-10-23/`; review copies (joined files, frame-exact; Surah 4 as a PCM WAV because of its mixed formats) in the dashboard cache. HIGH risk ayahs are Very High Risk starts (ayah 1 included); policy auto-accept-v2 accepts the rest. New: the **Per-ayah recordings** card (scanned, low, high, reviewed, unresolved; High-risk queue; All ayahs) and, on the review page, **Next Recording With Very High Risk Ayahs** once a surah is done. Rule changes: per-ayah evidence can make ayah 1 Very High (it was always a check).

## Open

- Native playback on Android and iPhone not run. Background continuation across files (one file per ayah) is the main risk on iOS: the app must load the next file while in the background.
- The Android emulator's HTTPS trust is broken (Norton; known since 2026-10-19), so emulator streaming fails for every reciter until fixed.
- Rights for any use beyond development testing.
- The live dashboard needs a restart to load the new code; on restart it registers the 114 packages and writes 5,459 automatic acceptances and 112 opening amendments to its ledgers (as on the scratch instance).
