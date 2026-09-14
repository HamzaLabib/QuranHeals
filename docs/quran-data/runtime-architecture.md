# Quran Arabic runtime architecture

Status: the mobile Arabic-rendering migration described below is complete,
and the backend MongoDB cleanup of the now-redundant Arabic fields (Phase 4C)
has also been executed — see "MongoDB cleanup (Phase 4C)" at the end of this
document for the removed fields, backup location, and rollback procedure.
MongoDB is now reference-only for Quran Arabic on both backend and mobile:
neither `Verse`/`Ayah` documents nor any active writer stores or reintroduces
Arabic text. This document mixes two things: the **current** runtime
architecture (how Arabic is actually served today) and a **historical**
record of the migration that produced it (the flow it replaced, and the
validation results at completion time).

## Previous and current flow

The [compatibility map](runtime-compatibility.md) was recorded before
runtime edits. Previously, MongoDB `Verse` or legacy `Ayah` supplied Arabic in
the API DTO, and saved favorites rendered their stored Arabic snapshots.

The current flow is:

```text
MongoDB emotion mapping + translation + reference + compatible ObjectId
    -> mobile verseKey validation
    -> bundled quran.sqlite lookup
    -> exact SQLite Arabic + existing translation/editorial metadata
    -> ayah card, favorites card and sharing
```

Both backend composers add `verseKey` using their numeric surah/ayah fields.
All previous fields, ObjectIds, routes, query parameters, status filters,
editorial assignments and random-selection behavior remain. Backend Arabic is
still transmitted for old-client compatibility, but the migrated mobile client
replaces it before returning an ayah to UI code. MongoDB is no longer the Arabic
authority for this mobile runtime. No MongoDB fields, seeds or records were
deleted or rewritten.

## Local repository and assets

`mobile/src/services/quranRepository.ts` exposes typed `getVerseByKey()` and
`getVerse(surah, ayah)` lookups. The connection is private, uses bound parameters,
enables `PRAGMA query_only`, and checks 6,236 rows, 114 surahs, unique keys,
schema version and application identity once per successful initialization.
Every requested key must return exactly one row with consistent numeric fields.
Neither lookup nor composition transforms Arabic. Initialization is shared;
failed opening attempts can be retried. Failures never fall back to MongoDB
Arabic, stored snapshots, King Fahd or another Quran API.

Native uses [Expo SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/),
Expo Asset and FileSystem versions matching the installed Expo SDK 57. Static
Metro requires include the original database and notice. The native adapter
reads the local asset bytes into a private in-memory SQLite connection; it does
not open the bundled file for mutation. The downloaded asset cache is separate
from user storage. Expo Go development may retrieve assets from Metro; release
builds include them in the app. The standard Expo asset config plugin rejects
`.sqlite` and `.txt`, so packaging uses Metro `assetExts` instead.

Web loads the same shipped asset from the app's own origin, caches it by release
SHA-256, and verifies its hash before deserialization. This is a bundled app
asset request, not a Quran API call. The 1.7 MB hash runs once when the reader is
first needed, not per verse/render. The app does not become a fully offline PWA;
an already loaded app can read favorites without its API, and cached asset bytes
can be reused on later loads. Backend emotion selection still needs connectivity.

Expo SQLite web needs `SharedArrayBuffer`. Metro supplies COOP `same-origin`
and COEP `credentialless`; Expo Router hosting headers are configured too.
Other static hosts must serve equivalent headers and the exported worker/WASM
and database assets. No hosting or deployment has been set up yet.

`verseKey` is now the stable Quran identifier. ObjectIds remain transport,
lookup/exclusion and legacy-storage compatibility IDs. `referenceKey` remains
an accepted alias. Missing keys can be derived from reliable integer numeric
fields. Conflicting references, incomplete numeric pairs and ID-only favorites
fail explicitly; neither Arabic matching nor guessing is used.

## Favorites and history

Reading favorites never writes storage. Old full snapshots retain original
IDs, `savedAt`, metadata and stored bytes. Display/share objects resolve Arabic
and provenance lazily from SQLite. Numeric-only old snapshots work. Malformed
or unresolvable records remain stored; the screen shows an unresolved count and
retry action without displaying cached Arabic. Corrupt root JSON is retained
and cannot be overwritten by a save operation.

New favorites include `verseKey` while retaining compatible full metadata and
ObjectIds. Matching/toggling uses the stable reference, with ID compatibility.
Serialized mutations operate on original records and preserve unrelated or
unresolved entries. Existing favorites are not automatically converted.

Existing `quran-heals:recent-ayahs` ObjectId arrays remain the API's exclusions,
including the previous four-entry rolling limit. New stable keys are recorded
in `quran-heals:recent-verse-keys:v1`. Old IDs are not guessed into verse keys.
Invalid entries remain stored and generate an explicit warning; unreadable
history is not reset. A history read/write failure does not prevent an otherwise
valid local ayah from rendering. Storage operations are serialized.

The new client remains reversible: old fields, storage keys, IDs, snapshots and
backend Arabic remain available. Rollback restores the prior client without a
MongoDB restore; the additive stable-key history can remain unused.

## Validation and known limits

The [read-only live audit](../../backend/reports/quran-data/runtime/live-audit.json) found 43/43 mappings,
16/16 Verse records, and 16/16 legacy Ayah records resolve exactly once.
All 12 active emotions and all development mapping assignments remain intact,
with zero unresolved or inconsistent backend references. The same 43
seeded mappings and 16 unique references pass automated SQLite checks.

