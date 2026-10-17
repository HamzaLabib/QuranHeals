# Quran audio — source audit (MP3Quran)

Audited 2026-10-17. Re-run with `tools/quran-audio/` (see its README). The app only plays
what this audit verified; everything else is listed as unavailable, never substituted.

## Verdict in one paragraph

All 16 reciters are on MP3Quran with a Hafs ʿan ʿĀṣim recording, and every file of every
chosen recording streams (HTTP 206 range responses, `Access-Control-Allow-Origin: *`).
Ayah-by-ayah playback needs MP3Quran's ayah timing, and that is the limiting factor:
**10 reciters have verified timing (1,073 surahs in total); 6 have none that can be
trusted.** MP3Quran's timing catalogue has real defects (missing ayahs, mislabelled
Basmala, zero-length ayahs, whole blocks misaligned with the audio), so each surah was
checked structurally and acoustically before being enabled.

## The 16 reciters

| # | Reciter | MP3Quran reciter / recording | Riwaya | Surahs recorded | Ayah timing (verified surahs) | Streaming | Offline storage | In the app |
|---|---|---|---|---|---|---|---|---|
| 1 | Abdul Basit Abdus Samad — عبد الباسط عبد الصمد | 51 / 53 (murattal, 32 kbps) | Hafs (labelled) | 114 | **114** | ✓ | Off in app (site-wide statement only) | Ayah playback, all surahs |
| 2 | Muhammad Siddiq Al-Minshawi — محمد صديق المنشاوي | 112 / 112 (murattal) | Hafs (labelled) | 114 | **108** (not 9, 52, 53, 55–57) | ✓ | Off in app | Ayah playback, gaps listed |
| 3 | Ahmed Naeena — أحمد نعينع | 9 / 9 | Hafs (labelled) | 114 | **113** (not 18) | ✓ | Off in app | Ayah playback, gap listed |
| 4 | Mahmoud Khalil Al-Husary — محمود خليل الحصري | 118 / 118 | Hafs (labelled) | 114 | **103** (not 1, 21, 27–28, 31, 46–47, 49, 58, 66, 98) | ✓ | Off in app | Ayah playback, gaps listed |
| 5 | Mahmoud Ali Al-Banna — محمود علي البنا | 121 / 121 | Hafs (labelled) | 114 | **0** — 121 has no timing; mujawwad 122's timing does not match its audio | ✓ | Off in app | Listed; no ayah playback |
| 6 | Yasser Mahmoud Salama — ياسر محمود سلامة | 152 / 152 ("ياسر سلامة" on MP3Quran) | Hafs (labelled) | 114 | **0** — no timing exists | ✓ | Off in app | Listed; no ayah playback |
| 7 | Saud Al-Shuraim — سعود الشريم | 31 / 31 | Hafs (labelled) | 114 | **89** (not 9, 12, 17, 19, 25, 40, 65, 80, 87–99, 101, 103, 107, 113) | ✓ | Off in app | Ayah playback, gaps listed |
| 8 | Abdul Rashid Ali Sufi — عبد الرشيد علي صوفي | 64 / 258 (r3) | Hafs (labelled) | 114 | **109** (not 106, 108, 111–113) | ✓ | Off in app | Ayah playback, gaps listed |
| 9 | Ali Al-Hudhaifi — علي الحذيفي | 74 / 74 | Hafs (labelled) | 114 | **0** — timing one ayah short in 112 surahs and misaligned | ✓ | Off in app | Listed; no ayah playback |
| 10 | Abu Bakr Al-Shatri — أبو بكر الشاطري | 4 / 4 | Hafs (labelled) | 114 | **107** (not 103, 106–108, 110, 112, 113) | ✓ | Off in app | Ayah playback, gaps listed |
| 11 | Ahmed Al-Ajmi — أحمد العجمي | 5 / 5 | Hafs (labelled) | 114 | **108** (not 4, 42, 74, 92, 106, 107) | ✓ | Off in app | Ayah playback, gaps listed |
| 12 | **Maher Al-Muaiqly — ماهر المعيقلي** (default) | 102 / **133** (المصحف المجود) | **REVIEW** — MP3Quran names no riwaya for this recording; Kufan ayah count verified | 114 | **114** | ✓ | Off in app | Ayah playback, all surahs |
| 13 | Abdullah Basfar — عبد الله بصفر | 60 / 60 | Hafs (labelled) | 114 | **108** (not 2, 91, 92, 100, 103, 111) | ✓ | Off in app | Ayah playback, gaps listed |
| 14 | Saleh Al-Talib — صالح آل طالب | 41 / 41 | Hafs (labelled) | **32** | **0** — no timing exists | ✓ | Off in app | Listed; no ayah playback |
| 15 | Muhammad Rifaat — محمد رفعت | 241 / 241 | Hafs (labelled) | **31** | **0** — no timing exists | ✓ | Off in app | Listed; no ayah playback |
| 16 | Islam Sobhi — إسلام صبحي | 253 / 253 | Hafs (labelled) | **109** | **0** — no timing exists | ✓ | Off in app | Listed; no ayah playback |

