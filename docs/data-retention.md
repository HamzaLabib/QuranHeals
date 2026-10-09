# Data retention (operator procedure)

Approved retention periods, how each one is enforced, and who does what. The legal pages must match this file. Do not describe a rule as operational in a legal page until its "Status" below says **verified in production**.

## Schedule

| Data | Retention | Mechanism | Status |
|---|---|---|---|
| Account data (users, sessions, favorites, preferences, reflections, sync key, Apple token) | Until the account is deleted | In-app deletion, or the email procedure (`docs/account-deletion-requests.md`) | In-app: operational. Email procedure: development only. |
| Issue reports (database) | 12 months from submission | `npm run issue-reports:retention`, run monthly | Implemented and tested in development. **Production disabled in code**; first production run needs approval. |
| Issue-report email copies (future feature) | 12 months from submission, the same as the database copy | Manual Gmail procedure below | Not built yet |
| Account-deletion email threads | 60 days after the request is completed | Manual Gmail procedure below | Manual. Not automated. |
| Other support conversations | 12 months after the last interaction | Manual Gmail procedure below | Manual. Not automated. |
| Verification cases: pending, expired, superseded, locked, or verified but never completed | 30 days after the code expired | `account:admin-delete -- prune`, run weekly | Implemented and tested (local file) |
| Verification cases: completed | 60 days after completion | Same `prune` command | Implemented and tested (local file) |
| Deletion audit log | 3 years per entry | `account:admin-delete -- audit-prune`, run yearly | Implemented and tested (local file). The first entries become due in 2029. |
| Render service logs | 7 days | Provider-managed (Hobby workspace) | Confirmed. No application mechanism. |
| Sentry error events | Provider retention: **not yet verified** | Provider-managed | **Verification pending** (see Sentry below) |
| Copies on the user's devices | Until the app is uninstalled | Not under our control | Disclosed |

All dates are UTC. A record becomes eligible exactly when its period ends (`now >= deadline`). If adding months lands on a day the month doesn't have (for example, 29 February plus 12 months), the deadline moves forward to the 1st of the next month, never earlier (`backend/src/retention/retentionPolicy.ts`).

## Preservation exceptions (holds)

A hold is the only way to keep a record past its period. It is allowed only for:

- `legal-obligation`: a law or authority requires keeping it;
- `dispute`: a complaint, claim or dispute that the record is evidence for;
- `security-investigation`: an investigation of abuse or a security incident.

The rules:

- Every hold has a **review date at most 365 days away**, and there is no indefinite hold.
- At the review date the hold stops protecting the record. If preservation is still needed, place a new hold deliberately.
- Holds are kept in the local holds file (outside every repository), next to the case store. Record the justification in your private records, not in the holds file: the holds file holds only the reason code, the record reference and dates.
- Only you (the operator) can read or change the holds file. See the NTFS permissions in `docs/account-deletion-requests.md`.

```powershell
npm run account:admin-delete -- hold --holds <holds.json> --kind deletion-case --ref DEL-20261008-01 --reason dispute --review-by 2027-04-01
npm run account:admin-delete -- hold --holds <holds.json> --kind issue-report --ref <24-character report id> --reason security-investigation --review-by 2027-01-15
npm run account:admin-delete -- holds --holds <holds.json>
npm run account:admin-delete -- release --holds <holds.json> --kind issue-report --ref <id>
```

A `deletion-case` hold covers the case record and that case's audit entries. An `issue-report` hold covers one report. Use it, for example, for an unresolved report about a security or content problem that is still being worked on. Every cleanup command requires `--holds`, so a hold can't be skipped by forgetting the file.

Gmail threads under preservation get the Gmail label `QH/Hold`, plus a dated note in your private records with the same reason codes and review date.

## Operator calendar

| When | Task |
|---|---|
| Weekly | `prune` (cases): dry run, then `--apply` if anything is eligible |
| Monthly (first working day) | `issue-reports:retention -- preflight`, then `purge --apply` (production only once enabled). Gmail review (below). Check holds that are due for review. |
| Yearly | `audit-prune` (dry run every year; entries first become eligible in October 2029) |
| Before publishing the legal pages | Verify Sentry retention (below) |

