# Missing-surah source discovery — Phase 4.6 (2026-10-18)

Local only. Nothing committed, staged, built or deployed. **No catalogue, timing, registry, package or app file was
changed**: checked by SHA-256 against a baseline taken before any work, §9. Nothing was enabled or approved, and no
alignment batch was run.

This phase is **discovery, verification and deduplication only**. Every finding below is automated or desk evidence.
It narrows what a person must check. It never replaces listening, and it never grants a permission.

Machine-readable inventory: `tools/quran-audio/audit-data/missing-surah-candidates-2026-10-18.json`. It holds the
17 × 114 coverage matrix, each provider's terms with exact quotes, and one record per reciter–surah–recording, with
`sourceStatus`, `technicalStatus`, `rightsStatus` and `humanReview` kept apart. Downloaded files and working evidence
stay in the session scratch area (§10).

Four statuses are kept apart throughout, as in Phases 4.1–4.4:
- **Source:** discovered, identity verified, complete, duplicate, unsuitable, unresolved.
- **Technical:** alignment-ready, alignment required, seek-blocked, further investigation.
- **Rights:** permitted, permission required, restricted, unknown.
- **Human review:** not reviewed (everything here), review required, approved, rejected.

## 1. Coverage now (from the local data, not old totals)

Built from `audit-results.json` (production), `development/development-timing.json`, the Phase 4.1/4.2 batch summary,
and MP3Quran's live catalogue. The live catalogue was fetched 2026-10-18 and is identical to the 2026-10-17 snapshot:
0 moshafs changed.

| State | Surahs |
|---|---|
| Production (ayah timing, verified) | 1,148 |
| Development timing | 44 |
| Aligned candidates awaiting listening (Phase 4.1/4.2) | 399 |
| VBR, recovered in Phase 4.3, awaiting device test / permission | 32 |
| Rifaat: failed (10) or excluded (21) | 31 |
| No MP3Quran recording | 284 (Saleh Al-Talib 82, Muhammad Rifaat 83, Islam Sobhi 5, Ahmed Mohamed Salama 114) |
| **Total** | **1,938** |

**The 13 other reciters have a recording in some pipeline state for every one of their 114 surahs.** None is
missing. Their remaining work is listening review (Phases 4.1–4.3), not new sources, so no replacement was sought
(see §7 for what the audit of them did find).

**The real gaps are 284 missing surahs plus Rifaat's 31 unusable ones: 315 reciter–surahs.**

## 2. Summary

| Reciter | Existing coverage | Missing | New unique candidates (recordings / surahs) | Verified candidates | Permissions pending | Still unavailable |
|---|---:|---:|---:|---:|---:|---:|
| 13 other reciters | 114 each (1,482) | 0 | 0 | 0 | 0 | 0 |
| Islam Sobhi | 109 | 5 | 8 / 5 (Way2Quran 6, archive.org 2; all different performances) | 1 (Way2Quran 065) | 8 | 4 |
| Saleh Al-Talib | 32 | 82 | 38 / 38 (MP3Quran CDN 002; archive.org saqrsm 37) — plus 82 misattributed midad files (other imams), not counted | 24 | 38 | 58 |
| Muhammad Rifaat | 31 recorded, **0 usable** | 83 (+31 unusable) | 8 / 8 (Islamway files via Way2Quran: 97, 99, 101–106) | 0 | 8 | 114 |
| Ahmed Mohamed Salama | 0 | 114 | 1 series (114) + 6 other takes (OurQuraan 1–3; archive.org 2025 item 6, 16, 18) | 0 (identity unverified) | 114 | 114 |

The columns mean:
- **New unique candidates:** recordings not previously in the inventory, after deduplication. Copies on several sites count once.
- **Verified candidates:** the voice is consistent with the reciter **and** the text is complete by the screening of §4. Not a human verification.
- **Still unavailable:** surahs with no candidate that is verified, complete and possible to use.

**Headline findings**

1. **Saleh Al-Talib surah 2 (Al-Baqarah) is on MP3Quran's CDN although MP3Quran's catalogue does not list it.**
   - It is 128 kbps CBR, tagged with his name, and in his voice.
   - **But it is incomplete:** it opens at 2:1 and ends at 2:286, yet whole passages are missing (e.g. 2:214 jumps to 2:243). Probably that is why MP3Quran does not list it.
   - It is not usable for ayah-by-ayah playback of the surah.
2. **Muhammad Rifaat: most of his "surahs" are not complete surahs.**
   - A collector's catalogue of every surviving Rifaat recording, plus duration and audio tests, shows that 13 of the 31 MP3Quran files contain only part of the surah. Some are assembled from fragments of different broadcasts.
   - Phases 3.1–4.2 aligned the whole surah's text against these files, which could not succeed.
   - This is a confirmed cause for those 13; it does not explain the other 18.
   - Way2Quran's Rifaat files are the MP3Quran files (byte-identical).
