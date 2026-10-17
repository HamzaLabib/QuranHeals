# Quran audio — source audit

First audit 2026-10-17 (MP3Quran timing, sampled boundaries); second audit the same day (every boundary, Maher
Al-Muaiqly cross-checked against a second timing, measured timing for recordings MP3Quran has no usable timing for,
and a 17th reciter). Re-run with `tools/quran-audio/` (see its README). The app only plays what this audit verified;
everything else is listed as unavailable, never substituted.

## Verdict in one paragraph

17 reciters are listed. 16 have a Hafs ʿan ʿĀṣim recording on MP3Quran that streams (HTTP 206 range responses), and the
app streams only those files. **12 reciters can be played ayah by ayah, in 1,148 surahs**: 1,044 with MP3Quran's own
timing (10 reciters) and 104 with timing the audit measured for the MP3Quran file itself (Ali Al-Hudhaifi 103 surahs,
newly recovered, and Mahmoud Ali Al-Banna 1 surah). **5 reciters have no ayah playback**: Yasser Mahmoud Salama, Saleh
Al-Talib, Muhammad Rifaat and Islam Sobhi (recordings without any usable timing) and Ahmed Mohamed Salama (no recording
usable in the app at all). The second audit tested every boundary instead of a sample and **withdrew 29 surahs whose
MP3Quran timing was proven wrong**, 13 of them Maher Al-Muaiqly's, so the default reciter now plays 101 surahs, not 114.

## The 17 reciters

