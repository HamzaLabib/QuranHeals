# Account deletion requests by email (operator runbook)

People who can still open the app should delete their account there: Settings → Account → Danger Zone → Delete Account. It is immediate, and it confirms their identity with Apple or Google.

This runbook covers requests sent to **quranheals.support@gmail.com** by people who can't use the app. It uses `npm run account:admin-delete` (`backend/src/scripts/adminDeleteAccount.ts`) on the owner's Windows computer. Retention of everything this produces is described in `docs/data-retention.md`.

> **Status: development only.** Production is disabled in code (`PRODUCTION_EMAIL_DELETION_ENABLED = false` in `adminDeleteAccount.ts`), so this procedure is **not yet operational for real requests**. "Enabling production" below lists what has to happen first; each step needs its own approval.

## Rules

- **The address on file is the only channel.** Send the code to the email stored on the account, which the tool confirms is the address you typed. Never send it to a different `From:` address, and never treat a `From:` address as proof.
- **Proof of ownership is the one-time code**, returned from that mailbox. Codes are valid for **15 minutes** from issue, are single use, and lock after **5** wrong entries. Issuing a new code cancels any earlier pending code for that account.
- **Email verification is refused** when the account has no stored email, when Google never verified it, or when Apple marked it unverified. Those owners must delete in the app (sign in once, then delete).
- **Never ask for** an Apple, Google or Quran Heals sync password, a sign-in code, or ID documents. Requests never cause automatic deletion.
- **One account per run.** The requester never supplies an account id:
  - you choose the account from the lookup;
  - the case is bound to that exact account;
  - deletion takes only the case ID.
- **Emails and codes are typed at hidden prompts.** They are never command arguments, so they don't land in PowerShell history.
- **Don't take a backup** of an account before deleting it.

## One-time setup: the admin folder

Keep every admin file in one folder **outside OneDrive and outside every repository**: the case store, holds file, audit log, env profiles, and (recommended) the Apple `.p8` key. If a file sits in a OneDrive folder, a pruned record would survive in OneDrive's version history and recycle bin, so the tool prints a warning.

These are documented commands only: run them yourself, and nothing configures them automatically.

```powershell
$admin = 'C:\QuranHealsAdmin'
New-Item -ItemType Directory -Path $admin
# Remove inherited access; grant only your own account and SYSTEM (needed by Windows itself).
icacls $admin /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(OI)(CI)F" "SYSTEM:(OI)(CI)F"
icacls $admin   # verify: only those two entries
```

| File | Contents | Sensitive because |
|---|---|---|
| `cases.json` | Case ID, user id, provider, scrypt hash of the code, salted fingerprint of the email, dates | Links a case to an account |
| `holds.json` | Hold kind, reference, reason code, dates | Shows which records are preserved |
| `audit.jsonl` | Case, date, database, user id, provider, outcome, counts | Deletion evidence (3 years) |
| `prod-read.env`, `prod-delete.env` | Production connection strings, Apple key material | Database and Apple credentials |
| `AuthKey_*.p8` | Apple private key | Signs Apple requests |

