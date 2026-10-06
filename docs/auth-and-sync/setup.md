# Optional Apple/Google sign-in + sync — production setup

This document lists the manual, external configuration required before
Apple/Google sign-in and cross-device sync work on a real device or in
production. **No real credentials are included anywhere in this repo** —
every value below is a placeholder name for an environment variable you
must fill in yourself.

Quran Heals never requires an account. Everything in this doc only affects
the *optional* sign-in path described in the product spec (Part A–B).

## 1. What was actually built vs. what needs manual setup

| Piece | Status |
|---|---|
| Backend Google ID token verification (`google-auth-library`) | Built; signature, audience, issuer and expiry tested against the real library with a local key |
| Backend Apple ID token verification (JWKS via `jsonwebtoken` + `jwks-rsa`) | Built, tested with a mock verifier |
| Backend session issuance/verification, sync/favorites/preferences/reflections/issue-report endpoints | Built and tested against in-memory fakes |
| Mobile Apple sign-in (`expo-apple-authentication`) | Built; **not tested on a real device** — no Apple Developer account/bundle entitlement was configured in this environment |
| Mobile Google sign-in (`expo-auth-session`'s Google provider) | Built; **not tested against a real Google OAuth client** — no Google Cloud project was created in this environment |
| Reflection client-side encryption (`@noble/ciphers` XChaCha20-Poly1305 + `@noble/hashes` PBKDF2-HMAC-SHA256) | Built and unit-tested (round-trip, tamper detection, wrong-key rejection, KDF timing) |

Nothing here claims real-device Apple/Google authentication has succeeded —
it has not been attempted, because no real provider credentials exist in
this environment.

## 2. Environment variables

Never commit real values. Public client IDs are identifiers, not secrets, but they stay environment-managed so each EAS environment can differ.

**Mobile: EAS environment variables** (expo.dev → Environment variables, per `development`/`preview`/`production`; local `mobile/.env` for dev)

| Variable | What | Secret? |
|---|---|---|
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google OAuth **iOS** client ID | No (public) |
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Google OAuth **Android** client ID | No (public) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth **web** client ID (web builds only) | No (public) |

Each platform uses only its own ID (`mobile/src/auth/googleConfig.ts`). If the current platform's ID is unset, the app hides Google sign-in there instead of showing a broken button. On the EAS build worker, a set but malformed ID fails the build (`mobile/app.config.ts`). There is no generic `EXPO_PUBLIC_GOOGLE_CLIENT_ID`; it was never read.

**Backend: Render only** (never `EXPO_PUBLIC_*`, never in the mobile bundle)

| Variable | What | Secret? |
|---|---|---|
| `SESSION_JWT_SECRET` | Signs this backend's access tokens; also keys refresh-token rotation | **Yes** |
| `GOOGLE_CLIENT_IDS` | Comma-separated iOS, Android and web Google client IDs: the only accepted ID-token audiences | No |
| `APPLE_AUDIENCE_IDS` | Accepted Apple identity-token audiences; must include the bundle ID `com.quranheals.app` | No |
| `APPLE_CLIENT_ID` | `com.quranheals.app`, used for Apple's token and revoke calls | No |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID | No |
| `APPLE_KEY_ID` | 10-character ID of the Sign in with Apple key | No |
| `APPLE_PRIVATE_KEY` | That key's `.p8` contents, newlines escaped as `\n` | **Yes** |
| `APPLE_REFRESH_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`); encrypts stored Apple refresh tokens | **Yes** |

**Production startup checks** (`backend/src/config/authConfig.ts`) make the server refuse to start, naming variables only, never values, when:

- no provider is configured;
- `GOOGLE_CLIENT_IDS` contains something that isn't a Google client ID;
- `APPLE_AUDIENCE_IDS` is set (Apple enabled) but any of `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CLIENT_ID` or `APPLE_REFRESH_TOKEN_ENCRYPTION_KEY` is missing or malformed, or `APPLE_CLIENT_ID` isn't one of the accepted audiences.

Without these, deleting an Apple account would fail at runtime, because Apple's authorization must be revoked first. **Set them on Render before deploying this check.** The server also refuses to start with the default `SESSION_JWT_SECRET`.

## 3. Google Cloud Console setup (manual)

Native builds use `expo-auth-session`'s Google provider: authorization code + PKCE, redirecting to **`com.quranheals.app:/oauthredirect`** (the app's application ID, not a reversed client ID; see `node_modules/expo-auth-session/build/providers/Google.js`).

