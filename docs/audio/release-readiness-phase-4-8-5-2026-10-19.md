# Phase 4.8.5: VBR compatibility, review migration readiness, device testing, publication activation (2026-10-19)

**State:**

| | Status |
|---|---|
| Stage 1 (VBR/CBR) | Implemented and tested |
| Stage 2 (migration) | Prepared and rehearsed on isolated copies; **no real migration** (the cloud is not deployed) |
| Stage 3 (devices) | **No physical device test ran.** An emulator integration run was partial, for the reason in §3. |
| Stage 4 (activation) | **NO-GO.** `PUBLICATION_MODE=off` |

Nothing was committed, pushed, built, deployed or enabled, and no live database was changed.

## 1. VBR/CBR compatibility (Stage 1)

**What the existing research established** (`docs/audio/vbr-recovery-phase-4-3`, `vbr-cross-platform-phase-4-4`; data in `tools/quran-audio/audit-data/vbr-*.json`):

1. **Tested:** all 32 VBR candidates, all MP3Quran files: Yasser Salama 42 and 48, Ajmi 42, and 29 Islam Sobhi surahs. Each is LAME VBR with an Xing table of contents.
2. **Validated ayah alignment:** none of the 32. They have aligned packages and dashboard review tasks, but **no human review** (§1 table).
3. **Browser review:** the cloud service decodes a VBR file losslessly to PCM (`peaks.py --pcm`) and streams that to signed-in reviewers only. Timestamps are therefore on the original file's decoded timeline.
4. **Android:**
   - Media3 1.9.0 uses `XingSeeker` and interpolates, so a seek lands −8.35 s … +5.35 s off (JVM extractor, confirmed on the emulator).
   - Seeks into already-buffered audio *inherit* earlier errors, so JavaScript compensation is unsafe.
   - **The fix:** a native data source that puts an exact ID3 MLLT seek table in front of the **unchanged** stream (`MlltSeeker`: −0.5 … +25.6 ms, the same as production CBR). It was verified on the real extractor (JVM) and in the emulator seek lab. **It is not built.**
5. **iOS:** `AVURLAsset` without the precise-timing option. Whether AVFoundation honours Xing or MLLT is **unknown**; it has never been tested (no Mac or iPhone was available).
6. **Server-side decoding:** used only for browser review. The app streams the original.
7. **The original URL stays unchanged** under the MLLT data-source design (no mirroring).
8. **Native code and new app builds are required** for VBR: a local Expo module or an expo-audio patch, then new development and production builds.
9. **Coordinates:** review timestamps are on the decoded timeline. A CBR file in the app matches it to within one MP3 frame (≤ 26 ms), and MLLT seeking matches it too. A re-encoded CBR copy would be shifted +25.06 ms: a different file and a different timeline.
10. **The old CBR-only rule was not too restrictive for today's app.** Today's app cannot seek VBR exactly, so it was right in effect. It was blanket, though, and is now per recording and per platform (below).

**The new rule** (`review/cloud/publication-rules.mjs` `playbackCompatibility`, `timelineCompatible`):
- **CBR Compatible:** CBR with byte ranges, the method `cbr-exact`, on Android and iOS.
- **VBR:** the method `vbr-mllt`. It is eligible only when *both*:
  - the released app ships that method on both platforms (service setting `APP_AUDIO_CAPABILITIES`; default `{"cbr-exact":["android","ios"],"vbr-mllt":[]}`);
  - an administrator has recorded a **real-device** measurement of that exact file (SHA-256) on Android **and** iOS, within ±60 ms (`seek_verifications`).
  - The server decides pass or fail from the measured error; automated playback never counts.
