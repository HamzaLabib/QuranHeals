# Unified audio review dashboard and the complete review backlog — Phase 4.8 (2026-10-19)

Local only. Nothing committed, staged, built or deployed. **No human review exists yet, and none was created**: both
review databases hold 0 review logs. Nothing was approved or activated. No catalogue, production timing, development
timing or approved timestamp changed.

**Open it:** double-click `Working progress/Screenshots and Logs/audio-review-dashboard/start-dashboard.cmd`, or from
`QuranHeals/tools/quran-audio`:

```bash
node review/dashboard/server.mjs --config "../../../Working progress/Screenshots and Logs/audio-review-dashboard/dashboard.config.json"
```

Then open **http://127.0.0.1:8765/** in Chrome or Edge. It answers on this computer only. Usage:
`tools/quran-audio/review/dashboard/README.md`.

## 1. Results

| Metric | Result |
|---|---|
| Total target reciters | **17**: 16 with pending review work; Ahmed Mohamed Salama has no recording to review (identity unverified, no permitted recording) |
| Total pending recordings | **801** |
| Total pending ayah boundaries (ayah starts to verify, ayah 1 included) | **28,294** |
| High-priority review tasks (high-risk starts) | **2,364**; plus 2,988 medium and 3,675 worklist/opening checks |
| Manual-timing recordings | **18** (Muhammad Rifaat, 497 starts) |
| Alignment-verification recordings | **500**: 456 aligned candidates (Phase 4.1: 431; Phase 4.7: 25) + 44 development-stage |
| Production boundary checks (recordings already in the app) | **283** (1,327 documented starts) |
| Older review packages recovered | **485** Phase 4.1/4.2/4.3 packages (475 registered, 10 superseded); 26 Phase 4 candidates (all superseded); 283 production checks from the 2026-10-17 source audit |
| Reviews completed by humans | **0**: Reviewer 1: 0, Reviewer 2: 0, technically verified: 0 |
| Unresolved import problems | **0** (every package passed validation) |
| Blocked or unavailable (kept apart) | **17**: 13 Rifaat excerpts, and 4 groups with no package |
| Superseded (not counted twice) | **36** |
| Recordings with a validated local audio copy | 524 of 801; the rest are fetched from their original URL on first opening |

## 2. The backlog: what was pending, and where it came from

The inventory was built from the repository and workspace files, before anything was imported (dry run first). It is
regenerated on every **Refresh queue**: `audio-review-dashboard/registry/inventory.json`.

**No human review was found anywhere:**
- the Rifaat `data/` folder was empty;
- `development-timing.json` has 0 `listening` entries;
- `surah-mode-approvals.json` has 0 approvals;
- no exported review JSON exists on disk;
- Chrome's and Edge's site storage hold no `review.html` progress (`qh-review*` / `qh-manual*` keys).

Nothing is treated as reviewed because an automatic alignment passed.

