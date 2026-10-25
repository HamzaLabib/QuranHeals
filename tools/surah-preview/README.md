# Surah Preview (عن السورة) data

The Mushaf reader's **Surah Preview / عن السورة** sheet (`mobile/src/surahPreview/`) shows, for a Surah beginning on the
page: its name; Makki/Madani, number of ayahs and Surah number; its main purpose (مقصد السورة); its main themes
(موضوعاتها). Development builds only (`bundledDataset.ts`), until the sources' terms allow a release.

## Pipeline

```
node tools/surah-preview/import.mjs [--cache <dir>] [--quranpedia <surahs.json.gz>] [--update-lock]   # writes mobile/assets/surah-preview/surah-preview.json (git-ignored)
node tools/surah-preview/validate.mjs [--file <dataset.json>]         # checks it and prints coverage
```

- `import.mjs` fetches the 114 QuranEnc pages (or reads cached copies), extracts «من مقاصد السورة» verbatim, and checks
  each against `source.lock.json` (SHA-256 per Surah): any change stops the import until reviewed (`--update-lock`).
  It merges `reviewed-content.json` when that file exists (see below). Topics: Quranpedia's official dump (below),
  pinned in `quranpedia.lock.json` (version, file SHA-256, SHA-256 of each Surah's topics), cached git-ignored in
  `source/`; extracted by `quranpedia-topics.mjs` and written as `pending-review`; `topics-review.json` lists each
  Surah's item count, the source's citation and its review flags (no text). A new dump or a changed Surah stops the
  import until reviewed (`--update-lock`).
- `validate.mjs` checks: 114 unique Surahs in order; ayah counts and Makki/Madani against Tanzil's raw
  `backend/data/quran/quran-data.xml` (6,236 ayahs); the Arabic purposes against the lock; each section's text present
  exactly when its status is not `unavailable`; `quoted` only for the Mukhtasar purpose; every cited source listed; no
  placeholder text; topics with a source of their own; Quranpedia's still `pending-review` and identical to what the
  pinned dump gives for that very Surah (re-derived when the dump is cached).

## Sources

| Section | Source | Status |
|---|---|---|
| مقصد السورة (Arabic) | «المختصر في التفسير», مركز تفسير للدراسات القرآنية — «من مقاصد السورة», via https://quranenc.com/ar/browse/arabic_mokhtasar/{n} | **quoted**, 114/114, re-verified against the live pages 2026-10-24 |
| Makki/Madani, ayah count | Tanzil `quran-data.xml` (pinned sha256 in `backend/assets/quran/surah-names.json`) | 114/114; 43 Surahs listed for scholarly review in `classification-review.json` |
| موضوعاتها (Arabic) | Quranpedia.net «معلومات سور القرآن» → `topics` («موضوعاتها»), official dump `surahs.json.gz` version 2026-10-24 (sha256 `641f3b5f…d2be`, checked against its manifest). 110 Surahs cite «التفسير الموضوعي لسور القرآن الكريم» (نخبة من علماء التفسير وعلوم القرآن; volume/page per Surah in `topics-review.json`); Al-Fatiha has Quranpedia's own framing of a passage of al-Sa'di | **pending-review**, 112/114 |
| موضوعاتها (Arabic), Surahs 42 and 44 | Quranpedia has none for them: al-Fairuzabadi, «بصائر ذوي التمييز في لطائف الكتاب العزيز» (Quranpedia book 186, ed. Muhammad Ali al-Najjar), the chapter on each Surah (matched by its title), its «معظم مقصود السورة» sentence verbatim | **pending-review**, 2/114 |
| English purpose / topics | — | **unavailable**, 0/114 (see below) |

### Topics: what was taken, and what is open

- Shown text: the source's own list items, verbatim; only their numbering, ayah ranges and nested sub-sections are left out
  (rules in `quranpedia-topics.mjs`, tested). Nothing reworded, summarised or translated.
- Not yet verified: appearing in Quranpedia is not a scholarly approval. Every list awaits review against the cited
  volume and page; `topics-review.json` flags the long lists (16 Surahs over 10 items), the uncited one (1), the two
  missing (42, 44), one apparent typo kept as is (18: «الحمد الله»), and Quranpedia's different Makki/Madani on 13, 55,
  76 and 102 (the app keeps Tanzil's).
- Permission: Quranpedia's licence (LICENSE.md in the dump) allows use inside apps without attribution, but states that
  «Translations and contemporary works remain the intellectual property of their respective authors and publishers»;
  «التفسير الموضوعي لسور القرآن الكريم» is a contemporary work, so its publisher's permission is still needed before any
  release. Development builds only until then.

### Why other sources were not used

- QuranEnc's English Mukhtasar objectives were withdrawn (they follow an older Arabic edition).
- الدرر السنية «موسوعة التفسير» (https://dorar.net/tafseer/{n}, «موضوعات السورة», 114/114) forbids it: «الموسوعات حالياً غير قابلة للتنزيل وإنما هي للبحث والتصفح من خلال الموقع فقط، ولا يسمح بنسخها
  واستخدامها سواء على جهاز خاص أو أقراص» (https://dorar.net/feedback); its API terms forbid bulk download, storage and
  republishing (https://dorar.net/api-services/terms).
- English: Quran.com / Quran Foundation's chapter info (Sayyid Abul Ala Maududi, Tafhim al-Qur'an; themes in 109/114) may
  be displayed live from the API but not bundled: «Prepackaged content … does not itself authorize distributing a
  prepackaged database or build-time bundle of QF Content» (https://api-docs.quran.foundation/legal/developer-terms/).
- Quranpedia has no English Surah information (the API returns the Arabic for `lang=en`; the dumps hold Arabic only).
- Nothing was paraphrased, summarised or translated to fill a gap: the sheet says «غير متاحة بعد» / "Not available yet".

### Permissions still open

The full record (owner approval, each source's terms, the before-production checklist): [PERMISSIONS.md](PERMISSIONS.md).

- Tafsir Center (المختصر): «جميع الحقوق محفوظة»; written permission for in-app use not obtained (info@tafsir.net).
- QuranEnc terms (re-publishing translations unchanged, credited, versioned, kept up to date): whether they cover the
  Arabic tafsir's objective lines inside an app is unconfirmed.
- «التفسير الموضوعي لسور القرآن الكريم» (topics, via Quranpedia): the publisher's permission for in-app use.

## Owner approval — `owner-approval.json`

The owner approved the Arabic Main Purpose and Topics of all 114 Surahs as worded (2026-10-24; [PERMISSIONS.md](PERMISSIONS.md)).
The file holds no text: per Surah, the SHA-256 of the exact Arabic purpose and topics approved. `validate.mjs` reports
114/114 and fails if any text changes, until the owner approves the new wording (regenerate the record then). It is kept
apart from scholarly review: the topics stay `pending-review` in the dataset and the app, and the dashboard shows owner
approval beside, not as, a review decision.

## Scholarly review — the dashboard (`review/`)

The only way Topics become `approved` (or `rejected`) is a qualified human reviewer's explicit decision in the local
dashboard. Automated checks, proposals and Claude's assessments never count as approval.

```sh
node tools/surah-preview/import.mjs                 # once: builds the dataset and caches the pinned sources
node tools/surah-preview/review/server.mjs          # → http://127.0.0.1:8772 (this machine only)
```

Per Surah (all 114): name and number, the Main Purpose (read only, not under review), the current Topics as extracted
from the pinned source, what the app shows now, the original source text verbatim, the citation and provenance
(source ids, dump version and SHA-256), warnings and priority reasons, and — for lists of more than 10 headings and for
Ash-Shura's one sentence — a **proposal** (`review/proposals.mjs`, fixed rules: select the source's own headings, or
split the sentence at its own «، و»; never reworded; omitted headings listed; always `pending-review`). Filters:
priority, long lists, undecided, decided, stale. The reviewer's name is required for every decision.

Decisions — **Accept current**, **Accept proposal**, **Edit** (one topic per line), **Reject** (the app then shows no
topics for that Surah), **Skip** (changes nothing) — with an optional note, are appended to
`review/data/decisions.jsonl` (git-ignored): one JSON line each, synced to disk, never rewritten, each carrying the
SHA-256 of the line before it, so an edited or removed line stops the dashboard and `apply.mjs` until restored. Each
decision also carries the SHA-256 of the topics as reviewed: if the pinned source changes afterwards, the decision is
**stale** and is not applied. A later decision supersedes an earlier one; the history stays. Back the file up.

To put decisions into the app (development builds only):

```sh
node tools/surah-preview/review/apply.mjs           # dry run: what would change
node tools/surah-preview/review/apply.mjs --write   # writes reviewed-content.json (git-ignored)
node tools/surah-preview/import.mjs && node tools/surah-preview/validate.mjs
```

`validate.mjs` fails on any `approved` section without the reviewer's recorded decision or whose text differs from it.
`server.mjs` and `apply.mjs` take `--data <dir>` for a rehearsal log (`apply.mjs` then never writes).

Approval is scholarly approval only: it is not permission to redistribute (see [PERMISSIONS.md](PERMISSIONS.md)).

## Reviewed content — `reviewed-content.json`

Written by `review/apply.mjs` (do not edit by hand). Shape:

```json
{
  "sources": [{ "id": "…", "title": "…", "publisher": "…", "url": "…", "retrieved": "…" }],
  "surahs": {
    "18": { "themesAr": { "status": "approved", "items": ["…"], "sources": ["…"],
                          "review": { "reviewer": "…", "decidedAt": "…", "decision": 7, "action": "edit", "basis": "edited" } } }
  }
}
```

Sections: `themesAr`, `themesEn` (`items`), `purposeEn` (`text`). Status `approved` or `rejected` (both need
`review`, the human decision; `rejected` shows no topics), or `pending-review` (shown in development builds marked
«قيد المراجعة العلمية»). Every section must cite a listed source; the import refuses anything else, and nothing here
may claim `quoted`. topics-review.json records each Surah's status and, once decided, the reviewer and decision number.
