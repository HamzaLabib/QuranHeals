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

See `docs/emotion-mappings/taxonomy.md` §7–§10 for the full mapping lifecycle
and review-queue design, and §8 for the AI-assisted-mapping safety rule.

## Directory structure

```text
backend/data/emotion-candidates/
├── README.md
├── batches/
│   ├── batch-1/ { initial-candidates.json, final-review.json, overlaps.json }
│   ├── batch-2/ { initial-candidates.json, final-review.json, overlaps.json }
│   ├── batch-3/ { initial-candidates.json, final-review.json, overlaps.json }
│   ├── batch-4/ { initial-candidates.json, final-review.json, overlaps.json }
│   └── batch-5/ { initial-candidates.json, final-review.json, overlaps.json }
├── updates/
│   └── .gitkeep
└── consolidated/
    ├── approved-mappings-preview.json
    └── duplicate-mappings-report.json
```

This is the canonical, permanent layout as of the Phase 5B/5C → structural
migration. Every Batch 1–5 file previously sat flat in this directory as
`phase5b-batchN-candidates.json` / `phase5b-batchN-human-review.json` /
`phase5b-batchN-overlap-candidates.json` (Batch 1's overlap file was named
`phase5b-overlap-candidates.json`, without a batch number); those flat files
no longer exist — every reference in code, tests, and documentation now
points at the paths below. This was a **structural move only**: no human
decision, KEEP/REJECT/HOLD status, or approved overlap changed as part of
the reorganization (see "Structural migration" below for the proof).

## Batch files (`batches/batch-N/`)

Each batch directory holds exactly three files, corresponding 1:1 to the old
flat files:

| File | Old flat-file equivalent | Contents |
| --- | --- | --- |
| `initial-candidates.json` | `phase5b-batchN-candidates.json` | The original, unreviewed candidate set for that batch: proposed `(verseKey, emotionKey)` pairs with `rationale`/`contextNotes`/`source`. Never reviewed or approved. |
| `final-review.json` | `phase5b-batchN-human-review.json` (Batch 1's overlap file: `phase5b-overlap-candidates.json`) | The human reviewer's final `keep` / `reject` / `hold` disposition for every core candidate, plus `supplementalReviews` (directly reviewed pairs outside the original candidate set) and, where applicable, `editorialCorrections`. Review outcomes only — **not** production mapping statuses. |
| `overlaps.json` | `phase5b-batchN-overlap-candidates.json` | Cross-emotion overlap proposals explicitly approved during that batch's human review: "this verse, already reviewed for emotion X, should also be assessed for emotion Y." Deduped by `verseKey + emotionKey` within the file it was first proposed in. **Not** approved mappings. |

Each `final-review.json`'s own `candidateSource` field points at the sibling
`initial-candidates.json` in the same batch directory (updated from the old
flat filename during the structural migration — see "Structural migration"
below).

### Per-batch scope and totals

| Batch | Emotions covered | Candidates | Final-review keep/reject/hold | Overlap rows |
| --- | --- | ---: | --- | ---: |
| 1 | `overwhelmed`, `heartbroken`, `reassurance`, `patience`, `seeking_guidance` | 66 | 62 / 3 / 1 (core) | 194 |
| 2 | `afraid`, `anxious`, `lost`, `confused`, `closer_to_allah` | 74 | 74 / 0 / 0 (core) | 135 |
| 3 | `angry`, `betrayed`, `wronged`, `guilty`, `repentant` | 76 | 69 / 7 / 0 (core, post-correction) | 464 |
| 4 | `sad`, `lonely`, `stressed`, `hopeless`, `tired`, `want_to_cry`, `rejected` | 130 | 122 / 8 / 0 (core, post-correction) | 418 |
| 5 (final) | `forgiveness_struggle`, `weak`, `strength`, `hopeful`, `content`, `grateful`, `peaceful` | 334 | 285 / 49 / 0 (core) | 185 |

Notes preserved from the original per-batch history (all still accurate at
the new paths):

- **Batch 1**: `supplementalReviews` holds `65:2` (reviewed separately,
  rejected, not one of the 66). One core row, `46:35 → patience`, was later
  superseded from `keep` to `reject` by the `phase5b-punishment-warning-exclusion`
  editorial correction — see "Later editorial corrections" below. Batch 1's
  `overlaps.json` (old name: `phase5b-overlap-candidates.json`) carries
  overlap proposals surfaced during the Batch 1 review; 6 rows sourced from
  `46:35` carry `status: "excluded"` after that same correction.
- **Batch 2**: all 74 core candidates are `keep`. `supplementalReviews`
  holds `1:5 → lost` (`keep`, proposed manually during review, not one of
  the 74). Batch 2's `overlaps.json` excludes anything already tracked in
  Batch 1's `overlaps.json`.
- **Batch 3**: originally 74 keep / 2 reject / 0 hold; now 69 / 7 / 0 after
  the punishment/warning correction superseded 5 core rows. The original two
  rejections (`64:14 → angry`, `2:222 → repentant`) are unaffected.
  `supplementalReviews` holds 449 additional pairs — originally 443 keep / 6
  reject, now 326 keep / 123 reject after that same correction — including
  the Ghafir `40:16`–`40:20` block, a further set of guilt/repentance verses,
  `39:67` reviewed against all 29 canonical emotions, and `39:64` rejected
  for the six emotions it was considered under. `39:75` was discussed but
  never accepted, so it is absent from every artifact.
- **Batch 4**: originally 127 keep / 3 reject / 0 hold; now 122 / 8 / 0 after
  the punishment/warning correction. The original three rejections
  (`3:173 → sad`, `3:103 → lonely`, `7:200 → rejected`) are preserved instead
  as `overlaps.json` proposals for the emotions they actually fit.
  `supplementalReviews` holds 11 additional pairs: 4 `keep`, and 7 moved from
  `keep` to `hold` by the `phase5b-rejected-self-reflection-hold` correction
  (a deferral, not a rejection). `2:286 → stressed` is an existing MVP
  mapping and is intentionally not duplicated. `final-review.json` also
  carries an `unrecoverableOverlapSources` block, now resolved to an empty
  `pairs: []` by the `phase5b-batch4-overlap-source-recovery` correction;
  `overlaps.json` grew from 147 to 418 rows as a result.
- **Batch 5 (final)**: 334 core candidates, 285 keep / 49 reject / 0 hold,
  plus 28 supplemental keep decisions (2 `forgiveness_struggle`, 2
  `strength`, 12 `grateful`, 12 `peaceful`). Rejections are pair-specific —
  e.g. `21:47` is `reject` for `forgiveness_struggle`/`weak`/`content` but
  `keep` for `strength`. No Batch 5 pair was held, and no editorial
  correction was needed. `overlaps.json` (185 rows) is sourced only from this
  batch's own approved-overlap lists; `12:100 → guilty` is explicitly
  excluded per the reviewer and does not appear anywhere in Batch 5's files.
  See "Batch 5 detail" below for the full fresh-discovery and overlap-sourcing
  breakdown.

`keep` / `reject` / `hold` and the overlap rows are **editorial review data**.
They never touch MongoDB, never set `development` / `reviewed` / `approved`,
and never activate an emotion. Batch 1 through Batch 5 human review are all
now complete; nothing has been promoted to a production mapping status.

## `updates/` — reserved for future manual additions

```text
backend/data/emotion-candidates/updates/
└── .gitkeep
```

Currently contains only `.gitkeep`, tracking the empty directory. **No
`update-001` or placeholder JSON exists yet, and none should be created
before a real update is ready.**

When a future update is ready, it follows this shape:

```text
updates/
└── update-001/
    ├── final-review.json
    └── overlaps.json
```

A future update does **not** require its own `initial-candidates.json`: unlike
a Batch 1–5 candidate-discovery round, updates are for cases where a human
has manually selected the ayah–emotion connections directly (no
automated/overlap candidate-generation step precedes them), so `final-review.json`
is the first artifact. `overlaps.json` follows the same shape as a batch's
`overlaps.json` — cross-emotion proposals approved during that update's
review.

## `consolidated/` — the Phase 5C output

| File | Old flat-file equivalent | Contents |
| --- | --- | --- |
| `approved-mappings-preview.json` | `phase5c-approved-mappings-preview.json` | The single canonical, deterministic pre-activation mapping preview — **1,845 rows**. Every `(verseKey, emotionKey)` pair independently traceable to an existing MVP mapping, a direct Batch 1–5 human KEEP, a Batch 1–5 supplemental human KEEP, and/or an eligible reviewer-approved overlap proposal, after REJECT/HOLD/editorial-correction exclusions. **A preview only — not production or active data. Nothing here is activated.** |
| `duplicate-mappings-report.json` | `phase5c-cross-batch-duplicate-audit.json` | Audit of the 25 `(verseKey, emotionKey)` overlap-proposal identities that appear in more than one batch's `overlaps.json`. Source batch files are unmodified; this audit only records how each duplicate identity collapses into `approved-mappings-preview.json`. An audit artifact only — **never** treated as runtime mapping input. |

There is exactly one canonical preview file — no numbered variants, no
backup copies, and no compatibility file left at the old
`phase5c-approved-mappings-preview.json` path.

## `backend/reports/emotion-mappings/` — audit reports

| File | Earlier names | Contents |
| --- | --- | --- |
| `approved-mappings.json` | `approved-mappings-report.json`, originally `backend/reports/phase5c-consolidation-report.json` | Machine-readable Phase 5C validation output: input inventory (with per-file SHA-256), source accounting, the accounting equation, duplicate accounting, and REJECT/HOLD protection numbers. |
| `approved-mappings.md` | `approved-mappings-report.md`, originally `backend/reports/phase5c-consolidation-report.md` | Human-readable rendering of the same report. |
| `candidate-mappings.json` | `backend/reports/phase5a-candidate-mappings.json` | Review-friendly output of `npm run mapping:candidates` (see `docs/emotion-mappings/taxonomy.md` §9). Its `input` field is a frozen record of the specific file path that existed when that report was generated (`data/emotion-candidates/phase5b-batch5-candidates.json`, itself since renamed) and is preserved as historical evidence, not updated. |
| `candidate-mappings.md` | `backend/reports/phase5a-candidate-mappings.md` | Human-readable rendering of the same report. |

These are audit outputs only — they are never imported into the database and
carry no runtime effect.

## Later editorial corrections (post Batch 1–4)

Three rounds of human review corrected or completed earlier Batch 1–4 outcomes
after the fact. All three are recorded as `editorialCorrections` entries
directly inside the affected `batches/batch-N/final-review.json` files
(superseded rows keep a `priorDecision`, a `supersededBy` id, and an
explanatory `note` — nothing is deleted), and as `status: "excluded"` markers
on the corresponding rows of the batch `overlaps.json` files. `decisionCounts`
in each affected file reflects the corrected core `reviews` totals, not the
original Batch 1–4 numbers.

- **Punishment/warning verse-level exclusion** (`phase5b-punishment-warning-exclusion`).
  17 verseKeys previously kept somewhere across Batches 1–4 — `15:50`, `39:54`,
  `39:55`, `39:56`, `39:57`, `39:58`, `39:59`, `39:60`, `39:65`, `39:68`,
  `39:71`, `39:72`, `40:18`, `42:42`, `46:35`, `69:18`, `69:25` — were later
  superseded from `keep` to `reject` for **every** emotion pair they were
  reviewed under, because their dominant tone is punishment, warning, or
  eschatological fear and they are not currently suitable for the
  emotional-support experience. This is a verse-level decision, so it changed
  128 `(verseKey, emotionKey)` review rows (1 in Batch 1, 122 in Batch 3, 5 in
  Batch 4) and excluded 25 rows in the batch `overlaps.json` files (6 in
  Batch 1's, 19 in Batch 3's) that had been sourced only from those
  now-superseded decisions. Five verses reviewed alongside this group —
  `14:42`, `40:16`, `40:17`, `40:19`, `40:20` — were explicitly **retained**
  as `keep`, with every previously approved overlap (including `betrayed`,
  `wronged`, `angry`, and `reassurance`) untouched.
- **`rejected` self-reflection HOLD** (`phase5b-rejected-self-reflection-hold`).
  Seven Batch 4 `final-review.json` supplemental pairs — `3:159`,
  `13:11`, `2:44`, `61:2`, `61:3`, `16:125`, `20:44`, each paired with
  `rejected` — moved from `keep` to `hold` (**a deferral, not a rejection**)
  under the category "self-reflection / advice-style / personal-change review
  deferred", pending a future decision on whether `rejected` should include
  verses that ask the user to examine their own behavior, consistency
  between words and actions, gentleness, wisdom in advice, communication
  style, or things they may need to change in themselves. Only the direct
  `verseKey → rejected` pair changed for each verse; every other approved
  overlap for these seven verses (for example `3:159 → angry`, approved in
  the Batch 3 core review) is untouched.
- **Batch 4 overlap-source recovery** (`phase5b-batch4-overlap-source-recovery`).
  The 120 core `keep` pairs left in `unrecoverableOverlapSources.pairs` after
  the punishment/warning correction (125 originally, minus the 5 superseded
  to `reject`) were not actually unknown: the human reviewer supplied the
  exact accepted overlap-destination list for each one. Every listed
  destination was persisted to Batch 4's `overlaps.json`
  unless it was already represented by an existing MVP mapping, a direct
  Batch 1–4 human-review decision, or a previously persisted overlap row —
  in which case it was skipped (if tracked in another batch's `overlaps.json`)
  or merged into the existing row's `sourceEmotionKeys` (if already present
  in this same file, e.g. the pre-existing `3:173`/`7:200` rows), never
  duplicated or invented. This resolved all 120 pairs — of 1,193 raw
  reviewer-approved destination proposals, 311 were already a direct
  decision, 10 were already an MVP mapping, 505 were already tracked in
  another overlap file, 96 merged into an existing or newly-created row for
  the same `(verseKey, destination)` pair with more than one source emotion,
  and 271 became brand-new rows — taking the file from 147 to 418 rows.
  `unrecoverableOverlapSources.pairs` is now `[]`; `supersededPairs` is kept
  unchanged as historical audit provenance.

## Batch 5 detail — the final Phase 5B candidate batch

Batch 5's `initial-candidates.json` covers the seven canonical emotion keys
not used as a core batch emotion in Batches 1–4: `forgiveness_struggle`,
`weak`, `strength`, `hopeful`, `content`, `grateful`, `peaceful`. It was built
the same way earlier batches carried forward overlap proposals, from two
controlled sources:

1. **Reviewer-approved overlaps (320 rows).** Every overlap proposal in
   Batches 1–4's `overlaps.json` files whose destination `emotionKey` is
   one of the seven, excluding: rows carrying `status: "excluded"` (5, all
   from the punishment/warning correction), rows already an existing MVP
   mapping (2 — `13:28 → peaceful`/`grateful`), and rows already directly
   decided anywhere in Batch 1–4 (0 collisions found). Of 332 raw eligible
   proposals, 5 duplicate `(verseKey, emotionKey)` pairs proposed by more
   than one overlap file were merged into a single candidate with a unioned
   `sourceEmotionKeys` list rather than duplicated (e.g. `3:159 →
   forgiveness_struggle`, proposed by both Batch 3's and Batch 4's
   `overlaps.json`).
2. **Fresh discovery (14 rows).** New candidates added only where the
   *complete* ayah independently fits the destination emotion, each verified
   against an authoritative translation before inclusion: `3:134`, `24:22`,
   `41:34`, `42:37` for `forgiveness_struggle`; `4:28` for `weak`; `2:286` for
   `strength`; `93:5` for `content`; `89:27`–`89:28` for `peaceful`; `16:114`,
   `2:172`, `27:19`, `27:40`, `31:12` for `grateful` (the weakest-covered
   emotion from overlaps alone, at only 7 rows). `14:7` was considered for
   `grateful` and explicitly **excluded** (not held) — the full ayah pairs
   the promise of increase with an equally weighted "My punishment is
   severe" clause, which fails the same full-ayah-fit standard used for the
   17-verse punishment/warning exclusion.

Candidates are grouped by the seven emotions in the order listed above; within
each emotion, overlap-derived rows come first in Batch 1→2→3→4 order, then
fresh-discovery rows ordered numerically by surah:ayah — a stable,
review-friendly sequence that does not depend on filesystem or object
iteration order.

**Editorial-only, stricter than earlier batches:** no `rationale` or
`contextNotes` field quotes Quran Arabic or an English translation fragment,
even briefly — several earlier batches' `overlaps.json` files do contain
short quoted phrases, and those files are left untouched, but nothing quoted
is carried into Batch 5's `initial-candidates.json`.

Batch 5's `final-review.json` records the completed human review of all
334 Batch 5 candidates: **285 keep, 49 reject, 0 hold**, plus 28 supplemental
KEEP decisions (2 `forgiveness_struggle`, 2 `strength`, 12 `grateful`, 12
`peaceful` fresh discoveries). Rejections are pair-specific — for example
`21:47` is `reject` for `forgiveness_struggle`, `weak`, and `content` but
`keep` for `strength`, all as independently reviewed. No Batch 5 pair was
held, and no editorial correction was needed for this batch. Every
reviewer-approved cross-emotion overlap destination raised during this
review (the `forgiveness_struggle` core pairs, the four emotions' fresh
supplemental discoveries, and `weak`'s additional approved overlaps for
`11:6`/`29:60`/`39:53`) that was not already an existing MVP mapping,
already a direct decision elsewhere, or already tracked in an earlier
batch's `overlaps.json` was persisted to Batch 5's own `overlaps.json`
(185 rows); `12:100 -> guilty` was explicitly excluded per the reviewer and
does not appear anywhere in either Batch 5 file.

Batch 5 was the last Phase 5B candidate batch. With its human review
complete, the next phase is **Phase 5C — final consolidation and
cross-batch validation**, before any mapping activation.

## Phase 5C — final consolidation & cross-batch validation

**Purpose:** produce one deterministic, auditable preview of every
`(verseKey, emotionKey)` pair the Phase 1–5B history actually supports,
without activating anything. Phase 5C reads Phase 5B as immutable audit
history — it never edits a batch's `initial-candidates.json`,
`final-review.json`, or `overlaps.json`.

**Inputs:** the real MVP mappings (`backend/src/seed/ayahs.ts`), the 29
canonical emotion keys (`backend/src/seed/emotions.ts`), the verified
6,236-ayah verse-key set (`backend/src/quran/referenceKeys.ts`), all five
`batches/batch-N/final-review.json` files (core `reviews` +
`supplementalReviews`), and all five `batches/batch-N/overlaps.json` files.

**Precedence, exact-pair, highest wins per `(verseKey, emotionKey)`:**

1. **Protected editorial corrections** — a `status: "excluded"` overlap row
   or a superseded/punishment-excluded pair never enters the preview.
2. **Direct human-review decision** — KEEP includes it once; REJECT excludes
   it and blocks any overlap proposal for that exact pair from reintroducing
   it; HOLD excludes it, is tracked separately, and is never treated as a
   rejection.
3. **Supplemental human-review KEEP** — same as a direct KEEP; merges with
   an existing MVP row instead of duplicating it.
4. **Existing MVP mapping** — included once; a REJECT/HOLD for the exact
   same pair would be a conflict requiring manual resolution (none exists
   today — verified programmatically).
5. **Approved overlap proposal** — included only if canonical, valid,
   traceable, not rejected/held/excluded, and not already represented by a
   higher-priority source (in which case it still enriches that row's
   provenance rather than being dropped or duplicated).

A pair can carry more than one provenance type at once (e.g. an MVP mapping
independently rediscovered as an overlap proposal) — `sourceTypes` on each
preview row lists every contributing source.

**Historical cross-batch duplicates:** 25 `(verseKey, emotionKey)` overlap
identities are proposed by more than one of the Batch 1–4 `overlaps.json`
files (Batch 5 introduces zero new ones). `consolidated/duplicate-mappings-report.json`
records every source file and source emotion key per identity and how each
one resolves (already superseded by a direct KEEP, or collapsed into a
single overlap row) — the 25 source rows are left exactly as they are in
each batch's `overlaps.json`; only the *derived* Phase 5C output deduplicates
them.

**REJECT / HOLD protection:** 191 unique pairs are rejected and 8 are held
across Batch 1–5 (7 protected self-reflection holds from the
`phase5b-rejected-self-reflection-hold` correction, plus one pre-existing,
unrelated Batch 1 hold, `1:7 → seeking_guidance`) — the naive expectation of
"7 holds" undercounts this by the pre-existing Batch 1 entry, which is why
Phase 5C recomputes the global count from disk rather than assuming it. 51
overlap proposals across Batch 1–4 target an already-rejected pair and are
blocked; zero target a held pair. Neither a REJECT nor a HOLD pair appears
anywhere in `consolidated/approved-mappings-preview.json`.

**Outputs (all dry-run previews, never production data):**

- `consolidated/approved-mappings-preview.json` — the consolidated pair set.
- `consolidated/duplicate-mappings-report.json` — the duplicate-identity audit.
- `backend/reports/emotion-mappings/approved-mappings.json` / `.md` —
  full input inventory (with before/after SHA-256 proving Batch 1–5 files
  were not modified), source accounting, the accounting equation, and
  REJECT/HOLD protection numbers.

**Source-artifact immutability:** every Batch 1–5 candidate, human-review,
and overlap file's SHA-256 was captured before and after Phase 5C ran and is
identical (`backend/reports/emotion-mappings/approved-mappings.json` →
`inputInventory[].sha256Before` / `.sha256After`). Nothing in `backend/data/quran`,
`backend/assets/quran`, or the production mapping seed was touched.

**No activation:** `consolidated/approved-mappings-preview.json` is a preview
artifact, not runtime data. It is never read by the API, never written to
MongoDB or SQLite, and does not change any emotion's `active` flag. Turning
any of these pairs into a real `development`/`reviewed`/`approved` mapping
remains a separate, explicit, manual step outside Phase 5C.

## Structural migration (Phase 5B/5C flat files → `batches/` + `consolidated/`)

The 15 Batch 1–5 files, the 2 Phase 5C consolidated files, and the 2 Phase 5C
reports originally lived flat in `backend/data/emotion-candidates/` (and
`backend/reports/`) under `phase5b-*` / `phase5c-*` names. They were moved —
not copied — to the permanent hierarchy documented above. This was a
**structural migration only**:

- No candidate row, human decision (`keep`/`reject`/`hold`), approved
  overlap, or editorial correction was added, removed, or changed.
- The 15 batch files (candidates + overlaps, all 10 of them, plus 3 of the 5
  `final-review.json` files with no other pending edit) are byte-identical
  before and after the move (verified by SHA-256).
- The other 2 `final-review.json` files' one legitimate content change: each
  batch's `candidateSource` field, which names its sibling
  `initial-candidates.json` file, was updated from the old flat filename
  (e.g. `phase5b-batch3-candidates.json`) to the new sibling-relative name
  (`initial-candidates.json`) — this is the only byte-level change to any
  batch source file, and it is a path-provenance update, not a decision
  change.
- `consolidated/approved-mappings-preview.json`, `consolidated/duplicate-mappings-report.json`,
  and the two `backend/reports/emotion-mappings/` reports were regenerated
  from the moved batch files at their new paths. Regeneration updated only
  path/filename provenance fields (e.g. `overlapProvenance[].sourceFile`);
  every mapping pair, decision, count, and protection is byte-for-byte
  identical to the pre-migration run once path fields are normalized out
  (proven by an independent before/after structural comparison, not merely
  re-asserted).
- Free-text `note` fields inside the batch `final-review.json` files that
  happen to mention an old filename in prose (a handful of editorial-history
  explanations in Batches 4 and 5) were deliberately **left unchanged** —
  they are the reviewer's original historical commentary, not a structural
  path pointer, and rewriting reviewer-authored audit text is outside the
  scope of a structural migration.
