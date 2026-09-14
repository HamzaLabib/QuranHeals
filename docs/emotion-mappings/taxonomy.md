# Emotion taxonomy, aliases, and the candidate-mapping workflow

Status: **infrastructure and documentation only.** Nothing in this phase
activates a new emotion or creates a reviewed Quran mapping. The live app still
serves exactly the 12 emotions in `backend/src/seed/emotions.ts` and the 43
`development` mappings derived from `backend/src/seed/ayahs.ts`.

Phase 5A builds the system. **Phase 5B** fills it with carefully reviewed
Quran mappings.

---

## 1. Current emotion architecture (verified from the repo)

| Fact | Value | Source |
| --- | --- | --- |
| Active emotions | **12** | `backend/src/seed/emotions.ts` (all `active: true`) |
| Emotion–ayah mappings | **43** | sum of `emotions[]` across 16 ayahs in `backend/src/seed/ayahs.ts`; asserted in `backend/tests/quran-data/full-quran.test.ts` (`total: 43`, `statuses: { development: 43 }`) |
| Distinct mapped verses | **16** | `backend/tests/quran-data/full-quran.test.ts` (`.size).toBe(16)`) |
| Mapping statuses in schema | `development`, `draft`, `reviewed`, `approved`, `rejected` | `backend/src/models/EmotionVerseMapping.ts` |
| Statuses the API serves | `development`, `reviewed`, `approved` | `userVisibleMappingStatuses` in `backend/src/services/MongooseQuranRepository.ts` |
| Quran Arabic source | verified local SQLite (mobile) / backend-owned copy | `mobile/src/services/quranRepository.ts`, `backend/src/quran/quranSource.ts` |
| Verse reference set | 6,236 keys, pinned | `backend/src/quran/referenceKeys.ts` |

The 12 shipped keys: `sad`, `anxious`, `lonely`, `angry`, `lost`, `afraid`,
`stressed`, `hopeless`, `tired`, `confused`, `grateful`, `peaceful`.

### Is "add more emotions" already supported cleanly?

**Mostly yes.** The data path is generic end to end:

- `EmotionModel` has no fixed enum of keys and no count assumption; it just
  validates `key` against `/^[a-z][a-z-]{1,40}$/` and sorts by `order`.
- `GET /api/emotions` returns whatever is `active`, sorted by `order`
  (`MongooseQuranRepository.listActiveEmotions`). No cap.
- The mobile home screen renders `emotions.map(...)` into a wrapping grid inside
  a `ScrollView` (`mobile/src/app/index.tsx`). 30 cards scroll fine; no layout
  code assumes 12.
- `EmotionCard` looks icons up in a map with a `?? Circle` fallback
  (`mobile/src/components/EmotionCard.tsx`), so an unknown icon degrades
  gracefully rather than crashing.
- Routing is by `emotion.key` as an opaque string
  (`/ayah/[emotion]`), so keys are already treated as stable identifiers.

### Where code changes *would* be required before activating new keys

> **Update (Phase 5B backend preparation):** rows 1–3 below are now **done** —
> the key pattern is widened, the 17 approved MAIN emotions are seeded
> `active: false`, and the regression scripts distinguish "seeded definitions"
> from "12 active". See §18. Rows 4–6 remain for later.

| # | Location | Assumption | Needed change |
| --- | --- | --- | --- |
| 1 | `backend/src/models/Emotion.ts`, `backend/src/models/Ayah.ts`, `backend/src/models/EmotionVerseMapping.ts`, `backend/src/validators/ayahValidators.ts` (and the copy in `backend/tests/quran-data/seed-integrity.test.ts`, plus `LIVE_EMOTION_KEY_PATTERN` in the taxonomy module) | `emotionKey` matched `/^[a-z][a-z-]{1,40}$/` — **letters and hyphens only** | **DONE in 5B prep** — widened to `/^[a-z][a-z_-]{1,40}$/` (letters, hyphens, underscores only). Additive; every existing key still matches. |
| 2 | `backend/tests/quran-data/seed-integrity.test.ts` (`maps every active emotion to at least one ayah`) | every `active` emotion has ≥1 seed mapping | **Satisfied** — new emotions are seeded `active: false`, so this check still passes. A key flips to `active: true` only once it has ≥1 approved mapping. |
| 3 | `backend/src/scripts/quranRegression.ts` (`emotions.body.data.length, 12`), `backend/src/scripts/fullQuran.ts` (`baselineFailures` → "Expected all 12 active emotions") | exactly 12 active emotions | **DONE in 5B prep** — both scripts now assert *12 active* while allowing extra inactive seeded definitions. `GET /api/emotions` still returns exactly 12. DB-connected scripts, not part of `npm test`. |
| 4 | `backend/src/services/MongooseQuranRepository.ts` (`userVisibleMappingStatuses` includes `development`) | production may serve `development` mappings | For the target lifecycle (below), tighten to `['approved']` (optionally `['approved', 'reviewed']` in dev builds) **after** the 43 MVP mappings are re-reviewed in Phase 5B. |
| 5 | `mobile/src/components/EmotionCard.tsx` icon map, `README.md` "Product Concept" prose | list the 12 by name | Cosmetic. Add icons for new keys; refresh the prose. Not blocking. |
| 6 | `mobile/src/app/ayah/[emotion].tsx` `readableEmotion` splits the key on `-` | hyphen-delimited keys | Split on `[-_]` when underscore keys ship, or (better) show `emotion.name` from the API instead of prettifying the key. |