3. **A large "Saleh Al-Talib — 114 surahs" collection (midad.com, Islamway's successor) is misattributed.**
   - It is the 1424 AH Makkah Haram mushaf, recited by several imams.
   - Talib's voice is in none of his 82 missing surahs there.
4. **Talib's actual new material is 37 whole-surah Haram prayer recordings on archive.org** (14, 29, 32, 48, 51, 62, 63, 67–69, 71, 87–95, 97–110, 112–114), in his voice, of unknown provenance and rights.
5. **Islam Sobhi:**
   - Way2Quran has all five missing surahs as complete recitations, but the voice of three (37, 39, 40) does not match his, and 45 is unresolved.
   - 65 is probably his: the only Sobhi candidate that passes both screens.
   - archive.org adds two other performances in his voice:
     - Az-Zumar (93 %), but it starts at 39:47;
     - Ghāfir «كاملة», complete by text but only 73 % of windows his.
   - 37 has his voice only in an incomplete take (ends at 37:102).
6. **Ahmed Mohamed Salama:**
   - One complete series exists in five places (Assabile, OurQuraan at 4× the bitrate, three archive.org items). It is consistent and complete.
   - Nothing establishes who the reciter is beyond the hosting sites' labels.
   - It is shown **not** to be Yasser Salama.
7. **Rights:**
   - Way2Quran now publishes terms: personal and non-commercial use; contact them for commercial or large-scale distribution.
   - MP3Quran's own files tag several recordings, including production Hudhaifi and the default reciter Maher, as **"Reserved For KFGQPC"**. That needs an owner decision (§6). Nothing was changed.

## 3. Priority reciters

### 3.1 Ahmed Mohamed Salama (أحمد محمد سلامة): 114 missing

**What exists.** One recorded series, found in five places:

| Copy | Files | Format | Relationship (evidence) |
|---|---|---|---|
| Assabile, reciter 367 (https://www.assabile.com/ahmed-mohamed-salama) | 114 | 32 kbps CBR, 11 kHz; ID3 "المصحف المرتل", tagged 2015-07-27; no reciter name in the file | Reference copy. Pace uniform across all 114 (322 ms/letter median, none outside 0.7–1.4×). |
| assajda.com | — | — | Same back end as Assabile (same reciter id 367): not an independent source. |
| OurQuraan.com (`listen.ourquraan.com/Ahmed_Mohamed_Salama/NNN.mp3`) | 114 | 128 kbps CBR (100) / 160 kbps CBR (14), 44.1 kHz; ID3 "OurQuraan.Com - Ahmed Mohamed Salama", year 1431 AH (≈2010) | **Same performance, better quality** for 111 surahs (duration within 3 %; 67: 35/35 pieces at 0.950, constant lag; 112: 0.938). **Different recording** for 1, 2 and 3 (1: 0 % of pieces match; 3: 0 % of the first 206 s). |
| archive.org `AhmedMohamedSalama` (2018), `Ahmed-Mohamed-Salama` (2022) | 114 each | as Assabile | Durations equal Assabile's for all 114: copies of the same files. |
| archive.org `ahmed-mohamed-salama_Quran` (2025) | 114 | ≈128 kbps | Durations equal Assabile's for 111; 6, 16, 18 differ. |
| archive.org `002-surah-al-baqarah_20210714_2110` (2021, "Quran is life" YouTube channel) | 114 | mixed | 62 equal Assabile, 64 equal OurQuraan, 52 neither: a compilation of copies and other takes. |
| archive.org `AmirAlMohalhal-001AlFatiha` | 1 file | Juz ʿAmma in one 57-minute file | Not usable per surah. |

**Identity: unverified.**
- Everything that names him is a hosting site. No biography, publisher, date or recording studio was found (searches in Arabic and English). The press results under similar names are the historical Sheikh **Muhammad Salama** (1899–1982), another person.
- Two separate lineages attach the name to this voice: OurQuraan's files (tagged 1431 AH) predate Assabile's tagging (2015). That is corroboration of the *attribution*, not of the person.
- **He is not Yasser Salama.**
  - None of 6 surahs' pieces is found in MP3Quran's Yasser Salama files (0 % matched).
  - EveryAyah's `Yaser_Salamah_128kbps` clips are not found in order.
  - ECAPA voice similarity is 0.32–0.50 against Yasser Salama, but 0.94 within this series and 0.80–0.95 within Yasser's.

**Text.** See the table in §4 (Quran-ASR on 6 sampled surahs).

**Rights.** Assabile: unknown (no terms). OurQuraan: hotlink-protected, no terms. archive.org: unknown. **No source permits app use.**

**Verdict.** The candidate set is technically suitable and complete by every screen applied. It is blocked by **identity** (no authoritative source for who the reciter is) and by **permission**. OurQuraan's copy is the better master for 111 surahs; Assabile's is the reference for 1–3.

### 3.2 Saleh Al-Talib (صالح آل طالب): 82 missing

| Finding | Evidence |
|---|---|
| **New: surah 2 (Al-Baqarah) is on MP3Quran's CDN but not in its catalogue — and it is incomplete.** | `cdn.mp3quran.net/audio/saleh-talib/r1/002.mp3`: 200, 64,264,916 bytes, 4,015 s, 128 kbps CBR (Info). The API's moshaf 41 lists 32 surahs without 2. ID3: "Saleh Altalib - القارئ صالح آل طالب", Hafs, 1445 AH, engineer "Moza Saif". Voice: ECAPA 0.78–0.82 against his catalogued surahs; window classifier 40/40 windows Talib. **Text:** it opens at 2:1 and ends at 2:286, but his pace over 2:1–76 (255 ms/letter) projects 6,735 s for the surah. Slices from the middle place 2:126 at 1,700 s, 2:185 at 2,200 s, a jump 2:214→2:243 within 10 s at 2,700 s, 2:256 at 3,200 s. Stretches run at about 100 ms/letter: **passages are missing** (a selection or edit). The other 81 unlisted surahs still redirect to Minshawi (302), as before. |
| MP3Quran's 32 surahs are his portion of the **1424 AH Makkah taraweeh** | archive.org `TaraweehMakkah1424SheikhSalehAl-taleb` holds exactly the same 32 surah numbers; midad's Haram 1424 files 56 and 86 are the same performance as MP3Quran's (0.836 / 0.826, constant lag −4 s). |
| Five archive.org items and midad 458338 are copies of the same 32 | `Quran-Salih-al-Talib`, `SalehAlTaleb_201506`, `PerSurah79`, `saleh-al-taleb-allnasheed.com`, `SalehAlTalebQuran`: same surahs, durations equal to MP3Quran's (e.g. 25: 880 s). midad collection 458338: the same 32 at about half the bytes (lower bitrate). **Not new.** |
| **midad collection 465082 «سور من مصحف الحرم المكي 1424 هـ - مرتل», attributed to Talib, 114 surahs: misattributed** | Window classifier with MP3Quran references (held-out Talib 100 %, Shuraim 100 %, unrelated 0 %): Talib's voice in **24 files, every one a surah MP3Quran already has**; of his 82 missing surahs, **0** are in his voice: Sudais (≥ 80 % of windows) in most, Shuraim in others, several voices in the rest. 20 files are stored under midad's folder for Saud Al-Shuraim (44823). ID3 artist: "مصحف الحرم المكي 1424 هـ" (the mushaf, not a reciter). |
| **archive.org `saqrsm` (139 prayer excerpts, "Salih Al Talib"): 37 surahs not on MP3Quran are complete by title** | 14, 29, 32, 48, 51, 62, 63, 67, 68, 69, 71, 87–95, 97–110, 112–114 (every missing surah from 87 on except 96 and 111). All 37 files: 320 kbps CBR, MD5 matches archive.org, ID3 artist "Shaikh Dr. Saleh Al Taleb"; window classifier Talib 75–100 % of windows (several files have only 1–5 windows: weak). They are Haram **prayer** recordings (not studio murattal), of unknown date and origin (uploader e-mail only, no licence). The item's titles are reliable: a parsing error of mine (Al-Jinn missing from my name list) briefly mis-numbered 72–114; the audio of every file checked (At-Tīn, Az-Zalzalah, Al-Qāriʿah …) matches its own title. Text: §4. |
| Other archive.org items (Fajr/Maghrib/Isha 1433, Al-Fath 1436, Al-Anbiya 1436, …) | Single prayers; not examined surah by surah in this phase (listed as leads). |

### 3.3 Muhammad Rifaat (محمد رفعت): 83 not listed + 31 problematic

**The Phase 4.2 diagnosis is reopened by new evidence.** Phase 4.2 left the root cause unconfirmed, and its experiments were not repeated. A new source explains most of the 31: the collector's catalogue in archive.org `way2llh22_20180630_1733` («المكتبة الشاملة لتراث الشيخ محمد رفعت»). It lists every surviving Rifaat recording by surah, ayah range, transfer and duration. **Most of his surviving recordings are partial ayah ranges** from radio and concert performances. Often several transfers of one performance exist: «نسخة أصلية» (original), «إذاعة القرآن الكريم» (the Quran radio), «صوت القاهرة» (the Sawt al-Qahira company), «مع الجمهور» (with the audience). The collector notes that broadcasters spliced performances («لوحظ ان هناك دمج بين التلاوات»).

**Test 1 (duration, no alignment).**
- Assume each MP3Quran file holds the whole surah. Then the 11 surahs the catalogue lists as partial (10, 11, 12, 17, 18, 19, 20, 48, 56, 69, 77) would be recited at **351–782 ms per letter**.
- The 20 surahs the catalogue lists as complete run at **836–2,255** (whole files, pauses included).
- Against the catalogue's ranges instead, the partial 11 fall back to 617–1,813 ms/letter, inside the normal range.
- The partial-surah files cannot contain the whole surah at his pace.

**Test 2 (audio).** Pieces of each MP3Quran file (20 s every 40 s) were located in the collector's labelled recordings (`features.py`, same audio ≥ 0.7):
Only *positionally consistent* runs count (≥ 3 consecutive pieces in one collector file, with the position advancing
with the MP3Quran time to within 12 s per step). Scattered high scores occur on restored, gated audio and are discarded
(`work/rifaat_chain.mjs`).

| MP3Quran file | Consistently located | What it shows |
|---|---|---|
| 54 Al-Qamar (Phase 4.2 failure) | 71 % of the file: 120–1,260 s in «القمر 1-32 مع البروج — نسخة صوت القاهرة», then 1,280–1,620 s in «القمر 37-50 مقطع من تلاوة» | **Partial**: ayahs 1–32 and 37–50 only (33–36 and 51–55 absent). Assembled from two recordings |
| 85 Al-Burūj (Phase 4.2 failure) | 63 %: inside «القمر 1-32 مع البروج — صوت القاهرة» (at 1,245 s onward) | Complete surah cut from a combined broadcast; still unreadable by both recognisers (cause unconfirmed) |
| 11 Hūd (excluded) | 0–1,500 s = «هود 1 – 17» (the 25-minute fragment) | **Fragment compilation** (Hūd has 123 ayahs) |
| 10 Yūnus (excluded) | 3,520–4,860 s = «يونس 53 - 64 ثم 67 – 72» | **Fragment compilation** |
| 72, 73, 83 | 39 % / 42 % / 32 %, each inside one Sawt al-Qahira or radio transfer | Same performance as a collector transfer; the rest of the file not matched consistently |
| 1, 12, 17, 18, 19, 20, 48, 55, 56, 69, 75–79, 81, 82, 86–89, 96, 98, 100 | ≤ 16 % | Not established: MP3Quran's file differs from the transfers available (another restoration or edit), or the matching transfer could not be downloaded (HTTP 500 at archive.org) |

So the audio confirms partiality directly for 10, 11 and 54. For the other partial surahs the evidence is the duration
test and the catalogue. The ranges per surah are in the inventory (`rifaat`) and in `work/rifaat-chain.json`.

**Consequences:**
- For these surahs, Phase 4.1/4.2 aligned the **whole surah's text against a file that holds only part of it**, and in at least one case (54) assembled from two recordings. Text confirmation could not succeed, whatever the audio quality. This is a confirmed cause for the partial ones (13 of the 31: 10, 11, 12, 17, 18, 19, 20, 48, 54, 56, 69, 77, 81). It is not the cause for the other 18, which the catalogue lists as complete and which still fail (1, 55, 72, 73, 75, 76, 78, 79, 82, 83, 85, 86, 87, 88, 89, 96, 98, 100); their cause stays unconfirmed.
- Full-surah, ayah-by-ayah timing is impossible for a recording that does not contain the whole surah. The app has no partial-surah mode, and this phase does not add one.

**Alternative sources:**
- **Way2Quran** (39 surahs): 30 are the MP3Quran files (head and tail byte-identical; 4 fully SHA-256-identical). 89 is the same performance in another edit (+10.3 s; MP3Quran's own 89 is dated 2026-10-13). The 8 extra surahs (97, 99, 101–106) are **Islamway files** (ID3 "Distributed by: islamway.com"; 32 kbps, 11 kHz).
  - They are not cut from the collector's Sawt al-Qahira transfer of «العلق … قريش» (≤ 25 % of pieces found). Their relationship to his other transfer is unresolved.
  - Al-ʿAsr (103) is not in the collector's catalogue at all.
  - Quran-ASR cannot read them (expected surah ranks #1–#73), the same limitation as Phase 4.2. Completeness and identity stay unverified.
- **archive.org**:
  - `way2llh22` holds several transfers of most performances (some files return HTTP 500).
  - Other collections, not individually mapped in this phase: `Mohammed_Refat_uP_bY_mUSLEm` (243 tracks), `MuhammadRefatVbrMp3`, `Muhammad_Refat` (el-moslem.com), `mohamed-refaat-whole`.
- **midad.com** lists his items as «ما تيسر من …» (selections).
- No source with verse-level timing exists for any Rifaat recording.

**Verdict.**
- Rifaat's "missing" surahs were mostly **never recorded complete**, as far as the collector's catalogue shows.
- The realistic target is the subset he recorded complete: 1, 55, 72, 73, 75, 76, 78, 79, 82, 83, 85, 86, 87, 88, 89, 90, 93–102 and 104–106 (97 also as a separate take; 90 and 93–106 apart from 96, 98 and 100 exist only outside MP3Quran).
- For those, the step needed is human-assisted timing on one chosen transfer, not new automatic alignment.

**Agreement with the parallel Phase 4.5 report.** `muhammad-rifaat-recovery-phase-4-5-2026-10-18.md` was written by another session the same evening. It reached the same split independently: the same 13 excerpt files (root cause confirmed) and the same 18 unresolved, with Way2Quran's files byte-identical to MP3Quran's. It has already prepared **human-assisted timing worklists for the 18** (497 ayah starts), which is the next step recommended here. Two differences:
- It counts no new alternative recordings, because it looks only at the 31 surahs. The 8 Islamway files above are for surahs MP3Quran does not have.
- It describes Way2Quran as restricted ("copyright reserved"), the 2026-10-17 reading. Way2Quran's FAQ, checked for this report, now invites contact for commercial or large-scale use: **permission required** (§6).

### 3.4 Islam Sobhi (إسلام صبحي): 5 missing (37, 39, 40, 45, 65)

| Candidate | Text (Quran-ASR) | Voice (window classifier; MP3Quran Sobhi held-outs 97–100 %, other reciters 0–3 %) | Format | Reading |
|---|---|---|---|---|
| Way2Quran 037 | rank #1; reaches 37:182 | **13 %** Sobhi | 128 kbps CBR, 48 kHz, ffmpeg 2025-26 | Complete, but probably **not Sobhi** |
| Way2Quran 037-001 | rank #1; **ends at 37:102** | 100 % | 192 kbps CBR | Sobhi, **incomplete** |
| Way2Quran 039 | rank #1; 75/75 reached, in order | **0 %** | 128 kbps CBR, from an MP4 container | Complete; **another reciter suspected** |
| Way2Quran 040 | rank #1; 85/85 reached | **0 %** (039 and 040 match each other at 0.92: one session) | 128 kbps CBR | Complete; **another reciter suspected** |
| Way2Quran 045 | rank #1; reaches 37/37 | 48 % | 192 kbps CBR | Complete; identity **unresolved** |
| Way2Quran 065 | rank #1; 12/12 | **83 %** | 192 kbps CBR | Complete; Sobhi **probable** |
| archive.org «Best Quran Surah Az Zumar» | rank #1; 47→75 of 75; coverage 38 %; 31 windows — not shown complete | **93 %** | 160 kbps | different performance from Way2Quran 039 (0–2 % pieces) |
| archive.org «سورة غافر (كاملة)» | rank #1; 3→85 of 85; coverage 57 %; 48 windows — **complete** (sparse) | 73 % | 160 kbps | different performance from Way2Quran 040 (0 %) |
| midad «مصحف إسلام صبحي - مرتل» (127 items) | — | — | — | none of the five surahs |

The Way2Quran set as a whole is heterogeneous: LAME 3.100 VBR, LAME 3.98 VBR, 192 kbps CBR and fresh ffmpeg encodes at 32/44.1/48 kHz. It is a compilation from several upstreams, so each file needs its own identity check.

## 4. Text and completeness screening (Quran-ASR)

Method: the Phase 4.2 diagnostic, unchanged in method.
- `tarteel-ai/whisper-base-ar-quran` transcribes 20 s windows. Each transcript is located in the whole Quran by character trigrams.
- The expected surah's rank among all 114 is reported, with the ayahs reached in order.
- **Screened complete** (`work/asr_summary.py`) means:
  - the expected surah ranks #1;
  - the first ayah matched is ≤ max(3, 5 % of the surah's ayahs);
  - the last ayah matched is the surah's last ayah (or the one before it, for surahs over 5 ayahs);
  - there are at most 2 backward jumps.
- Files of ≤ 8 windows are judged instead by **text coverage**: the share of the surah's character trigrams heard anywhere in the file, ≥ 0.8.
  - The threshold was set from files whose status was already known: complete long files 0.90–0.95; Sobhi 037-001 (ends at 37:102) 0.71; archive.org Az-Zumar (starts at 39:47) 0.38.
  - On a short file, "not shown complete" means uncertain, not incomplete.
- This is screening, not proof. Missing middle ayahs can only be seen where windows exist.
- Transcription ran on the GPU, or on the CPU while the GPU was taken by another session's long Whisper job (§10).
  - Some long files were transcribed **sparsely** (every window in the first and last 120 s, every 6th in between). You can tell them by a window count well below their duration ÷ 10 s, e.g. saqrsm 029, 067, 069 and archive.org Ghāfir. Their coverage figure is lower for that reason.
  - Saleh Al-Talib 002 was screened as its row says.
- **Omission check** (`work/omission_check.py`), added after Talib 002 showed that a file can open and close correctly yet skip passages:
  - Matched ayahs are chained in order, with isolated misrecognitions dropped.
  - Segments ≥ 120 s long whose implied pace is < 0.45 × the file's own median, over ≥ 400 letters, are flagged.
  - Positive control: Talib 002 with its middle slices. The check flags exactly the skipped stretches (about 100 ms/letter against a median of 260).
  - Every long file that screened complete shows **no omission signal**, at plausible paces: Talib 223–273, Sobhi 312–505, Ahmed M. Salama 314–337 ms/letter.
  - Files of ≤ 8 windows have too few points for this check; they rest on text coverage alone.

| File | Surah | Voice (window share) | Screen | Result |
|---|---|---|---|---|
| MP3Quran CDN `saleh-talib/r1/002.mp3` (unlisted) | 2 | Talib 100 % | rank #1; 2→286 of 286; coverage 44 %; 162 windows (screened: 0–1,400 s, five 40 s middle slices, last 240 s) | **incomplete** (passages missing; §3.2) |
| Way2Quran 037 | 37 | Sobhi 13 % | rank #1; 5→182 of 182; coverage 91 %; 130 windows | **complete** |
| Way2Quran 037-001 | 37 | Sobhi 100 % | rank #1; 5→132 of 182; coverage 71 %; 77 windows | not shown complete |
| Way2Quran 039 | 39 | Sobhi 0 % | rank #1; 1→75 of 75; coverage 95 %; 146 windows | **complete** |
| Way2Quran 040 | 40 | Sobhi 0 % | rank #1; 3→85 of 85; coverage 95 %; 158 windows | **complete** |
| Way2Quran 045 | 45 | Sobhi 48 % | rank #1; 2→37 of 37; coverage 92 %; 66 windows | **complete** |
| Way2Quran 065 | 65 | Sobhi 83 % | rank #1; 1→12 of 12; coverage 90 %; 48 windows | **complete** |
| archive.org 039 «Best Quran Surah Az Zumar» | 39 | Sobhi 93 % | rank #1; 47→75 of 75; coverage 38 %; 31 windows | not shown complete |
| archive.org 040 «سورة غافر (كاملة)» | 40 | Sobhi 73 % | rank #1; 3→85 of 85; coverage 57 %; 48 windows | **complete** |
| Assabile Ahmed M. Salama 001 | 1 | (same series, §3.1) | rank #1; 1→7 of 7; coverage 94 %; 4 windows | **complete** |
| Assabile Ahmed M. Salama 036 | 36 | (same series, §3.1) | rank #1; 3→83 of 83; coverage 93 %; 101 windows | **complete** |
| Assabile Ahmed M. Salama 067 | 67 | (same series, §3.1) | rank #1; 1→30 of 30; coverage 79 %; 28 windows | **complete** |
| Assabile Ahmed M. Salama 103 | 103 | (same series, §3.1) | rank #1; 3→3 of 3; coverage 60 %; 2 windows | not shown complete |
| Assabile Ahmed M. Salama 112 | 112 | (same series, §3.1) | rank #1; 1→4 of 4; coverage 100 %; 2 windows | **complete** |
| Assabile Ahmed M. Salama 114 | 114 | (same series, §3.1) | rank #1; 1→6 of 6; coverage 100 %; 4 windows | **complete** |
| archive.org saqrsm «032. Surat Ibrahim 1 - 52» | 14 | Talib 100 % (40 windows) | rank #1; 1→52 of 52; coverage 95 %; 95 windows | **complete** |
| archive.org saqrsm «063. Surat Al-'Ankabut 1 - 69» | 29 | Talib 98 % (40 windows) | rank #1; 2→69 of 69; coverage 60 %; 40 windows | **complete** |
| archive.org saqrsm «065. Surat As-Sajdah 1 - 30» | 32 | Talib 100 % (34 windows) | rank #1; 3→30 of 30; coverage 93 %; 34 windows | **complete** |
| archive.org saqrsm «081. Surat Al-Fath 1 - 29» | 48 | Talib 100 % (40 windows) | rank #1; 2→29 of 29; coverage 94 %; 62 windows | **complete** |
| archive.org saqrsm «084. Surat Ath-Thariyat 1 - 60» | 51 | Talib 100 % (40 windows) | rank #1; 14→60 of 60; coverage 93 %; 41 windows | not shown complete |
| archive.org saqrsm «092. Surat Al-Jumu'ah 1 - 11» | 62 | Talib 100 % (18 windows) | rank #1; 1→11 of 11; coverage 91 %; 18 windows | **complete** |
| archive.org saqrsm «093. Surat Al-Munafiqun 1 - 11» | 63 | Talib 100 % (20 windows) | rank #1; 1→11 of 11; coverage 93 %; 20 windows | **complete** |
| archive.org saqrsm «095. Surat Al-Mulk 1 - 30» | 67 | Talib 100 % (35 windows) | rank #1; 2→30 of 30; coverage 81 %; 27 windows | **complete** |
| archive.org saqrsm «096. Surat Al-Qalam 1 - 52» | 68 | Talib 100 % (34 windows) | rank #1; 7→51 of 52; coverage 93 %; 34 windows | not shown complete |
| archive.org saqrsm «097. Surat Al-Haqqah 1 - 52» | 69 | Talib 97 % (31 windows) | rank #1; 4→49 of 52; coverage 85 %; 26 windows | not shown complete |
| archive.org saqrsm «099. Surat Nuh 1 - 28» | 71 | Talib 100 % (24 windows) | rank #1; 1→28 of 28; coverage 94 %; 24 windows | **complete** |
| archive.org saqrsm «113. Surat Al-A'la 1 - 19» | 87 | Talib 100 % (6 windows) | rank #1; –→– of 19; coverage 93 %; 6 windows | **complete** |
| archive.org saqrsm «114. Surat Al-Ghashiyah 1 - 26» | 88 | Talib 100 % (8 windows) | rank #1; –→– of 26; coverage 94 %; 8 windows | **complete** |
| archive.org saqrsm «115. Surat Al-Fajr 1 - 30» | 89 | Talib 94 % (16 windows) | rank #1; 15→23 of 30; coverage 93 %; 16 windows | not shown complete |
| archive.org saqrsm «116. Surat Al-Balad 1 - 20» | 90 | Talib 100 % (9 windows) | rank #1; 17→19 of 20; coverage 89 %; 9 windows | not shown complete |
| archive.org saqrsm «117. Surat Ash-Shams 1 - 15» | 91 | Talib 100 % (7 windows) | rank #1; 14→14 of 15; coverage 83 %; 7 windows | **complete** |
| archive.org saqrsm «118. Surat Al-Lail 1 - 21» | 92 | Talib 89 % (9 windows) | rank #1; 20→20 of 21; coverage 94 %; 9 windows | not shown complete |
| archive.org saqrsm «119. Surat Adh-Dhuha 1 - 11» | 93 | Talib 100 % (4 windows) | rank #1; –→– of 11; coverage 88 %; 4 windows | **complete** |
| archive.org saqrsm «120. Surat Ash-Sharh 1 - 8» | 94 | Talib 100 % (3 windows) | rank #1; 7→7 of 8; coverage 83 %; 3 windows | **complete** |
| archive.org saqrsm «121. Surat At-Tin 1 - 8» | 95 | Talib 100 % (4 windows) | rank #1; 4→6 of 8; coverage 84 %; 4 windows | **complete** |
| archive.org saqrsm «122. Surat Al-Qadr 1 - 5» | 97 | Talib 100 % (3 windows) | rank #1; 1→4 of 5; coverage 81 %; 3 windows | **complete** |
| archive.org saqrsm «123. Surat Al-Bayyinah 1 - 8» | 98 | Talib 100 % (11 windows) | rank #1; 1→8 of 8; coverage 89 %; 11 windows | **complete** |
| archive.org saqrsm «124. Surat Az-Zalzalah 1 - 8» | 99 | Talib 80 % (5 windows) | rank #1; 6→8 of 8; coverage 86 %; 5 windows | **complete** |
| archive.org saqrsm «125. Surat Al-'Adiyat 1 - 11» | 100 | Talib 80 % (5 windows) | rank #1; 9→11 of 11; coverage 84 %; 5 windows | **complete** |
| archive.org saqrsm «126. Surat Al-Qari'ah 1 - 11» | 101 | Talib 100 % (5 windows) | rank #1; 4→4 of 11; coverage 85 %; 5 windows | **complete** |
| archive.org saqrsm «127. Surat At-Takathur 1 - 8» | 102 | Talib 100 % (4 windows) | rank #1; 5→8 of 8; coverage 81 %; 4 windows | **complete** |
| archive.org saqrsm «128. Surat Al-'Asr 1 - 3» | 103 | Talib 100 % (2 windows) | rank #1; 3→3 of 3; coverage 66 %; 2 windows | not shown complete |
| archive.org saqrsm «129. Surat Al-Humazah 1 - 9» | 104 | Talib 100 % (4 windows) | rank #1; –→– of 9; coverage 86 %; 4 windows | **complete** |
| archive.org saqrsm «130. Surat Al-Fil 1 - 5» | 105 | Talib 100 % (3 windows) | rank #1; 5→5 of 5; coverage 83 %; 3 windows | **complete** |
| archive.org saqrsm «131. Surat Quraish 1 - 4» | 106 | Talib 100 % (2 windows) | rank #1; 4→4 of 4; coverage 73 %; 2 windows | not shown complete |
| archive.org saqrsm «132. Surat Al-Ma'un 1 - 7» | 107 | Talib 75 % (4 windows) | rank #1; 3→7 of 7; coverage 81 %; 4 windows | **complete** |
| archive.org saqrsm «133. Surat Al-Kawthar 1 - 3» | 108 | Talib 100 % (1 windows) | rank #1; –→– of 3; coverage 67 %; 1 windows | not shown complete |
| archive.org saqrsm «134. Surat Al-Kafirun 1 - 6» | 109 | Talib 100 % (3 windows) | rank #1; 5→5 of 6; coverage 72 %; 3 windows | not shown complete |
| archive.org saqrsm «135. Surat An-Nasr 1 - 3» | 110 | Talib 100 % (2 windows) | rank #1; 2→3 of 3; coverage 85 %; 2 windows | **complete** |
| archive.org saqrsm «136. Surat Al-Ikhlas 1 - 4» | 112 | Talib 100 % (1 windows) | rank #1; 4→4 of 4; coverage 74 %; 1 windows | not shown complete |
| archive.org saqrsm «137. Surat Al-Falaq 1 - 5» | 113 | Talib 100 % (2 windows) | rank #1; 5→5 of 5; coverage 64 %; 2 windows | not shown complete |
| archive.org saqrsm «138. Surat An-Nas 1 -6» | 114 | Talib 100 % (3 windows) | rank #1; 4→5 of 6; coverage 81 %; 3 windows | **complete** |

Calibration of the coverage threshold (0.8), set from files whose status was already known: complete long files 0.90–0.95; Sobhi 037-001 (ends at 37:102) 0.71; archive.org Az-Zumar (starts at 39:47) 0.38. "Not shown complete" on a short file means *uncertain*, not *incomplete*: one or two windows carry a single recognition error far more heavily.

Quran-ASR cannot read Muhammad Rifaat's recordings (Phase 4.2). His new files rank the expected surah #1–#73, so the
screen gives no evidence either way for him.

## 5. Duplicates and recording variants

Method: `audit/features.py` log-band features, robust to re-encoding.
- 8 s pieces of one file are located in the other. Same audio scores about 0.8–1, other audio below 0.6.
- A **constant lag** across pieces means the same edit. Pieces matching at changing lags mean the same performance in another edit. **0 % matched** means a different performance.
- Controls: a file against itself scores 1.000 with lag 0. Yasser Salama 67 against Banna 67: median 0.47, 0 % matched.
- One defect was found and avoided:
  - `locate()` floors its denominator at 1e-9, so over the digital silence of restored historical files it returns impossible correlations (one control gave r = 69,681).
  - My scratch comparison discards |r| > 1.
  - The audit tool itself was not changed.

| Pair | Result | Class |
|---|---|---|
| Way2Quran Rifaat ×29 vs MP3Quran | identical bytes at both ends; 4 fully SHA-256-identical | **Exact duplicate** |
| Way2Quran Rifaat 89 vs MP3Quran 89 | 61/61 pieces at 0.97–1.0, lag 0; Way2Quran's is 10.3 s longer (MP3Quran's file re-dated 2026-10-13) | Same performance, different edit |
| Islamway Rifaat 97, 99, 101–106 vs collector's Sawt al-Qahira transfer of 96–106 | ≤ 25 % of pieces, scattered lags | **Uncertain** (not that transfer) |
| OurQuraan vs Assabile, Ahmed M. Salama 67 / 112 | 35/35 at 0.950 (lag 0.18 s) / 0.938 | Same performance, different encoding (OurQuraan 128 kbps vs 32 kbps) |
| OurQuraan vs Assabile, 1 / 3 | 0 % | Different performance |
| Assabile Ahmed M. Salama vs MP3Quran Yasser Salama (1, 36, 67, 103, 112, 114) | 0 % in all six | Different recording |
| midad Haram 1424 Talib 56 / 86 vs MP3Quran Talib | 0.836 / 0.826, lag −4.0 / −4.2 s | Same performance, different encoding |
| midad Haram 1424 25, 38, 2 vs MP3Quran Talib 25, 38, 2 | 0 % | Different performance (other imams, §3.2) |
| midad 458338 (Talib "murattal", 32) vs MP3Quran Talib | same surah list, every file ≈ 0.5 × the bytes | Same set, lower bitrate (not fingerprinted file by file) |
| archive.org Talib items ×5 | same 32 surah numbers, equal durations | Copies |
| Way2Quran Sobhi 037 vs 037-001 | 0 % | Different performances |
| archive.org Sobhi 39 / 40 vs Way2Quran 39 / 40 | 2 % / 0 % | Different performances |
| midad «ياسر محمود سلامة — الحدر» vs MP3Quran 152 (67, 112, 18) | 0 % | Different recording, same voice (§7) |

**Voice identity.** SpeechBrain ECAPA embeddings, the Phase 2 model.
- Pairwise cosine is used where noted. Elsewhere a window classifier is used (`voiceclass.py`, scratch): each 10 s window goes to the nearest reference voice built from MP3Quran files only, or to "unknown" if the match is below 0.45 or the margin below 0.10.
- Held-out controls:
  - Talib files 100 % Talib;
  - Shuraim 100 % Shuraim;
  - Sobhi 97–100 % Sobhi;
  - unrelated reciters 0–3 %.
- One caution: Abdul Rashid Sufi 19 scored 53 % "Talib". A majority on one file is therefore not proof, and every voice result here is labelled probable, never verified.
- ECAPA is sensitive to the recording channel (studio vs. mosque), so a low score means **unverified**, not "another reciter".

## 6. Usage rights (checked 2026-10-18)

Technical suitability and permission are kept apart. A file that can be downloaded is never treated as licensed.

| Provider | Exact language (source, date checked) | Streaming in the app | Local caching / offline | Download for analysis | Modification / rehosting / redistribution | Status |
|---|---|---|---|---|---|---|
| MP3Quran | "All rights are available to everyone, and we allow any visitor or developer to copy any material or use any link on the websites" (https://www.mp3quran.net/eng/privacy, unchanged since 2026-10-17) | Permitted by the site-wide grant | Permission required (unchanged: offline stays off) | Permitted | Unknown | **Permitted (site-wide) for streaming; see the tag finding below** |
| Way2Quran | "Personal, educational, and non-commercial da'wa (Islamic outreach) use is welcome. For any commercial or large-scale distribution, please contact us so we can clarify rights that belong to the original reciter." (https://way2quran.com/en/faq) — new since 2026-10-17, when only "Copyright reserved" was found | Permission required (an app is large-scale distribution; the rights are said to belong to the reciter) | Permission required | Permitted ("streaming and download for personal, educational, and devotional use") | Permission required | **Permission required** |
| Assabile (and assajda.com, the same back end) | "© 2008–2026 Assabile"; no terms page (/terms, /legal, /terms-of-use, /conditions, /copyright: 404). Privacy page: users can "listen, read, download, and learn without an account". | Unknown | Unknown | Permitted (downloads offered) | Unknown | **Unknown** |
| OurQuraan.com | No terms published; download host refuses (403/404); streams only with the site as referer | Restricted (hotlink protection) | Unknown | Unknown | Unknown | **Restricted / unknown** |
| midad.com (Islamway's content) | «يحق لك الاستفادة من محتويات الموقع في الاستخدام الشخصي غير التجاري مع ذكر المصدر» (footer, every page) | Restricted (presigned links that expire after 7 days) | Permission required | Permitted (personal use) | Permission required | **Restricted (personal, non-commercial)** |
| Internet Archive items | No item licence on any candidate item; uploaders identified only by e-mail | Unknown | Unknown | Permitted (public download) | Unknown | **Unknown** |
| King Fahd Complex | Unreachable again (TCP timeouts on qurancomplex.gov.sa and qc-dev…) | — | — | — | — | **Not examined** |

**New rights finding that touches production (not acted on).** The MP3Quran files themselves carry ID3 copyright frames naming third parties:

| Recording | TCOP frame (sampled files) |
|---|---|
| Ali Al-Hudhaifi (production, measured timing) | "Reserved For KFGQPC حقوق التسجيل محفوظة لمجمع الملك فهد لطباعة المصحف الشريف" — 6 of 6 sampled |
| Maher Al-Muaiqly (production, the default reciter) | the same — 5 of 6 sampled (36, 67, 86, 100, 114; not 1) |
| Yasser Salama (candidates) | the same — 6 of 6 |
| Muhammad Rifaat | the same — 3 of 3 |
| Islam Sobhi | KFGQPC on 11 of 109 (26, 31, 32, 44, 50, 53, 59, 66, 79, 85, 88); "www.islamway.net" / "www.islamway.net@2020" on 14 |
| Ahmed Al-Ajmi, Abdul Rashid Sufi (production) | "www.islamway.com&islam-call.com" |
| Abdul Basit, Minshawi, Naina, Husary, Banna, Shuraim, Shatri, Basfar, Saleh Al-Talib | none |

MP3Quran's grant is site-wide, but the files state that the recording rights of several recordings are reserved to the King Fahd Complex. MP3Quran's grant may therefore not be MP3Quran's to give for those recordings. This is a question for the owner (and possibly counsel); nothing in the app, catalogue or registry was changed. Recommended: ask MP3Quran in writing whether its grant covers the KFGQPC-tagged recordings for streaming in a (possibly commercial) app, and ask the King Fahd Complex directly once it is reachable.

### Permission requests (drafts — not sent)

**To Way2Quran** (https://way2quran.com/en/contact-us):

> Assalamu alaykum. We develop Quran Heals, a Quran reading app, and would like to stream, inside the app, a small number of recitations hosted on Way2Quran, with ayah-by-ayah playback using timing we measure ourselves (no audio is modified or rehosted). The recordings: Islam Sobhi, Hafs ʿan ʿĀṣim — surahs 37, 39, 40, 45, 65 (https://media.way2quran.com/islam-sobhi/hafs-an-asim/…); Mohamed Refaat — surahs 97, 99, 101–106. (1) May we stream these files from your server in the app? (2) If the rights belong to the reciter or another party, who should we ask? (3) Do you know where these files came from (they appear to be recent conversions from video)? (4) Is the app's use commercial or large-scale in your terms, and is attribution required? (5) Could you confirm that 37, 39, 40 and 45 are recited by Sheikh Islam Sobhi? Our voice comparison could not confirm it for these four. Jazakum Allahu khayran.

**To MP3Quran** (https://www.mp3quran.net/eng/contact-us):

> Assalamu alaykum. Quran Heals streams MP3Quran recordings under your published permission. (1) Several files (Ali Al-Hudhaifi, Maher Al-Muaiqly «المصحف المجود», Yasser Salama, Muhammad Rifaat, some Islam Sobhi) carry the tag "Reserved For KFGQPC". Does your permission cover streaming these in an app, or must we ask the King Fahd Complex? (2) Saleh Al-Talib surah 2 is on your CDN (saleh-talib/r1/002.mp3) but not in the API's surah list, and parts of Al-Baqarah seem to be missing from it (e.g. it passes from 2:214 to 2:243). Is a complete recording of it, or of his other surahs, planned? (3) May we cache recordings on users' devices for offline listening? (4) Is «ياسر سلامة» (reciter 152) Sheikh Yasser Mahmoud Salama?

**To Assabile** (no contact address published; via its social channels): ask (1) permission to stream the Ahmed Mohamed Salama mushaf in an app, (2) the reciter's identity and the recording's origin (date, studio, publisher), (3) whether a higher-quality master exists.

**To the King Fahd Complex** (when reachable): ask about the recordings tagged as its own, and whether an official per-ayah Hafs recording of any of the 17 reciters is available for app use.

## 7. The 13 other reciters

- **No gaps.** Every surah has an MP3Quran recording at some stage: production, development, aligned candidate, or VBR recovered. No replacement was sought, by design (an existing valid candidate is never replaced just because another provider has a different version).
- **Excluded possibly incorrectly:** nothing new. The Phase 4.1 cases stand: Maher 34 and 68 were withdrawn from production on a measurement bug, and are candidates again pending an owner decision. Husary 21, 28 and 31 hold real extra audio.
- **Identity, Yasser Salama (open since Phase 4.1):**
  - midad.com (Islamway's catalogue) files a fast «الحدر» mushaf under **ياسر محمود سلامة** (scholar 1080). It is a different recording from MP3Quran 152 (0 % of pieces match).
  - It is the **same voice**: ECAPA 0.70–0.80, against 0.80–0.95 within MP3Quran 152 and 0.18–0.42 for other reciters.
  - So a second provider attributes this voice to «ياسر محمود سلامة». That is corroboration, not confirmation. The question to MP3Quran stands (§6).
- **Rights flags inside MP3Quran's files** (§6): the KFGQPC tag on Hudhaifi and Maher (production), and the Islamway tag on Ajmi and Sufi (production).
- **VBR:** Way2Quran's copies of Sobhi's 29 VBR surahs are themselves mostly VBR (76 of its 115 Sobhi files are LAME VBR), so they are no seek-friendly alternative. Nothing was changed in the Phase 4.3/4.4 work.
- **Metadata anomaly (identity):** two MP3Quran Islam Sobhi files (1 and 23) carry, in the ID3 "Engineer" field, «القارئ: عبدالاله عبدالرحمن بن عون Reciter: Abdulilah Abdurahman bin Oun». The artist field says Islam Sobhi, as in all 109, and the frame looks like template residue (58 others name the engineer "Moza Saif", 12 "Sh. Ahmad Khalil Shaheen"). Both are candidates already. Listen to the voice before approving them.

## 8. Remaining gaps and the next alignment batch

### 8.1 Surahs with no suitable recording (all 315 gaps)

| Reciter | No recording discovered | Recording found, identity unconfirmed | Recording incomplete | Recording unusable (for automatic timing) | Suitable by every screen, permissions unresolved |
|---|---|---|---|---|---|
| Saleh Al-Talib (82) | 44: 3–13, 15–24, 26–28, 30–31, 33, 35–37, 40–43, 49–50, 52–54, 64–66, 96, 111 (midad's files for these are other imams) | — | 1: surah 2 (MP3Quran 002, passages missing) | 13 whose text or voice screen did not pass: 51, 68–69, 89–90, 92, 103, 106–109, 112–113 (prayer recordings; listen) | 24: 14, 29, 32, 48, 62–63, 67, 71, 87–88, 91, 93–95, 97–102, 104–105, 110, 114 (archive.org saqrsm prayer recordings: unknown rights and provenance) |
| Islam Sobhi (5) | 0 | 37, 39–40, 45 (voice not matched or unresolved) | 37-001 (Sobhi's voice) ends at 37:102; archive.org 039 (Sobhi's voice) starts at 39:47 | — | 65 (Way2Quran / archive.org: permission required / unknown) |
| Muhammad Rifaat (83 + 31) | 75 of the 83 (most were never recorded complete, per the collector's catalogue) | 8: 97, 99, 101–106 (Islamway; 103 not in the catalogue) | 13 of the 31: 10, 11, 12, 17, 18, 19, 20, 48, 54, 56, 69, 77, 81 | 18 of the 31 (complete per catalogue, unreadable by both recognisers): 1, 55, 72, 73, 75, 76, 78, 79, 82, 83, 85, 86, 87, 88, 89, 96, 98, 100 — and the 8 new | 0 |
| Ahmed Mohamed Salama (114) | 0 | **114** (attribution only; not Yasser Salama) | 0 known (sampled 6, pace-screened 114) | — | — (identity first, then permission) |

### 8.2 Next alignment batch (exact, deduplicated)

Only recordings whose identity is consistent with the reciter **and** whose text screened complete. All are **local alignment experiments only**: none may play anywhere, and every one would still need automated validation and a human listening review.

| # | Reciter | Surah | Recording (file) | Duration | Format | Blocking app use |
|---|---|---|---|---|---|---|
| 1 | Saleh Al-Talib | 14 | archive.org `saqrsm` «032. Surat Ibrahim 1 - 52» | 957 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 2 | Saleh Al-Talib | 29 | archive.org `saqrsm` «063. Surat Al-'Ankabut 1 - 69» | 1147 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 3 | Saleh Al-Talib | 32 | archive.org `saqrsm` «065. Surat As-Sajdah 1 - 30» | 341 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 4 | Saleh Al-Talib | 48 | archive.org `saqrsm` «081. Surat Al-Fath 1 - 29» | 625 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 5 | Saleh Al-Talib | 62 | archive.org `saqrsm` «092. Surat Al-Jumu'ah 1 - 11» | 189 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 6 | Saleh Al-Talib | 63 | archive.org `saqrsm` «093. Surat Al-Munafiqun 1 - 11» | 206 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 7 | Saleh Al-Talib | 67 | archive.org `saqrsm` «095. Surat Al-Mulk 1 - 30» | 356 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 8 | Saleh Al-Talib | 71 | archive.org `saqrsm` «099. Surat Nuh 1 - 28» | 244 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 9 | Saleh Al-Talib | 87 | archive.org `saqrsm` «113. Surat Al-A'la 1 - 19» | 65 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 10 | Saleh Al-Talib | 88 | archive.org `saqrsm` «114. Surat Al-Ghashiyah 1 - 26» | 89 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 11 | Saleh Al-Talib | 91 | archive.org `saqrsm` «117. Surat Ash-Shams 1 - 15» | 73 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 12 | Saleh Al-Talib | 93 | archive.org `saqrsm` «119. Surat Adh-Dhuha 1 - 11» | 47 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 13 | Saleh Al-Talib | 94 | archive.org `saqrsm` «120. Surat Ash-Sharh 1 - 8» | 30 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 14 | Saleh Al-Talib | 95 | archive.org `saqrsm` «121. Surat At-Tin 1 - 8» | 49 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 15 | Saleh Al-Talib | 97 | archive.org `saqrsm` «122. Surat Al-Qadr 1 - 5» | 33 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 16 | Saleh Al-Talib | 98 | archive.org `saqrsm` «123. Surat Al-Bayyinah 1 - 8» | 111 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 17 | Saleh Al-Talib | 99 | archive.org `saqrsm` «124. Surat Az-Zalzalah 1 - 8» | 51 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 18 | Saleh Al-Talib | 100 | archive.org `saqrsm` «125. Surat Al-'Adiyat 1 - 11» | 58 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 19 | Saleh Al-Talib | 101 | archive.org `saqrsm` «126. Surat Al-Qari'ah 1 - 11» | 52 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 20 | Saleh Al-Talib | 102 | archive.org `saqrsm` «127. Surat At-Takathur 1 - 8» | 48 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 21 | Saleh Al-Talib | 104 | archive.org `saqrsm` «129. Surat Al-Humazah 1 - 9» | 44 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 22 | Saleh Al-Talib | 105 | archive.org `saqrsm` «130. Surat Al-Fil 1 - 5» | 33 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 23 | Saleh Al-Talib | 110 | archive.org `saqrsm` «135. Surat An-Nasr 1 - 3» | 26 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 24 | Saleh Al-Talib | 114 | archive.org `saqrsm` «138. Surat An-Nas 1 -6» | 34 s | 320 kbps CBR | unknown rights, no provenance; prayer recording (check takbīr / āmīn) |
| 25 | Islam Sobhi | 65 | Way2Quran 065 | 488 s | 192 kbps CBR | Way2Quran permission; listening identity check |

**Scope: 25 recordings** (24 Saleh Al-Talib surahs, 1 Islam Sobhi). Roughly 82 minutes of Talib audio plus Sobhi; with the Phase 4.1 pipeline this is under an hour of GPU time.

**Not in the batch, and why:**
- **Saleh Al-Talib 2 (MP3Quran CDN).** Incomplete (passages of Al-Baqarah missing), so full-surah ayah timing is impossible.
- **Ahmed Mohamed Salama (114).** Technically ready (complete series, CBR, text screened complete in every sampled surah). **Identity unverified.** The rule is not to align before identity is sufficiently established. The owner may decide that the attribution (Assabile, OurQuraan, archive.org) suffices for a *local* experiment. If so, use OurQuraan's 128/160 kbps copy for 4–114 and Assabile's for 1–3.
- **Islam Sobhi 37, 39, 40, 45 (Way2Quran).** Text complete, but the voice does not match (37, 39, 40) or is unresolved (45). A listener must first confirm who recites.
- **Saleh Al-Talib, the other 13 saqrsm files** (51, 68–69, 89–90, 92, 103, 106–109, 112–113). The long ones (51, 68–69, 89–90, 92) did not reach both the first and the last ayah in the windows matched; the short ones heard < 80 % of the text. Listen first; they may well be complete.
- **Muhammad Rifaat.** Automatic alignment cannot read him (Phase 4.2). His complete recordings need human-assisted timing on a chosen transfer, not another batch.

**Verifications outstanding before the batch:**
1. saqrsm and Sobhi files: a listener confirms the voice and that nothing but the surah is recited (prayer recordings: takbīr, āmīn after al-Fātiḥa, rukūʿ pauses).
2. Rights: none of these sources permits app use today (§6). The experiment is local evidence only.

## 9. Safety checks

- **Baseline taken before any work, re-verified after it:** SHA-256 of the following are unchanged:
  - `audit-results.json`, `measured-timing.json`, `development/development-timing.json`, `surah-mode-approvals.json`, `providers.mjs`, `reciters.mjs`, `alignment/batch-exclusions.json`;
  - every `mobile/src/audio/generated/*.ts` and `mobile/src/audio/sourceRegistry.ts`;
  - the Phase 4.1 batch `summary.json`;
  - all 486 files of `audio-review-packages-2026-10-18` (one aggregate hash).
- **Files added to the repository:** this document and `tools/quran-audio/audit-data/missing-surah-candidates-2026-10-18.json`. Nothing else in the repository was edited.
- No alignment was run, no timing was produced, no package was rebuilt, and no app test was needed (no app code touched).
- No message was sent to any provider.
- No scratch audio was deleted.
- Rate of access: single-file range requests and downloads; no bulk mirroring beyond the files analysed (§10).

## 10. Evidence, scratch data and limits

Scratch root: `%TEMP%/claude/…/53a6810f-2599-4dfe-a8f6-5046dce3145f/scratchpad/p46/`.
- `dl/`: downloaded candidates, by provider. Originals, never modified: Way2Quran 15 files; Assabile 6; OurQuraan 3 plus heads; midad 114 + 3; archive.org 21; MP3Quran Talib 002 plus references.
- `asr/`: transcripts.
- `work/`: scripts and evidence JSON (`sameperf.json`, `voiceclass-*.json`, `rifaat-map.json`, `rifaat-chain.json`, `rifaat_ranges.json`, `asr-summary.json`, `baseline-sha256.txt`).

The earlier Phase 4.5 scratch (`5f2e2c26…/scratchpad/p45`) was reused, not repeated: its MP3Quran Rifaat audio, its archive.org searches and the collector files it downloaded. Some of those files are 170-byte HTTP 500 pages, which is why several transfers could not be compared.

Limits:
- **A second Claude session was running Phase 4.5 work on this machine at the same time** (`tf_verify.py` with Whisper-turbo on Rifaat). Its processes were left untouched. Its GPU load is why part of the ASR ran sparse on the CPU.
- The King Fahd Complex is still unreachable (TCP timeouts), so its official recordings and terms remain unexamined.
- No listening was done (I cannot listen). Every identity and completeness statement is automated and needs a person.
