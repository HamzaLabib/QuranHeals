# Experimental alignment of missing-surah candidates — Phase 4.7 (2026-10-18)

Local, experimental, isolated. **Nothing approved, enabled, staged or committed.**
- No catalogue, timing registry, review package, pipeline script or app file was changed; SHA-256 was verified against a baseline taken before any work (§8).
- Every package is `playbackBlocked`, and `development/apply-review.mjs` refuses it even with an approved review (tested, §7).
- An experimental alignment is **not** permission to use a recording in the app (§6).

Output, all outside the repository, in `Working progress/Screenshots and Logs/audio-experimental-phase-4.7-2026-10-18/`:

| Folder | Content |
|---|---|
| `aligned/` | All 25, with the repository's `align_mms.py` (unchanged) + `flag_boundaries.py` + `completeness.py` |
| `aligned-nobasmala/` | The 24 Talib prayer recordings again, with a one-option scratch variant of the aligner (§3) |
| `review-packages/` | 25 packages for `tools/quran-audio/review/review.html` (open the folder in the page) |
| `results.json` | Machine-readable: validation, alignment figures, content audit, hashes, per recording |

## 1. Results

| | Count |
|---|---|
| Candidates in scope (Phase 4.6 inventory, `eligibleForNextBatch`) | **25**: Saleh Al-Talib 24, Islam Sobhi 1 (65) |
| Failed validation (skipped) | **0** |
| Aligned successfully (structure valid, every ayah placed in order) | **25** |
| Failed alignment | **0** |
| Text confirmed by the aligner (median character score; wrong-text controls 0.17–0.18) | **25** (0.435–0.611) |
| Ayahs that look absent | **0** (2 with the repository aligner, explained in §3) |
| Content flags (imam speech, duʿāʾ, other surahs, interruptions, repetition) | **0** (positive controls detected, §4) |
| **Ready for human listening review** | **25** |
| Requiring additional investigation before review | **0**. All 25 still need identity and listening checks (§5). |
| Boundaries | 408 in all; 172 flagged; **233 on the listening worklists, 98 at priority 1** |

The batch covers 25 reciter–surahs of the 315 gaps (§9). None of them is playable.

## 2. Validation (before any alignment)

