# Data retention (operator procedure)

Approved retention periods, how each one is enforced, and who does what. The legal pages must match this file. Do not describe a rule as operational in a legal page until its "Status" below says **verified in production**.

## Schedule

| Data | Retention | Mechanism | Status |
|---|---|---|---|
| Account data (users, sessions, favorites, preferences, reflections, sync key, Apple token) | Until the account is deleted | In-app deletion, or the email procedure (`docs/account-deletion-requests.md`) | In-app: operational. Email procedure: development only. |
| Issue reports (database) | 12 calendar months from submission | Render Cron Job `quran-heals-retention`, monthly (`issue-reports:retention purge --store mongo`) | **Operational in production** (Render Cron, since October 2026). Holds, audit history and lock in `quranheals_prod`. |
| Issue-report notification emails (Gmail) | 12 months from submission, the same as the database copy | Manual Gmail procedure below (`QH/Issue-report`) | Built, **notifications off** (`ISSUE_REPORT_EMAIL=off`); not deployed. Manual once enabled. |
| Issue-report notification emails (Resend's copy) | Provider retention: **not yet verified** | Provider-managed | **Verification pending** (see Issue-report notification emails below) |
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
| Monthly (first working day) | Check the Render retention run on the 1st succeeded, then `status --store mongo` and `preflight --store mongo` (see Issue reports below). Gmail review (below). Check holds that are due for review. |
| Yearly | `audit-prune` (dry run every year; entries first become eligible in October 2029) |
| Before publishing the legal pages | Verify Sentry retention (below) |

Issue-report retention runs on Render (Render Cron Job; see Issue reports below). The other cleanups have no schedule; any `--apply` among them stays interactive.

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

**Rule:** a report is deleted once **12 calendar months** have passed since it was submitted (`createdAt`, UTC). A report becomes due exactly at that moment, never earlier. 29 February rolls forward to 1 March (see "Schedule").

**Mechanism:** the Render Cron Job `quran-heals-retention` runs `issue-reports:retention` once a month in database-backed mode (`--store mongo`). It is deliberately **not** a MongoDB TTL index on the reports, because a TTL index:
- deletes every existing report past the period the moment it is built, with no dry run;
- can't honour holds;
- is itself a production change to remove or adjust.

**Production status:** active on Render since the cut-over (October 2026). Before go-live, production `verify` passed with the restricted retention user: 5 reports, 0 due, 0 held, exact role, holds marker, audit, lock and fenced transaction all ok. The former Windows Task Scheduler setup is retired (see the end of this section).

**What the run reads and deletes:**
- It reads only `_id` and `createdAt` of reports, never a comment or an email.
- It deletes due reports by exact `_id`. The database delete itself also requires `createdAt` to be at least 365 days old, as a backstop.
- The report's embedded email-notification entry is part of the same document, so it goes with it.
- It never deletes held reports, or reports without a valid `createdAt`. It touches no other report data; the retention user can't anyway.

### How the cloud run works

A Render cron job has no persistent disk, so holds, audit history and the run lock live in three collections of `quranheals_prod`:

| Collection | Holds | Retention job may | Expiry |
|---|---|---|---|
| `retentionholds` | issue-report holds, plus the format marker `{_id: "meta", formatVersion: 1}` | `find` only. It can never place or lift a hold. | none; holds are released explicitly |
| `retentionaudit` | run history (`issue-reports-checked` / `purge-started` / `purged` / `failed:…` / `verified`), ids and counts only | `find`, `insert`. Append-only: it can't edit its own history. | `expiresAt` = 3 calendar years after the entry (leap days rolled forward), removed by the TTL index `expiresAt_ttl` |
| `retentionlocks` | one lease document `issue-report-retention`; lease times use the database server's clock | `find`, `insert`, `update`, `remove` | 15-minute lease. The deletion itself runs in a transaction that first re-checks and extends the lease. |

**Safeguards on every run:**
- the 12-calendar-month rule and the 365-day backstop;
- holds are loaded before classifying and re-read before deleting; if anything changed, nothing is deleted;
- at most **25** deletions per run (`--max-delete 25`). Above that, the run deletes nothing and fails, and the cleanup is then done interactively;
- the strict exact-role check on the database user (config/credentialScope.ts);
- unattended runs refuse after an unfinished earlier run.

**Failing safe.** Nothing is deleted when any of these is true:
- the holds marker is missing, or any hold is malformed;
- holds or audit can't be read;
- the "started" audit entry can't be written;
- another run holds a live lock;
- this run's lease was lost (checked inside the deletion's own transaction);
- an earlier run is unfinished (unattended runs only).

