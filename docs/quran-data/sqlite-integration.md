# Immutable Quran foundation and runtime migration

This is the historical pre-integration audit/checklist. The subsequent runtime
migration is implemented, and the MongoDB Arabic-field cleanup this section
anticipated as a separate phase has since been completed; see
[the current report](runtime-architecture.md) for both.

## Current boundary

The canonical build input is `tools/quran-verification/input/quran-uthmani.txt`,
Tanzil Uthmani 1.1, pinned to SHA-256
`6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f`.
It generates `mobile/assets/quran/quran.sqlite`, containing exact Arabic strings
indexed by verse key. The location keeps the generated artifact with the Expo
app that will eventually load it locally. Its presence in `assets` alone does
not integrate it into the app or guarantee bundling on every target.

King Fahd remains an independent verification/reference source. Its archive,
comparison artifacts and 2,498 remaining review cases are preserved. No source
switch or automatic reconciliation is part of this foundation.

The SQLite generator does not connect to MongoDB, run a migration, change API
responses, or rewrite saved favorites or recent history. This preparation changes
no runtime retrieval behavior. Current MongoDB data counts have not been
re-audited here. [Build and integrity checks](../../tools/quran-import/README.md)
cover the pinned source and generated database independently.

## Target separation

| Layer | Ownership |
| --- | --- |
| Immutable local SQLite | `verseKey -> exact Arabic Quran text`, with pinned build provenance |
| Mutable MongoDB editorial data | `emotion -> verseKey`, status, rationale, confidence, review/version/context metadata |
| Separate translations | `verseKey` plus language, translator, text, source, version, license and checksum |
| Device user data | Favorites and recent selections referencing verses; user timestamps and preferences |

MongoDB is not the intended canonical owner of Arabic text. Translation wording
and licensing remain separate from the verified Arabic corpus. There is no
external Quran API, runtime Arabic download, search-normalized Arabic field or
King Fahd runtime source in the target design.

## Existing duplication and dependencies

| File | Current behavior and migration implication |
| --- | --- |
| `backend/src/models/Verse.ts` | Stores Arabic plus reference, surah names, source/version and checksum. Retain existing records and IDs until metadata and compatibility needs are separated. |
| `backend/src/models/Ayah.ts` | Legacy copy of Arabic, translation and emotion tags. Its Arabic field uses `trim: true`; the exact pinned corpus must never pass through this model. Retain historical records during migration. |
| `backend/src/models/VerseTranslation.ts` | Already separates translation text by `verseReferenceKey`. Preserve translator/source/version/license/checksum data. |
| `backend/src/models/EmotionVerseMapping.ts` | Stores reference keys and editorial metadata, but validates each key using `VerseModel.exists`. Future mapping validation must use the immutable corpus key set. |
| `backend/src/scripts/upsertEmotionMapping.ts` | Also requires a MongoDB `Verse` to exist. Update together with the schema validator so mappings can reference all valid SQLite verses without creating Arabic copies. |
| `backend/src/services/MongooseQuranRepository.ts` | Composes foundation DTOs from MongoDB Arabic, translations and mappings, then falls back to legacy `Ayah`. A local-only mobile reader must cover both response paths. |
| `backend/src/validators/ayahValidators.ts` | Lookup IDs and exclusion lists require Mongo ObjectIds. Existing clients cannot simply replace those IDs with verse keys. |
| `mobile/src/services/api.ts` | Gets complete Arabic-bearing ayah DTOs over HTTP. The eventual client must compose Arabic locally from the returned reference while retaining existing translations and metadata. |
| `mobile/src/storage/favorites.ts` | Persists complete ayah snapshots, including Arabic, keyed by API ID. Saved entries must be resolved through the local corpus for display and sharing. |
| `mobile/src/storage/recentAyahs.ts` | Persists only API IDs per emotion. There is no reference-key history available to substitute without compatibility work. |
| `mobile/src/hooks/useFavorites.ts` | Tests saved status and toggles/removes entries by ID. Preserve that identity or perform an explicit versioned conversion. |
| `mobile/src/app/ayah/[emotion].tsx`, `mobile/src/app/favorites.tsx` | Both share the Arabic on their in-memory ayah objects. Main and saved flows must use the same local text resolver. |
| `mobile/package.json`, `mobile/app.json` | No SQLite loader is configured; the app targets native platforms and static web. Asset loading and platform verification remain work to do. |