`work/validate.py` (scratch) checked, per file:
- SHA-256 and MD5 of the local original (read-only);
- the MD5 against archive.org's published checksum;
- frame-level MP3 integrity (`audit/mp3frames.py`: every frame parsed, no junk, constant bitrate);
- a full decode whose length equals the frame-derived duration;
- the surah (Phase 4.6 Quran-ASR ranks it #1 of 114);
- the canonical ayah count.

- **All 25 passed.**
- archive.org's checksums for all 139 files of the `saqrsm` item were re-read: 0 changed since Phase 4.6.
- Way2Quran's `065.mp3` still has the same size and date.
- All 24 Talib files are 320 kbps CBR, 44.1 kHz. Sobhi 65 is 192 kbps CBR, 48 kHz. CBR seeks precisely (Phase 4.3).
- Each original was re-hashed after its alignment: **unchanged in every case**.

## 3. Alignment, and one pipeline limitation found and handled

The steps are exactly those of `alignment/run-batch.mjs` (which only fetches MP3Quran files), driven on local files by a scratch script:
- `align_mms.py --no-star-between --both`: the primary and the comparison configurations;
- `flag_boundaries.py`;
- `completeness.py`.

The repository scripts were run unchanged.

**Limitation: an unrecited Basmala in prayer recordings.**
- `align_mms.py` always aligns a separate Basmala segment before ayah 1.
- In the Haram prayers the Basmala is not recited aloud. The full transcripts open directly with the surah («والضحى», «سبح اسم ربك», «الر كتاب»), after the files' uniform 3.0 s silent pre-roll.
- In **15 of the 24** Talib files the forced Basmala overlapped the start of ayah 1 by 0.7–3.2 s. This is measured: the voice begins at 3.00–3.12 s, and the aligned intro runs past it.
- That is where the weakest scores were: ayah 1 of 95 at 0.004, 29 at 0.081, 32 at 0.119, 104 at 0.169.
- It is also why 91 and 104 each showed one "absent" ayah.

**Handling.**
- A scratch copy of `align_mms.py` adds one option, `--no-basmala`, which drops that segment. Nothing else changed: without the option it reproduced the repository aligner's output **byte for byte** (both configurations, Talib 95 and Sobhi 65).
- With it, across the 24 Talib files:
  - ayah 1 starts at the measured voice onset (within 0.1 s) in all 24;
  - ayah-1 scores recover (95: 0.004 → 0.535; 29: 0.081 → 0.427; 104: 0.169 → 0.577);
  - the 2 "absent" ayahs disappear.
- **All 397 boundaries from ayah 2 onward are identical in both runs**, position and flags. The limitation only ever affected where ayah 1 starts, and the app plays ayah 1 from the start of the file anyway.
- The Talib packages use the no-Basmala run. The original runs are kept in `aligned/` as evidence.
- Sobhi 65 is aligned as recited: he recites the isti'ādha and then the Basmala aloud (intro 6.2–12.2 s), so the repository run is right for it.
- The repository's `align_mms.py` was **not** changed. Whether to add the option there is a decision for a later phase (with the regression set of Phase 4.1).

## 4. Content audit (requirement 5)

`work/content_audit.py` (scratch) works from a **full** Quran-ASR transcript of every file (Phase 4.2 `transcribe.py`, unchanged; GPU, every 20 s window), the chosen alignment and the decoded audio. It looks for:
- **other text:** a window whose best match is another surah;
- **non-Quran speech:** speech matching neither the surah nor any ayah;
- **prayer words:** takbīr, «سمع الله لمن حمده», «ربنا ولك الحمد», āmīn, taslīm, «اللهم», «صدق الله العظيم», as whole words in windows that are not the surah's own text;
- **repetitions:** an ayah heard again after later ayahs;
- **silences:** ≥ 1 s more than 40 dB below the recitation; ≥ 4 s listed as interruptions;
- **per-ayah pace:** too long means extra audio inside; too short means text possibly missing;
- **audio before ayah 1 and after the last ayah.**

**Corrected during the phase.** My first version flagged almost every short surah. Each cause was checked in the text and fixed:
- **"Speech with no Quran match":** the windows were the surah itself. A 20 s window spans several short ayahs, so no single ayah matched it. It now measures coverage against the whole expected surah.
- **"Takbīr" in 29:** it was «وَلَذِكْرُ اللَّهِ أَكْبَرُ», Qur'an 29:45.
- **"Āmīn" in 95:** it was «الْأَمِينِ», 95:3.
- **"Another surah" in 62:** a phrase shared with 57:21.
- **"Ayah 1 too short":** the Basmala's letters had been counted in ayah 1.
- A self-test now checks the word and coverage rules.

**Positive controls**, recordings already known to hold non-surah audio:

| Control | Detected |
|---|---|
| MP3Quran Saleh Al-Talib 001 (44 s before ayah 1) | the imam's row instructions «استووا… أقيموا صفوفكم» and «الله أكبر» (takbīr); the 44 s pre-roll |
| MP3Quran Islam Sobhi 54 (411 s after the last ayah) | Sūrat Ad-Dukhān (44) recited after Al-Qamar; speech not matching 54; 410.9 s after the last ayah; 2 over-long ayahs |

A known limit: "āmīn" can also match «أمين» in another surah's text (Sobhi 54's control hit was «رسول أمين», 44:18).