- **Statuses:** VBR Compatibility Verified, VBR Android Verified / iOS Pending, VBR iOS Verified / Android Pending, VBR Compatibility Pending, Unsupported Recording (a failed measurement, no byte ranges, or a mode that cannot be established), Compatibility Pending (not read yet).
- **New check `timing-coordinates`:** the review timeline must be the original file's decoded timeline, or publication is blocked.
- **In the published document:** each version records `playback: { method, platforms }`.
- **The app** (`verifiedTiming.ts` `APP_SEEK_METHODS = ['cbr-exact']`, with its platform from `EXPO_OS`) refuses, and marks unavailable rather than playing:
  - an entry whose method it does not ship;
  - an entry not verified for its platform;
  - an entry whose method does not match the file.
- **No platform-specific publication is offered:** both platforms are required.
- **No untimed playback anywhere.**

**Recording by recording (all: VBR Compatibility Pending).** Reasons:
- no exact-seek method ships for VBR (the Android MLLT data source is not built; iOS is untested);
- no device measurement exists;
- no human review exists.

| Recording | File | Original seek error (Media3 Xing, lab) | MLLT seek error (lab) | Review task |
|---|---|---|---|---|
| yasser-salama 42 | LAME3.99r, 32–192 kbps, Xing TOC yes | -4.28 … +2.09 s | -0.2 … 25.1 ms | yasser-salama-42 |
| yasser-salama 48 | LAME3.100, 32–320 kbps, Xing TOC yes | -4.03 … +2.45 s | 0.1 … 25.5 ms | yasser-salama-48 |
| ajmi 42 | LAME3.93, 32–192 kbps, Xing TOC yes | -4.61 … +1.27 s | -0.4 … 25.6 ms | ajmi-42 |
| islam-sobhi 17 | LAME3.100, 32–320 kbps, Xing TOC yes | -8.35 … +5.35 s | -0.4 … 25.5 ms | islam-sobhi-17 |
| islam-sobhi 21 | LAME3.100, 32–320 kbps, Xing TOC yes | -5.03 … +4.98 s | -0.4 … 25.5 ms | islam-sobhi-21 |
| islam-sobhi 23 | LAME3.100, 32–320 kbps, Xing TOC yes | -6.83 … +3.59 s | 0 … 23 ms | islam-sobhi-23 |
| islam-sobhi 24 | LAME3.100, 32–320 kbps, Xing TOC yes | -7.44 … +2.96 s | 0 … 23 ms | islam-sobhi-24 |
| islam-sobhi 25 | LAME3.100, 32–320 kbps, Xing TOC yes | -5.10 … +1.77 s | -0.4 … 25.5 ms | islam-sobhi-25 |
| islam-sobhi 29 | LAME3.100, 32–320 kbps, Xing TOC yes | -4.32 … +2.29 s | -0.3 … 25.3 ms | islam-sobhi-29 |
| islam-sobhi 30 | LAME3.100, 32–320 kbps, Xing TOC yes | -4.53 … +1.34 s | -0.3 … 25.4 ms | islam-sobhi-30 |
| islam-sobhi 38 | LAME3.100, 32–320 kbps, Xing TOC yes | -5.09 … +1.42 s | -0.2 … 25.6 ms | islam-sobhi-38 |
| islam-sobhi 47 | LAME3.100, 32–320 kbps, Xing TOC yes | -2.10 … +1.05 s | -0.4 … 25.5 ms | islam-sobhi-47 |
| islam-sobhi 48 | LAME3.100, 32–320 kbps, Xing TOC yes | -3.40 … +2.88 s | -0.1 … 25.6 ms | islam-sobhi-48 |
| islam-sobhi 49 | LAME3.100, 32–320 kbps, Xing TOC yes | -1.69 … +0.96 s | 0 … 25.3 ms | islam-sobhi-49 |
| islam-sobhi 52 | LAME3.100, 32–320 kbps, Xing TOC yes | -2.60 … +0.98 s | 0 … 23 ms | islam-sobhi-52 |
| islam-sobhi 57 | LAME3.100, 40–320 kbps, Xing TOC yes | -2.70 … +2.48 s | 0 … 23 ms | islam-sobhi-57 |
| islam-sobhi 62 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.95 … +0.49 s | 0.3 … 25.5 ms | islam-sobhi-62 |
| islam-sobhi 72 | LAME3.98r, 32–320 kbps, Xing TOC yes | -1.83 … +1.04 s | -0.4 … 25.3 ms | islam-sobhi-72 |
| islam-sobhi 74 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.91 … +0.76 s | 0.3 … 25.4 ms | islam-sobhi-74 |
| islam-sobhi 95 | LAME3.100, 40–320 kbps, Xing TOC yes | -0.21 … +0.16 s | -0.4 … 25.5 ms | islam-sobhi-95 |
| islam-sobhi 98 | LAME3.100, 128–320 kbps, Xing TOC yes | -0.38 … +0.29 s | 0.3 … 25.4 ms | islam-sobhi-98 |
| islam-sobhi 99 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.22 … +0.13 s | 0.8 … 25.5 ms | islam-sobhi-99 |
| islam-sobhi 100 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.23 … +0.13 s | -0.2 … 25.6 ms | islam-sobhi-100 |
| islam-sobhi 101 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.15 … +0.14 s | -0.1 … 24.8 ms | islam-sobhi-101 |
| islam-sobhi 104 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.14 … +0.32 s | -0.2 … 25.3 ms | islam-sobhi-104 |
| islam-sobhi 105 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.13 … +0.06 s | -0.3 … 25.6 ms | islam-sobhi-105 |
| islam-sobhi 106 | LAME3.100, 112–320 kbps, Xing TOC yes | -0.09 … +0.08 s | -0.2 … 25.5 ms | islam-sobhi-106 |
| islam-sobhi 107 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.17 … +0.05 s | -0.5 … 25.4 ms | islam-sobhi-107 |
| islam-sobhi 108 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.07 … +0.03 s | -0.4 … 25.5 ms | islam-sobhi-108 |
| islam-sobhi 109 | LAME3.100, 56–320 kbps, Xing TOC yes | -0.19 … +0.06 s | -0.5 … 25.5 ms | islam-sobhi-109 |
| islam-sobhi 110 | LAME3.100, 32–320 kbps, Xing TOC yes | -0.11 … +0.06 s | -0.5 … 25.5 ms | islam-sobhi-110 |
| islam-sobhi 111 | LAME3.100, 80–320 kbps, Xing TOC yes | -0.12 … +0.06 s | 0 … 23 ms | islam-sobhi-111 |

