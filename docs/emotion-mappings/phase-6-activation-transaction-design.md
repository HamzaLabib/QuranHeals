# Phase 6B activation transaction — design only

Status: **design document. Nothing described here is implemented or executed.**
No code in this repository currently performs any step below. Phase 6A
(`backend/src/scripts/activationDryRun.ts`) performs every validation step
described here in dry-run form and writes nothing.

This document exists so that when Phase 6B is explicitly authorized, the
activation transaction has an agreed shape before any database-mutating code
is written.

## Preconditions (all must hold before step 5 may run)

1. **Environment check** — refuse to run unless `NODE_ENV !== 'production'`
   and `MONGODB_URI` is set, mirroring the guard already used by
   `mapping:upsert` and `mapping:candidates`.
2. **Target database identity check** — resolve and print the database name
   from the connection (never assume); require an explicit
   `--confirm-database=<name>` argument that must match, so a misconfigured
   `MONGODB_URI` cannot silently activate against the wrong cluster/database.
3. **Backup** — before any write, dump the current `Emotion` and
   `EmotionVerseMapping` collections to timestamped JSON files under
   `backend/backups/` (see `backend/src/utils/backupFile.ts` /
   `backupPaths.ts`, the same helpers `migrateFoundation.ts` already uses for
   this purpose). Verify the backup files are non-empty and parse back to the
   expected pre-activation counts (43 mappings / 12 active emotions) before
   proceeding.
4. **Re-run Phase 6A validation** — call
   `validateActivationSet(buildActivationCandidates(loadApprovedMappingsPreview()))`
   from `activationDryRun.ts` and require `passed === true` immediately before
   the transaction opens. Never trust a validation result computed earlier in
   the same process run or in a previous invocation.

## The write step (step 5) — never implemented in Phase 6A

Proposed shape, for when Phase 6B is authorized:

- Use a MongoDB session (`mongoose.startSession()`) with
  `session.withTransaction(...)` so the emotion-activation and
  mapping-insertion writes commit atomically or not at all.
- Inside the transaction:
  1. For each of the 17 currently-inactive seeded emotions that gain at least
     one approved mapping in this activation set, set `active: true`. Never
     flip an emotion to `active: true` with zero approved mappings (this
     mirrors the existing rule enforced by
     `seed-integrity.test.ts`: "every active emotion maps to at least one
     ayah").
  2. Insert the 1,845 activation candidates as `EmotionVerseMapping`
     documents with `status: 'approved'`,
     `mappingVersion: 'phase-6-activation-1'`. Use an insert-only strategy
     for any `(verseReferenceKey, emotionKey)` pair that does not already
     exist; for the 43 pairs that already exist as `development` MVP
     mappings, decide explicitly (a separate, later editorial step, not part
     of this activation) whether to promote their status to `approved` — do
     not silently overwrite `reviewedBy`/`reviewedAt`/`contextNotes`
     provenance already on those documents.
  3. Never touch `Verse`, `VerseTranslation`, or `Ayah` documents. Never write
     Quran Arabic.
- If any step throws, the transaction aborts and every write in it is rolled
  back — no partially-activated taxonomy or mapping set is possible.

## Post-write verification (step 6)

Re-read the collections (outside the transaction, after commit) and assert:

- `EmotionVerseMapping.countDocuments({ status: 'approved' })` includes all
  newly-activated pairs.
- Every emotion flipped to `active: true` has `≥ 1` mapping with
  `status: 'approved'`.
- No duplicate `(verseReferenceKey, emotionKey)` index violation occurred
  (the existing unique index on `EmotionVerseMapping` already prevents this
  at the database level).
- Total counts match the Phase 6A dry-run's predicted counts exactly.

## Rollback / fail behavior (step 7)

- If post-write verification fails, the activation script must **not**
  attempt to auto-correct the database. It should report the discrepancy and
  exit non-zero, leaving the operator to decide between restoring the step-3
  backup or investigating the write path.
- Because step 5 is a single MongoDB transaction, an in-flight failure during
  the write itself already guarantees rollback without any custom recovery
  code — the backup exists for the (much less likely) case of a
  post-commit / post-verification problem.

## Explicitly out of scope for this document

- No estimate of *when* Phase 6B happens — that is a separate decision.
- No change to `userVisibleMappingStatuses` in `MongooseQuranRepository`
  (tightening production to `['approved']` only) — tracked separately in
  `docs/emotion-mappings/taxonomy.md` §7.
- No mobile/UI changes for the newly-active emotions.
