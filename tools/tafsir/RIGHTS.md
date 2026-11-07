# Tafsir editions: sources and redistribution rights

An edition becomes available in the app only when **both** its exact digital source is pinned (checked against the
publisher's own checksums, or our SHA-256 of a download made directly from the distributor) **and** its redistribution rights are verified here, with the evidence. "Verified" means
written terms or a written permission that cover what the app does: carrying the text inside the app binary
(التفسير الميسر), or serving it from our backend as a download (the other three). An invitation to "use in
applications", silence, or a public API is not enough. Until then `editions.json` keeps `rights.status` at
`unverified` and build.mjs writes the edition as **blocked**.

Research dates: King Fahd Complex and the other three editions, **2026-11-06**; QuranEnc.com, **2026-11-07**.

| Edition | Exact source | Rights | Status |
|---|---|---|---|
| التفسير الميسر | QuranEnc.com `arabic_moyassar` v1.0.0, SQLite zip pinned (below) | QuranEnc's published re-publication terms; one point awaits written confirmation | **Ready** (bundled) |
| تفسير السعدي | none verified | No digital edition with redistribution terms found | **Blocked** |
| تفسير الجلالين | none verified | Digital editions non-commercial only or prohibited | **Blocked** |
| في ظلال القرآن | none found | No licensed Arabic ayah-keyed digital text | **Blocked** |

## muyassar

«التفسير الميسر» is the full ayah commentary prepared by a group of scholars (نخبة من العلماء) and published by the
King Fahd Glorious Qur'an Printing Complex. It is a different work from «الميسر في غريب القرآن الكريم», which powers
the Meanings feature (tools/word-meanings/).

### The edition the app uses: QuranEnc.com `arabic_moyassar`

| | |
|---|---|
| Edition page | https://quranenc.com/ar/browse/arabic_moyassar (English: https://quranenc.com/en/browse/arabic_moyassar) |
| API key and version | `arabic_moyassar`, version **1.0.0**, `last_update` 1487106000 (2017-02-14 21:00 UTC), from `GET https://quranenc.com/api/v1/translations/updates?key=arabic_moyassar` (also in `/translations/versions/0`). Not listed in `/translations/list`, which has no Arabic entries. |
| Artifact | `https://quranenc.com/downloads/sqlite/arabic_moyassar.zip`: 812,274 bytes, SHA-256 `96182831395a03e7497a8f398a960d45fcf90397dd72760ac35d735752a18046`. HTTP ETag `"67e2bd39-c64f2"`. |
| Inside the zip | `arabic_moyassar.sqlite`: 2,686,976 bytes, SHA-256 `eb384e586487b089b826375d3f705d07e775e0019325da405e0337a9f6b3da04`. It is identical to the uncompressed download `…/arabic_moyassar.sqlite` (Last-Modified Tue, 25 Mar 2025 14:27:05 GMT). One table, `translations(id, sura, aya, translation, footnotes)`, with 6,236 rows. |
| Retrieved | 2026-11-07 02:25 UTC, directly from QuranEnc.com. build.mjs re-downloads it and checks both pins. |

This is a **separate digital edition** from King Fahd's developer package v3.0 (below). The texts differ in places;
for example 1:1 has «مستعينا» here and «مستعيناً» in the v3 package. Nothing from the v3 package is used.

**Validation** (build.mjs, adapters/quranenc-sqlite.mjs, mobile/tests/tafsirTools.test.ts):
- All 6,236 rows are present, in Mushaf order, one per ayah.
- Each row's `id`, `sura` and `aya` match Tanzil's counts.
- No text is empty or has surrounding spaces, markup or footnotes.
- The `/translation/sura` API returned the same text, byte for byte, for Surahs 1, 2, 28, 68 and 114.
- The app file was expanded back to ayahs and compared with the SQLite file: all 6,236 texts are byte-identical.

**How passages are kept.** The source gives commentary on several ayahs together by repeating the identical text on
each of those ayahs. A run of consecutive ayahs in one Surah with byte-identical text is stored once with its range.
That gives 494 passages and 5,278 entries in all. The text is never changed.
- **28:33–34:** identical text on both ayahs («قال موسى: ربِّ إني قتلت…»), so one passage, 33–34. This agrees with
  the v3 package's «[33، 34]» label.
- **68:21–22:** identical text on both ayahs («فنادى بعضهم بعضًا وقت الصباح: أن اذهبوا مبكرين…»), so one passage,
  21–22. This edition joins them. In the v3 package, 68:21 had its own commentary and 68:22 carried the label
  «[21، 22]». The 68:19–20 pair is also one passage here.
- **Repeats that are not adjacent stay separate.** Nine texts recur on non-adjacent ayahs, and each stays on its own
  ayah exactly as the source has it:
  - the commentary for 30:1, 31:1 and 32:1, and another for 40:1, 41:1, 43:1, 44:1, 45:1 and 46:1;
  - the refrain commentary in Surah ar-Rahman (55:18, 55:21, …);
  - 80:39–40 / 80:42, 83:2–4 / 83:6, 87:10 / 87:12–13, 92:9 / 92:11, 94:2 / 94:4;
  - 96:10–12 / 96:14–19, where 96:13 has its own text, so the passage appears twice.

**Terms.** QuranEnc.com publishes "Terms and Policies" at the foot of every edition page, this one included (read
2026-11-07, English and Arabic):

> Contents of the translations can be downloaded and re-published, with the following terms and conditions:
> 1. No modification, addition, or deletion of the content.
> 2. Clearly referring to the publisher and the source (QuranEnc.com).
> 3. Mentioning the version number when re-publishing the translation.
> 4. Keeping the transcript information inside the document.
> 5. Notifying the source (QuranEnc.com) of any note on the translation.
> 6. Updating the translation according to the latest version issued from the source (QuranEnc.com).
> 7. Inappropriate advertisements must not be included when displaying translations of the meanings of the Noble Quran.

> «يتاح تنزيل محتوى الترجمات وإعادة نشره، بالشروط والضوابط التالية: 1. عدم التعديل أو الإضافة أو الحذف على المحتوى.
> 2. الإشارة بوضوح للناشر وللمصدر (QuranEnc.com). 3. ذكر رقم الإصدار عند إعادة نشر الترجمة. 4. إبقاء معلومات نسخة
> الترجمة الموجودة داخل المستند. 5. إفادة المصدر (QuranEnc.com) بأي ملاحظة على الترجمة. 6. تطوير الترجمات وفق النسخ
> الجديدة الصادرة من المصدر (QuranEnc.com). 7. عدم تضمين إعلانات لا تليق بترجمات معاني القرآن الكريم عند العرض.»

The API's own guidance (https://quranenc.com/llms.txt) adds: "When quoting one, name the translation (its `title`) and
keep the text unaltered." No authentication is required.

**How the app meets each condition:**
1. **No modification, addition or deletion.** The text is byte-identical. The only presentational choice is that
   commentary the source repeats on consecutive ayahs is shown once under their range (see the question below).
2. **Publisher and source.** The reader's source line and Settings' Sources name «التفسير الميسر», the King Fahd
   Complex as publisher, and QuranEnc.com as source, with a link to the edition page.
3. **Version.** «الإصدار 1.0.0» / "version 1.0.0" appears in the reader's source line and in Sources.
4. **Transcript information.** The SQLite file carries none (it has no metadata table). The version, key and dates
   are kept with the app file's source record and in `editions.json`.
5. **Notes.** Send any error found in the text to QuranEnc. Their API has `POST /translations/note`; no automatic
   submission.
6. **Updating.** Run `node tools/tafsir/build.mjs --check-upstream` before every release. It fails if QuranEnc's
   version or `last_update` differ from the pin. A newer version means re-pin, rebuild, review the passage report,
   and ship an app update: the text is bundled, so only a new app build delivers it.
7. **Advertisements.** The app shows none.

**Open question for written confirmation** (send to QuranEnc via https://quranenc.com, Contact Us):

> Do the Terms and Policies shown on https://quranenc.com/ar/browse/arabic_moyassar cover the Arabic text of «التفسير
> الميسر» (API key `arabic_moyassar`, version 1.0.0) for bundling inside a free iOS and Android app (Quran Heals) for
> offline reading, given that the work is published by the King Fahd Complex? And is it consistent with condition 1
> ("no modification, addition, or deletion") that, where your database repeats one commentary verbatim on consecutive
> ayahs (e.g. 28:33–34, 68:21–22), the app shows that commentary once, under the range of those ayahs, with each ayah
> listed?

QuranEnc publishes the terms on this exact edition's page, and the app meets every condition, so the edition is
treated as cleared (`rights.status: "verified"`). The question above is the remaining uncertainty. QuranEnc names no
publisher in this edition's metadata; the King Fahd Complex credit comes from the work itself.

**Owner's decision (Hamza, 2026-11-07).** The owner approved shipping QuranEnc's `arabic_moyassar` v1.0.0 as the
bundled offline default **without waiting for QuranEnc's written answer** to the question above. The existing
attribution, version display and checksum validation stay as they are.

This is the owner's own decision and acceptance of that risk. It is **not** a written confirmation from QuranEnc or
the King Fahd Complex, and none has been received. Keep the question open, record QuranEnc's answer here if it
arrives, and act on it.

### Not used: King Fahd Complex developer package v3.0

`https://download.qurancomplex.gov.sa/resources_dev/hafs_tafseerMouaser_v3.zip` is listed on
https://qurancomplex.gov.sa/quran-dev/ (archived copy dated 2026-01-22): version 3.0, 7.51 MB, created 15-12-2020,
last modified 01-08-2023, published checksums MD5 `5601682965e32f4dd6992c7600fdccc3` and SHA-1
`5f533113c2f54f32eded734bb49e6a5837965722`. It is kept in `editions.json` as `kfgqpcV3` for reference only.

On 2026-11-06 the site was under maintenance and the download host refused connections. A Wayback copy (captured
2025-04-17) does **not** match the published checksums (MD5 `b38703983d438a5cd22269b746eaac0c`). It was used only to
dry-run adapters/kfgqpc-mouaser.mjs outside the repository.

The platform describes its files as a service «للمطورين والباحثين ودور النشر لاستخدامها في محتوى تطبيقاتهم», with no
redistribution clause.

## saadi

«تيسير الكريم الرحمن في تفسير كلام المنان», Abd al-Rahman al-Sa'di (d. 1376 AH / 1956).

The underlying work appears to be in the public domain in Saudi Arabia: life + 50 years, according to secondary
summaries of the Copyright Law. The law text itself was not read. The digital editions found:
- Quran Foundation API (resource 91): developer terms of 2026-10-11 forbid redistribution and any prepackaged or
  build-time bundle, and allow offline copies only through Content Sync with a 7-day re-sync.
- QUL resources 24 and 308: "We don't have copyright information for this resource."
- KSU Ayat: no terms found.
- quran-tafseer.com API and GitHub datasets: the code is MIT, the text is scraped, and no data licence is given.

None names its print edition. **Blocked.** To unblock, get a written licence for one digital edition, or digitise a
named public-domain print edition ourselves.

## jalalayn

al-Mahalli and al-Suyuti (15th century); the underlying work is in the public domain. The digital editions found:
- Tanzil `ar.jalalayn`: "for non-commercial purposes only … Redistributing … in another website is not allowed".
- altafsir.com (Royal Aal al-Bayt Institute): copying and redistribution are prohibited without prior written
  permission.
- QUL 523: no copyright information.

**Blocked**, for the same reasons as saadi.

## zilal

Sayyid Qutb (d. 1966); main print publisher Dar al-Shuruq, Cairo. The work is likely in the public domain in Egypt
since about 2016 (life + 50 years, Law 82/2002, per secondary sources). US protection may still apply under the URAA;
that needs legal advice.

No Arabic ayah-keyed digital edition was found in the Quran Foundation API, QUL, Tanzil, KSU, QuranEnc or the GitHub
datasets. QUL 28 and Quran Foundation 157 are an Urdu translation. altafsir.com has the Arabic text, under prohibitive
terms. No published rights statement or licensed digital edition exists. **Blocked.**

The reader already supports this edition's passage-level commentary (one entry covering several ayahs, shown once with
its range). An adapter must take the ranges from the source and never invent splits.
