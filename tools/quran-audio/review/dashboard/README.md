# Audio review dashboard (Phase 4.8)

**What it is:** one local web page for every pending listening review of the Quran Heals audio project. It shows
every recording that needs a person's ears, every ayah start by risk, and what is blocked and why. It opens each
recording in the listening and timing page.
- It runs on this Windows computer only (`127.0.0.1`), in Chrome or Edge.
- No Expo, emulator or simulator is needed.
- It never approves, activates or changes timing. A start counts only when two people have confirmed it by ear.

Report: `docs/audio/audio-review-dashboard-phase-4-8-2026-10-19.md`.

## Start it

Double-click **`start-dashboard.cmd`** in
`Working progress/Screenshots and Logs/audio-review-dashboard/`. It starts the server and opens
**http://127.0.0.1:8765/**.

Or, from `QuranHeals/tools/quran-audio`:

```bash
node review/dashboard/server.mjs --config "../../../Working progress/Screenshots and Logs/audio-review-dashboard/dashboard.config.json"
```

- **Stop it:** Ctrl+C, or close the window. Every change is already saved.
- **Needs:** Node 24 and Python 3.12. The Python draws waveforms with `../../pylib` (numpy, miniaudio); its path is `"python"` in the configuration.

## What it shows

| Tab | Content |
|---|---|
| Totals | Recordings and ayah starts awaiting review; high-risk starts; manual-timing recordings and recordings with automatic proposals; Reviewer 1 and Reviewer 2 submissions; disputed starts; technically verified recordings; blocked recordings; import problems |
| Recordings | One row per recording: reciter (Arabic and English), surah, ayahs, length, audio source, phase, review type, priority, progress, reviewers, statuses, outstanding problems; **Start review** / **Continue review** |
| Needs attention | Every open ayah start, most urgent first: disputed, high, medium, check (worklist samples and openings), routine (optional). **Listen** opens the page at that ayah |
| Blocked & superseded | Recordings that cannot be reviewed here, each with its documented reason; older or duplicate candidates (full list in the inventory) |
| Sources & import | Every configured or discovered source, its import counts, and every refused package with the reason |

**Filters:** reciter, surah (number or name), status, review type, priority and phase.

**Statuses are kept apart:**
- alignment completed (or manual timing required);
- human review pending;
- first review completed;
- second review completed;
- technical verification completed;
- rights pending or cleared;
- approved for development;
- active in development.

Technical verification is never permission. Rights stay pending until the owner records a decision (below).

## Reviewing

The review page is `review/manual/index.html`, the Phase 4.6 tool, extended. The rules are those of
`review/manual/README.md`.

1. **Name.** Type your name. Start as **Reviewer 1**, or as **Reviewer 2** if someone else already started.
2. **Listen and place.** For each ayah:
   - **Confirm proposed** (**C**) only after hearing that the dashed automatic proposal sits at the onset of the ayah's first sound;
   - or put the playhead at the onset, press **M**, refine with **[ ]**, check with **Q** (the seconds before) and **W** (the seconds after), then judge it **1** confirmed, **2** uncertain or **3** rejected.
3. **Finish.** Place the recitation end (**E**) and answer the whole-recording checks, which include playback. Flag repetitions, omissions and extra audio, then press **Submit**.
4. **Second review.** Reviewer 2 works blind: Reviewer 1's placements stay hidden until both have submitted. Disagreements over 250 ms are then resolved by one reviewer proposing a time and the other accepting it.

### The review workstation (Phases 4.8.4 and 4.8.4.1)

The review page is one column, top to bottom (4.8.4.1 moved Verification Questions under the current ayah):

1. **Full surah overview.** The whole recording, with one coloured marker per boundary: verified, submitted, saved, high-priority, proposed, uncertain or disputed. The box shows the zoomed window. Click a marker to select that ayah, or click elsewhere to move the playhead.
2. **Zoomed ayah waveform.**
   - **Zoom in / out / Reset / Fit ayah** (**+**, **−**, **0**, **F**) and pan **◀ ▶**.
   - Drag your marker to move it. The time is shown to the millisecond.
   - **Replay boundary** (**R**) plays the seconds around it, with the context before and after set in the toolbar.
