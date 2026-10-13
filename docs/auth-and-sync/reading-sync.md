# أورادي وختماتي sync (Wirds and Khatmas across devices)

**Status (2026-10-13):** implemented and tested; not deployed. A signed-in account's أوراد, their saved pages and cycles, the selected ورد, and every confirmed Khatma sync between its devices.
- **Account-based, like favorites.** No Sync Password, and never affected by it.
- **Guests:** their data stays on the device.

**Code:**
- **Backend:** `backend/src/services/readingSync.ts` (the rules), `MongooseReadingSync.ts`, `models/UserReadingRecord.ts`, `models/UserReadingSyncState.ts`, `validators/readingSyncValidators.ts`, routes in `routes/syncRoutes.ts`.
- **Mobile:** `mobile/src/sync/readingSync.ts` (engine), `readingSyncModel.ts` (records, validation and merge rules), `readingSyncState.ts` (per-account sync state and status line), and `mobile/src/mushaf/khatmas.ts` (local data).

## Architecture decision

| | Reflections | أورادي وختماتي |
|---|---|---|
| **Protection** | End-to-end encrypted with the Sync Password (unchanged) | Authenticated account sync. Stored readable by the server for the signed-in account only. HTTPS in transit; at rest, the database provider's encryption (MongoDB Atlas encrypts storage at rest by default). |
| **Needs the Sync Password** | Yes | **Never.** Works while reflections are locked, never set up, or being reset. |
| **Forgotten-password reset** | Deletes the encrypted reflections and key | **Untouched:** no record, marker, position, selection, count or sync state is changed. |

**Why not end-to-end encrypted:**
- Reading positions and Khatma history must stay reachable and safe from a forgotten password, which would otherwise make them unrecoverable.
- The server can now validate the content too: page 1–604, name rules, dates, and that a cycle matches its page.

**Trade-off (stated in the Privacy Policy):** Quran Heals can technically read ورد names, saved pages and Khatma dates/Ramadan classification, as it already can for favorites.

## What syncs, and what never does

| Synced (one record each) | Never synced |
|---|---|
| Each ورد: id, name and when it was named, saved page and when it was saved, its current reading cycle (id, start, generation `seq`, pending-completion state, the Khatma that started it, `undoneCycleId`), and deletion | Counts. الختمات and ختمات رمضان are always computed from the confirmed, non-deleted Khatma records on each device. |
| Each confirmed Khatma: id, ورد id and name, cycle id, cycle start, completion time, local civil date, Ramadan classification and Hijri year, and deletion | Anything for a guest. |
| The selected ورد and when it was chosen | Pages browsed. Only an explicit save moves a ورد. |

A Khatma record is taken exactly as the confirming device wrote it. A completion is never reclassified by another device's time zone or calendar, and the server returns the stored record, never a re-sent variant.

## Security and privacy

- **Owner:** taken from the verified session only (`requireAuth`). An account id in a request is refused (strict schemas), never used. Account B can't read or change Account A's records, even by naming the same ids (tested).
- **Validation:** every field is validated server-side (`readingSyncValidators.ts`). Unknown fields, oversized values, mismatched ids and the old encrypted format are refused with `400`.
- **Bounds:**
  - at most 50 changes per request, inside the app-wide 512 kb JSON limit;
  - 500 active أوراد, 10,000 confirmed Khatmas, 50,000 records per account;
  - the global rate limit applies, as for favorites.
- **Logging:** content is never logged; errors are fixed strings.
- **Database permissions:**
  - the production application user is `readWrite` on `quranheals_prod` only (`docs/backend-environments.md`), which covers the two new collections;
  - the read-only audit user can read them;
  - no new role is needed.

## How a sync runs

**Triggers:**
- sign-in, a restored session, the app returning to the foreground (throttled to once a minute), and pull-to-refresh, as part of the full sync, **before** the Sync Password step;
- 2 seconds after the last reading change (debounced), as a reading-only sync that never shows or waits for the Sync Password prompt.

After a failure, or with changes still unacknowledged, a reading-only retry runs while the app is open: after 15 s, then 1 min, 5 min, then every 15 min. Retries stop in the background and on sign-out. One reading sync runs per account at a time.

**Steps:**
1. **Download** every record changed since the last sync: `GET /api/sync/reading?since=N&limit=200`, paged. Each account's changes are numbered in commit order.
2. **Apply** the changes locally under the reading lock, with the rules below. Content that fails validation (damaged, or a newer format) is never applied and never overwritten.
3. **Upload** what differs from the version the account last confirmed: `POST /api/sync/reading`, ≤ 50 changes. Each result is handled:
   - `applied`;
   - `conflict`: merged and re-sent, at most 4 rounds per sync;
   - `deleted`;
   - `duplicate`: the account's Khatma for the cycle is kept;
   - `limit`.

