# Ayah connections: finalization for publishing approval (2026-10-19)

Status: **draft set complete, not applied anywhere.** No MongoDB connection, mapping status change, deploy, or `--apply` was made.

Sources of decisions:

- `QuranHeals_All_Connections_Review_Decisions.json` (export `2026-10-20T00:07:33Z`, 2,013 pairs, 170 decisions: 157 Keep, 13 Remove).
- Update, 2026-10-19: the owner approved REMOVE for all 9 previously flagged weak pairs, making **22 removals in total**. All 22 are now recorded as exact-pair REJECTs in `updates/editorial-corrections.json`. The consolidated approved set is regenerated: **2,013 → 1,991**, and every other row is unchanged.

## What `backend/data/ayah-connections/reviewed-connections.json` now contains

| Group | Pairs | Treatment |
| --- | ---: | --- |
| Sad (finalized earlier) | 42 | Byte-identical to `HEAD` |
| Explicit Keep | 157 | Your exported Arabic and English, verbatim |
| Anxious texts from the earlier chat (`chat-approved` in the export) | 11 | Rewritten as drafts. The export labels them drafts; the 48 Anxious **mapping** approvals are unchanged |
| Other drafts | 1,781 | Newly written, emotion-specific EN + AR |
| **Total published entries** | **1,991** | Every one has `en` and `ar`. No `...` placeholders |
| Remove | 22 | **Not in the file**, refused by the validator (`EXCLUDED_CONNECTION_PAIRS`), and REJECTed in the consolidated set |

All remaining pairs, emotion keys and their order are preserved. The only text changes after the drafting are the 21 Keep corrections below. The set equals the consolidated approved set exactly (1,991). New English texts run 25–54 words (average 38). The longest new text is 291 characters, and the longest in the file is one of your Keeps at 623, well under the 2,000 limit. No generic sentence is reused across different ayahs. The same ayah is sometimes paraphrased the same way under different emotions.

## Weak connections: decided — all 9 REMOVED (2026-10-19)

The owner approved REMOVE for all nine. Their draft text was deleted from the file, and each one now has a REJECT entry dated `2026-10-19` with the reason below.

| Pair | Reason recorded |
| --- | --- |
| content \| 39:70, 40:16, 40:17, 40:20 | Judgment-scene ayahs for *content*. Same pattern as your removed `content\|39:69` and `content\|40:19`. |
| reassurance \| 7:169 | The ayah rebukes people who sin while assuming forgiveness. Only its closing clause ("the Hereafter is better for the mindful") supports reassurance. |
| guilty \| 58:10, repentant \| 58:10 | The ayah is about secret conspiratorial talk (najwa) meant to grieve believers. Applying it to guilt-whispers is an extension of its context. |
| confused \| 61:2, 61:3 | A rebuke for saying what one does not do. The link to confusion (inner division) is indirect. |

Judged workable and **not** flagged: lonely 40:19/40:20, confused 40:19/40:20 and afraid 40:19/40:20. These are the knowledge-of-hearts and judging-with-truth ayahs, which fit those feelings directly.

## Keep text corrections: all 21 completed (2026-10-19)

The owner approved all 21 accuracy corrections. **`reviewed-connections.json` is the source of truth for the final wording**:

- 15 entries were applied exactly as proposed in the finalization review (cases 2–6, 9–13, 15–17, 20–21).
- 6 entries use the owner's refined Arabic (cases 1, 7, 8, 14, 18, 19), each with a matching English text.

No other connection text changed.

| # | Pair | Problem fixed | Final wording |
| ---: | --- | --- | --- |
| 1 | heartbroken \| 40:16 | Text described 39:69 ("the earth will shine…") | Owner-refined |
| 2 | angry \| 39:62 | "Day of Reckoning" claim not in the ayah | As proposed |
| 3 | betrayed \| 39:62 | Reckoning / justice claim | As proposed |
| 4 | forgiveness_struggle \| 39:62 | "Allah is the final Judge" claim | As proposed |
| 5 | wronged \| 39:62 | "Justice in the Hereafter" claim | As proposed |
| 6 | angry \| 39:63 | Reckoning claim | As proposed |
| 7 | betrayed \| 39:63 | Reckoning / justice claim | Owner-refined |
| 8 | forgiveness_struggle \| 39:63 | Reckoning claim | Owner-refined |
| 9 | wronged \| 39:63 | "Justice in the Hereafter" claim | As proposed |
| 10 | angry \| 7:43 | Reckoning claim on a Paradise ayah | As proposed |
| 11 | forgiveness_struggle \| 7:43 | "Final Judge" claim on a Paradise ayah | As proposed |
| 12 | hopeful \| 40:16 | Arabic addressed a hopeless reader | As proposed (Arabic only; English unchanged) |
| 13 | heartbroken \| 7:43 | Justice claim not in the ayah | As proposed |
| 14 | want_to_cry \| 7:43 | Justice claim not in the ayah | Owner-refined |
| 15 | overwhelmed \| 7:42 | "All authority belongs to Allah" not in the ayah | As proposed |
| 16 | weak \| 7:42 | Sovereignty claim not in the ayah | As proposed |
| 17 | weak \| 35:35 | Sovereignty claim not in the ayah | As proposed |
| 18 | weak \| 39:73 | Sovereignty claim not in the ayah; the greeting was attributed to Allah (in the ayah it is the keepers of Paradise) | Owner-refined (final text 2026-10-19) |
| 19 | weak \| 39:74 | Sovereignty claim not in the ayah | Owner-refined |
| 20 | lonely \| 2:255 | Hereafter claim not in Ayat al-Kursi | As proposed |
| 21 | patience \| 40:16 | "Reward" claim not in the ayah | As proposed |

