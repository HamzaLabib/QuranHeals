# faith_shaken activation audit

Activation completed in the existing development database `test`. There are now 30 active emotions, 169 approved faith_shaken mappings, and 2,014 approved mappings overall. All 27 Batch 6 rejected pairs are absent from mapping storage.

## Pre-flight and architecture

- Branch: `main`; HEAD: `2647855` (Update app.json). Dirty working tree expected and preserved; no staging, reset, commit, push, or PR.
- Existing MongoDB baseline: 29 emotion documents, all active; 1,845 total mappings, all approved; no faith_shaken document or mapping. This matches the existing historical preflight report. Historical version uses `approved-emotion-mappings-v1`; the new increment uses `faith-shaken-human-review-v1`.
- Safe target: connected database name `test`, environment `development`; exact database confirmation, explicit KEEP count and activation target supplied. Automatic collection/index creation disabled; unique indexes and transaction support verified. No credentials or URI emitted.
- Runtime visibility is controlled by MongoDB Emotion.active. The catalog retains the safe inactive seed default (as other post-MVP states do). The live faith_shaken document is active=true, order=30, icon=star, with the exact catalog English, Arabic, and ar-EG localized names/descriptions.
- The original planner incorrectly enumerated the current 30-key catalog but checked a historical 29-emotion result. It now derives its scope from the frozen 29-emotion/1,845-pair preview. Historical tests again describe that scope; the separate incremental tests describe the new activation.
- Live random retrieval serves development/reviewed/approved mappings and can fall back to legacy Ayah tags. The new audit rejects unexpected target mappings in every status and any legacy target tags. All target rows inserted by this task are approved.
- Existing API baseline: health returned ok; emotions returned 29 and excluded faith_shaken. Random requests for sad, anxious, grateful, closer_to_allah, seeking_guidance all returned HTTP 200.

## Review, dry-run and actual writes

- Batch 6 source files were not changed: 196 candidates and decisions, 169 KEEP, 27 REJECT, zero HOLD. 51:56 and 47:15 remain KEEP. All 196 references and verified Arabic/English lookups passed.
- Pre-write plan: 169 missing KEEP rows, zero existing KEEP rows, zero duplicates, zero unexpected mappings; 169 mapping inserts, zero mapping updates; one hidden emotion insert and one active=true update; zero historical mapping or other emotion changes.
- A verified ObjectId-preserving backup was written before mutation: `backend/backups/emotion-mappings/faith-shaken-1789589792066.json` (git-ignored). SHA-256: `e1e4d7ce871051fe5c59f143d1d6abdc09befe42fa76fe862efb3e44c60908a2`.
- The single transaction rechecked the baseline, created the required parent emotion inactive, inserted and verified all 169 KEEP mappings, then activated the emotion. Historical document fingerprints matched before and after.
- Actual MongoDB document operations: 169 mapping inserts, 0 mapping updates, 1 emotion insert, 1 emotion update; no deletions. Only Emotion and EmotionVerseMapping were written. Transaction tests prove readiness failure prevents activation and an already-complete target performs no document writes.

| Live result | Value |
| --- | --- |
| Total active emotions | 30 |
| faith_shaken emotion documents | 1 |
| faith_shaken active | true |
| faith_shaken approved mappings | 169 |
| Historical approved mappings | 1845 |
| Total approved mappings | 2014 |
| Rejected target pairs in storage | 0 (each of 27 checked) |
| Duplicate target pairs | 0 |
| Legacy target ayah tags | 0 |
| Historical REJECT protections | 191 intact |
| Historical HOLD protections | 8 intact |

- Post-activation dry-run: zero mapping inserts/updates and zero emotion inserts/updates; zero unexpected changes. No KEEP was dropped. Mapping model has one row per emotion/reference pair, so 1,845 + 169 = 2,014 exactly.

## API and mobile verification