A local scheduled task (Windows Task Scheduler) could remind you, or run the dry runs. It is **not configured** and needs separate approval. Any `--apply` must stay interactive.

## Verification cases: `prune`

```powershell
npm run account:admin-delete -- prune --case-store <cases.json> --holds <holds.json>
npm run account:admin-delete -- prune --case-store <cases.json> --holds <holds.json> --audit-log <audit.jsonl> --apply
```

- **Dry run (the default):** shows counts by category, plus the held, retained and undatable cases.
- **Apply:** asks you to type `PRUNE <n>`. If the count changed since you confirmed it, nothing is removed. It appends a `prune-cases` audit entry (a count only) and removes holds whose review date has passed.
- **What it never removes:**
  - an active, unexpired case;
  - a held case;
  - a case it can't date;
  - anything in the audit log.
- Repeated runs are safe.

## Audit log: `audit-prune`

```powershell
npm run account:admin-delete -- audit-prune --audit-log <audit.jsonl> --holds <holds.json>
npm run account:admin-delete -- audit-prune --audit-log <audit.jsonl> --holds <holds.json> --apply
```

- **What it removes:** only entries whose `at` is at least 3 years old.
- **What it always keeps:** lines it can't parse or date, and entries of held cases.
- **How apply works:**
  - It asks you to type `PRUNE <n>`.
  - Under the file lock, it re-reads the log and refuses if anything changed.
  - It rewrites the file atomically and appends an `audit-prune` entry recording the count.
  - It prints the SHA-256 of the log before and after; record both in your private records.
- Never edit the audit log by hand.

## Issue reports (database)

Approved retention: 12 months from submission. This is enforced by `npm run issue-reports:retention`, **not a MongoDB TTL index**, because:

- a TTL index deletes every existing report past the period as soon as it is built, with no dry run;
- it can't honour preservation holds;
- removing or changing it is itself a production change.

```powershell
npm run issue-reports:retention -- preflight --holds <holds.json>
npm run issue-reports:retention -- purge --holds <holds.json> --audit-log <audit.jsonl> --apply
```

**What the script reads and deletes:**
- It reads only `_id` and `createdAt`, never a comment or an email.
- It deletes due reports by exact `_id`.
- It never deletes held reports, or reports without a valid `createdAt`.
- Apply asks you to type `DELETE <n>` and audits the count.

**Development result (2026-10-09, read-only preflight on `quranheals_dev`):** 2 reports, 0 due.

**Production status:**
- Disabled in code (`ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED = false`).
- No production preflight has been run.
- Enabling it needs approval and the production profiles described in `docs/account-deletion-requests.md`. Read-only preflight uses the read profile; purge uses the deletion profile (`find` + `remove` on `issuereports` is part of that role).

**Unresolved reports:** if a report older than 12 months is still needed, for example for an open security or content issue, place an `issue-report` hold before the monthly purge. Otherwise it is deleted on schedule. Extract any non-personal technical detail you need into your own notes first.

**Emailed copies (future feature):** once each report is also emailed to quranheals.support@gmail.com, the email copy follows the **same** 12 months. Label it `QH/Issue-report` and delete it in the monthly Gmail review once it is 12 months old. A report deleted on a user's request must be deleted from Gmail as well. The emails must not contain reflections, tokens or passwords; the report form never collects them.

## Support Gmail (quranheals.support@gmail.com)

Gmail is outside the backend. **Nothing in the application deletes Gmail messages**, and deleting a local verification case does not delete its Gmail thread.

**Labels.** Apply them when a thread first arrives:

| Label | Use | Retention clock |
|---|---|---|
| `QH/Deletion` | Every account-deletion request thread. The case ID (`DEL-YYYYMMDD-NN`) goes in the subject of every reply you send. | Starts when the request is **completed**: deletion done and confirmed, or the request closed (withdrawn, verification impossible, or no reply 30 days after the final notice). Delete the thread 60 days after that. |
| `QH/Support` | All other conversations | 12 months after the last message in the thread, from either side. A new message restarts the clock. |
| `QH/Issue-report` | Future emailed report copies | 12 months after submission |
| `QH/Hold` | Threads under a preservation hold | Until the hold's review date |
| `QH/Open` | Unresolved threads | Never deleted while open; reassessed monthly |

**Monthly review (manual):**

