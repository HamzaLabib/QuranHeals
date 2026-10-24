# Whole-surah candidate sources (development preview)

For catalogue reciters with **no recording in the app** (first: Ahmed Mohamed Salama, `ahmed-salama`, Phase 4,
2026-10-23). One file per surah from candidate hosts, aligned automatically, reviewed through the risk dashboard, and
played only in **development builds** (`mobile/src/audio/timedPreview.ts`). Report: `docs/audio/ahmed-salama-2026-10-23.md`.

Ahmed Mohamed Salama (أحمد محمد سلامة) is **not** Yasser Mahmoud Salama (`yasser-salama`): see
`docs/audio/missing-surah-source-discovery-phase-4-6-2026-10-18.md` §3.1 (0 % audio match, ECAPA 0.32–0.50).

## Pipeline (run from `QuranHeals/`)

Audio is cached outside the repository and OneDrive: `%LOCALAPPDATA%/QuranHeals/surah-cache/<recording>/<source>/`.

| Step | Command | Output |
|---|---|---|
| 1. Fetch | `node tools/quran-audio/surah-sources/fetch.mjs --recording ahmed-salama --source assabile` (and `way2quran`) | `NNN.mp3`, `manifest.json` (HTTP answers, size, SHA-256; resumable, no redirect followed) |
| 2. Formats | `python -I -X utf8 tools/quran-audio/surah-sources/formats.py <cache>/<source> <cache>/<source>/formats.json` | CBR/VBR, bitrate, rate, channels, frame-exact length, tags, stream problems |
| 3. Compare | `python -I -X utf8 tools/quran-audio/surah-sources/compare.py <cache>/way2quran <cache>/assabile <cache>/compare-partN.json [surahs]`, and reversed into `compare-reverse.json` | per surah: same performance / partly / different (pieces located, lag spread) |
| 4. Select | `node tools/quran-audio/surah-sources/select.mjs --recording ahmed-salama --primary way2quran --reference assabile` | `<cache>/selected.json`: one file per surah and why |
| 5. Align | `node tools/quran-audio/alignment/run-batch.mjs <gpu python> <out> --source <cache>/selected.json [surahs]` | the Phase 4.1 alignment and checks (`flags.json`, `completeness.json`) |
| 6. Packages | `node tools/quran-audio/review/make-packages.mjs <packages> --aligned <out> --phase "ahmed-salama"` | standard review packages (recording = the selected file) |
| 7. App | `node tools/quran-audio/surah-sources/generate-timed-preview.mjs <packages>` | `mobile/src/audio/generated/timedPreview.ts` (development only) |

## Rules

- **Source choice**: the primary (better) copy only where it is the same performance as the complete reference
  (every piece found at a constant lag), not cut (within 1 % of the reference's length, or the reference found in it in
  full, both ways: padding only) and a clean CBR stream; otherwise the complete reference. One whole, unmodified file per
  surah: never a splice. A VBR choice is left out (no exact seeking).
- **Risk**: the dashboard's existing tiers and policy auto-accept-v2 (`../review/dashboard`): only Very High and
  exceptions need a person. Blocked packages (structure, completeness, text not confirmed) are exceptions.
- **Development catalogue**: a surah is enabled only with a valid, unblocked, CBR package and no Very High start.
- **Rights**: none of these sources grants use in an app (`sources.mjs`).

Tests: `mobile/tests/audioSurahSources.test.ts`, `mobile/tests/audioTimedPreview.test.ts` (synthetic data).