| # | Reciter | Provider / recording | Riwaya | Recorded | Ayah playback (verified surahs) | Not playable ayah by ayah | Bitrate | Legal use | Result |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Abdul Basit Abdus Samad — عبد الباسط عبد الصمد | MP3Quran 51 / 53 (murattal) | Hafs (MP3Quran label) | 114 | **114** (MP3Quran timing) | — | 32 kbps | Streaming: MP3Quran grant | Complete |
| 2 | Muhammad Siddiq Al-Minshawi — محمد صديق المنشاوي | MP3Quran 112 / 112 | Hafs (label) | 114 | **107** | 9, 52–57 | 128 kbps | MP3Quran grant | Partial |
| 3 | Ahmed Naeena — أحمد نعينع | MP3Quran 9 / 9 | Hafs (label) | 114 | **113** | 18 | 128 kbps | MP3Quran grant | Partial |
| 4 | Mahmoud Khalil Al-Husary — محمود خليل الحصري | MP3Quran 118 / 118 | Hafs (label) | 114 | **103** | 1, 21, 27–28, 31, 46–47, 49, 58, 66, 98 | 128 kbps | MP3Quran grant | Partial |
| 5 | Mahmoud Ali Al-Banna — محمود علي البنا | MP3Quran 121 / 121 | Hafs (label) | 114 | **1** (108, measured) | 1–107, 109–114 | 128 kbps | MP3Quran grant | Partial |
| 6 | Yasser Mahmoud Salama — ياسر محمود سلامة | MP3Quran 152 / 152 ("ياسر سلامة") | Hafs (label); identity **REVIEW** | 114 | **0** | all | 128 kbps | MP3Quran grant | Unavailable |
| 7 | Saud Al-Shuraim — سعود الشريم | MP3Quran 31 / 31 | Hafs (label) | 114 | **89** | 9, 12, 17, 19, 25, 40, 65, 80, 87–99, 101, 103, 107, 113 | 128 kbps | MP3Quran grant | Partial |
| 8 | Abdul Rashid Ali Sufi — عبد الرشيد علي صوفي | MP3Quran 64 / 258 | Hafs (label) | 114 | **101** | 7, 19, 40–44, 46, 106, 108, 111–113 | 128 kbps | MP3Quran grant | Partial |
| 9 | Ali Al-Hudhaifi — علي الحذيفي | MP3Quran 74 / 74 | Hafs (label) | 114 | **103** (measured) | 3–4, 6, 11, 28–29, 38–39, 42, 51, 54 | 64 kbps | MP3Quran grant | Partial (recovered) |
| 10 | Abu Bakr Al-Shatri — أبو بكر الشاطري | MP3Quran 4 / 4 | Hafs (label) | 114 | **101** | 7, 19, 32, 36, 41–42, 103, 106–108, 110, 112–113 | 128 kbps | MP3Quran grant | Partial |
| 11 | Ahmed Al-Ajmi — أحمد العجمي | MP3Quran 5 / 5 | Hafs (label) | 114 | **107** | 4, 20, 42, 74, 92, 106–107 | 160 kbps | MP3Quran grant | Partial |
| 12 | **Maher Al-Muaiqly — ماهر المعيقلي** (default) | MP3Quran 102 / **133** | **Hafs — Quran Foundation's label for the same performance; not officially confirmed (listening check outstanding)** | 114 | **101** | 3, 7, 19, 26, 29, 32, 34, 36, 40–42, 44, 68 | 96 kbps | MP3Quran grant | Partial |
| 13 | Abdullah Basfar — عبد الله بصفر | MP3Quran 60 / 60 | Hafs (label) | 114 | **108** | 2, 91–92, 100, 103, 111 | 128 kbps | MP3Quran grant | Partial |
| 14 | Saleh Al-Talib — صالح آل طالب | MP3Quran 41 / 41 | Hafs (label) | **32** | **0** | all | 128 kbps | MP3Quran grant | Unavailable |
| 15 | Muhammad Rifaat — محمد رفعت | MP3Quran 241 / 241 | Hafs (label) | **31** | **0** | all | 128 kbps | MP3Quran grant; rights to historical recordings **REVIEW** | Unavailable |
| 16 | Islam Sobhi — إسلام صبحي | MP3Quran 253 / 253 | Hafs (label) | **109** | **0** | all | 128 kbps | MP3Quran grant | Unavailable |
| 17 | Ahmed Mohamed Salama — أحمد محمد سلامة | **none in the app** (only found: Assabile) | Hafs (Assabile's label) | 114 on Assabile, 0 in the app | **0** | all | 32 kbps (Assabile) | **No permission** published by Assabile | Unavailable |

"Recorded" is the surahs the recording has. Every surah of every recording used streams; "Not playable" surahs are
listed in the app ("Not available for this surah") and never filled with another voice. Offline downloads stay **off**
(`OFFLINE_DOWNLOADS_PERMITTED = false`) for every reciter; no audio is bundled in the app. Excluded as instructed:
Mishary Al-Afasy (MP3Quran 123) and Abdul Rahman Al-Sudais (54). Ahmed Mohamed Salama, excluded in the first audit, was
added on request (2026-10-17).

## Maher Al-Muaiqly (default)

**Recording.** MP3Quran 133 (r3, «المصحف المجود», 96 kbps) is kept. MP3Quran's Hafs murattal 102 (r1) still has no
timing, so it cannot play ayah by ayah.

**Riwaya.** MP3Quran files 133 under a style category, not a riwaya: its `moshaf_type` 222 is "riwaya" 22,
«المصحف المجود», a bucket that also holds the Minshawi, Husary, Abdul Basit, Banna, Tablawi and Mustafa Ismail mujawwad
recordings. It states no riwaya; it neither confirms Hafs nor implies another. New evidence: **Quran Foundation's
chapter reciter 159** (Maher al-Muaiqly, `qirat: Hafs`, `style: Murattal`, files
`download.quranicaudio.com/quran/maher_almu3aiqly/year1440/`) **is the same performance as MP3Quran 133**, encoded
separately: decoded and cross-correlated, every file tested (1, 36, 103, 112) has one constant lag of 25 ms (one MP3
frame) and a correlation of 0.86–0.92 in every 10 s window (Ya-Sin: all 117 windows), against −0.02 for the unrelated
recording 102; the files differ by exactly one MPEG frame. So the recording the app plays is labelled Hafs by a second,
independent provider. That is a provider label, not the King Fahd Complex's confirmation, and no listener has checked
it yet: the result is **Hafs (labelled), not confirmed**. Listening check: 18:1–2 «عِوَجًا ۜ قَيِّمًا» (sakt in Hafs
when joined), 18:2 «مِّن لَّدُنْهُ» (Hafs; Shuʿba «مِن لَّدْنِهِۦ»), 36:52 «مِن مَّرْقَدِنَا ۜ هَٰذَا».

**Timing.** Two independent timings of the same performance (MP3Quran's, as audited, and Quran Foundation's) were
compared at all 6,122 boundaries (ayah 2 onwards in every surah; all 114 MP3Quran files still match the audited
fingerprints): **6,042 agree within 0.5 s** of their constant offset (MP3Quran marks the middle of the pause, Quran
Foundation the first word, ~0.49 s later). Every one of the 80 disagreements was tested in the audio: at **15
boundaries MP3Quran's start is inside recitation while Quran Foundation's is in the pause** — 3:2, 3:166, 7:2, 19:2,
26:2, 29:2, 32:2, 34:25, 36:2, 40:2, 41:2, 42:3, 42:53, 44:2, 68:12 — mostly the ayah after the separate opening
letters (الم، المص، كهيعص، طسم، يس، حم، عسق), stated about 2 s early, inside the letters' long madd. There, a single
ayah stops ~2 s early and the next starts with the previous ayah's tail. Those **13 surahs are withdrawn** (3, 7, 19,
26, 29, 32, 34, 36, 40, 41, 42, 44, 68). The first audit sampled 6–25 boundaries per surah and missed them. At 28:65
neither timing is in a pause; 28 stays enabled (review). Evidence: `tools/quran-audio/audit-data/maher-qf-crosscheck-2026-10-17.json`.

