# MP3Quran audio audit and catalogue

Produces `audit-results.json` and, from it, `mobile/src/audio/generated/reciterCatalog.ts`.
The results are summarised in [docs/audio/source-audit.md](../../docs/audio/source-audit.md).

| File | Purpose |
|---|---|
| `reciters.mjs` | The 16 reciters and the MP3Quran recording chosen for each (edit here to change a choice). |
| `fingerprint.mjs` | The timing fingerprint, identical to `mobile/src/audio/timingFingerprint.ts` (a test compares them). |
| `audit/match-reciters.mjs` | Lists the MP3Quran reciters, recordings and timing reads matching the 16 names (how the recordings in `reciters.mjs` were found): `node audit/match-reciters.mjs <work dir>`. |
| `audit/structural.mjs` | Fetches every chosen recording's file headers and all 114 timing files; checks completeness, order, overlaps and ends against the audio duration. Writes `audit.json` and `timing/` in a work directory. |
| `audit/acoustic.py`, `audit/offsets.py` | Whole-recording acoustic checks: is there a pause at the stated boundaries, and where is the nearest pause? |
| `audit/persurah.py`, `audit/dense.py` | Per-surah acoustic check (6 boundaries per surah), then up to 25 for any weak surah. |
| `compile-results.mjs` | Combines the above into `audit-results.json` (a surah is enabled only if every check passes). |
| `generate-catalog.mjs` | Writes the mobile catalogue from `audit-results.json`. |
| `check-live.mjs` | Before a release: re-fetches every enabled surah's timing and file size and compares them with the audit. |
| `audit-data/` | The evidence kept from the 2026-10-17 run (acoustic results, MP3Quran catalogue snapshots). |

## Re-running

```bash
# 1. Work directory with the MP3Quran catalogue and canonical ayah counts
W=/path/to/work; mkdir -p $W
curl -sL https://www.mp3quran.net/api/v3/reciters?language=ar -o $W/reciters_ar.json
curl -sL https://www.mp3quran.net/api/v3/ayat_timing/reads -o $W/timing_reads.json
#    ayah_counts.json: SURAH_AYAH_COUNTS from mobile/src/utils/ayahLink.ts as a JSON array

# 2. Structural audit (Node 24)
node audit/structural.mjs $W

# 3. Acoustic checks (Python 3.12; miniaudio installed into ./pylib next to audit/:
#    python -m pip install --target pylib miniaudio)
python -I -X utf8 audit/persurah.py $W $W/persurah.json 133,53,112,9,118,258,60,4,31,5 6
#    weak_pairs.json: the surahs below 80% from persurah.json, then
python -I -X utf8 audit/dense.py $W $W/dense.json 112,9,118,258,60,4,31,5 25

# 4. Results and catalogue
node compile-results.mjs $W
node generate-catalog.mjs

# Before any release
node check-live.mjs
```

`structural.mjs` reads `audit.json`'s target list from its own source; `persurah.py` and
`dense.py` take the moshaf ids. Network use: a few thousand small requests to
`www.mp3quran.net` and byte-range requests (about 100 KB each) to `cdn.mp3quran.net`.
