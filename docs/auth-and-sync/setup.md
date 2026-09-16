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
| Backend Google ID token verification (`google-auth-library`) | Built, tested with a mock verifier |
| Backend Apple ID token verification (JWKS via `jsonwebtoken` + `jwks-rsa`) | Built, tested with a mock verifier |
| Backend session issuance/verification, sync/favorites/preferences/reflections/issue-report endpoints | Built and tested against in-memory fakes |
| Mobile Apple sign-in (`expo-apple-authentication`) | Built; **not tested on a real device** — no Apple Developer account/bundle entitlement was configured in this environment |
| Mobile Google sign-in (`expo-auth-session`'s Google provider) | Built; **not tested against a real Google OAuth client** — no Google Cloud project was created in this environment |
| Reflection client-side encryption (`@noble/ciphers` XChaCha20-Poly1305 + `@noble/hashes` PBKDF2-HMAC-SHA256) | Built and unit-tested (round-trip, tamper detection, wrong-key rejection, KDF timing) |

Nothing here claims real-device Apple/Google authentication has succeeded —
it has not been attempted, because no real provider credentials exist in
this environment.

## 2. Backend environment variables

Add these to the backend's environment (never commit real values):

| Variable | Purpose | Secret? |
|---|---|---|
| `SESSION_JWT_SECRET` | Signs this backend's own session tokens (issued after a verified Apple/Google sign-in). | **Yes — server-only.** |
| `GOOGLE_CLIENT_IDS` | Comma-separated Google OAuth client ID(s) this backend accepts as the audience of a Google ID token (typically the iOS + Android + Web client IDs from the same Google Cloud project). | No (public identifiers), but must match exactly. |
| `APPLE_AUDIENCE_IDS` | Comma-separated Apple bundle ID / Services ID(s) this backend accepts as the audience of an Apple ID token (e.g. `com.quranheals.app`). | No (public identifiers). |

The server refuses to boot in `NODE_ENV=production` with the default
development `SESSION_JWT_SECRET` — see `backend/src/config/env.ts`. Google
and Apple verification each throw a clear error at first use if their env
vars aren't set, rather than silently accepting unverifiable tokens.

Never add a real Apple private key or Google client secret anywhere in this
project — the identity-token verification implemented here needs neither
(see §5).

## 3. Google Cloud Console setup (manual)

1. Create (or reuse) a Google Cloud project.
2. Configure the OAuth consent screen (External, or Internal if using
   Google Workspace).
3. Create an OAuth 2.0 Client ID for each platform you ship:
   - **iOS**: bundle identifier `com.quranheals.app` (see `mobile/app.json`).
   - **Android**: package name + SHA-1 signing certificate fingerprint.
   - **Web** (used for Expo Go / development, and web builds): authorized
     redirect URI from `expo-auth-session`'s `makeRedirectUri()` — for a
     managed/Expo Go dev session this is typically
     `https://auth.expo.io/@<expo-username>/quran-heals`; for a standalone
     build it's the app's own custom scheme (`quranheals://oauthredirect`,
     matching `mobile/app.json`'s `"scheme": "quranheals"`).
4. Put the resulting client IDs into:
   - Mobile: `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (public identifiers — safe as `EXPO_PUBLIC_*`, unlike a secret).
   - Backend: `GOOGLE_CLIENT_IDS` (comma-separated list of the same values).

## 4. Apple Developer setup (manual)

1. In the Apple Developer portal, enable **Sign In with Apple** capability
   for the app ID `com.quranheals.app`.
2. In Xcode/EAS build config, the `usesAppleSignIn: true` flag is already
   set in `mobile/app.json`'s `ios` block — this adds the required
   entitlement automatically on the next native build.
3. No client ID configuration is needed on the mobile side — Apple's native
   `expo-apple-authentication` module uses the app's own bundle ID as the
   audience automatically.
4. Set the backend's `APPLE_AUDIENCE_IDS` to `com.quranheals.app` (and any
   additional Services ID you use for a web sign-in flow, if ever added).

Apple Sign In is iOS-only in this implementation (`isAppleSignInSupportedPlatform()`
in `mobile/src/auth/appleAuth.ts`) — there is no Android or web Apple button,
which matches Apple's own native-module availability.

## 5. Why no Apple private key or Google client secret is needed

Both providers issue a signed **identity token** (a JWT) to the device on
sign-in. This backend verifies that token's signature directly against each
provider's public keys:

- **Google**: `google-auth-library`'s `OAuth2Client.verifyIdToken` fetches
  Google's public JWKS itself.
- **Apple**: `jsonwebtoken` + `jwks-rsa` fetch and cache Apple's public JWKS
  from `https://appleid.apple.com/auth/keys`.

A private key (Apple) or client secret (Google) is only needed for
server-to-server calls this app doesn't make in this phase — e.g. revoking
a token block-side. If that's added later, keep the private key itself
**out of `EXPO_PUBLIC_*` and out of the mobile bundle entirely** — it would
be a server-only secret, exactly like `MONGODB_URI` today.

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