**Why the withdrawn surahs cannot be recovered now.** Quran Foundation's timing cannot be shipped in the app: its
Developer Terms forbid keeping QF content longer than 7 days outside Content Sync and "a prepackaged database or
build-time bundle of QF Content". Using it at run time would need a backend relay with a cache of at most 7 days — a
new architecture, not done without approval. EveryAyah's Maher sets (64 and 128 kbps) are a third, different recording
(no clip locates in either MP3Quran recording; scores ≤ 0.55). The King Fahd Complex's official Hafs recording with
verse files (qurancomplex.gov.sa, qc-dev.qurancomplex.gov.sa) **could not be reached**: TCP connections to 66.9.131.70
time out from this machine and are refused from the web-fetch service, so its recording, verse files, URLs and
licence could not be examined.

## Second audit: every boundary

The first audit's acoustic test (is there a pause within 300 ms of a stated boundary?) was run on **all 58,670
boundaries** of the 1,073 enabled surahs (`audit/boundary_sweep.py`; all timing still matched the audited
fingerprints). 93.3–99.9% of each reciter's boundaries are in a pause. Each boundary not in a pause is classed:

- **displaced:** clearly inside recitation (energy ≥ 0.6 × the window median) with a real pause (≥ 150 ms) within 2 s.
  This is the signature of Maher's proven errors (0.7–1.6 s from their pause: 11 of 11 flagged for Maher are proven by
  the cross-check). It is also what two ayahs joined in recitation (wasl) look like when a pause falls in a nearby word:
  37:152 «وَلَدَ ٱللَّهُ», joined to 37:151 by convention, is flagged for five reciters.
- **unconfirmed:** anything else not in a pause (continuous recitation, reverberation: Husary, Shuraim, Ajmi).

**Withdrawn (an established error)**, in addition to Maher's 13 above:

- **After the opening letters**, displaced: Sufi 7, 19, 40, 41, 42, 43, 44, 46; Shatri 7, 19, 32, 36, 41, 42; Ajmi 20.
  Separate-letter ayahs are always followed by a stop, so a boundary there inside recitation cannot be wasl.
- **Block offset:** Minshawi 54 — 24 boundaries in a row stated 0.3–0.6 s before their pause.

In all, **29 surahs** were withdrawn (Maher 13, Sufi 8, Shatri 6, Minshawi 1, Ajmi 1): 1,073 → 1,044.

### Boundaries left for review

Not withdrawn (the test cannot tell an error from wasl or reverberation), still enabled, and to be checked by
listening. The full list, with measurements, is in `audit-results.json` (`review`) and
`audit-data/boundary-sweep-2026-10-17.json`.