The [browser report](../../backend/reports/quran-data/runtime/browser-validation.json) verifies all 12 emotion
routes against exact SQLite Arabic, a numeric-only old favorite, unchanged raw
favorite storage, explicit unresolved-record handling, exact shared Arabic,
offline use of the initialized reader, new stable-key favorites, compatible
recent IDs/keys and another-ayah behavior. The browser session used isolated
test data; favorites/history on real user devices were not accessible and
are not covered here.

| Check | Result |
| --- | --- |
| Quran verification and SQLite integrity tests | 38 passed |
| Backend tests | 39 passed, 6 files |
| Mobile runtime/storage/API/asset tests | 16 passed, 4 files |
| Exhaustive runtime lookup equality | All 6,236 strings equal SQLite |
| Backend typecheck/build | Passed |
| Mobile typecheck/lint | Passed |
| Browser | All 12 emotions and compatibility flows passed; no page errors |
| Native/web exports | Android, iOS and static web bundle successfully |
| Exported assets | Database and notice match original bytes on Android, iOS and web |
| `git diff --check` | Passed |

The [export report](../../backend/reports/quran-data/runtime/export-validation.json) verifies the actual bundled
database and notice bytes on all three targets, and native JavaScript/Hermes
bundling. A real Android/iOS device or simulator smoke test — including first
offline opening of the packaged asset — is still a release-checklist item; a
successful bundle is not the same as verified native runtime behavior.

The canonical files remain unchanged:

- Source: `tools/quran-verification/input/quran-uthmani.txt`, SHA-256
  `6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f`.
- Database: `mobile/assets/quran/quran.sqlite`, SHA-256
  `c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b`.

King Fahd archives, reports and unresolved comparison cases remain independent
verification evidence. No Quran Arabic was modified to satisfy a test.

The mobile access layer lives in `src/services/` (`quranReference.ts`,
`quranRepository.ts`, `quran.ts`, `quranAssets.ts`, `quranAsset.ts`,
`quranAsset.web.ts`), with supporting changes across `api.ts`,
`types/domain.ts`, `storage/favorites.ts`, `storage/recentAyahs.ts`,
`hooks/useFavorites.ts`, `app/ayah/[emotion].tsx`, `app/favorites.tsx`, and
`components/AyahCard.tsx`. Tests live under `mobile/tests/`. On the backend,
see `src/types/dto.ts`, `src/services/MongooseQuranRepository.ts`, and
`src/scripts/auditSqliteReferences.ts` / `previewReadonly.ts` for the
read-only reference audit and preview tooling.

## Repeating the checks

From `mobile`, run `npm test`, `npm run typecheck`, `npm run lint`,
`npm run verify:quran`, and `npx expo export --platform all` as needed.
From `backend`, use the existing tests/typecheck/build scripts. The read-only
reference audit runs with
`node node_modules/tsx/dist/cli.mjs src/scripts/auditSqliteReferences.ts`.
The preview server runs the adjacent `previewReadonly.ts` script, uses the
existing development environment, binds localhost, and disables index creation.
Browser checks take an installed browser-driver executable as their argument;
they expect a local Expo preview on 8083 with public API URL 127.0.0.1:4000.

## MongoDB cleanup (Phase 4C)

Editorial reference validation (`EmotionVerseMapping.verseReferenceKey`, and
the `mapping:upsert` CLI) no longer depends on `VerseModel.exists`; both
validate against the local 6,236-key reference set in
`backend/src/quran/referenceKeys.ts`. `MongooseQuranRepository`'s
Arabic-serving path (`composeFoundationAyah`, `toAyahDto`) reads Arabic from
`quran.sqlite` via `getVerifiedArabicForRecord`/`getVerifiedArabicByVerseKey`
(`backend/src/quran/quranSource.ts`), never from a Mongo document's own field.

With that read path confirmed, `backend/src/scripts/prepareArabicCleanup.ts`
was run destructively against the configured development database (Atlas
database name `test`) and removed `Verse.arabicText`, `Verse.checksum`, and
`Ayah.arabicText` from every document — 16 `verses` and 16 legacy `ayahs`.
Nothing else changed: record counts, `_id`s, `referenceKey`s,
`VerseTranslation` (16), `EmotionVerseMapping` (43), and `Emotion` (12) are
byte-identical to before (the 1,845-mapping/29-emotion Phase 5C preview
remains unactivated). See `backend/reports/data-cleanup/cleanup-dry-run.json`
for the machine-readable before/after report.

A verified pre-mutation backup was written to the git-ignored
`backend/backups/data-cleanup/mongodb-arabic-before-cleanup-<timestamp>.json`
(SHA-256 `33ca9e11eeb12c2e77c7959bcf7f99fbed4514188b85d5185f9929582525979c`,
32,945 bytes) before the mutation ran, verified by read-back, shape, and
ObjectId round-trip (`backend/src/utils/objectId.ts`) before the `$unset`
transaction was allowed to proceed. To roll back: restore `arabicText`
(and, for `verses`, `checksum`) from that backup via `bulkWrite`, matching
each record by its original `_id` — never by `referenceKey` or position, and
never inventing text. `backend/src/seed/seed.ts` and
`backend/src/seed/migrateFoundation.ts` (the two active writers that
previously wrote these fields via `$set` of a whole seed/foundation object)
now route through `stripAyahArabicText`/`stripVerseArabicFields` and can no
longer reintroduce them; re-running either is a safe no-op for Arabic, not a
rollback path. Regression coverage lives in
`backend/tests/quran-data/no-arabic-reintroduction.test.ts`.

Persistent favorites could optionally be versioned down to references after a
compatibility review. Translations, source metadata and legacy ID support
should stay until their remaining consumers are audited.
