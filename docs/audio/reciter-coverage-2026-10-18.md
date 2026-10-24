# Reciter coverage and ayah timing — Phase 4 (2026-10-18)

Status of all 17 reciters after Phase 4. **Superseded by docs/audio/alignment-phase-4-1-2026-10-18.md** (corrections and new coverage); kept as the Phase 4 record. **Production** = the committed, audited catalogue (unchanged: 1,148 surahs).
**Development** = timing loaded only by development builds (`__DEV__`, `mobile/src/audio/generated/developmentTiming.ts`),
never by a release until the owner promotes it. **Candidate** = experimental aligned timing, kept outside the
repository, that plays nowhere until a listening review approves it.

## Coverage

| Reciter | Production (ayah by ayah) | Listed by MP3Quran | Untimed listed surahs | Measured (tried / accepted → development) | Aligned candidates (test batch) | Development total | Not recorded on MP3Quran |
|---|---|---|---|---|---|---|---|
| Abdul Basit | 114 | 114 | 0 | – | – | 114 | 0 |
| Muhammad Siddiq Al-Minshawi | 107 | 114 | 7 | 7 / **5** | – | 112 | 0 |
| Ahmed Naeena | 113 | 114 | 1 | 1 / 0 | – | 113 | 0 |
| Mahmoud Khalil Al-Husary | 103 | 114 | 11 | 11 / **2** | – | 105 | 0 |
| Mahmoud Ali Al-Banna | 1 | 114 | 113 | – (EveryAyah: another take) | 3 | 1 | 0 |
| Yasser Mahmoud Salama | 0 | 114 | 114 | – (EveryAyah: another recording) | 3 | 0 | 0 |
| Saud Al-Shuraim | 89 | 114 | 25 | 25 / **22** | – | 111 | 0 |
| Abdul Rashid Ali Sufi | 101 | 114 | 13 | – (no EveryAyah set) | 3 | 101 | 0 |
| Ali Al-Hudhaifi | 103 | 114 | 11 | – (production measured already) | – | 103 | 0 |
| Abu Bakr Al-Shatri | 101 | 114 | 13 | 13 / **9** | – | 110 | 0 |
| Ahmed Al-Ajmi | 107 | 114 | 7 | – (EveryAyah: another recording) | 3 | 107 | 0 |
| Maher Al-Muaiqly | 101 | 114 | 13 | – (EveryAyah: another recording) | 3 | 101 | 0 |
| Abdullah Basfar | 108 | 114 | 6 | – (EveryAyah: another recording) | 2 | 108 | 0 |
| Saleh Al-Talib | 0 | 32 | 32 | – | 3 | 0 | 82 |
| Muhammad Rifaat | 0 | 31 | 31 | – | 3 | 0 | 83 |
| Islam Sobhi | 0 | 109 | 109 | – | 3 | 0 | 5 |
| Ahmed Mohamed Salama | 0 | 0 | 0 | – | – | 0 | 114 (Assabile only, no permission) |
| **Total** | **1,148** | | | **57 / 38** | **26** | **1,186** | |

Ahmed Mohamed Salama is not Yasser Mahmoud Salama: he has no recording in the app (Assabile only; no permission).

## Development timing (measured): 38 surahs

Method: unchanged production measured timing (`audit/align_everyayah.py`; every 3 s piece of every ayah's EveryAyah clip
located in order in the app's MP3Quran file at ≥ 0.7; no unexplained jump > 0.5 s inside an ayah; no overlap; pauses
≤ 4 s), then the full boundary sweep and the production withdrawal rules (opening letters, block offset). Same-recording
probe (surahs 103 and 112, every chunk): Minshawi 0.946–0.947, Husary 0.940–0.942, Shuraim 0.874–0.907, Shatri
0.871–0.902, Naina 0.827–0.864; Ajmi 0.157 and Basfar 0.162–0.512 are other recordings.

