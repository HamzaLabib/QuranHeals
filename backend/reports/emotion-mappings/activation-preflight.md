# Approved Emotion Mapping Activation — Preflight

- Generated: 2026-09-15T20:36:48.896Z
- Mode: READ-ONLY PREFLIGHT — no database writes
- Database: test
- Approved mapping version: `approved-emotion-mappings-v1`

## Input counts

| Category | Count |
| --- | --- |
| APPROVED | 1845 |
| REJECT | 191 |
| HOLD | 8 |

## Live database (unchanged by this preflight)

- Emotion before: 12, after: 12
- EmotionVerseMapping before: 43, after: 43

## Emotion definitions

- Existing (approved-key) definitions: 12
- Missing (to be created): 17
- Existing inactive (to be activated): 0
- Existing active: 12
- Unexpected (non-canonical) live definitions: 0
- Conflicting definitions (icon/order): 0

## Emotion localization (names/descriptions vs. the canonical catalog)

- Live emotions with localization already matching the catalog (no-op): 0
- Live emotions missing localization (to be updated): 12
- Live emotions with conflicting localization (BLOCKS): 0
- Future creates (all include full en/ar/ar-EG names + descriptions from the catalog): 17

## Mapping overlap

- Approved candidate pairs: 1845
- Already existing live: 43
  - already approved (no-op): 0
  - development (to promote): 43
  - draft (to promote): 0
  - reviewed (to promote): 0
  - rejected (BLOCKS): 0
  - unexpected status (BLOCKS): 0
- Missing live (to insert): 1802
- Live pairs outside approved set (legacy, untouched): 0
- Live REJECT intersection: 0
- Live HOLD intersection: 0
- Duplicate logical pairs: 0

## Write plan

- Emotions to create: 17
- Emotions to activate: 0
- Emotions to localize: 12
- Emotions with localization already correct (no-op): 0
- Mappings to insert: 1802
- Mappings to promote: 43
- Mappings already approved: 0
- Reconciliation: 1802 insert + 43 promote + 0 already-approved = 1845 (expected 1845) — MATCHES
- Predicted final active emotions: 29

## Index / transaction safety

- Emotion.key unique index present: true
- EmotionVerseMapping.(verseReferenceKey, emotionKey) unique index present: true
- Transaction support verified: true

## Backup plan

- Before any future apply, a verified point-in-time backup of every live Emotion and EmotionVerseMapping document is written under `C:\Users\hamzalabib\OneDrive - McGill University\Documents\Personal\My App\QuranHeals\backend\backups\emotion-mappings` (git-ignored) — see writeActivationBackup / rollbackEmotionMappingActivation.ts.

**Overall decision: PASS**
