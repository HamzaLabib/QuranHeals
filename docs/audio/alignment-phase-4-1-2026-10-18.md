# Ayah timing — Phase 4.1: alignment verification and reciter coverage (2026-10-18)

Local only. Nothing committed, no production timing or data changed, nothing activated for release. **No surah has been
approved by human listening yet**: every number below is automated evidence, which narrows what a person must hear;
it never replaces hearing it.

Four kinds of status are kept apart throughout:
- **Automated validation:** structure, completeness, acoustic checks, agreement between independent timings.
- **Human listening approval:** review/review.html, by a named reviewer.
- **Recording authenticity:** the right reciter, the right riwayah, a complete recording.
- **Usage permission:** the provider's terms.

## 1. Alignment investigations

### B3 — Maher Al-Muaiqly 68:12: not an alignment error; an audit bug and a reference artefact

**Reproduced.**
- The candidate puts 68:12 at 1:45.03, in the middle of a 1.42 s pause (1:44.32–1:45.74).
- Quran Foundation's (QF) word timing for the same performance puts the pause at 1:46.20–1:46.62, 1.17 s later.

**The audio decides.**
- 1:43.92–1:45.72 is silence, ending in 220 ms of digital zeros (1:45.44–1:45.66). Recitation resumes at 1:45.74 with a fresh voiced onset whose pitch rises from 126 Hz to 176 Hz.
- That sound is steady and nasal: at about −27 dB it is quieter than the vowel that follows at 1:46.70 (about −18 dB). This is the held initial **mīm (ghunna)** of «مَّنَّاعٍ».
- QF assigns this sound to the end of ayah 11 and starts ayah 12 at the vowel. QF's "pause" (1:46.20–1:46.62) contains continuous voicing, at 178 Hz.
- **The candidate is right, and so was MP3Quran's own timing.**

**Why Phase 4 called it an error.**
- The 2026-10-17 cross-check (`audit/maher-qf-crosscheck.mjs`) measured both candidate times by byte range. It assumed every Maher file's first audio frame is at byte 6,900.
- 11 files start elsewhere: 45 and 79 at about 10.5 KB; 3, 19, 28, 32, 34, 42, 68, 75 and 76 at about 23.5 KB. In those files both times were measured 0.3–1.4 s early.
- Re-run with each file's own first frame, four verdicts invert: **3:166, 34:25, 42:53 and 68:12 are MP3Quran-in-pause, not "MP3Quran wrong".** 28:65 also changes, from "neither in a pause" to MP3Quran-in-pause.
- **Consequence for production (not acted on):**
  - Maher **34** and **68** were withdrawn from production on 34:25 and 68:12 alone.
  - Maher 3 and 42 stay withdrawn on their opening-letter boundaries (3:2, 42:3), which the boundary sweep established independently.
  - Re-enabling 34 and 68 is an owner decision.
  - Evidence: `tools/quran-audio/audit-data/maher-qf-crosscheck-recheck-2026-10-18.json` (the 2026-10-17 file is kept unchanged). The tool now reads each file's first frame.

**Why the checks "missed" it.** There was nothing to miss: the flags were silent because the boundary is correct.

**Other references are not ground truth either.** Maher candidates 3, 36 and 68 against QF (332 boundaries):
- 15 disagree. At every one, the chosen boundary is 64–96 dB below the recitation.
- In 14 of them, QF's word end falls within 40 ms of an exact 10-second mark (19.96 s, 339.96 s, 599.98 s, 4,100.0 s, …). This is a segmentation artefact of the reference.
- The 15th is 68:12 (above).
- The two Phase 3 "joined recitation" misses have the same explanation:
  - **Maher 55:19:** chosen inside 1.44 s of silence with digital zeros (82.6 dB down). QF runs the previous word across the whole silence.
  - **Hudhaifi 18:94:** chosen inside an 860 ms pause, 41 dB down. The reference comes from mapping the edges of an EveryAyah clip, which is approximate at the clip's ends.