1. **Deletion threads:** search `label:QH/Deletion -label:QH/Hold -label:QH/Open`. For each thread, look up the case's completion date in your private records. Delete the thread if 60 days have passed.
2. **Support threads:** search `label:QH/Support -label:QH/Hold -label:QH/Open before:<date 12 months ago>`. Gmail returns a thread if **any** message matches, so open each thread and check the date of its **last** message before deleting it.
3. **Sent copies:** the verification-code email is part of the deletion thread, so it is deleted with it. Check `in:sent` for strays.
4. **Empty the Trash** after deleting (Gmail → Trash → "Empty Trash now"). Otherwise Gmail keeps deleted messages in the Trash for 30 days.
5. **Holds:** threads with `QH/Hold` past their review date are reassessed.

**Limitations to disclose honestly:** deleting from Gmail and emptying the Trash removes the messages from the mailbox. Google may keep residual copies in its own systems for a limited time under Google's policies; we don't control that period.

**What must never be in support email:** no passwords, sync passwords, sign-in codes, tokens or reflection text. The templates tell people not to send them. If someone sends any of these anyway, don't quote it back, reply without it, and delete that message once the request is handled.

**Future automation (proposal only, not built):** a Google Apps Script with a time-driven trigger could move `QH/Support` threads whose last message is older than 12 months, and `QH/Deletion` threads with a dated completion label, to the Trash. It would need its own approval and its own tested design, and Gmail OAuth scopes granted to the script. Until then, the manual review above is the procedure.

## Render

- Hobby workspace, US West. Service logs are kept for **7 days** by Render.
- The API logs no request bodies, tokens or emails: errors are written as name, scrubbed message and stack (`middleware/errorHandler.ts`).
- Render's own request logs can contain IP addresses and request paths.
- There is no application cleanup, and none is needed.

## Sentry

**What is confirmed:** error monitoring is enabled, data is stored in the US, and the plan is a Business **trial**. The event retention period is **not verified**: don't publish a number until it is checked.

**To do before publishing the legal pages:**

1. In Sentry, go to Settings → Subscription (or Usage & Billing) and record the event retention for the plan you'll actually be on **after** the trial ends.
2. In Settings → Security & Privacy, confirm whether "Prevent Storing of IP Addresses" and server-side data scrubbing are on. Turning them on is a recommendation only: no configuration was changed in this task.
3. Put the verified period in this table and in the Privacy Policy.

**Code review findings:**

- **What is removed:** user info, request bodies, headers, query strings, local variables and breadcrumbs (`monitoring/monitoring.ts`). Route tags use route templates (for example `/api/sync/favorites/:verseKey`), not values.
- **Identifier leak through database error messages: fixed locally on 2026-10-09, not yet deployed.**
  - **The leak:** provider subjects in duplicate-key messages, and user ids in `CastError` messages.
  - **The fix:** database errors are now described only from fixed identifiers (`monitoring/errorSanitizer.ts`), and other messages are pattern-scrubbed.
  - **Tests:** `tests/monitoring/sensitiveIdentifiers.test.ts`.
  - Events already stored in Sentry before the fix is deployed are **not** changed by it; see the review procedure below.

**Reviewing events stored before the fix (Sentry dashboard; not done in this task):**

1. Before deploying the fix, check the retention period (step 1 above). Events older than it are already gone.
2. In Sentry → Issues, filter on `error.type:MongoServerError`, `error.type:CastError`, `error.type:ValidationError` (and `MongoBulkWriteError`), across the full retention window. Don't open the event JSON or copy values while triaging. The issue **title and type** are enough to identify candidates. Don't paste anything into notes, chats or tickets.
3. **Removal:** delete each matching issue (Issue → ⋯ → Delete). This removes its events. Select several with the checkbox to bulk-delete. Deleting is permanent; that is the intent.
4. **Wider check:** search all issues for the generic markers `dup key`, `for value`, `providerSubject` and `"sub":`. Use the match count only; don't expand events.
5. **Settings:** in Settings → Security & Privacy (and the project's Data Scrubbing), consider adding server-side rules: the "Data Scrubber" defaults and "Prevent Storing of IP Addresses". These are a second layer and need your approval; nothing was changed in this task.
6. **Record:** in your private records, note the date of the review and the number of issues deleted. Don't record their content.
