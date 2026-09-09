# King Fahd / Tanzil offline architecture report

Date: 2026-09-09. **FAIL — MANUAL REVIEW REQUIRED.** The primary official source could not be retrieved. This status denotes blocked verification, not a discovered textual error. No substitute source was used.

## 1. Repository audit

Two independent TypeScript apps: Expo 57 / React Native / Expo Router mobile and Express / Mongoose backend. Mobile screens are home, emotion ayah, and favorites. The backend maintains Emotion, Verse, VerseTranslation, EmotionVerseMapping and legacy Ayah models. Runtime APIs provide health, emotions, random ayah with exclusions, and by-ID lookup. Foundation lookups are preferred, with legacy fallback.

Actual seed is **16 unique verses, 12 emotions, 43 development mappings**, not 12 verses. Canonical Arabic and translations are separated in foundation storage; mappings already reference `verseReferenceKey`. The legacy seed and Ayah still duplicate text. Favorites store entire ayah DTOs in AsyncStorage, duplicating saved Arabic; recent history stores IDs. No SQLite package or bundled Quran font is configured. Mobile fetches full Arabic-bearing DTOs from the backend. Existing earlier full Tanzil data is outside mobile and is not a production asset.

No users, analytics or administration implementation was removed. No runtime backend/mobile behavior was changed. The obsolete Tanzil canonical import command was disabled to respect the new source decision.

## 2–5. User-supplied Tanzil file

Detected `./quran-uthmani.txt`. Hashed before parsing/moving. Validated its version notice, numbered text structure and all expected keys using the previously retrieved official surah metadata. Moved the original with a filesystem move, without re-encoding/resaving it, to `tools/quran-verification/input/quran-uthmani.txt`.

Before SHA-256:

```text
6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f
```

After SHA-256: **identical**. Size: **1,396,087 bytes**.

Validation: **114 surahs; 6,236 numbered ayahs; 0 duplicate keys; 0 malformed rows; 0 invalid keys; 0 missing expected keys; 0 empty verse texts**. Original copyright block retained. The file includes opening basmala prefixes in first-ayah payloads for many surahs; none were stripped.

