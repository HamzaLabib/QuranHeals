# Phase 5C — Approved Mappings Report (Final Consolidation)

Generated: 2026-09-13

This report documents the Phase 5C consolidation preview only. **Nothing described here has been activated, promoted, or written to a database.** Regenerated after the `backend/data/emotion-candidates` structural migration to `batches/` + `consolidated/` + `reports/emotion-mappings/`; the semantic result is unchanged from the original Phase 5C run.

## Checkpoint

- Batch 4: unrecoverableOverlapSources.pairs=0, supersededPairs=5, overlap file rows=418, editorial corrections=3
- Batch 5: candidates=334, decisionCounts={"keep":285,"reject":49,"hold":0}, supplemental=28, overlap rows=185
- **Global HOLD count from disk: 8** (7 self-reflection + 1 pre-existing Batch 1 hold at `1:7|seeking_guidance`)

## Cross-batch duplicate recomputation

- Expected: 25
- **Observed: 25**
- Involving Batch 5: 0

## Source accounting

| Category | Count |
| --- | --- |
| mvpPairs | 43 |
| directCoreKeepPairs | 612 |
| directSupplementalKeepPairs | 359 |
| directRejectPairs | 191 |
| directHoldPairs | 8 |
| rawApprovedOverlapProposals | 1396 |
| duplicateOverlapProposalRows | 25 |
| overlapProposalsAlreadyRepresentedByDirectKeep | 460 |
| overlapProposalsAlreadyRepresentedByMvp | 9 |
| overlapProposalsBlockedByReject | 51 |
| overlapProposalsBlockedByHold | 0 |
| overlapProposalsBlockedByEditorialCorrection | 25 |
| invalidOrUntraceableProposals | 0 |
| newOverlapRowsCreated | 831 |
| finalUniqueApprovedPairs | 1845 |

## Accounting equation

```
MVP(43) + directKeep(612) + supplementalKeep(359) + newOverlap(831)
= union(1845) = finalRows(1845) -> HOLDS
```

## REJECT protection

- Total unique REJECT pairs (Batch 1-5): 191
- Overlap proposals blocked by REJECT: 51
- Rejected pairs found in final preview: 0 (must be 0)

## HOLD protection

- Total HOLD pairs (Batch 1-5): 8
- Overlap proposals blocked by HOLD: 0
- Held pairs found in final preview: 0 (must be 0)
- All 7 protected self-reflection HOLDs present: true

## Final mapping counts

- Total final unique pairs: 1845
- Unique verses represented: 205
- Multi-provenance pairs: 464

| Emotion | Count |
| --- | --- |
| sad | 42 |
| anxious | 48 |
| lonely | 28 |
| angry | 46 |
| lost | 58 |
| afraid | 65 |
| stressed | 41 |
| hopeless | 55 |
| tired | 33 |
| confused | 55 |
| grateful | 40 |
| peaceful | 71 |
| want_to_cry | 44 |
| heartbroken | 72 |
| overwhelmed | 78 |
| rejected | 26 |
| betrayed | 49 |
| wronged | 52 |
| forgiveness_struggle | 28 |
| guilty | 52 |
| repentant | 58 |
| weak | 67 |
| reassurance | 159 |
| patience | 59 |
| strength | 105 |
| hopeful | 109 |
| content | 69 |
| seeking_guidance | 106 |
| closer_to_allah | 130 |

| Provenance type | Count |
| --- | --- |
| mvp | 43 |
| direct_keep | 612 |
| supplemental_keep | 359 |
| overlap | 1295 |

## Special protections

- `12:100 -> guilty` absent: true
- Punishment/warning exclusions preserved: true
- Five retained verses preserved: true
