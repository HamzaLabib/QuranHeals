# Failed recordings — Phase 4.2: root causes and repairs (2026-10-18)

The 12 surahs that failed automated validation in Phase 4.1, each investigated on its own evidence. Local only: nothing
committed, no production data changed, nothing approved or activated. A repair makes a surah **eligible for listening
review**; it is not approval. Evidence record: `tools/quran-audio/audit-data/failed-recordings-phase-4-2-2026-10-18.json`.

**Results:**

| | Count |
|---|---|
| Investigated | 12 |
| Repaired, now passing every automated check and in the listening queue | **2** (Yasser Salama 90, Saleh Al-Talib 86) |
| Still failing | 10 (Muhammad Rifaat) |
| Requiring a replacement recording, or timing made by a listener | 10 (Muhammad Rifaat) |
| Shared pipeline defects found and corrected | 1 (boundary placement, `flag_boundaries.py`); it also affected 6 surahs that were already passing |
| Previously passing candidates changed by the fix | 6, now with a boundary that is correct in the audio; the other 433 unchanged |

## The two structural failures

### Yasser Mahmoud Salama — Surah 90, Al-Balad (البلد)

| Field | Result |
|---|---|
| Recording | MP3Quran `yasser-salama/r1/090.mp3`, 128 kbps CBR, 90.8 s, Hafs murattal (MP3Quran label). The reciter's identity is unconfirmed (see Phase 4.1). |
| Original failure | `structure: a candidate ayah has no length`: ayah 13 ran from 52,470 to 52,187 ms. |
| Root cause (**confirmed**) | 90:13 «فَكُّ رَقَبَةٍ» is about 1.2 s long, shorter than the pause-snapping window (aligned onset −1.5 s to +2 s). In that window the longest pause was the one **after** the ayah (52.24–52.70 s, 460 ms), not the one before it (50.60–50.98 s, 380 ms). The ayah's start was put at its own end, and ayah 14 was left no room. The audio confirms it: voice from 51.0 to 52.3 s, between those two pauses. |
| Repair | A shared fix in `flag_boundaries.py` (below). 90:13 moved from 52,470 to **50,790 ms**, inside the 50.60–50.98 s pause and 23 dB below the recitation. No re-alignment was needed. |
| Validation | **Pass.** Structure OK (19 boundaries in order, every ayah has a length); text confirmed (median character score 0.527, against 0.17–0.18 for wrong-text controls); audio before the first ayah / after the last 3.8 s / 2.4 s; CBR, so seeking works; no ayah looks absent. |
| Regression | Re-flagging all 441 candidates changed exactly 8 surahs. The 14 reference surahs (554 boundaries) are byte-identical, and `alignment/test_flag_boundaries.py` passes. |
| Listening review | **Ready.** The repaired boundary 12→13 is on the worklist as priority 1, marked "Repaired automatically: moved from 0:52.47". |
| Remaining issue | Listening approval, and the reciter's identity. The comparison run still has the old position, so the boundary is also flagged `configs-disagree`: hear it. |

### Saleh Al-Talib — Surah 86, At-Ṭāriq (الطارق)

| Field | Result |
|---|---|
| Recording | MP3Quran `saleh-talib/r1/086.mp3`, 128 kbps CBR, 61.9 s, Hafs murattal (MP3Quran label). |
| Original failure | `structure: a candidate ayah has no length`: ayah 15 ran from 49,850 to 49,804 ms. |
| Root cause (**confirmed independently in this file**) | 86:14 «إِنَّهُۥ لَقَوْلٌ فَصْلٌ» (about 1.6 s) snapped to the pause after it (49.64–50.06 s, 420 ms) instead of the one before it (47.82–48.10 s, 280 ms). The audio has voice from 48.1 to 49.8 s, between those pauses. It is the same mechanism as Yasser Salama 90, but each case was verified on its own audio. |
| Repair | The same shared rule. 86:14 moved from 49,850 to **47,960 ms**, inside the 47.82–48.10 s pause and 21.6 dB below the recitation. |
| Validation | **Pass.** Structure OK (16 boundaries); text confirmed (median score 0.566); audio before / after 1.1 s / 1.5 s; CBR; no ayah looks absent. |
| Regression | As above. |
| Listening review | **Ready.** The repaired boundary 13→14 is priority 1, marked "Repaired automatically: moved from 0:49.85". |
| Remaining issue | Listening approval. The boundary is also flagged `configs-disagree`, for the same reason as Yasser Salama 90. |

