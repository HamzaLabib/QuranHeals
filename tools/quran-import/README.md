# Verified Tanzil SQLite foundation

Foundation generation is complete. The subsequent
[runtime migration](../../docs/quran-architecture/runtime-architecture.md) now uses this unchanged
database. The foundation implementation and validation record below describe
the original database-generation task.

The canonical Arabic source is the user-supplied Tanzil Quran Text, Uthmani
Version 1.1, at `tools/quran-verification/input/quran-uthmani.txt`. King Fahd
remains an independent verification/reference source; its original package,
comparison reports and unresolved differences are retained. No King Fahd data
is used in this build. The old `raw/README.md` records earlier package acquisition.

## Generated release assets

| Artifact | Purpose |
| --- | --- |
| `mobile/assets/quran/quran.sqlite` | Exact Arabic indexed by verse reference |
| `mobile/assets/quran/quran-manifest.json` | Source/database hashes, counts, schema and build provenance, exhaustive equality result |
| `mobile/assets/quran/TANZIL-NOTICE.txt` | Verbatim embedded source copyright/redistribution notice |

This location keeps the generated release assets inside the existing Expo
project, alongside its other assets, ready for a later bundled reader. Merely
placing a database here does **not** package or load it in the app: no mobile
SQLite dependency, Metro asset configuration or runtime retrieval was changed.
Build tooling and raw sources remain outside the mobile runtime.

Source SHA-256:
`6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f`

SQLite SHA-256:
`c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b`

The 1,720,320-byte database contains 6,236 verses across 114 surahs. Every
stored string and its UTF-8 bytes match the corresponding original source
payload: **6,236 exact matches, 0 mismatches**. There are no duplicate, missing,
invalid or empty verse records. SQLite `integrity_check` returns `ok`.

## Build and verify

Run from the repository root using **Node 24.15.0 with built-in SQLite 3.51.3**.
No npm installation or external service is needed for this generator.

```sh
node tools/quran-import/generate-sqlite.mjs --generate
node tools/quran-import/generate-sqlite.mjs --verify
node --test tools/quran-import/sqlite.test.mjs tools/quran-verification/verify.test.mjs tools/quran-verification/compare-kfgqpc.test.mjs tools/quran-verification/orthographic-analysis.test.mjs
```

Generation authenticates the exact file hash and validates all expected keys
before creating an output directory or database. It creates a fresh temporary
database, inserts in numeric `(surah, ayah)` order using bound parameters, closes
it, reopens it read-only, and compares **every** verse with its original string
and UTF-8 bytes. Only successful builds publish the database, manifest and
unchanged notice. Existing matching files are left in place; differing existing
artifacts cause a failure without overwriting them.

The parser removes only record delimiters (the first two pipes and the record
LF), never Quran payload content. No trimming, Unicode normalization, character
replacement, mark removal, whitespace adjustment or Arabic-form conversion is
performed. Opening basmala payloads, including the export's exceptional prefix
variants, remain exactly as supplied. This file is distinct from the earlier
historical download under `backend/data/quran`, which is not build input.

Binary reproducibility is tied to the recorded SQLite engine, schema and build
procedure. The generator refuses a different SQLite engine version until an
explicit toolchain review. Page size (4096), UTF-8 encoding, schema version,
application ID, schema and insertion order are fixed. No timestamp enters the
database or manifest. Two independent builds are compared byte-for-byte with
each other and the shipped database in the tests. The manifest also records the
actual Node version; using another Node version can change manifest provenance.
Verification can read an existing release without changing that provenance.

For a deliberate generator/schema/toolchain change, use the exported
`generateDatabase({ outputDirectory })` in a separate local review directory,
compare the complete result, and explicitly replace release artifacts only
after review. The CLI has no force-overwrite mode or alternative source option.

## Schema and immutability boundary

Schema version 1, defined in [schema.sql](schema.sql):

| Column | Definition |
| --- | --- |
| `surah` | `INTEGER NOT NULL`, range 1–114 |
| `ayah` | `INTEGER NOT NULL`, positive |
| `verse_key` | `TEXT NOT NULL`, exact `surah:ayah` reference |
| `arabic_text` | `TEXT NOT NULL`, exact original Arabic payload |

`verses` is a STRICT table with primary key `(surah, ayah)`, unique
`verse_key`, a nonempty text check and a reference consistency check. The
primary and unique indexes support both lookup forms. The exhaustive validator
also checks each reference against the full per-surah key set; the SQL checks
alone do not enforce each surah's maximum ayah number. There are no emotion,
translation, commentary, search-normalized or user-data columns.

The database is an immutable **release artifact**, not an inherently unwritable
file. The Node verification helper opens it with `readOnly: true` and
`query_only=ON`; tests prove writes fail even if `query_only` is disabled.
The future mobile reader must enforce equivalent read-only behavior and verify
the release manifest during asset initialization. User favorites and editorial
updates belong in separate stores and must never update `verses`.

## Integrity tests

`sqlite.test.mjs` verifies the pinned source, all keys/counts, all 6,236 original
payloads through an independent extraction path, SQL constraints, manifest and
notice integrity, exact schema/page size, deterministic/idempotent builds, refusal to overwrite a
different artifact, and read-only access. Negative tests use disposable copies
to prove missing verses/surahs, invalid keys with unchanged row counts, a single
added whitespace code point and a single removed code point are rejected. No
test changes either original source or the bundled database.

## Runtime migration

