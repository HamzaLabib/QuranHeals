# Phase 4.8.3: automatic publication of human-verified ayah timing (2026-10-19)

**State:** implemented and tested on this computer only.

| | Status |
|---|---|
| Implemented | yes |
| Tested locally (synthetic data, temporary databases) | yes |
| Deployed | **no** |
| Automatic publication enabled | **no** (`PUBLICATION_MODE=off` by default) |
| Mobile build or OTA update with the new loader | **no** |
| Committed | **no** |

No Development or Production database, catalogue, timing file or review log was changed.

## 1. The process before this phase (what was the source of truth)

```
alignment (tools/quran-audio/alignment, MMS CTC)        → review packages (review/make-packages.mjs)
review dashboard (review/dashboard, review/manual)       → append-only hash-chained review logs (events.jsonl / PostgreSQL)
two-reviewer verification (manual-lib.mjs recordingStatus/finalTiming)
export (review/manual/export.mjs)                        → a JSON file the owner downloads
apply (development/apply-review.mjs, by hand)            → development/development-timing.json (development builds only)
catalogue (generate-catalog.mjs: audit-results.json, measured-timing.json, development-timing.json)
                                                         → mobile/src/audio/generated/*.ts (shipped inside the app)
mobile timing loader (audio/timing.ts)                   → MP3Quran's timing API (fingerprint-checked) or the shipped measured timing
source registry + resolver (sourceRegistry.ts, sources.ts) → the catalogue's MP3Quran file
playback engine (engine.ts)                              → seeking, highlighting, Repeat Ayah, continuous playback
```

So the app's timing came only from **files built into the app**. A newly verified surah needed:

1. the owner exporting the review;
2. running `apply-review.mjs`;
3. regenerating the catalogue;
4. a new build.

`apply-review.mjs` wrote development timing only. Production was a separate manual decision.

## 2. What changes

- **The source of truth for published human-verified timing** is now the **verified audio registry**: new tables in the review service's own PostgreSQL. The app reads it at run time.
- **Generated files are unchanged.** The worker never writes to `audit-results.json`, `measured-timing.json` or the generated catalogue files. They stay as historical and source-generated data.
- **The registry cannot be overwritten by a regeneration.** It is consulted first, at run time.

| Piece | File | Role |
|---|---|---|
| Gate rules (pure) | `tools/quran-audio/review/cloud/publication-rules.mjs` | Which recording may be published, and the exact immutable document |
| Registry | `review/cloud/registry.mjs` (schema in `db.mjs` migrate, schema version 2) | Recordings, immutable versions, per-environment pointers, append-only log, jobs, authorizations, file hashes |
| Worker | `review/cloud/publisher.mjs` | Event-driven and periodic; durable jobs; publishes and withdraws |
| Service | `review/cloud/server.mjs` | Public read-only app API; status and administrator controls |
| Audio evidence | `review/cloud/audio.mjs` | Streams and hashes the provider's file (nothing kept); records byte-range support; reads the MP3 encoder frame (CBR/VBR) |
| Backups | `review/cloud/backup.mjs` | The registry tables included; restores verified |
| Dashboard | `review/dashboard/dashboard.html` | **Publication** tab (cloud only) |
| App: model and cache | `mobile/src/audio/verifiedTiming.ts` | Manifest and version validation, device cache, refresh, hold-while-playing |
| App: instance | `mobile/src/audio/verifiedCatalog.ts` | Configuration, start, foreground refresh |
| App: availability | `mobile/src/audio/availability.ts` | One answer to "can this surah play?" for the engine and the UI |
| App: existing modules extended | `timing.ts`, `engine.ts`, `sources.ts`, `index.ts`, `storage.ts`, `format.ts`, `AyahAudioButton.tsx`, `MushafAudioPlayer.tsx`, `app/_layout.tsx` | No second engine |

## 3. Recording identity

