# Muhammad Rifaat: recovery and alternative sources (Phase 4.5, 2026-10-18)

## Scope and result

**Scope:**
- All 31 MP3Quran Rifaat recordings, each investigated on its own:
  - the 10 that failed in Phase 4.2 (54, 73, 75, 76, 79, 81, 85, 89, 96, 98);
  - the 21 excluded since Phase 3.1 (1, 10, 11, 12, 17, 18, 19, 20, 48, 55, 56, 69, 72, 77, 78, 82, 83, 86, 87, 88, 100).
- Nothing was enabled, approved, staged or committed.
- No catalogue, timing or package was changed.
- No audio was modified, uploaded or redistributed.

**Result in one paragraph:**
- **13 recordings are excerpts, not whole surahs.** The cause is confirmed: the surviving Rifaat archive has no complete recording of these surahs. They need a replacement, and none is known.
- **The other 18 recite the expected surah, in order.** This is the first positive automated evidence on Rifaat. It comes from a teacher-forced Whisper check, calibrated against wrong-text controls (Method 4).
- **None of the 31 passes the automated alignment checks,** so no review package was generated.
- **Recovery for the 18** is a human-assisted timing worklist. For each ayah start it gives the time bracket that the evidence allows and the pauses inside it. It places no boundary.
- **7 of the 18 contain repeated passages,** typical of a live recitation. They need a product decision before they can be timed.
- **Alternative sources:** none was found that is both permitted and different.
  - Way2Quran is a byte-identical copy of MP3Quran, and restricted.
  - archive.org holds other transfers of the same performances. These are cleaner, but have unknown rights, and they also fail the aligner.

## Totals

| Count | Recordings |
|---|---|
| Investigated | 31 |
| Same source as before (MP3Quran `muhammad-refaat/r1`, 128 kbps CBR) | 31 |
| Distinct alternative recordings found | 0. Way2Quran's 31 are byte-identical copies (not counted). archive.org has other *transfers* of the same performances (the same recordings, not new ones). |
| Root cause confirmed: excerpt, not the whole surah | 13 (10, 11, 12, 17, 18, 19, 20, 48, 54, 56, 69, 77, 81) |
| Content confirmed in order; aligner failure acoustic, mechanism unresolved | 18 |
| … of which have no repeated passages | 8 (55, 72, 73, 75, 76, 78, 79, 98) |
| … of which contain repeated passages | 7 (1, 83, 87, 88, 89, 96, 100) |
| … of which have weak evidence (content to confirm by ear) | 3 (82, 85, 86) |
| Repaired automatically | 0 |
| Passing automated alignment checks | 0 |
| Review packages generated | 0 |
| Human-assisted timing worklists prepared | 18 (497 ayah starts) |
| Requiring replacement | 13 (no complete recording is known to survive) |
| Rights confirmed permitted, per recording | 0 |

## Method

**1. Inventory and duplicates (identity, riwaya, source):**
- MP3Quran lists one Rifaat moshaf (241, «حفص عن عاصم - مرتل») with 31 surahs.
- Way2Quran (`media.way2quran.com/mohamed-refaat/hafs-an-asim/`) lists 39 surahs. They are the same files:
  - 4 files compared by SHA-256 (001, 086, 098, 100) are identical;
  - all 31 have identical content lengths.
- They are one recording set, not two.

