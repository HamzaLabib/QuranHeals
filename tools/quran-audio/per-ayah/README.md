# Per-ayah recordings (development preview)

A per-ayah recording has **one file per ayah** (EveryAyah's `SSSAAA.mp3`; `SSS000.mp3` is the surah's Basmala), instead
of one file per surah plus ayah timing. The file boundaries are the ayah boundaries, so nothing is timed or estimated.

Recordings (`recordings.mjs`):
- **Mohamed Gebril (محمد جبريل)**, `https://everyayah.com/data/Muhammad_Jibreel_128kbps/` (2026-10-23). Report: `docs/audio/gebril-per-ayah-2026-10-23.md`.
- **Ali Abdullah Jaber (علي عبد الله جابر)**, `https://everyayah.com/data/Ali_Jaber_64kbps/` (Phase 3, 2026-10-23), graded, with MP3Quran's Hafs recording (reciter 76) as identity reference. Report: `docs/audio/jaber-per-ayah-2026-10-23.md`.

**Development only.** The app loads the catalogue only when `__DEV__` is true (`mobile/src/audio/reciters.ts`), so a
release build has neither the reciter nor its data. The production catalogue (`../reciters.mjs`, `generate-catalog.mjs`)
is untouched. Rights are not established (`recordings.mjs`).

## Pipeline

Run from `QuranHeals/`. Audio stays outside the repository and OneDrive
(`%LOCALAPPDATA%/QuranHeals/per-ayah-cache/<folder>/`).

| Step | Command | Output |
|---|---|---|
| 1. Fetch | `node tools/quran-audio/per-ayah/everyayah-fetch.mjs --folder Muhammad_Jibreel_128kbps` | `files/`, `fetch-manifest.json` (HTTP answers, sizes, MD5 against `000_checksum.md5`, the `mistakes/` folder), `listing.json` |
| 2. Scan | `C:/Python312/python.exe -I -X utf8 tools/quran-audio/per-ayah/scan.py <cache>/files <cache>/scan.json` | MP3 structure, tags, levels, silences, edges, envelopes |
| 3. Text | `<gpu python> -I -X utf8 tools/quran-audio/per-ayah/verify_text.py backend/data/quran/quran-uthmani.txt <cache>/files <cache>/text-verification.json` | CTC scores (MMS_FA) against the expected ayah, its neighbours, a far control; greedy transcription |
| 4. Classify | `node tools/quran-audio/per-ayah/classify.mjs --recording gebril` | `tools/quran-audio/audit-data/gebril-per-ayah-risk-<date>.json` |
| 5. Dashboard | `node tools/quran-audio/per-ayah/make-review-packages.mjs --risk <risk.json> --config "<…>/audio-review-dashboard/dashboard.config.json" --out "<…>/Screenshots and Logs/gebril-per-ayah-review-<date>"` | one review package per surah + local review copies in the dashboard cache |
| 6. App | `node tools/quran-audio/per-ayah/generate-preview.mjs <risk.json>` | `mobile/src/audio/generated/perAyahPreview.ts` (development only) |

The GPU Python is the aligner's environment (torch, torchaudio, uroman, miniaudio; see `../alignment/README.md`).
Steps 2–3 take about 10 and 45 minutes for 6,349 files.

## Risk

`classify.mjs` marks a file **LOW** risk only when every check passes clearly, and **HIGH** risk otherwise, with every
reason. LOW risk is not a verification: it means no automated check found a reason to listen.