- GET /api/health: ok. GET /api/emotions: 30 records; faith_shaken is record #30 with exact names, Star icon, order 30, active=true.
- 20 consecutive GET /api/ayahs/random?emotion=faith_shaken requests with accumulating recent exclusions all passed. Every result was KEEP; no rejected or excluded key returned; every Arabic and English text matched the verified SQLite sources. Existing five sampled emotions still return successful random results. The existing fallback/exclusion unit tests passed.
- Expo web at localhost:8081: new card appears at #30, separate from A Message from the Quran. English, Arabic and Egyptian Arabic labels verified through the actual language settings. Star SVG rendered. Clicking the card navigated to the generic ayah screen; no route or UI changes were needed. Original Egyptian Arabic preference restored.
- Browser limitation: the current web session shows "The local Quran could not be opened. Please try again." for both faith_shaken and the existing Sad emotion, including after retry/reload. Thus successful browser ayah loading, Another Ayah button, favorite, share, and translation-toggle interactions could not be completed. Native device interactions were not tested. No unrelated mobile asset/runtime workaround was applied. API Another Ayah/exclusions passed separately; generic mobile routing/history/favorite/translation/RTL tests passed. A screenshot/visual RTL check could not complete because browser capture timed out; the DOM labels and existing RTL tests passed.

## Validation and immutable data

- Backend: 42 test files, 626 tests passed (including 74 dedicated incremental activation tests); typecheck passed.
- Mobile: typecheck and lint passed. Full suite: 250 passed, 1 failed: tests/assets.test.ts:23 native bundled-bytes test exceeded its existing 5,000 ms limit (6,087 ms reported). Isolated rerun: all 4 assets tests passed. No asset code/test timeout changes.
- git diff --check passed (only pre-existing Windows line-ending notices).
- Quran integrity before and after: 114 surahs, 6,236 ayahs, 0 missing, 0 duplicate canonical references, 0 Arabic mismatches, integrityCheck=ok.
- Quran/translation files and Batch 1-6 review decisions unchanged; all unrelated baseline file hashes preserved.

- `backend/assets/quran/quran.sqlite`: `c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b` (unchanged from pre-flight).
- `backend/assets/quran/translations.sqlite`: `c6d825a2f9de0395a1391339477fce58e5850805b1df161b53dcb7816c898ce8` (unchanged from pre-flight).
- `mobile/assets/quran/quran.sqlite`: `c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b` (unchanged from pre-flight).

## Files changed by this task

- `backend/data/emotion-candidates/README.md`
- `backend/package.json`
- `backend/src/emotions/emotionCatalog.ts`
- `backend/src/scripts/activateApprovedEmotionMappings.ts`
- `backend/tests/emotion-mappings/approved-mapping-activation.test.ts`
- `backend/tests/emotions/emotion-catalog.test.ts`
- New `backend/src/scripts/activateFaithShaken.ts` and `backend/tests/emotion-mappings/faith-shaken-activation.test.ts`.
- New `docs/emotion-mappings/faith-shaken-activation.md`.
- New `backend/reports/emotion-mappings/faith-shaken-activation-dry-run.json`, `faith-shaken-activation-apply.json`, `faith-shaken-activation-post-dry-run.json`, `faith-shaken-api-verification.json`, `faith-shaken-database-audit.json`, and this summary.

