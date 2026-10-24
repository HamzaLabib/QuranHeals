# Forced alignment (experimental, outside the app)

Generates **candidate** ayah timing for a whole-surah recording that has none, and flags the boundaries a person must
listen to. Nothing here is read by `generate-catalog.mjs` or shipped in the app: aligned timing is never published
automatically.

| File | Purpose |
|---|---|
| `align_mms.py` | CTC forced alignment (torchaudio MMS_FA, GPU) of the recording to the canonical Tanzil Uthmani text (`backend/data/quran/quran-uthmani.txt`), Basmala as ayah 0, separate opening letters spelled out; then each boundary is snapped to the longest pause near the aligned onset. Run it twice: with star tokens between ayahs (default) and with `--no-star-between`. |
| `textnorm.py` | Canonical text → romanised words for MMS (needs `uroman`). |
| `completeness.py` | Completeness evidence for whole-surah files: per-ayah alignment score against the canonical text, audio before the first and after the last ayah. Calibrated against complete files and wrong-text controls (see docs/audio/flagged-recordings-2026-10-18.md). Never approves. |
| `flag_boundaries.py` | Structural checks (ayahs 1..N once, in order, inside the audio, no overlaps), the two-configuration comparison, the ambiguity flags, the candidate timing and its fingerprint (`timingFingerprint` / `fingerprint.mjs`), and the listening worklist. Output is always `status: experimental, publishable: false`. Uses `../pylib` (miniaudio, numpy) only. |

```bash
# GPU environment with torch, torchaudio, uroman, miniaudio, numpy (not in ../pylib):
python -X utf8 align_mms.py ../../../backend/data/quran/quran-uthmani.txt 65 sobhi_065.mp3 a.json --no-star-between  # primary
python -X utf8 align_mms.py ../../../backend/data/quran/quran-uthmani.txt 65 sobhi_065.mp3 b.json                    # comparison
python -I -X utf8 flag_boundaries.py sobhi_065.mp3 a.json b.json flags.json
```

**`--no-basmala`** (Phase 4.8, off by default): aligns without the Basmala segment before ayah 1, for recordings that do
not recite it aloud (Haram prayer recordings). Without it, the forced Basmala ate up to 3.2 s of ayah 1 in 15 of 24
Saleh Al-Talib prayer files (Phase 4.7). Pass it to both runs of a recording. Nothing else changes, and output without
the option is unchanged.

Tests: `test_align_basmala.py` (GPU environment).
- **Always:** segment construction, default and with the option.
- **With `QH_ALIGN_REGRESSION=<cases.json>`:** re-aligns recordings and compares them with earlier outputs.

Verified 2026-10-19:
- **Without the option:** Talib 95 and 104, Sobhi 65 and Banna 103 reproduce their Phase 4.7 / 4.1 outputs exactly.
- **With it:** Talib 91, 95 and 104 reproduce the Phase 4.7 variant, and ayah 1 starts within 100 ms of the measured voice onset.

## Ambiguity flags: corrected evaluation (2026-10-18)

Flags: `configs-disagree` (the two runs > 300 ms apart), `no-pause`, `short-pause` (< 250 ms), `competing-pause`
(another pause ≥ 60 % as long, > 400 ms away), `snap-far` (> 1 s from the aligned onset), `low-score` (supporting
signal only).

Data: the Phase 2 alignments of recordings with verified timing. Maher Al-Muaiqly 1, 18, 55, 67, 78, 87, 93 and 112
(291 boundaries); Ali Al-Hudhaifi 1, 18, 55, 67, 78 and 112 (263): **554 boundaries**.

Reference: the **independent** pause before each ayah.
- Maher: Quran Foundation's word segments of the same performance (+25 ms file lag).
- Hudhaifi: the voiced span of each EveryAyah clip located in the MP3Quran file.
- A boundary is *in pause* inside it, *edge* within 150 ms of it, else *wrong pause*.

MP3Quran's own start time is **not** a sound reference: it can sit in the previous word's fading tail.

| | No-star primary (recommended) | Star primary |
|---|---|---|
| In the reference pause | 549 | 548 |
| Edge (≤ 150 ms; same pause) | 3: Maher 55:44, 55:71; Hudhaifi 78:19 | same 3 |
| Wrong pause, flagged | 0 | 1: Maher 18:21 (9.6 s off; `configs-disagree`, `short-pause`) |
| Joined recitation (reference gap < 150 ms), unflagged | 2: Maher 55:19 (gap 10 ms), Hudhaifi 18:94 (gap 80 ms) | same 2 |
| Flagged boundaries | 23 (4.2 %), all of them on correct boundaries | 23 (22 correct) |

Reconciling the earlier reports:
- **Phase 2 (99.3 % in pause, wrong at Maher 55:44 and 55:71):**
  - Measured on the no-star run, over the 552 boundaries with a reference pause (joined ones excluded), with no edge
    tolerance.
  - 55:44 and 55:71 are inside the same silence: the chosen point is 105 and 65 ms before Quran Foundation's
    end-of-word mark, in the fading tail that the energy detector counts as pause.
  - They are edge disagreements, not wrong pauses.
