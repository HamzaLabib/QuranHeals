# Phase 4.8.8 — Opening at 0:00.000, dashboard audit, remembered reviewer (2026-10-23)

Local only. Nothing committed, pushed, built, deployed or published. Production data untouched.

## 1. The opening rule (`opening-zero-v1`)

**Rule (owner, 2026-10-23):** ayah 1 of every complete surah recording plays from 0:00.000. No later start moves; no audio is changed. The original first timestamp is kept as the ayah-1 **onset** (where its words begin after isti'adha, Basmala, introduction or silence) for highlighting only.

Implementation: `tools/quran-audio/review/manual/opening.mjs`, computed from each session's own content. Stored sessions and review logs are never rewritten (they replay exactly as recorded); the rule is applied on top of them.

### Where the rule is enforced

| Point | How |
|---|---|
| Alignment / package generation | `make-packages.mjs` writes `opening: { rule, startMs: 0, onsetMs }` into every package. The aligner still measures the onset; that is by design. |
| Candidate import | `packageProblems` refuses a package whose declared opening is not 0. `riskOf` makes the opening a **check**, never high or medium on its own. |
| Dashboard loading and playback | `/api/session` serves ayah 1 proposed at 0 with `opening` and `proposal.openingOnsetMs`. The review page shows, seeks, plays and draws ayah 1 at 0:00.000 and keeps it there when placed, dragged or nudged. Manual-timing recordings are included. |
| Acceptance and submission | Two reviewers' ayah-1 starts compare at 0 (each placement kept as `placedMs`); a resolution or correction also yields 0. The auto-acceptance pass accepts the opening at 0. A human rejection still wins. |
| Export and registry | `finalTiming` and the export start at 0 (`record.opening` carries the onset). The publication document has `entries[0].startMs = 0` and `introEndMs = onset`. |
| App | `ayahStartMs()` already returns 0 for ayah 1 (start, Full Surah). `verifyVersion` now accepts a published onset inside ayah 1. |

### Traceability

Every first timestamp above 0 that the rule overrides is recorded in `data/_opening-rule/ledger.jsonl`. It is append-only and hash-chained, with one entry per recording and set of values.

- The sources covered are: the proposal, a reviewer's saved or submitted start, a resolution, and an earlier automatic acceptance.
- A later review above 0 gets a new entry, so a reappearing first timestamp above 0 is recorded too.
- The server writes this ledger on start, on refresh and after review activity, after a `pre-opening-rule-*` backup.

## 2. Audit of the live workspace

All 801 registered recordings were inspected.

**Opening rule coverage:**

| Count | What |
|---|---|
| 524 | Rule applied: 456 aligned, 44 development, 18 manual timing (Rifaat), 6 production checks that list ayah 1 |
| 277 | Out of scope: production boundary checks that do not list ayah 1 (the app already plays them from 0) |
| 17 | Already at 0: no first timestamp above 0 anywhere (mostly Rifaat recordings not yet reviewed) |
| **507** | **Changed from above 0 to 0**, with 507 ledger amendments. Sources: 503 proposals, 50 submissions by Hamza, 444 earlier automatic acceptances |
| 0 | Partial or excerpt recordings among the registered ones |
| 17 | Blocked entries, never registered and without timing; reported apart: 13 Rifaat excerpts, Talib 002 (incomplete), 13 Talib prayer files, 4 Sobhi Way2Quran files, Ahmed Salama |

**Introductory material and exceptions:**

- 453 recordings have ayah 1 starting at 1 s or later (424 with a detected introduction span). The median first timestamp is 3.7 s; the longest is 44.0 s.
- In all 453 the onset is kept for highlighting.
- Exceptions are kept visible in the risk reason, in the task and in the ledger:
  - 24 have an uncertain onset (the aligner collapsed ayah 1).
  - 18 are Rifaat recordings with Phase 4.5 evidence on ayah 1 and no known onset.
  - 6 have production listening checks on ayah 1.

**Previously submitted reviews:**

- 50 recordings had Hamza's submitted ayah-1 start above 0, and are now effective at 0. By reciter: Shatri 13, Sufi 13, Banna 7, Maher 5, Hudhaifi 4, Rifaat 3, Talib 2, Sobhi 2, Naina 1.
- 7 more had already been set to 0 by hand.
- No review was rewritten:
  - All 146 logs (1,554 events) are byte-identical to the verified snapshot taken just before the change; every chain is intact and every log replays.
  - The acceptance ledger's first 20,882 entries are unchanged; 35 entries were added.

**Opening acceptance:** 57 openings are accepted by Hamza's reviews and 467 automatically, including 35 new ones (15 Rifaat, 12 Banna, 5 Talib, 2 Sobhi, 1 Shuraim). This includes the 24 previously blocked collapsed openings.

**Risk and completion:**

- High-risk starts went from 2,364 to 2,345; the openings lost their high tier.
- Still awaiting review: 2,166 high, 2,743 medium, 102 other (Rifaat manual timing).
- Completion is recalculated and unchanged: 7 of 16 reciters are completed.

**App datasets, not rewritten (fingerprinted, production):**

| Dataset | First timestamp above 0 |
|---|---|
| MP3Quran-timed catalogue surahs | 1,042 of 1,044 (max 18.9 s) |
| Measured timing | 103 of 104 |
| Development timing | 43 of 44 |

All of them play ayah 1 from 0 through `ayahStartMs()`, and highlight from `introEndMs`. Tests cover this.

## 3. Dashboard health

| Check | Result |
|---|---|
| Server start / restart | Starts in about 2.4 s. Restarted twice on the live data; the second run wrote 0 entries (idempotent). |
| Response times (live) | `/api/dashboard` 0.20–0.35 s, `/api/attention` 0.20 s, `/api/session` and `/api/view` under 10 ms |
| Browser, scratch copy (CDP, real Chrome): 62/62 | Rendering of every tab; audio load and play; Play / Go Playhead on ayah 1 at 0; ayah 3 unchanged; overview marker at 0; zoom and pan; Accept Proposed; Enter; M; nudge; 1/2/3; C; submission; bulk preview; ↑/↓ and Previous/Next; refresh; server restart; browser restart; switching reviewer; Reviewer 2 never automatic; no console errors |
| Browser, live (read-only, fresh profile): 17/17 | hudhaifi-38, shatri-7, banna-38, islam-sobhi-100 and rifaat-1 show and seek ayah 1 at 0:00.000; Hamza is restored without storage; no review log changed |
| Integrity (live) | All chains intact; no duplicate joins; nothing unregistered; every file of the newest data backup is an exact prefix of the live file |

**Defects found and fixed:**

1. A running server did not notice a same-length edit of a ledger. It now also compares the modification time; Windows file times tick every ~16 ms.
2. Review page, manual-timing recording: Play and Go Playhead on ayah 1 did nothing, and the label said "high start at the proposed time".
3. The waveform label of a marker at 0 was half cut off.
4. The manual export package fingerprint regressed during this work and was fixed. The development evidence now carries the package's fingerprint (onset convention).

## 4. Remembered reviewer

- `dashboard.config.json` now has `"localReviewer": { "name": "Hamza", "role": 1 }`. Only role 1 is honoured.
- Each browser's own choice comes first (`localStorage` `qh-reviewer`).
- On a recording without a Reviewer 1, the page works as Hamza — Reviewer 1 at once. The `join` is written with the first real change, so browsing writes nothing.
- The indicator shows on both pages. **Switch reviewer** clears the remembered choice.
- Reviewer 2 is never assumed. The cloud dashboard is unaffected; it uses signed-in accounts.

## 5. Tests

- Full mobile suite: 187 files, 3,357 passed, 1 skipped.
  - An earlier full run had 3 timeouts of 5 s under machine load, in `audioPartialReview`, `manualTimingReview` and `startupRegression`.
  - The same 3 files pass in isolation: 61/61.
- `tsc` and `expo lint` are clean.
- New: `mobile/tests/audioOpeningZero.test.ts` (18 tests).
- Intended expectation changes for ayah 1: `audioAutoAccept`, `audioReviewDashboard`, `manualTimingReview`.

## 6. Open items

- **Repeat Ayah on ayah 1** (resolved the same day, at the owner's request): ayah 1 now repeats from 0:00.000 (`engine.ts` `repeatAyah` uses `ayahStartMs`). Other ayahs repeat from their own start, and highlighting still begins at the onset (`introEndMs`). The app only ever holds complete-surah timing: `verifyTiming` requires every ayah.
- **Rifaat openings** have no known onset, so highlighting starts at 0 until the reviewers place one.
- **6 amendment entries** (production listening checks on ayah 1) describe their exception as "a finding about its onset". The wording is now corrected for new entries; the ledger is append-only, so these entries stay as written.
- **Cloud dashboard** (resolved the same day; still not deployed): every server now serves the same `effectiveSession()` from `opening.mjs`. These are the local dashboard, the legacy manual server and the cloud server. Covered by `audioReviewCloud.test.ts` and `audioOpeningZero.test.ts`.
- **Publication:** still needs two reviewers and a rights decision. Nothing is publishable.

## 7. Backups

All under `%USERPROFILE%/Backups/quran-heals-audio-review/`:

- `pre-opening-zero-code-20261023`: code and config before the change.
- `pre-opening-rule-manual-20261023T171251Z`: data snapshot, verified.
- `pre-opening-rule-20261023T171406Z`: taken by the server before its first write.