Excluded as instructed (and absent from the catalogue, by name and MP3Quran id): Mishary
Al-Afasy (123), Abdul Rahman Al-Sudais (54), Ahmed Mohamed Salama.

### Notes per reciter

- **Maher Al-Muaiqly (default).** MP3Quran's Hafs murattal (102) has no timing at all, so
  the app uses the mujawwad recording (133), the only Maher recording with timing. It
  passed every check (114/114 surahs, 655/656 boundaries in a pause). MP3Quran labels it
  only «المصحف المجود», not «حفص عن عاصم». Its ayah breaks follow the Kufan count
  (Basmala = ayah 1 of al-Fātiḥa, all 6,236 ayahs), which is consistent with Hafs but also
  with Shuʿba. **One listening check settles it:** Hafs has a sakt at 18:1–2 («عِوَجًا ۜ
  قَيِّمًا») and at 36:52 («مِن مَّرْقَدِنَا ۜ هَٰذَا»); Shuʿba does not.
- **Abdul Basit.** The only timed Hafs murattal is a 32 kbps file set (lower audio
  quality, 0.45 GB in all). The 128 kbps mujawwad (51) has timing that runs 1.5–2 s early
  against its audio, so it is not used.
- **Yasser Mahmoud Salama.** MP3Quran lists "ياسر سلامة" (152). That this is the same
  reciter as «ياسر محمود سلامة» is **not independently confirmed (REVIEW)**. It makes no
  practical difference while the recording has no timing.
- **Incomplete recordings** (Saleh Al-Talib 32, Muhammad Rifaat 31, Islam Sobhi 109
  surahs) are kept and listed with their gaps. None has timing, so none can be played
  ayah by ayah today.

## How timing was verified (per surah)

A surah is enabled only if all of these pass, in this order:

1. **Structural.** Timing for every ayah 1…N in order (N from the app's canonical Kufan
   counts, 6,236 in total). Every ayah has a positive length, there are no overlaps, and
   the last ayah ends inside the audio file (its duration taken from the CBR frame
   header). Failures found this way include missing ayahs in surah 9 (three reads),
   Husary's al-Fātiḥa (Basmala labelled "ayah 0", six ayahs), Basfar 2:149 (zero
   length), Shuraim 12/65/91 (wrong counts) and Hudhaifi (one ayah short in 112 surahs).
