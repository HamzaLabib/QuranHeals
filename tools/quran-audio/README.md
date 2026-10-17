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
| `audit/maher-qf-crosscheck.mjs`, `audit/pause_check.py` | Second audit: Maher Al-Muaiqly's MP3Quran timing against Quran Foundation's timing of the same performance, every boundary; each disagreement tested in the audio. Writes `audit-data/maher-qf-crosscheck-<date>.json` (verdicts only; Quran Foundation's data stays outside the repository). |
| `audit/features.py`, `audit/align_everyayah.py` | Measured timing: locates every per-ayah file of the same recording (EveryAyah) inside the MP3Quran surah file, whole and in order, in 3 s pieces. |
| `refine-results.mjs` | Applies the second audit to `audit-results.json` (withdraws surahs with an established wrong boundary, lists the rest for review) and writes `measured-timing.json` (accepting a surah only if every ayah was found whole). |
| `generate-catalog.mjs` | Writes the mobile catalogue and measured timing from `audit-results.json` and `measured-timing.json`. |
| `check-live.mjs` | Before a release: re-fetches every enabled surah's MP3Quran timing and every audio file's size and compares them with the audit. |
| `audit-data/` | The evidence kept from the 2026-10-17 runs (acoustic results, boundary sweep, Maher cross-check, MP3Quran catalogue snapshots, the canonical ayah counts). |

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
