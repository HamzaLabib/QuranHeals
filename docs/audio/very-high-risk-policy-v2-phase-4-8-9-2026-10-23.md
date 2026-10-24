# Phase 4.8.9: Very High Risk, automatic-acceptance policy v2, Yes / No questions (2026-10-23)

Local only. Nothing was committed, pushed, deployed, published or built.

Before the change, a verified snapshot was taken: `%USERPROFILE%/Backups/quran-heals-audio-review/pre-very-high-20261023T191911Z` (954 files, chains intact). The code was backed up to `pre-very-high-code-20261023`. The server took its own backup, `pre-auto-accept-20261023T193033Z`, before writing.

## Policy

| Tier | Action |
|---|---|
| Very High Risk | manual review |
| High, Medium, Check, Routine | automatic acceptance (`auto-accept-v2`), after validation and the Very High detection |

**Very High evidence** (`tools/quran-audio/review/manual/very-high.mjs`). Each finding carries its reason.

| Evidence | Meaning |
|---|---|
| Sweep-displaced start (≥ 300 ms) | Late: cut-off beginning. Early: overlap. An acoustic measurement, not proof. |
| `reordered` | Wrong order in the alignment, repaired by rule |
| `past-own-end` | Overlap, repaired by rule |
| `opening-squeezed` | Ayah 1 collapsed: possibly missing |
| Whole recording | A documented repetition concern, or a Phase 4.5 verdict "with repeated passages" |
| Reviewer finding | A reviewer answered No to this surah, every ayah, or canonical order; or flagged a missing passage or a repetition back to earlier ayahs |

**Not Very High on their own:** silence, pauses, the Basmala, isti'adha, extra sounds, disagreeing alignment runs, weak text scores, MP3Quran differences, Quranic refrains, and Phase 4.5 "conflict" evidence.

Automated checks cannot prove word completeness. Low per-ayah text scores are not stored per boundary, so no "missing words" claim was made from them.

## Results on the live workspace (801 registered recordings, 28,294 starts)

| | Starts |
|---|---|
| Very High Risk, open (manual review) | **323**, in 95 recordings |
| Very High Risk, already accepted by a person | 56 |
| High accepted automatically (new) | **1,773** |
| Medium accepted automatically (new) | **2,460** |
| Check and Routine accepted automatically | **18,170** (2,948 check + 15,222 routine; mostly under v1 and the opening rule) |
| Accepted by a person (Hamza) | 5,283 |
| Exceptions (not acceptable) | **285**: all Rifaat manual-timing starts, which have no proposal |
| Disputed | 0 |
| **Manual reviews remaining** | **608** (323 Very High + 285 exceptions) |

Other figures:

- **Blocked recordings:** 17, never registered and never approved. These are 13 Rifaat excerpts with missing passages, Talib 002 (incomplete), 13 Talib prayer files, 4 Sobhi Way2Quran files, and Ahmed Salama.
- **Earlier acceptances that no longer apply:** 10 v1 entries in Ajmi 74, because of its repetition concern. The entries are kept in the ledger.

**Very High open starts by kind:**

| Kind | Starts |
|---|---|
| Whole-recording repetition (7 Rifaat + Ajmi 74) | 196 |
| Sweep cut-off start | 69 |
| Sweep overlap | 65 |
| Aligner wrong order | 22 |
| Ayah 1 collapsed | 16 |
| Aligner overlap | 8 |
| Reviewer finding (rifaat-72 ayahs 11–13) | 3 |

**Reviewer findings (Hamza, Reviewer 1):** all 4 answered **No** to "canonical order".

- The recordings are rifaat-98, rifaat-73, rifaat-72 and saleh-talib-87-archive.
- The same reviews also answered No to "extra audio documented" and to "playback".
- This contradicts the Phase 4.5 evidence for rifaat-98 ("all 8 ayahs confirmed in order"). Confirm whether these answers are intended.
- They are shown at the top of the dashboard. The starts Hamza already accepted stay accepted.

**Reciters:**

| Status | Reciters |
|---|---|
| Completed | Abdul Basit, Sufi, Shatri, Naeena, Hudhaifi, Maher, Minshawi |
| Manual review required (Very High open) | Basfar 52, Ajmi 64, Islam Sobhi 3, Banna 8, Husary 12, Rifaat 144 (+285 exceptions), Talib 11, Shuraim 22, Yasser Salama 7 |

## Muhammad Rifaat

| Recording | Finding | Very High open | Other |
|---|---|---|---|
| 1, 83, 87, 88, 89, 96, 100 | Phase 4.5: in order **with repeated passages** (live recitation returns to earlier ayahs; 100 may also lack 10–11 at the end) | 6, 35, 18, 25, 29, 18, 10 = **141** | opening (ayah 1) stays a check at 0:00.000 |
| 72 | Hamza answered No to canonical order; ayahs 11–13 submitted *uncertain*; queue note "replay of 19–22 near 20:00 (repetition?)" | 3 | 25 reviewed by Hamza |
| 98, 73 | Hamza answered No to canonical order (complete reviews) | 0 | every start reviewed by Hamza |
| 55, 75, 76, 78, 79 | single pass. The conflicts are refrains or near-twins (55: 61, 75: 19), not recitation errors. 79: "check that 26–36 and 43–46 are present" is inconclusive. | 0 | 230 manual-timing exceptions |
| 82, 85, 86 | Weak evidence: identity and completeness unconfirmed. Inconclusive, so not called Very High. | 0 | 55 manual-timing exceptions |
| 10, 11, 12, 17, 18, 19, 20, 48, 54, 56, 69, 77, 81 | Excerpts with missing passages (Phase 4.5) | – | blocked, never registered |

## Yes / No questions

The review page asks five per-start questions: complete, order, no overlap, timestamp, aligned.

- **Defaults:** every answer defaults to Yes. Answers are stored on the reviewer's marker as `{ v, confirmed }`, so a default Yes is never mistaken for a clicked one.
- **No:** a No rejects the start, and a confirmed start cannot carry a No.
- **Submitting:** answering never submits. Submitted answers are frozen; a change is a correction, with its reason.
- **Whole-recording questions:** these are Yes / No only. Defaults are recorded in `checksDefaulted` when the review is finished.

## Verification

- **Integrity:** all 167 review logs are byte-identical to the pre-change snapshot, and every chain is intact. The acceptance ledger's first 20,917 entries are unchanged and 4,233 entries were appended. The opening-rule ledger is unchanged. Restarts are idempotent (0 new entries).
- **Tests:** mobile suite 188 files, 3,368 passed (new: `audioVeryHigh.test.ts`; `audioAutoAccept.test.ts` updated to v2). `tsc` and `expo lint` are clean.
- **Browser, on a scratch copy:** 27/27 for the new UI: Very High section, counters and filters, default queue, auto-accepted items inspectable and rejectable, Yes / No questions, refresh, server restart. The earlier opening / reviewer suite passes 62/62.
- **Browser, live:** 17/17, read-only.
- **Unchanged:** the opening rule, Repeat Ayah 1 from 0:00.000, and Hamza as the default Reviewer 1.

## Open items

- Confirm or correct Hamza's "No" answers on the 4 recordings above.
- The sweep findings (134) are acoustic measurements. Listening decides.
- Rifaat manual timing (285 starts) cannot be accepted automatically: there is no proposal to accept.
- The cloud dashboard (not deployed) shares the views and the detection. It has no automatic acceptance of its own.
