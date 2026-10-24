# Cloud audio review dashboard (Phase 4.8.2)

**What it is:** the local audio review dashboard (`review/dashboard` + `review/manual`), hosted privately, so authorised
reviewers can review from any computer, at any time, while the owner's computer is off.
- **The same review:** the same pages, the same blind two-reviewer and partial-submission rules, and the same views.
- **Accounts:** Google Sign-In accounts replace typed names.
- **Storage:** PostgreSQL replaces the local log files.

It is a **separate** Render web service with its **own** database. It never touches, restarts or depends on the
production Quran Heals API or its MongoDB.

**Nothing has been deployed.** Deploying needs the owner's approval of the costs and the steps below.

## Architecture

```
reviewer's browser ── HTTPS ──> Render web service "quran-heals-audio-review" (Docker, Starter, always on)
   │                               │  server.mjs: Google sign-in check, sessions, review rules, views, imports
   │                               │  pg-store.mjs ── private network ──> Render PostgreSQL "quran-heals-audio-review-db"
   │                               │                                      (append-only review log, accounts, recordings)
   │                               └─ audio.mjs: one-byte source checks; waveforms (peaks.py); VBR decode (temporary)
   └── plays CBR audio directly from the ORIGINAL provider (cdn.mp3quran.net, archive.org, media.way2quran.com)
```

| Concern | How |
|---|---|
| Always on, recovery | Render Starter instance (never sleeps). Render restarts a failed process, and the `/healthz` health check (it pings the database) gates every deploy. Deploys are manual (`autoDeploy: false`). |
| Persistent storage | Render PostgreSQL. Nothing irreplaceable is on the web service's disk: it holds only a temporary VBR decode cache. |
| Review log | `review_events`: every event is the exact JSON line that was hashed, so its chain can be re-verified byte for byte. A database trigger makes the table **append-only** for every user (UPDATE, DELETE and TRUNCATE are refused). |
| Concurrency | Each append is one transaction holding a per-recording advisory lock. It re-checks the last stored event, then validates the event with the review rules and inserts it; the primary key `(recording, seq)` and the unique hash are the final guard. Reviewers' autosaves never overwrite each other (an event changes only its author's work), and a double submission is refused by the rules. |
| Accounts | Google Sign-In, verified on the server with Google's official `google-auth-library` (the same approach as the production backend). There are no passwords. Only accounts the administrator created can sign in; the first sign-in binds the account to its Google identity. |
| Sessions | A random 256-bit token in an `HttpOnly; Secure; SameSite=Lax` cookie; the database keeps only its SHA-256. A session ends at sign-out, after 12 h idle or 7 days, and **at once** when the account is deactivated. |
| Reviewer identity | The name recorded in every event comes from the signed-in account; the browser cannot choose it, and impersonation was tested. Names already in the logs are reserved: an account receives one only through an explicit **identity link**, which stores the evidence. Old events are never rewritten. |
| Blind review | The review rules of `manual-lib.mjs`, unchanged: the other reviewer's times are never sent until both have submitted that ayah. Administration does not bypass this (no admin page or API shows placements). |
| Audio | See "Audio" below; nothing is mirrored. |
| Imports | Administrator only (an admin session, or the CLI token). Every recording is validated. Review events can **only** come from the migration. |
| Backups | Render's managed PostgreSQL backups, plus logical backups from the CLI (hash-manifested, chain-checked, restorable only into an empty database). |

### Audio (no recording is uploaded or redistributed)

Checked 2026-10-19 (`migrate.mjs source-check`): **all 801 recordings are served by their original providers** with
byte ranges and the exact reviewed size (MP3Quran 758, of which 18 are the Rifaat files; archive.org 24; Way2Quran 1).
So nothing needs to be stored in the cloud.

**Opening a recording:**
1. The server sends a one-byte range request to the provider, which must still serve the reviewed size. If not, the task stays listed and its audio is labelled unavailable, with the reason.
2. **CBR (769):** `/audio/<key>` redirects the signed-in reviewer to the original URL. The browser plays it as the app does.
3. **VBR (32):** browsers cannot seek VBR exactly. The server reads the original from its provider into temporary disk, decodes it losslessly to PCM (`peaks.py --pcm`), and streams that to signed-in reviewers only. The cache is capped (`SCRATCH_LIMIT_MB`, default 1000); least recently used copies go first, and the original is deleted at once.

**Waveforms** are derived data, not audio. They are computed once from the original (size, SHA-256 and decoded
duration checked) and kept in the database. The 5 computed locally migrate with the data; the rest are drawn the first
time each recording is opened (a few seconds; up to about 30 s for the longest surahs).