Turn on BitLocker device encryption for the disk. The `.p8` and Google client-secret files currently in `My App\` (inside OneDrive) should be moved here. This task did not move them.

## Env profiles (production, once enabled)

Production runs never read `backend/.env`. Each profile sets `QURAN_HEALS_SKIP_DOTENV=1`, and the tool refuses a production run without it, or with the wrong profile for the step.

`prod-read.env`, for `lookup`, `challenge` and the dry runs:

```text
NODE_ENV=production
MONGODB_DB_NAME=quranheals_prod
MONGODB_URI=<quranheals-prod-audit connection string>
MONGODB_ENFORCE_CREDENTIAL_SCOPE=true
QURAN_HEALS_SKIP_DOTENV=1
QURAN_HEALS_ADMIN_PROFILE=production-read
```

`prod-delete.env`, for `delete --apply` and `issue-reports --apply`:

```text
NODE_ENV=production
MONGODB_DB_NAME=quranheals_prod
MONGODB_URI=<quranheals-prod-deletion connection string>
MONGODB_ENFORCE_CREDENTIAL_SCOPE=true
QURAN_HEALS_SKIP_DOTENV=1
QURAN_HEALS_ADMIN_PROFILE=production-delete
APPLE_TEAM_ID=...
APPLE_KEY_ID=...
APPLE_PRIVATE_KEY=...            # the .p8 contents, newlines as \n
APPLE_CLIENT_ID=...
APPLE_REFRESH_TOKEN_ENCRYPTION_KEY=...   # must equal Render's value
```

Each run loads exactly one profile with Node's `--env-file`, from `backend/`:

```powershell
npx tsx --env-file=C:\QuranHealsAdmin\prod-read.env src/scripts/adminDeleteAccount.ts lookup --provider google
```

For a write, you also type `$env:QURAN_HEALS_CONFIRM_PRODUCTION_WRITE = 'quranheals_prod'` in that session. It isn't secret. Never type a connection string at the prompt.

**The credential scope is always enforced:**
- a read step refuses a user that can write;
- a write step refuses any user that can do more than `find` + `remove` on the account collections;
- either refuses a user that can reach another database.

## Procedure

Throughout: `<cases>`, `<holds>` and `<audit>` are files in the admin folder. In development, run `npm run account:admin-delete -- ...` from `backend/`.

1. **Receive.**
   - Create a case ID `DEL-YYYYMMDD-NN`.
   - Label the Gmail thread `QH/Deletion`.
   - The response deadline counts from today.
2. **Acknowledge** within 2 business days.
   - Say that in-app deletion is immediate if they still have access.
   - Ask for the provider (Apple or Google) and the account's email. With Apple "Hide My Email", that is the relay address, shown on the iPhone under Apple ID → Sign in with Apple → Quran Heals.
   - Because a code is valid for only 15 minutes, **agree a time** when they'll watch for the code email and reply straight away.
   - Don't confirm or deny that an account exists.
3. **Look up** (read-only). The tool asks for the email at a hidden prompt:
   ```powershell
   npm run account:admin-delete -- lookup --provider google
   ```
   - Several matches (the same email on Apple and Google) are all listed. Ask the owner which account they mean; never assume all.
   - `emailVerification` must be `eligible`.
4. **Challenge,** at the agreed time:
   ```powershell
   npm run account:admin-delete -- challenge --case <ID> --provider google --case-store <cases>
   ```
   - Enter the email (hidden), then pick the account by number from the list.
   - The code is shown **once**. Email it immediately to the address you entered, with the case ID in the subject and a description of what will be deleted.
   - Then run `Clear-Host`.
   - Type the code into the email by hand. Copying it puts it in Windows clipboard history (Win+V).
   - Apple relay addresses accept mail only from senders registered for Sign in with Apple email (already done and tested).
5. **Verify** within the 15 minutes.
   - In Gmail → "Show original", check that the reply comes from the stored address and that SPF and DKIM pass.
   - Then run the command below and type the code at the hidden prompt:
   ```powershell
   npm run account:admin-delete -- verify --case <ID> --case-store <cases>
   ```
   - If the code has expired or is locked, start again from step 4 with a **new** case ID. Note the link between the two case IDs in your private records.
6. **Dry run.** The account comes from the case:
   ```powershell
   npm run account:admin-delete -- delete --case <ID> --case-store <cases>
   ```
   Check the per-collection counts and the Apple handling.
7. **Delete:**
   ```powershell
   npm run account:admin-delete -- delete --case <ID> --case-store <cases> --audit-log <audit> --apply
   ```
   - **Before asking anything,** the tool checks:
     - that the case is verified and has never been used;
     - that the audit log is writable;
     - that the account still has the same provider and stored email;
     - for Apple accounts: that the Apple configuration can sign a request, and that the stored token decrypts.
   - It then shows the database, case, account id and reference, provider, the count for each collection, and the Apple handling.
   - Type `<last 6 characters of the account id> DELETE` exactly. Anything else, or Ctrl+C, cancels with nothing changed.
   - It then revokes Apple first (when a token is stored), deletes everything with the same transaction as in-app deletion, recounts, completes the case, and writes the audit line.
   - **For an Apple account with no stored token,** it stops until you add `--acknowledge-no-apple-token`. Then tell the owner to remove Quran Heals in their Apple ID settings (Sign in with Apple).
8. **Issue reports,** only if asked:
   ```powershell
   npm run account:admin-delete -- issue-reports --case <ID> --case-store <cases>
   npm run account:admin-delete -- issue-reports --case <ID> --case-store <cases> --audit-log <audit> --apply
   ```
   Both ask for the email the owner used in the reports (hidden); it must be the verified address. Apply asks for `DELETE <count>`.
9. **Confirm** to the stored address. Say:
   - what was deleted, and when;
   - that copies on their devices remain until the app is uninstalled;
   - that we keep a minimal deletion record (no email or content) for 3 years;
   - that this email thread is deleted 60 days after completion.
10. **Close.** Record the completion date in your private records; the 60-day Gmail clock starts here (`docs/data-retention.md`).

## Failures and retries

| Exit code | Meaning | What to do |
|---|---|---|
| 0 | Done, or `not-found` (already deleted in the app) | Nothing |
| 1 | Refused before any change: bad arguments, wrong database or profile, unverified or already-completed case, no terminal, cancelled or wrong confirmation, a lock held by another run | Fix and retry |
| 2 | The account no longer matches the case (provider, or stored email changed), or the email isn't the verified one | Start a new case |
| 3 | Apple not configured, token unreadable, or revocation failed. Nothing deleted. | Fix the configuration, or retry later |
| 4 | Records remained after deletion | Investigate before retrying |
| 5 | Database deletion failed and was rolled back. Apple may already be revoked, which is harmless. | Retry |

**Lock files.** If a run reports that `<file>.lock` exists, make sure no other terminal is running the tool, then delete the `.lock` file by hand. The tool never removes it for you.

## After restoring a database backup

Atlas M0 has no managed backups, so there is nothing to restore today. `restore-check --audit-log <audit>` lists account ids that the audit log records as deleted but that exist again. A completed case can't delete again (replay protection), so a resurrected account needs a new decision. If backups are ever enabled, implement the deletion register first (see the deletion-register plan).

## Development rehearsal with restricted users

Rehearse the production two-user setup on `quranheals_dev` with two profiles. The tool then applies the production read-only and deletion-only checks, and any problem is fatal:

- **`development-read`** for `lookup`, `challenge` and the dry runs. It needs a user with `read` on `quranheals_dev` only.
- **`development-delete`** for `--apply`. It needs the custom role: `find` + `remove` on the eight account collections of `quranheals_dev`.

**Profile rules:**
- Each profile must be loaded from an env file that sets `QURAN_HEALS_SKIP_DOTENV=1`.
- A step run with the wrong profile is refused.
- Unknown profile names are refused.
- Development profiles are refused against production, and production profiles against development.
- With no profile, development keeps using the normal `quranheals-dev` user, as before.

`C:\QuranHealsAdmin\dev-delete.env`:

```text
NODE_ENV=development
MONGODB_DB_NAME=quranheals_dev
MONGODB_URI=<quranheals-dev-deletion connection string>
QURAN_HEALS_SKIP_DOTENV=1
QURAN_HEALS_ADMIN_PROFILE=development-delete
```

**Check the role before using it** (development only):

```powershell
npx tsx --env-file=C:\QuranHealsAdmin\dev-delete.env src/scripts/verifyDeletionRole.ts
```

It refuses anything but `quranheals_dev` with the `development-delete` profile, before connecting. Then it:
- runs the tool's strict credential check and inspects the user's privileges;
- reads collection counts only;
- checks that reads and deletes work, using ids that can't exist;
- checks that `update`, `insert`, index creation, and deletes outside the eight collections are refused. These requests can't change data even if they were wrongly allowed: an id that can't exist, a document the server must reject, an invalid index type.
- runs the real deletion transaction for a freshly generated account id that owns no records.

It stops at the first operation that is unexpectedly permitted. Exit codes:
- 0: the role is exactly right;
- 1: the role doesn't match;
- 2: something unexpected was permitted. Don't use the role; investigate.

## Enabling production (each step needs approval)

1. **Deletion-only database user.** Create the Atlas custom role `quranheals-account-deletion` on `quranheals_prod`, with `find` and `remove` on exactly: `users`, `sessions`, `userfavorites`, `userpreferences`, `userreflections`, `usersynckeys`, `applecredentials`, `issuereports`. Nothing else.
   - Assign it to a new user, `quranheals-prod-deletion`.
   - Atlas documents custom roles as supported on Free (M0) clusters; changes can take up to 30 seconds to deploy.
   - Test it first as `quranheals-dev-deletion` on `quranheals_dev`. The tool's deletion-only check must pass, and a dev deletion must succeed.
   - If M0 refuses the role, **stop**: don't fall back to `readWrite`.
2. **Read-only user.** Confirm that `quranheals-prod-audit` is `read` on `quranheals_prod` only.
3. **Admin folder and profiles,** as above.
4. **Code change** setting `PRODUCTION_EMAIL_DELETION_ENABLED = true`, reviewed on its own.
5. **Trial:** a full run on your own throwaway Google account and Apple relay account. This includes the first real Apple revocation; check in Apple ID settings that Quran Heals is gone.
6. Publish the legal pages that describe this procedure.
