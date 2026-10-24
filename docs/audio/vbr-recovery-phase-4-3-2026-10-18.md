# VBR recordings — Phase 4.3: seek recovery (2026-10-18)

The 32 variable-bit-rate (VBR) recordings blocked in Phase 4.1, each investigated and recovered.

Local only: nothing committed, no production or development catalogue or timing changed, nothing enabled in the app,
nothing approved. Recovered files exist only in local scratch storage. Evidence record:
`tools/quran-audio/audit-data/vbr-recovery-2026-10-18.json`.

**Results:**

| | Count |
|---|---|
| Investigated | 32 (Islam Sobhi 29, Yasser Mahmoud Salama 2, Ahmed Al-Ajmi 1) |
| Technically recovered (lossless, Android seeking validated with the real extractor) | **32** |
| Recordings with an unchanged, verified timeline (lossless route) | 32 |
| Recordings requiring timestamp corrections | 0 on the lossless route; on the CBR route all 32 need the measured, constant +25.06 ms |
| Recordings requiring new alignment | 0 |
| Still technically blocked | 0 |
| Newly eligible for listening review | **32** (review packages unblocked; Approve works; apply-review still refuses them, see below) |
| Requiring device verification | 32 (Android playback on a device; iOS entirely) |
| Requiring rights clearance before app use | 32 (a modified copy must be hosted) |
| Audio-quality change | none on the lossless route (identical decoded audio); CBR route 24.5–39.0 dB SNR re source (re-encoding loss) |

## 1. How the app seeks, and why these files fail

**The player.** expo-audio 57.0.5 has two platform paths:
- **Android:** `androidx.media3` **1.9.0**, `ProgressiveMediaSource` with default `Mp3Extractor` flags, and exact seeks (`seekTo(t, 0, 0)` in `mobile/src/audio/expoOutput.ts`).
- **iOS:** `AVPlayer.seek(to:toleranceBefore: .zero, toleranceAfter: .zero)`.

**Media3 1.9.0's MP3 seeking** (`Mp3Extractor.computeSeeker`, read from the 1.9.0 source):
- **Priority:** ID3 seek metadata (MLLT) first, then the seek frame (Xing, Info, VBRI), then a bitrate assumption from the first frame.
- **After a seek,** the frame where reading resumes is timestamped `seeker.getTimeUs(bytePosition)`, and the player drops frames timestamped before the target. So audio really starts at the target plus (true time of that frame − its label).

**What all 32 files are:**
- LAME-encoded VBR, with an Xing header frame carrying a 100-entry table of contents.
- Encoders: LAME 3.100 in 29 files, 3.99r in 1, 3.98r in 1, 3.93 in 1.
- Bitrates vary per frame across 4–13 distinct values (32–320 kbps).
- 27 files end in an ID3v1 tag, which only triggers a harmless "data size mismatch" log; 5 have none.
- No sync loss, junk, truncation, sample-rate change or other corruption was found in any file.

**Where the error comes from:** the Xing table stores, at each 1 % of the duration, the byte position quantised to 1/256 of the file. Media3 interpolates linearly between entries, and in a VBR file bytes are not proportional to time between two entries.

