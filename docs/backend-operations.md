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

## Logging

Render logs contain:
- startup lines (monitoring enabled/disabled, `environment=… database=…`, listening port);
- for unexpected errors: error name, scrubbed message and top stack frames only.

Never logged: request bodies, headers, tokens, connection strings, reflection content.

## Mobile

Mobile crash reporting (`@sentry/react-native`) is a native dependency: it needs a config plugin, a new native build and source-map upload in EAS. It's deliberately left for a later step.
