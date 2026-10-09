# Backend environments and databases

The database is chosen by `NODE_ENV` plus an explicit `MONGODB_DB_NAME`. It is **never** taken from MongoDB's default (`test`, which is what you get when a URI names no database). The policy lives in `backend/src/config/databaseTarget.ts`; tests are in `backend/tests/config/`.

| `NODE_ENV` | `MONGODB_DB_NAME` | Notes |
|---|---|---|
| `production` | `quranheals_prod` (exactly) | Render / the live API |
| `development` | `quranheals_dev` (or `quranheals_dev_<name>` for a personal copy) | local `npm run dev` and all scripts |
| `test` | `quranheals_test` (or a suffixed variant) | the Vitest suite uses in-memory fakes and never connects |

`test`, `admin`, `local` and `config` are rejected in every environment.

## Startup guards

`server.ts` validates before connecting and exits non-zero with a message that never contains the URI. It refuses to start when:

- `MONGODB_URI` is missing;
- `MONGODB_DB_NAME` is missing, invalid, or reserved (`test`, …);
- the URI path names a different database than `MONGODB_DB_NAME` (ambiguous);
- the name belongs to another environment: production must be `quranheals_prod`, and development may never use it.

It always connects with an explicit `dbName`. After connecting, it checks that the server-reported database matches and disconnects if it does not. On success it logs `Connected to MongoDB: environment=… database=…`, which is safe to read in Render logs.

## Scripts (seed, migrations, mapping tools)

Every script connects through `connectScriptDatabase` (`config/database.ts`), so the same rules apply. In addition:

- It prints `[script] environment=… database=… mode=read-only|WRITE` before connecting.
- Production is refused unless the script is built for it. Today only `mapping:deactivate` is: it requires an exact REJECT/HOLD pair, a verified backup and a typed confirmation.
- A production **write** additionally requires `QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod`.
- `seed` and `migrate:foundation` never run against production, because seeding overwrites live `Emotion.active` flags.
- Mapping activation, rollback and cleanup scripts keep their own dry-run defaults and `--confirm-database` checks. Their allowlists no longer accept `test`.

## Configuration

**Local development** (`backend/.env`, gitignored; see `.env.example`):

```text
NODE_ENV=development
MONGODB_URI=<Atlas connection string, no database in the path>
MONGODB_DB_NAME=quranheals_dev
```

**Render (production)**, under Environment:

```text
NODE_ENV=production
MONGODB_URI=<Atlas connection string for the production database user (see "Database users" below)>
MONGODB_DB_NAME=quranheals_prod
MONGODB_ENFORCE_CREDENTIAL_SCOPE=true   # only after the credential migration below is complete
TRUST_PROXY_HOPS=<verified hop count>   # default 1; see docs/backend-operations.md "Client IPs on Render"
ENDPOINT_RATE_LIMITS=on                 # default off; set on only after TRUST_PROXY_HOPS is verified
SESSION_JWT_SECRET=<real secret>      # already required in production by env.ts
SENTRY_DSN=<project DSN>              # optional; error monitoring, see docs/backend-operations.md
```

The other provider and Apple settings are unchanged; see `docs/auth-and-sync/setup.md`.

## Database users (least privilege)

The name checks above stop the **app** from choosing the wrong database. Each environment must also connect with a **database user that can only reach its own database**, so a leaked or misused development credential can never read or change production.

| Atlas database user | Privileges | Used by |
|---|---|---|
| `quranheals-dev` | `readWrite` on `quranheals_dev` only | local `npm run dev`, all development scripts |
| `quranheals-prod` | `readWrite` on `quranheals_prod` only | Render production backend; production scripts only when explicitly authorized |
| `quranheals-prod-audit` | `read` on `quranheals_prod` only | read-only checks such as `npm run mapping:visibility-audit`, only when explicitly authorized; the email-deletion lookups and dry runs (`prod-read.env` profile) |
| `quranheals-prod-deletion` (**not created yet**; needs approval) | Custom role: `find` + `remove` on `users`, `sessions`, `userfavorites`, `userpreferences`, `userreflections`, `usersynckeys`, `applecredentials`, `issuereports` in `quranheals_prod`. No insert, update, index or collection actions. | `account:admin-delete ... --apply`, from the `prod-delete.env` profile on the owner's machine. The tool refuses any broader user. See `docs/account-deletion-requests.md`. |
| `quranheals-prod-retention` (**not created yet**; needs approval) | Custom role `quranheals-issue-report-retention`: `find` + `remove` on `issuereports` in `quranheals_prod` only. Nothing else. | `issue-reports:retention purge --apply`, from the `prod-retention.env` profile on the owner's machine. The script refuses any user with more (including the account-deletion user above). See `docs/data-retention.md`. |

No user gets `readWriteAnyDatabase`, `readAnyDatabase`, `atlasAdmin` or any other all-database role. Keep personal Atlas UI access (organization/project roles) separate from these application users.

### Startup credential check

After connecting, the backend asks MongoDB for its own privileges (`connectionStatus`) and checks them (`backend/src/config/credentialScope.ts`):

- the connection must be authenticated as a database user (a server without access control grants everything);
- the user must not have privileges on every database, or on another application database (for example `quranheals_prod` from development);
- in production, a read-only script (`writes: false`) must use a user that cannot write the target (the audit user). Development read-only scripts use the normal development user.