A whole-file scan finds none of the targeted claims left on these ayahs: Reckoning or Hereafter-justice phrasing on 39:62, 39:63, 7:42, 7:43, 35:35 and 2:255, sovereignty phrasing on 7:42, 35:35, 39:73 and 39:74, or 39:69's "shining earth" outside 39:69.

Some Keeps still share identical text across two ayahs (`grateful` 55:54/55:76, `guilty` 69:21/69:22). These describe Paradise generally and fit both ayahs.

## Removing the 22 pairs from the live mapping set (database step, not done)

Local sources are done:

- The 22 REJECT entries are recorded (13 dated `2026-10-20`, from the export; 9 dated `2026-10-19`).
- `approved-mappings-current.json` is regenerated at 1,991 pairs.
- `duplicate-mappings-current.json` gained 22 `blocked_by_editorial_reject` rows.

The live databases still hold these 22 mappings as `approved`. **Each one stays visible in the app (without a connection section) until it is deactivated.**

`mapping:deactivate` connects to the database even in dry-run mode. Run it only in an authorized session, per environment, dry-run first. Offline, all 22 pairs pass its authority gate (REJECT present and absent from the approved set), and a kept pair (`hopeless|40:16`) is refused. Expected dry-run result per pair:

- `before: "approved"`, `after: "rejected"`, `wouldChange: true` if the live mapping is approved;
- `wouldChange: false` if it is already rejected or missing.

Only that mapping's `status` changes. The mapping record, the verse, and the verse's other emotions are untouched.

Dry-run commands (from `backend`, with the target environment configured):

```powershell
npm run mapping:deactivate -- --verse 39:69 --emotion afraid
npm run mapping:deactivate -- --verse 39:70 --emotion afraid
npm run mapping:deactivate -- --verse 39:67 --emotion angry
npm run mapping:deactivate -- --verse 40:16 --emotion angry
npm run mapping:deactivate -- --verse 69:21 --emotion betrayed
npm run mapping:deactivate -- --verse 69:22 --emotion betrayed
npm run mapping:deactivate -- --verse 40:16 --emotion confused
npm run mapping:deactivate -- --verse 61:2 --emotion confused
npm run mapping:deactivate -- --verse 61:3 --emotion confused
npm run mapping:deactivate -- --verse 69:21 --emotion confused
npm run mapping:deactivate -- --verse 39:69 --emotion content
npm run mapping:deactivate -- --verse 39:70 --emotion content
npm run mapping:deactivate -- --verse 40:16 --emotion content
npm run mapping:deactivate -- --verse 40:17 --emotion content
npm run mapping:deactivate -- --verse 40:19 --emotion content
npm run mapping:deactivate -- --verse 40:20 --emotion content
npm run mapping:deactivate -- --verse 39:67 --emotion forgiveness_struggle
npm run mapping:deactivate -- --verse 58:10 --emotion guilty
npm run mapping:deactivate -- --verse 40:16 --emotion lonely
npm run mapping:deactivate -- --verse 40:17 --emotion lonely
npm run mapping:deactivate -- --verse 7:169 --emotion reassurance
npm run mapping:deactivate -- --verse 58:10 --emotion repentant
```

Write form, one pair at a time, each with a new backup path:

```powershell
npm run mapping:deactivate -- --verse 39:69 --emotion afraid --apply --confirm deactivate:39:69:afraid --backup backups/mapping-deactivations/dev-39-69-afraid-before.json
```

PROD also needs `QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod`. After all 22, each environment should serve 1,991 approved mappings. Per-emotion counts after removal: afraid 63, angry 44, betrayed 47, confused 51, content 63, forgiveness_struggle 27, guilty 51, lonely 26, reassurance 158, repentant 57; the other 20 emotions are unchanged.

## Applying the approved text (DEV, then PROD)

1. ~~Decide the 21 Keep proposals~~: done (all 21 applied). `npm test` must stay green.
2. Commit the file and code (not done here).
3. DEV dry-run, from `backend` with the DEV environment: `npm run connections:apply`. Expect "1991 reviewed entries". The update count depends on what DEV already holds (1,991 if empty; 1,949 if the 42 Sad are already applied). Any non-approved or missing pair refuses the whole run. The 22 removed pairs are not in the file, so their status does not affect this step.
4. DEV write: `npm run connections:apply -- --apply`. It writes a verified backup to `backend/backups/ayah-connections/`, then one transaction. Spot-check a few emotions in the app in EN and AR.
5. PROD dry-run with the PROD environment: `npm run connections:apply`.
6. PROD write: set `QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod`, then `npm run connections:apply -- --apply`. Keep the backup path it prints.
7. Run the 22 deactivations (above) in each environment, before or after; the two steps are independent.

No mobile release is needed. Connection text is served by the API.
