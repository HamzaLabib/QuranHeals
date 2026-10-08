# Legal documents (D3) — drafts, data inventory and publication steps

Everything in this folder is a **draft that needs legal and product approval**. Nothing here is published, and the app links to nothing until you host reviewed pages and set their URLs.

| File | Purpose |
|---|---|
| `privacy-policy.en.md` / `.ar.md` | Privacy Policy (English / Modern Standard Arabic) |
| `terms-of-use.en.md` / `.ar.md` | Terms of Use |
| `account-deletion.en.md` / `.ar.md` | Public account-deletion page (required by Google Play; linked from App Store Connect) |

The Arabic versions are written in Modern Standard Arabic, which is what the app's `ar` and `ar-EG` locales already use for general and settings text, and they reuse the app's own terms (الإعدادات، الحساب، منطقة الخطر، حذف الحساب، خواطر، كلمة المرور). They should be reviewed by a fluent legal reviewer; decide whether the English text controls if the two differ.

## Before publishing: decisions to make

Every `[TO CONFIRM]` / `[للتأكيد]` in the drafts. In particular:

1. **Operator identity and contact**: legal name, postal address, privacy and support email.
2. **Governing law / jurisdiction**, and the matching liability wording.
3. **Minimum age** (13 is the usual floor; higher in some countries).
4. **Issue-report retention.** Reports (with optional email) are kept indefinitely today; nothing deletes them. Pick a period (for example 12 months). Enforcing it needs either a periodic manual cleanup or a MongoDB TTL index on `issuereports.createdAt`. A TTL index **deletes existing production documents** as soon as it is built, so it is a production data change that needs explicit approval; it was not added.
5. **Backup retention** for MongoDB Atlas (check the cluster's backup policy) and the hosting regions of Render and Atlas (international-transfer wording).
6. **Whether Sentry is enabled** at launch (backend only; the mobile app has no crash reporting).
7. **Deletion requests by email** (users who cannot open the app): who handles them, the reply time, and how ownership is verified. Suggested: ask the user to sign in once more if possible; otherwise match the provider and email on the account, and delete with a reviewed, logged procedure. There is no admin deletion tool yet; deleting by hand means removing the same collections as `MongooseAccountDeletionService` (and revoking Apple tokens), so a small reviewed script should be written before the first request.

## Data inventory (source for every statement in the policy)

Verified against the code in October 2026. Update the policy whenever this changes.

**On the device only** (`mobile/src/storage/`, `mobile/src/localization/`, `mobile/src/theme/`, `mobile/src/auth/sessionStorage.ts`)
- Reflections in plaintext (AsyncStorage, per-account and guest partitions), plus kept "other versions" from concurrent edits (`mobile/src/storage/reflectionConflicts.ts`, account partitions only, cleared on account deletion); favorites; recent-ayah history (10-minute non-repeat); emotions cache.
- Settings: locale, translation display mode, appearance, Quran font size.
- Signed in: cached profile (`id`, `provider`, `email?`, `createdAt`) in AsyncStorage; access and refresh tokens and the unwrapped reflection master key in SecureStore.
- Sign-out keeps reflections and favorites. Account deletion clears that account's reflections and favorites on the deleting device (`mobile/src/auth/useAuth.tsx` `deleteAccount`).

**On the backend (MongoDB), only for signed-in users** (`backend/src/models/`)
- `User`: provider, providerSubject, email?, emailVerified?, timestamps.
- `Session`: userId, refreshTokenHash, previousRefreshTokenHash, expiresAt (60-day sliding, TTL-deleted), revokedAt, rotatedAt. No IP or user agent.
- `UserFavorite`: verseKey, deleted, timestamps. `UserPreference`: locale, translationDisplayMode, translationId, updatedAt.
- `UserReflection`: verseKey, ciphertext, nonce, encryptionVersion, keyFingerprint, encrypted `conflictVersions`, deleted (tombstone), timestamps.
- `UserSyncKey`: wrappedKey, nonce, salt, kdfIterations, encryptionVersion, keyFingerprint.
- `AppleCredential`: AES-256-GCM-encrypted Apple refresh token (for revocation on deletion).
- `IssueReport` (no userId): category, comment?, email?, verseKey?, surahNumber?, ayahNumber?, emotionKey?, appLocale?, translationDisplayMode?, appVersion?, platform?, status, createdAt.
- Account deletion (`backend/src/services/MongooseAccountDeletionService.ts`) deletes every collection above except `IssueReport`, in one transaction, after revoking Apple (Apple accounts) or verifying a fresh Google sign-in.

**Processed, not stored by us**
- IP addresses: hosting provider (Render) and the in-memory rate limiter (`backend/src/middleware/rateLimits.ts`, at most a one-hour window).
- Sentry (if `SENTRY_DSN` is set): error events with request data, user info and breadcrumbs removed and sensitive values scrubbed (`backend/src/monitoring/monitoring.ts`).
- Expo EAS Update: update checks (`app.json` `updates.url`).
- No analytics, advertising or tracking SDKs in `mobile/package.json`.

## Publishing (manual; requires approval)

1. Complete and approve the drafts (legal and product review).
2. **Host them as public web pages** reachable without signing in, for example on the project's website or a static host (GitHub Pages, Netlify, Cloudflare Pages). Use stable URLs such as `/privacy`, `/terms`, `/delete-account` (plus Arabic versions, or one page with a language switch). Convert the Markdown to HTML and remove the draft banner only from the approved, published copy.
3. **Set the URLs per EAS environment** (preview and production) on expo.dev or with `eas env:create`:
   - `EXPO_PUBLIC_PRIVACY_POLICY_URL`
   - `EXPO_PUBLIC_TERMS_URL`
   - `EXPO_PUBLIC_ACCOUNT_DELETION_URL`

   They are public values inlined at build time, so a **new build or OTA update** is needed before they appear in the app (they are JavaScript-only, so an EAS Update to an existing build is enough). Production builds refuse to build until all three are set (`mobile/app.config.ts`).
4. **App Store Connect**: App Privacy → Privacy Policy URL; fill in the App Privacy "nutrition label" from the inventory above (data linked to the user: email address and user ID for account management; user content: encrypted reflections, favorites; not used for tracking). Apple also requires in-app account deletion (already implemented).
5. **Google Play Console**: App content → Privacy policy URL; Data safety form from the inventory (data encrypted in transit; users can request deletion); Data deletion → the account-deletion page URL.
6. Re-check the policy against the inventory whenever data collection changes (new SDKs, crash reporting, new fields).