The check needs no extra privilege: every user may run `connectionStatus` on itself, and MongoDB returns its privileges already resolved across inherited roles. If the check fails or does not answer within 5 seconds, it is reported as "could not be verified" (a warning, or a refusal to start when enforced).

By default a problem is logged as `WARNING MongoDB credential scope: …` and startup continues, so deployments still on the shared credential keep working during the migration. With `MONGODB_ENFORCE_CREDENTIAL_SCOPE=true` the process refuses to start instead. The messages name databases only, never the URI, host or user name.

### Migrating from the shared credential (manual; requires approval)

Today one Atlas user can read both `quranheals_dev` and `quranheals_prod`. None of these steps can be done from the repo; do them in order and do not skip the checks.

1. **Save the current values first.** Copy the current Render `MONGODB_URI` and local `backend/.env` `MONGODB_URI` into your password manager. They are the rollback.
2. **Create the three users in Atlas** (Database Access → Add New Database User → Password; "Built-in Role" off → "Specific Privileges"):
   - `quranheals-dev`: `readWrite` @ `quranheals_dev`
   - `quranheals-prod`: `readWrite` @ `quranheals_prod`
   - `quranheals-prod-audit`: `read` @ `quranheals_prod`

   Use long generated passwords (no characters that need URL-escaping, or URL-encode them). Optionally restrict each user to the one cluster.
3. **Verify the development user locally.** Put its connection string in `backend/.env` (no database in the path), then:
   - `npm run dev` starts with no `WARNING MongoDB credential scope` line;
   - `mongosh "<dev URI>"`, then `use quranheals_prod` and `db.emotions.findOne()`, must fail with *not authorized*.
4. **Switch Render to the production user.** Set the new `MONGODB_URI` under Environment (Render redeploys). Check:
   - the log shows `Connected to MongoDB: environment=production database=quranheals_prod` and no credential-scope warning;
   - `GET /api/health` returns `200`;
   - from a preview build: emotions load, an ayah loads, sign-in works, a favorite and a reflection sync, and an existing reflection still decrypts.
5. **Verify the audit user** with `mongosh "<audit URI>"`: `use quranheals_prod`, `db.emotions.countDocuments()` works and `db.emotions.insertOne({})` fails with *not authorized*.
6. **Observe for a few days.** Watch Render logs and Sentry for authentication or `not authorized` errors.
7. **Turn on enforcement.** Set `MONGODB_ENFORCE_CREDENTIAL_SCOPE=true` on Render and in `backend/.env`.
8. **Revoke the old shared user** in Atlas (Database Access → delete, or first change its password to a random value if you want a short grace period). Then remove the saved old URI from step 1.

**Rollback** (any step before 8): restore the saved `MONGODB_URI` on Render (and locally), and remove `MONGODB_ENFORCE_CREDENTIAL_SCOPE` if it was set. No data changes during the migration, so a rollback restores the previous state exactly. After step 8, rollback means creating a replacement user with the same privileges.

What this migration never does: it does not copy data between databases, create or drop collections, or write to `quranheals_prod`.

## Checking which database a process uses

- Render logs at startup: `Connected to MongoDB: environment=production database=quranheals_prod`.
- `GET /api/health` returns `200 {"status":"ok","database":"connected","environment":"production"}`, or `503` with `"database":"unavailable"` when MongoDB doesn't answer a ping within 2s. It never returns the database name, host or URI, so it is safe for uptime monitors.
- Scripts print their target line before connecting.

## Never commit

`backend/.env`, `atlas-credentials.env` or any connection string, database user or password, `SESSION_JWT_SECRET`, Apple keys, or database exports that contain user data. The repo's `.gitignore` already excludes `.env`/`*.env`/`*-credentials.env`.

## Historical: moving production off `test`

> Kept as the record of a completed migration: production now runs on `quranheals_prod` and development on `quranheals_dev` (both observed in the October 2026 audit). The current credential setup is under "Database users" above.

Rolling this out required these manual steps (they can't be done from the repo):

1. **Inventory first, read-only.** In Atlas, check whether the database the live API uses today (`test`, since its URI names none) contains real users: `users`, `sessions`, `userfavorites`, `userreflections`, `userpreferences`, `usersynckeys`, `applecredentials`, `issuereports`.
2. **Create `quranheals_prod`** with **content only**: copy `emotions` and `emotionversemappings` (plus `verses`/`ayahs`, which the API still reads as optional/legacy enrichment) from the current source, for example `mongodump --db=test --collection=<name>` then `mongorestore --nsFrom='test.*' --nsTo='quranheals_prod.*'`. Never copy development or test users.
3. **If step 1 found real users**, stop. Plan a user-data migration separately: move the user collections from `test` to `quranheals_prod` in one maintenance window, and verify counts. Never delete `test` until production has been verified for some time.
4. **Development:** create `quranheals_dev` the same way (content, plus any test users you want) and set `MONGODB_DB_NAME=quranheals_dev` locally.
5. **Render:** set `MONGODB_DB_NAME=quranheals_prod` (and `NODE_ENV=production`), redeploy, check the startup log line, then `GET /api/health`.
6. **Only then** set `EXPO_PUBLIC_API_URL` in the EAS `production` environment (see `docs/release-builds.md`).

Deploying this code to Render **before** setting `MONGODB_DB_NAME` makes the service refuse to start. That is deliberate: it fails loudly instead of silently using `test`.
