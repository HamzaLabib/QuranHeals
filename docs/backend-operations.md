# Backend operations: hosting, health, monitoring

Production API: `https://quran-heals-api.onrender.com` (Render web service, Node, `backend/`). Database setup is in `docs/backend-environments.md`.

## Hosting checklist (Render dashboard)

Fill these in from the dashboard; they could not be read from the repo.

| Setting | Required for beta |
|---|---|
| Instance type | A **paid** instance (Starter or higher). Free web services spin down after ~15 min idle, and the next request waits for a cold start, longer than the app's 8s request timeout. |
| Region | Close to the Atlas cluster region |
| Branch / auto-deploy | `main`; auto-deploy only after CI passes (or manual) |
| Health check path | `/api/health` (below) |
| Environment | see `docs/backend-environments.md` |

## Health check: `GET /api/health`

- `200 {"success":true,"data":{"status":"ok","database":"connected","environment":"production","uptimeSeconds":N}}` when Express is up and MongoDB answers a ping.
- `503` with `"status":"degraded","database":"unavailable"` when the ping fails or takes over 2s.
- Status words only: never the database name, host, URI or error text.
- Subject to the API rate limit (120 requests/min per client IP); monitors polling every minute or slower are unaffected.

**Render:** Settings → Health Check Path → `/api/health`. Render treats any 2xx as healthy. A new deploy only goes live after it passes, so a deploy that can't reach MongoDB keeps the previous version serving. Render also restarts an instance that keeps failing at runtime; confirm the current timing in Render's docs or dashboard. A MongoDB outage therefore causes restarts but no false "healthy".

## Uptime monitoring

Use **Sentry Uptime Monitoring** (same vendor and alerts as error monitoring):