### Do aliases require schema changes?

**No.** See §5 — aliases live in a static config module
(`backend/src/taxonomy/emotionTaxonomy.ts`), not in Mongo.

### Can the UI handle 30+ visible choices without a redesign?

Yes, functionally (it already scrolls). See §13 for UX polish recommendations.

---

## 2. Working taxonomy (32 candidates)

Machine-readable copy: `backend/src/taxonomy/emotionTaxonomy.ts`
(`phase5aTaxonomy`). It is deliberately **not** imported by the seed, the API,
or any runtime path.

Recommendation legend: **main** = own home-screen card · **merge** = fold into
another key as a sub-state, its phrases become aliases · **discovery** =
separate mode, not an emotion.

| Key | English | Arabic | Family | Overlap risk | Overlaps with | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| `sad` | Sad | حزين | distress | medium | want_to_cry, heartbroken, hopeless | main (shipped) |
| `want_to_cry` | I Want to Cry | عايز أعيط | distress | high | sad, heartbroken, overwhelmed | main |
| `heartbroken` | Heartbroken | مكسور الخاطر | distress | medium | sad, want_to_cry, betrayed, rejected | main |
| `overwhelmed` | Overwhelmed | مخنوق | distress | medium | stressed, anxious, tired | main (owner-confirmed distinct from `stressed`) |
| `anxious` | Anxious | قلقان | fear_anxiety | medium | afraid, stressed, overwhelmed | main (shipped) |
| `afraid` | Afraid | خايف | fear_anxiety | medium | anxious, stressed | main (shipped) |
| `stressed` | Stressed | متوتر | fear_anxiety | high | overwhelmed, anxious, tired | main (shipped) |
| `confused` | Confused | محتار | guidance_direction | high | lost, seeking_guidance | main (shipped) |
| `lost` | Lost | تايه | guidance_direction | high | confused, seeking_guidance | main (shipped) |
| `lonely` | Lonely | وحيد | loneliness_rejection | medium | rejected, sad | main (shipped) |
| `rejected` | Rejected | حاسس إني مرفوض | loneliness_rejection | medium | lonely, heartbroken, betrayed | main |
| `angry` | Angry | غضبان | anger_hurt | medium | frustrated, wronged | main (shipped) |
| `frustrated` | Frustrated | محبط | anger_hurt | high | angry, hopeless, tired | **merge → `angry`** (recommended, pending sign-off) |
| `betrayed` | Betrayed | مخذول | injustice_betrayal | medium | wronged, heartbroken, forgiveness_struggle | main |
| `wronged` | Wronged | مظلوم | injustice_betrayal | medium | betrayed, angry, forgiveness_struggle | main |
| `forgiveness_struggle` | I Can't Forgive | مش قادر أسامح | injustice_betrayal | medium | betrayed, wronged, angry | main |
| `guilty` | Guilty | حاسس بالذنب | guilt_repentance | high | regretful, repentant | main |
| `regretful` | Regretful | ندمان | guilt_repentance | high | guilty, repentant | **merge → `guilty`** (recommended, pending sign-off) |
| `repentant` | I Want to Repent | عايز أتوب | guilt_repentance | medium | guilty, regretful, closer_to_allah | main |
| `hopeless` | Hopeless | فاقد الأمل | hope_support | medium | sad, frustrated, weak | main (shipped) |
| `tired` | Tired | تعبان | distress | medium | weak, overwhelmed, hopeless | main (shipped) |
| `weak` | Feeling Weak | حاسس إني ضعيف | strength_resilience | medium | tired, hopeless, strength | main |
| `reassurance` | I Need Reassurance | محتاج أطمّن | hope_support | medium | anxious, peaceful, hopeful | main |
| `patience` | I Need Patience | محتاج صبر | strength_resilience | low | strength, tired | main |
| `strength` | I Need Strength | محتاج قوة | strength_resilience | medium | weak, patience | main |
| `hopeful` | Hopeful | عندي أمل | hope_support | medium | grateful, peaceful, reassurance | main |
| `peaceful` | Peaceful | مطمئن | peace_gratitude | high | content, grateful, reassurance | main (shipped) |
| `grateful` | Grateful | ممتن | peace_gratitude | low | peaceful, content, hopeful | main (shipped) |
| `content` | Content | راضي / قانع | peace_gratitude | medium | peaceful, grateful | main (owner-confirmed distinct from `peaceful`) |
| `seeking_guidance` | Seeking Guidance | محتاج هداية | guidance_direction | medium | lost, confused | main |
| `closer_to_allah` | I Want to Be Closer to Allah | عايز أقرب من ربنا | spiritual | medium | repentant, seeking_guidance | main |
| `quran_message` | A Message from the Quran | رسالة من القرآن | discovery | low | — | **discovery mode** (§14) |

