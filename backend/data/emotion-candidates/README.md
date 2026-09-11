# Emotion → ayah candidate batches (for human/scholarly review)

Input files for `npm run mapping:candidates` that are **intended for real
editorial review**, not automated tests. They live here (under `backend/data/`,
next to the Quran source data) rather than under
`backend/src/scripts/fixtures/`, which is reserved for small synthetic test
inputs.

## What these files are — and are not

- Each row is a **candidate**: a proposed emotion↔ayah pairing plus a rationale
  and context notes, for a human (and, where needed, a scholar) to accept,
  reject, or refine.
- Nothing here is reviewed or approved. No status field is set. The
  candidate tool inserts (only with an explicit `--apply`, which this workflow
  does not run) as the lowest-trust `draft` status and never promotes.
- Verses are referenced by `verseKey` only. Quran Arabic and translations are
  **never** copied into these files; the app resolves text from the immutable
  verified corpus by `verseKey`.

## Workflow

```
draft a batch here  ->  npm run mapping:candidates -- --input=<file>   (dry run: validate + report)
                    ->  human review of the generated report
                    ->  (later, separate step) promote accepted rows through the lifecycle
```

See `docs/phase-5a-emotion-taxonomy.md` §7–§10 for the full mapping lifecycle
and review-queue design, and §8 for the AI-assisted-mapping safety rule.

## Files

