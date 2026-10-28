# Database backups and restore

Production runs on MongoDB Atlas **Flex** (since 2026-10-28). Flex takes one snapshot a day, automatically, and keeps the most recent ones. The Atlas documentation says 8 on its Flex backup page and 2 on its restore page, so the project's Snapshots page is the authority. Backups cannot be turned off, scheduled differently or taken on demand on Flex.

The development database lives on the same cluster, so its data is in the same snapshots.

Nothing here restores into Atlas. A restore into an Atlas cluster creates or replaces a cluster, and needs the owner's approval each time.

## Keeping deleted accounts deleted

A snapshot taken before someone deleted their account still contains that account. To keep it deleted:

- **The deletion register.** Every account deletion, in the app or by the email-deletion tool, adds an entry to `accountdeletions` in the same transaction (`backend/src/models/AccountDeletion.ts`).
  - Each entry holds the internal account id and the dates only.
  - The TTL index removes it after 30 days, longer than any snapshot is kept.
- **The live register is the complete one.** Export it immediately before any restore (step 2 below).
- **`npm run restore:deletions -- reapply`** deletes every account in the export and in the restored copy's own register again, with the same steps as in-app deletion. With `--end-all-sessions` it also ends every session in the restored copy, so sign-outs made after the snapshot stay effective.
- **Apple.** It never calls Apple: Apple access was revoked when each account was first deleted.
- **Gap.** Deletions made before the register was deployed are not in it. Until 30 days after that deploy, compare the restored `users` with the email-deletion audit log (`account:admin-delete -- restore-check`). Treat in-app deletions in that window as unknown.

**Also restored, and not covered by the register:**
- reflections removed by a sync-password reset;
- favorites and reflections deleted after the snapshot;
- issue reports purged by retention.

Decide case by case. Ending all sessions limits the effect, and users sign in again.

## Restore test (no charge, production untouched)

The snapshot download is free, and runs on the owner's computer. A downloaded snapshot contains real user data, so:
- keep it outside OneDrive and outside every repository, for example `C:\QuranHealsRestoreTest`, on a BitLocker-encrypted disk;
- delete it the same day.

1. **Atlas → the project → the production cluster → Backup → Snapshots.** Record the newest snapshot's time and the number of snapshots listed. This is the evidence that backups run.
   - Download the newest snapshot. It needs Project Owner or Project Backup Manager.
   - The link expires within an hour.
   - It is a `.tar.gz` of raw data files, not a `mongodump` archive.
2. **Export the live register** (read-only), to a path outside OneDrive and the repository:
   ```powershell
   npx tsx "--env-file=$admin\prod-read.env" src/scripts/restoreDeletionRegister.ts export --out C:\QuranHealsRestoreTest\register.json
   ```
3. **Start the copy** on a free local port, bound to this computer only. The installed MongoDB 8.0 is enough; don't touch the existing Windows service.
   ```powershell
   tar -xzf <snapshot>.tar.gz -C C:\QuranHealsRestoreTest\data
   & "C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe" --dbpath C:\QuranHealsRestoreTest\data\<extracted folder> --port 27027 --bind_ip 127.0.0.1
   ```
4. **Check the copy:** document counts per collection against the counts the live database reports the same day, and the indexes (`sessions` TTL, `accountdeletions` TTL, `authchallenges` TTL).
5. **Dry run, then apply:**
   ```powershell
   npm run restore:deletions -- reapply --uri mongodb://127.0.0.1:27027/ --file C:\QuranHealsRestoreTest\register.json
   npm run restore:deletions -- reapply --uri mongodb://127.0.0.1:27027/ --file C:\QuranHealsRestoreTest\register.json --end-all-sessions --apply
   ```
   **Pass criterion:** it ends with `Accounts from the register still present: 0` (exit 0).
6. **Optional:** point a local backend (`NODE_ENV=development`) at the copy and open a few read-only endpoints. Never at production.
7. **Clean up:** stop `mongod`, delete `C:\QuranHealsRestoreTest`, and empty the recycle bin. Record the date, the snapshot time and the results, without any user data, in the private operations notes.

The tool refuses any host other than this computer (`127.0.0.1`/`localhost`), and any `mongodb+srv://` address. It cannot reach Atlas.

## A real restore

Production is restored only on the owner's decision.

- Prefer restoring to a new cluster, then switching the backend's `MONGODB_URI`. That leaves the damaged one for inspection.
- **Order:**
  1. export the live register (if the live database is still readable);
  2. restore;
  3. run `reapply` against the restored data;
  4. end all sessions;
  5. only then point the backend at it.

The privacy policy states how long backups are kept, and that deleted data can remain in them until they expire.
