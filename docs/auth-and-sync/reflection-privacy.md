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
- For a **deleted** reflection: just the `verseKey` and the deletion
  timestamp (a durable tombstone — see §8). Never the reflection text that
  used to exist there, encrypted or not.

## 2. Cryptographic primitives (nothing hand-rolled)

- **AEAD cipher**: XChaCha20-Poly1305 via `@noble/ciphers` (`chacha.js`).
  Authenticated encryption — tampering with ciphertext or the nonce fails
  decryption loudly (`decryptReflectionText` throws) rather than silently
  returning corrupted plaintext.
- **Key derivation**: PBKDF2-HMAC-SHA256, 210,000 iterations for newly
  wrapped keys (`DEFAULT_KDF_ITERATIONS` in
  `mobile/src/crypto/reflectionEncryption.ts`), computed natively when the
  app binary includes the PBKDF2 module and with `@noble/hashes` otherwise
  (identical output; see `mobile/src/crypto/pbkdf2.ts`). This is **below**
  OWASP's current recommendation of 600,000 iterations for
  PBKDF2-HMAC-SHA256; an earlier version of this document wrongly said it
  met it (210,000 was OWASP's former figure for PBKDF2-HMAC-SHA512). See
  "Work factor" below.
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
   passphrase, which the backend never has. They do allow **offline
   guessing**: anyone holding the database can try passwords against the
   wrapped key without rate limits. The PBKDF2 work factor and the
   password's strength are what make that expensive (see "Work factor").

### Work factor

- Each wrapped key stores its own `kdfIterations`, and unwrapping always
  uses that stored value. Changing `DEFAULT_KDF_ITERATIONS` therefore
  affects only keys wrapped afterwards (new setups and password changes);
  every existing key keeps unlocking exactly as before. Tests:
  `mobile/tests/pbkdf2Compatibility.test.ts` and
  `mobile/tests/reflectionEncryption.test.ts`.
- The backend accepts 1,000–10,000,000 iterations
  (`backend/src/validators/syncValidators.ts`), so an increase needs no
  backend or format change, and app versions already installed can unlock
  keys created with a higher count (they read it from the key; only slower).
- **Pending: raise new keys to 600,000.** Gated on real-device timing of the
  native PBKDF2 path on iOS and Android (use the `[pbkdf2]` timing logs —
  `EXPO_PUBLIC_KDF_TIMING=1` — on a preview build). Not done yet because it
  roughly triples derivation time and, without the native module (Expo Go,
  builds from before it), the JS fallback would take tens of seconds.
  Before raising it, also consider how long older installed builds would take
  to unlock a 600,000-iteration key created on a newer device.
- **Never** automatic: existing keys are not silently re-wrapped with new
  parameters. Users who want the stronger setting can change their sync
  password once the default is raised (password change re-wraps the same
  master key; reflections are untouched). An opt-in "re-secure with the same
  password" action would need a small new flow, since password change
  currently requires a different password.

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
rather than discarded (Part D §29).

Last-write-wins decides which text is *current* on every device. Since
October 2026 (D5) the text that loses is no longer discarded:

- **Concurrent edits are detected on the device.** Each unsynced local
  edit records the synced version it was based on (`baseUpdatedAt` in
  `mobile/src/storage/ayahReflections.ts`). If the cloud now holds a
  different version, the two changes were made without seeing each other.
  `mobile/src/sync/reflectionsSync.ts` then keeps the losing text locally
  before anything is uploaded or overwritten: this device's unsynced text
  when the other device's change wins (including a newer deletion), or the
  other device's text when this device's newer edit or deletion replaces it.
  Sequential edits (made after seeing the other version) are unaffected.
- **Server-preserved tie versions** are fetched with
  `GET /api/sync/reflections/conflicts` (read-only, ciphertext only, the
  caller's own account) and decrypted on the device.
- **Kept versions** live in the account's local partition
  (`mobile/src/storage/reflectionConflicts.ts`): plaintext, like every local
  reflection, never uploaded, removed on account deletion, and invisible to
  other accounts on the device.
- **The user decides.** My Reflections marks affected ayahs ("Another version
  to review", or "No current reflection, but another version was kept" when only the kept version
  remains). The reflection editor shows each version with *Use this
  version*, *Add to my text* (keep both; offered only when the result fits
  the 2,000-character limit), *Copy* and *Discard* (with confirmation).
  Nothing is written until the user taps Save, and the chosen text then
  syncs as an ordinary encrypted edit. A version is marked handled only if
  its text is actually in the saved reflection; otherwise it stays to
  review. Deleting a reflection does not delete its kept versions; only
  *Discard* (or account deletion) removes them.
- **Edits during a sync are safe.** Sync writes downloaded versions and
  "synced" labels only if the local entry is still the one it read when it
  started, so a reflection saved or deleted while a sync runs is never
  overwritten; the next sync handles it.

Limits: a kept version exists on the device that detected the conflict,
not on every device. Server `conflictVersions` are never deleted by the
server; a version handled on one device is not offered again on that device
but may be offered once on another. The first sync after upgrading may
offer an older version of a reflection that was edited but not yet synced
before the upgrade, because such edits have no recorded base.

## 8. Deletion tombstones

Clearing a reflection's text (there is no separate delete button — see
`mobile/src/components/ReflectionSheet.tsx`) does not simply erase the
local entry. It replaces it with a **durable local deletion tombstone**
(`ReflectionTombstone` in `mobile/src/storage/ayahReflections.ts`):

```text
{ verseKey, deletedAt, syncState }
```

A tombstone carries **no reflection content whatsoever** — no ciphertext,
no nonce, no plaintext, nothing to encrypt. It exists purely so the
deletion itself can be synced like any other change, using the same
last-write-wins timestamp comparison as an active reflection.

**Why not just delete the row?** Reflection sync is not a single
request/response — it is a "download everything newer than what I have"
model across possibly-offline devices (§4, §7). If a deleted reflection
were simply removed from local storage and the backend, an older device
that hadn't synced in a while (or a backend record fetched before the
deletion propagated) could re-upload or re-download the pre-deletion
ciphertext, silently un-deleting a reflection the user explicitly removed.
A tombstone is the standard fix: deletion becomes a normal, comparable,
last-write-wins write instead of an un-trackable absence.