**Measured with the real extractor** (Media3 1.9.0's own `Mp3Extractor` run on the JVM, `audit/seek-probe/`), at every ayah start, every flagged boundary and 100 random points per file:
- audio starts from **8.35 s early to 5.35 s late**;
- even the shortest files miss by 0.07–0.32 s somewhere;
- for comparison, the production constant-bitrate files measure **0 to +26.1 ms** (always at most one 1,152-sample frame late).

**Root cause, confirmed for each of the 32:** the inaccuracy of Xing-table interpolation on VBR audio.
- It is confirmed because the real extractor uses `XingSeeker` for every file, and the error disappears with an exact table and nothing else changed.
- These are **not**: inaccurate duration metadata (the Xing frame counts equal the counted audio frames in every file), missing headers, corruption or timestamp offsets.

Phase 3's note "VBR seeks 0.5–1.8 s off" understated it: the error grows with file length.

## 2. Recovery methods evaluated

### A. Lossless re-indexing (recommended for Android): an ID3 MLLT seek table

`audit/vbr_recover.py mllt`:
- **Adds** an ID3v2.3 `MLLT` frame (MPEG location lookup table, one reference per audio frame, exact byte offsets and millisecond times) and a `TLEN` duration to each file's existing tag.
- **Copies unchanged** every other byte, including the Xing/LAME frame (so gapless trimming is unchanged) and every audio frame.
- **Cost:** 1–104 KB of tag per file, 938 KB across all 32.

**Validated per file:**
- **Integrity:** byte-identical audio frames and Xing/LAME frame; decoded audio identical sample for sample (SHA-1 of the PCM).
- **Timeline:** unchanged, so the existing ayah timestamps apply as they are.
- **Seeking:** the real extractor selects `MlltSeeker`. All **4,375 seeks** across the 32 files land between **−0.5 and +25.6 ms**, the same class as production files.
- **Not covered:** iOS. AVFoundation is not known to read MLLT, so on iOS the file would still seek through its Xing table, inaccurately. This is **unverified** and needs a device test.

### B. Constant-bitrate re-encode (the cross-platform alternative)

`audit/vbr_recover.py cbr`:
- **Encoder:** LAME via `lameenc` 1.7.0 (installed only in the scratch alignment environment), quality 2, same sample rate (44.1 kHz) and channels.
- **Bitrate:** the smallest standard rate ≥ 1.25 × the source mean (128–256 kbps). Total size 483 MB, against 359 MB for the originals.
- **No header frame:** LAME writes none here, so Media3 uses `ConstantBitrateSeeker` (exact byte arithmetic). iOS seeks constant-bitrate MP3 by the same arithmetic. Constant-bitrate MP3 is therefore the format both players are known to seek exactly, but iOS is still pending a device test.

**Validated per file:**
- **Timeline:** cross-correlation at 12 points from the first second to the last gives a **constant 1,105-sample delay (25.06 ms) with zero drift** in all 32. That delay is the encoder's 576 samples plus the decoder's 529. Correlation is at least 0.9986.
- **No inserted or removed silence:** no 1-second block changes level by more than 0.51 dB.
- **Length:** the extra samples are exactly the codec delay plus padding.
- **Timestamps:** shifted by the **measured** +25.06 ms. On the re-encoded audio, 1,265 of 1,267 boundaries keep their acoustic class. The two changes are threshold-edge cases (≈ 0.2 dB): Islam Sobhi 17:82 (echo tail → no clear silence) and 52:5 (the reverse).
- **Seeking:** the real extractor gives **0 to +26.1 ms** at the corrected ayah starts.
- **Quality:** 24.5–39.0 dB SNR re source. This is generational loss; it is lowest for Yasser Salama 42 at 128 k (26.0 dB) and Islam Sobhi 72 at 160 k (24.5 dB). Inaudibility is not established and needs listening.

### C. Not needed, or not possible here

- **A VBRI header with a finer table:** limited to the space of one frame (about 300–500 entries), so it would be coarser than MLLT. It would also replace the Xing/LAME frame and its gapless information. Not used.
- **App-side index seeking** (`Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING`): it would fix Android without changing files, but expo-audio does not expose extractor flags. It would need a native change and build, which is outside this phase's restrictions; it is recorded as an option.
- **Replacement recordings:** none is needed; no file is damaged.

## 3. What each recovered recording still needs

1. **Rights.** MP3Quran's grant covers streaming its files. Both recoveries are modified copies: one with added metadata, one re-encoded. Hosting either for the app needs MP3Quran's permission to redistribute a modified file, and none is recorded. The copies stay in local scratch storage (`p43/mllt`, `p43/cbr`).
2. **Device verification.**
   - *Android:* the extractor behaviour is verified with the real Media3 code, but the decoder, audio sink and device timing, and the in-app features, were not run on a device or emulator. Those features are Listen to Ayah, Repeat Ayah, Full Surah, auto-advance, highlighting, pause/resume and ayah-to-ayah seeking.
   - *iOS:* untested for both routes.
3. **Listening review,** as for every candidate. In the reviewer, use **Precise mode**: it decodes the file, so its positions match the timeline these timings are on.

**Review packages:**
- The 32 are now listening candidates (431 reviewable packages in all). Each carries its recovery evidence and a `playbackBlocked` reason, shown in the reviewer as "you can review and approve this surah, but it cannot be added to the app yet".
- `development/apply-review.mjs` **refuses** any package with `playbackBlocked`. An approval can be exported and kept, but nothing reaches development timing while the app would stream the unseekable original.
- That refusal is tested in `mobile/tests/audioReviewTools.test.ts`.

## 4. Per recording

*Yasser Salama's identity is still unconfirmed (MP3Quran names «ياسر سلامة»; Phase 4.1).*
"Seek validation" means media3 1.9.0's real `Mp3Extractor` on the JVM. Error ranges are where audio really starts relative to the target; positive means late.

| Reciter | Surah | File (encoder, length, kbps range / mean) | Original issue: media3 seek error | Root cause | Lossless MLLT: integrity / seek | CBR alternative: kbps, delay, SNR, seek | Timestamps | Seek validation | Listening review | Remaining blocker |
|---|---|---|---|---|---|---|---|---|---|---|
| Yasser Mahmoud Salama* | 42 Ash-Shura (الشورى) | LAME3.99r, 1048 s, 32–192 / 82.0 | -4.28 to +2.09 s (149/152 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.2 to +25.1 ms (152 seeks) | 128 k, +25.06 ms constant (drift 0), 26.0 dB, +0.8 to +26.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (52/52 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Yasser Mahmoud Salama* | 48 Al-Fath (الفتح) | LAME3.100, 677 s, 32–320 / 146.4 | -4.03 to +2.45 s (126/129 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.1 to +25.5 ms (129 seeks) | 192 k, +25.06 ms constant (drift 0), 29.3 dB, +0.3 to +26.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (28/28 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Ahmed Al-Ajmi | 42 Ash-Shura (الشورى) | LAME3.93, 999 s, 32–192 / 160.2 | -4.61 to +1.27 s (150/152 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.4 to +25.6 ms (152 seeks) | 224 k, +25.06 ms constant (drift 0), 31.7 dB, +0.2 to +26.0 ms | Pass: MLLT unchanged; CBR +25.06 ms (52/52 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 17 Al-Israa (الإسراء) | LAME3.100, 2041 s, 32–320 / 148.6 | -8.35 to +5.35 s (210/211 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.4 to +25.5 ms (211 seeks) | 192 k, +25.06 ms constant (drift 0), 28.3 dB, +0.6 to +25.9 ms | Pass: MLLT unchanged; CBR +25.06 ms (109/110 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 21 Al-Anbiyaa (الأنبياء) | LAME3.100, 1426 s, 32–320 / 161.2 | -5.03 to +4.98 s (206/212 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.4 to +25.5 ms (212 seeks) | 224 k, +25.06 ms constant (drift 0), 31.6 dB, +0.0 to +25.9 ms | Pass: MLLT unchanged; CBR +25.06 ms (111/111 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 23 Al-Muminoon (المؤمنون) | LAME3.100, 1367 s, 32–320 / 165.2 | -6.83 to +3.59 s (215/218 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.0 to +23.0 ms (218 seeks) | 224 k, +23.02 ms constant (drift 0), 31.2 dB, +0.3 to +23.4 ms | Pass: MLLT unchanged; CBR +23.02 ms (117/117 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 24 An-Noor (النور) | LAME3.100, 1754 s, 32–320 / 172.6 | -7.44 to +2.96 s (159/164 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.0 to +23.0 ms (164 seeks) | 224 k, +23.02 ms constant (drift 0), 30.5 dB, +0.6 to +23.9 ms | Pass: MLLT unchanged; CBR +23.02 ms (63/63 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 25 Al-Furqaan (الفرقان) | LAME3.100, 1055 s, 32–320 / 185.4 | -5.10 to +1.77 s (172/177 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.4 to +25.5 ms (177 seeks) | 256 k, +25.06 ms constant (drift 0), 35.3 dB, +0.1 to +26.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (76/76 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 29 Al-Ankaboot (العنكبوت) | LAME3.100, 1198 s, 32–320 / 168.3 | -4.32 to +2.29 s (163/169 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.3 to +25.3 ms (169 seeks) | 224 k, +25.06 ms constant (drift 0), 31.1 dB, +0.2 to +25.8 ms | Pass: MLLT unchanged; CBR +25.06 ms (68/68 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 30 Ar-Room (الروم) | LAME3.100, 996 s, 32–320 / 169.1 | -4.53 to +1.34 s (160/160 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.3 to +25.4 ms (160 seeks) | 224 k, +25.06 ms constant (drift 0), 30.9 dB, +0.1 to +26.0 ms | Pass: MLLT unchanged; CBR +25.06 ms (59/59 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 38 Saad (ص) | LAME3.100, 959 s, 32–320 / 180.6 | -5.09 to +1.42 s (186/188 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.2 to +25.6 ms (188 seeks) | 256 k, +25.06 ms constant (drift 0), 36.2 dB, +0.2 to +26.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (87/87 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 47 Muhammad (محمد) | LAME3.100, 618 s, 32–320 / 165.2 | -2.10 to +1.05 s (135/138 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.4 to +25.5 ms (138 seeks) | 224 k, +25.06 ms constant (drift 0), 30.9 dB, +0.2 to +25.7 ms | Pass: MLLT unchanged; CBR +25.06 ms (37/37 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 48 Al-Fath (الفتح) | LAME3.100, 671 s, 32–320 / 167.3 | -3.40 to +2.88 s (128/129 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.1 to +25.6 ms (129 seeks) | 224 k, +25.06 ms constant (drift 0), 30.7 dB, +0.0 to +26.0 ms | Pass: MLLT unchanged; CBR +25.06 ms (28/28 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 49 Al-Hujuraat (الحجرات) | LAME3.100, 477 s, 32–320 / 176.1 | -1.69 to +0.96 s (111/118 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.0 to +25.3 ms (118 seeks) | 224 k, +25.06 ms constant (drift 0), 31.1 dB, +0.1 to +26.0 ms | Pass: MLLT unchanged; CBR +25.06 ms (17/17 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 52 At-Tur (الطور) | LAME3.100, 418 s, 32–320 / 152.6 | -2.60 to +0.98 s (145/149 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.0 to +23.0 ms (149 seeks) | 192 k, +23.02 ms constant (drift 0), 29.3 dB, +0.3 to +23.8 ms | Pass: MLLT unchanged; CBR +23.02 ms (47/48 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 57 Al-Hadid (الحديد) | LAME3.100, 685 s, 40–320 / 159.9 | -2.70 to +2.48 s (125/129 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.0 to +23.0 ms (129 seeks) | 224 k, +23.02 ms constant (drift 0), 32.8 dB, +0.0 to +23.8 ms | Pass: MLLT unchanged; CBR +23.02 ms (28/28 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 62 Al-Jumu'a (الجمعة) | LAME3.100, 236 s, 32–320 / 165.9 | -0.95 to +0.49 s (99/111 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.3 to +25.5 ms (111 seeks) | 224 k, +25.06 ms constant (drift 0), 32.4 dB, +0.8 to +25.5 ms | Pass: MLLT unchanged; CBR +25.06 ms (10/10 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 72 Al-Jinn (الجن) | LAME3.98r, 357 s, 32–320 / 124.8 | -1.83 to +1.04 s (119/128 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.4 to +25.3 ms (128 seeks) | 160 k, +25.06 ms constant (drift 0), 24.5 dB, +0.2 to +25.7 ms | Pass: MLLT unchanged; CBR +25.06 ms (27/27 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 74 Al-Muddaththir (المدثر) | LAME3.100, 313 s, 32–320 / 190.2 | -0.91 to +0.76 s (143/156 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.3 to +25.4 ms (156 seeks) | 256 k, +25.06 ms constant (drift 0), 37.4 dB, +1.2 to +26.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (55/55 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 95 At-Tin (التين) | LAME3.100, 58 s, 40–320 / 178.1 | -0.21 to +0.16 s (64/108 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.4 to +25.5 ms (108 seeks) | 224 k, +25.06 ms constant (drift 0), 30.9 dB, +0.2 to +24.6 ms | Pass: MLLT unchanged; CBR +25.06 ms (7/7 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 98 Al-Bayyina (البينة) | LAME3.100, 107 s, 128–320 / 181.4 | -0.38 to +0.29 s (75/108 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.3 to +25.4 ms (108 seeks) | 256 k, +25.06 ms constant (drift 0), 38.0 dB, +0.1 to +25.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (7/7 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 99 Az-Zalzala (الزلزلة) | LAME3.100, 46 s, 32–320 / 195.8 | -0.22 to +0.13 s (62/108 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.8 to +25.5 ms (108 seeks) | 256 k, +25.06 ms constant (drift 0), 37.3 dB, +0.8 to +26.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (7/7 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 100 Al-Aadiyaat (العاديات) | LAME3.100, 50 s, 32–320 / 193.2 | -0.23 to +0.13 s (67/111 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.2 to +25.6 ms (111 seeks) | 256 k, +25.06 ms constant (drift 0), 37.8 dB, +0.3 to +25.9 ms | Pass: MLLT unchanged; CBR +25.06 ms (10/10 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 101 Al-Qaari'a (القارعة) | LAME3.100, 47 s, 32–320 / 187.0 | -0.15 to +0.14 s (41/111 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.1 to +24.8 ms (111 seeks) | 256 k, +25.06 ms constant (drift 0), 38.6 dB, +0.1 to +25.7 ms | Pass: MLLT unchanged; CBR +25.06 ms (10/10 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 104 Al-Humaza (الهمزة) | LAME3.100, 40 s, 32–320 / 194.1 | -0.14 to +0.32 s (44/109 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.2 to +25.3 ms (109 seeks) | 256 k, +25.06 ms constant (drift 0), 38.0 dB, +0.0 to +26.0 ms | Pass: MLLT unchanged; CBR +25.06 ms (8/8 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 105 Al-Fil (الفيل) | LAME3.100, 32 s, 32–320 / 172.0 | -0.13 to +0.06 s (29/105 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.3 to +25.6 ms (105 seeks) | 224 k, +25.06 ms constant (drift 0), 31.3 dB, +0.5 to +25.6 ms | Pass: MLLT unchanged; CBR +25.06 ms (4/4 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 106 Quraish (قريش) | LAME3.100, 27 s, 112–320 / 188.2 | -0.09 to +0.08 s (18/103 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.2 to +25.5 ms (103 seeks) | 256 k, +25.06 ms constant (drift 0), 37.5 dB, +0.0 to +25.7 ms | Pass: MLLT unchanged; CBR +25.06 ms (3/3 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 107 Al-Maa'un (الماعون) | LAME3.100, 40 s, 32–320 / 194.6 | -0.17 to +0.05 s (60/106 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.5 to +25.4 ms (106 seeks) | 256 k, +25.06 ms constant (drift 0), 37.8 dB, +0.9 to +26.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (6/6 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 108 Al-Kawthar (الكوثر) | LAME3.100, 17 s, 32–320 / 185.4 | -0.07 to +0.03 s (11/103 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.4 to +25.5 ms (103 seeks) | 256 k, +25.06 ms constant (drift 0), 37.5 dB, +0.8 to +25.7 ms | Pass: MLLT unchanged; CBR +25.06 ms (2/2 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 109 Al-Kaafiroon (الكافرون) | LAME3.100, 42 s, 56–320 / 199.9 | -0.19 to +0.06 s (60/105 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.5 to +25.5 ms (105 seeks) | 256 k, +25.06 ms constant (drift 0), 39.0 dB, +0.6 to +26.1 ms | Pass: MLLT unchanged; CBR +25.06 ms (5/5 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 110 An-Nasr (النصر) | LAME3.100, 23 s, 32–320 / 187.8 | -0.11 to +0.06 s (33/103 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / -0.5 to +25.5 ms (103 seeks) | 256 k, +25.06 ms constant (drift 0), 36.9 dB, +0.4 to +26.0 ms | Pass: MLLT unchanged; CBR +25.06 ms (2/2 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |
| Islam Sobhi | 111 Al-Masad (المسد) | LAME3.100, 27 s, 80–320 / 179.2 | -0.12 to +0.06 s (15/105 over 50 ms) | VBR + 100-entry Xing TOC interpolation (confirmed) | Pass: frames and decoded audio identical / +0.0 to +23.0 ms (105 seeks) | 224 k, +23.02 ms constant (drift 0), 32.4 dB, +0.5 to +23.8 ms | Pass: MLLT unchanged; CBR +23.02 ms (4/4 boundary classes kept) | Pass (Android extractor); device and iOS pending | Ready | Rights (hosting a modified copy); device test; listening |

## 5. Tests and checks run

**Executed:**
- `audit/test_vbr_recover.py` (new, 5 tests, synthetic VBR file): parser; Xing inaccuracy; MLLT copy keeps every audio byte and the LAME header; MLLT seeking within one frame; refuses a second MLLT.
- `alignment/test_flag_boundaries.py`: 3 tests.
- `mobile/tests/audioReviewTools.test.ts`: 11 tests, including the new playback-blocked refusal.
- All 12 audio test files: 226 passed.
- TypeScript and lint: clean.
- Full suite: 3,128 passed and 37 failed. The 37 are exactly the known Mushaf page-renderer failures, unrelated to audio.
- The reviewer was checked in headless Chrome on a recovered package.
- Source files are untouched (all 32 at their audited sizes).
- Production catalogue, timing and audit data equal HEAD, and the development timing is unchanged since Phase 4.2.

**Not executed** (device): Android playback on a device or emulator, and iOS. No device testing is claimed.

## 6. Changes in this phase

**New tools:**
- `audit/mp3frames.py`, frame-level MP3 inspection;
- `audit/seek_sim.py`, Media3 seek arithmetic and MLLT tables;
- `audit/vbr_recover.py`, the MLLT and CBR recoveries;
- `audit/seek-probe/`, the real-extractor probe (Java) with its README;
- `audit/test_vbr_recover.py`.

**Changed tools:**
- `review/make-packages.mjs`: a recovered VBR file is reviewable, with `recovery` and `playbackBlocked`.
- `alignment/summarize-batch.mjs`: the same rule.
- `development/apply-review.mjs`: refuses `playbackBlocked`.
- `review/review.html`: the banners.
- `mobile/tests/audioReviewTools.test.ts`: one test added.

**New evidence:** `audit-data/vbr-recovery-2026-10-18.json`.

**Not changed:** the app's playback code, the catalogues, the timing, Phase 4.1 and 4.2 results (Rifaat's 10 stay blocked and the 21 stay excluded), and the scratch audio.
