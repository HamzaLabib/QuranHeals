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
MONGODB_URI=<Atlas connection string, ideally for a production-only database user>
MONGODB_DB_NAME=quranheals_prod
SESSION_JWT_SECRET=<real secret>      # already required in production by env.ts
```

The other provider and Apple settings are unchanged; see `docs/auth-and-sync/setup.md`.

## Checking which database a process uses

- Render logs at startup: `Connected to MongoDB: environment=production database=quranheals_prod`.
- `GET /api/health` returns `200 {"status":"ok","database":"connected","environment":"production"}`, or `503` with `"database":"unavailable"` when MongoDB doesn't answer a ping within 2s. It never returns the database name, host or URI, so it is safe for uptime monitors.
- Scripts print their target line before connecting.

## Never commit

`backend/.env`, `atlas-credentials.env` or any connection string, database user or password, `SESSION_JWT_SECRET`, Apple keys, or database exports that contain user data. The repo's `.gitignore` already excludes `.env`/`*.env`/`*-credentials.env`.

## Moving production off `test`

Rolling this out requires these manual steps (they can't be done from the repo):

1. **Inventory first, read-only.** In Atlas, check whether the database the live API uses today (`test`, since its URI names none) contains real users: `users`, `sessions`, `userfavorites`, `userreflections`, `userpreferences`, `usersynckeys`, `applecredentials`, `issuereports`.
2. **Create `quranheals_prod`** with **content only**: copy `emotions` and `emotionversemappings` (plus `verses`/`ayahs`, which the API still reads as optional/legacy enrichment) from the current source, for example `mongodump --db=test --collection=<name>` then `mongorestore --nsFrom='test.*' --nsTo='quranheals_prod.*'`. Never copy development or test users.
3. **If step 1 found real users**, stop. Plan a user-data migration separately: move the user collections from `test` to `quranheals_prod` in one maintenance window, and verify counts. Never delete `test` until production has been verified for some time.
4. **Development:** create `quranheals_dev` the same way (content, plus any test users you want) and set `MONGODB_DB_NAME=quranheals_dev` locally.
5. **Render:** set `MONGODB_DB_NAME=quranheals_prod` (and `NODE_ENV=production`), redeploy, check the startup log line, then `GET /api/health`.
6. **Only then** set `EXPO_PUBLIC_API_URL` in the EAS `production` environment (see `docs/release-builds.md`).

Deploying this code to Render **before** setting `MONGODB_DB_NAME` makes the service refuse to start. That is deliberate: it fails loudly instead of silently using `test`.
