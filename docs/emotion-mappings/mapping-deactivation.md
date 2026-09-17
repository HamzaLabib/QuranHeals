# Exact mapping deactivation

The historical activation tool adds the frozen Phase 5C set, and Batch 6 activation
adds its reviewed set. Neither is a general reconciliation tool. Do not replay
historical activation to apply current removals.

`mapping:deactivate` provides a reusable, exact-pair removal from the visible mapping
set. It changes only the targeted mapping status to `rejected`; it preserves the
mapping record, other mappings, emotions, and Quran records/text. Runtime foundation
queries filter by visible status, so a rejected record cannot be served as approved.
A general database-wide prune is deliberately out of scope: absence from a file alone
is insufficient authority to deactivate a mapping.

From `backend`, with database access available:

```powershell
npm run mapping:deactivate -- --verse 2:222 --emotion seeking_guidance
```

This is read-only. It reports the current status and `wouldChange`. Both modes rebuild
current approval authority from raw sources, verify the historical regression, and
require an explicit REJECT/HOLD for the exact identity. They refuse still-approved
pairs, unrelated query results, duplicate database identities, and unknown statuses.

Write mode requires an exact confirmation token and a new backup path:

```powershell
npm run mapping:deactivate -- --verse 2:222 --emotion seeking_guidance --apply --confirm deactivate:2:222:seeking_guidance --backup reports/emotion-mappings/2-222-seeking-guidance-before.json
```

The write runs in a MongoDB transaction, with no nontransactional fallback. A verified,
exclusive-create backup must succeed before the update. The update filter includes
both identity fields, document ID and prior status. The transaction checks exactly
one changed row and verifies the resulting status. Any failure aborts the transaction.
Missing/already-rejected records produce an idempotent no-op. The JSON report identifies
the pair, before/after status, whether it changed, and the backup path. Transaction retry
with an already-created backup fails closed; inspect the backup and database state,
then use a new backup path to retry if needed.

No MongoDB connection or write was attempted while preparing this mechanism. Live
transaction/index behavior still requires a dry-run and reviewed apply in an authorized,
reachable environment. Offline tests exercise authority, scope, confirmation and
idempotence safeguards.
