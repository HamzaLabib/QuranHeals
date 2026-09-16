# Incremental faith_shaken activation

Batch 6 adds 169 approved pairs to the historical 1,845 pairs, resulting in
2,014 approved mappings and 30 live emotions. Its final human ledger has
196 candidates, 169 KEEP, 27 REJECT and no HOLD. Both 51:56 and 47:15 are
KEEP. Activation reads the ledger; it never generates editorial decisions.

MongoDB `Emotion.active` controls API visibility. The catalog's inactive
value remains a safe seed default, matching the other post-MVP emotions.
Do not rerun the general seed to activate this emotion: seeding overwrites
live active flags. The historical Phase 5 migration now derives its 29
emotion keys from its frozen 1,845-row preview and does not own Batch 6.

From `backend`, first run the read-only plan against the confirmed
development database:

```powershell
npm run mapping:activate-faith-shaken -- --confirm-database=test
```

The command refuses production, ambiguous database names, missing unique
indexes, unavailable transactions, changed historical pairs, conflicting
target metadata, duplicate pairs, any unexpected target mapping (including
REJECT rows in any status), and legacy target ayah tags. Its accepted database
names are `test`, `quran-heals-dev`, `quran-heals-test`, and underscore variants.
The exact connected name must match the confirmation argument. It disables
automatic collection and index creation. No URI or credentials are logged.

After reviewing a passing plan, apply only this increment:

```powershell
npm run mapping:activate-faith-shaken -- --confirm-database=test --apply --confirm-keep-count=169 --confirm-activation=faith_shaken --report=reports/emotion-mappings/faith-shaken-activation-apply.json
```

The command makes a verified ObjectId-preserving backup in the existing
git-ignored `backend/backups/emotion-mappings/` directory. In a single
snapshot transaction it checks the preflight snapshot has not changed,
creates the parent emotion inactive if needed (required by mapping schema),
inserts missing KEEP mappings as `approved`, verifies all 169 pairs, then
sets the emotion active. Failure aborts the entire transaction. No target
mapping promotion or overwrite is attempted: conflicting pre-existing rows
require inspection. Historical emotion and mapping document fingerprints
must remain identical. Quran and translation databases are read-only.

Re-run the dry-run to verify idempotency:

```powershell
npm run mapping:activate-faith-shaken -- --confirm-database=test --report=reports/emotion-mappings/faith-shaken-activation-post-dry-run.json
```

Expect zero inserts/updates, 169 approved target pairs, zero rejected pairs,
and 1,845 unchanged historical pairs. Re-running apply on that state also
performs no document writes. Review generated reports for actual results.

API checks must use the existing health/emotion/random endpoints, verify
localized metadata and SQLite text, and test up to 20 recent exclusions.
The API also serves `development` and `reviewed` mapping statuses; therefore
the activation audit checks all target mappings rather than only approved
ones. Mobile uses its existing generic card, ayah route, history and actions.
