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

The [read-only live audit](../../backend/reports/quran-verification/runtime/live-audit.json) found 43/43 mappings,
16/16 Verse records, and 16/16 legacy Ayah records resolve exactly once.
All 12 active emotions and all development mapping assignments remain intact,
with zero unresolved or inconsistent backend references. The same 43
seeded mappings and 16 unique references pass automated SQLite checks.

The [browser report](../../backend/reports/quran-verification/runtime/browser-validation.json) verifies all 12 emotion
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

The [export report](../../backend/reports/quran-verification/runtime/export-validation.json) verifies the actual bundled
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
remains unactivated). See `backend/reports/cleanup/cleanup-dry-run.json`
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

## Reference-first Quran identity (Phase 6A.6)

Status: **complete**. The requirement that a Mongo `Verse` document must exist
before an ayah can be resolved — the design the abandoned "expand Mongo Verse
coverage from 16 to 205 before Phase 6B activation" plan depended on — has
been removed. This section documents that change; the flow described in
"Previous and current flow" above (and the ObjectId-as-transport-ID
compatibility layer it describes) is now historical, superseded by what
follows.

**What changed.** `MongooseQuranRepository.composeFoundationAyah` (backend)
resolves Arabic straight from `verseKey` via `getVerifiedArabicByVerseKey` —
no Mongo `Verse` document is queried for identity or Arabic. A `Verse`
document is now optional *enrichment* only, supplying `surahNameArabic`,
`surahNameEnglish` and a historical `quranTextSource` when one happens to
exist; its absence never blocks resolution. `VerseTranslation` remains
required (translation availability is a separate, legitimate concern from
Arabic availability — an ayah with no approved translation is still not
served, matching existing UX; no `translationAvailable`/nullable-translation
contract was introduced, since no current data exercises that gap and the
mobile UI has no null-translation rendering path yet — tracked as a
follow-up, not implemented here).

**Public identity.** `AyahDto.id` is now the stable `verseKey`
("`surah:ayah`"), never a Mongo ObjectId — for both the foundation
(`EmotionVerseMapping`) path and the legacy `Ayah` collection path. `GET
/api/ayahs/:id` and the `random?...&exclude=` list now take/return verseKeys;
`backend/src/validators/ayahValidators.ts` validates them against the same
6,236-key canonical set (`isValidVerseKey`) instead of Mongo's ObjectId
shape. This is an intentional, non-backward-compatible identity change,
authorized because the project has no production users yet (see
`backend/src/seed/migrateFoundation.ts` / Phase 4C, which already established
`EmotionVerseMapping.verseReferenceKey` as a string identity with no Verse
ObjectId dependency — this phase extends the same principle to the
API-facing identity).

**Mobile.** `mobile/src/app/ayah/[emotion].tsx` now excludes recent ayahs by
verseKey (`storage/recentAyahs.getRecentVerseKeyState`) instead of the legacy
Mongo-ObjectId `recentKey` store. `rememberAyahForEmotion` still writes to
both stores for backward-compatible history, but no longer throws when
`ayah.id` isn't ObjectId-shaped — it simply stops growing the legacy store
once ids are verseKeys.

**Known gap.** No canonical, verified 114-surah-name reference asset exists
yet (unlike `surah-counts.json`, which is hash-pinned against
`https://tanzil.net/res/text/metadata/quran-data.xml`). When an ayah resolves
with no Mongo `Verse` enrichment, `surahNameEnglish` falls back to the
honest, derived placeholder `` `Surah ${surahNumber}` `` and
`surahNameArabic` falls back to `''` — never an invented name. This does not
affect any ayah in the current 43-mapping/16-verse dev dataset (all of which
have a real Mongo `Verse` document today); it only matters once verseKeys
outside that set are served (e.g. after a future Phase 6B activation of the
205-verseKey Phase 6A candidate set, which this phase does **not** perform).
Building a verified surah-name asset the same way `surah-counts.json` was
built is the natural next step before that happens.

