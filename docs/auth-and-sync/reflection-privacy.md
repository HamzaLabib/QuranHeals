# Reflection (خواطر) privacy and cross-device key recovery

This document describes exactly how private reflection sync works, what
Quran Heals staff can and cannot see, and what happens if a user loses
their Sync Passphrase. It intentionally avoids overstating the guarantee.

## 1. What is and isn't encrypted

Encrypted, on-device, before any network request:

- The reflection text itself (`ciphertext`).

Never sent to or stored by the backend in plaintext:

- Reflection text, previews, summaries, keywords, sentiment, or any
  AI-derived analysis of a reflection (none is ever computed — see Part D
  §21/§22 of the product spec).

Stored by the backend, and visible to Quran Heals staff with database
access:

- Which `verseKey` a reflection exists for (not what it says).
- `ciphertext`, `nonce`, `encryptionVersion` — the encrypted bytes and the
  format version, meaningless without the reflection master key.
- `createdAt`/`updatedAt` timestamps.
- The wrapped (still-encrypted) reflection master key blob, its KDF salt,
  and iteration count (`UserSyncKey` — see §3). **Not** the key itself.

## 2. Cryptographic primitives (nothing hand-rolled)

- **AEAD cipher**: XChaCha20-Poly1305 via `@noble/ciphers` (`chacha.js`).
  Authenticated encryption — tampering with ciphertext or the nonce fails
  decryption loudly (`decryptReflectionText` throws) rather than silently
  returning corrupted plaintext.
- **Key derivation**: PBKDF2-HMAC-SHA256 via `@noble/hashes`, 210,000
  iterations by default (`DEFAULT_KDF_ITERATIONS` in
  `mobile/src/crypto/reflectionEncryption.ts`) — meets the 2023 OWASP
  minimum recommendation for PBKDF2-HMAC-SHA256.
- **Randomness**: `expo-crypto`'s `getRandomBytes` (a CSPRNG), used for
  every nonce, salt, and the master key itself. Never `Math.random()`.
- Both libraries are maintained, widely used (they underpin much of the
  `noble-*`/`viem`/`ethers` ecosystem), and were chosen specifically so no
  custom cryptographic composition was needed beyond calling their
  documented high-level functions.

## 3. The key model: master key + wrapped key

Every account that turns sync on has exactly one **reflection master key**
— a random 32-byte key, generated on-device
(`generateMasterKey` in `reflectionEncryption.ts`), used to encrypt every
one of that account's reflections.

The master key itself is never uploaded. Instead:

1. The user is asked to set a **Sync Passphrase** — separate from their
   Apple/Google login, and never sent to Apple, Google, or Quran Heals'
   backend.
2. The passphrase is run through PBKDF2 (with a random salt) to derive a
   *wrapping key*, used only to encrypt (wrap) the master key.
3. The backend stores only: the wrapped (encrypted) master key, the PBKDF2
   salt, and the iteration count (`UserSyncKey` model,
   `backend/src/models/UserSyncKey.ts`). None of these three values, alone
   or together, let the backend recover the master key — that requires the
   passphrase, which the backend never has.

## 4. How a second device gets access

1. The user signs in with Apple/Google as usual (this proves *identity*,
   not *decryption ability* — see the note below).
2. The app checks whether the account already has a `UserSyncKey` on the
   backend.
   - **No** (first device to ever turn sync on): the app generates a new
     master key and asks the user to **set** a Sync Passphrase, then
     uploads the wrapped key as in §3.
   - **Yes** (a later device, or reinstalling): the app downloads the
     wrapped key and asks the user to **enter** the *same* Sync Passphrase
     they set on the first device, derives the same wrapping key locally,
     and unwraps the master key.
3. Once unwrapped, the master key is cached in the device's Keychain/
   Keystore (`expo-secure-store`, see `mobile/src/auth/sessionStorage.ts`)
   so the user isn't asked for the passphrase on every app open — only the
   first time each device needs it.

**Important**: Apple/Google login is only ever used to prove *which
account* a device belongs to. It does **not** and cannot provide the
reflection encryption key — that would mean Apple or Google (or a stolen
session token) could decrypt reflections, which defeats the purpose. This
is why a separate Sync Passphrase exists.

## 5. What happens if the passphrase is lost

If a user forgets their Sync Passphrase, and no device they still control
has already cached the unwrapped master key, their reflections **cannot be
recovered by anyone, including Quran Heals**. This is the direct, disclosed
trade-off of the backend never holding a plaintext key — the same trade-off
every true end-to-end-encrypted product with a user-held key makes (e.g. a
password manager's master password). There is no "reset my Sync
Passphrase" flow in this phase; adding one that doesn't reintroduce
server-side plaintext access is future work, not a compromise made here.

Signing out and back in with Apple/Google does **not** by itself lose
access — it only re-authenticates identity. The reflections themselves,
locally, are also never deleted on sign-out (Part H §32) — a lost
passphrase only blocks *decrypting new cloud data on a device that doesn't
already have the plaintext*, never the local reflections already on a
device.

## 6. What "cannot read plaintext" actually means here

- Quran Heals staff with production database access can see: which
  verseKey a user reflected on, when, and the ciphertext/wrapped-key bytes.
  They cannot derive the plaintext reflection text or the master key from
  that alone.
- This is **not** marketed as "end-to-end encrypted" in absolute terms
  beyond what's implemented: the mobile app itself, while running, does
  hold the plaintext (necessarily, to display it to the user) and the
  unwrapped master key (cached in Secure Store). A compromised device or a
  malicious build of the app could still access plaintext reflections on
  that device — the guarantee is specifically that the **backend/database**
  never sees plaintext or an unwrapped key, not that no device anywhere
  ever holds one.
- No AI processing, analytics, or derived-metadata extraction is ever run
  over reflection content, encrypted or not (Part D §21/§22).

## 7. Conflict handling during sync

Per-verseKey, last-write-wins by the reflection's own `updatedAt`
timestamp, compared across devices (`backend/src/services/MongooseSyncRepository.ts`'s
`putReflections`). If two devices produce genuinely different ciphertext at
the *exact same* timestamp (an ambiguous tie), both versions are kept — the
losing version is appended to `conflictVersions` on the stored record
rather than discarded (Part D §29). There is no UI yet for surfacing a
conflict to the user for manual resolution; the data is preserved, but
resolving it today would require reading `conflictVersions` directly. This
is a known, disclosed limitation.
