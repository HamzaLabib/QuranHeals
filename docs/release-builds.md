# Release builds (EAS)

Run from `mobile/`. Profiles live in `mobile/eas.json`; the API URL guard lives in `mobile/app.config.ts`.

## Profiles

| Profile | Who uses it | Distribution | EAS environment / update channel | `EXPO_PUBLIC_API_URL` |
|---|---|---|---|---|
| `development` | Developers (dev client with Metro) | internal | `development` | Optional. Unset → the app uses the local backend on port 4000 (`localhost`, or `10.0.2.2` on the Android emulator). A LAN `http://` URL is fine. |
| `preview` | Internal testers | internal | `preview` | **Required**: public `https://` backend URL |
| `production` | App Store / Google Play | store (Android AAB) | `production` | **Required**: public `https://` backend URL |

```sh
eas build --profile development --platform ios
eas build --profile preview --platform android
eas build --profile production --platform all
```

For plain local development, `npx expo start` with `mobile/.env` works as before (see `mobile/.env.example`).

## Where the API URL comes from

`EXPO_PUBLIC_API_URL` is a public value inlined into the JavaScript bundle. It is not a secret. For EAS builds, set it per environment on expo.dev (or `eas env:create --environment production`). It is never committed to `eas.json` or source code. `mobile/.env` is gitignored, so it is never uploaded to EAS.

## How the guard works

- `eas.json` gives each profile `QURAN_HEALS_API_URL_POLICY`: `local` for development, `hosted` for preview and production.
- On the EAS build worker (`EAS_BUILD=true`), `app.config.ts` refuses a `hosted` build unless the URL is a valid `https://` URL on a public host. It rejects:
  - a missing URL;
  - `http://`;
  - `localhost`, `127.0.0.1` and other loopback addresses;
  - LAN and private IPs, including the emulator's `10.0.2.2`;
  - `.local` hosts;
  - URLs with credentials, a query or a fragment.
- The worker reads the app config before prebuild, so a bad build fails before any binary is produced. The error message names the variable and the problem.
- The guard does not run during local `eas build`/`eas config` evaluation. eas-cli evaluates the config there before it downloads the EAS environment variables, so the URL would always look missing.
- Defense in depth: `src/services/apiBase.ts` throws at startup if a release bundle (`__DEV__ === false`) was built without the URL, instead of silently calling localhost. This also covers EAS Updates. Only development bundles fall back to port 4000.
- Tests: `mobile/tests/apiUrlPolicy.test.ts`.

**EAS Update:** publish with the matching environment, for example `eas update --channel production --environment production`, so the bundle embeds the right URL.

## Build numbers

`cli.appVersionSource` is `remote`, so EAS stores the iOS `buildNumber` and Android `versionCode`. `app.json` deliberately has neither field. The `production` profile's `autoIncrement: true` bumps the remote value on every production build. Preview and development builds reuse the current remote value without incrementing it. The user-facing version stays `expo.version` in `app.json` (currently `1.0.0`); raise it manually for a new store release.

## Native changes and OTA updates

`runtimeVersion` uses the `fingerprint` policy: a hash of the native project, including native modules and their config. Consequences:

- Adding or upgrading a native dependency (for example `expo-system-ui` or `expo-dev-client`), or changing native config in `app.json`, requires a **new native build**.
- An EAS Update is only delivered to binaries with the same fingerprint, so a JS update that needs a newer native module never reaches an older binary that lacks it.
- Binaries built before the fingerprint policy (runtime `1.0.0`) receive no further updates; testers must install a new build.