**Better detection.** `flag_boundaries.py` now measures each boundary in the audio itself:
- `acoustic`: silence / reverb-tail / shallow, with the depth in dB below the loud recitation around the boundary;
- three new flags: `shallow-pause`, `anchored` and `extra-audio`.

Re-evaluated on the 554 reference boundaries used in Phase 3 (Maher 8 surahs, Hudhaifi 6 surahs):

| | Before (Phase 3) | After (Phase 4.1) |
|---|---|---|
| Boundaries flagged | 23 (4.2 %) | 23 (4.2 %): one `extra-audio` added, on a boundary already flagged (and correct) |
| "Wrong pause" vs the reference | 2 (Maher 55:19, Hudhaifi 18:94) | 2, both shown in the audio to be reference artefacts |
| Chosen boundary in true silence (≥ 25 dB down) | not measured | 554 / 554 (34–97 dB down) |
| Maher candidates vs QF (332) | "316 within 150 ms; 68:12 wrong, unflagged" | 317 in the pause or at its edge; 15 differ, all 15 explained in the audio (14 QF 10-second artefacts, 68:12 ghunna) |

The new checks add no false confidence: they only add flags, and no flag was removed.

A rule tested and rejected in Phase 4 stays rejected: placing the boundary 150 ms before the aligned onset.

### B1 — Mahmoud Khalil Al-Husary: the 4–8 s pauses are genuine

**Data.**
- 11 surahs of the development candidates.
- 11 of his production-verified surahs, measured the same way for comparison: 18, 19, 20, 36, 50, 55, 56, 67, 75, 76, 78. A 12th (17) ran out of memory and was skipped.

**What is inside each pause** (`development/gap_voicing.py`: voiced 40 ms frames, autocorrelation ≥ 0.6, after 250 ms margins):

| | Gaps | Over 4 s | Voiced sound inside |
|---|---|---|---|
| Production-verified surahs | 775 | 24 (up to 7.0 s) | ≤ 540 ms in every gap (breaths are unvoiced) |
| Candidate surahs, real gaps | 445 | 75 | ≤ 800 ms, except 7 gaps |
| The 7 exceptions | 7 | 7 (10–81 s) | 5.9–55 s: audio that is not in the per-ayah clips (21:100–103, 28:76, 31:31–32) |
| Negative controls: gaps spanning one whole ayah | 1,198 | – | ≥ 1,440 ms (production surahs) / ≥ 3,600 ms (candidates) |

**The 4 s rule is wrong for this recording.**
- It rejects 7 of the 11 production-verified surahs.
- Yet in all 775 of their boundaries, MP3Quran's verified start lies inside the measured pause.

**Rule (Husary only; the 4 s rule itself is unchanged for everyone):**
- `LONG_PAUSE` in `development/supplement-measured.mjs`: a pause of 4–10 s is accounted for only when it holds ≤ 1,000 ms of voiced sound.
- Every other measured check still applies.
- With this rule, all 11 production-verified surahs are accepted, with 0 disagreements.

**Result for the candidates.**
- **Accepted** (development only): 27, 46, 47, 49, 58, 66.
- **Still excluded**, each for a real defect:
  - 28: 28:76 has 5.9 s of unexplained audio;
  - 21: four gaps of 23–60 s full of audio, and pieces not found;
  - 31: an 81 s gap with 55 s of audio, and pieces not found.
- **False approvals:** none of the 1,198 controls passes, and none of the 7 audio-filled gaps passes.
- The 6 new surahs:
  - every boundary is in silence (38–105 dB down);
  - MP3Quran's own timing of the same files agrees with every boundary (212 / 212; at most 146 ms apart, typically about 70 ms);
  - each was boundary-swept as before.

### B2 — Saud Al-Shuraim: reverberation

**Why the old test fails.**
- The boundary sweep calls a boundary a pause only when the energy falls below 0.35 × the median of the ±3 s around it.
- In Shuraim's reverberant recording the tail of each ayah keeps the level up, so 380 of 823 boundaries were "unconfirmed".
- The same test also fails inside long pauses, where the median is the silence itself: this is why 69 of Husary's boundaries were "unconfirmed".