Proposed aliases per key are in the taxonomy module (`englishAliases`,
`arabicAliases`). Highlights from the brief are captured verbatim, e.g.
`want_to_cry` ← `نفسي أعيط`, `هموت من العياط`, `مش قادر أمسك نفسي`;
`forgiveness_struggle` ← `شايل منه`, `عندي غل`, `بكرهه`, `عايز أنتقم`.

---

## 3. Overlap analysis

All 32 stay in the working list for Phase 5A — nothing is deleted. Findings per
cluster (revised after the owner's decision to keep `overwhelmed` and `content`
as main):

- **`sad` / `want_to_cry` / `heartbroken`** — emotionally distinct entry points
  even though their Quran response pools overlap. `want_to_cry` is a very common
  colloquial Arabic entry and worth its own card; it can *share* `sad`'s mapping
  pool rather than get a separate one. Keep all three **main**.
- **`anxious` / `afraid` / `stressed` / `overwhelmed`** — `afraid` (specific
  threat) is distinct. `anxious` (diffuse worry), `stressed` (متوتر, pressure)
  and `overwhelmed` (مخنوق, "cannot cope" / mentally suffocated) are related but
  the owner treats `overwhelmed` as a meaningfully distinct intent — a user can
  feel emotionally overloaded and unable to cope without calling it stress.
  **All four stay main.** `overwhelmed` shares mapping pools with `stressed`
  where a verse fits both; it does not need a separate pool.
- **`guilty` / `regretful` / `repentant`** — `repentant` is a forward-looking
  spiritual intent (tawbah) and stays **main**. `guilty` (حاسس بالذنب) and
  `regretful` (ندمان) are not separable for verse selection → `regretful` is a
  **recommended merge into `guilty`** (one of the two demotions proposed to
  reach 30; see §4).
- **`angry` / `frustrated`** — `angry` (غضبان, hot emotion) is shipped.
  `frustrated` (محبط/متضايق, blocked goals) draws on the same Quran response
  (restraining anger, forgiving people, "with hardship comes ease") and is the
  other **recommended merge**, into `angry`, with its blocked-goals phrasing kept
  as aliases. `wronged` stays distinct (injustice, not temper).
- **`hopeless` / `hopeful`** — deliberate opposite poles. Keep both **main**.
- **`peaceful` / `content` / `reassurance`** — `reassurance` is a *request*
  (distinct intent) → **main**. `content` (رضا / قناعة — acceptance of and
  contentment with what Allah decreed) is a distinct spiritual state, not the
  same as a calm/settled heart (`peaceful` / مطمئن); the owner keeps it directly
  accessible → **main**.
- **`weak` / `strength`** — a state vs a request; different flows (express vs
  ask). Keep both **main**.
- **`lost` / `confused` / `seeking_guidance`** — `seeking_guidance` is the
  request → **main**. `lost` (life direction) and `confused` (momentary) overlap
  but are both shipped and both get reached for → keep **main**. Neither can be
  demoted (both are shipped). `confused → lost` is only a theoretical lever.

