# Word Meanings (المعاني) data

The Mushaf reader's **المعاني / Word Meanings** sheet (Normal Mode only; `mobile/src/wordMeanings/`) shows, for the
page being read, the words selected by King Fahd Complex's **«الميسر في غريب القرآن الكريم»** (*Muyassar of Ghareeb
Al-Qu'ran*) and their short explanations, exactly as the source has them.

## Source

| | |
|---|---|
| Work | الميسر في غريب القرآن الكريم |
| Publisher | مجمع الملك فهد لطباعة المصحف الشريف (King Fahd Glorious Qur'an Printing Complex) |
| Platform | https://qurancomplex.gov.sa/quran-dev/ |
| File | https://download.qurancomplex.gov.sa/resources_dev/MuyassarGhareeb.docx |
| Pins | `source.lock.json`: 956,677 bytes; MD5 and SHA-1 as published on the platform (both matched); SHA-256 computed from that verified download |
| Listing | created 6-4-2021, last modified 6-4-2021, no updates; HTTP Last-Modified 12 Jan 2023 |
| Retrieved | 2026-10-24 01:44 UTC |

The platform describes a developer package (Excel, CSV, HTML5, SQL, XML, JSON, PDF and fonts) with the fields `id`,
`page`, `sura_name`, `aya_no`, `quranic_words`, `explanation`, but serves only this Word document, which has none of
those fields (no page numbers, no ids). Its edition is not stated in the file; the Complex announced a revised, fully
vocalised second edition of the book on 2021-01-27 (https://qurancomplex.gov.sa/en/?p=5607), and the file is fully
vocalised, but that it is that edition is an inference only.

### Usage terms: permitted for applications in principle; conditions not yet confirmed

- The platform describes its files as a service "for developers, researchers and publishers to use in their
  applications' content (desktop, mobile and browsers)", content approved by the Complex.
- The Complex's site licence (ترخيص الاستخدام, https://qurancomplex.gov.sa/privacypolicy/, read 2026-10-24): all
  site content is the Complex's property under Saudi and international copyright law, «باستثناء بعض الخدمات، والملفات
  الحاسوبية، والأدوات البرمجية، وغيرها التي يصـرِّح المجمع بإتاحتها للاستخدام العام» — except services, computer files
  and software tools the Complex declares available for public use, which the developer platform's files are.
- Not stated anywhere: required attribution wording, whether the text may be modified or excerpted (our derived data
  regroups it by page and corrects one reference), and redistribution inside a binary. The site names its Digital
  Media Unit (وحدة الإعلام الرقمي) as the contact. A written confirmation of those three points is the remaining
  release step.

The owner approved the development implementation on 2026-10-24 with the attribution «الميسر في غريب القرآن الكريم —
مجمع الملك فهد لطباعة المصحف الشريف». Until the conditions are confirmed, as with the other King Fahd text in this
repository
(tools/quran-verification/output/ARCHIVED-OUTPUTS.md), until the terms are confirmed in writing:

- the original file (`source/`), the app's dataset (`mobile/assets/word-meanings/ghareeb.json`) and the detailed
  validation output (`output/`) are **git-ignored** (the repository is public) and restored locally by `import.mjs`;
- the dataset is bundled **in development builds only** (`mobile/src/wordMeanings/bundledDataset.ts`: `if (__DEV__)`),
  so release builds and OTA updates neither contain nor show the feature. Verified 2026-10-24 on local production
  exports (Android and iOS, Hermes bytecode and plain JS; not published): 0 of the 10,085 distinct explanations, no
  source URL, hash or file name, and no asset; the same search found 10,021 of them in a development export (the
  control). The feature's own code ships, unreachable;
- tracked files hold no King Fahd text: the lock, the reference corrections (word hashes only), the tests (synthetic
  text) and the validation report (counts and references).

Shipping it means: the owner confirms the terms (and the attribution wording the Complex wants), then changes
`bundledWordMeanings()` to bundle the data in release builds, and decides how release builds obtain the file (it is
not in Git).

## Commands (from the repository root)

```
node tools/word-meanings/import.mjs            # restore the source and (re)build the dataset; fails on any problem
node tools/word-meanings/import.mjs --soft     # never fails; with no dataset yet, writes an "unavailable" one
node tools/word-meanings/import.mjs --verify   # a fresh build must be byte-identical to the dataset on disk
node tools/word-meanings/validate.mjs --date YYYY-MM-DD   # the validation report (docs/word-meanings/)
```

**A fresh clone must run `import.mjs` once before starting Metro** for a development build: the development bundle
requires the dataset file. The npm hooks were deliberately left unchanged (`mobile/tests/mushafFontRestore.test.ts`
pins them); wiring `--soft` into `prestart`/`pretest` is a follow-up for the owner. In CI the dataset is absent, so the
tests on the real data report as skipped; the parsing rules and the feature itself are tested on synthetic data.

## How the source is read (`ghareeb-docx.mjs`)

Surveyed on the pinned file, and enforced: anything else stops the import rather than being guessed at.

- 5,325 paragraphs: 114 Surah headings («سورة …», in Mushaf order, checked against Tanzil's names), 5,089 ayah
  paragraphs «(n) ﴿word﴾: explanation. ﴿word﴾: explanation.», 8 continuations, 114 empty.
- **Entries**: each ornate-bracketed word or phrase that begins a paragraph or a line, or follows the end of the
  previous explanation; its explanation runs to the next entry. 11,384 entries. 14 have no colon after the word
  («﴿…﴾ أي: …»), parsed the same way.
- **Quotations inside an explanation** (7): a bracketed Quranic text after a colon («قوله تعالى: ﴿…﴾ [الأنفال: 30]»,
  «مُعْتَرِضٌ بَيْنَ: ﴿…﴾ ومَفْعُولِهِ: ﴿…﴾», «وقيل: ﴿…﴾») is part of that explanation, never an entry.
- **Pairs of ayahs** explained together (2): «(1، 2)» (42:1–2) and «(20،19)» (53:19–20), one entry each with its range.
- **Continuations** (8): a paragraph without an ayah number finishes the previous ayah's last explanation (Word split
  it); joined at the source's own trailing space, else with one space.
- **Line breaks** (6,283): each only ever between two entries of one ayah (checked).
- Words and explanations are kept exactly as written (King Fahd's Uthmani encoding), trimmed at their ends only.

## Pages

The file has no page numbers, so each entry is placed on the page of its ayah in **the reader's own page table**
(`mobile/src/mushaf/generated/pageStarts.ts`), never another edition's pagination. `validate.mjs` and the tests check
every entry against Quran Foundation's QCF V1 (1405) word records, the edition the reader draws (local snapshot in
`backend/data/mushaf-sync/`): all 11,384 agree, and no ayah of the 6,236 is split across two pages, so an ayah's
words are always on one page. Every one of the 604 pages has entries (5 to 52, median 18).

## Reference corrections (`reference-corrections.json`)

Where the source lists a word under an ayah that does not contain it, a reviewed correction changes only the ayah
shown (never the word or explanation). Each names the Surah, the listed ayah and the SHA-256 of the word, and must
match exactly one entry or the import stops. One today, **approved by the owner on 2026-10-24**: the phrase listed at
the end of 30:49 is in 30:50 (both on page 409). The original file is never changed.

## English

The source is Arabic only. No English translation of this book was found, and no English Quranic vocabulary source
has been verified or approved; meanings are never machine-translated or generated. The app shows the Arabic meanings
with English interface labels and says English meanings are not available yet; `WordMeaning.explanationEnglish` is
reserved for an approved source. (Word-by-word English glosses exist elsewhere, e.g. the Quranic Arabic Corpus, under
their own terms; they are a different work, not translations of this one.)