**What separates a reverberation tail from recitation.**
- Studied on 823 Shuraim boundaries.
- Controls: 2,283 points inside recitation (each ayah's middle, 1 s after its start, 1 s before its end).
- A tail is a long, monotone decay into a minimum, followed by a sharp new onset.

| Test (flag_boundaries.py `acoustic()`, ±300 ms) | Boundaries confirmed | Controls (inside recitation) "confirmed" |
|---|---|---|
| Shuraim, old: energy < 0.35 × window median | 54.2 % (446 / 823) | 14.6 % |
| Shuraim, new: old test, or ≥ 25 dB below the recitation, or a reverberation tail (≥ 600 ms monotone decay to ≥ 10 dB below, then a ≥ 6 dB rise within 100 ms) | 76.5 % (630 / 823: 469 silence, 161 tail) | 15.2 % (tail alone: 2.1 %) |
| Husary, old → new | 71.1 % → 100 % | 23.7 % → 29.0 % |
| Shatri, old → new | 98.6 % → 98.6 % | 15.5 % → 15.0 % |
| Minshawi, old → new | 100 % → 100 % | 29.3 % → 35.8 % |

Many of the "confirmed" controls are genuine pauses inside long ayahs. A pause test confirms a pause, not an ayah boundary, so neither rate is a false-approval rate.

**Independent reference: MP3Quran's own timing of the same files.**
- The development timing was measured from EveryAyah clips, so MP3Quran's timing is an independent check.
- 581 of 823 boundaries agree within 0.5 s, and 17 of the 22 surahs agree everywhere (typically within 60–75 ms).
- Of the 193 boundaries still not confirmed acoustically ("shallow"), **192 agree with MP3Quran.** The exception is 40:74.
- The disagreements are whole-surah offsets: MP3Quran's timing was made from another edit of the file.
  - 9: about +15.6 s;
  - 12: about −37.7 s;
  - 40 from ayah 65 on: a constant +7.9 s.
- These offsets are why that timing was rejected.

**Flags, not verdicts.**
- Every boundary keeps its class (silence / reverb-tail / shallow) and its MP3Quran agreement.
- Missing silence is never treated as an error. It only raises the boundary's listening priority.

## 2. Re-validation of the development surahs (Part C)

`development/revalidate.mjs` → `audit-data/development-revalidation-2026-10-18.json`. There are now 44 development surahs: the 38 of Phase 4 plus 6 Husary.

**Listening priority:**
- **1:** displaced, or shallow and not corroborated;
- **2:** shallow but corroborated, or a reverberation tail not corroborated;
- **3:** sample only.

| Reciter | Surahs | Boundaries | Silence | Reverberation tail | Shallow | MP3Quran agrees | Priority 1 | Priority 2 |
|---|---|---|---|---|---|---|---|---|
| Minshawi | 5 | 302 | 302 | 0 | 0 | 45 (54–57: MP3Quran is offset by 0.8–1.1 s throughout) | 0 | 0 |
| Husary | 8 | 225 | 225 | 0 | 0 | 219 | 1 (46:21, displaced; 49 dB down, MP3Quran agrees) | 0 |
| Shuraim | 22 | 823 | 469 | 161 | 193 | 581 | 4 (40:74; 91:2, 95:2, 101:2) | 193 |
| Shatri | 9 | 148 | 146 | 0 | 2 | 114 | 0 | 2 |

**Listen first:** Shuraim 40:74. It is shallow, and it sits in the span where MP3Quran's timing is offset, so nothing corroborates it.

**Status of all 44:**
- **Automated validation:** they pass.
- **Human listening:** none yet.
- **Recording authenticity:**
  - the EveryAyah per-ayah sets are cut from the same recordings (located at chunk scores ≥ 0.7);
  - Hafs according to MP3Quran's labels.
- **Permission:** MP3Quran streaming (site-wide grant).
- **Stage:** they stay DEVELOPMENT ONLY.

## 3. Listening review (Part A): how to use it

1. **Build the packages** (they are small and contain no audio):
   `node tools/quran-audio/review/make-packages.mjs "<out>" --development tools/quran-audio/audit-data/development-revalidation-2026-10-18.json --aligned "<run-batch dir>"`
   The current set is in `Working progress/Screenshots and Logs/audio-review-packages-2026-10-18/`.
2. **Open** `tools/quran-audio/review/review.html` in Chrome or Edge, enter your name, then click **Open a packages folder** and choose that folder.
   - The surah list is ordered by risk: development timing first, then candidates with the most priority-1 boundaries.
3. **For each boundary on the worklist:**
   - **▶ Transition** plays the end of the previous ayah through the start of the next.
   - **▶ Before** and **▶ After** play 3 s on either side; **▶ Whole ayah** plays the ayah.
   - The Arabic shows the last words of one ayah and the first words of the next.
   - "Auto check" (the computer's measurement) is shown apart from "Your review".
4. **If a boundary is off**, move it by ±50 or ±250 ms, press **Set to playback position**, or type the time.
   - Moving a boundary clears its verdict, so it must be heard again.
5. **Mark each boundary** Correct, Needs correction or Unresolved, with an optional note.
   - Keys: Space play/pause, T transition, C / N / U verdicts, J / K previous/next, [ / ] move 50 ms.
6. **Approve whole surah** is possible only when every worklist boundary is Correct and nothing is Needs correction or Unresolved. Then press **Export review**.
   - Progress is saved in the browser automatically. **Back up all progress** downloads it all, and **Import a saved review** resumes from an export.
   - **Precise mode** downloads and decodes the whole file in the browser. Use it for VBR files, or whenever streaming positions feel off.
7. **Apply:** `node tools/quran-audio/development/apply-review.mjs <package.json> <review.json>`, then `node tools/quran-audio/generate-catalog.mjs`.
   - It refuses unless all of the following hold:
     - the review is of that exact timing (fingerprint);
     - the surah was approved as a whole;
     - every worklist boundary is Correct and none is Needs correction or Unresolved;
     - the package is not blocked;
     - the timing stays in order.
   - A development surah receives the listening evidence. A moved boundary becomes new timing, with `correctedFrom`.
   - An aligned candidate becomes development timing.
   - Production is never touched.

**Tested:** headless Chrome drove the whole flow, and `mobile/tests/audioReviewTools.test.ts` covers the approval gate and the long-pause rule. The flow covered:
- loading 47 test packages, and later all 485 final packages;
- streaming playback;
- move → verdict cleared;
- Approve blocked by Needs correction and by undecided boundaries;
- progress kept across a reload;
- approval and export;
- apply-review accepting the approved review, and refusing it unapproved, with Needs correction, Unresolved, an undecided boundary, the wrong fingerprint, or no reviewer;
- no horizontal scrolling at 390 px.

## 4. Automatic alignment of the untimed recordings (Part D)

Run: `alignment/run-batch.mjs --untimed` over every surah MP3Quran lists that has neither production nor development
timing.

**How it runs:**
- It is resumable, with `progress.jsonl` checkpoints.
- One download is prefetched at a time.
- Both configurations come from one set of emissions (`align_mms.py --both`). Long files get the windowed comparison run, which also fixed the GPU crash on surah 2.
- Long files are queued last, and one failing surah never stops the run.
- **Excluded without re-processing:** 21 Rifaat surahs already shown in Phase 3.1 not to confirm their text (`alignment/batch-exclusions.json`).
- **Not processed:** Ahmed Mohamed Salama, who has no permitted recording.

The run took about 3.7 hours on an RTX 3070 Ti laptop GPU (15:00–18:40 UTC). Candidate data (no audio) is in
`Working progress/Screenshots and Logs/audio-candidates-2026-10-18/phase-4.1-batch/`, and the review packages in
`…/audio-review-packages-2026-10-18/`.

**Phase 4.2 update:** the 12 failures were investigated one by one in `failed-recordings-phase-4-2-2026-10-18.md`. Yasser Salama 90 and Saleh Al-Talib 86 are repaired (a shared boundary-placement defect, which also corrected 6 passing surahs) and now in the listening queue; the 10 Rifaat surahs need a replacement recording. Counts below are the Phase 4.1 state.

**Two defects found and fixed during the run** (`flag_boundaries.py`; re-flagging only, no new alignment):

1. **Boundaries out of order.** With very short ayahs, the pause-snapping window could reach back before the previous boundary, giving an ayah no length.
   - Boundaries are now kept after the previous one; the new flag is `reordered`.
   - This fixed 22 of 24 such structure failures.
   - The 14 reference surahs are byte-identical before and after.
2. **Ayah 1 squeezed (24 surahs).** Ayah 1 is mostly opening letters (الم، حم، طه، يس) or a very short first ayah, and the aligner gives it a few hundred ms although the audio is present.
   - A leading istiʿādha segment was tested and did not help, so it was removed.
   - These surahs are now candidates whose ayah 1→2 boundary must be set by ear (flag `opening-squeezed`, priority 1). They are no longer counted as failures.

**Outcome of all 462 untimed listed surahs:**
- **Processed:** 441.
- **Excluded:** 21 (Rifaat).
- **Remaining:** 0.
- **Candidates:** 397 passed every automated check. Each needs the listening review; none is approved.
- **Blocked:** 32 VBR files (Islam Sobhi 29, Yasser Salama 42 and 48, Ajmi 42). The app cannot seek a VBR stream to an ayah precisely (0.5–1.8 s off).
- **Failed:** 12.
  - Rifaat: 10, text not confirmed (median score 0.12–0.21, the wrong-text controls' range);
  - structure: 2 (Yasser Salama 90, Saleh Al-Talib 86).
- **Unexplained audio at an end (over 30 s):** 2 candidates. Saleh Al-Talib 1 has 44 s before ayah 1, and Islam Sobhi 54 has 411 s after the last ayah, both known since Phase 3.1. Listen before approving.
- **Boundaries:** 24,354 in all, of which 3,699 are flagged (15 %).
  - Heavy listening: Rifaat (still failed), Ajmi (256 / 445), Islam Sobhi (1,590 / 5,736), Saleh Al-Talib (313 / 1,259).
  - Light: Sufi (9 / 687), Maher (15 / 1,257), Hudhaifi (24 / 1,141), Banna (387 / 6,120).
- **Review worklists** (the 441 packages not blocked): 6,157 of 24,379 boundaries. Of these, 1,861 are priority 1 and 1,592 priority 2.

## 5. All 17 reciters

| Reciter | Production (verified) | Development | New aligned candidates | Human-approved | Blocked / failed / excluded | Remaining unprocessed | Not on MP3Quran | Permission | Identity / riwayah |
|---|---|---|---|---|---|---|---|---|---|
| Abdul Basit Abdus Samad | 114 | 0 | 0 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Muhammad Siddiq Al-Minshawi | 107 | 5 | 2 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Ahmed Naeena | 113 | 0 | 1 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Mahmoud Khalil Al-Husary | 103 | 8 | 3 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Mahmoud Ali Al-Banna | 1 | 0 | 113 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Yasser Mahmoud Salama | 0 | 0 | 111 | 0 | 2 / 1 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | identity unconfirmed (MP3Quran names «ياسر سلامة») |
| Saud Al-Shuraim | 89 | 22 | 3 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Abdul Rashid Ali Sufi | 101 | 0 | 13 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Ali Al-Hudhaifi | 103 | 0 | 11 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Abu Bakr Al-Shatri | 101 | 9 | 4 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Ahmed Al-Ajmi | 107 | 0 | 6 | 0 | 1 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Maher Al-Muaiqly | 101 | 0 | 13 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | labelled «المصحف المجود» only; Hafs confirmed by its timing |
| Abdullah Basfar | 108 | 0 | 6 | 0 | 0 / 0 / 0 | 0 | 0 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Saleh Al-Talib | 0 | 0 | 31 | 0 | 0 / 1 / 0 | 0 | 82 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Muhammad Rifaat | 0 | 0 | 0 | 0 | 0 / 10 / 21 | 0 | 83 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | historical recordings; text not confirmed by alignment |
| Islam Sobhi | 0 | 0 | 80 | 0 | 29 / 0 / 0 | 0 | 5 | MP3Quran streaming (site-wide grant; per-recording rights not established; offline off) | Hafs murattal (MP3Quran label) |
| Ahmed Mohamed Salama | 0 | 0 | 0 | 0 | 0 / 0 / 0 | 0 | 114 | none: Assabile only, no grant | not Yasser Salama; no recording in the app |

The table's columns:
- **Production:** the committed catalogue, unchanged (1,148 surahs).
- **Development:** development builds only.
- **New aligned candidates:** play nowhere.

**Human-approved: 0 everywhere.** No surah reaches the app until a person approves it in the reviewer and
`apply-review.mjs` accepts it.

The potential total with every candidate approved is 1,148 + 44 + 397 = 1,589 of the 1,654 surahs MP3Quran lists for these recordings (17 × 114 = 1,938 possible). The rest:
- 32 blocked (VBR);
- 12 failed;
- 21 excluded;
- 284 surahs with no MP3Quran recording at all (Saleh Al-Talib 82, Rifaat 83, Islam Sobhi 5, Ahmed Mohamed Salama 114).

## 6. Development activation (Part E)

- **New activations: none.** No recording has a complete listening review, so nothing was activated, and no approval check was bypassed.
- **Development stage:** the only change is the 6 Husary surahs accepted by the measured route (evidence above). That route is not listening approval.
- **Production:** unchanged. `reciterCatalog.ts`, `measuredTiming.ts`, `audit-results.json` and `measured-timing.json` are byte-identical to HEAD.
- **Untimed surah-only playback:** stays off (`SURAH_ONLY_PLAYBACK = false`).

## 7. Blockers

1. **Listening review.** It is required for every development surah before promotion, and for every candidate before activation. That is 6,157 worklist boundaries in all; 1,861 are priority 1. I cannot listen.
2. **VBR files (32).** These need a CBR copy of the same recording, or a player that seeks VBR exactly.
3. **Rifaat.** The text is not confirmed by alignment in any of his 31 surahs, so each must be checked by ear end to end, or another source found. 83 of his surahs have no recording.
4. **Missing recordings.** Saleh Al-Talib has 82 and Islam Sobhi 5. Ahmed Mohamed Salama has no permitted recording at all.
5. **Identity.** Yasser Salama's identity is unconfirmed (MP3Quran names «ياسر سلامة»).
6. **Maher 34 and 68.** They were withdrawn from production on a measurement bug. Re-enabling them is an owner decision.
7. **Permissions.** MP3Quran's grant is site-wide; per-recording rights are not established, and offline use stays off.

## 8. Testing

- **TypeScript:** clean.
- **Lint:** clean.
- **Full suite:** 3,127 passed, 37 failed, 1 skipped.
  - The 37 failures are exactly the known QPC renderer failures in `mushafScreen.test.ts`. They reproduce on a clean HEAD and are unrelated to audio.
- **Audio tests:**
  - all 12 audio test files: 225 passed (including the new `audioReviewTools.test.ts`, 10 tests);
  - the audio player tests in `mushafScreen.test.ts`: 35 passed.
  - Playback, Repeat Ayah and Full Surah show no regressions. The app's audio code was not changed in this phase.
- **Reviewer:** driven end to end in headless Chrome against the final 485 packages.
- **apply-review:** acceptance and the six refusals were tested on a copy of the development data.