## Monthly cost (estimate: confirm on render.com/pricing before approving)

| Item | Plan | Estimated cost |
|---|---|---|
| Web service | Starter (0.5 CPU, 512 MB, always on) | about $7 / month |
| PostgreSQL | Basic-256mb, 1 GB storage | about $6 / month + about $0.30 / month storage |
| Bandwidth | included allowance; CBR audio streams from the providers, not through Render | expected $0 |
| Custom domain | not needed (the `onrender.com` HTTPS address is used) | $0 |
| Google Sign-In | OAuth client | $0 |
| **Total** | | **about $13–14 / month** |

**Not included:** any change to the owner's Render workspace plan.

**When to upgrade:** if many long surahs are opened at once, the web service may need Standard (2 GB, about $25 /
month). The database plan can also be raised later without data loss.

## What the owner provides (nothing is done without it)

1. **Approval** of the cost and of deploying.
2. **Hosting the code:** Render deploys from a Git repository. Choose one:
   - a **new private repository** with this dashboard only (recommended: isolated, and nothing else from QuranHeals is published);
   - or authorise committing `tools/quran-audio/review/{manual,dashboard,cloud}` (plus `fingerprint.mjs`, `reciters.mjs` and the two canonical text files) to the existing repository.

   Either needs an explicit "commit and push" from the owner.
3. **A Google OAuth client:** Google Cloud console → APIs & Services → Credentials → *Create OAuth client ID* → *Web application*.
   - Name it "Quran Heals audio review".
   - Authorised JavaScript origin: `https://<service>.onrender.com`.
   - Use a new client: the app's own clients stay untouched.
4. **The administrator token:** generate it on your computer and keep it there; only its hash goes to Render.

   ```bash
   node -e "const c=require('crypto');const t=c.randomBytes(32).toString('base64url');console.log('ADMIN_TOKEN='+t);console.log('ADMIN_TOKEN_SHA256='+c.createHash('sha256').update(t).digest('hex'))"
   ```
5. **Reviewer e-mails:** the Google accounts of Reviewer 1 and Reviewer 2. The owner is the first administrator.

## Deploying (after approval)

1. **Blueprint:** in Render, *New → Blueprint*, select the repository, and point it to
   `tools/quran-audio/review/cloud/render.yaml` (or copy it to the repository root). Review the two resources it creates
   and apply. This is where the cost starts.
2. **Secrets:** enter them in the service's *Environment* (never in Git):
   - `PUBLIC_URL`: `https://<service>.onrender.com`, exactly;
   - `GOOGLE_CLIENT_ID`;
   - `ADMIN_TOKEN_SHA256`;
   - `BOOTSTRAP_ADMIN_EMAIL`: your Google e-mail. `BOOTSTRAP_ADMIN_NAME` stays `Owner`.
3. **Deploy:** *Manual Deploy*. The deploy succeeds only when `/healthz` answers.
   - **If it fails on the database connection:** set `DATABASE_SSL=no-verify`; the internal connection then uses TLS without certificate checking.
4. **Sign in:** open `https://<service>.onrender.com/`. Your account was created by the bootstrap.

## Migration (the local reviews move to the cloud)

**Plan for a quiet moment, and do it in one sitting.** From `QuranHeals/tools/quran-audio` on the owner's computer:

1. **Stop reviewing locally:** close the local dashboard (Ctrl+C in its window).
2. **Back up and verify:**
   ```bash
   node review/dashboard/backup.mjs --config "<local cfg>" --label pre-migration
   node review/dashboard/backup.mjs --verify "%USERPROFILE%\Backups\quran-heals-audio-review\pre-migration-<time>"
   ```
3. **Bundle:** `node review/cloud/migrate.mjs bundle --config "<local cfg>" --out migration-bundle.json`
   - **What it reads:** every recording, every review log byte for byte, the waveforms and the inventory.
   - **What it writes:** the bundle, its `.sha256` and a manifest of each log's SHA-256 and head hash.
   - **No local path** reaches the bundle.
4. **Allow your computer** to reach the database: in Render's database *Access control*, add your current IP. Set
   `DATABASE_URL` to the database's **External** URL in your terminal; it is never printed or saved.
5. **Dry run:** `node review/cloud/migrate.mjs plan --bundle migration-bundle.json`. It writes nothing and lists what would be added, appended or refused.
6. **Apply and verify:**
   ```bash
   node review/cloud/migrate.mjs apply  --bundle migration-bundle.json
   node review/cloud/migrate.mjs verify --bundle migration-bundle.json
   ```
   `verify` checks that every bundled log is in the database line for line, with the same head hash and status. Applying twice is harmless: present events are recognised, never duplicated.
