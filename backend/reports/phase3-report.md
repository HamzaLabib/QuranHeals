# Phase 3 — source validated; database import blocked

Date: 2026-09-09. **Phase 3 is incomplete. No database mutation occurred.** The import preflight correctly refuses six Arabic text conflicts and five Pickthall text differences. No force-overwrite option was added. All work remains local.

## 1. Source selected

- Arabic: [Tanzil Project](https://tanzil.net/download/), Uthmani 1.1 (February 2021 release), official numbered text export. Exact URL/options and file hashes: [retrieval.json](../data/quran/retrieval.json).
- Script options: pause marks, sajdah, rub-el-hizb and tatweel enabled; sequential tanweens disabled.
- Numbering: 114 surahs; the official per-surah metadata sums to 6,236 verses. Basmala is numbered 1:1, with no additional ayah-zero records or separately numbered opening basmalas elsewhere. The embedded basmala in 27:30 is retained in its verse text.
- Translation: [Tanzil en.pickthall](https://tanzil.net/trans/en.pickthall), Marmaduke Pickthall; export footer identifies last update September 4, 2010. Local version identifier: `en.pickthall-2010-09-04`.
- Arabic license: provider notice says Creative Commons Attribution 3.0, verbatim text only, attribution/link and copyright notice required. Raw notice retained.
- Translation license: [Tanzil export terms](https://tanzil.net/trans/) specify non-commercial use. Commercial/unrestricted rights for this edition are not verified. The original seed's `Public domain` metadata was not used as proof for the new export.
- [Source manifest](../data/quran/source-manifest.json) records metadata, counts, retrieval dates and checksums. Import date is null because no import occurred.

## 2. Pre-import validation

The complete downloaded source passed validation before connecting for import preflight:

| Check | Actual |
|---|---:|
| Surahs | 114 |
| Arabic verses | 6,236 |
| Pickthall translations | 6,236 |
| Duplicate references / pairs | 0 / 0 |
| Invalid references | 0 |
| Missing Arabic / translation text | 0 / 0 |
| Structural sequence gaps | 0 |
| Arabic / translation checksum failures | 0 / 0 |

All 16 existing Arabic checksums reproduce their stored text. Ten match the incoming Arabic exactly; six differ. Eleven existing translations match; five differ. **Import is not safe to proceed under the required conflict-stop rule.** Details: [preflight](phase3-preflight.json), [source validation](phase3-source-validation.json).

## 3. Database before

`NODE_ENV=development`. The existing URI omits an explicit database, resolving to `test` on the configured development Atlas connection. No production-like target name was detected, and counts and mapping identities match Phase 2. URI, host and credentials are not included in reports. Automatic index/collection creation was disabled for all database work.

| Collection | Count |
|---|---:|
| Verse | 16 |
| VerseTranslation | 16 |
| EmotionVerseMapping | 43 |
| Emotion | 12 (all active) |
| Legacy Ayah | 16 |

The original foundation records are saved in [phase3-before.json](phase3-before.json).

## 4. Database after

Unchanged: **12 represented surahs, 16 verses, 16 translations, 43 development mappings, 12 active emotions**. Legacy Ayah remains untouched. Runtime regression compared the complete foundation snapshot before and after and found no changes. No import transaction was attempted.

## 5. Quran integrity

Stored records: zero duplicate references, duplicate pairs, invalid references, missing Arabic, missing checksums or checksum reproducibility failures. Against the full source, 6,220 references are absent and six existing Arabic texts conflict. All 16 retain legacy source/version metadata.

Full downloaded Arabic corpus SHA-256:

```text
bdcfb57ebff8c2e31cace329c1c0a8392a2b06f2b0c582465ae215ef53f97652
```

Current 16-record database Arabic corpus SHA-256:

```text
4afed583cdd44ae790af0b97453f626cd23908ff0dc5a97244e3981d777746da
```

Corpus algorithm: sort numerically by surah then ayah; concatenate `JSON.stringify([referenceKey, exactText]) + LF` for every record, including final LF; SHA-256 the UTF-8 stream. Arabic excludes translations. Per-record hashes cover exact stored text. No destructive normalization is used.

## 6. Translation integrity

Source: 6,236 Pickthall translations, no missing/empty records, duplicates, orphans, invalid references or checksum failures. Source/version/license are specified in section 1 and the manifest.

Database: 16 Pickthall English translations, 6,220 missing against the full target, zero duplicates/orphans/invalid references/empty texts/checksum reproducibility failures. Five source text differences. Existing translator/source/version/license metadata remains unchanged.

Full downloaded translation corpus SHA-256:

```text
4e60f6ce1d2447c395b88feacc3784a2db829dff89777050b30f29f1ec837d01
```

## 7. Existing MVP comparison

Arabic exact matches: **2:153, 3:134, 7:199, 9:40, 13:28, 26:62, 41:34, 42:37, 93:3, 94:5**.

| Reference | Arabic difference | Classification / disposition |
|---|---|---|
| 2:286 | Existing text has an additional U+06ED | Quranic annotation/script representation difference; preserved pending explicit reconciliation |
| 39:53 | Source includes U+06DE rub-el-hizb sign and following space | Source export symbol option difference; no symbol stripped or inserted |
| 65:3 | Existing text has additional U+06E2 and U+06ED | Quranic annotation/script representation difference; preserved |
| 93:4 | Differences include Uthmani hamza/alef representation, shadda, and alef-wasla | Script representation difference; requires explicit source replacement review |
| 93:5 | Source has an additional U+0653 | Script/diacritic representation difference; preserved |
| 94:6 | Existing text has an additional U+06ED | Quranic annotation/script representation difference; preserved |

These are character-level observations, not a scholarly ruling that each difference is interchangeable. All 16 source/version labels also differ from the pinned Tanzil metadata. No Arabic text was edited.

Pickthall differences:

| Reference | Existing versus incoming | Classification |
|---|---|---|
| 2:153 | Existing includes one extra comma | Formatting |
| 2:286 | `Thou` / `thou` | Capitalization/edition |
| 9:40 | `word` / `Word` | Capitalization/edition |
| 39:53 | Incoming includes `O ` before `My slaves` | Possible real data discrepancy / edition wording; retain and review |
| 93:4 | Incoming includes one extra comma | Formatting |

Resolution: **none overwritten**. A separately reviewed reconciliation must explicitly adopt or reject these source differences before this importer can proceed. Do not merely change stored checksums. [Per-record checksum comparison](phase3-comparison.json) and [complete preflight comparison](phase3-preflight.json) are retained.

## 8. Emotion mapping

43 mappings, all `development`; zero invalid or duplicate mappings; all point to valid verses and emotions, with no text fields embedded. No emotions deactivated, and no automatic classification or mapping expansion occurred.

| Emotion | Count | Emotion | Count |
|---|---:|---|---:|
| sad | 6 | anxious | 4 |
| lonely | 2 | angry | 4 |
| lost | 4 | afraid | 3 |
| stressed | 5 | hopeless | 5 |
| tired | 4 | confused | 1 |
| grateful | 2 | peaceful | 3 |

The complete source can coexist with the 43 mappings in tests: only 16 references are mapped, leaving 6,220 source verses unmapped. This is expected.

## 9. Validation commands

- `npm run validate:quran:source`: **exit 0**, `valid: true`, 114 surahs and 6,236 Arabic/translation records.
- `npm run import:quran`: **exit 1**, `safeToImport: false`; `Existing source text/checksum conflicts; no text overwrite is permitted.` No `--write` flag was used.
- `npm run validate:quran`: **exit 1**, `valid: false`; actual database has 16/6,236 verses, 16/6,236 translations, 6,220 structural gaps, six Arabic source conflicts and five translation source conflicts. Mapping validation passes.

Exact JSON output: [database validation](phase3-database-validation.json). Commands query actual collections, not hardcoded success. No connection credentials are printed. The optional transaction write path is implemented but **not exercised**, so successful import/re-run idempotency is not claimed as tested.

## 10. API regression and indexes

Local HTTP regression used the real Express app, real Mongoose repository and audited development database. Health, 12 active emotions, all 12 random endpoints, angry, confused, mapped-only membership, existing mobile DTO fields, foundation object IDs and by-ID lookup passed. Exclude/non-repeat passed for every category with multiple verses; confused correctly reuses its sole mapped verse after exclusion. Foundation records were unchanged after regression.

This verifies the current database, not a completed full-corpus database. [Exact runtime results and actual indexes](phase3-api-regression.json).

Verified actual indexes: unique Verse referenceKey; unique surahNumber/ayahNumber; unique translation verseReferenceKey/language/translator/sourceVersion; translation language/translator; unique mapping verseReferenceKey/emotionKey; mapping emotionKey/status. Their prefixes cover verse and emotion lookups. No new indexes were needed or created. No architecture bug required a runtime fix.

## 11. Tests

| Backend check | Result |
|---|---|
| Typecheck | Passed |
| Vitest | 5 files passed; 34 tests passed; 0 failed |
| Build | Passed |
| Lint | Not configured |
| `npm audit --omit=dev` | Failed: registry audit endpoint unreachable in restricted network |
| Offline audit | Reported 0 vulnerabilities; not a current vulnerability verification |
| Source Quran validation | Passed |
| Database Quran validation | Failed intentionally: corpus incomplete and conflicting |

Test files: `api.test.ts`, `foundationIntegrity.test.ts`, `quranImporter.test.ts`, `seedIntegrity.test.ts`, `fullQuran.test.ts`. New tests cover pinned corpus, structural gaps despite unchanged counts, source changes with recomputed checksums, malformed exports, exact payload retention, translations, metadata, invalid mappings, MVP conflicts and deterministic independent hashes.

| Mobile check | Result |
|---|---|
| Typecheck | Passed |
| Lint | Passed |
| Tests | No test script configured |
| `npm audit --omit=dev` | Failed: registry audit endpoint unreachable in restricted network |
| Offline audit | Reported 0 vulnerabilities; not a current vulnerability verification |

No dependencies or lockfiles changed. Live audit access was not escalated because this phase restricted internet use to Quran sources/documentation.

## 12. Git status at time of writing

`git diff --check` passed, and the working tree held only local, uncommitted
changes: no commit, staging, push, PR, remote branch change, deployment, or
hosting/production infrastructure work had occurred.

## 13. Legacy Ayah status

Legacy `Ayah` remains at 16 records and was not touched. Tested random/by-ID requests used foundation IDs, but the repository still contains a legacy fallback and supports old legacy IDs. It is **not fully technically redundant** while those paths remain, particularly for saved older IDs. Review legacy-ID compatibility and fallback removal in a later cleanup; do not delete the collection now.

## 14. Next phase

First resolve Phase 3's explicit source conflicts, run the guarded import, verify its rerun, rerun actual full-database/API validation, and obtain current dependency audit results under an authorized network policy. Phase 3 must not be declared complete before these succeed.

Then consider **Phase 4 — Reviewed Emotion Mapping Expansion**: select candidate passages from the full corpus, document context and rationale per emotion, obtain qualified editorial/scholarly review, and retain development/draft statuses until review actually occurs. Do not force coverage, classify the corpus automatically, or treat emotional associations as authoritative interpretation. No Phase 4 work was implemented.