## 2. Review data and migration (Stage 2)

**Current inventory** (read-only, 2026-10-19 20:45 UTC):
- 11 real review logs, all by **Hamza as Reviewer 1**. **No Reviewer 2** on any recording.
- **Final submissions (5):** Rifaat 72, 73 and 98; Saleh Al-Talib 87 (archive.org); Abdul Basit 2 (a production boundary check).
- **Partial (6):** Sufi 19 (79/99 starts), 42 (1/54), 111 (2/6), 112 (5/5 starts, no final submission), and the boundary checks Sufi 3 and 37.
- **No** bulk events, corrections, rejections, disputes or resolutions yet.
- **Rifaat 72** was submitted with **3 starts marked uncertain**. Once a second reviewer exists, those cannot count as agreed until they are resolved.
- **Every hash chain is intact.**
- **Full inventory:** `%USERPROFILE%\Backups\quran-heals-audio-review\pre-4.8.5-20261019T204459Z-inventory.json`. It lists per log: events, SHA-256, event types, per-reviewer counts, answers and status.

**Backup:** `%USERPROFILE%\Backups\quran-heals-audio-review\pre-4.8.5-20261019T204459Z`.
- 796 files with a manifest (size and SHA-256 per file); the chains were verified.
- **Restore tested** into an empty folder: every file matched its manifest, and all 11 logs were byte-identical to the live ones. The restored copy was deleted.
- **Restore procedure:** `node review/dashboard/backup.mjs --restore <snapshot> --to <empty dir>`. It never overwrites and checks every file.

