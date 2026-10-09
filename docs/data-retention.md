# Data retention (operator procedure)

Approved retention periods, how each one is enforced, and who does what. The legal pages must match this file. Do not describe a rule as operational in a legal page until its "Status" below says **verified in production**.

## Schedule

| Data | Retention | Mechanism | Status |
|---|---|---|---|
| Account data (users, sessions, favorites, preferences, reflections, sync key, Apple token) | Until the account is deleted | In-app deletion, or the email procedure (`docs/account-deletion-requests.md`) | In-app: operational. Email procedure: development only. |
| Issue reports (database) | 12 calendar months from submission | `npm run issue-reports:retention`, run monthly | Implemented, tested and rehearsed in development; production supported in code. **No production run yet:** it needs the retention user and profiles below, and approval. |
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
| Monthly (first working day) | `issue-reports:retention -- status`, `preflight`, then `purge --apply`, then `status` again (see Issue reports below). Gmail review (below). Check holds that are due for review. |
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

**Rule:** a report is deleted once **12 calendar months** have passed since it was submitted (`createdAt`, UTC). A report becomes due exactly at that moment, never earlier. 29 February rolls forward to 1 March (see "Schedule").

**Mechanism:** `npm run issue-reports:retention`, run monthly from the owner's computer. It is deliberately **not** a MongoDB TTL index, because a TTL index:
- deletes every existing report past the period the moment it is built, with no dry run;
- can't honour holds;
- is itself a production change to remove or adjust.

**Production status:**
- The code supports production (`ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED = true`), but it still needs every check below.
- **No production run has happened yet.** The first one needs the setup below and your approval.
- Development rehearsal on 2026-10-09 against `quranheals_dev`: the due report was deleted with its notification entry, the held and not-yet-due reports were kept, no other collection was touched, and a repeat run deleted nothing.

**What the script reads and deletes:**
- It reads only `_id` and `createdAt`, never a comment or an email.
- It deletes due reports by exact `_id`. The database delete itself also requires `createdAt` to be at least 365 days old, as a backstop.
- The report's embedded email-notification entry is part of the same document, so it goes with it.
- It never deletes held reports, or reports without a valid `createdAt`. It touches no other collection; the production user can't anyway.

### One-time setup (production)

1. **Admin folder:** outside the repository, with access for your Windows account, SYSTEM and Administrators only (NTFS permissions as in `docs/account-deletion-requests.md`). Current location (since 2026-10-09):
   `C:\Users\hamzalabib\OneDrive - McGill University\Documents\Personal\My App\QuranHealsAdmin`
   **This is inside the McGill OneDrive**, against the recommendation to keep it outside: files there sync to the organization's cloud, and deleted holds or audit lines can survive in OneDrive's version history and recycle bin. See "Admin folder location" in `docs/account-deletion-requests.md`.
2. **Holds file:** create it once, empty, as UTF-8 **without** a byte-order mark: `[IO.File]::WriteAllText("$admin\holds.json", '{"formatVersion":1,"holds":{}}')`. Windows PowerShell's `Set-Content -Encoding utf8` adds a BOM, and the tool then refuses the file. The same applies to the `.env` profiles: in Notepad, save them as "UTF-8", not "UTF-8 with BOM". Every run requires this file to exist and be valid, so a mistyped path stops the run instead of meaning "no holds".
3. **Retention database user** in Atlas (Database Access). It has its own role, separate from the account-deletion user, because the purge refuses any user that can do more than this:
   - Custom role `quranheals-issue-report-retention`: actions `find` and `remove` on database `quranheals_prod`, collection `issuereports`. Nothing else: no other collection, no insert or update, no index or database-wide actions.
   - User `quranheals-prod-retention` with only that role. Use a generated password, and restrict access to your IP in Network Access if possible.
4. **Profiles** in the admin folder, each loaded with Node's `--env-file` (never `backend/.env`). In production the backend's config refuses to load without `SESSION_JWT_SECRET`. The admin scripts never sign or check session tokens, so use a **random local value**, never Render's real secret:

   `prod-read.env` (already described for account deletion; read-only user):
   ```text
   NODE_ENV=production
   MONGODB_DB_NAME=quranheals_prod
   MONGODB_URI=<quranheals-prod-audit connection string>
   MONGODB_ENFORCE_CREDENTIAL_SCOPE=true
   QURAN_HEALS_SKIP_DOTENV=1
   QURAN_HEALS_ADMIN_PROFILE=production-read
   SESSION_JWT_SECRET=<any long random string from a password manager; never Render's real secret>
   ```
   `prod-retention.env` (deletes issue reports only):
   ```text
   NODE_ENV=production
   MONGODB_DB_NAME=quranheals_prod
   MONGODB_URI=<quranheals-prod-retention connection string>
   MONGODB_ENFORCE_CREDENTIAL_SCOPE=true
   QURAN_HEALS_SKIP_DOTENV=1
   QURAN_HEALS_ADMIN_PROFILE=production-retention
   SESSION_JWT_SECRET=<any long random string from a password manager; never Render's real secret>
   ```