### The shared defect and its fix

- **Rule:** a start boundary must lie after the previous boundary **and** before the ayah's own aligned end.
- **When the snapped pause breaks it,** the replacement is, in order: the longest pause inside those limits, else the aligned midpoint, else the aligned onset. The boundary is flagged `reordered` or `past-own-end` (priority 1) and records `moved_from_ms`.
- **My Phase 4.1 fix only treated the symptom.** It moved the *next* boundary later when two boundaries collided, so in 6 passing surahs a boundary stayed at the end of its own ayah. It was flagged, but it was wrong.
- **The same fix corrected those 6 surahs.** Each now has the boundary inside the true preceding pause, 18–23 dB down: Banna 69:2, Saleh Al-Talib 74:7 and 75:8, Yasser Salama 77:13 and 89:2.
- **The exception is Saleh Al-Talib 80:9.** There the reciter joins the two ayahs (no pause), so the aligned onset is used; it shows "no clear silence" (9.6 dB) and is priority 1.
- **Its Phase 4.1 fallback also had a gap.** The last resort, the aligned onset, was not checked against the previous boundary; it now is.
- **Tests:** `tools/quran-audio/alignment/test_flag_boundaries.py` has 3 synthetic-audio cases. Two of them fail if the rule is removed, which was checked against a temporary copy of the tool.

## The ten Muhammad Rifaat recordings

**Common facts, confirmed:**
- All ten are MP3Quran `muhammad-refaat/r1`, 128 kbps CBR at 44.1 kHz, labelled «حفص عن عاصم - مرتل».
- They are historical recordings: very slow (313–530 ms per letter, against roughly 80–120 for a typical murattal) and heavily restored.
- 24–41 % of each file is exact digital silence, in 22–200 separate runs, the signature of a restoration noise gate. Clean recordings have 0–2 runs.
- All ten fail **both** independent recognisers:
  - the MMS forced aligner scores them at the wrong-text level;
  - a Whisper model fine-tuned on Quran recitation (`tarteel-ai/whisper-base-ar-quran`), used here only as a diagnostic, ranks the expected surah only 16th–85th of 114, where a clean recording of the same surah ranks first (0.864).

**What the transcripts do show:**
- Openings consistent with the Basmala and the surah's first words. Examples are «…الرَّحِيمِ وَالسَّمَاءَ» for 85 (Al-Burūj) and «…وَالْقِيَامَةِ» for 75.
- The closing «…اللَّهُ الْعَظِيمُ» (صدق الله العظيم) in 54 and 73, and similar endings in 98 and 81.
- Recognised fragments that mostly advance through the expected surah.
- This is weak evidence that each file is an authentic recitation of the expected surah. It is not enough to place any boundary.

| Surah | Length | Alignment score (controls 0.17–0.18; complete files 0.46–0.58) | Quran-ASR rank of the expected surah | Ayahs recognised | Energy 2–3 / 3–4 kHz (re 300–1000 Hz) | Digital silence | ms per letter | Audio before ayah 1 / after the last |
|---|---|---|---|---|---|---|---|---|
| 54 Al-Qamar (القمر) | 1,701 s | 0.152 | 46 / 114 | 8 / 55 (with jumps) | −24 / −32 dB | 38 % (200 runs) | 382 | 17.7 / 5.0 s |
| 73 Al-Muzzammil (المزمل) | 903 s | 0.208 | 43 / 114 | 5 / 20 (with jumps) | −17 / −21 dB | 38 % (38 runs) | 477 | 8.4 / 14.8 s |
| 75 Al-Qiyāmah (القيامة) | 814 s | 0.178 | 55 / 114 | 3 / 40 | −17 / −22 dB | 41 % (33 runs) | 469 | 6.4 / 11.3 s |
| 76 Al-Insān (الإنسان) | 1,402 s | 0.195 | 49 / 114 | 7 / 31 (with jumps) | −16 / −22 dB | 41 % (113 runs) | 530 | 11.6 / 10.4 s |
| 79 An-Nāziʿāt (النازعات) | 836 s | 0.201 | 65 / 114 | 3 / 46 | −32 / −45 dB | 41 % (28 runs) | 468 | 10.3 / 7.2 s |
| 81 At-Takwīr (التكوير) | 448 s | 0.116 | 85 / 114 | 0 / 29 | −32 / −46 dB | 35 % (22 runs) | 367 | 19.9 / 5.2 s |
| 85 Al-Burūj (البروج) | 507 s | 0.125 | 16 / 114 | 4 / 22 | −34 / −71 dB | 38 % (35 runs) | 335 | 13.4 / 3.6 s |
| 89 Al-Fajr (الفجر) | 726 s | 0.188 | 49 / 114 | 4 / 30 | −33 / −54 dB | 39 % (33 runs) | 373 | 9.9 / 1.3 s |
| 96 Al-ʿAlaq (العلق) | 369 s | 0.158 | 83 / 114 | 1 / 19 | −42 / −63 dB | 34 % (22 runs) | 313 | 42.5 / 23.2 s |
| 98 Al-Bayyinah (البينة) | 357 s | 0.162 | 62 / 114 | 2 / 8 | −48 / −69 dB | 24 % (40 runs) | 369 | 17.6 / 6.5 s |