- **Identity:** a published recording is identified by the reciter id, surah, provider, URL, size in bytes and SHA-256 of the file. Its duration and format are recorded too.
  - `recordingId` = `rec_` + SHA-256 over those values.
  - The SHA-256 is computed **by the review service** from the provider's file, either while drawing the waveform or by a streamed hash (`source_hashes`). It is never taken from the client.
- **Two recordings of one surah** are two registry entries, so one can never overwrite the other.
- **Ayahs** are identified by their canonical verse id (`98:3`) within that recording.
- **The app checks the identity** before using a version:
  - the URL, size, SHA-256 and duration in the document must equal the manifest's;
  - the app plays exactly that URL;
  - a file outside the audited catalogue is size-checked (and checked for redirects) before it plays.

## 4. The completion gate (every check must pass)

| Group | Check | Pending until | Fails when |
|---|---|---|---|
| review | Reviewer 1 and Reviewer 2 each made the **final** whole-recording submission | submitted | — |
| review | Two different people (names; separate accounts where recorded) | both joined | Same name or account |
| review | Blind review | both complete | (Enforced by the server's views; a change after the reveal never counts as agreement) |
| review | Every boundary agreed (≤ 250 ms) or formally resolved (propose + accept by the other reviewer) | both complete | Dispute or unresolvable |
| review | Every whole-recording question answered "yes" by both | both complete | `no` / `unsure` |
| review | Hash chain intact | events exist | Broken |
| review | A whole-recording review | — | Production boundary checks (findings only) |
| review | Real data | — | Synthetic data (allowed only in test registries) |
| technical | Canonical (Kufan) ayah count | — | Different count |
| technical | Every ayah inside the recording, in order, positive length, no overlap | verified | Invalid |
| technical | The exact file (size + SHA-256, hashed by the server) | hashed | Different file |
| technical | The provider still serves exactly that size, with byte ranges | checked | Different size or no ranges (an outage stays pending and is retried) |
| technical | CBR (the app never plays VBR ayah by ayah) | file read | VBR, or the mode not established |
| technical | A reciter of the app; an https source of a known provider | — | Unknown |
| authorization | An administrator's recorded authorization (provider, optionally reciter or exact file), with evidence | — | None or revoked; **a working URL is never permission** |
| authorization | Riwayah Hafs, recorded with the authorization | — | Anything else |
| authorization | A rights notice in the file (e.g. «Reserved For KFGQPC») is acknowledged by an authorization of **that exact file** | — | Not acknowledged |
| conflict | No **other** recording of the same reciter and surah is active | — | Another is active: an administrator chooses |

**Listening:** Phase 4.8.4.1's decision stands. No playback telemetry is required, and none is treated as evidence of listening.
- The published document says only "two-reviewer human verification". It contains no listening claim (tested).
- Bulk acceptance is one reviewer's attestation inside that reviewer's own review. It cannot satisfy the second reviewer's independent final submission or a resolution.

## 5. Registry, versions and environments

- **Versions are immutable.** `timing_versions` rows cannot be updated or deleted (a trigger refuses it).
  - The version id is derived from the recording and its timing. Processing the same review twice, or a duplicate completion event, reuses the version and changes no pointer.
  - Changed timing for the same recording (an amendment or a new resolution) becomes version *n+1*.
- **Development and Production** are two pointers, `environment_activations(environment, recording)`, to the **same** version.
  - The worker sets both in **one transaction**. An interruption leaves both unchanged; nothing ever reports a half update (tested by failing Production mid-transaction).
  - An administrator can still move one environment alone (a rollback). The result is shown as a **mismatch** until "Align both".
- **The review evidence stays beside each version**, never inside it: the review head hash, event count, reviewers, accounts, submission times, every check, the file hash and the source check. The review log itself is never touched.
- **Publication history is append-only.** `publication_log` records every creation, activation, withdrawal, rollback, alignment, hold, authorization and job failure, with its actor.

**Why the registry is not in the backend's MongoDB:** publishing into the Development and Production MongoDB databases would put production write credentials into the review service.
- With the registry design, the review service holds no app database credentials at all, and reviewers never touch one.
- The app reads published timing over HTTPS from the review service's public read-only API.
- If the owner prefers, the backend can later proxy that API. Nothing in the app depends on where the API is hosted.

## 6. The worker

- **Triggers:** every accepted review event queues the recording (`publication_jobs`, keyed by recording, with the review log's head hash). Recordings are also queued:
  - at startup;
  - every 6 hours by a sweep (sources, rights and files can change);
  - after an administrator action.
- **Claiming:** jobs are claimed with `FOR UPDATE SKIP LOCKED` and a 5-minute lease.
  - A job left "running" by a stopped server is taken again after its lease (tested).
  - Two instances never work on one recording.
- **Eligible:** create or reuse the version, then point both environments at it.
- **Definitive failure** of a published recording (an amendment reopened a dispute, the authorization was revoked, the provider serves another file): it is **withdrawn** from both environments, and the withdrawal is logged.
  - A temporary failure (the provider is unreachable) is retried with back-off: 2, 4, 8 … minutes, up to 6 h.
- **Modes:** `PUBLICATION_MODE=off` (the default) evaluates and shows status but writes nothing to the registry; `enabled` publishes.

## 7. Recording sources (current state)

| Reviewed recordings | How represented | Status for publication |
|---|---|---|
| Muhammad Rifaat (18, Phase 4.6 manual) | The MP3Quran r1 files (`cdn.mp3quran.net/audio/muhammad-refaat/r1/`), size + SHA-256 in the sessions | The files carry «Reserved For KFGQPC»: blocked until an exact-file authorization acknowledges it. The format is read from the file once both reviews are complete. |
| Saleh Al-Talib (archive.org `saqrsm`, Phase 4.7) | Package with the archive.org URL | Provider `archive` is not authorized (the item was uploaded by an individual, no stated source); identity concern documented. Blocked until authorized. |
| Islam Sobhi (Way2Quran, Phase 4.7) | Package; VBR files | Blocked twice: Way2Quran grants no app use ("Copyright reserved"), and VBR files never play ayah by ayah. A CBR copy hosted with permission would be needed. |
| MP3Quran catalogue recordings (Phase 4.1 aligned, development-stage) | Packages with the catalogue URL | Need an administrator authorization for `mp3quran`; MP3Quran's site-wide statement is recorded as "rights not established". |
| Production boundary checks (283) | Scoped sessions | Never published: findings for the owner. |

**Today: no real recording is eligible.**
- No recording has a Reviewer 2.
- 11 real reviews exist, all by Hamza as Reviewer 1: 5 complete, 6 in progress.
- All 11 review chains verify.
- Backups are in `%USERPROFILE%\Backups\quran-heals-audio-review`.

The app resolver plays a published recording from its own URL. Nothing is copied or mirrored.

## 8. The app

**Configuration** (per EAS build profile; not secret):

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_AUDIO_REGISTRY_URL` | The review service (https). **Unset:** the app behaves exactly as before this phase. |
| `EXPO_PUBLIC_AUDIO_TIMING_ENV` | `development` or `production`. Default: development builds read `development`, all other builds read `production`. |

**Priority, per reciter and surah:**
1. A published human-verified version, with **its** recording.
2. The catalogue's audited or measured timing for the catalogue's file.
3. Unavailable.

A published entry or document that fails validation makes that surah **unavailable**. It never falls back to other timing or another recording (tested).

**Validation:**
- manifest kind and environment;
- ids;
- known reciter;
- canonical ayah count;
- https URL, size, SHA-256 and duration;
- CBR only;
- the document matches the manifest entry;
- verse ids 1..N;
- integer times inside the recording, ordered, positive length, no overlap;
- the fingerprint (computed by the app, identical to the service's; tested with the service's own code);
- `introEndMs`.

**Kept unchanged:** seeking (ayah 1 from the file start), highlighting, Repeat Ayah, continuous playback with ayah tracking, page turns, reciter selection. No untimed whole-surah playback is introduced (tested with the engine). Offline downloads stay off app-wide, as before.

**Refresh and cache, realistically:**
- **When the app checks:** at startup (shortly after the first screen), whenever it returns to the foreground, and when a surah starts loading, at most every 15 minutes. The request is conditional (ETag); the manifest is cacheable for 5 minutes.
- **Timing:** a newly published version is therefore usually visible within minutes of publication when the device is online.
- **During playback:** a new version for the surah being played waits until playback leaves that surah or stops. It is never applied mid-surah (tested).
- **On the device:** documents are stored by version id (immutable; two versions never mix). Documents the manifest no longer refers to are deleted.
- **Offline:** the stored, validated manifest and documents serve. A version never downloaded is a network failure, not other timing.
- **Withdrawals and rollbacks** reach a device at its next successful refresh. An offline device keeps its last validated state until then.

**One-time requirement:** these app changes ship with the next build or OTA update, with `EXPO_PUBLIC_AUDIO_REGISTRY_URL` set for each profile. After that, each newly verified surah needs no build, no file edit and no Claude.

## 9. Dashboard

The cloud dashboard has a **Publication** tab. It shows, per reviewed recording:

- **the exact recording:** provider, URL, size and recording id;
- **the status:**
  - Human Review Pending, Reviewer 1 Complete, Reviewer 2 Complete, Disputed;
  - Independently Verified, shown as a separate badge;
  - Technical Validation Pending, Publication Blocked, Ready for Publication;
  - Published to Development, Published to Production, Published to Both, Publication Failed;
- **the active version** in each environment, with its date;
- **the checks:** blockers, outstanding checks and every check with its evidence;
- **the job:** last error, attempts and next retry;
- **previous versions.**

It also lists the source authorizations and any environment mismatches.

**Administrators only** (enforced by the server, hidden from reviewers; tested):
- Retry now;
- Roll back / withdraw, for either or both environments, with a reason; this holds the recording;
- Release hold;
- Align both;
- Record an authorization, and revoke one with a reason.

## 10. Security

- **Server-side rules only:**
  - the state is rebuilt from the hash-chained log;
  - the reviewer identity comes from the signed-in account;
  - the independent-reviewer, blindness and resolution rules are enforced by `manual-lib`;
  - the client's status is never trusted.
- **Forged or modified packages and history:**
  - a broken chain fails the gate;
  - the version id binds the recording and the timing;
  - the immutable versions and the append-only publication log are protected by database triggers.
- **Least privilege:**
  - the review service holds no Development or Production app database credentials;
  - the public API is read-only and serves only published timing: no reviewer names, accounts, evidence or logs (tested);
  - an unpublished version is never served.
- **Administrator-controlled configuration:** `PUBLICATION_MODE` and `PUBLICATION_ENVIRONMENTS` are service settings. Authorizations and rollbacks need an administrator account.
- **Existing protections apply:** rate limits, body limits, the host check, and CSRF protection for writes.
- **No secret in the app or in source control.** The registry URL is public by design.

## 11. Tests (synthetic data only; temporary databases; no network)

**Unit, integration and app tests:**

| Suite | Result | What it covers |
|---|---|---|
| `mobile/tests/audioPublication.test.ts` | 23/23 | Gate rules for test items 1–10, plus VBR, boundary checks, synthetic data, same account, rights notice, riwayah, outage, tampered history and format detection. Then the real service on PostgreSQL: items 11–15 and 25, a revocation, restart resume, off mode, security, and backup/restore of the registry. |
| `mobile/tests/audioVerifiedTiming.test.ts` | 15/15 | Items 16–24: strict validation, service/app format compatibility, preference over catalogue timing, a new provider (archive.org) with a stream check, a new version, cache GC, 304, hold-while-playing, offline, invalid answers, rollback, and the engine (seek, highlight, Repeat Ayah, continuous). |
| All audio test files | 21 files, 378/378 | Including both new files and the existing cloud suite (with the worker running). |
| Full app suite | 3246 passed | The 37 known `mushafScreen` failures remain: the identical set, by name, to before this phase. |
| Backend | 1634/1634 | Run with `QURAN_HEALS_SKIP_DOTENV=1` and no database URI, so no test could reach a real database. |
| TypeScript, ESLint | clean | |

**Browser check of the cloud dashboard:** 23/23, on a deleted staging copy of the review data.
- The Publication tab shows OFF and "Reviewer 1 Complete" for the real reviews.
- Nothing is published or authorized.
- Controls are visible to the administrator only.
- The public API is empty.
- No CSP violation.

## 12. Deployment and cutover (each step needs the owner's go-ahead)

1. **Deploy the cloud dashboard and migrate the reviews** (Phase 4.8.2 runbook).
   - Build the migration bundle at the cutover, from the data current then: 11 logs today, and growing.
   - `PUBLICATION_MODE` stays `off`.
2. **Review the Publication tab.** Every recording shows its status; the registry stays empty.
3. **Synthetic end-to-end trial,** on a separate throwaway service or database, never the real registry:
   - `PUBLICATION_MODE=enabled`, with synthetic packages and test accounts;
   - point a development build at that throwaway service with `EXPO_PUBLIC_AUDIO_REGISTRY_URL`.
4. **Build or OTA the app with the new loader** (the URL set per profile).
   - Test on Android and iOS: version refresh, seeking, highlighting, Repeat Ayah, continuous playback, offline, and the exact-file stream check.
5. **Record source authorizations** (owner decisions, with evidence) for the providers or files the owner has cleared.
6. **Owner authorizes enabling.** Set `PUBLICATION_MODE=enabled` in Render and restart.
7. **Verify** that Development and Production manifests list identical versions, and the dashboard shows Published to Both.
8. **Monitoring and backups:**
   - Render's backups plus `migrate.mjs backup` (registry included);
   - the `/api/admin/status` `publication` block: job states, mismatches, last failure.

**Rollback procedures:**
- **One recording:** Publication tab → Roll back / withdraw (holds it), then Release hold when fixed.
- **Everything:** set `PUBLICATION_MODE=off`. Nothing new is published; current activations stay until withdrawn individually.
- **The app:** unset `EXPO_PUBLIC_AUDIO_REGISTRY_URL` in the next build or OTA. The app returns to its built-in catalogue.

**Monitoring and failure handling:**
- **Failed jobs:** state `failed` with the last error and the next retry, shown in the dashboard and in `/api/admin/status`; job failures are logged in `publication_log`.
- **Mismatches:** listed in a banner, and as a count in the status.
- **Provider changes:** detected by the 6-hourly sweep (size and byte-range check), leading to withdrawal.
- **The app:** keeps its last validated state when the service is unreachable.

## 13. Remaining blockers (owner action or approval)

1. **The cloud deployment itself** (Phase 4.8.2): approval of the cost (~$13–14/month), the repository, a new Google OAuth client, the administrator token and the reviewer e-mails.
2. **Reviewer 2:** no recording has a second reviewer yet, so nothing can be published.
3. **Source authorizations:** none exists.
   - MP3Quran: decide whether its site-wide statement is enough.
   - Rifaat: KFGQPC notice; an exact-file authorization per file, if cleared.
   - archive.org (Saleh Al-Talib): rights and identity.
   - Way2Quran (Islam Sobhi): no grant, and VBR.
4. **A mobile build or OTA** with the new loader and `EXPO_PUBLIC_AUDIO_REGISTRY_URL` per profile, after device testing on Android and iOS (not done: no device test in this phase).
5. **Enabling** `PUBLICATION_MODE=enabled`: a separate explicit authorization.
6. **Commit and push** of this work: not done.