**2. The collector's catalogue.** archive.org item
[`way2llh22_20180630_1733`](https://archive.org/details/way2llh22_20180630_1733), «المكتبة الشاملة لتراث الشيخ محمد رفعت»:
- It is a fan-made collection: 122 files, no licence.
- Its titles give surah, ayah range and source transfer:
  - «نسخة صوت القاهرة» = Sono Cairo;
  - «نسخة الإذاعة» / «إذاعة القرآن الكريم» = Egyptian radio;
  - «نسخة شخصية» = private;
  - «مبتورة» = cut short;
  - «جزء من تلاوة» = fragment.
- The 66 files relevant to the 31 surahs were downloaded to scratch for comparison only. The titles are kept in `audit-data/rifaat-phase-4-5-2026-10-18/collection-titles-way2llh22.txt`.
- The catalogue reflects what is generally reported: Rifaat's surviving recordings are radio and private recordings of 1930s–40s recitations, mostly ayah ranges.

**3. Fingerprint provenance** (`audit/rifaat/mapfiles.py`, `segments.py`):
- 20 s pieces of each MP3Quran file are located in those labelled recordings.
- A segment is three or more consecutive strong matches (≥ 0.8) at a consistent position, allowing tape-speed drift of up to 6 %.
- **Result:** 17 files have segments.
- **Limits:**
  - short or heavily processed files often match too weakly;
  - Ar-Raḥmān's refrain matches itself everywhere;
  - a missing segment is therefore *not* evidence of a different performance.

**4. Teacher-forced content check** (`audit/rifaat/tf_verify.py`). This is the new method in this phase.
- **Why a new method:**
  - Free transcription (Whisper large-v3-turbo, MIT) hallucinates on Rifaat's long melismas, producing «موسيقى» and «اشتركوا في القناة».
  - The MMS aligner scores at the wrong-text level.
- **How it works:**
  - Instead of asking what is said, it asks how much more likely the expected ayahs are than a control surah's ayahs, given this 30 s of audio.
  - Scores are made relative to the same reciter reciting other surahs, so a text's general likelihood cancels out.
  - Nothing is decoded freely, so nothing is hallucinated.
- **Calibration:**

  | Run | Windows | Margin (expected − control) |
  |---|---|---|
  | Clean positive control (Banna 98) | 12 | 1.5–3.5, every window in order |
  | Rifaat audio scored as the **wrong** surah (98 as 97, 100 as 101, 73 as 71, 85 as 84) | 101 | median −0.01, 95th percentile 0.28, max 0.45; **0 % ≥ 0.5** |
  | Rifaat audio scored as the expected surah (18 files) | 741 | median 0.80; **63 % ≥ 0.5** |

  - A window is **confirmed** at margin ≥ 0.5.
  - **Limits:**
    - The evidence is window-level: it shows which ayahs a stretch holds, not where boundaries are.
    - Identical or near-identical ayahs cannot be distinguished. Examples are Ar-Raḥmān's refrain (31 occurrences) and Al-Qiyāmah 12 and 30.
    - Rifaat 98 was run with a 10 s hop and spans of up to 3 ayahs; the others used a 20 s hop and spans of up to 2.

**5. Alternative transfers through the aligner.** Same performance, different transfer:

| Surah | Transfer | Digital silence | 2–3 kHz re 300–1000 Hz | MMS median score (needs ≥ 0.3) |
|---|---|---|---|---|
| 85 | MP3Quran | 38 % (24 runs) | −26 dB | 0.132 |
| 85 | Sono Cairo transfer (inside the 54-1 recording) | 19 % | −9 dB | 0.141 |
| 73 | MP3Quran | 38 % (28 runs) | −15 dB | 0.206 |
| 73 | Sono Cairo transfer (inside the 72-1 recording) | 0 % | −13 dB | 0.264 |
| 73 | Separate collection file 73-1 | 1 % | −24 dB | 0.224 |

- The Sono Cairo transfers have no restoration gating and far more treble, yet all three stay below 0.3.
- **The MP3Quran restoration is therefore not the cause.** This agrees with Phase 4.2, which rejected bandwidth, gating, pitch and window size.
- The aligner's failure on Rifaat remains **unresolved** as to mechanism. The recordings themselves (1930s–40s broadcast audio) and his style are the remaining explanation, which is a hypothesis.

**6. Timing worklists** (`audit/rifaat/worklist.py`):
- For each ayah start, the worklist gives the bracket from the last confirmed window holding only earlier ayahs to the end of the first confirmed window holding that ayah. When one window holds both ayahs, the bracket narrows to that window.
- Inside each bracket it lists the pauses: digital silence ≥ 200 ms, and dips ≥ 300 ms that are 30 dB below the median level.
- It places **no** boundary. A pause is only a place for the listener to check, never a timestamp.
- **CONFLICT** marks a start that the evidence places in two places (a repetition or the refrain).
- **Unbracketed** marks a start with no confirmed window on one side.

## Common to all 31 records

| Field | Common facts |
|---|---|
| **Original source** | MP3Quran `https://cdn.mp3quran.net/audio/muhammad-refaat/r1/<NNN>.mp3`, 128 kbps CBR 44.1 kHz, moshaf 241 «حفص عن عاصم - مرتل». |
| **Identity and riwaya** | Attributed to Sheikh Muhammad Rifaat by MP3Quran, Way2Quran and the collector's catalogue. The fingerprint ties 17 files to catalogue recordings labelled with his name. His voice was not independently verified against an authenticated reference; none is available. **Riwaya:** Hafs (labelled), and the teacher-forced check confirms Hafs text for the 18. The check cannot separate fine riwaya differences. **Style:** «مرتل» is MP3Quran's label, but these are radio and live recitations; some have audiences, as the catalogue says («مع الجمهور»). |
| **Alternative sources** | Way2Quran: byte-identical, so a duplicate. archive.org: the collection above; `Muhammad_Refat` / `MuhammadRefatVbrMp3` (el-moslem, 86 tape files); `Mohammed_Refat_uP_bY_mUSLEm` (243); about 364 items in all, all fan uploads without a licence. Assabile: no Rifaat collection found in a web search. The official holders are Egyptian radio (National Media Authority / Maspero) and Sono Cairo. Maspero reported restoring rare Rifaat recordings in March 2024 ([maspero.eg](https://www.maspero.eg/art-and-culture/2024/03/07/762699/الإنتاج-الإعلامي-تنتهي-من-ترميم-تسجيلات-نادرة-للقرآن-الكريم-للشيخ-محمد-رفعت)), and the family gave 1934 recordings to the National Media Authority ([egypttelegraph](https://www.egypttelegraph.com/article/117431/%D8%AA%D8%B0%D8%A7%D8%B9-%D9%81%D9%8A-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-%D8%AD%D9%81%D9%8A%D8%AF%D8%A9-%D8%A7%D9%84%D8%B4%D9%8A%D8%AE-%D9%85%D8%AD%D9%85%D8%AF-%D8%B1%D9%81%D8%B9%D8%AA)). No public download or licence from them was found. |
| **Usage rights** | **MP3Quran:** unknown per recording. Streaming is under MP3Quran's site-wide grant, as for every MP3Quran reciter; the underlying rights are probably Egyptian radio's or Sono Cairo's. **Way2Quran:** restricted ("copyright reserved") and a duplicate. **archive.org transfers:** unknown, so permission is required. **Egyptian radio / Sono Cairo:** permission required. None is confirmed permitted beyond the existing MP3Quran streaming arrangement. |
| **Automated alignment** | Fails for all 31: the MMS median score is 0.07–0.24 against the 0.3 needed, the wrong-text level. Phase 3.1 and 4.2 figures stand; nothing was re-aligned with looser settings. |
| **Listening review** | **Not ready** for any recording. No package was generated, since none passes the automated checks. |

## The 31 records

The fields listed in the common section are not repeated unless a record differs.

**Abbreviations:**
- **TF** = teacher-forced check at margin 0.5.
- **FP** = fingerprint provenance.
- **Phase 3.1 score** = the MMS completeness median.

### Excerpts (13): root cause confirmed, replacement required

**10 Yūnus (يونس), 82:46**
- **Original failure:** Phase 3.1 score 0.122. The length is 0.66× the length predicted for the whole surah at his pace.
- **Root cause, confirmed:** the file is excerpts.
  - Catalogue: only 18–27 / 18–31 and 53–64 then 67–72 survive.
  - FP: five segments from those two recordings (16:00–20:20, 30:40–39:40 and 59:20–81:00).
  - Free Whisper: 4–62.
- **Audio comparison:** MP3Quran matches the «نسخة اصلية» 18–31 and the 53–72 recordings.
- **Recovery:** none possible; there is no whole surah to time.
- **Next action:** replacement required; none is known to survive. Alternatively, a product decision to support partial surahs.

**11 Hūd (هود), 68:53**
- **Original failure:** Phase 3.1 score 0.115; 0.51× predicted.
- **Root cause, confirmed:** excerpts.
  - Catalogue: 1–17; 23–28 (fragment of a lost recitation); 61–75 then 84–90; from 108 (fragment).
  - FP: 0:40–25:00 is the 1–17 recording, 31 pieces in a row.
  - Free Whisper: 1–15, 23, 61–62.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**12 Yūsuf (يوسف), 48:36**
- **Original failure:** Phase 3.1 score 0.109; 0.40× predicted.
- **Root cause, confirmed:** excerpts.
  - Catalogue: 1–27, 53–82, and 96–111 (with Ar-Raʿd 1–9).
  - Free Whisper: 3–26 and 59–82.
  - FP: no match, so this is a different transfer from the collection's. Unusually, it has only 2 % digital silence.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**17 Al-Isrāʾ (الإسراء), 41:50**
- **Original failure:** Phase 3.1 score 0.080; 0.40× predicted.
- **Root cause, confirmed:** excerpt.
  - Catalogue: 1–14 (cut), 1–19 (Ḥusayn mosque 1937), 1–22 and 9–14.
  - Free Whisper: 1–22 in order.
  - FP: the radio 1–22 recording at 32:00–35:00.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**18 Al-Kahf (الكهف), 86:08**
- **Original failure:** excluded in Phase 3.1 (text not confirmed).
- **Root cause, confirmed:** excerpts.
  - Catalogue: 1–21, 46–74 and 60–84.
  - Free Whisper: 1–21, 46–74 and 79–88.
  - FP: the 60–84 recording at 68:40–83:40.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**19 Maryam (مريم), 39:12**
- **Original failure:** Phase 3.1 score 0.126; 0.63× predicted.
- **Root cause, confirmed:** excerpts within 1–40.
  - Catalogue: 1–36, 1–24 (cut), 1–17 (London radio), 22–36 (cut) and 36–40 (fragment).
  - Free Whisper: 4–39.
  - FP: the 36–40 fragment.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**20 Ṭā-Hā (طه), 41:29**
- **Original failure:** Phase 3.1 score 0.089; 0.47× predicted.
- **Root cause, confirmed:** excerpts.
  - Catalogue: 1–52 and 83–98 only.
  - Free Whisper: 10–45 and 89.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**48 Al-Fatḥ (الفتح), 29:21**
- **Original failure:** Phase 3.1 score 0.123; 0.74× predicted.
- **Root cause, confirmed:** excerpt.
  - Catalogue: 1–11, then 17–20.
  - Free Whisper: 2–11.
  - FP: the 1–11 radio recording at 0:40–7:00, then again later in the file.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**54 Al-Qamar (القمر), 28:21 (failed in Phase 4.2)**
- **Original failure:** Phase 4.2 score 0.152; 8 of 55 ayahs recognised, with jumps.
- **Root cause, confirmed:** **a splice of two recordings.**
  - 0:40–21:00 is the Sono Cairo recording of 1–32 (26 pieces in a row).
  - 21:20–27:00 is the 37–50 fragment («مقطع من تلاوة»), 8 pieces in a row.
  - Ayahs 33–36 and 51–55 are absent. The catalogue lists no complete Al-Qamar.
- **Audio comparison:** the Sono Cairo transfer has the same content.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**56 Al-Wāqiʿah (الواقعة), 10:25**
- **Original failure:** Phase 3.1 score 0.071; 0.32× predicted.
- **Root cause, confirmed:** excerpt 1–38.
  - Catalogue: Al-Wāqiʿah survives only as 1–38, inside the Ar-Raḥmān recording 55-2.
  - FP: 0:40–7:00 is that recording's Sono Cairo transfer at 33:27.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**69 Al-Ḥāqqah (الحاقة), 11:37**
- **Original failure:** Phase 3.1 score 0.123; 0.54× predicted.
- **Root cause, confirmed:** excerpt 1–24.
  - Catalogue: only 1–24, appended to the Ar-Raḥmān recording 55-1. The catalogue notes the radio broadcast it with that Ar-Raḥmān.
  - Free Whisper: ayahs 1 and 24 (24 at the end).
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**77 Al-Mursalāt (المرسلات), 6:13**
- **Original failure:** Phase 3.1 score 0.102; 0.39× predicted.
- **Root cause, confirmed (documentary):** excerpt 1–23.
  - Catalogue: only 1–23, the end of the 75-1 recording (with Al-Qiyāmah and Al-Insān).
  - Length agrees: 6:13 for 50 ayahs.
  - There is no ASR or FP evidence (both weak on this file).
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

**81 At-Takwīr (التكوير), 7:28 (failed in Phase 4.2)**
- **Original failure:** Phase 4.2 score 0.116; 0 of 29 ayahs recognised.
- **Root cause, confirmed (documentary):** excerpt 1–21.
  - Catalogue: only 1–21, the end of the 78 recording («النبأ والنازعات والتكوير من 1 إلى 21»).
  - Length agrees: 448 s at about 21 s per ayah. The Phase 4.2 explanation (unreadable audio) still applies on top of this.
- **Recovery:** none.
- **Next action:** replacement required (none known), or partial-surah support.

### Content confirmed, in order: human-assisted timing worklist (18)

For all of these:
- **Root cause of the original failure:** the content is the expected surah, so the "text not confirmed" result was the aligner's failure, not wrong content. The aligner's failure is acoustic, with its mechanism unresolved (Method 5).
- **Recovery method:** a timing worklist (`audit-data/rifaat-phase-4-5-2026-10-18/worklists/rifaat_<s>.json`).
- **Listening review:** not ready. Package generation requires automated alignment, which fails, and the reviewer cannot yet take boundaries placed from scratch.

#### In order, no repeated passages (8)

**98 Al-Bayyinah (البينة), 5:57 (failed in Phase 4.2)**
- **TF:** **all 8 ayahs confirmed, in order**, 16 of 35 windows, no backward steps.
- **Audio comparison:** from the Sono Cairo multi-surah recording 96-1 (catalogue). FP is too weak for segments.
- **Worklist:** 7 of 8 starts bracketed (median 50 s); 4 brackets hold a single pause.
- **Next action:** time the 8 starts by ear from the worklist. This is the best candidate.

**72 Al-Jinn (الجن), 26:38**
- **Original failure:** Phase 3.1 score 0.216.
- **TF:** 27 of 28 ayahs confirmed (17 not); in order, apart from one replay of 19–22 at about 20:00.
- **FP:** the Sono Cairo «الجن والمزمل» recording (8:00–24:20, three segments).
- **Worklist:** 23 bracketed (16 with a single pause), 4 conflicts from the replay, 1 unbracketed.
- **Next action:** listen; decide whether 19–22 is a repeat; then time.

**73 Al-Muzzammil (المزمل), 15:03 (failed in Phase 4.2)**
- **TF:** ayahs 3–19 confirmed in order (1, 2 and 20 not), with no backward steps.
- **FP:** the same Sono Cairo recording, Muzzammil part (5:20–13:40 = 33:12–41:32 there).
- **Alternative transfers:** also fail MMS (0.264 and 0.224; Method 5).
- **Worklist:** 15 bracketed (12 with a single pause), 1 conflict, 4 unbracketed.
- **Next action:** listen; confirm ayahs 1–2 and 20; time.

**78 An-Nabaʾ (النبأ), 21:18**
- **Original failure:** Phase 3.1 score 0.232.
- **TF:** 36 of 40 confirmed, monotone, but 37–39 occupy about 8 minutes (11:20–19:40): either extended repetition or audio that is not An-Nabaʾ.
- **FP:** the «النبأ والنازعات والتكوير» recording (0:40–9:00).
- **Worklist:** 38 bracketed (21 with a single pause).
- **Next action:** listen to 11:00–20:00 first, then time.

**79 An-Nāziʿāt (النازعات), 13:56 (failed in Phase 4.2)**
- **TF:** 27 of 46 confirmed, monotone. 26–36 and 43–46 are mostly unconfirmed.
- **Worklist:** 40 bracketed (14 with a single pause), 6 unbracketed.
- **Next action:** listen end to end; check the unconfirmed stretches are present; time.

**76 Al-Insān (الإنسان), 23:22 (failed in Phase 4.2)**
- **TF:** 26 of 31 confirmed; small returns to 9 and 17.
- **FP:** the radio 76-1 recording (three segments, 0:00–15:40).
- **Worklist:** 28 bracketed (12 with a single pause), 2 conflicts.
- **Next action:** listen; check the two returns; time.

**75 Al-Qiyāmah (القيامة), 13:35 (failed in Phase 4.2)**
- **TF:** 33 of 40 confirmed, otherwise in order.
- **Why the backward steps are not reorders:** the jump to 30 at 2:40 is ayah 12's near-twin («…ٱلْمُسْتَقَرُّ» / «…ٱلْمَسَاقُ»). The returns to 36–38 near the end are a repeat or the same kind of confusion.
- **FP:** the Sono Cairo 75-1 recording (0:00–5:00).
- **Worklist:** 20 bracketed (13 with a single pause), 19 conflicts.
- **Next action:** listen; resolve the 36–38 passage; time.

**55 Ar-Raḥmān (الرحمن), 29:06**
- **Original failure:** excluded in Phase 3.1.
- **TF:** the non-refrain ayahs advance 3 → 78 in order; 8 non-refrain ayahs are unconfirmed (1, 2, 7, 8, 27, 50, 68, 72).
- **Refrain:** «فَبِأَيِّ آلَآءِ رَبِّكُمَا تُكَذِّبَانِ» occurs 31 times. Its occurrences cannot be told apart by any recogniser, so they show as backward steps.
- **FP:** the 55-3 («التلاوة الثالثة») radio transfer (3:20–7:40 and 12:40–24:20). The catalogue lists four different Ar-Raḥmān recitations.
- **Worklist:** 14 bracketed, 61 conflicts (the refrain occurrences and their neighbours), 3 unbracketed.
- **Next action:** listen; number the refrain occurrences by order; time. This is the heaviest of the eight.

#### In order, with repeated passages (7): product decision first

The app's timing model has **one start per ayah**. In a recitation that recites a passage twice, an ayah has two starts. Before timing, the owner must decide one of:
- time the first occurrence and let playback include the repeat;
- treat the repeat as part of the previous ayah;
- exclude these recordings.

**1 Al-Fātiḥah (الفاتحة), 3:39**
- **Original failure:** Phase 3.1 score 0.158; 40.5 s after the last ayah.
- **TF:** 6 of 7 confirmed (3 not), with strong margins of 0.8–2.2. **Ayahs 6–7 recur from 1:00 to 3:20** (6-7, 6, 7, 6-7, 6, 6-7, 7).
- **Audio comparison:** the catalogue's Sono Cairo «فاتحة الكتاب».
- **Worklist:** 6 bracketed (2 with a single pause).
- **Next action:** a product decision on repeats; then listen and time.

**83 Al-Muṭaffifīn (المطففين), 19:56**
- **Original failure:** Phase 3.1 score 0.161.
- **TF:** 32 of 36 confirmed. **Repeats:** 2–5, 18–21 and 22–28 are each recited twice, and 23 recurs near the end.
- **FP:** the radio «الانفطار المطففين الانشقاق والبروج» recording (0:40–19:40 = 11:27–30:54 there).
- **Worklist:** 18 bracketed, 16 conflicts.
- **Next action:** a product decision; then listen and time.

**87 Al-Aʿlā (الأعلى), 10:36**
- **Original failure:** Phase 3.1 score 0.185; 54.4 s before ayah 1.
- **TF:** 13 of 19 confirmed. **2–5 is recited three times (0:40–5:40)**, then 7–17 in order; 18–19 are unconfirmed.
- **Worklist:** 12 bracketed, 3 conflicts, 4 unbracketed.
- **Next action:** a product decision; then listen and time.

**88 Al-Ghāshiyah (الغاشية), 15:08**
- **Original failure:** Phase 3.1 score 0.187; 95.7 s before ayah 1.
- **TF:** 19 of 26 confirmed. **Repeats:** 1–5 twice, 8–11 three times, and 17–20 three times.
- **Worklist:** 16 bracketed, 9 conflicts.
- **Next action:** a product decision; then listen and time.

**89 Al-Fajr (الفجر), 12:06 (failed in Phase 4.2)**
- **TF:** 21 of 30 confirmed. **23–26 is recited twice** (8:20–10:40).
- **Worklist:** 28 bracketed (10 with a single pause), 1 conflict.
- **Next action:** a product decision; then listen and time.

**96 Al-ʿAlaq (العلق), 6:09 (failed in Phase 4.2)**
- **TF:** 9 of 19 confirmed. **2–8 is recited twice** (0:20–2:10, then from 2:20), then 10–18 in order.
- This explains the 42.5 s "before ayah 1" measured in Phase 4.2.
- **Worklist:** 13 bracketed, 2 conflicts, 4 unbracketed.
- **Next action:** a product decision; then listen and time.

**100 Al-ʿĀdiyāt (العاديات), 4:38**
- **Original failure:** Phase 3.1 score 0.171.
- **TF:** 8 of 11 confirmed. **1–4 twice, and 6–8 twice. Ayahs 10–11 are not confirmed before the file ends;** it may be cut short.
- **Worklist:** 6 bracketed, 2 conflicts, 3 unbracketed.
- **Next action:** listen to the end first (it may be incomplete); then a product decision and timing.

#### Weak evidence (3): confirm the content by ear first

**85 Al-Burūj (البروج), 8:27 (failed in Phase 4.2)**
- **TF:** 15 of 22 confirmed, in order. 9, 11, 12, 14–16 and 22 are unconfirmed. Al-Inshiqāq (84), the wrong-text control, reached 0.41 on this file.
- **FP:** 0:40–7:40 is the Sono Cairo recording «القمر 1-32 مع البروج» at 21:24–28:30.
- **Alternative transfer:** also fails MMS (0.141; Method 5).
- **Worklist:** 20 bracketed (3 with a single pause).
- **Next action:** listen end to end, then time.

**86 Aṭ-Ṭāriq (الطارق), 4:56**
- **Original failure:** Phase 3.1 excluded.
- **TF:** 7 of 17 confirmed. The best spans advance 1 → 16 throughout, but below the margin for 9–14; 17 is not found before the end.
- **Audio comparison:** the radio recording «الطارق والبلد - تلاوة أولى» (catalogue); FP is weak.
- **Worklist:** 15 bracketed (median 130 s wide).
- **Next action:** listen end to end, checking whether ayah 17 is present; then time.

**82 Al-Infiṭār (الانفطار), 10:35**
- **Original failure:** Phase 3.1 score 0.239; 62 s before ayah 1.
- **TF:** only 5 of 19 confirmed. Nothing is confirmed in the first 140 s; 7–8 recur; 13–19 are present.
- **FP:** the radio and «كاملة» versions of the 82-1 recording (2:00–9:00).
- **Worklist:** 12 bracketed (median 150 s wide), 7 unbracketed.
- **Next action:** listen to the opening 2:30 first, to check whether it is introduction or ayahs 1–6; then time.

## Changes in this phase (none staged or committed)

**New, tools** (`tools/quran-audio/audit/rifaat/`, with README):
- `mapfiles.py`, `segments.py`, `transcribe.py`, `asr_order.py`;
- `tf_verify.py`, `tf_summary.py`, `worklist.py`, `extract.py`, `build_evidence.py`;
- `run_tf.sh`, `run_cal.sh`.

**New, evidence** (`tools/quran-audio/audit-data/rifaat-phase-4-5-2026-10-18/`):
- `rifaat-phase-4-5.json`: per recording, its verdict, provenance segments, recognition and teacher-forced summary;
- `segments.json`, `mapping.json`, `asr-order.json`;
- `teacher-forced/` (18 runs, 4 calibration runs, the positive control and the summary);
- `worklists/` (18);
- `collection-titles-way2llh22.txt`, `audio-quality.txt`.

**Unchanged:**
- `alignment/batch-exclusions.json` (the 21 stay excluded);
- every catalogue, development timing, package, production timestamp and audio source;
- the Phase 4.2 repairs, the 399 candidates, the 32 VBR candidates, and the Android Phase 4.4 results.

**Scratch** (the session scratchpad `p45/`) keeps:
- the 31 MP3Quran files and the 66 collection files (for comparison only, not redistributed);
- the Whisper model;
- the alternative-transfer extracts and their alignments.

## What would move these forward

1. **Owner decision on repeated passages** (7 recordings), and on partial surahs (13 excerpts). Both are product questions.
2. **Listening:** start with 98, then 73, 72 and 78.
   - The worklists make each start a choice among a few pauses in a 50–70 s window.
   - Recording a start needs a reviewer mode for boundaries placed from scratch, which `review.html` does not have yet. It would also need a second reviewer, because no automated evidence backs the exact position.
3. **Rights:** for anything beyond MP3Quran streaming, contact the National Media Authority (Maspero) and Sono Cairo.
   - They also hold the restored originals, the only plausible better source.
   - A restored complete recitation for one of the 13 excerpt surahs could exist in the material not yet broadcast. The Al-Azhar and Maspero restoration projects were reported; nothing is public.

## Broader source leads (research only, no alignment run)

**Ahmed Mohamed Salama** (114 surahs with no recording):
- Assabile remains the only known source, without permission.
- A search of midad.com and surahquran found only similarly named reciters (Yasser Salama), not him.
- No new lead.

**Saleh Al-Talib** (82 missing):
- equran.me has per-surah pages, but their provenance is unknown and a bot check blocks scripted access.
- Rights unknown.

**Islam Sobhi** (5 missing):
- Way2Quran lists 114 surahs, but is restricted. Its own biography says 107, so the listing is unverified.
- Also surahquran.com pages and docs.islamic.app.
- Rights unknown for all.