7. **Link your legacy name:** `node review/cloud/migrate.mjs link-identity --legacy Hamza --email <your Google e-mail>`, or do it on the Administration page.
   - It records the evidence: each recording, its event count and its head hash.
   - Your account then continues those reviews as "Hamza". No event is rewritten.
8. **Make the local dashboard read-only:**
   ```bash
   node review/cloud/migrate.mjs cutover --config "<local cfg>" --url https://<service>.onrender.com
   ```
   From then on, the cloud is the only place that accepts reviews; the local one refuses every change (423).
9. **Remove your IP** from the database access control. Add the reviewers' accounts (Administration) and send them the URL.

**Rehearsed 2026-10-19 with the real data**, on a local PostgreSQL (`28/28` steps). All five real reviews migrated
exactly (339 events):
- **Rifaat:** 98, 73 and 72;
- **Saleh Al-Talib:** 87;
- **Abdul Basit:** 2 (production check).

Byte-identical lines; valid chains; "first review completed" for each in the cloud; the identity link; backup and
restore. The local files were unchanged.

## Future review packages (no redeploy, no app release)

1. Make the packages as before (`make-packages.mjs --phase X`); `Refresh queue` on the local dashboard validates them.
2. Push them to the cloud:
   ```bash
   ADMIN_TOKEN=... node review/cloud/migrate.mjs push-packages --config "<local cfg>" --url https://<service>.onrender.com [--dry-run]
   ```
   Or upload a bundle on the Administration page.

**What the server checks:** every recording, as above. Packages never carry review events. Duplicates are recognised,
and a recording whose review has begun keeps its session.

## Publication to the app (Phase 4.8.3)

Full design and test report: `docs/audio/verified-audio-publication-phase-4-8-3-2026-10-19.md`.

**Service settings:**

| Setting | Values | Default |
|---|---|---|
| `PUBLICATION_MODE` | `off` (evaluate and show status; nothing written) or `enabled` (publish eligible recordings automatically) | `off` |
| `PUBLICATION_ENVIRONMENTS` | the environments to publish to | `development,production` |
| `APP_AUDIO_CAPABILITIES` (Phase 4.8.5) | the exact-seek methods the **released** app ships, per platform (JSON) | `{"cbr-exact":["android","ios"],"vbr-mllt":[]}` |

**VBR recordings (Phase 4.8.5):** eligible only when `vbr-mllt` ships on both platforms **and** a real-device measurement of that exact file is recorded for Android and for iOS within ±60 ms (Publication tab → *Record a device measurement*). See `docs/audio/release-readiness-phase-4-8-5-2026-10-19.md`.

Changing a setting needs a restart.

**Owner actions** (Publication tab of the dashboard, administrators only):
- **Record an authorization:** provider, optionally a reciter or an exact file (SHA-256), riwayah Hafs, and the evidence (where the permission is written). A file with a rights notice needs an exact-file authorization that acknowledges it.
  - Without an authorization, nothing is published, whatever the reviews say.
  - Revoking an authorization withdraws what it covered.
- **Retry now** queues a recording.
- **Roll back / withdraw** moves one or both environments to an earlier version, or to none. It holds the recording until **Release hold**.
- **Align both** puts both environments on one version: the recovery from a mismatch.

**The app's read-only API** (public: published timing only):

| Request | Response |
|---|---|
| `GET /v1/audio-timing/{development\|production}/manifest` | The active versions (ETag, cacheable 5 min) |
| `GET /v1/audio-timing/versions/{tv_…}` | One immutable version document (cacheable for a year). Only versions that have been active somewhere are served. |

App builds read it when `EXPO_PUBLIC_AUDIO_REGISTRY_URL` is this service's URL (and, optionally, `EXPO_PUBLIC_AUDIO_TIMING_ENV`).

**Monitoring:**
- `GET /api/admin/status` → `publication`: mode, job states, mismatch count and the last failure.
- Every publication action is in `publication_log`, which is append-only.

## Backups and restore