- Sentry → Alerts/Uptime → new uptime monitor for `https://quran-heals-api.onrender.com/api/health`.
- Method `GET`, interval 1 minute (or the plan's minimum), alert on non-2xx or timeout, notify the project owner by email.

If the Sentry plan doesn't include uptime monitors, use one free UptimeRobot HTTP(s) monitor on the same URL instead. Don't run both. The URL is public and carries no credentials.

## Error monitoring (Sentry, backend)

Enabled only when `SENTRY_DSN` is set (Render → Environment). Optional: `SENTRY_ENVIRONMENT` (default: `NODE_ENV`) and `SENTRY_RELEASE` (default: Render's `RENDER_GIT_COMMIT`). A DSN is a public ingestion key, but keep it out of the repo anyway. Startup logs `Error monitoring: enabled|disabled`.

**What is reported:**
- uncaught exceptions;
- unhandled promise rejections;
- unexpected request errors (500s, plus 5xx `AppError`s such as Apple being unreachable);
- startup failures.

Expected 4xx responses and malformed or oversized request bodies are not reported. API responses stay generic.

**What is never sent** (`backend/src/monitoring/monitoring.ts`, tested in `backend/tests/monitoring/`):
- No request headers (so no `Authorization`), bodies, cookies or query strings. `dataCollection` is all off, and the `RequestData` integration is excluded.
- No local variables, tracing, breadcrumbs (HTTP, console) or user info.
- `beforeSend` additionally scrubs messages, contexts and tags of:
  - bearer tokens, JWTs and refresh tokens;
  - Apple and Google ID tokens (JWTs);
  - Mongo URIs and PEM private keys;
  - emails;
  - long base64 blobs such as reflection ciphertext.
- Each event keeps the error type and message, the stack trace, environment, release, and the HTTP method and route pattern (for example `/api/sync/favorites/:verseKey`).

If Sentry is down or unreachable, events are dropped. Requests are unaffected, and shutdown waits at most 2s to flush.

**Database errors are never sent with their messages** (`backend/src/monitoring/errorSanitizer.ts`):
- **What gets replaced:** MongoDB, Mongoose and BSON errors (and any of them in a `cause` chain) have their message replaced by a summary built only from fixed identifiers:
  - class name, code and `codeName`;
  - index and field **names**;
  - schema path and model name.
- **Why:** duplicate-key values (provider subjects, emails), cast values (user ids) and rejected validator input never leave the process.
- **Other errors:** their messages are scrubbed with patterns for identifier keys (`"sub":…`, `userId=…`), Apple and Google subjects, ObjectIds, emails and tokens.
- **Fail closed:** if scrubbing fails, the event is dropped.
- **Server logs** (`describeError`, stack frames only) use the same summaries.
- **Tests:** `backend/tests/monitoring/sensitiveIdentifiers.test.ts`.

**Events stored before this change was deployed are not altered by it.**

To review them:
- In Sentry → Issues, filter on `error.type:MongoServerError`, `CastError`, `ValidationError` and `MongoBulkWriteError` across the retention window.
- Triage from the issue title and type only. Never open or copy the event data.
- Delete the matching issues.
- Record only the review date and the number deleted.

**Retention:** data is stored in the US region, on a Business trial plan. The event retention period is **not verified yet**; check it before publishing the legal pages (`docs/data-retention.md`).

## Logging

Render logs contain:
- startup lines (monitoring enabled/disabled, `environment=… database=…`, listening port);
- for unexpected errors: error name, scrubbed message and top stack frames only.

Never logged: request bodies, headers, tokens, connection strings, reflection content.

**Retention:** Render keeps service logs for 7 days (Hobby workspace, US West). This is provider-managed; there is no application cleanup.

## Issue-report email notifications

**Status: built, OFF.** Nothing is sent until `ISSUE_REPORT_EMAIL=resend` is set on Render (needs approval). Decided setup: Resend, sender `Quran Heals <onboarding@resend.dev>` (Resend's testing domain), recipient `quranheals.support@gmail.com`. Retention of the emails: `docs/data-retention.md`.

- **Flow:** `POST /api/issues` saves the report with a `notification` outbox entry in the same insert (`state: pending`). A worker inside the API process (`backend/src/notifications/issueReportNotifier.ts`) claims due jobs atomically and sends a plain-text email to `ISSUE_REPORT_EMAIL_TO` (default `quranheals.support@gmail.com`). It then records `accepted` or `failed`. The HTTP response doesn't depend on email: it is the same `201` whether the provider is up or not.
- **Accepted is not delivered:** `accepted` (and the log line `accepted by resend ... id=<Resend id>`) means Resend accepted the email for delivery. It does **not** prove the email reached the inbox. Delivery, bounces and suppression show only in the Resend dashboard (Emails → search the id) or in Gmail itself.
- **Retries:** at most 8 attempts, spaced 1 min, 5 min, 15 min, 1 h, 2 h, 4 h and 6 h (about 13.5 h in total). After that the job is `failed`.
  - **Retried:** timeouts, network errors, 408, 5xx, and these Resend errors: 409 `concurrent_idempotent_requests` (the same send is still in progress), 409 `resource_locked`, 429 `rate_limit_exceeded` and 429 `daily_quota_exceeded` (resets 00:00 UTC).
  - **Failed at once:** 409 `invalid_idempotent_request` (same key, different payload within 24 h; an earlier attempt may already have been accepted, so check the Resend dashboard), 429 `monthly_quota_exceeded`, and every other 4xx. That includes **403 `validation_error`**, which is what the `resend.dev` sender gets for any recipient other than the Resend account's own email address.
- **Duplicates:** every attempt for a report sends a byte-identical request: the same `Idempotency-Key: issue-report-notification/<report id>` and the same body, built only from stored report fields and configuration. Within Resend's 24-hour key window, a retry of an accepted send returns the original result and sends nothing new. Delivery is at least once and normally exactly once; exactly once is **not** guaranteed. Don't change `ISSUE_REPORT_EMAIL_FROM`/`_TO`, or deploy a change to the email format, while jobs are pending: their retries would get the payload-conflict 409 and fail.
- **Restarts and concurrency:** jobs are claimed with one atomic MongoDB update and a 2-minute lease, so two workers (for example, old and new instance during a deploy) never hold the same job. Pending jobs are sent when the next process starts. A job interrupted mid-send is re-claimed after its lease expires, with the same request.
- **Variables:** `ISSUE_REPORT_EMAIL` (`off` | `log` (development only) | `resend`), `RESEND_API_KEY`, `ISSUE_REPORT_EMAIL_FROM` and `ISSUE_REPORT_EMAIL_TO` (leave unset). If email is enabled but incomplete, startup stops with a message naming the variables, and Render keeps the previous deploy serving. Startup logs `Issue-report email: off|log|resend`.
- **Status:** `npm run issue-reports:notifications` (read-only). It prints the count per state (`pending`, `sending`, `accepted`, `failed`), how overdue the oldest active job is, and the ID, attempts and error code of each failed job, never content. In production, run it with the read profile (`npx tsx "--env-file=$admin\prod-read.env" src/scripts/issueReportNotificationStatus.ts`, with `$admin` set to the admin folder (`docs/data-retention.md`)); it refuses production without `QURAN_HEALS_SKIP_DOTENV=1`.
- **Logs and alerts:** Render logs `[issue-report-email]` lines with report ID, attempt, error code and Resend ID only. A permanent failure is also reported to Sentry as `IssueReportNotificationError` with the code.
- **Retention:** the outbox entry is part of the report, so the monthly `issue-reports:retention` purge removes it with the report.

### Resend account and API key (once; needs approval)

1. Sign up at resend.com **with quranheals.support@gmail.com**. The account email must be exactly the recipient, because `onboarding@resend.dev` can only deliver to the account's own address. Turn on two-factor authentication. Don't add a domain, and stay on the Free plan.
2. Check the data retention for the Free plan (Settings / Billing) and record it in `docs/data-retention.md`.
3. API Keys → Create two keys, both with **Sending access** (not Full access): `quran-heals-dev` and `quran-heals-prod`. Either one can then be revoked without touching the other.
4. A key is shown once. Paste it straight into its destination: the PowerShell session for development (below) and the Render environment for production. Never put it in the repository, a `.env` file inside OneDrive, a chat, an `EXPO_PUBLIC_` variable or the mobile app.
5. **Rotation:** create a new key, update its destination, then delete the old key in Resend.

### Gmail filter (once; needs approval)

1. In Gmail's search options, enter **From** `onboarding@resend.dev` and **Subject** `New Issue Report`, then choose **Create filter**.
2. Tick **Apply the label** → new label `QH/Issue-report` (nested under `QH`) and **Never send it to Spam**. Leave Skip the inbox, Delete and Forward unticked.
3. The first test email is the check: it must arrive in the inbox, labelled, and not in Spam.

### Development live test (needs approval; sends one real email)

From `backend/`, in a new PowerShell session (the key lives in this session only; dotenv never overrides a variable that is already set):

```powershell
$env:MONGODB_DB_NAME = 'quranheals_dev'
$env:ISSUE_REPORT_EMAIL = 'resend'
$env:ISSUE_REPORT_EMAIL_FROM = 'Quran Heals <onboarding@resend.dev>'
$env:RESEND_API_KEY = Read-Host 'Resend dev key'      # paste; not saved anywhere
npm run dev
```

1. Startup must show `Issue-report email: resend` and `database=quranheals_dev`.
2. In a second terminal, run `curl.exe -s -X POST http://localhost:4000/api/issues -H "Content-Type: application/json" -d '{\"category\":\"other\",\"comment\":\"DEV TEST - please ignore\",\"platform\":\"ios\",\"appVersion\":\"0.0.0-dev\"}'`. Expect `{"success":true,"data":null}`.
3. The server log shows `accepted by resend report=<id> attempt=1 id=<Resend id>`, and `npm run issue-reports:notifications` shows `accepted: 1`.
4. Resend dashboard → Emails: the email shows **Delivered**. In Gmail: it arrived, is labelled `QH/Issue-report`, isn't in Spam, and contains the expected fields and no contact email.
5. Stop the server and close the session (the key goes with it). Delete the test email in Gmail and empty the Trash. The dev report stays in `quranheals_dev` under normal dev retention.

### Production activation (needs approval)

Prerequisites: the development test passed; Resend's retention is recorded; the Gmail filter exists; the code is committed and deployed through the normal approval.

1. Deploy with `ISSUE_REPORT_EMAIL` unset. Logs show `Issue-report email: off` and `GET /api/health` is 200. The first start builds one small partial index on `issuereports` (`notification.nextAttemptAt`).
2. Render → Environment: add `RESEND_API_KEY` (prod key), `ISSUE_REPORT_EMAIL_FROM=Quran Heals <onboarding@resend.dev>`, then `ISSUE_REPORT_EMAIL=resend`. Leave `ISSUE_REPORT_EMAIL_TO` unset. Save, which redeploys.
3. Logs show `Issue-report email: resend`. If startup reports `Issue-report email is misconfigured: ...`, the previous deploy keeps serving; fix the named variable.
4. Submit one report from the production app (Settings → Report an Issue) with the comment `PROD TEST - please ignore`.
5. Confirm all of:
   - Render logs show the `accepted by resend` line;
   - Resend shows the email as **Delivered**;
   - it is in Gmail, labelled `QH/Issue-report`;
   - the read-profile status shows `accepted` ≥ 1 and `failed: 0`.
6. Ongoing:
   - Sentry alert on `IssueReportNotificationError`;
   - status command in the monthly review (`failed` should be 0, `oldestActiveOverdueMinutes` small);
   - Resend dashboard for bounces;
   - the Free plan's 100 emails/day and 3,000/month.
7. **Rollback:** set `ISSUE_REPORT_EMAIL=off`. Reports keep saving, and jobs already queued stay `pending` until email is turned back on.

## Data retention and deletion operations

The schedule, holds and operator calendar are in `docs/data-retention.md`:
- weekly verification-case `prune`;
- monthly `issue-reports:retention` (`status`, `preflight`, `purge --apply`) and Gmail review;
- yearly `audit-prune`.

Email deletion requests are handled with `docs/account-deletion-requests.md`. Both tools run only from the owner's machine, never on Render.
- **Account deletion tool:** disabled for production in code.
- **Issue-report retention:** supports production behind its profile, least-privilege user and confirmation checks. It has not run in production yet; the setup is in `docs/data-retention.md`.

## Rate limits

`backend/src/middleware/rateLimits.ts`, in memory per process (the service runs as one instance; a second instance would need a shared store such as Redis before scaling out). All limits answer `429 {"success":false,"message":"Too many requests. Please try again later."}` with `Retry-After` and `RateLimit-*` headers. IPv6 clients are grouped per /56.

| Limit | Scope | Applies to |
|---|---|---|
| 120 / minute | per IP | every request (unchanged) |
| 10 / hour | per IP | `POST /api/issues` |
| 30 / 15 min | per IP | `POST /api/auth/google`, `POST /api/auth/apple` (shared) |
| 120 / 15 min | per IP | `POST /api/auth/refresh`, `POST /api/auth/logout` (shared) |
| 10 / hour | per account | `DELETE /api/account`, `POST /api/sync/reflections/reset` (shared; after authentication) |

The app signs a user out only on a `401` from refresh, never on a `429`. Tune the numbers in that file if real traffic shows false positives.

### Client IPs on Render (verify before enabling endpoint limits)

Per-IP limits use `req.ip`, which Express derives from `X-Forwarded-For` using `TRUST_PROXY_HOPS` (default `1`, the value the app has always used). It must equal the real number of proxies in front of the app:

- **too low**: `req.ip` is a Render proxy address, so many users share one bucket (this already applies to the long-standing global limit);
- **too high**: `req.ip` comes from the part of the header the client controls, so anyone can pick their own IP and evade limits.

Community reports suggest Render adds more than one hop and appends to (does not replace) a client-supplied `X-Forwarded-For`; this is not confirmed. **Endpoint limits are therefore off unless `ENDPOINT_RATE_LIMITS=on`** (the default is `off`, so deploying never enables them early). The global limit is unchanged.

The diagnostic (`CLIENT_IP_DIAGNOSTICS=true`) never logs a real address: each address appears only as its kind (`public`, `private`, `loopback`, `invalid`) plus an 8-character keyed hash that is random per process (not reversible, not comparable across restarts). Only RFC 5737 documentation addresses such as the marker `192.0.2.1` are shown as written. It logs only `GET /api/health` requests that carry `X-Quran-Heals-IP-Check: 1`.

**Procedure** (changes Render environment variables; needs approval):

1. In Render → Environment, set `CLIENT_IP_DIAGNOSTICS=true` and leave `ENDPOINT_RATE_LIMITS` unset (or `off`) and `TRUST_PROXY_HOPS` unset (`1`). Save, wait for the redeploy, and check `GET /api/health` returns 200.
2. From a normal connection (no VPN or corporate proxy), run:

   ```text
   curl -s https://quran-heals-api.onrender.com/api/health -H "X-Quran-Heals-IP-Check: 1" -H "X-Forwarded-For: 192.0.2.1"
   ```
3. In Render → Logs, find the line starting `[client-ip-check]`, for example:

   ```text
   [client-ip-check] assessment=too-low (…) trustProxyHops=1 suggestedTrustProxyHops=3 entries=4 chain=[doc:192.0.2.1, public#1a2b3c4d, public#…, private#…] socket=private#… req.ip=private#…
   ```

   - `chain` must start with `doc:192.0.2.1` (your marker). If it does not, the proxy replaced the header instead of appending: stop and report back (the formula below would not apply).
   - The entry right after the marker is the address Render saw connecting (you). `suggestedTrustProxyHops` is the number of entries from that one to the end.
4. Set `TRUST_PROXY_HOPS` to `suggestedTrustProxyHops`, redeploy, and repeat step 2. The line must now say `assessment=correct`, and `req.ip` must have the same hash as the entry right after the marker.
5. Spoofing check: repeat step 2 with `-H "X-Forwarded-For: 192.0.2.1, 198.51.100.7"`. `req.ip` must still be the hash right after the documentation entries, never `doc:198.51.100.7`. (`too-high` in any run means the hop count is too large.)
6. Consistency check: repeat step 2 from a second network (for example phone data). `suggestedTrustProxyHops` must be the same, and `req.ip` must show a different `public#…` hash.
7. Set `CLIENT_IP_DIAGNOSTICS` back to unset. Then set `ENDPOINT_RATE_LIMITS=on`, redeploy, and confirm normal use: sign in, refresh after 20+ minutes, sync, and submit one issue report, with no `429`.

**Rollback:** set `ENDPOINT_RATE_LIMITS=off` (instant, no code change). Recheck after any Render networking change (custom domain, CDN, region move). Counters are in memory per instance: a restart resets them, and more than one instance would split them (move to a shared store such as Redis first).

## Which mappings the API serves

`GET /api/ayahs/random` selects only from `emotionversemappings`:

- `NODE_ENV=production`: `approved` mappings only.
- `development` / `test`: `approved`, `reviewed` and `development`, so editors can preview work in progress on `quranheals_dev`.
- `draft` and `rejected` are never served (KEEP/REJECT/HOLD are review outcomes; HOLD rows are never inserted).

An emotion with no servable mapping returns `404 "No ayahs found for this emotion yet."`. `GET /api/ayahs/:verseKey` resolves any valid verse from the verified SQLite corpus and lists only servable mappings' emotions. See `userVisibleMappingStatuses` in `backend/src/services/MongooseQuranRepository.ts`.

Before deploying a change to this logic, run the read-only check against production (with the read-only audit user; see `docs/backend-environments.md`):

```text
NODE_ENV=production MONGODB_DB_NAME=quranheals_prod MONGODB_URI=<audit user URI> npm run mapping:visibility-audit
```

It prints per-emotion counts by status and exits non-zero if any active emotion has no approved mapping.

## Legacy `ayahs` collection

The original MVP seed (16 documents with their own `emotions` arrays) is **no longer read by the API** (October 2026, D11). It was a fallback for random selection, which could serve emotion pairings that never went through editorial review. Every verse in it still resolves by verseKey from the verified corpus, so saved favorites and history are unaffected (they store verseKeys; the API has rejected ObjectId ids since the verseKey migration).

The collection is intentionally left in place. Options, each requiring explicit approval before touching production:

1. **Keep as is** (no cost; nothing reads it). The seed and foundation-migration scripts still use it on development databases.
2. **Archive**: `mongodump --db=quranheals_prod --collection=ayahs`, store the dump with the other backups, then drop the collection in a later maintenance window.
3. Before either, `npm run mapping:visibility-audit` reports `legacyPairsWithoutApprovedMapping`: legacy pairings no approved mapping covers. Those are what a user could previously have reached only through the removed fallback; review them editorially if any matter.

## Mobile

Mobile crash reporting (`@sentry/react-native`) is a native dependency: it needs a config plugin, a new native build and source-map upload in EAS. It's deliberately left for a later step.
