# Phase 4.8.6: single-review workflow and live dashboard statistics (2026-10-19)

**State:** implemented and tested on this computer; nothing committed or deployed.
- Automatic publication stays disabled, and its gates are unchanged: two independent reviewers, authorization, compatibility.
- Your running local dashboard (port 8765) keeps its old server code until it is restarted.
  - Until then the page shows "Restart the dashboard to see the single-review statistics" instead of the tiles.
  - The review page falls back to your own accepted submissions.

## The rule

An ayah start is **reviewed**, and leaves the pending queue, when a reviewer's **current** submission of it is an
accepted judgement (`confirmed`, including after a correction), or when a disagreement about it was formally
resolved. It is defined once, in `tools/quran-audio/review/manual/manual-lib.mjs` `reviewedStarts`, and used by the
dashboard counters, recording rows, reciter counts, the Needs Attention list, the review page and exports, both
locally and in the cloud.

- **These stay pending:**
  - saved but not submitted (bulk acceptance included);
  - uncertain;
  - submitted as rejected;
  - corrected to rejected.
- **Each start counts once:** unique starts of the replayed state, never events. Saves, retries, bulk events, corrections, the other reviewer and migration never double-count.
- **Ayah 1 is a start** like any other. The recitation end is not an ayah start.
- **Blindness:**
  - a reviewer still working blind counts the other reviewer's acceptances only for starts both have submitted (already revealed). The other's per-start judgements are never disclosed;
  - anyone who is not a reviewer of the recording sees counts only, never which starts.
- **Statuses, kept separate:**

| Status | Meaning |
|---|---|
| Review complete (one reviewer) | Every start reviewed |
| Independently verified | Two reviewers agreed, or formally resolved a disagreement |
| Publication eligible | Every publication check passes |
| Published | Active in the registry |

## Statistics (every tile computed from the review state; nothing hard-coded)

| Tile | Definition |
|---|---|
| Recordings awaiting review | Reviewable recordings with at least one start not yet reviewed (of N registered) |
| Ayah starts awaiting review | Starts still waiting for their first accepted submission, ayah 1 included (of the total) |
| Ayah starts reviewed | Unique starts with an accepted submission |
| High-risk starts open | High-risk starts not yet reviewed (of the high-risk total) |
| Partially reviewed | Recordings with reviewed and pending starts |
| Recordings completed: single review | Every start reviewed, not independently verified |
| Manual-timing / automatic proposals / production checks | **Totals** of each kind (they do not shrink with review) |
| Starts submitted by Reviewer 1 / Reviewer 2 | Current submitted starts per role (any judgement); "fully submitted" counts whole-recording submissions |
| Starts independently verified | Starts both reviewers agreed on (≤ 250 ms) or resolved |
| Disputed / unresolved starts | After both reviews |
| Technically verified recordings | Two independent reviewers and every check (not publication) |
| Blocked or unavailable | The inventory's blocked recordings, plus registered recordings without reachable audio (reported apart, never as pending work) |
| Import problems | Packages refused or changed |

**Updates:** the dashboard updates its statistics when you return to the page and every 30 seconds. The review page updates after every action.

## Lists

- **Dashboard → Recordings:**
  - **Show:** Pending (default: at least one start left), Reviewed (every start reviewed), All.
  - **Reciter (starts left):** e.g. "Muhammad Rifaat (444)". A finished reciter stays, as (0), after those with work.
- **Needs attention:** reviewed starts are left out by default (`show=pending|reviewed|all`). Disputes always stay listed.
- **Review page:**
  - **Show:** Pending (default), Reviewed, All, plus the detailed states.
  - A submission removes the reviewed starts from Pending and selects the next pending one.
  - Reviewed starts can be opened and inspected without change; a change is a correction, with its reason.

## Current statistics (real data, 2026-10-19 ~23:55 UTC; Hamza's view)

- 11 review logs, all chains intact.
- Snapshot `%USERPROFILE%\Backups\quran-heals-audio-review\pre-4.8.6-20261019T235456Z`.

| Tile | Value |
|---|---|
| Recordings awaiting review | 794 of 801 registered |
| Ayah starts awaiting review | 28,130 of 28,294 |
| Ayah starts reviewed | 164 |
| High-risk starts open | 2,327 of 2,364 |
| Partially reviewed | 4 (Rifaat 72: 3 starts submitted as uncertain; Sufi 19, 42, 111) |
| Recordings completed: single review | 7 (Rifaat 73, 98; Saleh Al-Talib 87; Abdul Basit 2; Sufi 3, 37, 112) |
| Manual-timing / proposals / production checks (totals) | 18 / 500 / 283 |
| Starts submitted by Reviewer 1 / Reviewer 2 | 167 / 0 (5 recordings fully submitted by Reviewer 1) |
| Starts independently verified | 0 |
| Disputed / unresolved | 0 |
| Technically verified | 0 |
| Blocked or unavailable | 17 (all 801 registered recordings have reachable audio) |
| Import problems | 0 |

167 submitted − 3 submitted as uncertain (Rifaat 72) = 164 reviewed.

**Reciters (starts left):**

| Reciter | Starts left | Reciter | Starts left |
|---|---|---|---|
| Abdul Rashid Ali Sufi | 619 | Mahmoud Khalil Al-Husary | 831 |
| Abdullah Basfar | 495 | Muhammad Rifaat | 444 |
| Abu Bakr Al-Shatri | 591 | Muhammad Siddiq Al-Minshawi | 506 |
| Ahmed Al-Ajmi | 626 | Saleh Al-Talib | 1,693 |
| Ahmed Naeena | 200 | Saud Al-Shuraim | 1,243 |
| Ali Al-Hudhaifi | 1,281 | Yasser Mahmoud Salama | 6,236 |
| Islam Sobhi | 5,857 | Mahmoud Ali Al-Banna | 6,236 |
| Maher Al-Muaiqly | 1,272 | Abdul Basit Abdus Samad | 0 |

## Tests

| Suite | Result | Notes |
|---|---|---|
| `mobile/tests/audioSingleReview.test.ts` (new) | 12/12 | The rule; a five-recording synthetic dashboard (none, one, partial, complete by bulk + corrections, rejected, Reviewer 2); every tile; reciter (0); Needs Attention; blind Reviewer 2; reload; the cloud views on PostgreSQL give the same numbers; publication still not eligible for one reviewer |
| Audio test files | 19 files, 362/362 | |
| Full app suite | 3270 passed | The 37 known `mushafScreen` failures: identical by name |
| TypeScript, ESLint | clean | |

Browser checks (headless Chrome), each on a clean isolated instance:

| Suite | Result | Notes |
|---|---|---|
| New dashboard check | 12/12 | Show filter, reciter counts, statistics updating without a reload, review page Pending/Reviewed |
| Workstation | 36/36 | |
| Fast review | 46/46 | |
| Partial | 22/22 | Updated: Pending default, auto-advance |
| Dashboard | 40/40 | Updated: 16 tiles, new progress text |
| Cloud | 24/24 | Pending equals the tile; All lists 801 |