- **Render:** managed backups of the paid database (retention depends on the workspace plan: check it in the database's *Recovery* tab).
- **Logical backups:** with your IP allowed and `DATABASE_URL` set:
  ```bash
  node review/cloud/migrate.mjs backup --out "%USERPROFILE%\Backups\quran-heals-audio-review\cloud-<date>.ndjson"
  ```
  - **Contents:** every account, link, recording, review event (its exact line), import and admin action. Sign-in sessions are never included.
  - **Checks:** a SHA-256 manifest, and every chain is checked.
  - **Size:** a few MB now.

  Do it weekly, and before every deploy.
- **Restore:** `node review/cloud/migrate.mjs restore --from <file>`, into an **empty** database only. It verifies the hash, every chain, the row counts and each log's head.

  To recover the service, create a new Render database, restore into it, and point `DATABASE_URL` at it.

## Rollback

| Situation | What to do |
|---|---|
| A deploy misbehaves | In Render, *Rollback* to the previous deploy (the database is untouched). |
| Leave the cloud entirely | Administration → **Read-only** (nobody can save). Then `migrate.mjs backup`. Then `rollback-cutover --config "<local cfg>"` makes the local dashboard writable again; it still holds every review made before the cutover. With your IP allowed, `migrate.mjs pull-events --config "<local cfg>"` appends the reviews made in the cloud to the local logs (each local log must be an exact prefix of the cloud's; anything else is refused). Never let both accept reviews at the same time. |
| Data damaged | Restore the latest logical backup (or Render's point-in-time recovery) into a new database. |

## Security

**Checked, and tested where marked:**
- **Sign-in required:** every page, API and audio route needs a signed-in, active account. Only `/login`, `/auth/*` and `/healthz` are public; `/healthz` answers only `{ok}`. *(tested)*
- **CSRF:** writes need the service's own Origin and a JSON body. `SameSite=Lax` cookies. *(tested)*
- **DNS rebinding:** another `Host` is refused (421). *(tested)*
- **Files:** no request path reaches the filesystem. Keys are `[a-z0-9-]` and looked up in the database; traversal attempts give 404. *(tested)*
- **Limits:**
  - **request bodies:** 2 MB per review event and 200 MB per import; an oversized body is drained and answered 413 *(tested)*;
  - **rate limits:** per IP, per account and per write; sign-in has its own limit *(tested)*.
- **Headers:**
  - a nonce-based Content-Security-Policy (no inline script without the per-response nonce *(tested)*);
  - `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`;
  - media only from the three providers.
- **XSS:** all data on the pages is escaped before it is inserted.
- **No local paths:** none in any response or bundle *(tested)*.
- **No secrets in the code:**
  - the Google client ID is public by design;
  - the administrator token exists only as its SHA-256 on the server and is compared in constant time.
- **Administrators:** administrator functions are separate from reviewing (no admin view of placements). A reviewer
  cannot reach `/api/admin/*` *(tested)*. An administrator cannot remove their own administrator access by accident.

## Limits

- **The database owner can read everything.** As with any database, whoever holds `DATABASE_URL` (the owner) could read hidden placements directly. Blindness is enforced for every account in the application.
- **One instance.** Correctness holds with several (the locks are in the database), but reads would be briefly stale between them.
- **Waveforms** for most recordings are drawn on first opening, from the provider; the provider must be up.
- **Not yet done:** no deployment, no real Google sign-in and no Render-side test have been run. Those happen at deployment, after approval.

## Tests

Three app test files run this service against a temporary local PostgreSQL from the `embedded-postgres` dev
dependency: `mobile/tests/audioPublication.test.ts`, `audioReviewCloud.test.ts` and `audioSingleReview.test.ts`.
On a fresh clone, install this folder's pinned dependencies once before `npm test` in `mobile/`:

```bash
cd tools/quran-audio/review/cloud && npm ci
```

Their waveform checks run `review/dashboard/peaks.py`, which needs numpy and miniaudio in `tools/quran-audio/pylib`
(Python 3.12, the `Dockerfile`'s version ranges):

```bash
cd tools/quran-audio && python -m pip install --target pylib "numpy>=2,<3" "miniaudio>=1.61,<2"
```

CI does both (`.github/workflows/ci.yml`, mobile job). `embedded-postgres` is a dev dependency only: the deployed image
installs with `--omit=dev` (`Dockerfile`).

## Files

| File | Purpose |
|---|---|
| `server.mjs` | The service (routes, security, administration) |
| `db.mjs` | Schema (append-only trigger, UTF-8 check), pool, transactions |
| `pg-store.mjs` | Review logs in PostgreSQL, atomic appends |
| `auth.mjs` | Google ID-token sign-in, sessions, accounts, identity links, CLI token |
| `audio.mjs` | Source checks, waveforms, VBR decode |
| `import.mjs` | Validated imports (migration and packages) |
| `backup.mjs` | Logical backup, verify, restore |
| `migrate.mjs` | CLI: bundle, plan, apply, verify, accounts, links, backups, source check, package push, cutover |
| `login.html`, `admin.html` | Sign-in and administration pages (the dashboard and review pages are shared with the local tool) |
| `Dockerfile`, `render.yaml`, `package.json` | Deployment (separate service + database; no secret) |

Tests: `mobile/tests/audioReviewCloud.test.ts`, on a real PostgreSQL (embedded, temporary) with synthetic data.