**Per-file differences, kept apart rather than generalised:**
- **54, 73, 75, 76** keep sound up to about 4 kHz.
- **79, 81, 85, 89, 96, 98** lose nearly everything above about 2–2.5 kHz.
- **54 and 76** have far more, shorter gate runs (200 and 113), consistent with gating that closed inside phrases.
- **96** has the most audio outside the recitation (42.5 s before, 23.2 s after); it is unidentified and needs listening.
- **81** is the worst on both recognisers (0 ayahs recognised).

None of these differences changes the outcome. Every file is unreadable by both models.

**Root cause: not confirmed.**

Hypotheses tested on Surah 98 and on clean recordings of the same surah, and rejected:

| Hypothesis | Test | Result |
|---|---|---|
| Lost high frequencies | Clean recordings (Yasser Salama, Banna) low-passed to 4 kHz and 2 kHz | Still aligned, every ayah in order (mean score 0.53 → 0.525 and 0.50 → 0.45). **Rejected** |
| Restoration gating | Clean recording gated (16–22 % zeroed), with and without 2 kHz low-pass | Degraded (0.44–0.52) but still found the ayahs, mostly in order. **Rejected as a sufficient cause** |
| High, melismatic voice | Rifaat 98 pitch-shifted down 4 semitones, duration kept | Worse (0.206 → 0.156); the shifted control still worked (0.40, in order). **Rejected** |
| Search window too short for his slow pace | Spotting windows widened from 40 s to 150 s | No change (0.21, scattered). **Rejected** |
| Wrong content | Quran-ASR openings, endings and fragment order | Fragments mostly follow the expected surah. **Not supported** (weak evidence) |

**Most likely,** the combination of historical transfer degradation, heavy restoration, and his recitation style puts the
audio outside what both models can read. That is a hypothesis, not a demonstrated cause.

**Repair:** none is possible automatically. Every legitimate route was tried:
- alignment configuration (window size);
- preprocessing that keeps timestamps valid (pitch);
- an independent recogniser.

No route produced evidence-backed ayah boundaries. Placing boundaries from pauses alone would mean inventing which ayah each phrase is, so it was not done.

**Per-surah verdict (all ten):**
- **Validation:** fail (text not confirmed).
- **Regression:** unchanged (their alignments and flags are untouched).
- **Listening review:** not ready. The packages stay blocked with the reason shown, and Approve is disabled.
- **Remaining issue:** **requires a replacement recording** (a cleaner transfer of the same Rifaat performance), or ayah timing made by a listener from scratch, which the current reviewer does not support.
- The 21 other Rifaat surahs (excluded in Phase 4.1) have the same evidence pattern and the same status.

## Changes in this phase

**Scripts:**
- `alignment/flag_boundaries.py`: the boundary rule; the `past-own-end` flag; `moved_from_ms`; checks label.
- `alignment/test_flag_boundaries.py` (new).
- `review/make-packages.mjs`: `repairedFromMs`; `past-own-end` is priority 1.
- `review/review.html`: a "Repaired automatically: moved from …" chip and the plain-language flag text.

**Data and documents:**
- `audit-data/failed-recordings-phase-4-2-2026-10-18.json` (new).
- This document.

**Packages:**
- 485 rebuilt. Yasser Salama 90 and Saleh Al-Talib 86 are no longer blocked, giving 399 reviewable candidates and 42 blocked (32 VBR, 10 Rifaat).
- The 8 surahs touched by the fix carry their repaired boundaries.

**Unchanged:**
- Production catalogue and timing (= HEAD), the development timing, and the audio player.
- The diagnostic tools (`spot.py`, `transcribe.py`, gating and pitch tests) and the Quran-ASR model live in the scratch area only; nothing was added to the app or the repository's dependencies.