The historical seed and foundation migration scripts still maintain the small
legacy runtime dataset. They do not define the new immutable source and must not
be repurposed to upload the entire SQLite Arabic corpus into MongoDB. The older
`import:quran` command remains disabled before any corpus import or database
connection; only its explanatory message reflects this source decision.

**Update:** the runtime migration described in this checklist has since been
implemented. See [the runtime migration report](runtime-architecture.md) for
the current flow and validation results.

## Coordinated runtime migration checklist

1. **Introduce a local Arabic reader.** Load the pinned database through an
   Expo-compatible SQLite adapter; expose lookup by validated `verseKey`. Verify
   database version/integrity, use read-only access where supported, and handle
   initialization or missing/corrupt asset errors explicitly. Never fall back to
   an Arabic network response, historical favorite text or King Fahd text when
   the local lookup fails.
2. **Verify platform packaging.** Configure database asset handling and native
   initialization for supported Expo targets. Establish a supported static-web
   loading strategy for the same verified corpus before changing the shared API
   client. Test actual Android/iOS and web behavior, including offline startup;
   TypeScript compilation alone does not prove asset availability.
3. **Keep editorial selection and translation behavior.** Continue selecting
   only mappings in existing user-visible statuses and within the selected
   emotion. Preserve current translations, their source labels, reference
   metadata, legacy fallback semantics and repeat-exclusion behavior while
   composing only Arabic from SQLite. A full Arabic corpus does not create
   translations or reviewed emotion mappings for previously unavailable verses.
4. **Preserve API identities first.** Keep existing ObjectIds and `referenceKey`
   compatibility while introducing local text composition. If a later API adopts
   verse keys for lookup or exclusion, provide a versioned transition and an
   explicit old-ID-to-reference mapping. Do not invent replacements for stored
   recent IDs or silently discard a user's history.
5. **Resolve saved verses safely.** Load existing favorites using their stored
   `referenceKey`; retain IDs, `savedAt`, translations and metadata. Resolve
   Arabic and its displayed provenance from the local database for both saved
   rendering and sharing. If persistent storage is later reduced to references,
   use a versioned, reversible conversion with a recovery copy and validation
   for malformed or missing references. Do not silently overwrite old snapshots.
6. **Decouple editorial validation.** Validate `verseReferenceKey` against the
   complete immutable corpus key set in both the Mongoose mapping validator and
   mapping CLI. Preserve emotion existence checks, statuses, mapping versions,
   review information and uniqueness constraints. Do not delete existing
   `Verse` records to test this change.
7. **Retire runtime Arabic copies separately.** After all read paths and user
   storage have migrated, inventory the remaining references and ObjectIds,
   preserve needed surah/reference metadata, and prepare a reversible migration
   with a backup and validation report. Removal or destructive rewriting of
   MongoDB Arabic copies requires a separate authorized migration.
8. **Verify the full flow.** Cover all active emotions, mapped translations,
   old-ID lookups/exclusions, another-ayah fallback, save/toggle/remove, existing
   favorites, exact share strings and unavailable/corrupt local-data states.
   Run complete source equality checks in addition to API, native and web flow
   tests. Confirm no runtime Quran Arabic is fetched from a server.

## Why runtime integration remains pending

Changing only a backend Arabic field or the network response reader would leave
saved favorites and share actions using historical Arabic snapshots. Changing
IDs would also affect API validation, repeat exclusions and saved-state identity.
The absent local database loader and native/static-web asset behavior add another
boundary that must be verified. The foundation therefore prepares the immutable
artifact and its integrity contract while preserving the existing app flow until
this coordinated migration is implemented.