1. Configure the OAuth consent screen.
2. **iOS client:** bundle ID `com.quranheals.app`. Expo registers the bundle ID as a URL scheme automatically, so no reversed-client-ID scheme is needed.
3. **Android client:** package `com.quranheals.app`, plus the **SHA-1 of the EAS signing certificate**. Get it from `cd mobile && eas credentials --platform android` (Keystore → SHA1 fingerprint), or expo.dev → project → Credentials → Android. If Play App Signing is used, add the Play signing SHA-1 too. The app registers `com.quranheals.app` as an Android URL scheme (`mobile/app.config.ts`). Google disables custom URI schemes for Android clients by default: check the client's **Advanced settings → Enable custom URI scheme**, or the redirect is refused.
4. **Web client:** only for web builds.
5. Put each ID in the matching `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` (per EAS environment), and all of them in Render's `GOOGLE_CLIENT_IDS`.

## 4. Apple Developer setup (manual)

1. App ID `com.quranheals.app`: enable **Sign In with Apple**. `mobile/app.json` already has `ios.usesAppleSignIn: true`, so the entitlement is added on the next native build.
2. Keys: create a key with **Sign in with Apple** enabled for that App ID. Download the `.p8` once, then set `APPLE_KEY_ID`, `APPLE_TEAM_ID` and `APPLE_PRIVATE_KEY` on Render. Store the `.p8` in a password manager, never in the repo or this OneDrive folder.
3. Render: `APPLE_CLIENT_ID=com.quranheals.app`, `APPLE_AUDIENCE_IDS=com.quranheals.app`, and a fresh `APPLE_REFRESH_TOKEN_ENCRYPTION_KEY`. Changing that key later makes stored Apple refresh tokens unreadable; deletion then falls back to a fresh Apple sign-in.

Apple Sign In is iOS-only in this app: Android and web never show an Apple button, so an Apple-ID account can only be used on iOS.

## 5. Security behavior

- **Token verification:** Google tokens go through `google-auth-library` (signature, expiry, issuer `accounts.google.com`, audience restricted to `GOOGLE_CLIENT_IDS`). Apple tokens go through Apple's JWKS (RS256, issuer `https://appleid.apple.com`, audience `APPLE_AUDIENCE_IDS`). Accounts are keyed by provider + subject only, never linked by email.
- **Sessions:** access tokens last 20 minutes and must carry a session id that is still active on every request. The old 180-day tokens without a session id are rejected, so their holders must sign in again. Refresh tokens rotate, with a 2-minute grace window for retrying a lost response.
- **Apple calls:** token exchange and revocation are bounded at 10s each, the sign-in credential capture at 2.5s, and the JWKS fetch at 5s. A timeout is a generic 502, and nothing is deleted.
- **Destructive actions need a fresh provider sign-in**: a token for this account's own provider and subject, issued within the last 10 minutes.
  - **Forgotten-password reset:** the token must also be issued after the current sync key.
  - **Account deletion, Google:** always requires the fresh sign-in.
  - **Account deletion, Apple:** requires it only when no revocation credential is stored. Apple's authorization is revoked before any data is deleted.
- **Deferred (P2, before public launch): nonce / request binding.** Provider ID tokens aren't bound to a server-issued one-time challenge, so a stolen ID token can be replayed until it expires (Google: about 1 hour). Doing this properly needs:
  - a challenge endpoint and a consumable server-side store;
  - passing the nonce through both native SDKs, and confirming on real devices how Apple's native flow and Google's code flow carry it into the token (hashed or raw).

  That can't be verified before device QA. A partial version would only add false confidence. Audience restriction limits the risk to tokens issued to Quran Heals itself.

## 6. EAS / build config notes

- `mobile/app.json` already has the config plugins `expo-secure-store` and
  `expo-web-browser` registered (added when those packages were installed).
- No config plugin is required for `expo-apple-authentication`,
  `expo-auth-session`, `expo-crypto`, or `expo-constants` — they work via
  Expo's autolinking.
- A custom development client or EAS build is required to test Apple/Google
  sign-in on-device (the Apple Sign In capability and Google's native code
  exchange both need a real native binary, not just Expo Go, once a real
  bundle ID/keystore matter for the OAuth client IDs above).

## 7. What "sign-in failed" looks like today, without real credentials

With `GOOGLE_CLIENT_IDS`/`APPLE_AUDIENCE_IDS` unset, any real sign-in
attempt fails server-side verification (by design — see `requireGoogleAuthConfig`/
`requireAppleAuthConfig` in `backend/src/config/env.ts`), and the mobile
app shows the standard failure copy (`messages.auth.signInFailed`) while
remaining fully usable as a guest. This is the expected, safe state until
the steps above are completed.
