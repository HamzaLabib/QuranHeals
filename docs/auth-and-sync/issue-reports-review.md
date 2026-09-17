# Reviewing submitted issue reports (developer/admin)

This is an internal operations note, not user-facing documentation. It
explains how to manually review reports submitted through **Report an
Issue**. There is no in-app admin dashboard, email notification, or webhook
for this — reports are reviewed by hand in MongoDB Atlas.

## What this feature is (and isn't)

- `POST /api/issues` is the only endpoint. It accepts a report from a guest
  or a signed-in user identically — no account data is auto-attached (see
  `docs/auth-and-sync/data-behavior.md`'s "Issue reports" row).
- There is **no** `GET /api/issues` route, no admin UI, and no email
  delivery of any kind (no SMTP/SendGrid/Resend/etc. is installed or
  configured). The optional `email` field a user types into the report form
  is stored only so a developer can manually follow up — it is never used
  to auto-send anything.
- Reports are saved in their own `IssueReport` collection, completely
  separate from Quran/emotion/mapping/user/favorite/reflection/sync
  collections. The repository interface
  (`backend/src/services/IssueReportRepository.ts`) exposes exactly one
  method (`create`) — there is no code path from this feature that can read
  or write any other collection.

## How to review reports

1. Open **MongoDB Atlas**.
2. Select the **Quran Heals** cluster.
3. Click **Browse Collections**.
4. Open the application's database, then the **`issuereports`** collection.
   - This is Mongoose's default pluralized/lowercased name for the
     `IssueReport` model (`backend/src/models/IssueReport.ts`) — there is no
     custom `collection` override.
   - **The collection will not exist/appear until the first report is
     submitted** — this is expected on a fresh environment, not a bug.
5. Sort by `createdAt` **descending** to see the newest reports first. A
   descending index on `createdAt` already exists on the collection
   (`issueReportSchema.index({ createdAt: -1 })`) specifically so this sort
   stays fast as the collection grows.

## What's on a report document

Only the fields below are ever present — the request validator
(`backend/src/validators/issueValidators.ts`) whitelists exactly this set
via zod, and anything else sent by a client (a stray `reflection`,
`userId`, `syncPassphrase`, etc.) is silently stripped before it ever
reaches the database:

| Field | Notes |
|---|---|
| `category` | One of the five approved categories. |
| `comment` | Optional, user-typed, max 2000 characters. |
| `email` | Optional, only if the user typed one into the form — never the signed-in account's email. |
| `verseKey`, `surahNumber`, `ayahNumber` | Optional Quran reference context, validated against the real verse range. |
| `emotionKey` | Optional, only present for the 29-emotion flow. |
| `appLocale`, `translationDisplayMode` | The reporter's app settings at submission time. |
| `appVersion`, `platform` | Automatic app/device context — never a device identifier. |
| `status` | Always `"new"` on creation — there is no status-transition feature yet; a reviewer changes this by hand in Atlas if/when a workflow is added. |
| `createdAt` | Set automatically by Mongoose (`timestamps: { createdAt: true, updatedAt: false }`). |

**Never present, by design**: Quran Arabic text, translation text,
reflection text/ciphertext, device identifiers, IP addresses, auth tokens,
encryption keys, or sync passphrases. See
`backend/tests/account/issues.test.ts` for the tests that lock this in.

## If you need to change review workflow later

Anything beyond manual Atlas review (statuses beyond `new`, an admin
dashboard, email notifications) is a deliberately separate, not-yet-built
feature — don't bolt it onto this repository/validator without updating
this doc and the tests above that assert the current whitelist and status
enum.
