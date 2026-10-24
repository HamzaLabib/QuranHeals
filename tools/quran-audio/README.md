# Quran audio audit and catalogue

Produces `audit-results.json` and `measured-timing.json` and, from them, `mobile/src/audio/generated/reciterCatalog.ts`
and `mobile/src/audio/generated/measuredTiming.ts`. The results are summarised in
[docs/audio/source-audit.md](../../docs/audio/source-audit.md).

| File | Purpose |
|---|---|
| `reciters.mjs` | The 17 reciters and the MP3Quran recording chosen for each (or why one has none) (edit here to change a choice), and where timing is measured instead of taken from MP3Quran (`measure`). |
| `fingerprint.mjs` | The timing fingerprint, identical to `mobile/src/audio/timingFingerprint.ts` (a test compares them). |
| `audit/match-reciters.mjs` | Lists the MP3Quran reciters, recordings and timing reads matching the original 16 names (how the recordings in `reciters.mjs` were found): `node audit/match-reciters.mjs <work dir>`. |
| `audit/structural.mjs` | Fetches every chosen recording's file headers and all 114 timing files; checks completeness, order, overlaps and ends against the audio duration. Writes `audit.json` and `timing/` in a work directory. |
| `audit/acoustic.py`, `audit/offsets.py` | Whole-recording acoustic checks: is there a pause at the stated boundaries, and where is the nearest pause? |
| `audit/persurah.py`, `audit/dense.py` | Per-surah acoustic check (6 boundaries per surah), then up to 25 for any weak surah. |
| `compile-results.mjs` | Combines the above into `audit-results.json` (a surah is enabled only if every check passes). |
| `audit/boundary-sweep-prep.mjs`, `audit/boundary_sweep.py`, `audit/boundary-sweep-summary.mjs` | Second audit: the pause test on **every** boundary of every enabled surah (not a sample), classified as pause / displaced / unconfirmed. Writes `audit-data/boundary-sweep-<date>.json`. |
| `audit/maher-qf-crosscheck.mjs`, `audit/pause_check.py` | Second audit: Maher Al-Muaiqly's MP3Quran timing against Quran Foundation's timing of the same performance, every boundary; each disagreement tested in the audio. Writes `audit-data/maher-qf-crosscheck-<date>.json` (verdicts only; Quran Foundation's data stays outside the repository). **Correction 2026-10-18:** the 2026-10-17 run measured 11 files at the wrong place (it assumed every file's audio starts at byte 6900); four verdicts were inverted, and Maher 34 and 68 were withdrawn on that error alone (`audit-data/maher-qf-crosscheck-recheck-2026-10-18.json`; the tool now reads each file's first frame; production unchanged pending the owner). Quran Foundation's word timing is itself not ground truth: its word ends are pinned at 10-second marks in places, and a held initial nasal can be given to the previous ayah. |
| `audit/features.py`, `audit/align_everyayah.py` | Measured timing: locates every per-ayah file of the same recording (EveryAyah) inside the MP3Quran surah file, whole and in order, in 3 s pieces. |
| `refine-results.mjs` | Applies the second audit to `audit-results.json` (withdraws surahs with an established wrong boundary, lists the rest for review) and writes `measured-timing.json` (accepting a surah only if every ayah was found whole). |
| `generate-catalog.mjs` | Writes the mobile catalogue and measured timing from `audit-results.json` and `measured-timing.json`, and the source registry's data (`generated/sourceRegistry.ts`: providers, file formats, approved whole-surah sources). Refuses a VBR file with verified timing, an unpermitted provider, or an incomplete approval. |
| `check-live.mjs` | Before a release: re-fetches every enabled surah's MP3Quran timing and every audio file's size (redirects not followed: a redirect is a difference) and compares them with the audit; also checks the approved whole-surah sources. |
| `providers.mjs` | The audio providers and what each permits (streaming, offline), with the evidence. Way2Quran and Assabile: nothing. |
| `audit/extract-formats.mjs` | Keeps the first audit's per-file format evidence (bitrate, CBR / VBR, duration) as `audit-data/recording-formats-<date>.json`. |
| `surah-mode-approvals.json` | Whole-surah (surah-only) sources approved after a person's listening review. Empty: none approved yet. |
| `surah-mode/check-candidates.mjs` | Nominates whole-surah candidates (listed, untimed files) and flags suspect ones (duration against the reciter's pace, a file shared with another recording; `--live`: redirects and sizes). Never approves. Writes `audit-data/surah-mode-candidates-<date>.json`. |
| `alignment/` | Experimental forced alignment and boundary flagging; see [alignment/README.md](alignment/README.md). Never published automatically. `alignment/run-batch.mjs` runs it (both configurations, flags, completeness) for a list of reciters and surahs into an output folder kept outside the repository. |
| `review/` | The listening review (Phase 4.1). `make-packages.mjs` builds one package per surah (reciter and surah names, the canonical Arabic text of every ayah, proposed times, each boundary's automatic checks, the worklist) from aligned candidates and from development timing, plus `index.json` ordered by risk; `review.html` (open it in a browser, open the packages folder) plays any boundary's transition, moves it by 50/250 ms, to the playback position or to a typed time, records Correct / Needs correction / Unresolved per boundary, saves progress in the browser, approves a whole surah and exports the review. See docs/audio/alignment-phase-4-1-2026-10-18.md. |
| `audit/mp3frames.py`, `audit/seek_sim.py`, `audit/vbr_recover.py`, `audit/seek-probe/` | Phase 4.3 VBR seek recovery: frame-level MP3 inspection, media3 1.9.0 seek arithmetic, the lossless ID3 MLLT re-index (`mllt`) and the CBR re-encode (`cbr`), and a probe that runs the real media3 `Mp3Extractor` on the JVM. Tests: `audit/test_vbr_recover.py`. Results: `audit-data/vbr-recovery-2026-10-18.json`; docs/audio/vbr-recovery-phase-4-3-2026-10-18.md. Recovered copies are local only (rights). |
| `audit/hls_byterange.py`, `audit/seek-lab/` | Phase 4.4 cross-platform experiments: byte-range HLS playlists over an unmodified MP3 (not viable in expo-audio/media3 1.9.0), and the emulator seek lab that measures the decoded audio the app's player outputs after a seek. Results: `audit-data/vbr-cross-platform-2026-10-18.json`; docs/audio/vbr-cross-platform-phase-4-4-2026-10-18.md. |
| `audit/rifaat/` | Phase 4.5 Muhammad Rifaat investigation. It has fingerprint provenance against the archive.org collector's catalogue, and a teacher-forced Whisper content check calibrated on wrong-text controls. It also builds human-assisted timing worklists (pause candidates inside evidence brackets; no boundary placed). Results: `audit-data/rifaat-phase-4-5-2026-10-18/`; docs/audio/muhammad-rifaat-recovery-phase-4-5-2026-10-18.md. |
| `review/manual/` | Phase 4.6A manual ayah timing, for recordings no aligner can read (Muhammad Rifaat). A local server and page with waveform, playback, the Phase 4.5 evidence read-only, and markers placed by ear. Two blind, independent reviewers; disputes resolved by one proposing and the other accepting; an append-only, hash-chained log. Its export feeds `development/apply-review.mjs` (source `manual`), which refuses synthetic data, a single reviewer and recordings whose rights are not cleared. Launch and use: `review/manual/README.md`; docs/audio/rifaat-manual-timing-phase-4-6-2026-10-18.md. |
| `development/` | DEVELOPMENT-ONLY timing, loaded by development builds only (`__DEV__`) via `mobile/src/audio/generated/developmentTiming.ts`: `supplement-measured.mjs` (measured timing for reciters whose EveryAyah set is their MP3Quran recording, `supplements.mjs`; production rules and boundary sweep unchanged, plus the Husary-only `LONG_PAUSE` exception backed by `gap_voicing.py`), `revalidate.mjs` (Phase 4.1 per-boundary evidence: acoustic class, MP3Quran corroboration, listening priority → `audit-data/development-revalidation-<date>.json`) and `apply-review.mjs` (an approved listening review of a package: an aligned candidate becomes development timing; a development surah gets its listening evidence and any corrections). Writes `development/development-timing.json`; never `audit-results.json` or `measured-timing.json`. Promotion to production is an owner decision. |
| `audit-data/` | The evidence kept from the 2026-10-17 runs (acoustic results, boundary sweep, Maher cross-check, MP3Quran catalogue snapshots, the canonical ayah counts). |

## Listening review

Every pending listening review (aligned candidates, development-stage timing, manual Rifaat timing, and any later
review package) is in one local dashboard: `review/dashboard/README.md` (start: `Working progress/Screenshots and
Logs/audio-review-dashboard/start-dashboard.cmd`, then http://127.0.0.1:8765/).

## Re-running

```bash
# Python 3.12 with miniaudio and numpy installed into ./pylib (git-ignored):
#    python -m pip install --target pylib miniaudio numpy

# 1. First audit (MP3Quran timing). Work directory with the MP3Quran catalogue and canonical ayah counts:
W=/path/to/work; mkdir -p $W
curl -sL https://www.mp3quran.net/api/v3/reciters?language=ar -o $W/reciters_ar.json
curl -sL https://www.mp3quran.net/api/v3/ayat_timing/reads -o $W/timing_reads.json
cp audit-data/ayah-counts.json $W/ayah_counts.json        # = SURAH_AYAH_COUNTS (mobile/src/utils/ayahLink.ts)
node audit/structural.mjs $W
python -I -X utf8 audit/persurah.py $W $W/persurah.json 133,53,112,9,118,258,60,4,31,5 6
#    weak_pairs.json: the surahs below 80% from persurah.json, then
python -I -X utf8 audit/dense.py $W $W/dense.json 112,9,118,258,60,4,31,5 25
node compile-results.mjs $W

# 2. Second audit (always after step 1: compile-results.mjs rewrites audit-results.json).
#  a. Every boundary (about 3 GB of byte ranges from cdn.mp3quran.net; resumable):
node audit/boundary-sweep-prep.mjs $W/sweep
python -I -X utf8 audit/boundary_sweep.py $W/sweep/jobs.json $W/sweep/sweep.jsonl 16
node audit/boundary-sweep-summary.mjs $W/sweep/sweep.jsonl 2026-10-17
#  b. Maher cross-check (from backend/, which holds the Quran Foundation credentials; the work dir must be outside
#     the repository):
(cd ../../backend && node ../tools/quran-audio/audit/maher-qf-crosscheck.mjs $W/maher)
#  c. Measured timing, for each reciter with `measure` in reciters.mjs (about 1 GB each):
python -I -X utf8 audit/align_everyayah.py https://cdn.mp3quran.net/audio/ali-hudhaifi/r1/ \
  https://everyayah.com/data/Hudhaify_128kbps/ audit-data/ayah-counts.json $W/align/hudhaifi $W/align-work
node refine-results.mjs $W/align 2026-10-17

# 3. Catalogue
node generate-catalog.mjs

# Before any release
node check-live.mjs
```

`structural.mjs` reads `audit.json`'s target list from its own source; `persurah.py` and `dense.py` take the moshaf
ids. Network use: the first audit makes a few thousand small requests to `www.mp3quran.net` and byte-range requests
(about 100 KB each) to `cdn.mp3quran.net`; the second audit's sizes are given above.

## Measured timing

Used where MP3Quran's own timing for a recording is missing or unusable, but another site has per-ayah files **cut
from the same recording**. Each per-ayah file is located inside the MP3Quran surah file, so the timing is measured for
the file the app streams; the per-ayah files are only a reference and are never played. A surah is accepted only if,
for every ayah, every 3 s piece of the per-ayah file is found in order in the MP3Quran file (score ≥ 0.7; two encodings
of one recording score about 0.8–1, other audio below about 0.6), the two files never differ inside an ayah by more
than 0.5 s except where the per-ayah file has a pause at least that long, and no ayah overlaps the next. Each boundary
is the per-ayah file's own cut point, kept inside the measured pause between the two ayahs.

The measured timing is shipped in the app (`generated/measuredTiming.ts`, a few tens of KB) and checked against the
catalogue's fingerprint like MP3Quran's. It is only valid for the exact audio file it was measured on: `check-live.mjs`
checks that file's size, and a change means re-measuring.
