# Approved Emotion Mapping Activation Transaction — Design & Implementation

Status: **activation tooling implemented and preflight-verified. No
activation has been applied yet.** Every step below is now real, tested code
— `backend/src/scripts/activateApprovedEmotionMappings.ts` (preflight +
apply) and `backend/src/scripts/rollbackEmotionMappingActivation.ts`
(dry-run + apply) — not merely a plan. Its default (and only currently
exercised) mode is a **read-only preflight**: it has been run against the
live database and produced `backend/reports/emotion-mappings/
activation-preflight.{json,md}`, which reconciles exactly to 1,845 approved
pairs (1,802 inserts + 43 promotions + 0 already-approved) and 29 predicted
active emotions, with zero blocking reasons. The write path (`--apply`) has
never been invoked against the live database in this repository.

This document originally existed so that the activation transaction would
have an agreed shape before any database-mutating code was written. That
code now exists; this document is kept as the authoritative description of
what it does and why, updated where implementation decisions were made more
precisely than originally sketched (see the promotion-policy note under
step 5).

## Preconditions (all must hold before step 5 may run)

1. **Environment check** — `activateApprovedEmotionMappings.ts` refuses to
   run (preflight or apply) unless `NODE_ENV !== 'production'` and
   `MONGODB_URI` is set, mirroring the guard already used by
   `mapping:upsert` and `mapping:candidates`. Implemented in
   `validateApplyRequest`/`assertNonProductionConnectable`.
2. **Target database identity check** — the script resolves and prints the
   connected database name (never assumes it); `--apply` requires an
   explicit `--confirm-database=<name>` argument that must match exactly, so
   a misconfigured `MONGODB_URI` cannot silently activate against the wrong
   cluster/database. Two more explicit confirmations are also required:
   `--confirm-approved-count=1845` and
   `--confirm-activation=approved-emotion-mappings`.
3. **Backup** — before any write, `writeActivationBackup` dumps the current
   `Emotion` and `EmotionVerseMapping` collections to a timestamped JSON file
   under `backend/backups/emotion-mappings/` (see
   `EMOTION_MAPPING_ACTIVATION_BACKUPS_DIR` in `backupPaths.ts`), wrapped in
   the same ObjectId-round-trip-verified envelope format used elsewhere in
   this repository (`backend/src/utils/objectId.ts`). The backup additionally
   records `activationFootprint` — exactly which emotion keys/mapping pairs
   this specific run is about to create/activate/insert/promote — so
   `rollbackEmotionMappingActivation.ts` can later bound its restoration to
   this activation's own footprint rather than guessing. Verified
   immediately after writing (parses, database name matches, record counts
   match, every ObjectId round-trips) before the transaction may proceed.
4. **Re-run activation dry-run / preflight validation** — the preflight
   calls `validateActivationSet(buildActivationCandidates(loadApprovedMappingsPreview()))`
   (from `activationDryRun.ts`) and its own live-database audit
   (`auditEmotionDefinitions`, `auditMappings`, `buildWritePlan`) immediately
   before any write, and requires a clean `PASS` — including verified unique
   indexes (`Emotion.key`, `EmotionVerseMapping.(verseReferenceKey,
   emotionKey)`) and live transaction support. Never trusts a validation
   result computed earlier in the same process run or a previous invocation.

## The write step (step 5) — implemented in `runActivationApply`, not yet invoked against a live database