2. **Acoustic.** For sampled boundaries, the audio around the stated time was fetched by
   byte range (the files are CBR, so a byte offset maps exactly to a time) and decoded.
   The check: is there a pause within 300 ms of the boundary? Mid-ayah points were
   measured the same way as a control.
   - Whole recordings: aligned reads put 83–100% of boundaries in a pause, against 3–24%
     for the controls.
   - Rejected outright: Abdul Basit mujawwad (21%), Banna mujawwad (19%) and Hudhaifi
     (57%). Their deepest pause sits consistently 0.5–2 s after the stated boundary, or
     shows no relationship to it.
   - Kept despite lower scores: Shuraim and Ajmi. Their deepest pause is concentrated at
     offset 0; their recordings simply have more reverb.
   - Per surah: 6 boundaries were tested in every surah of every accepted read, and
     every surah below 80% was re-tested with up to 25 boundaries. Surahs still below
     80% are excluded. For example, Shuraim 87–98 scored 0/25: a whole block offset
     from its audio.
3. **Fingerprint.** The exact timing that passed is fingerprinted (FNV-1a over
   ayah:start:end). The app fetches timing from MP3Quran at run time and uses it only if
   it matches that fingerprint, so a later change at the source can never be used
   unchecked. Live check on 2026-10-17: 1,073/1,073 surahs match, and all audio sizes
   match.

**Limits of this evidence.** The acoustic check confirms that boundaries fall in pauses.
It cannot prove every individual ayah boundary (about 6–25 of them were sampled per
surah, not all 6,236), and it does not listen for the riwaya. No word-level timing exists
for these recordings, and none is claimed.

## Page turning without word timing

Every one of the 604 QCF V1 pages begins with the first word of an ayah. This was checked
on the local Content Sync snapshot: 0 pages start mid-ayah. So "turn the page when the
recitation reaches the next page" is exact at ayah level, and playing a page from its
start never needs a timestamp inside an ayah.

## Rights and terms

| Question | MP3Quran's published position | Status |
|---|---|---|
| Streaming in a mobile app | Its privacy page, "Copyrights": *"All rights are available to everyone, and we allow any visitor or developer to copy any material or use any link on the websites"* (Arabic: «جميع الحقوق متاحة للجميع و يحق لأي زائر أو مطور استخدام اي مادة أو رابط من الموقع»). It runs a public developer API (v3) for this purpose. | Permitted |
| Downloading | Covered by "copy any material". | Permitted |
| Permanent offline storage | Covered by "copy any material" (site-wide; no per-recording terms are published). | **Turned off in the app** until recording-specific confirmation — see caveat |
| Attribution | None demanded. Credited anyway: Settings ("Recitations: MP3Quran") and Quran Sources & Credits (MP3Quran, with links to the site and its rights statement). | Done |
| Redistribution of the audio | Not addressed beyond the statement above. The app does not redistribute files; it stores them for the user only. | n/a |

Source: https://www.mp3quran.net/eng/privacy (HTTP 200, 2026-10-17); the Arabic page has
the same statement. MP3Quran publishes no separate terms page (`/eng/terms` returns 404),
and its API documentation pages carry no licence text.

**Caveat (REVIEW, legal).** The grant is MP3Quran's own, site-wide statement. Whether
MP3Quran holds the rights to grant it for every recording (for example historical radio
recordings of Sheikh Muhammad Rifaat or Sheikh Abdul Basit) was not independently
established. Downloads are therefore **turned off** (`OFFLINE_DOWNLOADS_PERMITTED = false` in
`mobile/src/audio/reciters.ts`) until written confirmation from MP3Quran
(contact: https://www.mp3quran.net/eng/contact-us) covers the recordings.

## Alternative sources considered

For the six reciters without usable MP3Quran timing:

- **Quran Foundation (quran.com) audio API.** Has segment timing for some reciters, but
  requires the developer credentials and terms already used for Content Sync, plus a
  backend relay. Its catalogue was not confirmed to include the missing six. **Not
  integrated.**
- **EveryAyah.com.** Per-ayah files for some reciters, with no published licence that
  explicitly authorizes app use. **Not used.**

The engine has a source seam (`mobile/src/audio/sources.ts`): an authorized provider with
its own audited timing can be added there without changing the player.
