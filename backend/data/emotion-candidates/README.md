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
| `phase5b-batch1-human-review.json` | Human-review dispositions for the 66 Batch 1 candidates: `keep` / `reject` / `hold`. Review outcomes only — **not** production mapping statuses. Includes a `supplementalReviews` entry for `65:2` (reviewed separately, rejected, **not** one of the 66). |
| `phase5b-overlap-candidates.json` | Cross-emotion overlap proposals surfaced during Batch 1 review. Each row = "review this verse when the destination emotion is reviewed". Deduped by `verseKey + emotionKey`; `verseKey + emotionKey` pairs already present in `phase5b-batch1-candidates.json` are excluded. Not approved mappings. |
| `phase5b-batch2-candidates.json` | Batch 2 — candidate discovery for `afraid`, `anxious`, `lost`, `confused`, `closer_to_allah`. Seeded from accepted Batch 1 overlaps (excluding existing MVP mappings and any duplicate `verseKey + emotionKey`) plus newly discovered strong candidates. Not reviewed. |

`keep` / `reject` / `hold` and the overlap rows are **editorial review data**. They
never touch MongoDB, never set `development` / `reviewed` / `approved`, and never
activate an emotion. The next step is one-ayah-at-a-time human review of Batch 2
against the verified full Quran ayah.
