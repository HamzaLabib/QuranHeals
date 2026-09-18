# Sync Password improvements

The existing system encrypts reflections with a random 32-byte account master key using XChaCha20-Poly1305. PBKDF2-HMAC-SHA256 (210,000 iterations) derives a password key that encrypts the master key. Only that encrypted wrapper is uploaded; the unlocked master key is cached in SecureStore. Existing local reflection storage is unchanged by this feature.

Setup now requires an exact confirmation and 8–32 Unicode code points, with no composition requirements, trimming, truncation, or normalization. Each password field has its own Show/Hide state. English, Standard Arabic, and Egyptian Arabic use the existing localization system; the Arabic security wording is shared.

Previously, the unlock button used a four-character trimmed length check and the key manager authenticated the ciphertext after submission. The button now waits for the same `unwrapMasterKey` authentication before enabling. Verification is debounced and stale results are discarded. Incorrect unlock input displays no password error. The key manager still authenticates again before caching; legacy passwords have no new length restrictions.

Changing the password decrypts the existing master-key wrapper, derives a new password key, and re-encrypts the same master key with a fresh salt and nonce. A local round trip verifies the replacement before uploading. Rewrapping is the migration appropriate to this envelope encryption design: all reflection ciphertext, conflicts, tombstones, cached keys, and offline devices continue using the same data key. No plaintext reflections are uploaded or newly persisted, and no passwords are persisted. Temporary key arrays are cleared where practical; JavaScript strings cannot be reliably zeroed.

`PATCH /api/sync/key` atomically compares all five fields of the old wrapper and replaces them together in a single MongoDB document update with majority write acknowledgement. A stale concurrent change returns 409. Validation/encryption failures never write, and a failed write leaves a complete old or new wrapper, never a partial one. If the save response is lost, the client reads back the exact replacement to confirm success. If confirmation is also unavailable, it reports uncertainty and reloads the key before another attempt. It never rolls back over a concurrent change. Initial creation is also insert-only to prevent competing setup requests from overwriting a key.

Wrapper version 1 retains its original NFKC password derivation for compatibility. Newly created and changed passwords use wrapper version 2 to distinguish exact input. The cryptographic algorithms, KDF work factor, key sizes, and reflection ciphertext version remain unchanged. An older client with a cached master key continues syncing; an older client needing to unlock a version-2 wrapper must receive this JavaScript update first.

Google/Apple authentication, tokens, session lifetime, sign-out, and recovery behavior are unchanged. Changing the Sync Password does not revoke existing signed-in devices. There is no password recovery or email reset flow.

Deployment: deploy the backend endpoint before exposing Change Password. No native modules or native configuration were added, so this feature can use the existing Expo JavaScript update mechanism on compatible installed runtimes. Ship the reader for version-2 wrappers to all supported clients; old JavaScript cannot unlock new wrappers after losing its cached key. Native/device visual QA remains separate from the automated React rendering tests.

Changed application files:

- `mobile/src/auth/useAuth.tsx`
- `mobile/src/components/AccountSection.tsx`
- `mobile/src/components/ChangeSyncPasswordSheet.tsx`
- `mobile/src/components/SyncPassphraseSheet.tsx`
- `mobile/src/components/SyncPasswordField.tsx`
- `mobile/src/crypto/reflectionEncryption.ts`
- `mobile/src/localization/messages.ts`
- `mobile/src/sync/syncApi.ts`
- `mobile/src/sync/syncKeyManager.ts`
- `mobile/src/sync/useVerifiedSyncPassword.ts`
- `mobile/src/utils/syncPasswordValidation.ts`
- `backend/src/controllers/syncController.ts`
- `backend/src/routes/syncRoutes.ts`
- `backend/src/services/MongooseSyncRepository.ts`
- `backend/src/services/SyncRepository.ts`
- `backend/src/validators/syncValidators.ts`

Tests added/updated:

- `mobile/tests/localization.test.ts`
- `mobile/tests/reflectionEncryption.test.ts`
- `mobile/tests/syncKeyManager.test.ts`
- `mobile/tests/syncApi.test.ts`
- `mobile/tests/syncPassphraseMandatory.test.ts`
- `mobile/tests/syncPassphraseWording.test.ts`
- `mobile/tests/syncPasswordSheets.test.ts`
- `mobile/tests/syncPasswordValidation.test.ts`
- `backend/tests/account/fakes.ts`
- `backend/tests/account/syncPasswordChange.test.ts`

This report is `docs/auth-and-sync/sync-password-improvements.md`.

Verification:

- Mobile: `npm test -- --reporter=dot --maxWorkers=2` passed all 744 tests in 51 files, including authentication, encrypted reflections, localization, and RTL regressions. A previous run alongside other checks hit the existing asset test's five-second timeout; the bounded-concurrency full rerun passed.
- Backend account/auth/sync: `npm test -- --reporter=dot tests/account` passed all 98 tests in 9 files.
- Full backend: `npm test -- --reporter=dot --maxWorkers=2` passed all 727 tests in 49 files.
- Mobile and backend: `npm run typecheck` passed.
- Mobile: `npm run lint` passed with no errors or warnings.
- Missing local dependencies were restored without changing package manifests or lockfiles. The locally installed React test renderer was matched to React 19.2.3.
- Rendering tests use mocked React Native host components; no physical iOS/Android device or emulator visual test was run. Backend persistence tests verify the actual conditional MongoDB query and exercise routes against the in-memory repository; no live MongoDB migration was performed.