---

## 4. Recommended final list (30) — recommendation only, NOT activated

**30 visible choices:** 29 emotional + `quran_message`.

**Owner decision applied:** `overwhelmed` (مخنوق) and `content` (راضي / قانع)
are kept as **main** visible choices — meaningfully distinct user intents, not
merged into `stressed` / `peaceful`.

To land on 30 after that, **two** candidates are recommended for demotion
(pending owner sign-off). Both are *new* candidates — no shipped key is demoted:

| Demote | Into | Overlap | Why this is the strongest pair |
| --- | --- | --- | --- |
| `regretful` | `guilty` | high | ندمان and حاسس بالذنب are not separable for verse selection; `repentant` already carries the distinct forward-looking tawbah intent. |
| `frustrated` | `angry` | high | محبط/متضايق shares its Quran response with shipped `angry` (restraining anger, forgiving people, patience through hardship). The blocked-goals nuance survives as aliases on `angry`. |

Their phrases become aliases of the target key (encoded via `resolvesTo` in the
taxonomy module and exercised by `resolveAlias`). **All 32 entries remain in the
module** until the owner approves the final 30.

Next-strongest alternatives, if the owner prefers a different second demotion:

- `betrayed → wronged` — betrayal is arguably a sub-case of being wronged (by
  someone trusted); both are new candidates.
- `want_to_cry → sad` — high overlap, but a very common distinct colloquial
  entry point; demoting it loses an accessible door.
- `confused → lost` — genuine overlap but **both are shipped**, so neither can
  be demoted without changing the live 12.

---

## 5. Alias strategy

**Where aliases live:** a static, version-controlled config module —
`backend/src/taxonomy/emotionTaxonomy.ts` — **not** Mongo, not a separate
collection, not a localization file.

Rationale:

- Aliases are editorial/product data that changes on release cadence, not per
  request. Code review + git history is the right control surface.
- Keeping them out of Mongo means **no schema change** and **no separate Quran
  mapping pool per alias** — an alias is a pointer to a main key, nothing more.
- A single module is trivially importable by tooling, tests, and (later) an
  API endpoint or a bundled asset for on-device matching.

**How resolution works** (`backend/src/taxonomy/aliasResolver.ts`):

1. `normalizeAliasPhrase` — trim, lowercase, collapse whitespace, strip Arabic
   tashkeel/tatweel and a little punctuation. It never touches Quran text.
2. `buildAliasIndex` — one `Map<phrase, {key, mainKey, matchedOn}>` built from
   every entry's key, English label, Arabic label, and alias arrays. Exact/label
   matches beat alias matches on collision; true alias/alias collisions are
   surfaced by `findAliasCollisions` for cleanup rather than silently resolved.
3. `resolveAlias(input)` → the entry, or `null`. Callers that just want the card
   to open use `.mainKey`, so a demoted candidate's phrases (`"too much"`)
   resolve straight to the live key (`stressed`).

**Future free-text / search:** the same index is the seed for fuzzy matching.
Add (in order of effort) prefix/substring match → Levenshtein within a small
edit distance → a lightweight embedding lookup, all falling back to the exact
index. Because resolution returns a **stable key**, none of that leaks into the
emotion-card UI: the cards keep rendering `GET /api/emotions`; search is an
additional entry path that resolves to the same keys.

**Additional languages:** add `labels: { [lang]: string }` and
`aliases: { [lang]: string[] }` shapes later, or keep `english*/arabic*` and add
`fr*`, `ur*`, … The resolver already keys off normalized phrases, so a new
language is new rows in the same index. `emotionKey` stays the identity.

---

## 6. Emotion families (internal only)

`EmotionFamily` in the taxonomy module:

```
distress            fear_anxiety        guidance_direction
loneliness_rejection anger_hurt         injustice_betrayal
guilt_repentance    hope_support        peace_gratitude
strength_resilience spiritual           discovery
```

Useful for: admin/review grouping (review a family at a time), analytics
(roll up "distress" vs "peace_gratitude" without exposing raw keys), and an
optional future home-screen grouping (§13). **Not** shown to users now and not
stored on the `Emotion` document — a `family` column can be added later if the
admin surface needs to query by it.

---

## 7. Mapping lifecycle

Conceptual states and how they map onto the **existing** schema enum
(`backend/src/models/EmotionVerseMapping.ts`) — no new enum value is introduced
in Phase 5A:

