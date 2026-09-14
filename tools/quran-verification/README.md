# Quran source verification

## Current source decision

**Tanzil Quran Text, Uthmani 1.1 is the canonical input for the immutable SQLite
foundation. King Fahd is an independent verification/reference source.**

The exact input is `input/quran-uthmani.txt` (relative to this directory), with
SHA-256 `6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f`.
It contains 114 surahs and 6,236 ayahs, without duplicate or missing keys. The
original user-supplied download remains unchanged. Its full embedded copyright
notice, [Tanzil attribution](https://tanzil.net), and
[license reference](https://tanzil.net/docs/text_license) remain source evidence;
translation and font terms are separate.

The generator produces `mobile/assets/quran/quran.sqlite` from only this pinned
input, preserving every Arabic string without trimming, normalization, character
substitution or other cleanup. Complete source-to-SQLite equality is required.
See [the build instructions](../quran-import/README.md) and
[the runtime migration checklist](../../docs/quran-data/sqlite-integration.md).
The subsequent [runtime integration](../../docs/quran-data/runtime-architecture.md)
resolves displayed/shared Arabic through this unchanged local SQLite asset.
Existing MongoDB data and emotion mappings remain intact.

This source decision supersedes the earlier King Fahd canonical proposal. Existing
reports and manifests under this verification directory are historical evidence
for their named stages, not the current SQLite build manifest. Do not overwrite
them to make the source roles appear to have been the same throughout the work.

## King Fahd comparison and orthographic review

The untouched user-supplied `UthmanicHafs_v2-0.zip` has been compared with Tanzil.
The [exact comparison report](output/kfgqpc-comparison-report.md) and
[machine-readable mismatches](output/kfgqpc-comparison.json) preserve the raw
differences. The subsequent [orthographic analysis](output/kfgqpc-orthographic-analysis.md)
and [machine-readable analysis](output/kfgqpc-orthographic-analysis.json) retain
2,498 cases requiring review after conservative comparison rules. No remaining
difference is automatically resolved, and the analysis does not approve a
canonical-source switch or establish a substantive Quranic error.

To repeat these comparison stages from the repository root:

```sh
node tools/quran-verification/compare-kfgqpc.mjs
node tools/quran-verification/orthographic-analysis.mjs
node --test tools/quran-verification/verify.test.mjs tools/quran-verification/compare-kfgqpc.test.mjs tools/quran-verification/orthographic-analysis.test.mjs
```

The archive is preserved under `tools/quran-import/raw/`; staged members must match it byte-for-byte under `tools/quran-import/staging/kfgqpc/`. Staging is ignored by Git. The comparison pins the ZIP, original Tanzil file and PDF evidence; each report includes the selected JSON hash. It deliberately avoids the earlier diagnostic-normalization comparator. No source cleanup is performed. None of these King Fahd inputs generates runtime Arabic or the new SQLite database.

To repeat the optional PDF evidence step, install `pdfjs-dist` under `tools/quran-import/staging/inspection/` only, then run `node tools/quran-verification/inspect-package-pdf.mjs`. This is a development inspection dependency, not an app dependency. The original PDF and Word documents remain unchanged. Unicode names come from the official Unicode 16.0.0 data URL and hash recorded in `reference/unicode-names.json`.

## Historical preparation artifacts

The initial [source-preparation report](output/report.md), `output/report.json`
and `quran-manifest.json` recorded the now-superseded plan to obtain King Fahd as
the primary source and retain Tanzil only for verification. Their blocked status
describes that stage. The later exact-comparison and orthographic reports record
the package that was subsequently supplied. `.gitattributes` continues to disable
line-ending conversion for the original Tanzil input.

`node tools/quran-verification/verify.mjs` is the historical initial-stage command:
it still emits that blocked workflow's reports and is not the current SQLite
generation or validation command. It should not be used to overwrite historical
reports during the SQLite foundation build. Its tests remain useful for the
shared source parser and comparison behavior.

Some historical diagnostic routines build transformed, temporary comparison
views. Those are analysis-only outputs, never canonical Arabic. The SQLite
generator must not use any diagnostic normalization, mark removal, base-letter
folding or basmala removal. This specific Tanzil export includes opening basmala
text in the first numbered row of many surahs (for example 112:1); preserve it
exactly as part of the input string.

The earlier `backend/data/quran` downloads and `backend/reports/phase3-*` belong
to the superseded MongoDB import attempt. They are historical development
artifacts, not the pinned SQLite input. The backend `import:quran` command remains
disabled. No King Fahd artifacts or outstanding review cases are deleted by the
new source decision.

## Surah metadata (Phase 6A.7)

`input/quran-data.xml` (SHA-256
`8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a`) is the
same Tanzil `quran-data.xml` already trusted as `surah-counts.json`'s own
pinned `sourceSha256` — the file was already present, downloaded and
manifested under the now-superseded `backend/data/quran/` Phase 3 MongoDB
attempt referenced above (see `backend/data/quran/source-manifest.json` for
its retrieval record), and is committed here, byte-identical, as a tracked
verified input so `surah-names.json`'s build no longer depends on a
gitignored, machine-local file. `tools/quran-import/generate-surah-names.mjs`
parses it (same `<sura .../>` regex as
`backend/src/import/fullQuran.ts::loadCorpus()`) into
`surah-names.json`: `nameArabic`/`nameEnglish`/`ayahCount`/`revelationType`
per surah, cross-validated against `surah-counts.json`. See
[the runtime architecture doc](../../docs/quran-data/runtime-architecture.md#verified-surah-metadata-phase-6a7)
for ownership and integration details. Reusing this file for surah names
does not resurrect the superseded MongoDB import path; nothing here writes
to MongoDB or produces Quran Arabic.
