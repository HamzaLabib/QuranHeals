# Ahmed Mohamed Salama (أحمد محمد سلامة): aligned development preview (Phase 4, 2026-10-23/24)

Owner request: integrate the reciter into DEV with ayah-by-ayah synchronized playback, analyse every ayah automatically
under the existing policy (only Very High Risk and unresolved exceptions need a person), prepare review packages and
rehearse their import without touching the live dashboard. Nothing is committed, published, deployed or in a release.

Reciter id: the catalogue's existing `ahmed-salama` (no recording until now). **Not** Yasser Mahmoud Salama (`yasser-salama`).

## Verification levels

| Level | Status |
|---|---|
| Sources (listing, HTTP, size, SHA-256, format, tags) | all files of both candidate sources |
| Same performance across sources (feature location, both directions where lengths differ) | 107 surahs |
| Voice consistency (ECAPA, all 114 selected files, Yasser Salama as control) | done |
| Alignment (MMS CTC, two configurations, structure, flags, completeness) | 114 / 114 |
| Risk classification and auto-acceptance (existing rules) | rehearsed on restored copies of the real data |
| Automated app tests | pass |
| Live dashboard import | **not done: awaiting the owner's approval** |
| Native playback (Android, iPhone) | **UNVERIFIED** |
| Listening | none |

## Sources

| Source | Found | Format | Notes |
|---|---|---|---|
| Way2Quran `media.way2quran.com/ahmed-mohamed-salama/hafs-an-asim/NNN.mp3` | 107 / 114 (404: 4, 5, 7, 12, 16, 28, 29) | 128 kbps CBR, 44.1 kHz stereo | ID3: «www.islamweb.net \ إسلام ويب», ©2016, title «سورة … _القارئ:- أحمد محمد سلامة»; 6 and 18 have stream errors |
| Assabile reciter 367 | 114 / 114 | 32 kbps CBR, 11.025 kHz | ID3 «المصحف المرتل», www.assabile.com |

Both label the set «حفص عن عاصم». Every file answers byte ranges.

Same performance (`surah-sources/compare.py`): **106 of 107** surahs both sources have are the same performance (every piece found at a constant lag). The exception is 18: Way2Quran's file is edited (pieces found, lag spread 485 s). Way2Quran's 6 is 8.2 % shorter (cut). 16 short surahs are 0.5 s shorter on Way2Quran, and Assabile's pieces are all found in them (padding only). For Al-Fatiha one Assabile piece in six is not found.

**Selection** (one whole, unmodified file per surah, never spliced): **Way2Quran 104, Assabile 10** (1, 4, 5, 6, 7, 12, 16, 18, 28, 29).

**Identity**:
- No authoritative biography exists (Phase 4.6). islamweb.net's tags name the reciter: an attribution, not proof.
- Voice (ECAPA, `surah-sources/voice.py`): median similarity 0.881 to the series, minimum 0.597. Yasser Mahmoud Salama's MP3Quran files score 0.27–0.33 against it, so it is not Yasser.
- **Al-Fatiha (0.597), Āl ʿImrān (0.650) and Al-Anʿām (0.651)** stand apart (all others ≥ 0.722): their voice is to be confirmed by ear.

**Riwaya**: Hafs by both sites' labels; the alignment found the Kufan ayah set, in order, in all 114 (structure checks).

**Rights**: none of these sources grants use in an app. Development preview only.

## Alignment and risk

114 surahs, 6,236 ayahs, 6,122 inter-ayah boundaries + 114 openings. Structure ok 114/114; completeness: no collapsed
ayah, lowest surah median text score 0.357 (blocking threshold 0.30; wrong-text controls 0.17–0.18). Boundary flags:
low-score 642, short-pause 249, configs-disagree 92, no-pause 87, competing-pause 39, anchored 33, snap-far 28,
extra-audio 21, shallow-pause 13, past-own-end 1.

| Risk category | Count | Processing result |
|---:|---:|---|
| Routine | 4,432 | accepted automatically (rehearsal) |
| Check | 764 | accepted automatically (rehearsal) |
| Medium | 857 | accepted automatically (rehearsal) |
| High | 179 | accepted automatically (rehearsal) |
| Very High | 4 | manual review |
| Exceptions | 0 | — |

Very High: 1:2, 3:2, 6:2 (another voice suspected: one start stands for the surah) and 90:13 (the aligner placed the
start past the end of ayah 12, an overlap repaired by rule, not heard).

## DEV app

110 surahs enabled (`mobile/src/audio/generated/timedPreview.ts`); 1, 3, 6 and 90 unavailable until their Very High
item is resolved. Existing timed playback; each surah streams its own selected file after a size check. No untimed
fallback, offline downloads off. JavaScript only: restart Metro with `--clear`; no native build, no OTA.

## Dashboard rehearsal (live untouched)

Snapshot `%USERPROFILE%\Backups\quran-heals-audio-review\pre-ahmed-20261024T012049Z` (1,271 files, verified, chains
intact). Two restored copies, current code; A = baseline, B = with Ahmed's packages.
- A wrote nothing.
- B added 114 recordings, 6,232 acceptances, 114 opening amendments, all Ahmed's.
- 0 of the 1,029 existing recordings changed; 256 review files byte-identical; both ledgers keep the old entries as an exact prefix, chains intact; import problems 2 in both.
- Queues: Rifaat 144 + 285, Gebril 777, Jaber 55 unchanged; Ahmed 4.

Packages: `Working progress/Audio packages pending import/ahmed-salama-2026-10-23` (outside the dashboard's scan roots). To import, after approval: add to `dashboard.config.json` `sources`:
`{ "id": "ahmed-salama", "kind": "review-packages", "phase": "ahmed-salama", "dir": "../../Audio packages pending import/ahmed-salama-2026-10-23" }`, then restart the dashboard.

## Live import (owner-approved, 2026-10-24 01:4x UTC)

- Fresh snapshot `%USERPROFILE%\Backups\quran-heals-audio-review\pre-ahmed-import-20261024T014045Z` (1,271 files, verified); live config backed up as `pre-ahmed-import-live-config.json`.
- Rehearsal on that snapshot (live registry copied in): all nine conditions passed (review files byte-identical, ledgers exact prefix + Ahmed only, chains intact, Gebril 19 VH + 94 exceptions and Jaber 2 + 36 unchanged, Rifaat 144 + 285 unchanged, import problems not increased, Ahmed identical to the earlier rehearsal, second start wrote nothing).
- Live: the idle server (no review event since 23:50 UTC) was stopped, the `ahmed-salama` source added to `dashboard.config.json`, the dashboard restarted in its own window. Result identical to the rehearsal: 1,143 recordings; +6,232 acceptances, +114 opening amendments, all Ahmed's; 256 review files byte-identical; import problems 133 (unchanged); Refresh queue afterwards added nothing.
- Ahmed's manual queue: 4 Very High (1:2, 3:2, 6:2, 90:13), 0 exceptions.