| Concept | Stored as | User-visible? | Enter how |
| --- | --- | --- | --- |
| `candidate` | **`draft`** (existing, currently unused) | no | bulk/AI import (`mapping:candidates`), or `mapping:upsert --status=draft` |
| `development` | `development` | yes (today) | human starts working a candidate; the 43 MVP mappings are grandfathered here |
| `reviewed` | `reviewed` | yes | editorial + scholarly pass complete |
| `approved` | `approved` | yes | final sign-off; **target: the only status production serves** |
| `rejected` | `rejected` | no | terminal |

Transitions (who/what):

- **→ candidate (`draft`):** the candidate-import tool or a maintainer. AI may
  *propose*; it never sets anything higher. Automated.
- **candidate → development:** a maintainer who has read the rationale and the
  verse in context. Manual (`mapping:upsert`).
- **development → reviewed:** a designated editor/reviewer, ideally with a
  scholarly check recorded in `reviewedBy` / `reviewedAt` / `tafsirReferences`.
  Manual.
- **reviewed → approved:** a second, senior reviewer (four-eyes). Manual.
- **anything → rejected:** any reviewer, with a reason in `contextNotes`. Manual.

> Optional Phase 5B refinement: add an explicit `'candidate'` enum value plus
> optional `proposedBy`, `source`, `approvedBy`, `approvedAt` fields. Deferred
> here to keep Phase 5A free of production-schema edits; `draft` +
> `contextNotes` provenance cover the need for now.

### What the app consumes

- **Production:** target end-state is `approved` only. Today it also serves
  `development` (the 43 MVP mappings). Tightening `userVisibleMappingStatuses`
  to `['approved']` is a **Phase 5B** step, done only after those 43 are
  re-reviewed, so the app never regresses to "no ayah for this emotion".
- **Development builds:** may additionally include `reviewed` (and, as today,
  `development`) behind explicit configuration. `candidate`/`draft` and
  `rejected` are **never** served in any build.

Unreviewed and approved mappings are never silently mixed: the status filter is
explicit in every query in `MongooseQuranRepository`.

---

## 8. AI mapping safety (developer rule)

**AI may help discover candidate verses. AI never declares a Quran–emotion
mapping authoritative.**

- Every AI-assisted mapping enters as **`candidate`** (stored `draft`) — the
  lowest-trust status, not served to users in any build.
- AI output must never be written directly to `development`, `reviewed`, or
  `approved`. There is no code path that lets it.
- Promotion past `candidate` is always an explicit human action by a named
  reviewer, recorded in `reviewedBy` / `reviewedAt` (and a second person for
  `approved`).
- The candidate-import tool (`backend/src/scripts/importCandidateMappings.ts`)
  hard-codes `status = draft` for every insert and is **insert-only**, so it
  cannot upgrade or overwrite an existing mapping.
- When AI/tooling is uncertain about Quran content, it must preserve the
  verified data and report the uncertainty — never edit.

---

## 9. Candidate-mapping tooling

`backend/src/scripts/importCandidateMappings.ts` — run as
`npm run mapping:candidates -- --input=<file.json>`.

Reused vs new: `mapping:upsert` (single mapping, immediate write, no dry run)
stays for promoting individual mappings by hand. The new tool covers the
different job of validating a *batch* of proposals and producing a review
artifact.

Input: JSON array of `{ verseKey, emotionKey, rationale, contextNotes?, source }`.
(CSV is intentionally unsupported — a hand-rolled CSV parser is a correctness
risk around quoted Arabic commas.)

| Requirement | Behavior |
| --- | --- |
| Validate `verseKey` | must match `^[1-9]\d{0,2}:[1-9]\d{0,2}$` **and** be in the verified 6,236 set (`isValidVerseKey`). |
| Validate `emotionKey` | must be a seeded emotion key (active or inactive) or a Phase 5A taxonomy key. A row is flagged `activatableToday` only if the key is one of the **12 currently active** emotions and matches the live key pattern. |
| Never copy/alter Quran Arabic | rows containing `arabicText`/`text`/`quranText`/… are rejected (`forbidden_text_field`). The tool never reads the SQLite/Arabic source. |
| Never alter SQLite | it has no SQLite code path at all. |
| Dry-run by default | with no flags: validate, write a JSON + Markdown report, touch no database. |
| Detect duplicates | duplicate `verseKey|emotionKey` within the batch → `duplicate_in_input` on all but the first. |
| Report existing conflicts | `--check-existing` (dev DB, non-production) annotates each row with the current stored status. |
| Never overwrite `reviewed`/`approved` | `--apply` is **insert-only**: if any mapping already exists for the pair, it is left completely untouched (`skipped_existing`). |
| Never promote automatically | every insert is `status = draft`. No update path. |
| Fail safely | malformed/unresolvable rows are reported and the process exits non-zero; DB flags require `MONGODB_URI` and refuse `NODE_ENV=production`. |
| Review-friendly output | `reports/emotion-mappings/candidate-mappings.json` + `.md` (summary table, issue counts, per-row status). |