**Result for the 25:**
- No other surah, no imam speech, no duʿāʾ, no takbīr, no repetition and no silence ≥ 4 s. The longest silence is 3.05 s, the editorial pre-roll.
- No ayah is far outside the recording's own pace.
- Audio outside the recitation:
  - Talib files: about 3.0 s before ayah 1 (silence) and 0–3.8 s after the last ayah;
  - Sobhi 65: 12.2 s before the first ayah (isti'ādha + Basmala) and 7.4 s after.
- This is automated screening. The listener still checks the opening and closing of every prayer recording (§5).

## 5. Per recording

Priorities: **1** must be decided by ear (configurations disagree, no pause, shallow pause, extra audio, reordered…); **2** flagged, lower risk.

| Reciter | Surah | Ayahs | Length | Boundaries | Flagged | Worklist | P1 | P2 | Text score (median / min) | Ayah-1 score (with → without Basmala) | Main flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| Islam Sobhi | 65 At-Talaaq | 12 | 8:08 | 11 | 4 | 6 | 3 | 1 | 0.435 / 0.347 | — (recited) | configs disagree 3, extra audio 3, short pause 2, no pause 1, shallow 1 |
| Saleh Al-Talib | 14 Ibrahim | 52 | 15:57 | 51 | 14 | 21 | 6 | 8 | 0.536 / 0.478 | 0.495→0.514 | short pause 8, no pause 5, configs disagree 5, extra audio 1 |
| Saleh Al-Talib | 29 Al-Ankaboot | 69 | 19:07 | 68 | 15 | 25 | 7 | 8 | 0.532 / 0.427 | 0.081→0.427 | short pause 8, no pause 7, configs disagree 7 |
| Saleh Al-Talib | 32 As-Sajda | 30 | 5:41 | 29 | 19 | 22 | 9 | 10 | 0.537 / 0.423 | 0.119→0.48 | short pause 10, no pause 9, configs disagree 9 |
| Saleh Al-Talib | 48 Al-Fath | 29 | 10:25 | 28 | 15 | 19 | 10 | 5 | 0.538 / 0.499 | 0.456→0.522 | no pause 8, configs disagree 8, short pause 5, extra audio 2 |
| Saleh Al-Talib | 62 Al-Jumu'a | 11 | 3:09 | 10 | 0 | 2 | 0 | 0 | 0.52 / 0.485 | 0.584→0.584 | none |
| Saleh Al-Talib | 63 Al-Munaafiqoon | 11 | 3:26 | 10 | 8 | 8 | 5 | 3 | 0.528 / 0.5 | 0.502→0.548 | no pause 5, configs disagree 5, short pause 3 |
| Saleh Al-Talib | 67 Al-Mulk | 30 | 5:56 | 29 | 13 | 15 | 5 | 8 | 0.528 / 0.455 | 0.531→0.531 | short pause 8, no pause 5, configs disagree 5 |
| Saleh Al-Talib | 71 Nooh | 28 | 4:04 | 27 | 10 | 13 | 5 | 5 | 0.554 / 0.498 | 0.487→0.537 | no pause 5, configs disagree 5, short pause 5, shallow 2 |
| Saleh Al-Talib | 87 Al-A'laa | 19 | 1:05 | 18 | 17 | 17 | 15 | 2 | 0.525 / 0.393 | 0.589→0.589 | no pause 15, configs disagree 15, shallow 8, short pause 2 |
| Saleh Al-Talib | 88 Al-Ghaashiya | 26 | 1:29 | 25 | 17 | 20 | 12 | 5 | 0.549 / 0.498 | 0.464→0.562 | no pause 12, configs disagree 11, short pause 5, shallow 4 |
| Saleh Al-Talib | 91 Ash-Shams | 15 | 1:13 | 14 | 10 | 11 | 7 | 3 | 0.561 / 0.457 | 0.224→0.568 | no pause 7, configs disagree 7, short pause 3, shallow 1 |
| Saleh Al-Talib | 93 Ad-Dhuhaa | 11 | 0:47 | 10 | 8 | 8 | 4 | 4 | 0.534 / 0.48 | 0.534→0.534 | no pause 4, configs disagree 4, short pause 4, shallow 1 |
| Saleh Al-Talib | 94 Ash-Sharh | 8 | 0:30 | 7 | 2 | 4 | 1 | 1 | 0.579 / 0.456 | 0.476→0.606 | no pause 1, configs disagree 1, short pause 1 |
| Saleh Al-Talib | 95 At-Tin | 8 | 0:49 | 7 | 0 | 3 | 0 | 0 | 0.565 / 0.452 | 0.004→0.535 | none |
| Saleh Al-Talib | 97 Al-Qadr | 5 | 0:33 | 4 | 0 | 2 | 0 | 0 | 0.572 / 0.552 | 0.447→0.552 | none |
| Saleh Al-Talib | 98 Al-Bayyina | 8 | 1:51 | 7 | 2 | 4 | 0 | 2 | 0.507 / 0.493 | 0.56→0.56 | short pause 2 |
| Saleh Al-Talib | 99 Az-Zalzala | 8 | 0:51 | 7 | 2 | 3 | 0 | 2 | 0.591 / 0.495 | 0.611→0.611 | short pause 2 |
| Saleh Al-Talib | 100 Al-Aadiyaat | 11 | 0:58 | 10 | 3 | 6 | 1 | 2 | 0.551 / 0.482 | 0.6→0.6 | short pause 2, no pause 1, configs disagree 1, shallow 1 |
| Saleh Al-Talib | 101 Al-Qaari'a | 11 | 0:52 | 10 | 5 | 7 | 4 | 1 | 0.55 / 0.414 | 0.607→0.607 | configs disagree 4, no pause 3, snap-far 1, reordered 1 |
| Saleh Al-Talib | 102 At-Takaathur | 8 | 0:48 | 7 | 2 | 5 | 2 | 0 | 0.52 / 0.496 | 0.552→0.552 | no pause 2, configs disagree 2 |
| Saleh Al-Talib | 104 Al-Humaza | 9 | 0:44 | 8 | 3 | 4 | 1 | 2 | 0.501 / 0.441 | 0.169→0.577 | short pause 2, snap-far 1, no pause 1, configs disagree 1 |
| Saleh Al-Talib | 105 Al-Fil | 5 | 0:33 | 4 | 2 | 3 | 0 | 2 | 0.574 / 0.542 | 0.493→0.585 | short pause 2 |
| Saleh Al-Talib | 110 An-Nasr | 3 | 0:26 | 2 | 0 | 2 | 0 | 0 | 0.611 / 0.558 | 0.399→0.641 | none |
| Saleh Al-Talib | 114 An-Naas | 6 | 0:34 | 5 | 1 | 3 | 1 | 0 | 0.528 / 0.512 | 0.435→0.512 | no pause 1, configs disagree 1 |

**Boundary confidence (all 408):**
- **Acoustic class of the chosen point:** 380 in silence, 10 in a reverberation tail, **18 shallow**. Median depth 15.5 dB below the recitation; 10 % of points are shallower than 12.3 dB.
- **Aligner score at the boundary:** median 0.536; 10th percentile 0.491.
- **Flags:**
  - configurations disagree: 94;
  - no pause: 92;
  - short pause: 74;
  - shallow pause: 18;
  - extra audio: 6;
  - snap-far: 2;
  - reordered: 1 (Talib 101, repaired by the Phase 4.2 rule and marked so).

**Where to listen first (suspicious regions):**
- **Talib 87 Al-Aʿlā:** 15 of 18 boundaries are priority 1. He joins the short ayahs without pauses, as in the prayer, so most boundaries must be set by ear.
- **Talib 88 Al-Ghāshiyah:** 12 priority 1 for the same reason.
- **Talib 91, 63, 93 and 101:** the same.
- **Talib 32 As-Sajdah and 48 Al-Fatḥ:** 9–10 priority 1 each (no pause or configurations disagree).
- **Sobhi 65:** 3 `extra-audio` boundaries (voiced sound inside the chosen pause), and the long intro (isti'ādha + Basmala, 0–12.2 s).
- **Every prayer recording:** the opening and the end. No Basmala is recited. The reviewer's "Opening (Basmala + ayah 1)" button plays the opening, which here has none.

**Still needed for every recording, whatever its flags:**
- a person confirms the reciter's voice (Talib: probable by voice comparison; Sobhi 65: probable at 83 % of windows, Phase 4.6);
- the full surah is heard against the text;
- every worklist boundary is decided.

## 6. Provenance and permissions (separate from the technical result)

| Recordings | Source | Provenance | Permission |
|---|---|---|---|
| Talib, 24 | archive.org item `saqrsm`, "Salih Al Talib" (`https://archive.org/details/saqrsm`), files named by surah and ayah range; MD5 per file published by archive.org | Uploaded 2021-10-08 by an individual (e-mail only); ID3 artist "Shaikh Dr. Saleh Al Taleb"; Haram prayer recordings of unknown date; no source stated | **Unknown**: no item licence; uploader not the rights holder as far as shown |
| Sobhi 65 | Way2Quran `media.way2quran.com/islam-sobhi/hafs-an-asim/065.mp3` | Re-encoded with ffmpeg (2025–26), tags stripped; upstream not stated | **Permission required**: Way2Quran FAQ welcomes personal and non-commercial use and asks to be contacted for commercial or large-scale distribution |

- The review packages point at these public URLs, so a reviewer streams the file from its source for **private listening**. Nothing is copied, re-encoded or rehosted.
- The downloaded originals stay in the session scratch area: `…/scratchpad/p46/dl/` (unchanged; hashes in `results.json`).

## 7. Tests and checks

| Check | Result |
|---|---|
| `tools/quran-audio/alignment/test_flag_boundaries.py` | 3 / 3 passed |
| `tools/quran-audio/audit/test_vbr_recover.py` | 5 / 5 passed |
| Mobile audio suites (`vitest run`, 12 files: audioControlsLayout, audioDownloads, audioEngine, audioReciters, audioRepeatFullSurah, audioReviewTools, audioSourceRegistry, audioStreamCheck, audioSurahMode, audioTiming, ayahAudioButton, developmentTiming) | **226 / 226 passed** (run directly: `npm test`'s `pretest` hook writes font files, which this phase must not) |
| Aligner variant without its option vs the repository aligner (Talib 95, Sobhi 65, both configurations) | byte-identical output |
| Content-audit self-test, and positive controls (Talib 001, Sobhi 54) | passed; controls detected |
| `review.html` (unchanged), headless Chrome on its own port and profile (no other session's browser touched) | the 25 packages load; Talib 110 streams from archive.org (playing, no error) and **Precise mode** decodes it; Sobhi 65 streams from Way2Quran. Both show the amber notice "You can review and approve this surah, but it cannot be added to the app yet: no permission for app use…". Approve stays disabled until the worklist is decided. |
| `apply-review.mjs` with a SYNTHETIC, fully approved review (Talib 62, Sobhi 65), output redirected to a scratch copy (`QH_DEVELOPMENT_TIMING`) | **refused**: "not playable in the app yet: no permission for app use…"; with `playbackBlocked` removed from a scratch copy of the package, **refused again**: "surah not listed for this recording". `development-timing.json` unchanged (SHA-256 `eb9935eb…`) |

## 8. Safety

- **Unchanged** (SHA-256, before vs after):
  - `audit-results.json`, `measured-timing.json`, `development/development-timing.json`, `surah-mode-approvals.json`, `providers.mjs`, `reciters.mjs`;
  - every `alignment/` and `review/` script, `alignment/batch-exclusions.json`, and the Phase 4.6 inventory;
  - every `mobile/src/audio/generated/*.ts` and `sourceRegistry.ts`;
  - the Phase 4.1 batch (`phase-4.1-batch`, whole folder) and the existing review packages (`audio-review-packages-2026-10-18`, all 486 files).
- **Added to the repository:** this document only.
- **Other sessions:**
  - The GPU was idle when this phase used it.
  - The other Claude session's files were not touched. During this phase it added `docs/audio/rifaat-manual-timing-phase-4-6-2026-10-18.md` and `mobile/tests/manualTimingReview.test.ts` (Rifaat manual timing); they are not part of this work.
- Not done, by design: no staging, commit, push, build, deploy, approval or activation; no change to the app's audio code.

## 9. Remaining reciter–surah gaps

Of the 315 gaps of Phase 4.6, **25 now have an experimental, unapproved candidate in a review queue**. Every one is blocked from the app by permission.

| Reciter | Gap | In this batch | Still without a reviewable candidate |
|---|---:|---:|---|
| Saleh Al-Talib | 82 | 24 | **58**: 44 with no recording found; 13 saqrsm prayer recordings whose text or voice screen did not pass (51, 68, 69, 89, 90, 92, 103, 106–109, 112, 113: listen first); surah 2 (MP3Quran's file is incomplete) |
| Islam Sobhi | 5 | 1 (65) | **4**: 37, 39, 40, 45 (Way2Quran voice not matched or unresolved; 37's Sobhi take is incomplete) |
| Muhammad Rifaat | 83 + 31 | 0 | **114**: see the Rifaat reports (13 excerpts; the 18 complete ones are on the manual-timing route in the other session's work) |
| Ahmed Mohamed Salama | 114 | 0 | **114**: identity unverified (Phase 4.6) |
| **Total** | **315** | **25** | **290** |

**Next steps (owner):**
1. **Listen** to the 25 packages. Start with Talib 87 and 88, and check every opening and ending. Mark each boundary.
2. **Decide on permission:**
   - ask Way2Quran (Sobhi 65), using the Phase 4.6 draft;
   - for the archive.org Talib recordings, the rights holder (presumably the Haram's media administration) is not identified. Without a licence they cannot be used in the app, however well they align.
3. **Decide on the aligner:** whether to adopt `--no-basmala` in the repository for prayer recordings (one option; regression-test on the Phase 4.1 reference set).