## Final git status --short
```text
 M backend/data/emotion-candidates/README.md
 M backend/package-lock.json
 M backend/package.json
 M backend/src/app.ts
 M backend/src/config/env.ts
 M backend/src/emotions/emotionCatalog.ts
 M backend/src/routes/index.ts
 M backend/src/scripts/activateApprovedEmotionMappings.ts
 M backend/src/scripts/importCandidateMappings.ts
 M backend/tests/emotion-mappings/activation-dry-run.test.ts
 M backend/tests/emotion-mappings/approved-mapping-activation.test.ts
 M backend/tests/emotion-mappings/batches/batch-3-final-review.test.ts
 M backend/tests/emotion-mappings/batches/batch-4-final-review.test.ts
 M backend/tests/emotion-mappings/consolidated-mappings.test.ts
 M backend/tests/emotion-mappings/emotion-taxonomy.test.ts
 M backend/tests/emotions/emotion-catalog.test.ts
 M backend/tests/quran-data/seed-integrity.test.ts
 M mobile/app.json
 M mobile/package-lock.json
 M mobile/package.json
 M mobile/src/app/_layout.tsx
 M mobile/src/app/ayah/[emotion].tsx
 M mobile/src/app/index.tsx
 M mobile/src/app/settings.tsx
 M mobile/src/hooks/useFavorites.ts
 M mobile/src/localization/messages.ts
 M mobile/src/services/api.ts
 M mobile/src/services/quran.ts
 M mobile/src/services/quranRepository.ts
 M mobile/src/storage/recentAyahHistory.ts
 M mobile/src/utils/emotionIconNames.ts
 M mobile/src/utils/emotionIcons.ts
 M mobile/tests/emotionCatalogCoverage.test.ts
 M mobile/tests/emotionIcons.test.ts
 M mobile/tests/emotionLabel.test.ts
 M mobile/tests/emotionRouting.test.ts
 M mobile/tests/localization.test.ts
?? backend/data/emotion-candidates/batches/batch-6-faith-shaken/
?? backend/reports/emotion-mappings/batch-6-faith-shaken-candidates.json
?? backend/reports/emotion-mappings/batch-6-faith-shaken-candidates.md
?? backend/reports/emotion-mappings/faith-shaken-activation-apply.json
?? backend/reports/emotion-mappings/faith-shaken-activation-dry-run.json
?? backend/reports/emotion-mappings/faith-shaken-activation-post-dry-run.json
?? backend/reports/emotion-mappings/faith-shaken-activation-summary.md
?? backend/reports/emotion-mappings/faith-shaken-api-verification.json
?? backend/reports/emotion-mappings/faith-shaken-database-audit.json
?? backend/src/auth/
?? backend/src/controllers/authController.ts
?? backend/src/controllers/issueController.ts
?? backend/src/controllers/syncController.ts
?? backend/src/middleware/requireAuth.ts
?? backend/src/models/IssueReport.ts
?? backend/src/models/User.ts
?? backend/src/models/UserFavorite.ts
?? backend/src/models/UserPreference.ts
?? backend/src/models/UserReflection.ts
?? backend/src/models/UserSyncKey.ts
?? backend/src/routes/authRoutes.ts
?? backend/src/routes/issueRoutes.ts
?? backend/src/routes/syncRoutes.ts
?? backend/src/scripts/activateFaithShaken.ts
?? backend/src/services/IssueReportRepository.ts
?? backend/src/services/MongooseIssueReportRepository.ts
?? backend/src/services/MongooseSyncRepository.ts
?? backend/src/services/MongooseUserRepository.ts
?? backend/src/services/SyncRepository.ts
?? backend/src/services/UserRepository.ts
?? backend/src/types/accountDomain.ts
?? backend/src/types/accountDto.ts
?? backend/src/validators/authValidators.ts
?? backend/src/validators/issueValidators.ts
?? backend/src/validators/syncValidators.ts
?? backend/tests/account/
?? backend/tests/emotion-mappings/batches/batch-6-faith-shaken.test.ts
?? backend/tests/emotion-mappings/faith-shaken-activation.test.ts
?? docs/auth-and-sync/
?? docs/emotion-mappings/faith-shaken-activation.md
?? mobile/src/app/ayah/general.tsx
?? mobile/src/auth/
?? mobile/src/components/AccountSection.tsx
?? mobile/src/components/AyahExperience.tsx
?? mobile/src/components/ReflectionSheet.tsx
?? mobile/src/components/ReportIssueSheet.tsx
?? mobile/src/components/SyncPassphraseSheet.tsx
?? mobile/src/crypto/
?? mobile/src/services/apiBase.ts
?? mobile/src/services/generalQuran.ts
?? mobile/src/services/issueReportApi.ts
?? mobile/src/storage/ayahReflections.ts
?? mobile/src/sync/
?? mobile/tests/accountSection.test.ts
?? mobile/tests/authApi.test.ts
?? mobile/tests/ayahReflections.test.ts
?? mobile/tests/favoritesSync.test.ts
?? mobile/tests/generalQuranFlow.test.ts
?? mobile/tests/generalQuranHome.test.ts
?? mobile/tests/generalQuranSelection.test.ts
?? mobile/tests/issueReportApi.test.ts
?? mobile/tests/preferencesSync.test.ts
?? mobile/tests/reflectionEncryption.test.ts
?? mobile/tests/reflectionReportSeparation.test.ts
?? mobile/tests/reflectionsSync.test.ts
?? mobile/tests/syncKeyManager.test.ts
?? package-lock.json
```