The running app still uses the existing backend and stored favorite snapshots.
MongoDB `Verse` and legacy `Ayah` currently duplicate Arabic. Their text is
compatibility data while runtime moves to the verified SQLite asset; MongoDB is
not the selected canonical owner. Emotion mappings and translations remain
separate. No database connection, data deletion or data migration was performed
for this foundation.

See [the coordinated migration checklist](../../docs/quran-architecture/sqlite-integration.md)
for API/ObjectId compatibility, favorite/history preservation, mapping
validation, native/web asset loading, local Arabic composition and offline
tests. Existing King Fahd reports remain historical analysis, including the
2,498 unresolved strict-base differences; no automated resolution is approved.

The notice is copied verbatim from the pinned source and identifies the
[Tanzil Project](https://tanzil.net). Keep it with derived release assets and
include visible Tanzil attribution/link when the mobile reader is integrated.
This Arabic dataset does not supply translation or font permissions.

## Validation record

| Check | Result |
| --- | --- |
| Original source SHA-256 before generation | Matches the pinned hash above |
| Original source structure | 114 surahs, 6,236 ayahs, no missing/duplicate/invalid keys |
| Generated SQLite verification | 6,236 exact matches, 0 mismatches; integrity check `ok` |
| Independent rebuilds | Identical database bytes and manifest; matching rebuild is idempotent |
| Existing Quran verification suites | 21 tests passed |
| New SQLite integrity suite | 17 tests passed |
| Backend `npm run typecheck` | Passed |
| Backend `npm test` | 34 tests passed across 5 files |
| Backend `npm run build` | Passed |
| Mobile `npm run typecheck` | Passed |
| Mobile `npm run lint` | Passed |
| `git diff --check` | Passed |
| Retired backend importer | Remains disabled; intentional exit 1 before corpus loading/database connection |

The SQLite foundation build introduced the generator, its tests and the
generated release assets (`generate-sqlite.mjs`, `tanzil-source.mjs`,
`sqlite.test.mjs`, `.gitattributes`, this README, `mobile/assets/quran/`), and
updated `tools/quran-import/schema.sql`, `tools/quran-verification/README.md`,
the root `README.md`, and the disabled-import message in
`backend/src/scripts/fullQuran.ts`.

Source Arabic, King Fahd artifacts, mappings, database records, runtime
retrieval and user storage are unchanged by this build.

Status: SQLite foundation complete; the runtime migration described above has
since landed — see [the runtime migration report](../../docs/quran-architecture/runtime-architecture.md).

## Verified English translation: translations.sqlite (Phase 6A.8)

A second, independent SQLite asset — `backend/assets/quran/translations.sqlite`
— holds the bundled English translation (Marmaduke Pickthall, extracted from
Project Gutenberg eBook #16955). It does not touch `quran.sqlite`, is not
mirrored to `mobile/assets/quran/` (mobile only ever displays whatever
translation text the backend API returns), and its raw source is a
different provenance than the Tanzil files above — see
`tools/quran-import/raw/gutenberg-16955/README.md` and
`backend/reports/quran-verification/gutenberg-pickthall-verification.md` for full
source/licensing detail, and
[the runtime architecture doc's translation section](../../docs/quran-architecture/runtime-architecture.md#verified-english-translation-phase-6a8)
for the complete picture.

SQLite SHA-256: `c6d825a2f9de0395a1391339477fce58e5850805b1df161b53dcb7816c898ce8`
(1,732,608 bytes, 6,236 rows, `integrity_check: ok`, 0 mismatches against the
approved source). Rebaselined in Phase 6A.8F to the Node 24.21.0 / SQLite
3.53.4 canonical build toolchain (see below); the translation content is
byte-for-byte identical to the prior `a786f58d...` build — same 6,236 rows,
same text, same corpus checksum — only the SQLite container's own bytes
changed.

```sh
node tools/quran-import/generate-translations-sqlite.mjs --prove-deterministic
node tools/quran-import/generate-translations-sqlite.mjs --publish
node --test tools/quran-import/translations-sqlite.test.mjs
```

The generator (`generate-translations-sqlite.mjs`) reads only the tracked,
hash-pinned `tools/quran-verification/pickthall-gutenberg-16955.json` — never
the raw Gutenberg text, never MongoDB — validates all 6,236 canonical
verseKeys, and refuses to silently overwrite an existing, differing
`translations.sqlite`. `--prove-deterministic` builds twice into independent
OS-temp paths and fails if the resulting bytes differ.

**Canonical build toolchain (Phase 6A.8F).** Unlike `quran.sqlite`'s
generator, `translations.sqlite`'s bytes turned out to depend on the
embedded SQLite version bundled with `node:sqlite`, not just on the schema
and source content — two builds with identical rows/text can still differ
byte-for-byte across SQLite engine versions. `generate-translations-sqlite.mjs`'s
`buildDatabase()` (the function underlying both `--prove-deterministic` and
`--publish`) therefore refuses to run unless the environment is exactly Node
`24.21.0` with embedded SQLite `3.53.4` — the toolchain independently
verified on both development machines to produce the same
`c6d825a2f9de0395a1391339477fce58e5850805b1df161b53dcb7816c898ce8`. The
repository root's `.nvmrc` pins the same Node version. **This gate applies
only to writing a new canonical database** — `verifyDatabase()` and
`openReadonlyDatabase()` (used to check an already-published
`translations.sqlite`, including at backend runtime) are deliberately
ungated and work on any Node version; the backend app itself has no pinned
Node version requirement.