| File | Scope |
| --- | --- |
| `phase5b-batch1-candidates.json` | Batch 1 — candidate discovery for `overwhelmed`, `heartbroken`, `reassurance`, `patience`, `seeking_guidance`. 66 rows. |
| `phase5b-batch1-human-review.json` | Human-review dispositions for the 66 Batch 1 candidates: `keep` / `reject` / `hold`. Review outcomes only — **not** production mapping statuses. `supplementalReviews` holds `65:2` (reviewed separately, rejected, **not** one of the 66). |
| `phase5b-batch2-candidates.json` | Batch 2 — candidate discovery for `afraid`, `anxious`, `lost`, `confused`, `closer_to_allah`. Seeded from accepted Batch 1 overlaps (excluding existing MVP mappings and duplicate `verseKey + emotionKey`) plus new discoveries. 74 rows. |
| `phase5b-batch2-human-review.json` | Human-review dispositions for the 74 Batch 2 candidates: all `keep`. `supplementalReviews` holds `1:5 → lost` (`keep`, proposed manually during review, **not** one of the 74). |
| `phase5b-overlap-candidates.json` | Cross-emotion overlap proposals surfaced during the **Batch 1** human review. Each row = "review this verse for the destination emotion when that emotion is assessed". Deduped by `verseKey + emotionKey`; pairs already present as a Batch 1 candidate are excluded. **Not** approved mappings. |
| `phase5b-batch2-overlap-candidates.json` | Cross-emotion overlap proposals explicitly approved during the **Batch 2** human review ("keep with all overlaps"), plus the supplemental `1:5 → lost` overlaps. Deduped by `verseKey + emotionKey`; pairs already tracked as a Batch 1 / Batch 2 candidate, as an existing MVP mapping, or already present in `phase5b-overlap-candidates.json` (Batch 1) are excluded so provenance is not duplicated. **Not** approved mappings. |
| `phase5b-batch3-candidates.json` | Batch 3 — candidate discovery for `angry`, `betrayed`, `wronged`, `guilty`, `repentant`. Seeded from accepted Batch 1 + Batch 2 overlap proposals (excluding existing MVP `angry` mappings and duplicates) plus new discoveries. 76 rows. |
| `phase5b-batch3-human-review.json` | Human-review dispositions for the 76 Batch 3 candidates: **74 keep, 2 reject, 0 hold**. The only two rejections are `64:14 → angry` and `2:222 → repentant`; every other original candidate is `keep`. `supplementalReviews` holds 449 additional directly human-reviewed pairs (443 keep, 6 reject) that are **not** part of the 76 and **not** counted in `originalCandidateCount` or `decisionCounts` — including the Ghafir `40:16`–`40:20` block (5 verses × 21 emotions each), a further set of guilt/repentance verses (`9:118`, `2:206`, `9:102`–`9:103`, `7:169`, `39:55`–`39:74` excluding `39:64`/`39:67`, `69:18`–`69:25`, `15:49`–`15:50`, `5:98`), `39:67` reviewed as `keep` against **every current canonical emotion key** (29, resolved from the seed at review time), and `39:64` recorded as a supplemental `reject` for the six emotions it was considered under. `39:75` was discussed but not accepted, so it is absent from every artifact. |
| `phase5b-batch3-overlap-candidates.json` | Cross-emotion overlap proposals explicitly accepted during the **Batch 3** human review. Deduped by `verseKey + emotionKey`; pairs already tracked as a Batch 1 / Batch 2 / Batch 3 candidate, as an existing MVP mapping, in `phase5b-overlap-candidates.json` / `phase5b-batch2-overlap-candidates.json`, or as a Batch 3 supplemental human-review pair are excluded so provenance is not duplicated. **Not** approved mappings. |
| `phase5b-batch4-candidates.json` | Batch 4 — candidate discovery for `sad`, `lonely`, `stressed`, `hopeless`, `tired`, `want_to_cry`, `rejected`. 130 rows. Combines eligible cross-emotion overlap proposals carried from the Batch 1 / Batch 2 / Batch 3 overlap files (109 rows) with 21 fresh discoveries, provenance preserved in `contextNotes`. |
| `phase5b-batch4-human-review.json` | Human-review dispositions for the 130 Batch 4 candidates: **127 keep, 3 reject, 0 hold**. The three rejections are `3:173 → sad`, `3:103 → lonely`, and `7:200 → rejected` — each is preserved instead as a `phase5b-batch4-overlap-candidates.json` proposal for the emotions it actually fits. `supplementalReviews` holds 11 additional directly human-reviewed `keep` pairs, **not** part of the 130 and **not** counted in `originalCandidateCount`/`decisionCounts`: `12:83 → sad`; `1:5 → tired`; `28:13 → want_to_cry` and `20:40 → want_to_cry` (companion verses); and, added specifically to keep `rejected` editorially balanced with self-reflection alongside comfort, `3:159`, `13:11`, `2:44`, `61:2`, `61:3`, `16:125`, and `20:44 → rejected` (`13:11`'s note explicitly cautions this is self-reflection, never "if someone rejects you, it's your fault"). `2:286 → stressed` is confirmed as an existing MVP (`development`) mapping and is intentionally not duplicated. The artifact also carries an `unrecoverableOverlapSources` block listing 125 core `keep` pairs whose accepted-overlap destination list was referenced but not specified in the review source — left unpersisted rather than guessed, per the no-invention rule. |
| `phase5b-batch4-overlap-candidates.json` | Cross-emotion overlap proposals explicitly accepted during the **Batch 4** human review — 147 rows, covering only the pairs whose destination-emotion list was explicitly recorded (the 3 rejected core verses above, plus `2:186`, `50:16`, and the 9 supplemental verses). `2:186 → lonely` was approved for overlap against **every other canonical emotion** (26 rows persisted; `reassurance` and `closer_to_allah` are omitted only because those exact pairs already carry an earlier direct decision, not because they were dropped). Deduped by `verseKey + emotionKey`; pairs already tracked as a direct human decision anywhere in Batch 1–4 or as an existing MVP mapping are excluded so an already-decided pair is never re-proposed. **Not** approved mappings. |

`keep` / `reject` / `hold` and the overlap rows are **editorial review data**. They
never touch MongoDB, never set `development` / `reviewed` / `approved`, and never
activate an emotion. Batch 1 through Batch 4 human review are all now complete;
nothing has been promoted to a production mapping status.