**On the backend**, a tombstone is stored as a `deleted: true` flag on the
*same* `UserReflection` document (`backend/src/models/UserReflection.ts`)
rather than a hard delete or a second collection — the existing
`(userId, verseKey)` uniqueness and last-write-wins comparison keep working
unchanged, and a pre-existing document from before tombstones existed
(`deleted` absent) is simply read back as an active record, so no migration
was needed. When `deleted` is `true`, `ciphertext`/`nonce`/
`encryptionVersion`/`createdAt` are all absent — there is nothing to read
even with full database access.

**Last-write-wins rules** (same on both the client's merge and the
backend's `putReflections`):

- A newer tombstone defeats an older active record — the deletion wins, and
  the ciphertext is cleared.
- A newer active record defeats an older tombstone — this is how
  intentionally writing a new reflection for a previously-deleted verseKey
  "undoes" the deletion; the tombstone is replaced.
- A tombstone is **never erased just because it successfully synced** — it
  stays as a synced tombstone (`syncState: 'synced'`) indefinitely, exactly
  like an active reflection stays as a synced active record. This is
  deliberate: an offline device that reconnects days later and still holds
  the pre-deletion reflection must be told "this was deleted after your
  last sync," which only works if the tombstone is still there to compare
  against.
- An exact-timestamp tie between an active record and a tombstone always
  resolves to **the tombstone**, regardless of which side was already
  stored and which side just arrived — deletion wins ties. This is what
  keeps every device and the backend convergent: without a deterministic
  rule, one side could keep its active copy while the other kept its
  tombstone, and the two would never agree. A tombstone-vs-tombstone tie is
  idempotent (no state change), and this never produces a repeated upload
  once both sides agree. Only two *active* records at an exact tie can
  still produce an ambiguous content conflict (§7) — a tie involving a
  tombstone has no content to disagree about, so there's nothing to
  preserve as a conflict.

**What stays local-only**: tombstones are excluded from every user-facing
read (`getReflection`, `getAllReflections` in `ayahReflections.ts`) and
never appear in the My Reflections list or anywhere else in the UI — they
are purely a sync bookkeeping mechanism, invisible by design.