5. **Audit log:** `audit.jsonl` in the admin folder, the same file as the deletion tool, kept for 3 years per entry.

### Commands (from `backend/`)

```powershell
# The admin folder. Its path contains spaces: keep every argument below in double quotes.
$admin = 'C:\Users\hamzalabib\OneDrive - McGill University\Documents\Personal\My App\QuranHealsAdmin'

# 1. Read-only preflight: totals, cutoff, due / held / not-yet-due counts, and the due report ids
npx tsx "--env-file=$admin\prod-read.env" src/scripts/issueReportRetention.ts preflight --holds "$admin\holds.json"

# 2. Cleanup (interactive): type "DELETE <n> FROM quranheals_prod" when asked
$env:QURAN_HEALS_CONFIRM_PRODUCTION_WRITE = 'quranheals_prod'
npx tsx "--env-file=$admin\prod-retention.env" src/scripts/issueReportRetention.ts purge --holds "$admin\holds.json" --audit-log "$admin\audit.jsonl" --apply

# 3. Status (no database): last run, days since the last success, failed or interrupted runs. Exit code 6 = needs attention.
npx tsx src/scripts/issueReportRetention.ts status --audit-log "$admin\audit.jsonl"
```

**Every production run is refused unless all of these hold:**
- the env profile is loaded (`QURAN_HEALS_SKIP_DOTENV=1`);
- the admin profile matches the step (`production-read` to look, `production-retention` to delete);
- the connected user passes the strict credential check;
- for deleting: `QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod`, plus the typed confirmation naming both the count and the database.

After the confirmation, holds and eligibility are read again; if anything changed, nothing is deleted. Only one deleting run can happen at a time, enforced by `audit.jsonl.retention-run.lock`.

**Audit entries** (`action: issue-report-retention`; ids and counts only, never content):
- `issue-reports-purge-started`: the run id and the ids about to be deleted;
- `issue-reports-purged`: the count verified by re-reading the ids afterwards;
- `failed:issue-report-purge`: what was and wasn't deleted;
- `issue-reports-checked`: an `--apply` run with nothing due, so a quiet month is distinguishable from a missed run.

### Monthly operation and monitoring

On the first working day of each month (see "Operator calendar"):
1. Run `status`, then the preflight, and check the due ids.
2. Place holds for anything that must be kept.
3. Run the cleanup.
4. Run `status` again (it should say `"ok": true`), then do the Gmail review for `QH/Issue-report`.

`status` flags:
- no successful run in more than 35 days (a missed month);
- a last run that failed;
- a run that started deleting and never recorded its result.