- **First Phase 3 report (wrong at Maher 18:21 and 18:96):**
  - Measured with the star run as primary, against MP3Quran's start ± 250 ms.
  - 18:21 is a real wrong pause, but only in the star configuration (the no-star run is right). It is the 9.6 s error
    Phase 2 already attributed to star tokens.
  - 18:96 was a reference artefact: the candidate lies inside Quran Foundation's pause, and MP3Quran's start is 115 ms
    inside the previous ayah's tail. Withdrawn.
- **The real blind spot is joined recitation** (Phase 3 reading; see Phase 4.1 below: both cases were reference artefacts):
  - At 55:19 and 18:94 the reciter barely pauses. The energy detector finds 0.9–1.4 s of quiet, which the word-level
    reference shows is a soft trailing sound of the previous ayah, below the energy threshold.
  - The chosen boundary falls 420–700 ms into that sound. No energy-based flag can tell these from a real pause.
  - The listening review must cover them: in a joined recitation, sample the boundaries whose pause is followed
    immediately by the next onset.

The flags reduce listening; they do not replace it. A recording with **no** flags can still have a wrong boundary, and a
confidence score cannot clear one.

## Phase 4.1 (2026-10-18): new checks, and the "errors" that were reference artefacts

New in `flag_boundaries.py` (each boundary also gets `acoustic`: silence / reverb-tail / shallow, with its depth in dB
below the loud recitation around it):

| Flag | Meaning |
|---|---|
| `shallow-pause` | the chosen pause is < 15 dB below the recitation and has no reverberation-tail shape (possible joined ayahs) |
| `anchored` | the comparison run was aligned in windows cut at this boundary (`align_mms.py --anchors`, long surahs) |
| `extra-audio` | the star-token run leaves > 1.5 s of sound unassigned between two ayahs (repetition, supplication, other audio) |
| `reordered`, `past-own-end` | (Phase 4.2) the snapped pause lay before the previous boundary, or after this ayah's own aligned end (the next boundary's pause, with very short ayahs); the longest pause between those limits is used instead and `moved_from_ms` keeps the original. Tests: `test_flag_boundaries.py` (`python -I -X utf8 test_flag_boundaries.py`) |

`align_mms.py --both <star.json>` writes both configurations from one set of emissions (identical output, one process);
recordings over 50 minutes get the windowed comparison run (`--anchors`), which also avoids the GPU failure of a
single 2-hour alignment with star tokens.

Re-evaluated on the same 554 reference boundaries, the new checks add 1 flag (`extra-audio`, on a correct boundary) and
every chosen boundary is in true silence (34-97 dB below the recitation). The two "joined recitation" misses above were
re-examined in the audio: Maher 55:19 is chosen inside 1.4 s of silence that includes digital zeros (82.6 dB down); the
reference had the previous ayah's last word running across the whole silence. Hudhaifi 18:94 is chosen inside an
860 ms pause 41 dB down; the reference's 80 ms gap comes from mapping the EveryAyah clip's edges into the file, which is
approximate at the clip's ends. Neither is a wrong pause in the audio; both remain worth a listen.

Maher candidates 3, 36 and 68 against Quran Foundation's word timing (332 boundaries): 15 disagreements, every chosen
boundary 64-96 dB down. 14 of them: Quran Foundation's word end falls within 40 ms of an exact 10-second mark (a
segmentation artefact of the reference). The 15th, 68:12 (reported in Phase 4 as "1.17 s early, unflagged"), is right:
the 1.4 s silence before it includes digital zeros, and the sound Quran Foundation gives to ayah 11 is the held initial
mim (ghunna) of «مَّنَّاعٍ», a fresh voiced onset (pitch rising from 126 Hz) 0.9 s before its vowel. A reference timing
is evidence to compare with, never ground truth: every disagreement is decided in the audio.

## Publication

Aligned timing may reach the app only when all of the following are done, and none is automated:

1. both configurations aligned, `flag_boundaries.py` structure `ok`;
2. every flagged boundary, plus at least the first, last and a random 10 % of the rest, listened to and corrected;
3. the corrected timing's fingerprint recorded with the reviewer's name and date;
4. explicit approval by the owner;
5. for the development stage: `review/make-packages.mjs` → listening in `review/review.html` → "Approve whole surah" →
   `development/apply-review.mjs <package.json> <review.json>` (refuses unless the review is of exactly that timing,
   approved as a whole, every worklist boundary marked Correct and none Needs correction / Unresolved, and the package is
   not blocked: structure, VBR file, completeness), then `generate-catalog.mjs`; for production, a separate owner
   decision (no tool promotes development timing).

**Not published:** the experimental Islam Sobhi Surah 65 timing (Way2Quran audio; Way2Quran does not permit use, and
the speaker check was inconclusive).