**Migration rehearsal on current data:** 58/58 steps (`scratchpad/rehearsal/rehearse-485.mjs`, report `rehearsal-485-report.json`).
- It ran on a temporary local PostgreSQL and scratch copies, all deleted afterwards. The real logs' SHA-256 values were identical before and after.
- **Bundle and import:**
  - the bundle was built from all current logs, byte for byte, with no local path;
  - the import was byte-identical, with identical replayed state (partial and final submissions, answers, starts) and no event lost or duplicated (550).
- **Identity:**
  - nobody can take the name "Hamza";
  - "Hamza" was linked to the owner account with evidence of all 11 logs; history is not rewritten;
  - an incomplete link (wrong confirmation) is refused.
- **Cloud behaviour:**
  - the owner is Reviewer 1 of all 11 in the cloud;
  - another account is blind to Hamza's times;
  - impersonation is refused;
  - a new authenticated submission is stored with its account.
- **Failure handling:**
  - a tampered event refuses the whole import;
  - an import interrupted after 100 events is rolled back entirely, and re-running completes it;
  - a connection failure leaves everything unchanged;
  - a duplicate import adds nothing.
- **Rollback and cutover:**
  - `pull-events` (run on scratch copies) brings cloud-only events back after the exact local prefix; a second run adds nothing; a diverged local log is refused;
  - `cutover` and `rollback-cutover` work, tested on a copied configuration.
- **Backup:** the cloud backup (registry included) verified, and restored identically.

**Protection:**
- The two rehearsal files that held real review data in the scratch folder (`migration-bundle.json`, `staging-backup.ndjson`) were deleted. The cloud browser check now builds its bundle in memory.
- **Caution for a real rollback:** `pull-events` writes into the local data folders recorded in `registry/inventory.json`, which are absolute paths. Run it only against the real configuration, and only for an actual rollback.

**Real migration: not done.** The cloud is not deployed. Cutover procedure, when approved:
1. Ask the owner to stop local reviewing, and wait for confirmation.
2. Take a fresh snapshot (`backup.mjs --label cutover`) and run the inventory script.
3. `migrate.mjs bundle`, then `plan`, then `apply`, then `verify` against the cloud.
4. Link "Hamza" (`link-identity`).
5. Check every log in the cloud, and test a new submission and blindness.
6. Only then run `cutover` (local read-only).
7. If anything fails: the local dashboard stays writable. Nothing is switched.

## 3. Devices (Stage 3)

| Level | Result |
|---|---|
| Automated tests | passed (§6) |
| Emulator (Android 17 AVD, local dev client) | partial: see below |
| Android physical device | **not tested** (none connected) |
| iOS simulator or device | **not tested** (no Mac or iPhone) |

**Emulator integration run.**
- **Setup:**
  - an isolated, throwaway registry on this computer (temporary PostgreSQL), with recordings imported without any review event;
  - two **test** accounts "verified" the aligned proposal of Maher 68 (the MP3Quran file);
  - test-labelled authorizations;
  - a development bundle pointed at that registry.
- **The gate worked first:** Maher 68's MP3Quran file carries «Reserved For KFGQPC», and the worker blocked it until an exact-file test authorization acknowledged the notice. This is relevant to the real authorization decisions (§4).
- **Observed in the app's log and the registry's request log:**
  - the manifest was retrieved over HTTP from the emulator, and version 1 of maher:68 was installed;
  - the version document was downloaded on first use and verified;
  - the next loads used the device copy, with no second download;
  - refreshes were conditional (304).