**Scheduling (Windows Task Scheduler on the owner's computer): active since 2026-10-09 with `-MaxDelete 25`. The first deletion-enabled run is 2026-11-01 10:00.**

| Task | Does | Runs as |
|---|---|---|
| `QuranHeals-IssueReport-Retention` | On the 1st of each month at 10:00, runs `backend/scripts/windows/issue-report-retention-task.ps1 -AdminDir <admin folder> -MaxDelete <n>`. That script runs `purge --apply --unattended --max-delete <n>` with `prod-retention.env`, then `status`. | Your account. "Run only when logged on" until it is re-registered with the S4U logon type ("run whether logged on or not, without storing a password"), which needs an elevated PowerShell. |
| `QuranHeals-IssueReport-Retention-Alert` | At logon and daily at 11:00, shows a message box if `RETENTION-NEEDS-ATTENTION.txt` exists in the admin folder. Reads only that file. | Your account (interactive) |

**What the wrapper adds** (every deletion safeguard stays in the retention script):
- `QURAN_HEALS_SKIP_DOTENV=1` and `QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod`, for its own process only, never written to a profile;
- a log per run in `<admin folder>\logs\retention-<UTC time>.log`, containing ids and counts only, removed after 400 days;
- `RETENTION-NEEDS-ATTENTION.txt` on any non-zero exit, refusal or `status` warning, cleared by the next clean run;
- a non-zero exit code for Task Scheduler's "Last Run Result".

**Task settings:**
- a second start while a run is active is ignored, and the script's own lock is a second layer;
- a missed start runs as soon as the computer is available;
- it runs on battery and only with a network connection;
- each run is stopped after 30 minutes.

**`-MaxDelete`:**
- `0` can never delete: with anything due the run refuses and raises the alert, and with nothing due it records `issue-reports-checked`. It was tested this way on 2026-10-09 from Task Scheduler against production: 5 reports, 0 due, `LastTaskResult 0`, one `issue-reports-checked` audit entry, a second start ignored.
- Production uses **25** (approved 2026-10-09). A month with more than 25 due deletes nothing, raises the alert, and is handled with an interactive run.

**Limitation:** the computer must be on, and until S4U is set up you must be logged on. A missed month shows up in `status` and the alert, and is caught up by the next start.

### Cloud run (Render Cron Job): `--store mongo`

**Status:** implemented and rehearsed on `quranheals_dev` (2026-10-09). **Not set up in production yet**: Atlas changes, the Render cron job and the cut-over each need approval. Until cut-over, the Windows task above stays the only scheduler that deletes.

A Render cron job has no persistent disk, so in `--store mongo` mode holds, audit history and the run lock live in three collections of `quranheals_prod`. Every safeguard above still applies:
- the 12-calendar-month rule and the 365-day backstop;
- the re-check before deleting;
- the `--max-delete` limit;
- the refusal after an interrupted run;
- the strict credential check.

| Collection | Holds | Retention job may | Expiry |
|---|---|---|---|
| `retentionholds` | issue-report holds, plus the format marker `{_id: "meta", formatVersion: 1}` | `find` only. It can never place or lift a hold. | none; holds are released explicitly |
| `retentionaudit` | run history (`issue-reports-checked` / `purge-started` / `purged` / `failed:…`), ids and counts only | `find`, `insert`. Append-only: it can't edit its own history. | `expiresAt` = 3 calendar years after the entry (leap days rolled forward), removed by a TTL index |
| `retentionlocks` | one lease document `issue-report-retention`; lease times use the database server's clock | `find`, `insert`, `update`, `remove` | 15-minute lease. The deletion itself runs in a transaction that first re-checks and extends the lease. |

**Failing safe.** Nothing is deleted when any of these is true:
- the holds marker is missing, or any hold is malformed;
- holds or audit can't be read;
- the "started" audit entry can't be written;
- another run holds a live lock;
- this run's lease was lost (checked inside the deletion's own transaction, so a stalled worker can never commit a deletion after another run took over).
- an earlier run is unfinished (unattended runs only).

Two runners can never both delete: a deletion commits only in the same transaction as a successful lease check on the lock document. A takeover makes that check fail, or the two writes conflict and one transaction aborts. Tested against the real cluster on dev (stale worker fenced; 0 of 15 takeover races committed twice). The deletion is also limited to exact due ids with the age backstop.

**Holds** (holds-admin user, `production-holds` profile; listing uses `production-read`):
```powershell
npx tsx "--env-file=$admin\prod-holds.env" src/scripts/issueReportHolds.ts init          # once
npx tsx "--env-file=$admin\prod-holds.env" src/scripts/issueReportHolds.ts place --ref <report id> --reason dispute --review-by 2027-01-15
npx tsx "--env-file=$admin\prod-holds.env" src/scripts/issueReportHolds.ts release --ref <report id>
npx tsx "--env-file=$admin\prod-read.env"  src/scripts/issueReportHolds.ts list
```
Writing commands also need `$env:QURAN_HEALS_CONFIRM_PRODUCTION_WRITE = 'quranheals_prod'`. The same rules as file holds apply: a listed reason, a valid report id, and a review date at most 365 days away.

**Checks from your computer** (read-only profile):
```powershell
npx tsx "--env-file=$admin\prod-read.env" src/scripts/issueReportRetention.ts preflight --store mongo   # due/held counts, holds, TTL index, lock, history
npx tsx "--env-file=$admin\prod-read.env" src/scripts/issueReportRetention.ts status --store mongo      # exit 6 = needs attention
```

**Render Cron Job** (`quran-heals-retention`, separate from the API service):

