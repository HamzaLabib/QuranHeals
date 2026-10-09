# Account deletion requests by email (operator runbook)

People who can still open the app should delete their account there: Settings → Account → Danger Zone → Delete Account. It is immediate and confirms their identity with Apple or Google.

This runbook covers requests sent to **quranheals.support@gmail.com** by people who can't use the app. It uses `npm run account:admin-delete` (`backend/src/scripts/adminDeleteAccount.ts`).

> **Status: development only.** The tool refuses every database except `quranheals_dev`, so this procedure is **not yet operational for real requests**. Enabling production needs a separate reviewed change (see "Before production" below).

## Rules

- **Reply only to the address stored on the account.** Never reply to the request's `From:` address if it differs, and never treat a `From:` address as proof.
- **Proof of ownership is the one-time code**, sent to the stored address and returned from that mailbox.
- **Never ask for** an Apple, Google or Quran Heals sync password, a sign-in code, or ID documents.
- **One account per run**, identified by its exact user id, provider and email. A lookup never deletes.
- **Keep the case store and audit log outside the repository** (the tool refuses paths inside it), in a private, backed-up folder. They hold no emails, codes or content.
- **Don't take a backup** of an account before deleting it.

## Procedure

1. **Receive.** Create a case ID `DEL-YYYYMMDD-NN`. The response deadline counts from today.
2. **Acknowledge** within 2 business days.
   - Say that in-app deletion is immediate if they still have access.
   - Ask for the provider (Apple or Google) and the account's email. For Apple "Hide My Email", that's the relay address, shown in the iPhone's Apple ID settings → Sign in with Apple → Quran Heals.
   - Don't confirm or deny that an account exists.
3. **Look up** (read-only):
   ```sh
   npm run account:admin-delete -- lookup --email <address> [--provider apple|google]
   ```
   Several matches (the same email on Apple and Google) are all listed. Ask the owner which account they mean; never assume all.
4. **Challenge:**
   ```sh
   npm run account:admin-delete -- challenge --case <ID> --user-id <id> --provider <p> --email <address> --case-store <file>
   ```
   - The command prints a one-time code **once**. Email it to the stored address with the case ID and a description of what will be deleted.
   - The code expires in 14 days and locks after 5 wrong entries.
   - It refuses Google accounts whose email Google never verified. Those owners must delete in the app.
   - Apple relay addresses only accept mail from senders registered in Apple Developer → Sign in with Apple for Email Communication.
5. **Verify.** When the reply arrives, check in Gmail → "Show original" that it is from the stored address and that SPF/DKIM pass. Then:
   ```sh
   npm run account:admin-delete -- verify --case <ID> --code <code from the reply> --case-store <file>
   ```
6. **Dry run:**
   ```sh
   npm run account:admin-delete -- delete --case <ID> --user-id <id> --provider <p> --email <address>
   ```
   Check the per-collection counts and the Apple action.
7. **Delete:**
   ```sh
   npm run account:admin-delete -- delete --case <ID> --user-id <id> --provider <p> --email <address> \
     --apply --confirm delete-account:<id> --case-store <file> --audit-log <file>
   ```
   - The command revokes Apple access first (when a token is stored), then deletes with the same transaction as in-app deletion, then recounts.
   - For an Apple account with no stored token, it stops until you add `--acknowledge-no-apple-token`. Then tell the owner to remove Quran Heals in their Apple ID settings.
8. **Issue reports**, only if asked: run `issue-reports --email <address>` (dry run), then add `--apply --case <ID> --confirm delete-issue-reports:<count> --case-store <file> --audit-log <file>`.
9. **Confirm** to the stored address. Say:
   - what was deleted, and when;
   - that copies on their devices remain until the app is uninstalled;
   - what remains in backups and logs, if anything.
10. **Close** the case and delete the support thread when its retention period ends.

## Failures and retries

| Exit code | Meaning | What to do |
|---|---|---|
| 0 | Done, or `not-found` (already deleted) | Nothing |
| 1 | Refused before any change (missing or incorrect `--confirm`, unverified case, bad arguments, wrong database) | Fix the command |
| 2 | User id, provider and email don't belong to one account | Re-check the lookup |
| 3 | Apple token unreadable or revocation failed. Nothing deleted. | Retry later |
| 4 | Records remained after deletion | Investigate before retrying |
| 5 | Database deletion failed and was rolled back. Apple may already be revoked, which is harmless. | Retry |

Every outcome after the checks is written to the audit log. Re-running a completed case is safe.

## After restoring a database backup

A restore can bring deleted accounts back. Immediately after any restore, run:

```sh
npm run account:admin-delete -- restore-check --audit-log <file>
```

For each account it reports, re-run step 7 with the original case. A completed case deletes the same account again (`deleted-again`).

## Before production

All of these need their own approval:

- production support in the tool, with the existing `QURAN_HEALS_CONFIRM_PRODUCTION_WRITE` gate;
- the read-only `quranheals-prod-audit` user for lookups and dry runs;
- deciding where production runs happen (a Render shell, or a local machine holding the Apple and encryption keys);
- registering the support address as an Apple email source;
- testing with a real Hide My Email account;
- confirming the response deadline and retention periods.