Synthetic fixture: `backend/src/scripts/fixtures/candidate-mappings.sample.json`
(5 rows, clearly labelled non-authoritative). Pure validation/summarize logic is
unit-tested in `backend/tests/emotion-mappings/candidate-import.test.ts`.

The tool does **not** generate candidates and does **not** classify the Quran.

---

## 10. Review queue (recommended, minimal)

```
proposal (AI or human)
      │  automated
      ▼
candidate  (stored: draft)               ── not served anywhere
      │  human reads rationale + verse in context
      ▼
development                              ── dev builds only
      │  editor + scholarly check  (reviewedBy, reviewedAt, tafsirReferences)
      ▼
reviewed                                 ── dev / staging builds
      │  second senior reviewer (four-eyes)
      ▼
approved                                 ── production
```

`rejected` is reachable from any pre-approved state with a reason in
`contextNotes`. No tooling moves a mapping to the right of `candidate`.

---

## 11. Mapping versioning

Keep the existing lightweight `mappingVersion: string` field. Convention:

- `mvp-seed-1` — the current 43 (unchanged).
- `phase-5a-candidates-1` — default stamp for this tool's inserts
  (`--mapping-version=` to override).
- Bump the trailing integer whenever the taxonomy or review rubric that
  produced a batch changes, so a later audit can ask "which taxonomy version
  reviewed this mapping?".

No event sourcing, no per-field history. `createdAt` / `updatedAt` (Mongoose
timestamps) plus `reviewedBy` / `reviewedAt` are enough provenance for 5B.

---

## 12. Preserve the existing 12 emotions

- `backend/src/seed/emotions.ts` — the original **12 rows are unchanged** (keys,
  names, Arabic names, icons, `order` 1–12, `active: true`). Phase 5B prep
  **appended 17 new rows, every one `active: false`, `order` 13–29**; they are
  not user-visible.
- `backend/src/seed/ayahs.ts` — untouched. 16 ayahs, 43 `emotions[]` entries.
- `backend/tests/quran-data/full-quran.test.ts` still asserts `total: 43`,
  `activeEmotions: 12`, `statuses: { development: 43 }`, 16 distinct verses —
  and still passes.
- `GET /api/emotions` shape and ordering unchanged; it returns exactly the 12
  active emotions. `GET /api/ayahs/random` behavior unchanged.
- Verified for: Sad, Anxious, Lonely, Angry, Lost, Afraid, Stressed, Hopeless,
  Tired, Grateful, Peaceful, Confused (the shipped set).

---

## 13. Home-screen scalability (~29–30 cards)

Functionally fine today (wrapping grid in a `ScrollView`). Recommended polish,
none of it a redesign, to sequence into 5B:

- **Order:** drive `order` from `family` so related cards cluster; keep the
  shipped 12 near the top for continuity.
- **Card size:** offer a compact variant (icon + English + Arabic, no
  description) once the list passes ~16, to cut scroll length.
- **Categories:** optional family section headers (or filter chips) using the
  §6 families — internal names get user-facing copy.
- **Search:** a "How are you feeling?" text field on top of the alias resolver
  (§5). Free-text → stable key → same ayah screen.
- **Recent / favourites:** a "recent feelings" row (reuse the existing
  `recentAyahs` storage pattern) so returning users skip the scroll.
- **Discovery mode placement:** a visually distinct entry (full-width banner or
  pinned first card), never mixed into the emotion grid.

Minimal 5A-permissible change already covered: none required — no hard-coded
`12` exists in the mobile render path.

---

## 14. Quran Message mode (`quran_message`)

Architecturally **separate from the emotion taxonomy** (`kind: 'discovery'`,
family `discovery`, `recommendation: 'discovery_mode'`).

Planned selection strategy (structure only — **no pool is populated in 5A**):