**Validation.** See
`backend/tests/quran-data/mongo-arabic-independence.test.ts` ("Foundation
path resolves without a Mongo Verse document") and
`backend/tests/emotion-mappings/activation-dry-run.test.ts` ("Activation dry
run: Mongo Verse independence") for the automated proof that all 205
Phase 6A candidate verseKeys resolve directly against `quran.sqlite` with no
Mongo Verse document required.

## Verified surah metadata (Phase 6A.7)

Status: **complete**. Closes the "known gap" noted above — surah names no
longer fall back to a placeholder for verseKeys with no Mongo `Verse`
enrichment.

**Ownership, made explicit:**

| Asset | Owns |
| --- | --- |
| `{backend,mobile}/assets/quran/quran.sqlite` | canonical Quran Arabic (unchanged by this phase) |
| `{backend,mobile}/assets/quran/surah-counts.json` | canonical per-surah ayah counts (unchanged) |
| `{backend,mobile}/assets/quran/surah-names.json` | canonical per-surah Arabic/English names, ayah count, revelation type (**new**) |
| future `translations.sqlite` | translation content (not started — separate phase) |
| MongoDB | dynamic application relationships/data only; never a second canonical Quran source |
| `verseKey` ("surah:ayah") | canonical cross-system Quran identity, used to look up all of the above |

**Source and provenance.** `surah-names.json` is built by
`tools/quran-import/generate-surah-names.mjs` from
`tools/quran-verification/input/quran-data.xml` — the same Tanzil
`quran-data.xml` (`https://tanzil.net/res/text/metadata/quran-data.xml`,
SHA-256 `8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a`)
already trusted as `surah-counts.json`'s own `sourceSha256` — reused for a
second, independent purpose, not re-fetched or re-sourced. `nameArabic` comes
from the XML's `<sura name="...">` attribute, `nameEnglish` from `tname`
(transliteration, matching the style already displayed by the app — not
`ename`, which is the English *meaning*, e.g. "The Cow" rather than
"Al-Baqara"), and `revelationType` from `type`. Ayah counts were
cross-validated 114/114 against `surah-counts.json` at generation time (see
the script's `crossValidateAgainstCounts`); a disagreement would have failed
the build rather than been silently reconciled — none occurred.
`tools/quran-verification/surah-names.json` (114 records, SHA-256
`fc1d96a56427af6449004331602ccec6be4432d4ef4e0068e976ba34b74c412c`) is the
canonical copy; `tools/quran-import/sync-backend-quran-asset.mjs` copies it
byte-for-byte, hash-verified, to `backend/assets/quran/surah-names.json`
(same pattern as `surah-counts.json`).

**Runtime integration.** `backend/src/quran/surahMetadata.ts` loads and
hash-pins the asset once (mirrors `referenceKeys.ts`), exposing
`getSurahMetadata(surahNumber)`. `MongooseQuranRepository`'s
`toFoundationAyahDto` and `toAyahDto` both now source `surahNameArabic`/
`surahNameEnglish` from this module unconditionally — a Mongo `Verse` or
legacy `Ayah` document's own surah-name fields, if present, are read for
no other purpose and never override it (see "Mongo Verse/Ayah surah names
are never authoritative" in `mongo-arabic-independence.test.ts`). The
`Surah ${n}` / `''` placeholder fallback described above no longer exists
for any of the 6,236 canonical verseKeys.

**Mobile.** Unaffected — mobile has no independent surah-name source; it
only displays whatever `surahNameArabic`/`surahNameEnglish` the API response
carries (`mobile/src/services/quranRepository.ts`'s `composeLocalAyah` never
touches those fields), so it transparently receives verified names now. No
mobile code or asset changes were needed. A true offline-first surah-name
lookup (bundling `surah-names.json` into the mobile app, mirroring
`quran.sqlite`) remains a possible future step if full-offline mode is
prioritized, but nothing in the app currently needs it.

**Validation.** `backend/tests/quran-data/surah-metadata.test.ts` proves:
114 records with unique surah numbers 1–114, no missing Arabic/English name,
exact ayah-count agreement with `surah-counts.json` (total 6,236), asset
integrity pinning, deterministic/frozen loading, correct resolution for
spot-checked verseKeys, all 6,236 canonical verseKeys resolving valid
surah/ayah-consistent metadata, and all 205 Phase 6A candidate verseKeys
resolving non-empty names with zero Mongo Verse coverage required.

## Verified English translation (Phase 6A.8)

Status: **complete**. Closes the actual blocker behind the "known gap"
above: 189 of the 205 Phase 6A candidate verseKeys had no Mongo
`VerseTranslation` document, and `composeFoundationAyah` used to `return
null` whenever one was missing — the real reason those ayahs could never be
served, independent of the surah-name placeholder issue Phase 6A.7 fixed.

**Ownership, made explicit (supersedes the Phase 6A.7 table for translation):**

| Asset | Owns |
| --- | --- |
| `{backend,mobile}/assets/quran/quran.sqlite` | canonical Quran Arabic (unchanged) |
| `{backend,mobile}/assets/quran/surah-counts.json` | canonical per-surah ayah counts (unchanged) |
| `{backend,mobile}/assets/quran/surah-names.json` | canonical per-surah Arabic/English names (unchanged) |
| `backend/assets/quran/translations.sqlite` | canonical English translation text (**new**) |
| MongoDB (`Verse`, `Ayah`, `VerseTranslation`) | dynamic application/review data only; **retained but non-authoritative** for translation text, same as it already was for Arabic and surah names |

**Source and provenance (Phase 6A.8A).** The bundled translation is
Marmaduke Pickthall's *The Meaning of the Glorious Koran*, extracted from
Project Gutenberg eBook #16955 ("Three Translations of The Koran (Al-Qur'an)
side by side" — Yusuf Ali / Pickthall / Shakir; only Pickthall is extracted
or redistributed). Chosen over the earlier, never-completed Tanzil
`en.pickthall` export specifically because Tanzil's translation-download
terms are non-commercial-only, while Gutenberg's ebook carries no such
restriction (Gutenberg catalog: "Public domain in the USA"; full license
§1.D: "The Foundation makes no representations concerning the copyright
status of any work in any country outside the United States" — a residual,
documented, non-blocking territorial caveat, not a stated prohibition).
Raw download: `tools/quran-import/raw/gutenberg-16955/16955.txt`
(gitignored, 2,833,442 bytes, SHA-256
`8ea8efcdf76a20ac1a6a3948c292f44fc7acda597ed7cbc50ac2dc4c254be7a8`) — see
`tools/quran-import/raw/gutenberg-16955/README.md`. Extracted via
`tools/quran-import/extract-gutenberg-pickthall.mjs` into the tracked,
hash-pinned `tools/quran-verification/pickthall-gutenberg-16955.json`
(SHA-256 `f22e7ef2958bab19b36e5c604f927da8241148e73ec9763100bc9ffc27c8a4b4`),
114/114 surahs and 6,236/6,236 canonical verseKeys, 0 missing/extra/
duplicate/empty. The raw file's own transcription had 4 corrupted verse-
number labels (17:33, 39:46, 45:32, 56:26 — content intact, only the digit
label was wrong); the extractor reconstructs each from strict per-surah
sequence position and records every correction — see
`backend/reports/quran-verification/gutenberg-pickthall-verification.md`. A
read-only comparison against the 16 pre-existing Mongo dev rows found 11
exact matches, 4 punctuation/capitalization-only differences, and one
genuine wording difference at 39:53 ("Say: My slaves..." in the old Mongo
row vs "Say: O My slaves..." in the approved Gutenberg edition) — the
Gutenberg wording now wins at runtime; the older Mongo rows were left
untouched.

**translations.sqlite (Phase 6A.8B).** Built deterministically by
`tools/quran-import/generate-translations-sqlite.mjs` from the tracked JSON
above (never from the raw Gutenberg text, never from MongoDB). Schema
(`tools/quran-import/translations-schema.sql`): a `translation_sources`
table holding source-level provenance once (translator, title, source name,
raw/corpus hashes, license note), and a `translations` table keyed by
`(surah, ayah, translation_id)` with a `verse_key` `CHECK`-derived column —
deliberately mirroring `quran.sqlite`'s own `verses` table shape rather than
the simpler `(verse_key, translation_id)` primary key, so the two Quran
SQLite assets stay structurally consistent, and `translation_id` is a
foreign key so a future second translation needs only new rows, never a
schema change. Fixed PRAGMAs, sorted insertion order and a distinct
`application_id` (`0x51485452`, `'QHTR'`, vs `quran.sqlite`'s `'QHRN'`) mirror
`generate-sqlite.mjs`'s reproducibility conventions. Determinism is proven
by building twice into independent OS-temp paths and comparing SHA-256
(`node tools/quran-import/generate-translations-sqlite.mjs
--prove-deterministic`) — both builds hashed to
`a786f58dbdd8181abb1ba075605dbf86a958d993b68e814b05929a534509a8c3`
(1,732,608 bytes) under this phase's Node 24.15.0/SQLite 3.51.3 toolchain,
which was the published `backend/assets/quran/translations.sqlite`'s hash
until Phase 6A.8F rebaselined the container bytes to a newer, cross-machine
verified toolchain (see "Canonical translation-build toolchain rebaseline"
below for the current hash and why it changed; the translation content
itself did not). `tools/quran-import/translations-sqlite.test.mjs`
(run via `node --test`) proves the source hash pin, full structural/content
verification (6,236 exact matches, 0 mismatches, `integrity_check: ok`), a
corpus-checksum match between the JSON source and the built database (same
sort-concatenate-SHA256 method as `tanzil-source.mjs`'s corpus checksum),
byte-identical repeat builds, and that the read-only handle refuses writes.

**Runtime integration.** `backend/src/quran/translationSource.ts` loads and
hash-pins `translations.sqlite` once (mirrors `quranSource.ts`), exposing
`getVerifiedTranslationByVerseKey(verseKey)` — throws on a missing/invalid
key, never falls back to an empty string or to Mongo.
`MongooseQuranRepository`'s `composeFoundationAyah` no longer queries
`VerseTranslationModel` at all (the `if (!translation) return null` guard
that previously blocked 189/205 candidate ayahs is gone); both
`toFoundationAyahDto` and the legacy `toAyahDto` now source
`englishTranslation`/`translationSource` from `translationSource.ts`
unconditionally — a Mongo `VerseTranslation` document or a legacy `Ayah`
document's own inline translation fields, if present, are retained in
MongoDB but never read for this purpose (see "Foundation/Legacy path never
reads Mongo VerseTranslation/inline translation text" in
`mongo-translation-independence.test.ts`, including a dedicated 39:53 test
proving the Gutenberg wording wins over the differing pre-existing Mongo
row). `backend/tests/quran-data/full-canonical-translation-coverage.test.ts`
proves all 6,236 canonical verseKeys and all 205 Phase 6A candidate
verseKeys resolve Arabic + translation + surah metadata with zero Mongo
coverage required — the direct structural fix for the 16-vs-205 gap.

**Mobile.** Unaffected — mobile has no independent translation source; it
only displays whatever `englishTranslation`/`translationSource` the API
response carries, so it transparently receives the verified text now. No
mobile code or asset changes were made or needed; a bundled mobile
`translations.sqlite` (mirroring `quran.sqlite`) remains a possible future
step for full-offline mode, not needed today.

**MongoDB (as of Phase 6A.8B).** `Verse`, `Ayah`, and `VerseTranslation`
translation-related fields were **retained, unmodified, and
non-authoritative** — exactly the same status Phase 4C/6A.7 already gave
Arabic text and surah names. Zero Mongo writes were performed by that phase.

## Controlled retirement of legacy Mongo translation storage (Phase 6A.8C)

Status: **complete**. With runtime independence proven by 6A.8B's tests,
the now-fully-obsolete Mongo translation storage was safely retired,
mirroring the Phase 4C Arabic-field cleanup's backup → dry-run → transaction
→ verify pattern exactly (`backend/src/scripts/prepareArabicCleanup.ts` was
the direct template for `prepareTranslationCleanup.ts`).

**What changed:**

- **`VerseTranslation` collection: 16 → 0.** All 16 documents deleted by
  exact `_id` (never `deleteMany({})`) inside a MongoDB transaction, with an
  in-transaction post-delete count re-check before commit.
- **Legacy `Ayah.englishTranslation`/`translationSource`: removed from all
  16 documents that had them**, via `$unset` on the exact backed-up `_id`
  set — no `Ayah` document was deleted, only these two fields on the exact
  targeted documents. `Ayah` document count: 16 → 16 (unchanged).
- **Schema safety fix (prerequisite, applied before any data mutation):**
  `Ayah.englishTranslation`/`translationSource` were `required: true` in
  `backend/src/models/Ayah.ts`, unlike `arabicText`'s sibling field (already
  `required: false` since Phase 4C). Unsetting a required field would leave
  documents that fail validation on any future `runValidators`/`.save()`
  write. Fixed by relaxing both to `required: false`, mirroring
  `arabicText`'s exact existing treatment — no other schema or type change
  (the `AyahEntity` TypeScript type deliberately stays `string`
  non-optional, matching `arabicText`'s own precedent: these are
  aspirational/documentation types for a `.lean()` cast, not runtime-checked
  against the live schema).
- **`Verse`, `Emotion`, `EmotionVerseMapping`: untouched.** No translation
  fields existed on `Verse`; `Emotion` (12) and `EmotionVerseMapping` (43)
  counts are identical before and after — the 29-emotion/1,845-mapping
  dataset was **not** activated by this phase.

**Backup, verification and rollback:**

- Pre-mutation backup (git-ignored, `backend/backups/translation-cleanup/`)
  contains every deleted `VerseTranslation` document and every targeted
  `Ayah` document's pre-unset field values, wrapped in the same
  ObjectId-round-trip-verified envelope format as the Phase 4C backup
  (`backend/src/utils/objectId.ts`). Verified by read-back + parse + exact
  `_id` round-trip before the transaction was allowed to proceed
  (`backend/src/utils/backupFile.ts`).
- Dry-run report: `backend/reports/cleanup/translation-cleanup-dry-run.json`
  (tracked, not git-ignored — a report, not a backup).
- Rollback: `backend/src/scripts/rollbackTranslationCleanup.ts --backup
  <path> --apply` (defaults to dry-run; refuses if any backed-up
  `VerseTranslation` `_id` already exists live, or if any backed-up `Ayah`
  `_id` no longer exists live). **Re-running `seed.ts`/`migrateFoundation.ts`
  is NOT a rollback path** — `seed/ayahs.ts` still contains the literal
  pre-Gutenberg `englishTranslation`/`translationSource` wording and is not
  stripped the way `stripAyahArabicText` already strips `arabicText`; a
  re-seed would reintroduce the *old* wording, not restore anything. This is
  a known, documented gap (see "Remaining legacy code" below), not fixed by
  this phase.

**Runtime translation authority after cleanup:**

| Before 6A.8C | After 6A.8C |
| --- | --- |
| `translations.sqlite` (already authoritative since 6A.8B; Mongo retained but unread) | `translations.sqlite` (unchanged — the only place translation data exists at all now, for the 16 previously-Mongo-backed verseKeys) |

`VerseTranslation` runtime authority: **NONE** (collection is empty).
Legacy `Ayah` inline translation fields: **removed** from the 16 documents
that had them (not merely non-authoritative — actually absent now).

**Verification.** Post-cleanup, with the live `VerseTranslation` collection
at 0 documents: all 6,236 canonical verseKeys and all 205 Phase 6A candidate
verseKeys still resolve Arabic + translation + surah metadata (same test
suite as 6A.8B, re-run against the real post-cleanup database, plus a
dedicated live, non-mocked script proving `findAyahById('39:53')`,
`findAyahById('2:153')` — legacy path, fields now genuinely absent in Mongo
— and a zero-Mongo-coverage verseKey (`114:6`) all resolve correctly through
the real `MongooseQuranRepository` against the real database).
`quran.sqlite`, `translations.sqlite`, `surah-names.json` and the verified
Pickthall JSON source hashes are all unchanged (see the phase's own report
for exact before/after hashes).

**Remaining legacy code (not removed by this phase, deliberately):**

- `backend/src/models/VerseTranslationModel`: classified **seed-only +
  rollback support**, not runtime-required (confirmed: `MongooseQuranRepository`
  no longer imports it as of 6A.8B). Still referenced by
  `backend/src/seed/migrateFoundation.ts` (would recreate `VerseTranslation`
  documents with the *old* wording if re-run — a real, documented risk, not
  fixed here) and by this phase's own cleanup/rollback scripts and tests.
  Recommend: a small future code-cleanup phase should either update
  `migrateFoundation.ts` to stop writing `VerseTranslation` (mirroring how
  `seed.ts` already stops writing `arabicText` via `stripAyahArabicText`) or
  formally retire the model, not both at once with further data mutation.
- Legacy `Ayah.englishTranslation`/`translationSource` schema fields:
  intentionally **kept in the schema** (as optional), not deleted, since
  `seed/ayahs.ts` still populates them literally and removing the fields
  from the schema entirely is a separate, larger decision than this phase's
  storage-cleanup mandate.

Both of the risks named above are closed by Phase 6A.8D, directly below.

## Preventing legacy Mongo translation reintroduction (Phase 6A.8D)

Status: **complete**. Code-hardening only — no data mutation, no Mongo
writes, no emotion/mapping activation. Closes the two regression risks 6A.8C
identified but deliberately left open (see "Remaining legacy code" above).

**What changed:**

- **`backend/src/seed/migrateFoundation.ts` no longer writes
  `VerseTranslation` at all.** `buildFoundationSeedData(...)` still computes
  a `translations` array (other consumers, e.g.
  `foundation-integrity.test.ts`, still legitimately exercise it as a pure
  data-shape function), but `migrateFoundation()` never persists it — the
  `VerseTranslationModel.updateOne(...)` write block, the translation half
  of the equivalence check, and the translation-checksum-conflict guard
  (`assertNoChecksumConflicts`) were all removed, since none of them are
  meaningful once nothing is written. `migrateFoundation.ts` no longer
  imports `VerseTranslationModel` at all. Re-running `npm run
  migrate:foundation` is now a safe no-op for translation — it still
  upserts `Emotion`, `Verse` (Arabic-stripped, as before) and
  `EmotionVerseMapping`, exactly as it did before this phase.
- **`backend/src/seed/seed.ts`'s Ayah write path no longer persists
  `englishTranslation`/`translationSource`.** A new `stripLegacyTranslationFields`
  helper (same shape and spirit as the existing `stripAyahArabicText`, now
  generalized with a type parameter so the two compose:
  `stripLegacyTranslationFields(stripAyahArabicText(ayah))`) strips both
  fields from the `$set` payload before every `AyahModel.updateOne(...)`
  call. `seed/ayahs.ts` itself is untouched and still literally carries the
  pre-Gutenberg Pickthall wording (it remains the historical source that
  `buildFoundationSeedData` derives from), but that wording can no longer
  reach MongoDB through `npm run seed`.
- **Nothing else changed.** `VerseTranslationModel` and the optional
  `Ayah.englishTranslation`/`translationSource` schema fields are
  deliberately **retained** — `rollbackTranslationCleanup.ts` still needs
  the model and schema shape to restore a real backup if one is ever
  needed, and Step 9's classification (seed/migration: none now; rollback:
  yes) doesn't justify deleting them. `prepareTranslationCleanup.ts`'s own
  `rollbackStrategy` report text was updated to stop claiming a re-seed
  would reintroduce old wording — it no longer can.

**Regression protection:**
`backend/tests/quran-data/no-translation-reintroduction.test.ts` proves,
without opening a real database connection (`connectToDatabase`/
`disconnectFromDatabase` mocked, every Mongoose model call
`vi.spyOn`-stubbed): `stripLegacyTranslationFields` removes both fields from
every real seed ayah while preserving everything else; it composes with
`stripAyahArabicText`; running the real `seedDatabase()` function never
calls `AyahModel.updateOne` with either field in its `$set` payload; and
running the real `migrateFoundation()` function never calls
`VerseTranslationModel.updateOne`/`create`/`insertMany` (a canary spy that
would catch the write coming back even if a future edit re-imports the
model). `mongo-translation-independence.test.ts` (unchanged, still passing)
continues to prove the read side independently, including the dedicated
39:53 Gutenberg-wording test.

**Verified live, read-only, zero Mongo writes performed by this phase:**
`VerseTranslation` = 0, `Ayah` documents with `englishTranslation` = 0,
`Ayah` documents with `translationSource` = 0, `Emotion` = 12,
`EmotionVerseMapping` = 43 — identical before and after, matching the
6A.8C baseline exactly. Rollback tooling
(`rollbackTranslationCleanup.ts --backup <path>`, no `--apply`) was
exercised in dry-run mode against a synthetic fixture backup (this
workspace has no real 6A.8C backup file on disk — `backend/backups/` is
git-ignored and empty, matching `objectId.ts`'s own comment that "no real
backup exists yet" here) built from real, live Ayah `_id`s read-only; the
script parsed it, computed a valid restore plan (16 Ayah documents
restorable, 0 `VerseTranslation` conflicts), and correctly refused to write
anything without `--apply`. This confirms the hardening did not disturb the
rollback code path; it does not by itself prove the original 6A.8C backup
file (wherever it now lives) is restorable, since that file was not
available to test against.

**Translation authority, restated (unchanged by this phase):**
`translations.sqlite` remains the sole runtime source for English
translation text. MongoDB translation authority remains **NONE**. This
phase only removes MongoDB's ability to accumulate translation-shaped data
through normal application workflows going forward — it does not touch
`translations.sqlite`, `quran.sqlite`, or `surah-names.json`, and it does
not activate the reviewed 29-emotion/1,845-mapping dataset (still pending
Phase 6B).

## Pre-6B verification hygiene (Phase 6A.8E)

Status: **complete**. Two hygiene gaps only — no data mutation, no Mongo
writes, no emotion/mapping activation.

**A. Cross-platform hash verification for the Pickthall source JSON.**
`tools/quran-verification/pickthall-gutenberg-16955.json` failed its
hash-pin check on a Windows checkout with `core.autocrlf=true`: the
*committed Git blob* (`git show HEAD:...`) hashes to exactly the pinned
`f22e7ef2958bab19b36e5c604f927da8241148e73ec9763100bc9ffc27c8a4b4` — proven
identical, byte for byte, to the blob SHA-1 already in the index
(`29e641c3b5baafbb249a55397053c24be5e80255` both ways) — but the
*working-tree copy* Git's smudge filter wrote to disk carried exactly
24,975 injected CR bytes (one per line, all forming CRLF pairs; confirmed
by direct byte counting, not assumed). This was purely a checkout-time
line-ending conversion, never a content change, and never touched any
commit. Fixed by pinning the file to LF in
`tools/quran-verification/.gitattributes` (`pickthall-gutenberg-16955.json
text eol=lf`, matching that file's existing narrow, per-file style rather
than a repo-wide rule) and forcing a re-checkout
(`rm` + `git checkout --`); the working-tree file now hashes to
`f22e7ef2...` again, with `git diff`/`git status` showing zero change to
the JSON's tracked content. The pinned expected hash was **not** changed
to the CRLF-derived value, and `generate-translations-sqlite.mjs`'s
`readVerifiedSource` still hashes raw file bytes directly
(`sha256(readFileSync(path))`, no text-mode reading, no CRLF-to-LF
replacement in code) — the fix works by making Git's checkout itself
produce canonical bytes on every platform, so real corruption still fails
verification; nothing about the hash check itself was weakened.

**Newly discovered, separate issue (not fixed by this phase):** with the
hash-pin exception gone, `translations-sqlite.test.mjs` surfaced a second,
previously-masked failure — a translations.sqlite freshly built from source
*in this environment* (Node v24.15.0; the repository pins no Node version
via `.nvmrc`/`engines`) is not byte-identical to the published
`backend/assets/quran/translations.sqlite`, even though two fresh builds in
this same environment are byte-identical to *each other* and the published
file independently passes full structural/content verification (6,236/6,236
exact matches, corpus-checksum match, `integrity_check: ok`). This points to
SQLite/Node version drift between whatever environment originally produced
the published database and this one, not a content or corruption problem,
and not a regression from this phase's `.gitattributes` change (the schema
and generator source are already LF-pinned and untouched). Per this phase's
restrictions, `translations.sqlite` was not regenerated or modified to
"fix" this, and the test was not altered to hide it. It is recorded here as
an open, separate follow-up: pin a Node version for this build (e.g. an
`.nvmrc`/`engines` entry) and re-verify byte-for-byte determinism on it.

**B. Historical 6A.8C Mongo backup — availability re-confirmed, not fabricated.**
The Phase 6A.8C narrative above and 6A.8D's own verification both referred
to a real, live-run backup:
`backend/backups/translation-cleanup/mongodb-translation-before-cleanup-1789439974933.json`
(historically reported SHA-256
`ad6a7e4d28bc4205c32ee49ac98d1c50dbe507393d23d8fcb3d04cc57da01d91`; 16
`VerseTranslation` documents + 16 targeted `Ayah` records). A read-only
search of this workspace — `backend/backups/` (contains only its own
`.gitignore`), the full repository tree, the sibling directory under `My
App/` (none besides `QuranHeals` itself), this user's home directory
(bounded depth, excluding `AppData`), `Downloads`, and `Desktop` — found
**no copy of this file anywhere**. `backend/reports/cleanup/
translation-cleanup-dry-run.json`, the accompanying dry-run report the
6A.8C narrative also references, is likewise absent and was never
git-tracked (`cleanup-dry-run.json`, the earlier Phase 4C *Arabic* report,
is the only tracked report in that directory). Both are consistent with the
same fact: this workspace never had the artifacts from whichever session
ran 6A.8C's live mutation against Atlas — they were produced there,
gitignored by design, and not carried into this checkout.

**No replacement or reconstruction was created.** Regenerating a "backup"
from the current (already-cleaned) live Mongo state would not contain the
deleted `VerseTranslation` rows or original `Ayah` field values at all, and
a fixture built from `seed/ayahs.ts` literals would not be the actual
pre-cleanup documents (their original `_id`s, timestamps, or exact stored
values) — either would be a fabrication presented as history, which this
phase explicitly avoids. 6A.8D's synthetic dry-run fixture (real live Ayah
`_id`s, placeholder text, built solely to exercise the rollback script's
parse/plan code path) remains correctly labeled as synthetic in that
section above and was not, and is not, treated as the real backup.

**Capability vs. availability, stated precisely:**

| Question | Answer |
| --- | --- |
| Does `rollbackTranslationCleanup.ts` still work mechanically? | **Yes** — proven in 6A.8D via dry-run against a synthetic fixture (parses, computes a correct plan, refuses to write without `--apply`). |
| Is the *exact* original 6A.8C backup file available on this laptop? | **No.** Not found anywhere in this workspace after a read-only search. |
| Can the exact 6A.8C Mongo mutation be rolled back from this laptop today? | **No** — restoring the deleted `VerseTranslation` documents and unset `Ayah` fields to their exact original values requires that specific backup file, which is not currently recoverable here. |

`rollbackTranslationCleanup.ts` is retained unchanged and remains the
correct tool to use **if** that backup file (or an equivalent verified
pre-mutation backup) is ever located or produced again — nothing about its
mechanism was altered or weakened by this finding.

## Canonical translation-build toolchain rebaseline (Phase 6A.8F)

Status: **complete**. Resolves the build-reproducibility gap 6A.8E
discovered but explicitly left unfixed (that phase's restrictions forbade
touching `translations.sqlite` or the Node environment; this phase does
both, under proof).

**What was wrong.** `translations.sqlite`'s bytes turned out to depend on
the embedded SQLite version bundled with `node:sqlite`, not only on the
schema/source content: 6A.8B's original build (Node 24.15.0, embedded
SQLite 3.51.3) produced `a786f58dbdd8181abb1ba075605dbf86a958d993b68e814b05929a534509a8c3`;
a fresh build with an unpinned, newer toolchain (Node 24.15.0→24.21.0
somewhere between machines/sessions) produced different container bytes for
logically identical content — invisible until 6A.8E's line-ending fix
stopped a source-hash crash from masking it.

**Toolchain now pinned and independently cross-verified.** Two development
machines separately confirmed that Node `24.21.0` with embedded SQLite
`3.53.4` deterministically produces:

```
c6d825a2f9de0395a1391339477fce58e5850805b1df161b53dcb7816c898ce8
```

— verified a third time in this phase (two fresh, independent builds in
this session, both hashing to the same value, matching the other two
machines' prior results exactly). The repository root's `.nvmrc` now pins
`24.21.0`. `generate-translations-sqlite.mjs`'s `buildDatabase()` — the
single write path underlying both `--prove-deterministic` and `--publish`
— now refuses to run outside that exact Node/SQLite pair, failing with a
clear error before ever touching the published asset. This gate is
**generation-only**: `verifyDatabase()`/`openReadonlyDatabase()` (used to
check an already-published database, including at backend runtime) remain
ungated and work on any Node version — the backend app itself has no pinned
Node version requirement, only canonical asset generation does.

**Content equivalence proven before replacement, not assumed.** Before
touching the published file, the old (`a786f58d...`) and a freshly built
(`c6d825a2...`) database were compared directly, not just by row count: all
6,236 rows matched on `verse_key`, `surah`, `ayah`, `translation_id` and
`text` — **6,236/6,236 exact text matches, 0 text differences, 0 identity
differences, 0 missing, 0 extra, 0 duplicates on either side** — and the
`translation_sources` metadata (translator, title, source name, source
hash, corpus hash, license note) was identical. The corpus checksum (the
same sort-concatenate-SHA256 method used elsewhere in this document) was
computed three ways — from the verified source JSON directly, from the old
published database, and from the freshly built database — and all three
equal `5d62a79ecdba31c2b2e876432bdb794e374d4e8e80e6da00eae225a13c2c64d3`.
Only after all of this passed was `backend/assets/quran/translations.sqlite`
replaced (via `generate-translations-sqlite.mjs --publish`, after removing
the old file so its safety check — which refuses to silently overwrite a
differing existing file — would allow the deliberate, verified swap).

**Published hash, updated.** `backend/assets/quran/translations.sqlite` is
now `c6d825a2f9de0395a1391339477fce58e5850805b1df161b53dcb7816c898ce8`
(1,732,608 bytes — same size as before). The active runtime pin in
`backend/src/quran/translationSource.ts` (`expectedHash`) and the current
asset documentation in `tools/quran-import/README.md` were updated to
match; the historical `a786f58d...` value in this document's own "Phase
6A.8B" section above was left as a historical record of what that phase's
toolchain produced, with an added note pointing here rather than being
rewritten.

**Unaffected by this phase (verified, not merely assumed):**
`quran.sqlite` (both copies), `surah-names.json`, and the verified Pickthall
source JSON (`tools/quran-verification/pickthall-gutenberg-16955.json`,
still `f22e7ef2...`) are all byte-unchanged — confirmed by hash before and
after. No MongoDB write of any kind occurred. The 6A.8E historical-backup
finding (the original 6A.8C backup remains unavailable in this workspace)
is unchanged by this phase and was not touched or re-litigated.

**Second-machine verification.** After pulling the eventual commit, confirm
on the other machine with:

```sh
node --version
node -p "process.versions.sqlite"
Get-FileHash backend/assets/quran/translations.sqlite -Algorithm SHA256
node --test tools/quran-import/translations-sqlite.test.mjs
```

expecting Node `v24.21.0`, SQLite `3.53.4`,
`translations.sqlite` = `c6d825a2f9de0395a1391339477fce58e5850805b1df161b53dcb7816c898ce8`,
and 7/7 passing tests.
