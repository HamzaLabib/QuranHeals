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

### Client IPs on Render (verify before relying on per-IP limits)

Per-IP limits use `req.ip`, which Express derives from `X-Forwarded-For` using `TRUST_PROXY_HOPS` (default `1`, the value the app has always used). It must equal the real number of proxies in front of the app:

- **too low**: `req.ip` is a Render proxy address, so many users share one bucket and the endpoint limits could throttle everyone at once (this already applied to the old global limit);
- **too high**: `req.ip` comes from a part of the header the client controls, so limits can be evaded.

Community reports suggest Render may add more than one hop and appends to (rather than replaces) a client-supplied `X-Forwarded-For`, but this is not confirmed. **Status: pending verification.** Safe procedure:

1. Deploy with `ENDPOINT_RATE_LIMITS=off` and `CLIENT_IP_DIAGNOSTICS=true` (the global limit stays as it always was).
2. Find your own public IP (for example `curl https://api.ipify.org`), then send:

   ```text
   curl -s https://quran-heals-api.onrender.com/api/health -H "X-Quran-Heals-IP-Check: 1" -H "X-Forwarded-For: 192.0.2.1"
   ```
3. In the Render logs, find the `[client-ip-check] x-forwarded-for="…"` line. The list reads `192.0.2.1` (your fake entry), then your real IP, then any proxies. Set `TRUST_PROXY_HOPS` to the number of entries from your real IP to the end of the list, inclusive (for example `192.0.2.1, <you>, <proxy>` → `2`).
4. Redeploy with that value and repeat step 2: the logged `req.ip` must be your real IP, never `192.0.2.1` and never a proxy address.
5. Set `CLIENT_IP_DIAGNOSTICS` back to unset (it logs IP addresses) and `ENDPOINT_RATE_LIMITS=on`.

Recheck after any Render networking change (custom domain, CDN, region move). Counters are in memory: a restart resets them, and running more than one instance would split them per instance (move to a shared store such as Redis first).

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