Pending changes are what differs from the last acknowledged version, kept on the device (`quran-heals:mushaf-reading-sync:v2:account:<userId>`). They survive restarts, offline days and lost responses. Local data is always written before that sync state.

## Conflict rules (deterministic)

- **Different أوراد:** both edits are kept.
- **Same ورد renamed on both:** the later rename (`nameUpdatedAt`) wins. An exact tie keeps the account's.
- **Different pages, same cycle:** the later save (`savedAt`) wins, not the higher page. An exact tie keeps the account's.
- **Confirmation or undo seen by only one device:** the newer cycle generation (`seq`) wins, so a stale device can't revert a confirmation. Exception: if the newer side is an undo of the cycle in which the other device saved progress, the progress is kept (and the Khatma stays removed).
- **Both confirmed the same completion:** the cycle with progress wins, then the later save, then the smaller cycle id.
- **Deleted on one device, edited on another:** the deletion wins, permanently. Its Khatmas stay in history.
- **Same names created on two devices:** both are kept. The smallest id keeps the name; the others get " (2)", the same on every device.
- **Selected ورد:** the latest choice wins. If it's deleted, no ورد is selected.

## Khatma integrity

- **Manual only:** sync never confirms, infers completion from a page, or converts positions into pages recited. A downloaded cycle always agrees with its page (also enforced server-side).
- **One per cycle:**
  - the id is `khatma-<cycleId>`, so retries and repeated taps are the same record;
  - the server checks inside the transaction, with a partial unique index `{ userId, cycleId }` over confirmed, not-deleted Khatmas as a backstop;
  - concurrent confirmations from two devices give one `applied` and one `duplicate`. A real-MongoDB test runs 8 parallel confirmations of one cycle.
- **Removal is permanent:** a content-free deletion marker that refuses re-uploads. Re-confirming after an undo uses `khatma-<cycleId>-2`.

## Server

- **Concurrency:** each push is one transaction behind `withExistingUser`, which writes the account's User document first. Pushes therefore serialize per account and commit in change order, and a push racing an account deletion is refused (`401`) and writes nothing.
- **Account deletion:** removes `UserReadingRecord` and `UserReadingSyncState` in the deletion transaction.
- **Sync Password reset / new key:** never touch either collection. Tested on both the in-memory and the MongoDB repository.

## Migration from the earlier encrypted design

An earlier development version encrypted these records with the reflection Sync Password.

**Evidence it was never released:**
- None of its files were ever committed; `git log --all` finds them on no branch, and `origin` has neither.
- The backend deploys from the repository, so the production API never had the endpoints.

**Not verifiable from the repository:** EAS OTA history. An update could in principle be published from a local working tree. So the migration below is implemented anyway, and it is safe whether or not any such data exists.

1. **Identify.** A legacy record has `ciphertext` and no `data`.
2. **Never serve, never delete.** Legacy records are excluded from downloads and kept in the database. Their content-free deletion markers apply unchanged, so nothing deleted can return.
3. **Transform on the device.** Devices hold the plaintext copy of every record they synced.
   - The new app discards only its old device sync state (`…:v1`), never the reading data. Its first sync uploads everything it holds under the same record and cycle ids.
   - The server replaces a same-id legacy record with that content (revision continues) and keeps the old ciphertext in `legacyEncrypted`.
   - A legacy Khatma holding the same cycle under another id becomes kind `legacy-khatma`: kept, out of the unique index and every query. The device's record takes the cycle.
4. **No duplicates.** Several devices re-uploading the same ids converge through the normal conflict rules (tested with two devices).
5. **Retry-safe.** Every step is the normal sync, so an interruption simply repeats.
6. **Old clients can't overwrite migrated data.** Their encrypted payloads are refused (`400`). New-format records they download fail their decryption, so they treat them as unreadable and never overwrite them.
7. **Cleanup.** Removing `legacyEncrypted`, `legacy-khatma` and remaining legacy records is a separate, later step. Do it only after all devices have upgraded and the migrated data has been checked. No cleanup script exists yet.

If confirmation of the deployment history (EAS) shows no such build was ever published, the legacy handling is inert. No production data needs changing either way.

## Deployment

1. **Backend first.** No data migration step; Mongoose builds the indexes at startup. In Atlas, confirm `UserReadingRecord` has the unique `{userId, kind, recordId}` index and the partial unique `{userId, cycleId}` index.
2. **Then the app, as an OTA update.** JavaScript only, so the runtime fingerprint is unchanged. A build without this feature never calls the endpoints and keeps working locally.