3. **Current ayah.**
   - The canonical Arabic text.
   - The proposed, your, and submitted times, with status, priority and warnings.
   - **Confirm boundary**, **Accept proposed boundary**, **Adjust boundary**, **Mark uncertain**, **Replay boundary**, **Next pending ayah**.
     - **Accept proposed boundary** confirms the proposed time and saves it at once. It does not move the playhead, play anything, submit, or move to another ayah.
     - If you have placed your own time, it asks before replacing it; your earlier saved time stays in the log.
   - **Play | At playhead | Go playhead.**
4. **Verification questions**: described after this list.
5. **Submit reviewed ayahs** (as in 4.8.1).
6. **Comparison** (`Ayah | My timing | Other timing | Difference | Status | Action`), shown only for ayahs that both reviewers have submitted.
   - **Agree with other reviewer** *proposes* the other time as the resolution. It is not a silent agreement.
   - **Accept proposed resolution** accepts the other reviewer's proposal.
7. **Complete ayah list**, with **Go playhead** on each row, a tick box per ayah, and the bulk toolbar (below).

**Verification questions:**
- **Automatic checks** are answered by the server and the page:
  - canonical text;
  - recording identity (size and SHA-256 of the file served for review);
  - audio loaded and its duration;
  - timings complete and in order;
  - every submitted start equal to its saved time;
  - the audit chain.
- Each automatic check shows **YES — Check passed** only with evidence, **NO — Check failed** only for an error it actually detected, and otherwise **Needs review** (for example, a provider that cannot be reached).
- **Human questions** (voice, repetitions, omissions, playback) are answered only by you; nothing is filled in for you.
- The summary reads "Verification checks: X passed · Y failed · Z need review". **Finish** stays disabled while any automatic check fails or a human question is unanswered.

**Bulk review** (the toolbar at the top of the complete ayah list):

| Action | What it does |
|---|---|
| **Accept All Proposed** | Confirms each eligible boundary at its proposed time |
| **Reject All Proposed** | Marks each eligible proposed boundary rejected, keeping the proposed time so you can correct it later. Nothing is invented or deleted. |
| **Accept All Edited** | Confirms your own adjusted boundaries that are not judged yet, at **your** times |

- **Eligible:** only starts nobody has judged yet.
- **Always excluded, with the reason shown:**
  - your own edits (from the proposal actions);
  - anything you confirmed, rejected or marked uncertain;
  - submitted starts (use **Correct**) and starts with an open correction;
  - starts outside the check;
  - a time that would break the canonical order.
- **Preview first:** every action shows a preview before anything changes.
  - It shows the total, the number eligible, the exact ayahs, the number excluded and why.
  - It offers **All eligible ayahs** or **Selected ayahs only** (the ticked rows), then **Confirm** or **Cancel**.
- **On Confirm:**
  - One `bulk` event goes into the audit log, by you, for this recording only.
  - The server re-checks every listed start against your saved work. If any is ineligible, the whole request is refused and nothing is applied, so a repeat never applies twice.
  - Nothing is submitted.
- **Server version:** a dashboard server started before Phase 4.8.4.1 refuses the event, and nothing changes. Restart the dashboard to use bulk review.

**Keys:**
- **Enter** confirms and saves the selected boundary, then goes to the next pending ayah.
  - It never confirms a marker you marked uncertain or rejected.
  - One press is one decision: a second Enter during the save, and a held (repeating) Enter, are ignored.
  - If the save fails it stays on the ayah and says so. When nothing is left it shows **No more pending ayahs**.
- **↑ / ↓** go to the previous / next ayah, through every ayah. **N** and **F** are unchanged.
- No key is intercepted while you type in a field or while the bulk preview is open.

**Listening is your decision (Phase 4.8.4.1):**
- No minimum playback is required for Confirm, **1**, Enter, Accept proposed boundary, the bulk actions, Submit reviewed ayahs or Finish.
- The page records no playback evidence.
- A confirmation means your judgement, not proof that audio was played. Play and Replay boundary remain for listening as much as you need.
- Phase 4.8.4's 0.4 s listening gate was removed. It only ever existed in the page, never in the server or the log.
- Playback position and review state stay separate: playing, seeking and zooming never change a judgement.