| Code | Meaning |
|---|---|
| `missing`, `not-fetched`, `redirect`, `decode`, `too-short` | not served as listed, unreadable, or almost empty (these also make the file unplayable) |
| `checksum`, `mistakes-folder` | the file differs from the folder's checksum list / an earlier copy is kept under `mistakes/` (replaced once) |
| `stray-name` | a mis-named file in the folder names this ayah |
| `format`, `splice`, `batch` | another format, a broken MP3 stream (cut or joined), or an isolated file from another encoding batch |
| `tag-artist`, `tag-album` | tags naming another reciter or source |
| `lead-silence`, `trail-silence`, `internal-silence`, `cut-start`, `cut-end`, `clipping` | extreme silences, sound at full level at an edge, clipping |
| `duration` | voiced length far from comparable ayahs (rolling window of the 300 ayahs nearest in letter count, surah pace removed) |
| `near-duplicate` | almost the same audio as an ayah with different words |
| `text-mismatch`, `text-ambiguous`, `text-weak`, `text-part`, `transcript-mismatch`, `transcript-weak`, `text-unverified` | the expected ayah is not clearly what is recited |
| `extra-before`, `extra-after`, `basmala-inside` | voiced audio outside the ayah's words (something else recited) |

**Graded recordings** (`graded: true` in `recordings.mjs`; Ali Jaber, Phase 3) also get a dashboard **tier** per file,
following `../review/manual/very-high.mjs`: only credible structural evidence is **veryhigh** (wrong or ambiguous mapping
to another ayah, `cut-*`, `extra-*`, `splice`, `format`, `identity`, `checksum` / `mistakes-folder`, missing or unreadable,
`duration`, `near-duplicate`, tags naming someone else); weak or uncertain text evidence (`text-weak`, `text-part`,
`transcript-weak`, `text-ambiguous`, `batch`) is **high**; extreme silences and clipping are **medium**. Under policy
auto-accept-v2 only veryhigh needs a person. A flagged file keeps `risk: high` whatever its tier: never cleared or
verified. Gebril (2026-10-23) is ungraded: every flagged file is Very High, as first packaged.

**Identity** (`classify.mjs --identity <dir>`): `../audit/align_everyayah.py <reference surah base> <EveryAyah folder>
<ayah counts list> <out> <work> <surahs>` against the reciter's full-surah reference (`recordings.mjs` `reference`).
An ayah whose every 3 s chunk is found in order (score ≥ 0.45) is the same performance; one that is not is `identity`
(Very High).

Text thresholds are calibrated on the recording itself (every ayah's audio is also scored against a far ayah of similar
length: the wrong-text control) and written into the report.

## Unified severity (Phase 4.8.10, all per-ayah reciters)

`severity.mjs` turns the classify.mjs report and `boundary_check.py` (word-level alignment of each flagged file and its
neighbours at both edges, with far-ayah controls) into the dashboard's tiers with exact reason codes: Very High only on
corroborated evidence of a serious recitation problem (CUT_START, CUT_END, AYAH_OVERLAP, AYAH_SEQUENCE, WRONG_AYAH,
MISSING_CONTENT, EXTRA_AYAH, WRONG_RECITER); `exception` for what cannot be assessed (blocked); weak or uncertain
evidence alone high / medium / check. Run boundary_check.py on the flagged files and their neighbours, then
`node tools/quran-audio/per-ayah/severity.mjs --risk <classify report> --boundary <boundary.json> --out <severity report>`
and give the severity report to make-review-packages.mjs. Rules, thresholds and results:
`docs/audio/per-ayah-severity-gebril-jaber-phase-4-8-10-2026-10-24.md`.

## In the dashboard

Each surah is a standard `ayah-timing-review-package` (`source: per-ayah`, provider `everyayah`). Its audio is a local
review copy: the surah's files joined in the app's order (MP3 frames; a PCM decode where formats differ). Each start
is where that ayah's file begins. HIGH risk ayahs are **Very High Risk** starts (ayah 1 included, for its file or its
Basmala file), so under policy auto-accept-v2 only they wait for a person; LOW risk ayahs are accepted automatically
(administrative, never a review). The dashboard shows a **Per-ayah recordings** card (scanned, low, high, reviewed,
unresolved) with **High-risk queue** and **All ayahs (troubleshooting)**.

Tests: `mobile/tests/audioPerAyah.test.ts` (app), `mobile/tests/audioPerAyahReview.test.ts` (dashboard, classifier,
catalogue; synthetic evidence).
