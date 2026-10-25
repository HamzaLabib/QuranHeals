# Surah Preview (عن السورة) — permissions record

What each source's own terms say, what the owner has approved, and what is still needed from the publishers. Surah
Preview's data is bundled in **every build, release included, since 2026-10-24**, by the owner's decision below — while
the "before production" publisher items in this record are still **not on file**.

## Owner decision: production enabled without the publishers' permissions (2026-10-24)

The owner explicitly authorized enabling Surah Preview (and Meanings) in production builds **despite the unresolved
publisher-permission records**. This is the owner's decision and acceptance of that risk, **not** a publisher's
authorization: none of the permissions below has been obtained, and items 1, 2 and 4 of the checklist stay open.
Details and the packaging (`.easignore`): [../../docs/content-datasets-release.md](../../docs/content-datasets-release.md).

## Owner approval (2026-10-24)

The owner wrote: «Permission has been approved from my side. Proceed with finalizing the Surah Preview Topics
implementation.» and «Do not treat my approval as proof of third-party redistribution rights. Record the actual
publisher authorization or licence before enabling the content in production.»

This approval covers development and review. It is **not** a third-party authorisation.

## Owner editorial approval of the Arabic texts (2026-10-24)

The owner wrote: «I officially approve the existing Arabic Surah Preview content for all 114 surahs: مقصد السورة — Main
Purpose; موضوعاتها — Topics. I accept the current wording from the identified scholarly sources. Any corrections or
improvements can be made in the future.»

Recorded in [owner-approval.json](owner-approval.json): 114 Surahs, each bound by SHA-256 to the exact Arabic purpose
and topics shipped (`validate.mjs` check 9 fails if a text changes, until the owner approves the new wording). It is the
owner's **editorial** approval only:
- not an independent scholarly review — the topics' status stays `pending-review`, no review decision was recorded, and
  the documented issues (Surahs 1, 18, 21, 22, 42, 44; `topics-review.json`) stay open for future correction;
- not a publisher's permission — the items below are still needed;
- not English (none exists) and not the 16 proposed shortened lists (not applied).

## Per source

| Source | Used for | Its terms (verbatim / summary, with link) | Status |
|---|---|---|---|
| «المختصر في التفسير», مركز تفسير للدراسات القرآنية, via QuranEnc.com | مقصد السورة, 114 | Printed book: «جميع حقوق الطبع محفوظة لمركز تفسير للدراسات القرآنية». QuranEnc: translations may be re-published unchanged, credited (publisher and QuranEnc.com), with the version, kept up to date (https://quranenc.com/en/home/about) — whether this covers the Arabic tafsir's objective lines inside an app is unconfirmed. | **Before production:** written permission from the Tafsir Center (info@tafsir.net, almokhtasar@tafsir.net). Not on file. |
| Quranpedia.net, «معلومات سور القرآن» (`topics`), official dump `surahs.json.gz` version 2026-10-24 (sha256 in `quranpedia.lock.json`) | موضوعاتها, 112 | LICENSE.md in the dump: «Free to use inside apps, websites, bots, and research tools — no attribution required»; republishing as a downloadable database requires credit with link and version; «Translations and contemporary works remain the intellectual property of their respective authors and publishers»; keep copies current via the changes endpoint. | Quranpedia's own terms: satisfied (in-app use; credited anyway on Sources). |
| «التفسير الموضوعي لسور القرآن الكريم», نخبة من علماء التفسير وعلوم القرآن, جامعة الشارقة, 1431هـ/2010م (Quranpedia book 14571; cited by Quranpedia with volume/page per Surah, `topics-review.json`) | The 110 topic outlines Quranpedia cites from it | A contemporary work: under Quranpedia's own licence it remains its publisher's property. No published licence found. | **Before production:** permission from the University of Sharjah (the publisher). Not on file. |
| «بصائر ذوي التمييز في لطائف الكتاب العزيز», الفيروزآبادي (ت 817هـ), ed. Muhammad Ali al-Najjar; Quranpedia book 186 contents file (sha256 in `quranpedia.lock.json`) | موضوعاتها for Surahs 42 and 44 (one sentence each, verbatim) | A classical work (8th century AH): heritage text, «no one claims ownership» (Quranpedia LICENSE.md, "Ownership"). Only al-Fairuzabadi's sentence is used, not the editor's apparatus. | No permission needed for the text; credit kept. Confirm on review that no editorial insertion of the edition is in the sentence. |
| Tanzil `quran-data.xml` | Makki/Madani, ayah count | Creative Commons Attribution 3.0 (credited on Sources). | Satisfied. |

## Before production — checklist

1. Tafsir Center's written permission (المختصر, main purposes) — record the document here.
2. University of Sharjah's permission («التفسير الموضوعي لسور القرآن الكريم», 110 topic outlines) — record the document here.
3. Editorial approval: **on file** (owner, 2026-10-24, all 114 Arabic entries, `owner-approval.json`). Independent
   scholarly review (review dashboard → `reviewed-content.json`, status `approved`): not done; whether it is required
   before production is the owner's decision.
4. Quranpedia: refresh the dump (`--update-lock` after review) so the shipped text is current, as its licence asks.
5. ~~Only then: allow release builds in `bundledDataset.ts`.~~ Done on 2026-10-24 **before** items 1, 2 and 4, by the
   owner's decision above. Record each permission here when it arrives.