[Tanzil's official text terms](https://tanzil.net/docs/text_license) allow verbatim redistribution with attribution/link and retention of the notice. The unchanged input is eligible for repository retention under these terms. `.gitattributes` protects raw line endings. No new Tanzil download was performed. Tanzil is verification-only, never the new production corpus.

## 6–7. Official King Fahd source and hash

Identified the official [developer portal](https://qurancomplex.gov.sa/en/techquran/dev/), resource **Unicode Uthmanic Font (Hafs Narration)**. Its indexed official description advertises machine-readable developer formats, including JSON/CSV/XML/SQL. No exact dataset download was successfully retrieved or pinned.

The developer pages, font site and official download host failed to connect, including direct network retries with timeout bounds. No login, acceptance screen or legal permission for a specific archive could be inspected. No restrictions were bypassed.

**Source actually used as canonical: none. Raw source SHA-256: unavailable.** Primary version and retrieval date remain unknown. `tools/quran-import/raw/README.md` gives the exact manual next step.

## 8–11. SQLite and canonical validation

Target path: `mobile/assets/quran/quran.sqlite`. **Not generated. Size: unavailable.** Generating it from Tanzil would violate the selected architecture.

Proposed schema is in `tools/quran-import/schema.sql`: integer primary key, surah, ayah, unique verse_key, exact text_uthmani, with range/non-empty/key-consistency checks. Only the unique verse-key index is planned. No second canonical JSON asset is proposed.

King Fahd surah/ayah validation: **not run**. Canonical ordered hash and SQLite hash: **null**, not fabricated. The code includes a hash assertion utility, but no King Fahd expected hash can be pinned until the source is obtained and reviewed.

## 12–14. Independent verification

Result: **FAIL — MANUAL REVIEW REQUIRED**. Complete comparison not performed.

| Metric | Result |
|---|---|
| Tanzil verses / surahs | 6,236 / 114 |
| King Fahd verses / surahs | Unknown |
| Matched keys | Unknown |
| Exact / non-exact matches | Unknown / unknown |
| King Fahd missing / duplicate keys | Unknown / unknown |
| Categorized / potentially substantive differences | Not assessed |

No assertion of equality or substantive disagreement is made. The reusable comparison records both untouched originals for every non-exact verse and fails on unclassified/potentially substantive differences. There is no destructive normalization. See `report.json` and `../quran-manifest.json` for machine-readable state.

## 15–16. QPC Hafs font

Candidate: **UthmanicHafs1Ver18.ttf**, a single Unicode QPC Hafs font documented by [Quran Foundation](https://api-docs.quran.com/docs/tutorials/fonts/font-rendering/). Its official example URL is `https://verses.quran.foundation/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.ttf`.

**Not downloaded or bundled.** The guide recommends using CDN assets rather than storing them locally; that recommendation is not itself a legal prohibition or redistribution grant. Explicit font licensing, local redistribution, Expo/mobile and any attribution/commercial-use conditions could not be verified from the unavailable King Fahd font site or the rendering guide. The documented CDN alternative requires runtime connectivity and therefore does not satisfy this app's offline requirement. Obtain official offline permission/license evidence before integration. No page-specific fonts or Mushaf images were added.

## 17. Existing seeded ayahs migration

There are 16 seeded references. The 43 foundation mappings already reference keys; these remain unchanged. Mobile favorites, legacy IDs, API DTO composition and reference-only offline resolution need a coordinated migration once SQLite is verified. Prematurely deleting saved Arabic or switching to a nonexistent database would break existing functionality, so neither occurred.

## 18–19. Runtime and performance

Intended: emotion mapping → verse_key → parameterized SQLite point lookup → exact King Fahd text → licensed single Unicode font. Query: `SELECT text_uthmani FROM verses WHERE verse_key = ? LIMIT 1`. Use the unique key index and read only requested rows. No full corpus JS cache/startup load should be introduced. Favorites should store references and saved timestamps; translations should remain separate, with an explicit offline plan before backend dependency removal.

Actual runtime remains the working backend/AsyncStorage flow. Full offline Quran access has **not** been enabled. No complete Quran data enters mobile JS memory through the new development tools, because they are not imported by mobile. Current favorites may load all saved DTOs.

SQLite size, font size, cold lookup latency, repeated lookup latency, and final production size are **not measured**. Added mobile production assets/dependencies: **0 bytes / none**. Future Expo database initialization may copy a bundled SQLite asset into writable storage; one logical canonical dataset does not automatically mean one physical installed file. Evaluate read-only asset access or account for that copy before claiming the single-copy storage goal. No unmeasured speed/RAM claims are made.

## 20. Files added/changed

Moved unchanged: `quran-uthmani.txt` → `tools/quran-verification/input/quran-uthmani.txt`.

Added:

- `tools/quran-import/schema.sql`
- `tools/quran-import/raw/README.md`
- `tools/quran-verification/.gitattributes`
- `tools/quran-verification/README.md`
- `tools/quran-verification/surah-counts.json`
- `tools/quran-verification/verify.mjs`
- `tools/quran-verification/verify.test.mjs`
- `tools/quran-verification/quran-manifest.json`
- `tools/quran-verification/output/report.json`
- `tools/quran-verification/output/report.md`

Modified: `README.md`, `backend/src/scripts/fullQuran.ts`. Earlier uncommitted local changes are retained; no source text, dependency or mobile file was edited. Nothing was staged, committed, pushed or deployed.

## 21–22. Verification commands

- `node --test tools/quran-verification/verify.test.mjs`: 6 tests passed, 0 failed.
- `node tools/quran-verification/verify.mjs`: exit 1, intentionally blocked because primary source is absent; Tanzil checks pass.
- Backend `npm run typecheck`: passed; `npm test`: 5 files / 34 tests passed, 0 failed; `npm run build`: passed.
- Mobile `npm run typecheck`, `npm run lint`: both passed.
- `git diff --check`: passed. Existing `backend/.env`, `mobile/.env`, and `atlas-credentials.env` are ignored. New reports/manifests use repository-relative paths and contain no connection strings or credentials.

The tests check original file pin, structure/counts, duplicates, empty text, ordered hash changes, preservation of originals, conservative classification, and failure on incomplete comparisons. They do not claim validation of an unavailable King Fahd corpus or native SQLite performance.

## 23. Manual actions required

1. Open the official King Fahd developer portal above and download the **Hafs / Uthmani Unicode developer package**. Complete any required acceptance/login personally. Place the untouched archive/export under `tools/quran-import/raw/`, together with its source URL and license/version documentation.
2. Obtain the official single-file Unicode Hafs font and authoritative terms permitting local redistribution in this Expo app, or written clarification from its publisher. Preserve those terms with the download.

Once these are available, inspect the real format, pin source and canonical hashes, compare every verse against your exact Tanzil file, stop for substantive differences, build and validate SQLite, migrate reference-based runtime/favorites, and measure native storage/RAM/lookup behavior. No step may substitute Tanzil for King Fahd or rewrite canonical text.