### One review is enough to clear the queue (Phase 4.8.6)

An ayah start leaves the pending queue once it has an accepted submission (`confirmed`, including after a correction). Saved, uncertain and rejected starts stay pending. The dashboard and the review page default to **Pending**; **Reviewed** and **All** bring finished work back, and each reciter shows its starts left, e.g. "Muhammad Rifaat (444)" or "(0)". Independent verification by two reviewers, publication eligibility and publication are separate statuses. Every statistic is defined in `docs/audio/single-review-workflow-phase-4-8-6-2026-10-19.md`.

### Automatic acceptance by risk tier (Phase 4.8.7)

Owner policy of 2026-10-20 (`auto-accept.mjs`, policy `auto-accept-v1`): manual listening is kept for **high** and **medium** risk starts only.

| Tier | Treatment |
|---|---|
| `high`, `medium` | manual review required (the default Needs Attention queue, with disputed starts) |
| `check` (worklist samples, openings, source-audit listening checks), `routine` (every other start) | accepted automatically at the proposed start, if it passes validation |
| anything else | never accepted; counted as "other unresolved" |

A start is accepted only if: the recording is registered (import validation passed), is not synthetic, has a proposal whose fingerprint is the inventory's, is not blocked, its alignment structure is `ok` and no ayah is missing from it; the start's proposed time exists, lies inside the recording and in order, and the aligner did not collapse that ayah; and no reviewer has rejected it (now or in its revision history), marked it uncertain, moved it, declared it unresolvable or is resolving it. A start a person already accepted stays a person's review.

Acceptances go to their own append-only, hash-chained ledger, `data/_auto-acceptance/ledger.jsonl`, never into a review log: no reviewer is created, nothing is submitted, and two-reviewer verification, the export and the publication rules (which read the review logs only) are unchanged. An acceptance is tied to the proposal's fingerprint and proposed time; a changed package drops it. A reviewer's later rejection returns the start to the queue (the ledger keeps the history). Manual-timing recordings (no proposal) are never accepted.

The server runs the pass on start, after **Refresh queue** (new review batches) and a few seconds after review activity, with a `pre-auto-accept-*` backup before any write; `--no-auto-accept` turns it off (the ledger is still read). By hand: `node review/dashboard/auto-accept.mjs --config <cfg>` (dry run) or `--apply`. Reruns write nothing twice.

A reciter is **Completed** when every start of every reviewable recording is accepted (by a person or automatically), nothing is disputed and no registered recording lacks reachable audio. It is derived from the logs and the ledger, so it survives restarts; the ledger records `reciter-completed` / `reciter-reopened`. See the **Reciters** tab.

Known limit: the policy reads both reviewers' work, so a check/routine start left in the queue among accepted ones tells a blind Reviewer 2 that someone judged it otherwise.

### Very High Risk and policy auto-accept-v2 (Phase 4.8.9)

Owner decision of 2026-10-23. Tiers, most urgent first: **veryhigh**, high, medium, check, routine. Policy `auto-accept-v2` accepts **high, medium, check and routine** starts automatically (same validation as before). **Very high** starts always need a person.

A start is Very High Risk only on credible structural evidence (`../manual/very-high.mjs`):

- a production or measured start the boundary sweep found ≥ 300 ms inside recitation: late means a cut-off beginning, early means an overlap;
- the aligner's `reordered` (wrong order) or `past-own-end` (overlap) repairs;
- `opening-squeezed` (ayah 1 collapsed: maybe missing);
- a whole recording with a documented repetition concern, or a Phase 4.5 verdict "with repeated passages";
- a reviewer's own No to "this surah", "every ayah recited" or "canonical order", a missing-passage flag, or a repetition that returns to earlier ayahs.

Silence, pauses, the Basmala, isti'adha, extra sounds, disagreeing alignment runs, weak text scores, MP3Quran disagreement, Quranic refrains and Phase 4.5 "conflict" evidence are **not** Very High on their own. The opening keeps its 0:00.000 rule and stays a check.

The detection runs before every acceptance pass. An earlier acceptance stops applying when its start becomes very high; the ledger entry stays as history. Human decisions still win: a rejection, an uncertain mark, a dispute or a manual edit is never accepted automatically.

