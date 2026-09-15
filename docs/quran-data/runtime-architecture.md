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
`backend/tests/emotion-mappings/phase-6a-activation-dry-run.test.ts` ("zero
Mongo Verse coverage requirement") for the automated proof that all 205
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
`backend/reports/quran-data/gutenberg-pickthall-verification.md`. A
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
--prove-deterministic`) — both builds hash to
`a786f58dbdd8181abb1ba075605dbf86a958d993b68e814b05929a534509a8c3`
(1,732,608 bytes), which is the published `backend/assets/quran/
translations.sqlite`'s own hash. `tools/quran-import/translations-sqlite.test.mjs`
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

**MongoDB.** `Verse`, `Ayah`, and `VerseTranslation` translation-related
fields are **retained, unmodified, and non-authoritative** — exactly the
same status Phase 4C/6A.7 already gave Arabic text and surah names. Zero
Mongo writes were performed by this phase. The existing 16
`VerseTranslation` dev rows (some differing slightly from the approved
Gutenberg wording, see above) were deliberately left as-is; their controlled
retirement is future work, not part of this phase.
