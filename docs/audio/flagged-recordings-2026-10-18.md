# Duration-flagged whole-surah candidates (2026-10-18)

Evidence for the 26 MP3Quran files that `tools/quran-audio/surah-mode/check-candidates.mjs` flagged by duration (an
earlier summary said 28: a miscount). None of them plays in the app, and nothing in the catalogue was changed. Duration
alone rejects nothing: it only chose what to examine.

## Method

- **Expected range:** the surah's median length over all 16 recordings, times the reciter's own median ratio
  ("pace"), ± 0.8–1.25×. For Sheikh Muhammad Rifaat the pace (3.29×) is estimated from his own 31 files, several of
  which look atypical, so his expected ranges are themselves unreliable.
- **Content:** each file was downloaded (sizes equal to the audit's) and force-aligned to the canonical Tanzil text of its
  surah (`tools/quran-audio/alignment/align_mms.py`, MMS CTC, star tokens between ayahs), then summarised by
  `alignment/completeness.py` (results: `tools/quran-audio/audit-data/flagged-completeness-2026-10-18.json`).
- **Calibration on the same day:**
  - Abdul Basit's verified complete files (Surahs 1, 74, 82, 87, 100, 106, 107, 112, 114): median score **0.46–0.58**,
    lowest single ayah 0.13–0.51.
  - Wrong-text controls (his 82 against Surah 84's text, his 100 against 101's): median **0.17–0.18**, lowest 0.00–0.12.
- **What the alignment cannot show:**
  - A high score shows the surah's words are present in order. It does not prove that nothing is missing *inside* an
    ayah, and it says nothing about who the voice is.
  - With star tokens the aligner spreads missing text over neighbouring audio instead of collapsing it, so the
    "collapsed ayah" check found nothing, even in the wrong-text controls. It is uninformative.
  - A low score can also come from very old or noisy audio, or a highly ornamented performance, and not only from
    missing or different text.

## Results

| Reciter | Surah | Catalogue status | Duration | Expected range (0.8-1.25×) | Suspicion | Content evidence (alignment) | Recommended action |
|---|---|---|---|---|---|---|---|
| rifaat | 1 | listed; no timing for this recording | 3:39 | 2:14–3:29 | long: 1.31× predicted | text NOT confirmed: median score 0.158 (min 0.148), at or below the wrong-text controls (0.17-0.18); ayahs cover 19% of the file; 16.6s before ayah 1, 40.5s after the last ayah | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 10 | listed; no timing for this recording | 82:46 | 100:19–156:45 | short: 0.66× predicted | text NOT confirmed: median score 0.122 (min 0.029), at or below the wrong-text controls (0.17-0.18); ayahs cover 76% of the file | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 11 | listed; no timing for this recording | 68:53 | 108:03–168:50 | short: 0.51× predicted | text NOT confirmed: median score 0.115 (min 0.042), at or below the wrong-text controls (0.17-0.18); ayahs cover 84% of the file; 23.5s before ayah 1 | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 12 | listed; no timing for this recording | 48:36 | 97:12–151:53 | short: 0.4× predicted | text NOT confirmed: median score 0.109 (min 0.059), at or below the wrong-text controls (0.17-0.18); ayahs cover 93% of the file; 17.9s after the last ayah | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 17 | listed; no timing for this recording | 41:50 | 83:41–130:45 | short: 0.4× predicted | text NOT confirmed: median score 0.08 (min 0.021), at or below the wrong-text controls (0.17-0.18); ayahs cover 81% of the file; 15.5s before ayah 1 | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 19 | listed; no timing for this recording | 39:12 | 49:47–77:48 | short: 0.63× predicted | text NOT confirmed: median score 0.126 (min 0.021), at or below the wrong-text controls (0.17-0.18); ayahs cover 75% of the file | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 20 | listed; no timing for this recording | 41:29 | 70:37–110:21 | short: 0.47× predicted | text NOT confirmed: median score 0.089 (min 0.01), at or below the wrong-text controls (0.17-0.18); ayahs cover 78% of the file | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 48 | listed; no timing for this recording | 29:21 | 31:44–49:35 | short: 0.74× predicted | text NOT confirmed: median score 0.123 (min 0.087), at or below the wrong-text controls (0.17-0.18); ayahs cover 74% of the file; 24.5s before ayah 1 | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 56 | listed; no timing for this recording | 10:25 | 26:02–40:41 | short: 0.32× predicted | text NOT confirmed: median score 0.071 (min 0.013), at or below the wrong-text controls (0.17-0.18); ayahs cover 67% of the file | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 69 | listed; no timing for this recording | 11:37 | 17:12–26:53 | short: 0.54× predicted | text NOT confirmed: median score 0.123 (min 0.042), at or below the wrong-text controls (0.17-0.18); ayahs cover 59% of the file | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 72 | listed; no timing for this recording | 26:38 | 15:54–24:50 | long: 1.34× predicted | text NOT confirmed: median score 0.216 (min 0.114), at or below the wrong-text controls (0.17-0.18); ayahs cover 43% of the file; 21.1s before ayah 1, 10.5s after the last ayah | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 77 | listed; no timing for this recording | 6:13 | 12:45–19:55 | short: 0.39× predicted | text NOT confirmed: median score 0.102 (min 0.029), at or below the wrong-text controls (0.17-0.18); ayahs cover 65% of the file | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 78 | listed; no timing for this recording | 21:18 | 11:35–18:07 | long: 1.47× predicted | text NOT confirmed: median score 0.232 (min 0.097), at or below the wrong-text controls (0.17-0.18); ayahs cover 28% of the file; 31.9s before ayah 1 | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 82 | listed; no timing for this recording | 10:35 | 5:01–7:50 | long: 1.69× predicted | text NOT confirmed: median score 0.239 (min 0.076), at or below the wrong-text controls (0.17-0.18); ayahs cover 26% of the file; 62s before ayah 1, 17.1s after the last ayah | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 83 | listed; no timing for this recording | 19:56 | 10:46–16:50 | long: 1.48× predicted | text NOT confirmed: median score 0.161 (min 0.079), at or below the wrong-text controls (0.17-0.18); ayahs cover 32% of the file; 15.9s before ayah 1, 13.1s after the last ayah | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 87 | listed; no timing for this recording | 10:36 | 4:41–7:19 | long: 1.81× predicted | text NOT confirmed: median score 0.185 (min 0.134), at or below the wrong-text controls (0.17-0.18); ayahs cover 18% of the file; 54.4s before ayah 1, 14.1s after the last ayah | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 88 | listed; no timing for this recording | 15:08 | 5:43–8:56 | long: 2.12× predicted | text NOT confirmed: median score 0.187 (min 0.126), at or below the wrong-text controls (0.17-0.18); ayahs cover 21% of the file; 95.7s before ayah 1 | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| rifaat | 100 | listed; no timing for this recording | 4:38 | 2:36–4:03 | long: 1.43× predicted | text NOT confirmed: median score 0.171 (min 0.11), at or below the wrong-text controls (0.17-0.18); ayahs cover 28% of the file; 17.9s before ayah 1 | Keep disabled. Listen end to end against the text: may be partial, a selection, or historical audio the aligner cannot read; completeness cannot be established automatically. |
| ajmi | 74 | listed; timing rejected (short ayah 112ms; timing ends 37061ms before audio end) | 7:54 | 4:27–6:57 | long: 1.42× predicted | all 56 ayahs matched (median score 0.457, min 0.205); 64% coverage; no extra audio at either end | Likely complete; duration flag probably from the pace estimate. Approve only after a listening review. |
| ajmi | 106 | listed; timing rejected (acoustic 2/3, dense 2/3) | 0:20 | 0:23–0:35 | short: 0.71× predicted | all 4 ayahs matched (median score 0.518, min 0.281); 83% coverage; no extra audio at either end | Likely complete; duration flag probably from the pace estimate. Approve only after a listening review. |
| ajmi | 107 | listed; timing rejected (acoustic 4/6, dense 4/6) | 0:28 | 0:30–0:46 | short: 0.76× predicted | all 7 ayahs matched (median score 0.494, min 0.389); 89% coverage; no extra audio at either end | Likely complete; duration flag probably from the pace estimate. Approve only after a listening review. |
| husary | 1 | listed; timing rejected (ayah set 6/7 first=1 last=6) | 0:57 | 1:04–1:40 | short: 0.71× predicted | all 7 ayahs matched (median score 0.583, min 0.571); 83% coverage; no extra audio at either end | Likely complete; duration flag probably from the pace estimate. Approve only after a listening review. |
| islam-sobhi | 54 | listed; no timing for this recording | 13:57 | 6:04–9:28 | long: 1.84× predicted | all 55 ayahs matched (median 0.485, min 0.381) but 410.9s after the last ayah | Listen to the extra audio (a second recitation, a duʿaʾ, repetition?). Keep disabled until identified. |
| islam-sobhi | 112 | listed; no timing for this recording | 0:36 | 0:15–0:23 | long: 1.95× predicted | all 4 ayahs matched (median 0.62, min 0.527) but 14.2s after the last ayah | Listen to the extra audio (a second recitation, a duʿaʾ, repetition?). Keep disabled until identified. |
| saleh-talib | 1 | listed; no timing for this recording | 1:18 | 0:30–0:47 | long: 2.07× predicted | all 7 ayahs matched (median 0.563, min 0.395) but 44s before ayah 1 | Listen to the extra audio (a second recitation, a duʿaʾ, repetition?). Keep disabled until identified. |
| yasser-salama | 114 | listed; no timing for this recording | 1:02 | 0:27–0:43 | long: 1.8× predicted | all 6 ayahs matched (median 0.493, min 0.416) but 26.7s after the last ayah | Listen to the extra audio (a second recitation, a duʿaʾ, repetition?). Keep disabled until identified. |


## Conclusions

- **Sheikh Muhammad Rifaat (18 files):**
  - In every file the alignment fails to confirm the canonical text: median score 0.07–0.24, at or below the
    wrong-text controls.
  - The "short" files run 0.32–0.74× the prediction. They are consistent with selections (partial surahs), as many of
    his surviving radio recordings are.
  - The "long" files have the recited ayahs over only 18–43 % of the file, with 16–96 s before the first ayah. They are
    consistent with extra material, such as other recitations, audience or announcements.
  - Neither reading is proven: historical audio quality alone could lower the scores.
  - **None can be treated as complete.** Every one needs an end-to-end listening check against the text.
- **Probably complete, flag likely from the pace estimate:** Husary 1, Ajmi 74, 106, 107.
  - Every ayah scored above the wrong-text range, and there is no extra audio at either end.
  - Husary 1's MP3Quran *timing* lacked an ayah, but its audio has all 7.
  - Ajmi 74's ayahs cover only 64 % of the file, and its rejected timing ended 37 s before the audio did, so it may
    contain a repetition inside the surah. Listen to it.
- **Text present, plus unexplained extra audio:**
  - Islam Sobhi 54: **411 s after the last ayah**, half the file, perhaps another recitation appended.
  - Islam Sobhi 112: 14 s after the last ayah.
  - Saleh Al-Talib 1: 44 s before ayah 1.
  - Yasser Salama 114: 27 s after the last ayah, perhaps a duʿāʾ.
  - These need the extra audio identified before any approval.
- **Status:** all 26 stay disabled (no approval entries). The catalogue is unchanged.