The default queue (Needs Attention) shows very high starts first, then disputes, then the **exceptions** the policy could not accept, each with its reason (blocked, rejected, manual timing…). Automatically accepted starts stay under Reviewed / All, labelled as administrative acceptances, and can still be corrected or rejected by a person.

An automatic acceptance is never a human listening verification. Two-reviewer verification, export and publication read the review logs only.

**Yes / No questions.** The review page asks five Yes / No questions per start:

- complete;
- order;
- no overlap;
- timestamp correct;
- aligned.

Answers default to Yes. They are stored on the reviewer's marker as `{ v, confirmed }`, so a default Yes is always distinguishable from a clicked one.

- A No rejects the start, and a confirmed start cannot carry a No.
- Nothing is submitted by answering.
- Submitted answers are frozen; a change is a correction, with its reason.

The whole-recording questions are Yes / No with a default Yes. When you finish, the defaults are recorded in `work.checksDefaulted`, never as confirmed answers.

### The opening plays from 0:00.000 (Phase 4.8.8)

Owner rule of 2026-10-23 (`../manual/opening.mjs`, rule `opening-zero-v1`): ayah 1 of every complete surah recording plays from the very start of the file. Its **effective** start is exactly 0 ms, whatever a proposal, a production timing or a reviewer placed; no later start moves and the audio is never changed. The original first timestamp is kept as the ayah-1 **onset** (where its words begin after any isti'adha, Basmala, introduction or silence), for highlighting only.

- Not applied (and reported): synthetic data; an excerpt, a partial file, or an alignment with no ayah 1 (`excluded`); a production boundary check that does not list ayah 1 (`out-of-scope`: the app already plays it from 0).
- The opening start is a **check** only, never high or medium on its own; its earlier flags (aligner collapse, production sweep, Phase 4.5 evidence) and a late onset stay visible as **exceptions** in the risk reason, the task's `opening` and the amendment ledger.
- Stored sessions and review logs are never rewritten; they replay as recorded. The rule is applied on top: the comparison of two reviewers (both at 0, each placement kept as `placedMs`), `finalTiming`, the export (`opening`, onset for highlighting), the publication document (`entries[0].startMs` 0, `introEndMs` the onset), the auto-acceptance pass (the opening is accepted at 0, manual-timing recordings included), `/api/session` (ayah 1 proposed at 0, `opening`, `proposal.openingOnsetMs`) and the Needs Attention list.
- Every first timestamp above 0 that the rule overrides (proposal, a reviewer's saved or submitted ayah-1 start, a resolution, an earlier automatic acceptance) is recorded in `data/_opening-rule/ledger.jsonl` (append-only, hash-chained, one entry per recording and set of values; a later review above 0 gets a new entry). The server writes it on start, refresh and after review activity, after a `pre-opening-rule-*` backup; `auto-accept.mjs` does the same by hand.
- The review page shows, seeks, plays and draws ayah 1 at 0:00.000, keeps it there when placed or nudged, leaves it out of bulk actions (it is accepted by the rule), and shows the onset and any exception beside it.
- `make-packages.mjs` writes `opening: { rule, startMs: 0, onsetMs }` into every new package; the import refuses a package whose declared opening is not 0.

### Owner override: an owner-authorized, unverified acceptance (2026-10-24)

`owner-override.mjs` lets the owner take one start out of the queue without verifying it (first and only use: Ali Abdullah Jaber 88:14, owner instruction of 2026-10-24). It is **not** a review, an automatic acceptance or verification: nobody listened, and the voice identity and the text are not confirmed.

- Written to its own ledger, `data/_owner-override/ledger.jsonl` (append-only, hash-chained, backed up and checked like the others), never to a review log or the automatic-acceptance ledger. Each entry records `verified`, `listened`, `identityConfirmed` and `textConfirmed` as false, `releaseBlocked: true`, the owner's words, every open automated concern and the evidence file.
- Tied to the exact package fingerprint, audio sha256 and per-ayah file: if any changes it stops applying. It never applies to a very high risk start, and a reviewer's judgement (a rejection, uncertain, edited, unresolvable, being resolved) always wins.
- The dashboard counts it apart (`ownerOverride`), labels the start "owner override (UNVERIFIED …)", shows the reciter as "completed with owner override (unverified)" and writes no reciter-completed milestone (`completedAt` stays null). The start can still be reviewed on its review page.
- `per-ayah/release-gate.mjs` blocks any recording with an override (gate `overrides`).
- `node review/dashboard/owner-override.mjs --config <cfg> --key <recording> --ayah <n> --authorized-by <owner> --instruction <words> [--evidence <file>]` is a dry run; `--apply` takes a `pre-owner-override-*` backup first. A rerun writes nothing and takes no backup.

### The remembered reviewer (Phase 4.8.8)

`dashboard.config.json` may name this installation's default reviewer: `"localReviewer": { "name": "Hamza", "role": 1 }` (role 1 only; anything else is ignored). The pages use the browser's own choice first (`localStorage` `qh-reviewer`, kept across refreshes, browser restarts and server restarts), else that default. When it is Reviewer 1 and a recording has no Reviewer 1 yet, the review page works as that reviewer at once; the `join` event is written with the first real change, so browsing writes nothing. Reviewer 2 is never assumed. **Switch reviewer** clears the remembered choice; choosing Reviewer 1 by hand remembers it again. The cloud dashboard (signed-in accounts) does not use this.

### Reviewing in batches (Phase 4.8.1)

You never need to finish a surah to save or submit work. **Listen to some ayahs → confirm them → Submit reviewed
ayahs → close the dashboard → return later → continue where you stopped.**

1. **Listen and judge** a few starts: **C** (the proposal is right) or **M** + **1** (placed by ear).
   - A start marked *uncertain* (**2**) is never submitted.
   - Mark a start *rejected* (**3**) only if you really reject it.
2. **Save progress** (**S**, or automatically within a second) keeps everything, including unfinished work. Nothing saved is submitted.
3. **Submit reviewed ayahs** submits exactly the starts you judged and have not submitted yet.
   - The button lists them, e.g. "will submit: 1–10, 25–30".
   - There is no confirmation dialog, and the recording and playhead stay where they are.
   - It then reports, e.g., "16 submitted (1–10, 25–30). 184 pending."
4. **Come back later.** The page opens at your next unfinished ayah, with a **Continue review** banner.
   - **Next unreviewed ayah** (**N**) jumps ahead at any time.
   - Each row shows *pending*, *saved, not submitted*, *submitted*, *verified* or *disputed*, and **Show** filters the rows by state.
5. **Correct a submitted start** with **Correct** on its row.
   - It asks once for the reason; then move the start, judge it, and press **Submit correction**.
   - The earlier submission stays in the history (revision 2, 3…).
6. **Finish the whole review** at the end: place the recitation end and answer the whole-recording checks. Any start not yet submitted goes with it.

**Rules:**
- **Reviewer 2 can start at any time,** on any ayahs.
- **Blind per start:** the other reviewer's time for a start appears only after **both** have submitted that start. Until then the page shows which starts they have submitted, never a time.
- **Resolving:** a start submitted by both can be resolved by proposal and acceptance at once, without waiting for the surah.
- **Independence:** a start changed after the other placement was shown is never counted as independent agreement; it needs a resolution.
- **Verification:** a recording stays **partially reviewed** until both reviewers have finished everything. It is never verified, exported for apply-review, or applied on partial work.

The dashboard shows per recording:
- starts submitted by Reviewer 1 and by Reviewer 2, verified, disputed and remaining;
- your own submitted and saved-but-unsubmitted starts.

Its **Status** filter offers Pending, In progress, Submitted, Verified and Disputed. **Needs attention** can hide the starts
you have already submitted.

**Other keys:** **A** plays the selected ayah only. **J**/**K** go to the previous/next ayah. **S** saves now; every change is also saved within a second.

**Never automatic:**
- Opening a recording or joining places nothing.
- A proposal is drawn dashed and read-only.
- Moving a marker clears its judgement.

**Muhammad Rifaat** recordings have no proposal: every start is placed by ear. The Phase 4.5 brackets and pauses are
only places to listen. A recording that returns to earlier ayahs cannot be represented by one start per ayah: flag it,
and it stays **unresolved**.

## Sources and future review packages

The dashboard reads only what its configuration names, validates it, and registers one task per recording (reciter,
surah, URL, size). Source kinds:

| Kind | Content | Example |
|---|---|---|
| `manual-sessions` | `review/manual/prepare.py` sessions + `queue.json`; reviews stay in the source's own `data/` | Rifaat (18) |
| `review-packages` | a folder with `index.json` (`ayah-timing-review-index`) of `review/make-packages.mjs` packages | Phase 4.1 (485), Phase 4.7 (25) |
| `legacy-flags` | Phase 4 `<reciter>/<surah>.flags.json`, read only to record what newer packages supersede | Phase 4 test batch (26) |
| `production-review` | Recordings **already in the app** with documented, unresolved listening checks: the boundaries `docs/audio/source-audit.md` left "to be checked by listening" (`audit-results.json` `review` + the boundary sweep's production start), and its listening checks (`known-issues.json` `productionChecks`) | 283 recordings, 1,327 starts |

**Production boundary checks** are scoped:
- only the listed starts are placed and compared (the other ayahs are shown, locked);
- there is no recitation end;
- only the playback question is asked.

**The result is a list of findings** for the owner: each production start that the reviewers placed more than 250 ms
away. It never produces timing and never changes the app.

**A new phase registers its work by writing a package folder with `make-packages.mjs`** (or the same JSON format)
anywhere under a scan root (`scanRoots`, default: `Working progress/Screenshots and Logs`, three levels deep).
- Add `"phase": "4.9"` to its `index.json` so the dashboard can label it.
- Press **Refresh queue**: the new recordings appear in the list and in Needs attention.
- A `queue.json` of kind `manual-timing-queue` (with `audio/` and `data/` beside its folder) is discovered the same way.
- No code change is needed for a new reciter or recording.

**Every package is validated before it is registered.** It is refused (listed under import problems) unless:
- it is a known reciter;
- it has the canonical ayah count;
- its Arabic text is verbatim from `tools/quran-verification/input/quran-uthmani.txt`;
- its timing is in order and inside the audio;
- its URL is https from MP3Quran, archive.org or Way2Quran;
- its own timing matches its fingerprint (a package edited after it was made is refused).

**Duplicates and superseded candidates:** they are listed with the task that supersedes them, never counted twice. A
recording with production timing is not reopened.

**A session whose review has begun is never replaced.**
- If its package changes later, the change is reported and the review keeps the version it started on.
- Concerns and rights follow the current documents.

**Documented concerns** from earlier reports are shown on the matching recording. They live in `known-issues.json`,
together with the owner's *start here* list and recordings that have no package. Every entry names its source.

## Audio

**Local copies come first.** Each must have the package's exact size, and SHA-256 when known:
- the configured `localAudio` folders, by naming pattern or by hash;
- the cache.

**Otherwise the recording is downloaded once from its original URL** into the cache.
- The cache sits outside OneDrive: `%LOCALAPPDATA%\QuranHeals\audio-review-cache`.
- The size is checked, so an error page is never kept.
- A recording that cannot be fetched stays on the dashboard with the reason.

**Waveforms and quiet regions** come from `peaks.py`, on the decoded timeline (miniaudio, 16 kHz: the aligner's).

**VBR files** (32 in Phase 4.1) play from a lossless PCM decode of the unmodified file, because browsers cannot seek
VBR exactly. CBR files play as they are.

**Nothing is published.** The audio is never modified or re-encoded, and nothing is hosted.

## Review data and backups

| What | Where |
|---|---|
| Reviews of package recordings | `audio-review-dashboard/data/<key>/events.jsonl` |
| Reviews of Rifaat recordings | `rifaat-manual-review-2026-10-18/data/<key>/events.jsonl` (the same database as the Phase 4.6 tool) |
| Generated sessions, inventory | `audio-review-dashboard/registry/` (rebuilt by Refresh queue; holds no reviews) |
| Owner rights decisions | `audio-review-dashboard/rights/*.json` (empty) |
| Backups | `%USERPROFILE%\Backups\quran-heals-audio-review\` |

**Logs:** every review log is append-only and hash-chained. State is always rebuilt from it.

**One writer per database:** while the dashboard runs, it locks every data folder it writes. A second dashboard, or
`review/manual/server.mjs`, refuses to start on the same folder.

**Automatic backups:**
- **When:** on start, a few seconds after every submission, amendment or resolution, and every 10 minutes while reviews change.
- **What:** each snapshot is a copy with a SHA-256 manifest, checked after copying. Every log in it is checked for an unbroken hash chain.
- **Kept:** the 60 newest automatic snapshots. **Back up now** makes one by hand.

```bash
node review/dashboard/backup.mjs --config <cfg> --list
node review/dashboard/backup.mjs --verify <snapshot>
node review/dashboard/backup.mjs --restore <snapshot> --to <empty folder>   # never overwrites; then stop the dashboard and copy back
```

## Export and applying (owner only)

**Export review (JSON)** on the review page:
- **Before both reviewers have submitted:** only your own work.
- **After:** the full record.

**For a verified recording, the export also holds the pair `development/apply-review.mjs` reads:**
- **Rifaat:** source `manual`.
- **Packages:** the package's own source (`aligned` or `development`), with the original package (checked against its import hash) and a version-3 review naming both reviewers. Every start carries its proposed and agreed time.

**apply-review refuses when:**
- rights are pending: the pair is blocked, as for manual timing;
- the data is synthetic;
- the recording is playback-blocked (VBR hosting, Phase 4.7 permissions).

**Caveat (aligned and development pairs):** apply-review keeps the package's own ayah-1 start and last-ayah end. The
export lists both under `caveats` when the reviewers agreed other times.

## Owner rights decision (format)

The owner writes it, never a tool. It is ignored unless it names the exact recording, including the SHA-256 shown in
the inventory:

```json
{ "kind": "owner-rights-decision", "reciterId": "banna", "surah": 18, "url": "https://cdn.mp3quran.net/audio/mahmoud-banna/r1/018.mp3",
  "bytes": 33018063, "sha256": "<64 hex>", "cleared": true, "basis": "<the written permission>", "decidedBy": "<owner>", "decidedOn": "YYYY-MM-DD" }
```

## Limits

- **Names are typed, not authenticated.** Independence relies on:
  - the server's blind view;
  - its refusal of one name in both roles (case-insensitive);
  - honest use.

  Anyone who reads the `data/` files directly can see a review early.
- **Timing precision:** a CBR file in the browser may differ from the decoded timeline by up to one MP3 frame (26 ms). The agreement threshold is 250 ms.
- **Development-stage recordings** (44) already play in development builds. This review is their first listening check.

## Files

| File | Purpose |
|---|---|
| `server.mjs` | Local server: dashboard, review page, APIs, audio preparation, backups |
| `dashboard-lib.mjs` | Discovery, validation, deduplication, risk tiers, inventory |
| `dashboard.html` | The dashboard page |
| `peaks.py` | Waveform + quiet regions (+ PCM for VBR) of an unmodified file |
| `backup.mjs` | Snapshots, verification, restore |
| `auto-accept.mjs` | Phase 4.8.7 automatic acceptance: policy, ledger, pass, command line |
| `../manual/opening.mjs` | Phase 4.8.8 opening rule: ayah 1 plays from 0:00.000; onset and exceptions |
| `../manual/very-high.mjs` | Phase 4.8.9 Very High Risk evidence (automatic and the reviewers' own findings) |
| `views.mjs` | Statuses, rows, totals, reciter completion, Needs Attention (shared with the cloud server) |
| `known-issues.json` | Start-here order, documented concerns, rights notes, recordings without packages |
| `../manual/log-store.mjs` | The append-only logs and the data-folder lock, shared with the Phase 4.6 server |
| `../manual/index.html`, `manual-lib.mjs`, `export.mjs` | The review page, the two-reviewer rules and the export (shared) |

Tests: `mobile/tests/audioReviewDashboard.test.ts`, `audioSingleReview.test.ts`, `audioAutoAccept.test.ts`, `audioOpeningZero.test.ts`, `audioVeryHigh.test.ts` (synthetic data, temporary folders).