Implemented shape (`activateApprovedEmotionMappings.ts`'s `runActivationApply`):

- A single MongoDB session (`mongoose.startSession()`) with
  `session.withTransaction(...)` so every emotion and mapping write commits
  atomically or not at all — there is no non-transactional fallback path.
- Inside the transaction:
  1. For each approved emotion key with no live `Emotion` document
     (`writePlan.emotionsToCreate`), create one from the canonical
     `backend/src/seed/emotions.ts` definition with `active: true`. For each
     approved emotion key that exists live but is `active: false`
     (`writePlan.emotionsToActivate`), `$set active: true` only — no other
     field changes. An emotion is never activated with zero approved
     mappings, because `buildWritePlan` derives `emotionsToCreate`/
     `emotionsToActivate` from exactly the set of keys the 1,845 approved
     candidates cover (mirrors the rule already enforced by
     `seed-integrity.test.ts`: "every active emotion maps to at least one
     ayah").
  2. Insert `EmotionVerseMapping` documents for every approved pair with no
     live document (`writePlan.mappingsToInsert`), with
     `status: 'approved'`, `mappingVersion: 'approved-emotion-mappings-v1'`,
     and `contextNotes` carrying the approved-mapping provenance string
     (`[approved-mapping-source: ...]`) — no fabricated `reviewedBy`/
     `reviewedAt`/`confidence`.
  3. **Promotion policy, decided and implemented (this is more precise than
     this document originally sketched):** for the 43 pairs that already
     exist as `development`-status MVP mappings (all 43 turned out, on live
     audit, to already be approved candidates — not assumed, calculated),
     `$set` **only** `status: 'approved'` and
     `mappingVersion: 'approved-emotion-mappings-v1'` — `_id`, `createdAt`,
     `reviewedBy`, `reviewedAt`, `rationale`, `confidence`, `contextNotes`
     and `tafsirReferences` are left completely untouched. The same rule
     applies to any `draft`/`reviewed`-status candidate. An approved
     candidate that already has `status: 'approved'` is a no-op. An approved
     candidate that already exists with `status: 'rejected'` **blocks the
     entire preflight** (`buildWritePlan`) rather than being silently
     re-approved.
  4. Never touches `Verse`, `VerseTranslation`, or `Ayah` documents, and
     never writes Quran Arabic or translation text.
- If any step throws, `session.withTransaction` aborts and every write in it
  is rolled back — no partially-activated taxonomy or mapping set is
  possible; tested directly with a forced mid-transaction failure.

## Post-write verification (step 6)

Implemented as `runPostWriteVerification` — re-reads the collections
(outside the transaction, after commit) and asserts:

- Active emotion count is exactly 29.
- Every one of the 1,845 approved candidate pairs has a live document with
  `status: 'approved'` — zero missing.
- Zero duplicate logical pairs among the approved candidates.
- Zero REJECT/HOLD intersections among the approved candidates (re-checked
  post-write, not merely trusted from the pre-write plan).
- Every active emotion has `≥ 1` approved mapping.

Not yet run against a live database — it is only exercised in tests against
fully mocked `Emotion`/`EmotionVerseMapping` models (both a passing case and
several deliberately-broken cases).

## Rollback / fail behavior (step 7)

- If post-write verification fails, `main()` does **not** attempt to
  auto-correct the database — it logs the failures and exits non-zero,
  leaving the operator to decide between restoring the step-3 backup (via
  `rollbackEmotionMappingActivation.ts`) or investigating the write path.
- Because step 5 is a single MongoDB transaction, an in-flight failure during
  the write itself already guarantees rollback without any custom recovery
  code — the backup exists for the (much less likely) case of a
  post-commit / post-verification problem.
- **Rollback tool, implemented:** `backend/src/scripts/
  rollbackEmotionMappingActivation.ts`. Defaults to dry-run; `--apply`
  requires `--backup=<exact path>` and `--confirm-database=<name>`. It is
  bounded to the activation's own recorded `activationFootprint` — it never
  blindly restores or deletes everything. Concretely: every backed-up
  `Emotion`/`EmotionVerseMapping` document whose `_id` still exists live is
  restored exactly (`$set` from the snapshot); a footprint-listed
  "to-be-created" emotion or "to-be-inserted" mapping is deleted **only**
  if it currently exists live, its `_id` is *not* present anywhere in the
  backup (proving it is genuinely new), and — for mappings — its current
  `status`/`mappingVersion` still look untouched since activation
  (`approved` / `approved-emotion-mappings-v1`). Any record that doesn't fit
  that provable shape is reported as drift and blocks the whole rollback
  rather than being guessed at or force-overwritten.

## Explicitly out of scope for this document

- No estimate of *when* activation happens — that is a separate decision.
- **Approved-only API visibility is a separate immediate post-activation
  step.** `MongooseQuranRepository`'s `userVisibleMappingStatuses` is
  currently `['development', 'reviewed', 'approved']` — unchanged by this
  implementation phase. This means that the moment activation actually
  writes `status: 'approved'` to Mongo, those mappings become
  API-servable immediately (since `'approved'` was already in the visible
  set), *before* anyone has deliberately tightened the list to
  `['approved']` only. Tightening it is intentionally sequenced as a
  separate, immediate post-activation step, not bundled into this one, so
  that the database write and the runtime-visibility cutover remain two
  independently reviewable changes. Tracked separately in
  `docs/emotion-mappings/taxonomy.md` §7.
- No mobile/UI changes for the newly-active emotions. Read-only audit
  findings (not fixed here): `mobile/src/components/EmotionCard.tsx`'s
  icon map only covers the 12 currently-active emotions' icon names: all 17
  newly-activated emotions (`droplet`, `heart-crack`, `waves`, `user-x`,
  `user-minus`, `scale`, `unlink`, `alert-circle`, `rotate-ccw`,
  `battery-warning`, `hand-heart`, `hourglass`, `anchor`, `sun`, `smile`,
  `map`, `sparkles`) will render the generic fallback `Circle` icon —
  cosmetic, not a reason to block database activation. More significantly,
  `mobile/src/app/ayah/[emotion].tsx`'s `readableEmotion` label is derived
  by splitting the raw route-param **key** on `-` and capitalizing each
  part — it does not use the API-provided `emotion.name`. Every new
  underscore-separated key (`want_to_cry`, `closer_to_allah`,
  `forgiveness_struggle`, `seeking_guidance`, etc.) will render as a single
  capitalized word with visible underscores (e.g. "Want_to_cry") on that
  screen instead of a readable label — a genuine functional display bug,
  not merely cosmetic, and should be fixed immediately after activation
  (ideally by having that screen consume the API's `emotion.name` the same
  way `EmotionCard.tsx` already correctly does, rather than re-deriving a
  label from the key).