| Source (phase) | Review type | Recordings | Ayah starts | High | Medium | Worklist / check | Evidence |
|---|---|---:|---:|---:|---:|---:|---|
| Rifaat manual sessions (4.5/4.6) | manual timing | 18 | 497 | 166 | 199 | 132 | 120 conflicts + 46 unbracketed = high; 199 multi-pause brackets = medium; 132 single-pause = check (Phase 4.5's 331 bracketed = 199 + 132) |
| Phase 4.7 packages | alignment verification | 25 | 433 | 98 | 74 | 86 | 408 proposed boundaries; **233 on worklists, 98 priority 1**, as reported in Phase 4.7 |
| Phase 4.1 packages (incl. 4.2 repairs, 4.3 VBR recovery) | alignment verification | 431 | 24,495 | 1,963 | 1,456 | 3,100 | 24,064 proposed boundaries; 6,088 on worklists |
| Phase 4.1 packages | development-stage verification | 44 | 1,542 | 5 | 195 | 226 | Already plays in development builds without any listening review |
| Source audit 2026-10-17 | production boundary check | 283 | 1,327 | 132 | 1,064 | 131 | Every boundary left "to be checked by listening" (130 displaced, 1,064 unconfirmed), plus the audit's listening checks (133 starts) |
| **Total** | | **801** | **28,294** | **2,364** | **2,988** | **3,675** | 19,267 further starts are routine (not flagged, still to be confirmed) |

**Phase 4.1 figures:** they differ slightly from the Phase 4.1 report (6,157 worklist boundaries, 1,861 priority 1).
That report predates the Phase 4.2 repairs (Yasser Salama 90 and Saleh Al-Talib 86 added, six passing surahs corrected).
The figures here are counted from the current package files.

**Per reciter:**

| Reciter | Manual | Aligned | Development | Production check | Recordings | Ayah starts | High | Blocked |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Abdul Basit Abdus Samad | 0 | 0 | 0 | 1 | 1 | 4 | 4 | 0 |
| Muhammad Siddiq Al-Minshawi | 0 | 2 | 5 | 3 | 10 | 506 | 12 | 0 |
| Ahmed Naeena | 0 | 1 | 0 | 50 | 51 | 200 | 28 | 0 |
| Mahmoud Khalil Al-Husary | 0 | 3 | 8 | 55 | 66 | 831 | 20 | 0 |
| Mahmoud Ali Al-Banna | 0 | 113 | 0 | 1 | 114 | 6,236 | 126 | 0 |
| Yasser Mahmoud Salama | 0 | 114 | 0 | 0 | 114 | 6,236 | 346 | 0 |
| Saud Al-Shuraim | 0 | 3 | 22 | 44 | 69 | 1,243 | 60 | 0 |
| Abdul Rashid Ali Sufi | 0 | 13 | 0 | 3 | 16 | 707 | 11 | 0 |
| Ali Al-Hudhaifi | 0 | 11 | 0 | 5 | 16 | 1,281 | 19 | 0 |
| Abu Bakr Al-Shatri | 0 | 4 | 9 | 23 | 36 | 591 | 28 | 0 |
| Ahmed Al-Ajmi | 0 | 7 | 0 | 47 | 54 | 626 | 155 | 0 |
| Maher Al-Muaiqly | 0 | 13 | 0 | 1 | 14 | 1,272 | 11 | 0 |
| Abdullah Basfar | 0 | 6 | 0 | 50 | 56 | 495 | 83 | 0 |
| Saleh Al-Talib | 0 | 56 | 0 | 0 | 56 | 1,712 | 219 | 2 |
| Muhammad Rifaat | 18 | 0 | 0 | 0 | 18 | 497 | 166 | 13 |
| Islam Sobhi | 0 | 110 | 0 | 0 | 110 | 5,857 | 1,076 | 1 |
| Ahmed Mohamed Salama | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |

**Production recordings.** A completed approval is reopened only with a documented, unresolved issue. Here the
documentation is explicit: `source-audit.md` lists boundaries "still enabled, and to be checked by listening"
(`audit-results.json` `review`), and a "Listening checks (not yet done)" section. All of them are registered:
- **The flagged boundaries:** all 1,194, with the production start the boundary sweep tested; none was lost (tested).
- **Maher 18:1–2:** the riwayah sakt check. No production time is stored for these two starts, so they are placed by ear.
- **Hudhaifi measured timing:** 2:255, 18:1–10, all of 36, 67 and 112.
- **Banna 108.**

Each production check covers only those starts. Its result is a list of findings for the owner (a production start
that the reviewers place more than 250 ms away). **It never produces timing and never changes the app.** No other
production surah is reopened.

**Blocked or unavailable (not reviewable; reasons kept):**
- **Rifaat excerpts (13):** 10, 11, 12, 17, 18, 19, 20, 48, 54, 56, 69, 77 and 81 (Phase 4.5).
- **Saleh Al-Talib saqrsm (13 surahs):** 51, 68, 69, 89, 90, 92, 103, 106–109, 112 and 113. They failed the text or voice screen and have no package; listen first.
- **Saleh Al-Talib 2:** the MP3Quran file is incomplete.
- **Islam Sobhi 37, 39, 40 and 45:** voice not matched or unresolved.
- **Ahmed Mohamed Salama:** identity unverified.

**Superseded (36), each linked to what supersedes it:**
- **Phase 4.1 Rifaat packages (10):** 8 are on the manual route, and 2 are excerpts.
- **Phase 4 test-batch candidates (26):**
  - 22 are identical to Phase 4.1 packages;
  - Saleh Al-Talib 86 was replaced by the Phase 4.2 repair;
  - Rifaat 55 and 86 are on the manual route;
  - Rifaat 18 is an excerpt.

**Documented concerns** appear on 159 recordings (152 outside the production checks) (sources in `review/dashboard/known-issues.json`):
- **Content:** Islam Sobhi 54 (Ad-Dukhan appended), Sobhi 112, Saleh Al-Talib 1 (imam's instructions), Yasser Salama 114, Ajmi 74.
- **Production history:** Maher 3, 34, 42 and 68.
- **Identity:** every Yasser Salama recording; every archive.org Talib prayer recording; Sobhi 65.
- **Riwayah:** Maher 36:52.
- **Boundaries:** Shuraim 40:74, Husary 46:21; the Phase 4.2 repairs of Talib 86 and Yasser 90.

**Rights:** every recording shows "rights pending". The KFGQPC copyright frame is noted for Hudhaifi, Maher, Yasser
Salama and Rifaat.

## 3. What was built (reusing the Phase 4.6 tool)

One server, `review/dashboard/server.mjs`, serves:
- the dashboard;
- the existing review page (`review/manual/index.html`), extended for every recording;
- the same blind two-reviewer rules (`manual-lib.mjs`), append-only hash-chained logs and export.

No separate review format was created: every recording, whatever its source, is reviewed as a session of the Phase 4.6
model.

**Dashboard (`/`):**
- **Totals:** the metrics in §1.
- **One row per recording:** reciter in Arabic and English, surah, ayahs, length, audio source, phase, review type, priority, progress, reviewers, statuses, outstanding problems.
- **Filters:** reciter, surah, status, review type, priority and phase.
- **Needs attention:** every open start, disputed first, then by risk tier and the recording's priority. **Listen** opens the review page at that ayah.
- **Other tabs:** blocked and superseded recordings; sources and import problems.
- **Actions:** **Start review** / **Continue review**, **Refresh queue**, **Back up now**.

**Priority:**
1. **Start here, in the owner's order:** Rifaat 98, 73, 72, 78; Saleh Al-Talib 87, 88, 91, 63; Islam Sobhi 65.
2. The remaining Rifaat recordings (queue order) and the Phase 4.7 recordings.
3. Development-stage timing (it already plays in development builds), and recordings with documented concerns.
4. Phase 4.1 candidates, by their share of risky starts.
5. Production checks, with displaced boundaries first.
6. VBR files last: they cannot reach the app until a seekable copy is hosted.

**Review page (added to the Phase 4.6 page):**
- **Automatic proposals:** dashed and read-only. **Confirm proposed** (**C**) is a reviewer's explicit action, available only after joining. Nothing is placed, moved or confirmed automatically.
- **The aligner's evidence:** the pause, flags, acoustic class and priority of each start.
- **Listening:** **Replay before** (**Q**) and **after** (**W**), **Play this ayah only** (**A**), **Previous/Next ayah** buttons.
- **Progress:** an explicit **Save progress** (**S**), "Ayah N of M reviewed", and the ayah now playing.
- **Problems:** **Flag problem** per ayah (fills in the flag form).
- **Context:** banners for documented concerns, app-playback blocks and timeline warnings.
- **Rifaat recordings:** unchanged. The Phase 4.5 evidence is shown as places to listen; there is no proposal.
- **Waveform:** the whole-recording overview is cached, for long recordings.

**Phase 4.8 rule changes:**
- **A sixth whole-recording check (playback):** "seeking to each agreed start plays that ayah from its first sound". A recording is verified only when content, identity, order **and** playback pass.
- **Production boundary checks** are scoped sessions:
  - only the listed starts are placed;
  - there is no recitation end;
  - only the playback question is asked;
  - the outcome is `boundaries-verified` with findings, and never timing.

**Two-reviewer workflow (unchanged rules, now for everyone):**
- Reviewer 2 cannot see Reviewer 1's placements before both have submitted. Dashboard counts never reveal them either.
- One name cannot hold both roles; names are compared case-insensitively.
- Disputes over 250 ms are resolved by proposal and acceptance.
- Amendments need a reason and stay in the log.
- Numerical agreement alone never verifies a recording: every check must be answered "yes" by both.
- **Typed names are not authenticated identities.** This is stated on the dashboard and in the README.

## 4. Future review packages

**A later phase registers its work by writing packages in the existing format** (`review/make-packages.mjs`, now with
`--phase <label>`) anywhere under `Working progress/Screenshots and Logs`. **Refresh queue** then discovers them:
- only `index.json` of kind `ayah-timing-review-index`, or `queue.json` of kind `manual-timing-queue`;
- JSON only, nothing executed, three levels deep.

**Each package is validated before registration:**
- the reciter is known;
- the ayah count is canonical;
- the Arabic text is verbatim from the app's runtime text;
- the timing is in order and inside the audio;
- the URL is https from MP3Quran, archive.org or Way2Quran;
- the timing matches the package's own fingerprint. All 510 existing packages match; an edited package is refused.

**Duplicates:** the identity is reciter + surah + URL + size. Duplicates are superseded, not doubled.

**A recording whose review has begun keeps the session it started on.** A changed package is reported as an import
problem and never silently replaces the session.

**Both kinds are supported:** manual-timing sessions and automatic-alignment packages. No code change is needed for a
new reciter or recording. Tested with a "future phase" folder created during the test.

## 5. Audio

**Local copies come first.** A copy is used only at the package's exact size, and SHA-256 when known:
- all 441 Phase 4.1 files and 59 development files are in the earlier sessions' scratch areas;
- the 25 Phase 4.7 originals were copied into the dashboard cache (199 MB, SHA-256 checked), since their scratch area is temporary and archive.org intermittently serves error pages.

**Otherwise a file is downloaded from its original URL** into
`%LOCALAPPDATA%\QuranHeals\audio-review-cache` (outside OneDrive), on first opening, with progress
shown. A wrong size is refused, so an error page is never kept. A recording that cannot be fetched stays listed with
the reason.

**Waveforms** (`peaks.py`):
- **Timeline:** the decoded audio, at miniaudio 16 kHz, the aligner's own.
- **Validation against `prepare.py`:** the same duration (357,355 ms) and the same quiet regions (19/19 within 20 ms) on Rifaat 98.
- **Cost:** 11 s and 4.3 MB for the longest file, Banna 2 (2 h 14 min).

**VBR files (32)** play from a lossless 16-bit PCM decode of the unmodified file, because browsers cannot seek VBR
exactly. A headless test confirmed exact seeking.

**Nothing is modified, re-encoded for publication or hosted.**

## 6. Optional Basmala skipping (`alignment/align_mms.py --no-basmala`)

**The change:** an explicit, opt-in flag; the default is unchanged. The segment construction moved into
`build_segments()`, and the flag drops only the Basmala segment. Its words still leave ayah 1, as before.

**Tests:** `alignment/test_align_basmala.py`, run in the aligner's GPU environment; the GPU was idle.

| Check | Result |
|---|---|
| Segments: default unchanged; option drops only label 0; surahs 1 and 9 unaffected | 3/3 |
| Default re-alignment = earlier outputs, both configurations: Talib 95 and 104, Sobhi 65 (Phase 4.7), Banna 103 (Phase 4.1) | identical (Banna 103 lacks only the empty `windows` key, added to the aligner for long files after it was aligned) |
| `--no-basmala` = the Phase 4.7 scratch variant: Talib 91, 95 and 104 | identical; ayah 1 starts within 100 ms of the measured voice onset (3,040–3,060 ms) |
| `test_flag_boundaries.py` | 3/3 |

**Left untouched:**
- no approved Quran text or timestamp changed;
- no batch was re-run;
- `run-batch.mjs` does not pass the flag on (a later phase decides where to use it).

## 7. Saving, recovery, backups

**Saving:** every change is an fsynced, hash-chained event, sent within about a second. **Save progress** sends it at
once. The page also offers to restore any change the server never received. Nothing is lost on reload, browser
restart or computer restart: reload persistence was tested in the browser, and restart persistence by a server
restart in the tests.

**One writer per database:**
- the dashboard locks every data folder it writes, including the Rifaat database, which is reused in place, never copied;
- a second dashboard or the Phase 4.6 server refuses to start on a locked folder (tested in another process);
- a stale lock from a crash is taken over, as happened on this session's own restarts.

**Pre-change backup:** `%USERPROFILE%\Backups\quran-heals-audio-review\pre-phase-4.8-20261019T064205`.
- **Contents:** 543 files: the Rifaat sessions and data, the Phase 4.1 and 4.7 packages, and every repository file before change.
- **Restore test:** restored into an empty folder; every SHA-256 matched.

**Automatic snapshots** (`backup.mjs`):
- **When:** on start, 3 s after every submission, amendment or resolution, and every 10 minutes while reviews change.
- **What:** each has a SHA-256 manifest, is verified after copying, and has every log's hash chain checked.
- **Restores** go only into an empty folder.
- **Live check:** the latest snapshot (785 files) verified intact, restored with every file checked and no chain problems, and refused a restore over existing files.

**Review data stays apart from timing registries.** Nothing in the dashboard writes `development-timing.json`,
production files or catalogues.

## 8. Statuses kept apart

Each recording shows its own statuses:
- **pipeline:** alignment completed / manual timing required / in production: boundary check;
- **review stage:** human review pending → first review completed → second review completed → technical verification completed;
- **rights:** pending or cleared;
- **approved for development:** verified *and* rights cleared, and still not active;
- **active in development:** only the 44 development-stage surahs, which play in development builds without any listening review.

**Rights are cleared only by an owner rights decision file.** It must name the exact recording: reciter, surah, URL,
size and SHA-256. None exists; every recording is "rights pending".

**Exports for apply-review:**
- **A verified aligned or development recording** exports the pair `apply-review.mjs` already reads. The pair carries the original package, checked against its import hash.
- **While rights are pending, the pair is blocked.** `apply-review` now also refuses synthetic data for every source, not only manual timing.

## 9. Tests

| Suite | Result |
|---|---|
| `mobile/tests/audioReviewDashboard.test.ts` (new; synthetic data in temporary folders; test reviewer names) | **19/19**: discovery and inventory, validation refusals, duplicates, future packages, risk tiers, host/origin/content-type guards, statuses, waveform and quiet regions, byte ranges, blind second review, same-name refusal, dispute, resolution, verification without rights, export pair, restart persistence, frozen sessions, Refresh queue, apply-review compatibility (refused while rights are pending or the data is synthetic; applied to a temporary file once cleared), backup/restore/tamper/chain detection, lock across processes, production checks (all 1,194 flagged starts; scoped rules and findings) |
| `mobile/tests/manualTimingReview.test.ts` (Phase 4.6; fixture given the new playback check) | 19/19 |
| All 14 audio suites (`vitest run` directly; `npm test`'s pretest writes font files) | 264/264 |
| Full mobile suite | 177/178 files: the only failures are the **37 known QPC renderer tests** in `mushafScreen.test.ts` (pre-existing, unrelated to audio) |
| TypeScript (`tsc --noEmit`) / ESLint (`expo lint`) | clean / clean |
| Headless Chrome against an isolated test instance (port 8771, its own data, registry, cache and backups; the real Rifaat database untouched) | **40/40**: every recording listed, start-here order, filters, Needs attention, blocked list, waveform drawn, playback, exact seeking, nothing auto-placed, C/M/[/1, Q stops at the start (16 ms), order enforced, reload persistence, Reviewer 2 blind, case-insensitive name, Rifaat evidence view, VBR via PCM (exact seek), a real download from the original URL, production check view, no page errors |
| `alignment/test_align_basmala.py` (+ GPU regression) / `test_flag_boundaries.py` | 4/4 / 3/3 |

**Verification levels.** These are automated tests and a headless browser on this computer. **No person has listened
to anything in this phase, and no review was recorded.** The dashboard has not yet been used by the owner in a
visible browser.

## 10. Limits and open points

- **Listening is the remaining work:** 801 recordings, 28,294 starts, two reviewers each. Start with the *start here* list.
- **Names are typed, not authenticated** (§3).
- **Timing precision:** in the browser, a CBR file may differ from the decoded timeline by up to one MP3 frame (26 ms); the agreement threshold is 250 ms.
- **apply-review and aligned or development pairs:** it keeps the package's own ayah-1 start and last-ayah end. When the reviewers agreed other times, the export lists both under `caveats`.
- **The Phase 4.1 audio** is referenced in another session's scratch area. If that is deleted, files are re-downloaded from MP3Quran on demand (size-checked).
- **Python:** waveforms need Python 3.12, because the `pylib` binaries are built for it.
- **The old `review.html`** still works, but its progress lives only in one browser. The dashboard is now the place to review; no progress existed to migrate.

## 11. Changed files

**Repository (all uncommitted):**

| File | Change |
|---|---|
| `tools/quran-audio/review/dashboard/server.mjs` | new: the dashboard server |
| `tools/quran-audio/review/dashboard/dashboard-lib.mjs` | new: discovery, validation, deduplication, risk, inventory, production checks |
| `tools/quran-audio/review/dashboard/dashboard.html` | new: the dashboard page |
| `tools/quran-audio/review/dashboard/peaks.py` | new: waveform, quiet regions, PCM for VBR |
| `tools/quran-audio/review/dashboard/backup.mjs` | new: snapshots, verify, restore |
| `tools/quran-audio/review/dashboard/known-issues.json` | new: start-here order, documented concerns, production listening checks, recordings without packages |
| `tools/quran-audio/review/dashboard/README.md` | new |
| `tools/quran-audio/review/manual/log-store.mjs` | new: shared logs + data-folder lock |
| `tools/quran-audio/review/manual/manual-lib.mjs` | playback check; reciter-neutral identity check; scoped production checks |
| `tools/quran-audio/review/manual/server.mjs` | uses log-store; locks its data folder |
| `tools/quran-audio/review/manual/export.mjs` | pairs for aligned/development sessions; production findings |
| `tools/quran-audio/review/manual/index.html` | proposals, new controls, audio preparation, scopes, bidi isolation |
| `tools/quran-audio/review/manual/README.md` | Phase 4.8 note |
| `tools/quran-audio/review/make-packages.mjs` | optional `--phase` in index.json |
| `tools/quran-audio/development/apply-review.mjs` | refuses synthetic data for every source |
| `tools/quran-audio/alignment/align_mms.py` | optional `--no-basmala` (`build_segments()`) |
| `tools/quran-audio/alignment/test_align_basmala.py` | new |
| `tools/quran-audio/alignment/README.md`, `tools/quran-audio/README.md` | documentation |
| `mobile/tests/audioReviewDashboard.test.ts` | new |
| `mobile/tests/manualTimingReview.test.ts` | the fixture answers the new playback check |
| `docs/audio/audio-review-dashboard-phase-4-8-2026-10-19.md` | this report |

**Outside the repository:**
- `Working progress/Screenshots and Logs/audio-review-dashboard/`: configuration, `start-dashboard.cmd`, `README.txt`, the empty `data/` and `rights/`, and `registry/` (783 generated sessions + `inventory.json`).
- `%LOCALAPPDATA%\QuranHeals\audio-review-cache\`: audio copies, waveforms, the hash index.
- `%USERPROFILE%\Backups\quran-heals-audio-review\`: the pre-change backup and the automatic snapshots.

**Not changed:**
- production and development catalogues and timing;
- `audit-results.json` and `measured-timing.json`;
- the package folders and the Rifaat sessions;
- the app's code.

**No other Claude session was running.** Its data was not touched. The GPU was idle when used.

## 12. Phase 4.8.1: partial submission and resume (2026-10-19)

**The workflow:** listen to some ayahs → confirm them → **Submit reviewed ayahs** → close the dashboard → return later →
**Continue review** from the next unfinished ayah. Full-surah completion is never needed to save or submit.

**Data model:** an extension of the same append-only, hash-chained log.
- **`submit-ayahs`:** submits a batch of starts, consecutive or not. Each must be placed and judged confirmed (or rejected) after listening; an *uncertain* start is refused. A start already submitted, or listed twice, is refused, so a double click cannot submit twice. The refused event never enters the log.
- **The snapshot:** every submitted start is frozen (time, judgement, note, when, revision). A draft may neither change nor drop it.
- **`revise`:** a correction of a submitted start. It needs a reason; the earlier submission stays in `revisions`, and the snapshot becomes revision 2, 3…
- **`submit`:** stays the final, whole review (recitation end + whole-recording checks); any start not yet submitted goes with it.
- **Compatibility:** Phase 4.6/4.8 logs replay unchanged. A whole submission is also recorded per start (tested).

**Independent review per start:**
- Reviewer 2 can start at any time.
- **Blind per start:** a start's two placements are shown, compared and resolvable as soon as **both** have submitted it. Before that, the other reviewer's time is never sent to the page; only *which* starts they submitted.
- **Independence:** a start changed after the other placement was shown is never counted as independent agreement; it needs a proposal and acceptance.

**Status:**
- **Verification:** a recording is `partially-reviewed` until both reviewers have finished everything; only then can it be verified.
- **Exports:** they carry `complete: false/true`, the snapshots and the corrections. A partial record never carries an apply-review pair; `apply-review.mjs` is unchanged and still refuses anything not completely verified, by two reviewers, with cleared rights.

**Interface:**
- **Review page:**
  - **Save progress** and **Submit reviewed ayahs** (it lists exactly what it submits, e.g. "will submit: 1–10, 25–30", and reports "16 submitted (1–10, 25–30). 184 pending."; no dialog; the recording and playhead stay put);
  - **Next unreviewed ayah** (**N**), the **Continue review** banner, and opening at the next unfinished ayah;
  - per-start state chips (pending / saved, not submitted / submitted / verified / disputed) with a **Show** filter;
  - **Correct** / **Submit correction**;
  - the comparison table for starts both have submitted.
- **Dashboard:**
  - per recording: starts submitted by Reviewer 1 and Reviewer 2, verified, disputed, remaining, and your own submitted and saved-but-unsubmitted starts;
  - tiles: partially reviewed recordings, starts submitted by each reviewer, starts verified;
  - **Status** filters: Pending, In progress, Submitted, Verified, Disputed;
  - **Needs attention**: "only starts I have not submitted".

**Tests:**
- **`mobile/tests/audioPartialReview.test.ts`:** 12/12, synthetic data on Surah 18's 110 ayahs. It covers:
  - 5 of 110 submitted;
  - nonconsecutive and later batches;
  - refused duplicates, unjudged, unplaced and unknown starts;
  - frozen starts and corrections with history;
  - log integrity;
  - incremental, blind Reviewer 2;
  - per-start resolution;
  - post-reveal changes are not agreement;
  - every start submitted by both, but no end or checks, is still not verified, and the export is incomplete without a pair;
  - a Phase 4.6 log replays identically;
  - production scope;
  - the server: save, batch, double click, restart, resume, dashboard progress, Needs attention, blindness, incomplete export.
- **Headless Chrome, isolated instance:** 20/20 (listen and confirm 5 → submit → counts → playhead kept → locks → save 2 → reopen at 6 → Continue banner → filter → batch 6–7, 20 → N → correction rev 2 → Reviewer 2 blind → 1–3 compared → dashboard row).
- **All 15 audio suites:** 276/276. **TypeScript, ESLint:** clean.
- **Full suite:** 178/179 files; the only failures are the 37 known QPC tests in `mushafScreen.test.ts` (confirmed alone: 37 failed, 255 passed).

**Genuine review data.** The owner had already started reviewing through the dashboard. Four complete Reviewer 1
reviews exist (by "Hamza"): Rifaat 98, 73 and 72, and Saleh Al-Talib 87, finished between 16:06 and 17:28 UTC.
- **Not touched:** they were not modified by this work.
- **Checked under the new code:** valid hash chains; correct replay ("first review completed", all starts submitted by Reviewer 1, awaiting an independent Reviewer 2).
- **Backed up:** in the automatic snapshots and the owner's own manual one (17:29 UTC).
- **The restart:** the live server was restarted at 17:32 UTC, after the last saved event (17:28:49).

**Files changed in 4.8.1:**
- `tools/quran-audio/review/manual/manual-lib.mjs`, `export.mjs`, `index.html`, `README.md`;
- `tools/quran-audio/review/dashboard/server.mjs`, `dashboard.html`, `README.md`;
- `mobile/tests/audioPartialReview.test.ts` (new);
- this section.

## 13. Phase 4.8.2: secure cloud dashboard: prepared, not deployed (2026-10-19)

**Status:** the cloud service is implemented and tested on this computer. **Nothing was provisioned or deployed, and
nothing was committed or pushed.** Deploying needs the owner's approval and the external setup listed below.
Runbook: `tools/quran-audio/review/cloud/README.md`.

**Design:**
- **Hosting:** a separate Render web service (Docker, Starter, always on, `/healthz`, manual deploys) and its own Render PostgreSQL. Neither refers to the production API or MongoDB.
- **Review rules:** the dashboard and review pages, the review rules (`manual-lib.mjs`) and the views are shared with the local tool. The views were moved to `review/dashboard/views.mjs`, behaviour-neutral (50 existing tests).
- **Sign-in:** Google Sign-In ID tokens are verified on the server with `google-auth-library`. Only allowlisted, active accounts are admitted.
- **Sessions:** HttpOnly/Secure/SameSite cookies, stored hashed. They expire (12 h idle / 7 days) and are revoked when the account is deactivated.
- **Reviewer identity:** the reviewer name comes from the account, never from the browser.
- **Review log:** stored as the exact hashed lines. A trigger makes it append-only (UPDATE/DELETE/TRUNCATE refused). Appends are atomic, serialised per recording by an advisory lock.
- **Audio:** all 801 recordings are served by their original providers (checked: exact size + byte ranges).
  - **CBR:** plays directly from the provider (a redirect for signed-in reviewers).
  - **VBR:** decoded temporarily on the server for exact seeking.
  - **Waveforms:** computed from the originals (size, SHA-256 and decoded duration checked) and stored.
  - Nothing is mirrored or uploaded.
- **The legacy name "Hamza":** reserved. It goes to the owner's account only through an explicit identity link with evidence. No event is rewritten.

**Migration tooling** (`migrate.mjs`):
- bundle (sanitised; byte-exact logs; SHA-256 manifest), plan (dry run), apply (atomic, idempotent), verify;
- link-identity, create-account;
- backup / restore (empty database only, verified);
- source-check, push-packages (future packages, administrator token);
- cutover (the local dashboard becomes read-only), and pull-events + rollback-cutover (rollback).

**Rehearsal with the real data** (local PostgreSQL; staging copies deleted): 28/28 steps.
- **Migrated exactly:** the five real reviews present then: Rifaat 98, 73 and 72, Saleh Al-Talib 87 and Abdul Basit 2. 339 events, every line byte-identical, chains valid.
- **In the cloud:** each shows "first review completed".
- **Identity:** "Hamza" can only be claimed through the link.
- **Backup:** it restores identically.
- **Local files:** unchanged.

During the session the owner kept reviewing locally: **Sufi 3 and Sufi 37** (partial) were started after the
rehearsal. The bundle is therefore built at the cutover itself, after local reviewing stops, so it captures
everything present then.

**Tests:**
- **`mobile/tests/audioReviewCloud.test.ts`:** 18/18, on a real PostgreSQL with synthetic data. It covers:
  - sign-in, revocation, CSRF/host/content-type, impersonation;
  - per-ayah blindness, concurrency (no lost update; one of six duplicate submissions accepted), the append-only trigger;
  - restart, migration (dry run, idempotence, divergence refused), identity link;
  - cutover and rollback (pull-events);
  - imports (administrator only; never events; tampered text refused), backup/restore/tamper;
  - audio (source check, waveform, redirect, VBR decode, provider failure keeps the task listed);
  - path tricks, body limits, rate limits, no local paths, read-only.
- **Browser (headless Chrome)** against a local cloud instance on a staging copy of the real data, deleted afterwards: 16/16. It covers sign-in redirect, the 801 recordings, the fixed reviewer name, administration and its refusal to a reviewer, streaming and seeking Rifaat 98 from MP3Quran, a second account blind to Hamza's times, a browser submission stored with its account, no CSP violation and no page errors.
- **All 16 audio suites:** 294/294. **TypeScript, ESLint:** clean. **Full suite:** only the 37 known QPC failures.

**Defects found and fixed by these tests:**
- the path scrubber mistook `https:` for a drive letter;
- the test database encoding (now refused unless UTF-8);
- miniaudio silently mis-decoding a mismatched extension (now the original extension, plus a duration check);
- a VBR source/PCM file-name clash;
- an oversized request body corrupting the next request on the same connection (now drained, then 413).

**Not verified (needs the deployment):** the Docker build (no Docker on this computer), Render itself, real Google
sign-in, and Render-to-provider streaming.

**Estimated cost:** about $13–14 per month (Starter about $7 + PostgreSQL Basic-256mb about $6 + 1 GB storage about
$0.30), to be confirmed on render.com/pricing.

## 14. Phase 4.8.4: the review workstation (2026-10-19)

**Status:** implemented and tested on this computer. **Nothing was committed, built or deployed.** The local
dashboard on port 8765 still runs the earlier server code. Restart it to enable the automatic checks; until then
those checks show *Needs review*.

**The review page** (`review/manual/index.html`, shared by the local and cloud dashboards):
- **Full surah overview:** coloured clickable markers and the zoom window.
- **Zoomed ayah waveform:** zoom, Fit, pan, a draggable marker shown to the millisecond, Replay boundary.
- **Current ayah panel:**
  - the canonical text;
  - proposed / your / submitted times, status, priority, warnings;
  - Confirm / Adjust / Mark uncertain / Replay / Next pending;
  - Play | At playhead | Go playhead.
- **Submit reviewed ayahs.**
- **Comparison:** Agree with other reviewer *proposes* the other time; Accept proposed resolution accepts it.
- **Complete ayah list**, with Go playhead.
- **Verification questions:** described below.

Usage: `tools/quran-audio/review/dashboard/README.md`, "The review workstation".

**Keys:**
- **Enter** confirms and saves, then goes to the next pending ayah.
  - It never confirms an uncertain, rejected or unheard marker, and sends one event per press.
  - When nothing is left it shows "No more pending ayahs".
- **↑ / ↓** step through every ayah. **N** is kept.
- No key is intercepted inside fields.

**Listening gate:** Confirm is refused until playback on the page has covered ±0.4 s around the boundary.

**Automatic checks** (`objectiveChecks` in `manual-lib.mjs`, returned with every view and event response by both
servers):
- canonical text;
- recording identity (bytes and SHA-256 of the file served for review);
- timings complete;
- timings in canonical order;
- each submitted start equal to its saved time;
- the audit hash chain.

The page adds: audio loaded, and duration.

The answers mean:
- **YES** only with evidence;
- **NO** only for a detected error;
- **Needs review** otherwise (an unreachable provider counts as Needs review, not NO).

The checks are pure: they never write, never answer a human question, and never include the other reviewer's times.
The human questions stay unanswered until the reviewer answers them.

**Completion gate:**
- **Finish** stays disabled while an automatic check fails or a human question is unanswered.
- The server refuses a final submission whose submitted starts differ from the saved work.

**Tests:**
- **`mobile/tests/audioReviewWorkstation.test.ts`:** 7/7, on synthetic data. It covers:
  - YES/NO/Needs review for each check, including a network failure and a size or hash mismatch;
  - recalculation after a correction;
  - detection of out-of-order times, a submission differing from the work, and a forged event;
  - purity and blindness;
  - the completion gate;
  - the local server hashing the served file.
- **Review-tool suites** (manual timing, dashboard, partial review, cloud, workstation): 75/75.
- **All 16 audio test files:** 295/295. **TypeScript, ESLint:** clean.
- **Browser (headless Chrome)** on an isolated copy at port 8771, with test names:
  - the workstation: 37/37;
  - partial submission and resume: 20/20;
  - the Phase 4.8 dashboard: 40/40.
  - The two earlier suites now listen before confirming, as the gate requires.
- **Cloud browser check:** 17/17 on a deleted staging copy, including the listening gate refusing an unheard confirmation.
- **Full suite:** 3203 passed. The 37 known `mushafScreen` QPC failures remain.
  - `startupRegression` failed once (1 test) under full-suite load and passes on its own.
  - The cloud test's temp-folder cleanup hit a Windows EPERM under load; it now retries.
- **Real review logs (10 recordings):**
  - every chain verifies;
  - the four logs in the pre-cloud backup are unchanged prefixes of the live ones;
  - the other six were reviewed by the owner since then.

**Limits:**
- The listening gate runs in the browser. The server cannot know what was heard, so a modified client could skip it.
- The "pending", "high priority" and "disputed" colours depend on the review data available to that reviewer. Blind
  reviewers never see the other reviewer's colours.
- The cloud dashboard is still not deployed (§13).

## 15. Phase 4.8.4.1: fast review actions, no listening gate (2026-10-19)

**Status:** implemented and tested on this computer. **Nothing was committed, built or deployed.** The local
dashboard on port 8765 still runs the earlier server code. Restart it to enable bulk review; until then, a bulk action
is refused and nothing changes.

**Changes:**
- **Listening gate removed.** It was only in the page, never in the server or the log.
  - The page no longer tracks playback, shows no "boundary heard" indicator, and sends no playback data.
  - Confirm, **1**, Enter, Accept proposed boundary, the bulk actions, Submit reviewed ayahs, Finish and the two resolution buttons need no playback.
  - Play and Replay boundary remain.
- **Wording now states a judgement, not listening.** This covers the help text, the proposal banner, the duration check, the error messages, and the auto-filled resolution notes ("in my judgement…", instead of "heard again").
- **Earlier records unchanged.** Earlier events and notes are not rewritten.
- **Layout:** one column. Verification Questions sit directly under Current Ayah, then Submit, Comparison, the ayah list, Flags and Comments.
- **Accept proposed boundary** (Current Ayah):
  - confirms the proposed time and saves it at once;
  - no seek, no playback, no advance, no submission;
  - asks before replacing your own time.
- **Enter:** one decision per press. A second Enter during the save and a held Enter are ignored.
- **Bulk review** (top of the ayah list): Accept All Proposed, Reject All Proposed, Accept All Edited.
  - Each shows a preview first: total, eligible, exact ayahs, excluded with reasons, All eligible / Selected only, Confirm / Cancel.
  - Each is applied by one audited `bulk` event (`manual-lib.mjs`).
  - **The server checks each listed start** against the reviewer's saved work and the session's proposal (`bulkExclusion`):
    - edits and explicit judgements are never overwritten;
    - submitted starts are locked;
    - canonical order is enforced;
    - the request comes from the reviewer themself, before the final submission.
  - **Any ineligible start refuses the whole request.** A repeat is therefore refused instead of applied twice, and concurrent duplicates yield exactly one event (cloud test).
  - Reject All Proposed keeps the proposed time.
  - The cloud server's event allow-list includes `bulk`.
- **Unchanged:**
  - two-reviewer blindness per ayah; one reviewer's acceptance verifies nothing;
  - Agree = propose; corrections with reasons; the append-only hash chain;
  - the objective checks and human questions (still answered only by the reviewer).

**Tests:**
- **`mobile/tests/audioReviewWorkstation.test.ts`:** 11/11. Four new tests, on synthetic data:
  - the three bulk actions;
  - exclusions;
  - refusal without any change;
  - atomicity, order, identity and final-submission rules;
  - a review finished with no playback record, with blindness, objective checks and the chain intact.
- **`audioReviewCloud.test.ts`:** 19/19. New: six concurrent identical bulk requests produce one event; another reviewer's work is refused.
- **`audioPartialReview.test.ts`:** one message expectation updated (no "listen again").
- **Review-tool suites:** 80/80. **All 16 audio test files:** 300/300. **TypeScript, ESLint:** clean.
- **Full suite:** 3208 passed. The 37 known `mushafScreen` QPC failures remain.
- **Browser (headless Chrome)** on an isolated copy with test names, each on a clean instance:

  | Suite | Result | What it covers |
  |---|---|---|
  | New fast-review check | 46/46 | Every point of the brief's test list, with `audio.played` empty until the playback-controls check at the end |
  | 4.8.4 workstation | 36/36 | Gate assertions replaced |
  | Partial submission | 20/20 | Listening steps removed |
  | Phase 4.8 dashboard | 40/40 | |
  | Cloud check | 19/19 | Confirm without playback; a bulk event stored with the account; no CSP violation |

- **Real review logs (11 recordings, including a Sufi 42 review started during this phase):**
  - every chain verifies;
  - every log matches the pre-4.8.4.1 backup (`Backups/quran-heals-audio-review/pre-4.8.4.1-20261019T192832Z`) as an exact prefix;
  - none contains a bulk event.

**Limits:**
- A confirmation records the reviewer's judgement only. Nothing shows how much of the audio a reviewer heard.
- Bulk actions act only on undecided starts. To overturn an explicit judgement, change that start individually.