- **Not testable:** HTTPS from this emulator now fails certificate validation ("Trust anchor for certification path not found", in Google Play services too).
  - This rig depends on trusting the local Norton TLS interception, and that trust no longer holds.
  - **Streaming therefore fails for every recording,** including the catalogue's: the baseline with the registry switched off fails the same way, with `network`.
  - So playback, seeking, highlighting, Repeat Ayah, version switching during playback, rollback and withdrawal could not be observed on the emulator.
  - The automated engine tests cover them (§6). **They are not device-verified.**
- **Kept for these tests:** development-only diagnostics (`[verifiedTiming]` and `[audio] phase` lines in the dev log), and `EXPO_PUBLIC_AUDIO_TIMING_REFRESH_SECONDS`, which shortens the refresh interval in development builds only.

**Manual checklist for a real Android device and a real iPhone.** The owner, or someone with the devices, runs this with a development build pointed at an **isolated** registry, never the production one.

1. **Setup:**
   - start the isolated registry (`scratchpad/device/registry-server.mjs` design: test accounts, test authorizations, a temporary database) on a reachable host;
   - build the app with `EXPO_PUBLIC_AUDIO_REGISTRY_URL=<that host>`, `EXPO_PUBLIC_AUDIO_TIMING_ENV=development`, `EXPO_PUBLIC_AUDIO_TIMING_REFRESH_SECONDS=20`.
2. **Recording:** use a CBR recording the app may stream (e.g. a catalogue MP3Quran file without a rights notice), with known boundaries.
3. **Play** the first, a middle and the last ayah. **Measure** the onset error at each boundary (e.g. record the output against the known waveform), and write down the largest |error|.
4. **Navigation and modes:** Next / Previous Ayah, Repeat Ayah (the restart point equals the start), Full Surah with highlighting, pause/resume, background, switching reciter and surah.
5. **Offline:** with a cached version, airplane mode: it plays. Without a cached version: "network", never other timing.
6. **Registry changes during playback:**
   - while playing, publish version 2 (`/resolve`): the playing surah keeps v1 (log `manifest held`);
   - stop and play again: v2 downloads (log `version downloaded`).
7. **Rollback** (`/rollback`): v1 returns at the next load.
8. **Withdrawal** (`/withdraw`): the surah stops being offered once the app refreshes.
9. **VBR:** only after the native MLLT data source exists. Measure ≥ 10 seeks per file and platform, then record each measurement in the dashboard (Publication tab → *Record a device measurement*).
10. **Collect:** the dev log lines `[verifiedTiming]` and `[audio]`, the registry request log, and the measured errors. No personal data.

## 4. Source authorizations (Stage 4.3)

**No authorization is recorded. None was created or assumed.**

| Source | Authorization state | Evidence on file | Open questions | Eligible | Blocked |
|---|---|---|---|---|---|
| MP3Quran (catalogue recordings) | none | Privacy page "Copyrights" statement, site-wide (read 2026-10-17; `providers.mjs`) | Does the owner accept a site-wide statement for app streaming? **Some files carry «Reserved For KFGQPC»** (all 18 Rifaat files; Maher 68 found in this phase; Maher and Hudhaifi files noted earlier). Those need KFGQPC's permission for the exact file. | none (no Reviewer 2) | everything, until an authorization exists |
| Muhammad Rifaat (MP3Quran r1) | none | ID3 TCOP «Reserved For KFGQPC» in every file | KFGQPC permission per file; 13 of 31 files are excerpts; 7 repeat passages (a product decision) | none | all 18 sessions (3 with R1 final) |
| Saleh Al-Talib (archive.org `saqrsm`) | none | Uploaded by an individual; no source stated; voice "probable" by classifier | Provenance, identity and permission | none | saleh-talib-87-archive (R1 final) and the rest |
| Islam Sobhi (MP3Quran VBR) | none | Like MP3Quran | Permission, **and** VBR (§1: needs native seeking and device measurements) | none | 29 VBR surahs |
| Islam Sobhi (Way2Quran candidates) | not permitted | "Copyright reserved" (checked 2026-10-17); 37/39/40 voice mismatch | — | none | all |
| Assabile (Ahmed Mohamed Salama) | not permitted | No terms; no grant | — | none | all |