Two runners (the cron job, a manual run, any computer) can never both delete. A deletion commits only in the same transaction as a successful lease check on the lock document; a takeover makes that check fail, or the two writes conflict and one transaction aborts. This was tested against the real cluster on dev: a stale worker was fenced, and 0 of 15 takeover races committed twice.

**Audit entries** (`action: issue-report-retention`; ids and counts only, never content):
- `issue-reports-purge-started`: the run id and the ids about to be deleted;
- `issue-reports-purged`: the count verified by re-reading the ids afterwards;
- `failed:issue-report-purge`: what was and wasn't deleted;
- `issue-reports-checked`: a run with nothing due, so a quiet month is distinguishable from a missed run;
- `issue-reports-verified`: a `verify` check. It never counts as a cleanup run.

### Render Cron Job (primary scheduler)

| Setting | Value |
|---|---|
| Service | `quran-heals-retention` (separate from the API service) |
| Repository / branch / root | this repository, `main`, `backend` |
| Build command | `npm ci --include=dev && npm run build` |
| Command | `node dist/scripts/issueReportRetention.js purge --store mongo --apply --unattended --max-delete 25` |
| Schedule | `0 15 1 * *`: the 1st of each month at 15:00 UTC (10:00 Montreal time in winter, 11:00 in summer) |
| Instance / cost | Starter. Billed per second, with a $1/month minimum per cron job. |
| Notifications | Render email on failed runs |

Environment variables. The connection string is for **`quranheals-prod-retention`** only, never the API's `quranheals-prod` user:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24.21.0` (matches `.nvmrc` and CI) |
| `MONGODB_URI` | the retention user's connection string (secret) |
| `MONGODB_DB_NAME` | `quranheals_prod` |
| `MONGODB_ENFORCE_CREDENTIAL_SCOPE` | `true` |
| `QURAN_HEALS_SKIP_DOTENV` | `1` |
| `QURAN_HEALS_ADMIN_PROFILE` | `production-retention` |
| `QURAN_HEALS_CONFIRM_PRODUCTION_WRITE` | `quranheals_prod` |
| `SENTRY_DSN`, `RETENTION_CRON_MONITOR_SLUG` | optional but recommended. With both set, the scheduled run checks in with Sentry Crons (slug e.g. `quranheals-issue-report-retention`), and Sentry raises an issue when a run is **missed**, fails or runs over 30 minutes. The free plan includes 1 monitor. Create a Sentry alert rule on the tag `monitor.slug`. |
| `SESSION_JWT_SECRET` | a random value, unused by the job and not the API's secret (the config refuses production without one) |

**Exit codes of the scheduled run:**
- `0`: ok.
- `1`: refused. For example: more than 25 due, lock held, interrupted run, holds unavailable.
- `5`: deletion failed.
- `6`: ran, but the previous successful run was more than 35 days earlier (a missed month).

**How each kind of problem reaches you:**
- **A failed or refused run:** any non-zero exit is a failed Render run, which sends Render's failure email, and it is also an `error` check-in in Sentry if configured.
- **A run that never happens at all** (job suspended, deleted, or not triggered): only Sentry Crons can see it, as a **missed check-in** two hours after the scheduled time.
- **A missed month,** caught at the next successful run: exit 6 and a `status --store mongo` warning.