| Reciter | Displaced boundaries (start of these ayahs) | Unconfirmed |
|---|---|---|
| Abdul Basit | 2:29, 2:93, 2:193, 2:200 | 0 |
| Minshawi | 3:33, 3:52, 3:113, 3:186, 6:13, 6:95, 37:152 | 1 in 1 surah |
| Naina | 10:97, 11:119, 20:34, 20:93, 26:97, 30:3, 30:4, 30:5, 36:66, 37:138, 37:152, 39:18, 39:40, 40:72, 44:35, 44:44, 44:46, 51:28, 74:2, 91:4, 101:9 | 69 in 45 surahs |
| Husary | 7:71, 7:141, 7:146, 10:50, 23:61, 23:71, 23:81, 24:21, 26:131, 30:41, 43:81 | 353 in 55 surahs |
| Shuraim | 10:65, 18:85, 20:32, 20:34, 20:66, 27:10, 30:3, 36:3, 37:23, 44:44, 44:54, 52:6, 54:6, 55:2, 74:13, 74:36 | 338 in 42 surahs |
| Sufi | 3:41, 37:152 | 5 in 1 surah |
| Hudhaifi (measured) | 2:233 | 0 |
| Shatri | 2:106, 15:87, 20:107, 37:138, 37:152, 47:24, 50:22, 74:22, 95:2 | 29 in 19 surahs |
| Ajmi | 9:112, 24:50, 75:35, 76:27, 80:9, 81:2, 89:2, 93:2 | 166 in 45 surahs |
| Basfar | 5:65, 6:163, 11:19, 11:119, 15:99, 20:30, 20:32, 20:93, 20:107, 26:13, 26:40, 26:73, 26:80, 26:109, 26:182, 26:211, 27:92, 36:4, 36:61, 37:118, 37:138, 37:152, 37:154, 37:155, 39:18, 39:40, 43:35, 44:31, 53:20, 56:37, 56:38, 68:21, 70:23, 74:7, 74:19, 74:22, 74:33, 74:41, 75:27, 77:3, 77:17, 80:9, 86:12, 87:4, 87:15, 87:17, 88:16, 89:2, 89:3, 93:2, 96:12 | 103 in 45 surahs |

Maher: none left after the withdrawals.

## Measured timing (Ali Al-Hudhaifi, Mahmoud Ali Al-Banna)

Where MP3Quran's timing is missing or unusable, the audit measures timing **for the MP3Quran file itself** from
per-ayah files of the same recording (EveryAyah), which are only a reference: the app still streams the MP3Quran file
and never plays EveryAyah's. Method (`audit/align_everyayah.py`, `refine-results.mjs`): each ayah's file is located in
the MP3Quran surah file by log-spectral features (robust to re-encoding), then in 3 s pieces, each found on its own in
order. A surah is accepted only if every piece of every ayah scores ≥ 0.7 (two encodings of one recording score
~0.8–1, other audio below ~0.6), the two files never differ inside an ayah by more than 0.5 s except where the per-ayah
file has a pause that long, no ayah overlaps the next, and the result passes the same boundary sweep as MP3Quran's
timing. Each boundary is the per-ayah file's own cut point, kept inside the measured pause; ayah 1 still plays from the
file's start (istiʿādha and Basmala). The timing ships in the app (`generated/measuredTiming.ts`, 36 KB) and is checked
against the catalogue's fingerprint like MP3Quran's; it is valid only for the exact audio files measured, whose sizes
`check-live.mjs` checks.

- **Ali Al-Hudhaifi.** MP3Quran 74's own timing stays rejected (one ayah short in 112 surahs, misaligned).
  EveryAyah's `Hudhaify_128kbps` is cut from MP3Quran 74 (first test, 1 and 112: 0.91–0.96, clips chained end to start
  in order). **103 surahs accepted**; 4,980 of their 4,981 boundaries are in a pause (99.98%, against 93–99.9% for
  MP3Quran's own timing); 2:233 is displaced (review). Not accepted: 3, 4, 6, 29, 39, 51, 54 (from one ayah on, the
  per-ayah files are not found in the MP3Quran file, e.g. 6:84–165: a different take); 11 (11:93: a piece scoring 0.42);
  38 (38:1–2: the files differ by 0.8 s inside the ayah and 5.6 s between ayahs); 28 and 42 (a piece scoring 0.65–0.70).
  `Hudhaify_32kbps` aligns worse (0.80–0.84 with ambiguous runners-up) and was not used.