| Setting | Value |
|---|---|
| Repository / branch / root | this repository, `main`, `backend` |
| Build command | `npm ci --include=dev && npm run build` |
| Command | `node dist/scripts/issueReportRetention.js purge --store mongo --apply --unattended --max-delete 25` |
| Schedule | `0 15 1 * *`: the 1st of each month at 15:00 UTC, which is 10:00 Montreal time in winter (EST) and 11:00 in summer (EDT) |
| Instance / cost | Starter. Billed per second, with a $1/month minimum per cron job. |
| Notifications | Render → workspace / service notifications: email on failed runs |

Environment variables. The connection string is for **`quranheals-prod-retention`** only, never the API's `quranheals-prod` user:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | the retention user's connection string (secret) |
| `MONGODB_DB_NAME` | `quranheals_prod` |
| `MONGODB_ENFORCE_CREDENTIAL_SCOPE` | `true` |
| `QURAN_HEALS_SKIP_DOTENV` | `1` |
| `QURAN_HEALS_ADMIN_PROFILE` | `production-retention` |
| `QURAN_HEALS_CONFIRM_PRODUCTION_WRITE` | `quranheals_prod` |
| `SENTRY_DSN`, `RETENTION_CRON_MONITOR_SLUG` | optional but recommended. With both set, the scheduled run checks in with Sentry Crons (slug e.g. `quranheals-issue-report-retention`), and Sentry raises an issue when a run is **missed**, fails or runs over 30 minutes. The free plan includes 1 monitor. Create a Sentry alert rule on the tag `monitor.slug`. |
| `SESSION_JWT_SECRET` | a random value, unused by the job and not the API's secret (the config refuses production without one) |

**Non-destructive check (before go-live, and any time):** `node dist/scripts/issueReportRetention.js verify --store mongo --max-delete 25`, run as the retention user (Render: temporarily set it as the job's command and "Trigger Run", or run it locally with `prod-retention.env`). Without deleting anything, it:
- passes the strict exact-role check;
- loads holds (marker required) and reads the audit history;
- counts what is due;
- takes the lock, runs the fenced transaction with no ids, and releases it;
- appends one `issue-reports-verified` audit entry.

`verify` entries never count as cleanup runs, so they can't hide a missed month. It exits **0** when the scheduled run would succeed, **6** when it would refuse (more than `--max-delete` due, or an unfinished earlier run), and **1** if any check fails.

**Exit codes of the scheduled run, and how they reach you:**
- `0`: ok.
- `1`: refused. For example: more than 25 due, lock held, interrupted run, holds unavailable.
- `5`: deletion failed.
- `6`: ran, but the previous successful run was more than 35 days earlier (a missed month).

**How each kind of problem reaches you:**
- **A failed or refused run:** any non-zero exit is a failed Render run, which sends Render's failure email, and it is also an `error` check-in in Sentry.
- **A run that never happens at all** (job suspended, deleted, or not triggered): only Sentry Crons can see it, as a **missed check-in** two hours after the scheduled time.
- **A missed month,** caught at the next successful run: exit 6 and a `status --store mongo` warning.

**Lock recovery:** a crashed run's lock expires after 15 minutes and the next run takes it over. To clear it sooner, delete the `issue-report-retention` document in `retentionlocks` from the Atlas UI after confirming no run is active.

### Recovery

- **A run stopped part-way** (crash, lost connection, closed terminal):
  - `status` lists it under `interruptedRuns`, and its `issue-reports-purge-started` entry lists the ids it meant to delete.
  - Run the preflight, then the cleanup again. It re-selects only reports that are still due, so it completes the earlier run, and its `issue-reports-purged` entry closes it.
  - Unattended runs refuse until this has been done by hand.
- **The lock file `audit.jsonl.retention-run.lock` exists:** check that no other run is active (Task Scheduler, another terminal). Then delete the `.lock` file and run again.
- **`failed:issue-report-purge`:** the entry says how many were deleted and lists the ids still present. Fix the cause (credentials, network, permissions), then run again.
- **Permission errors** ("not authorized", or the credential-scope refusal): check the `quranheals-prod-retention` role against step 3 of the setup. Never work around it with a broader user.

**Unresolved reports:** if a report older than 12 months is still needed, for example for an open security or content issue, place an `issue-report` hold before the monthly purge. Otherwise it is deleted on schedule. Extract any non-personal technical detail you need into your own notes first.

**Notification jobs:** when issue-report email is enabled, each report carries a small `notification` entry (delivery state, attempt count, timestamps, error code, Resend email id; no content). It is part of the report document, so the purge above removes it with the report, and it needs no cleanup of its own. A report deleted before its email went out is never emailed.

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