**Non-destructive check (any time):** `node dist/scripts/issueReportRetention.js verify --store mongo --max-delete 25`, run as the retention user. On Render, set it temporarily as the job's command and use "Trigger Run"; locally, use `prod-retention.env` (below). Without deleting anything, it:
- passes the strict exact-role check;
- loads holds (marker required) and reads the audit history;
- counts what is due;
- takes the lock, runs the fenced transaction with no ids, and releases it;
- appends one `issue-reports-verified` entry.

It exits **0** when the scheduled run would succeed, **6** when it would refuse, and **1** if any check fails.

### Administration from the owner's computer

**Admin folder** (outside the repository; access for your Windows account, SYSTEM and Administrators only):
`C:\Users\hamzalabib\OneDrive - McGill University\Documents\Personal\My App\QuranHealsAdmin`
**This is inside the McGill OneDrive**, against the recommendation to keep it outside: files there sync to the organization's cloud. See "Admin folder location" in `docs/account-deletion-requests.md`.

**Database users** (see `docs/backend-environments.md`):
- `quranheals-prod-audit`: read-only, profile `production-read`;
- `quranheals-prod-retention`: the job's exact role, profile `production-retention`;
- `quranheals-prod-holds`: `find`, `insert`, `update`, `remove` on `retentionholds` only, profile `production-holds`.

**Profiles,** each loaded with Node's `--env-file` (never `backend/.env`). Save them as UTF-8 without a byte-order mark:
- `prod-read.env`
- `prod-retention.env`
- `prod-holds.env`

Each sets:
```text
NODE_ENV=production
MONGODB_DB_NAME=quranheals_prod
MONGODB_URI=<that user's connection string>
MONGODB_ENFORCE_CREDENTIAL_SCOPE=true
QURAN_HEALS_SKIP_DOTENV=1
QURAN_HEALS_ADMIN_PROFILE=<production-read | production-retention | production-holds>
SESSION_JWT_SECRET=<any long random string; never Render's real secret>
```
In production the backend's config refuses to load without `SESSION_JWT_SECRET`; the admin scripts never sign or check session tokens.

**Commands (from `backend/`):**
```powershell
# The admin folder. Its path contains spaces: keep every argument below in double quotes.
$admin = 'C:\Users\hamzalabib\OneDrive - McGill University\Documents\Personal\My App\QuranHealsAdmin'

# Read-only: due / held counts and due ids, holds, TTL index, lock state, run history
npx tsx "--env-file=$admin\prod-read.env" src/scripts/issueReportRetention.ts preflight --store mongo
# Read-only: run history. Exit 6 = needs attention (missed, failed or interrupted run)
npx tsx "--env-file=$admin\prod-read.env" src/scripts/issueReportRetention.ts status --store mongo

# Holds (holds-admin user; writing commands need the production write confirmation)
$env:QURAN_HEALS_CONFIRM_PRODUCTION_WRITE = 'quranheals_prod'
npx tsx "--env-file=$admin\prod-holds.env" src/scripts/issueReportHolds.ts place --ref <report id> --reason dispute --review-by 2027-01-15
npx tsx "--env-file=$admin\prod-holds.env" src/scripts/issueReportHolds.ts release --ref <report id>
npx tsx "--env-file=$admin\prod-read.env"  src/scripts/issueReportHolds.ts list

# Non-destructive check as the retention user
npx tsx "--env-file=$admin\prod-retention.env" src/scripts/issueReportRetention.ts verify --store mongo --max-delete 25

# Manual (interactive) cleanup, e.g. when more than 25 are due or after an interrupted run:
# type "DELETE <n> FROM quranheals_prod" when asked. It shares the cron job's holds, audit and lock.
npx tsx "--env-file=$admin\prod-retention.env" src/scripts/issueReportRetention.ts purge --store mongo --apply
```
Holds follow the same rules everywhere: a listed reason (`legal-obligation`, `dispute` or `security-investigation`), a valid report id, and a review date at most 365 days away. `issueReportHolds.ts init` created the format marker once (2026-10-09); it is idempotent.