- **Mahmoud Ali Al-Banna.** EveryAyah's only Banna set (`mahmoud_ali_al_banna_32kbps`) is mostly a different take
  (e.g. Al-Mulk: 8 of 30 ayahs do not match MP3Quran 121). **1 surah accepted: 108** (all pieces ≥ 0.969). MP3Quran's
  mujawwad timing (122) stays rejected (it does not match its audio).

## The reciters without ayah playback

- **Yasser Mahmoud Salama.** MP3Quran 152 (114 surahs, labelled Hafs) has no timing. EveryAyah's `Yaser_Salamah_128kbps`
  is a **different recording** (no consistent placement in 152; Al-Mulk 1–8 scattered), so it cannot measure 152.
  MP3Quran names the reciter «ياسر سلامة» / "Yasser Salamah" and publishes no biography: that he is «ياسر محمود سلامة»
  is still **not confirmed (REVIEW)**.
- **Saleh Al-Talib** (32 surahs), **Muhammad Rifaat** (31), **Islam Sobhi** (109): the recorded counts were re-checked in
  MP3Quran's catalogue of 2026-10-17. None has a timing read on MP3Quran, a per-ayah set on EveryAyah, or an entry in
  Quran Foundation's or quranicaudio.com's catalogues.
- **Ahmed Mohamed Salama** (added). Not on MP3Quran, EveryAyah, Quran Foundation (12 recitations, 21 chapter reciters,
  production, 2026-10-17) or quranicaudio.com (177 reciters). The only recording found is on **Assabile**
  (assabile.com, reciter 367: 114 surahs, «Hafs from Asim, murattal», MPEG-2.5 32 kbps 11 kHz, byte-range streaming).
  It has no ayah timing and no per-ayah files, and Assabile publishes no terms or permission for app use (only
  "© 2008–2026 Assabile"; every terms URL tried returns 404). He is listed, with no recording in the app.

## Alternatives examined and rejected

| Source | Finding | Why not used |
|---|---|---|
| King Fahd Complex (qurancomplex.gov.sa, qc-dev…) — Maher and Hudhaifi Hafs verse files | Unreachable (TCP timeout / refused, 66.9.131.70) | Could not be examined at all; to retry from another network |
| Quran Foundation Content API (production credentials, 2026-10-17) | Recitations: 12; chapter reciters: 21. None of Banna, Yasser Salama, Hudhaifi, Saleh Al-Talib, Rifaat, Islam Sobhi, Ahmed Mohamed Salama. Maher 159 = MP3Quran 133's performance, labelled Hafs, with verse timing | Used as audit evidence only. Its timing cannot be bundled (Developer Terms); a backend relay would need approval |
| QF / quranicaudio files for Abdul Basit, Minshawi, Husary, Shuraim, Shatri, Ajmi | Same recordings as MP3Quran's, but different edits (Husary and Minshawi drift linearly against MP3Quran's files; Abdul Basit Al-Baqara has large jumps) | Not usable as a boundary reference without full alignment |
| EveryAyah Maher 64 / 128 kbps | A third recording | Cannot measure 133 or 102 |
| EveryAyah Yaser_Salamah_128kbps | Not MP3Quran 152's recording | Cannot measure 152; identity unconfirmed |
| EveryAyah Banna 32 kbps | Mostly a different take | 1 surah only |
| EveryAyah Hudhaify_32kbps | Same recording, poorer match | 128 kbps set used instead |
| MP3Quran timing 74 (Hudhaifi), 122 (Banna mujawwad), 51 (Abdul Basit mujawwad) | Rejected in the first audit | Unchanged |
| Assabile (Ahmed Mohamed Salama) | 114 surahs, 32 kbps, no timing | No permission; no timing |
| quranicaudio.com | Whole-surah files only; none of the missing reciters | No timing |

## How timing was verified (first audit, per surah)

A surah was enabled only if all of these passed, in this order:

1. **Structural.** Timing for every ayah 1…N in order (N from the app's canonical Kufan counts, 6,236 in total). Every
   ayah has a positive length, there are no overlaps, and the last ayah ends inside the audio file (its duration taken
   from the CBR frame header). Failures found this way include missing ayahs in surah 9 (three reads), Husary's
   al-Fātiḥa (Basmala labelled "ayah 0", six ayahs), Basfar 2:149 (zero length), Shuraim 12/65/91 (wrong counts) and
   Hudhaifi (one ayah short in 112 surahs).
2. **Acoustic.** For sampled boundaries, the audio around the stated time was fetched by byte range (the files are CBR,
   so a byte offset maps exactly to a time) and decoded: is there a pause within 300 ms of the boundary? Whole
   recordings: aligned reads put 83–100% of boundaries in a pause, against 3–24% for mid-ayah controls. Rejected
   outright: Abdul Basit mujawwad (21%), Banna mujawwad (19%), Hudhaifi (57%). Per surah: 6 boundaries, and up to 25 for
   any surah below 80%; surahs still below 80% were excluded (e.g. Shuraim 87–98: 0/25, a block offset).
3. **Fingerprint.** The exact timing that passed is fingerprinted (FNV-1a over ayah:start:end). The app fetches timing
   from MP3Quran at run time and uses it only if it matches, so a later change at the source is never used unchecked.

The second audit (above) replaced the sample by every boundary. **Live check, 2026-10-17 (after both audits):
1,148/1,148 surahs match** (MP3Quran timing fingerprints and audio sizes; measured timing: audio sizes).

**Limits of this evidence.** The pause test confirms that boundaries fall in pauses; it cannot prove which words are
recited, and it cannot judge boundaries inside continuous recitation (listed for review). The measured timing proves
that every ayah's audio is present, whole and in order, in the MP3Quran file — given that EveryAyah's files are
correctly cut and numbered, which was not independently checked. No listening check has been done; none is claimed.
No word-level timing is used.

## Page turning without word timing

Every one of the 604 QCF V1 pages begins with the first word of an ayah (checked on the local Content Sync snapshot: 0
pages start mid-ayah), so turning the page when the recitation reaches the next page is exact at ayah level.

## Rights and terms

| Provider | Use in the app | Published position | Status |
|---|---|---|---|
| MP3Quran | Streams every recording; its timing (fetched at run time) | Privacy page, "Copyrights": *"All rights are available to everyone, and we allow any visitor or developer to copy any material or use any link on the websites"* (https://www.mp3quran.net/eng/privacy, 2026-10-17; no separate terms page). Site-wide; whether MP3Quran holds the rights for every recording (e.g. historical recordings of Sheikh Muhammad Rifaat or Sheikh Abdul Basit) was not established. | Streaming: permitted. Offline storage: **off** until recording-specific written confirmation (contact: https://www.mp3quran.net/eng/contact-us). |
| EveryAyah | None at run time. Its per-ayah files were downloaded during the audit only to measure timing for MP3Quran's files; nothing of them is stored, shipped or played. | The site is a bare file listing; no terms, licence or source page (`data/source.php`: 404). | **REVIEW (legal):** confirm that timing measured this way (our own data, which does not reproduce their audio) needs no permission. |
| Quran Foundation | None in the app for audio. Its timing was read with the backend's existing production credentials as audit evidence; only verdicts are in the repository. | Developer Terms (https://api-docs.quran.foundation/legal/developer-terms): no cache beyond 7 days outside Content Sync; no build-time bundle; credit required where content is used. | Complies (nothing kept or shipped). |
| Assabile | None. | "© 2008–2026 Assabile"; no terms page. | Not permitted (no grant). |
| King Fahd Complex | None (unreachable). | — | Not examined. |

Attribution: Settings ("Recitations: MP3Quran") and Quran Sources & Credits, as before.

## Listening checks (not yet done)

1. Maher: 18:1–2, 18:2 «مِّن لَّدُنْهُ», 36:52 (riwaya); and two withdrawn boundaries, to confirm the finding (e.g. 36:1→2,
   3:1→2: MP3Quran's start should be heard ~2 s early).
2. Ali Al-Hudhaifi (measured): ayah starts and single-ayah stops in a few surahs (e.g. 2:255, 18:1–10, 36, 67, 112), a
   page turn, and a surah's last ayah.
3. Mahmoud Ali Al-Banna 108 (measured).
4. The displaced boundaries listed above (start each ayah; does it begin cleanly?).
5. Yasser Salama: whether MP3Quran's «ياسر سلامة» is Yasser Mahmoud Salama.