| Reciter | Accepted (development) | Not accepted, and why |
|---|---|---|
| Minshawi | 52, 54, 55, 56, 57 | 9 (9:76 an 18 s gap, 9:93 not found), 53 (53:2–3 pieces at 0.67–0.69) |
| Husary | 1, 98 | 21, 27, 28, 31, 46, 47, 49, 58, 66: pauses of 4.0–7.8 s between ayahs exceed the audited 4 s rule (his slow murattal); the rule was **not** loosened |
| Shuraim | 9, 12, 17, 19, 25, 40, 65, 80, 87, 88, 90, 91, 92, 94, 95, 96, 97, 98, 99, 101, 107, 113 | 89, 93, 103 (ayah 1 not found) |
| Shatri | 19, 32, 103, 106, 107, 108, 110, 112, 113 | 7 (7:52 gap), 36, 41, 42 (pieces not found: another take) |
| Naina | — | 18 (18:63 not found) |

Boundary sweep of the 38: 902 / 1,286 boundaries in a pause; none withdrawn. Minshawi, Husary and Shatri: 0–2
review boundaries each. **Shuraim's 22 surahs are review-heavy (380 boundaries "unconfirmed")**: his recording is
reverberant, so the energy test cannot see pauses, as in the production audit, where Shuraim already had 338
unconfirmed boundaries in 42 enabled surahs. Every ayah's audio was still located in order. Listen before any
promotion.

## Aligned candidates (no per-ayah reference): 26 surahs, none activated

`alignment/run-batch.mjs` (MMS CTC, no-star primary and star comparison, pause snapping, structure checks, ambiguity
flags, completeness). Candidates and their listening worklists are outside the repository
(`Working progress/Screenshots and Logs/audio-candidates-2026-10-18/`), for `review/review.html`.

| Reciter | Surahs (flagged / boundaries) | Reading |
|---|---|---|
| Yasser Salama | 103 (0/2), 67 (0/29), 18 (1/109) | Cleanest; identity «ياسر محمود سلامة» is still unconfirmed (MP3Quran names «ياسر سلامة») |
| Maher (withdrawn surahs) | 3 (0/199), 36 (0/82), 68 (2/51) | Against Quran Foundation's timing of the same performance (audit evidence only): 316/331 within 150 ms of its pause; 14 inside the right pause but 0.15–0.64 s early; ~~68:12 in the wrong pause, 1.17 s early, unflagged~~ **corrected in Phase 4.1: 68:12 is right** (the reference gives the held initial mīm of «مَّنَّاعٍ» to ayah 11, and the 2026-10-17 cross-check measured this file 1.4 s off; see alignment-phase-4-1-2026-10-18.md) |
| Sufi | 44 (0/58), 19 (2/97), 7 (1/205) | Few flags |
| Banna | 103 (0/2), 67 (2/29), 18 (13/109) | Moderate |
| Saleh Al-Talib | 25 (5/76), 56 (31/95), 86 (structure failed: two boundaries in one pause) | Mixed |
| Islam Sobhi | 103 (0/2), 67 (16/29), 18 (53/109) | Many "no pause": joined recitation; heavy listening |
| Ajmi | 106 (3/3), 74 (45/55), 4 (47/175) | Heavy flags |
| Basfar | 100 (3/10), 91 (8/14) | Heavy flags on short surahs |
| Muhammad Rifaat | 18, 55, 86: every boundary flagged | Alignment does not confirm the text (median scores 0.13–0.23 vs wrong-text control 0.17): unusable without listening end to end |

A boundary rule tested and rejected: placing the boundary 150 ms before the aligned onset (instead of the pause's middle)
puts 27 of 883 reference-checked boundaries outside the reference pause, against 14.

## What remains for each reciter to be complete

- **Listening review** (owner) of every development surah before promotion, Shuraim's first; and of each candidate
  (review/review.html → development/apply-review.mjs).
- **Husary**: a decision on the 4 s pause rule for his recording (9 surahs otherwise measured whole).
- **Remaining candidates**: run `alignment/run-batch.mjs` over the rest of the untimed listed surahs (about 450).
- **Identity / riwayah**: Yasser Salama's identity; Maher's recording is unlabelled (Hafs confirmed per surah by timing).
- **Missing recordings**: Talib (82), Rifaat (83), Sobhi (5) have no MP3Quran file; Ahmed Mohamed Salama has none
  permitted at all. Untimed whole-surah playback is not offered (Phase 4 decision).
- **Rifaat**: completeness unconfirmed (see flagged-recordings-2026-10-18.md).