### Monthly checks (owner)

On the first working day of each month (see "Operator calendar"):
1. Check that the Render run on the 1st succeeded (Render → `quran-heals-retention` → Runs; Sentry Crons if configured).
2. Run `status --store mongo`; it should say `"ok": true`.
3. Run `preflight --store mongo` and review anything coming due soon. Place holds before the next run for anything that must be kept.
4. Do the Gmail review for `QH/Issue-report`.

### Recovery

- **A run stopped part-way** (crash, lost connection, container stopped):
  - `status --store mongo` lists it under `interruptedRuns`, and its `issue-reports-purge-started` entry lists the ids it meant to delete.
  - Run `preflight --store mongo`, then the manual cleanup above. It re-selects only reports that are still due, so it completes the earlier run, and its `issue-reports-purged` entry closes it.
  - Until then, the scheduled (unattended) run refuses.
- **The lock is held:** a crashed run's lease expires after 15 minutes and the next run takes it over. To clear it sooner, confirm no run is active (Render Runs page, no manual run), then delete the `issue-report-retention` document in `retentionlocks` from the Atlas UI.
- **More than 25 due:** the run deletes nothing and fails. Review the preflight, place any holds, then run the manual cleanup.
- **`failed:issue-report-purge`:** the entry says how many were deleted and lists the ids still present. Fix the cause (credentials, network, permissions), then run again.
- **Permission errors** ("not authorized", or the credential-scope refusal): check the users' roles against `docs/backend-environments.md`. Never work around it with a broader user.
- **Holds unavailable** (missing marker or malformed hold): nothing is deleted. Fix the entry with the holds command or the Atlas UI. Run `issueReportHolds.ts init` only if the marker is genuinely missing.

**Unresolved reports:** if a report older than 12 months is still needed, for example for an open security or content issue, place an `issue-report` hold before the monthly run. Otherwise it is deleted on schedule. Extract any non-personal technical detail you need into your own notes first.

**Notification jobs:** when issue-report email is enabled, each report carries a small `notification` entry (delivery state, attempt count, timestamps, error code, Resend email id; no content). It is part of the report document, so the cleanup removes it with the report, and it needs no cleanup of its own. A report deleted before its email went out is never emailed.

### Retired: Windows Task Scheduler and the local file mode