Only an administrator records an authorization: Publication tab → *Record an authorization*, with the provider (optionally a reciter or an exact file), riwayah Hafs, and the evidence.

## 5. Activation readiness (Stage 4.4): **NO-GO**

| # | Requirement | State | Evidence |
|---|---|---|---|
| 1 | Cloud dashboard deployed | **NO** | Awaiting owner approval (cost, repository, Google client, admin token, reviewer e-mails) |
| 2 | Real review migration complete and verified | **NO** | Rehearsed 58/58 on copies; real cutover not done |
| 3 | Reviewer accounts and permissions | tested locally | Cloud suite and browser check |
| 4 | Source authorization controls | tested locally | Publication tests |
| 5 | Registry healthy | tested locally | Publication tests, backup and restore |
| 6 | Development and Production pointers | tested locally | Atomic publication, mismatch, align |
| 7 | Cross-platform device tests | **NO** | No physical device; emulator HTTPS broken |
| 8 | Playback, highlighting and Repeat Ayah confirmed on devices | **NO** | Automated only |
| 9 | VBR recording-specific | yes | §1 |
| 10 | Publication failures handled | tested locally | Interrupted transaction, retries |
| 11 | Automatic withdrawal | tested locally | Dispute, revocation |
| 12 | Registry backups operating | **NO** (not deployed) | Tested locally |
| 13 | Rollback tested | tested locally (registry); not on devices | |
| 14 | Monitoring and alerts | **NO** | `/api/admin/status` exists; no alerting configured |
| 15 | Publication disabled pending approval | yes | `PUBLICATION_MODE=off` |

**Even with GO, nothing would be published today:** no recording has a second reviewer or an authorization. Approval of hosting is not approval of publication: enabling needs its own explicit authorization.

**Active versions:** Development none, Production none. The registry does not exist outside the tests.

## 6. Tests

| Suite | Result | Notes |
|---|---|---|
| `audioPublication.test.ts` | 31/31 | 8 new Phase 4.8.5 tests (compatibility states, coordinates, device measurements recorded by administrators only and judged by the server) |
| `audioVerifiedTiming.test.ts` | 19/19 | 4 new: seek methods, platforms, unsupported entries unavailable |
| Audio test files | 18 files, 350/350 | |
| Full app suite | 3258 passed | The 37 known `mushafScreen` failures: identical by name to before |
| Backend | 1634/1634 | No database reachable during the run |
| TypeScript, ESLint | clean | |
| Cloud browser check | 23/23 | On a deleted staging copy |
| Migration rehearsal | 58/58 | Current real data, isolated |

## 7. Remaining owner actions, in order

1. **Approve the cloud deployment** (Phase 4.8.2 runbook): cost, repository, a Google OAuth web client, the administrator token, the reviewer Google accounts.
2. **Real cutover:** stop local reviewing, then confirm; the migration follows §2.
3. **Recruit the second reviewer(s).**
4. **Make the source decisions** (§4) and record them in the dashboard.
5. **Fix the device test environment:**
   - a physical Android phone (or emulator TLS trust);
   - an iPhone with a Mac for the native build;
   - then run §3.
6. **If VBR recordings are wanted:** approve building the native MLLT data source (Android), plus an iOS investigation; then new native builds, and device measurements per file.
7. **One app build or OTA update** with `EXPO_PUBLIC_AUDIO_REGISTRY_URL` per profile, after device testing.
8. **Configure monitoring or alerts** for `/api/admin/status` (failed jobs, mismatches).
9. **Only then, explicit authorization:** `PUBLICATION_MODE=enabled`.
10. **Commit and push** of Phases 4.8.2–4.8.5, when wanted.