- A dedicated pool of **curated, `approved` general-reflection** verses, tagged
  (e.g. a reserved key like `__general__` or a separate `GeneralReflection`
  collection — decide in 5B).
- Selection is random **within that curated pool only**. No uncontrolled random
  draw from the whole Quran.
- Same integrity guarantees as emotion mappings: `verseKey` resolves Arabic from
  the immutable source; nothing is invented.
- Entry point: its own UI affordance (§13), not an emotion card.

---

## 15. Quran integrity

Phase 5A touched **no** Quran text and **no** SQLite data. It adds a taxonomy
module, an alias resolver, a validation-only import tool, a synthetic fixture,
tests, and docs. The import tool has no code path that reads, writes, or
normalizes Arabic, and rejects any input row that carries verse text.
`verseKey` remains the only link between editorial metadata and immutable
content.

---

## 16. Phase 4C

**Not executed.** No MongoDB Arabic was removed, `$unset`, or cleaned up. No
`Verse`/`Ayah` documents were deleted. Physical Mongo Arabic cleanup stays
postponed until after the real iPhone smoke test.

---

## 17. Recommended next step

```
Phase 4B pushed
      ↓
Phase 5A taxonomy + mapping infrastructure   ← this document
      ↓
Real iPhone smoke test
      ↓
Phase 4C MongoDB Arabic physical cleanup
      ↓
Phase 5B reviewed emotion-to-ayah mapping expansion
```

First 5B actions, in order:

1. ~~Owner signs off on the final 30 list~~ — **done** (`overwhelmed` and
   `content` kept MAIN; `frustrated → angry`, `regretful → guilty` approved).
2. ~~Widen `emotionKeyPattern`~~ — **done in 5B backend prep** (§18).
3. ~~Add new emotions to `seedEmotions` with `active: false`~~ — **done in 5B
   backend prep** (§18). Each still needs ≥1 `approved` mapping before it is
   activated.
4. Select and review Quran verses for the new emotions (the actual Phase 5B
   work — not started).
5. Re-review the 43 MVP `development` mappings up to `approved`, then tighten
   `userVisibleMappingStatuses`.
6. Build the review UI/queue around the lifecycle in §10.
7. Mobile: icons + card layout + key prettifier for the new keys (separate
   task; see §1 rows 5–6).

---

## 18. Phase 5B backend preparation (completed)

Structural only — **no Quran mappings were created, proposed, or approved; no
emotion was activated.**

**Emotion-key pattern widened** `/^[a-z][a-z-]{1,40}$/` → `/^[a-z][a-z_-]{1,40}$/`
(letters, hyphens, underscores only — not loosened further) in:
`backend/src/models/Emotion.ts`, `backend/src/models/Ayah.ts`,
`backend/src/models/EmotionVerseMapping.ts`,
`backend/src/validators/ayahValidators.ts`,
`backend/tests/quran-data/seed-integrity.test.ts`, and `LIVE_EMOTION_KEY_PATTERN` /
`TAXONOMY_KEY_PATTERN` in `backend/src/taxonomy/emotionTaxonomy.ts`.

**17 approved MAIN emotions added to `backend/src/seed/emotions.ts`, all
`active: false`, `order` 13–29:**
`want_to_cry`, `heartbroken`, `overwhelmed`, `rejected`, `betrayed`, `wronged`,
`forgiveness_struggle`, `guilty`, `repentant`, `weak`, `reassurance`,
`patience`, `strength`, `hopeful`, `content`, `seeking_guidance`,
`closer_to_allah`.

Total seeded emotion **definitions: 29** (12 active + 17 inactive).
`GET /api/emotions` still returns **exactly 12**.

- `frustrated` and `regretful` are **not** seeded — they resolve through aliases
  to `angry` and `guilty` (`resolveAlias` verified in tests).
- `quran_message` is **not** seeded — it stays a separate discovery mode. No
  runtime feature was built for it here; see §14 for the recommended structure.
- `content`'s Arabic label is `راضي / قانع` (per the approved decision), synced
  across the seed, the taxonomy module, and §2.

Regression scripts (`quranRegression.ts`, `scripts/fullQuran.ts`) now assert
"12 active" while tolerating extra inactive seeded definitions.

**No** mappings added, **no** mapping statuses changed, **no** Quran text /
SQLite / hashes / `verseKey` set touched, **no** MongoDB / Phase 4C operation.