- **Windows scheduler retired.** From 2026-10-09 until the Render cut-over, two Windows scheduled tasks (`QuranHeals-IssueReport-Retention` and `QuranHeals-IssueReport-Retention-Alert`) ran the cleanup from the owner's computer. Both are **disabled**, and their wrapper scripts (`backend/scripts/windows/`) have been removed from the repository. The Render Cron Job is the only scheduler; never re-enable a local schedule alongside it.
- **Local history kept.** The admin folder keeps `holds.json`, `audit.jsonl` (two `issue-reports-checked` test entries from 2026-10-09, 0 deleted) and `logs\` as history. They are no longer read by production runs.
- **File mode is development-only.** The file mode of the script (`--holds <file> --audit-log <file>`, the default when `--store` is omitted) still exists for development and tests. It is **not** used in production:
  - the production retention user's role now includes the three retention collections, and file mode refuses it;
  - `holds.json` is no longer the authoritative holds list.

  Always use `--store mongo` against `quranheals_prod`.

## Issue-report notification emails

**Status:** built and tested locally; **off** until `ISSUE_REPORT_EMAIL=resend` is set on Render (needs approval). Operations: `docs/backend-operations.md`.

**What each email contains:** report ID, category, submission time (UTC), platform, app version, verse, emotion, app language, translation mode and the description, when present. The reporter's contact email is **never** included, only whether one was given. There are no reflections, tokens, passwords, keys, IPs or device IDs: reports don't hold them.

**Identifying them:** sender `Quran Heals <onboarding@resend.dev>`. The subject is `Quran Heals — New Issue Report [<report id>]`. The report ID makes every subject unique, so Gmail never groups two reports into one thread. Each email ends with `Retention: delete this email on or after <date>`.

**Retention:** 12 months from submission, the same as the database copy. The email arrives at, or a few hours after, submission (failed sends are retried for up to about 14 hours). Deleting by received date therefore never deletes early.

**Gmail filter (set up once):** see "Gmail filter" in `docs/backend-operations.md`. It applies `QH/Issue-report` and stops these emails going to Spam.

**Monthly review (manual), with the other Gmail steps below:**

1. Search `label:QH/Issue-report -label:QH/Hold before:YYYY/MM/DD`. Use **12 months before today, minus one day**: Gmail's `before:` uses your Gmail time zone, not UTC.
2. Spot-check the `delete on or after` line in a few results, then select all results and delete them. Each message is its own thread, so nothing newer is deleted with it.
3. Empty the Trash (the "Empty the Trash" step of the Gmail review below).

**Holds:** when an `issue-report` hold is placed (above), also label that report's email `QH/Hold`: search `subject:"<report id>"`. When the hold is released or expires, remove `QH/Hold`. The email is then deleted in the next monthly review if it is due.

**Deletion on request:** `account:admin-delete -- issue-reports` deletes database reports by the reporter's email, and prints a count only. The notification emails don't contain that address, so **find the report IDs first**, before the database deletion:

1. Use a read-only connection (Atlas Data Explorer with the read-only user, or `mongosh` with the read profile). Query `issuereports` with filter `{ "email": "<verified address>" }` and projection `{ "_id": 1 }`. Note the IDs in your private records only for this request.
2. Run the `issue-reports` deletion as described in `docs/account-deletion-requests.md`.
3. In Gmail, search `subject:"<report id>"` for each ID, delete those emails and empty the Trash.
4. If a report was never emailed (notifications were off when it was saved), there is nothing to delete in Gmail.

**Resend's copy:** Resend keeps sent-email content and logs for a provider-defined period (its pricing page lists 30 days on the free plan; **not verified**). Verify this in the Resend dashboard before enabling, and record it in the table above. No application mechanism deletes it.

## Support Gmail (quranheals.support@gmail.com)

Gmail is outside the backend. **Nothing in the application deletes Gmail messages**, and deleting a local verification case does not delete its Gmail thread.

**Labels.** Apply them when a thread first arrives:

| Label | Use | Retention clock |
|---|---|---|
| `QH/Deletion` | Every account-deletion request thread. The case ID (`DEL-YYYYMMDD-NN`) goes in the subject of every reply you send. | Starts when the request is **completed**: deletion done and confirmed, or the request closed (withdrawn, verification impossible, or no reply 30 days after the final notice). Delete the thread 60 days after that. |
| `QH/Support` | All other conversations | 12 months after the last message in the thread, from either side. A new message restarts the clock. |
| `QH/Issue-report` | Issue-report notification emails (applied by the Gmail filter) | 12 months after submission. Each message is its own thread. |
| `QH/Hold` | Threads under a preservation hold | Until the hold's review date |
| `QH/Open` | Unresolved threads | Never deleted while open; reassessed monthly |

**Monthly review (manual):**

1. **Deletion threads:** search `label:QH/Deletion -label:QH/Hold -label:QH/Open`. For each thread, look up the case's completion date in your private records. Delete the thread if 60 days have passed.
2. **Support threads:** search `label:QH/Support -label:QH/Hold -label:QH/Open before:<date 12 months ago>`. Gmail returns a thread if **any** message matches, so open each thread and check the date of its **last** message before deleting it.
3. **Issue-report notifications:** the steps under "Issue-report notification emails" above.
4. **Sent copies:** the verification-code email is part of the deletion thread, so it is deleted with it. Check `in:sent` for strays.
5. **Empty the Trash** after deleting (Gmail → Trash → "Empty Trash now"). Otherwise Gmail keeps deleted messages in the Trash for 30 days.
6. **Holds:** threads with `QH/Hold` past their review date are reassessed.

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
