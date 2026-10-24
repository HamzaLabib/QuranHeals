# Ali Abdullah Jaber: finalization, roster update and release gate (2026-10-24)

## Ali Jaber review state

Live dashboard read 03:02 UTC (it later stopped after the owner's last review, 02:59 UTC; not restarted):
6,236 ayahs; 5,724 accepted automatically; 497 reviewed by the owner (incl. all of 10 — so 10:70/71 — all of 74,
the voice checks 1:1 and 2:1, and 55, 81, 95, 114); 0 Very High open; 15 exceptions open.

New independent evidence (`tools/quran-audio/per-ayah/clearance.py`, output `%LOCALAPPDATA%/QuranHeals/per-ayah-cache/Ali_Jaber_64kbps/clearance.json`):
- Voice (ECAPA): similarity to 150 of Jaber's files located in MP3Quran's Hafs performance (own range 0.609–0.838+, 1st percentile 0.626) vs 60 Mohamed Gebril files (max 0.364). Clears at ≥ 0.626.
- Context: previous + current + next file aligned (MMS_FA) against the three texts; cleared when the current ayah's words lie inside its file (±300 ms), cover ≥ 80 % of its voiced audio and score ≥ every far control + 0.08.

| Ayah | Exception | Voice | Context | Result |
|---|---|---:|---|---|
| 4:11, 11:34, 11:38, 11:63, 11:81, 11:89, 11:123, 89:23, 90:1 | identity (not in the reference performance) | 0.76–0.92 | inside, 0.44–0.70 vs ≤ 0.27, 95–99 % covered | cleared → high |
| 26:100, 37:69, 53:54, 86:12 | text not confirmed (short ayahs) | — | inside, 0.49–0.63 vs ≤ 0.27 | cleared → high |
| 9:12 | 5.9 s of audio outside the words | 0.90 | inside, 99 % covered | cleared → high (alignment artefact) |
| **88:14** | identity | **0.446** (below his range, above other reciters) | 80 % covered | **unresolved: listen** |

`severity.mjs --clearance` reproduces the live report exactly without the evidence, and changes exactly these 14 files
(exception → high) with it. Report: `tools/quran-audio/audit-data/jaber-per-ayah-severity-cleared-2026-10-24.json`.

Rehearsal (snapshot `%USERPROFILE%\Backups\quran-heals-audio-review\pre-jaber-clearance-20261024T033441Z`, 1,430 files,
verified): only the 9 affected Jaber packages replaced (4, 9, 11, 26, 37, 53, 86, 89, 90; none has a review log; 1 and 2,
which do, untouched); 9 recordings change; +14 acceptances, exactly the cleared ayahs (13 high, 1 check); 301 review
files byte-identical; ledgers exact prefix, chains intact; Rifaat and Gebril unchanged; second start writes nothing.
Jaber's queue: 15 → 1 (88:14). **Not applied live: awaiting the owner's approval.** Staged packages: session scratchpad
`jaber-final/staged`.

## Roster (owner, 2026-10-24)

`mobile/src/audio/reciters.ts`: `RECITER_ORDER` (17, owner's final order: Ali Al-Hudhaifi at #7), `ON_HOLD_RECITER_IDS`
(rifaat, gebril), `DISPLAY_NAMES_EN` (ajmi → Ahmed Al-Agamy, naina → Ahmed Naina), `DISPLAY_NAMES_AR`
(hudhaifi → علي بن عبد الرحمن الحذيفي). Catalogue, preview data, tools and dashboard unchanged.
No "Ali Al-Ajmi" exists: the only `ajmi` is Ahmed Al-Ajmi (MP3Quran 5). Ali Al-Hudhaifi is offered again at #7 with
his 103 verified production surahs (measured timing, unchanged). Release builds show 16 (Jaber is a development preview).

## Release gate

`tools/quran-audio/per-ayah/release-gate.mjs` (read-only, fails closed); `generate-preview.mjs --release` refuses unless
every gate passes; release builds read `mobile/src/audio/generated/perAyahRelease.ts` (empty). Jaber today:
on-hold PASS, integrity PASS, review BLOCKED (dashboard down; 1 exception after the import), reviewers BLOCKED
(no Reviewer 2), rights BLOCKED, provider BLOCKED (everyayah not in providers.mjs), attribution BLOCKED, devices BLOCKED.

Recommended path for rights: EveryAyah's files are cut from MP3Quran's own Ali Jaber recording (reciter 76) for 5,916
ayahs, and the identity run already located every one of them in MP3Quran's files. MP3Quran's streaming permission
(already the basis of every production reciter) would cover playing MP3Quran's files with that measured timing — the
same method as Ali Al-Hudhaifi's production timing — except for surahs 1 and 2 (another performance) and the isolated
ayahs. Not implemented: an owner decision.

## Applied live (owner-authorized, 2026-10-24 04:16–04:31 UTC)

Read first: 6,236 ayahs; 497 reviewed by the owner, 5,724 accepted automatically, 15 exceptions open. Last review event
02:59 UTC; the dashboard was not running when the change was applied (no session interrupted).

Backups (verified): `%USERPROFILE%\Backups\quran-heals-audio-review\pre-jaber-final-20261024T041626Z` (1,430 files,
review data, registry, ledgers; chains intact) and `jaber-packages-pre-final-20261024T041626Z` (+ `.sha256`, 115 files).
The override command took its own `pre-owner-override-20261024T042813Z`.

Checked unchanged before applying: the 9 staged packages differ from live in exactly those files (105 identical);
`clearance.json` last written 03:09 UTC, before the rehearsal; all 15 files (the 14 cleared + 88:14) match their package
sha256 in the cache.

Rehearsal C (restored snapshot, port 8776): +14 acceptances (exactly the cleared ayahs: 13 high, 90:1 check), then the
override; queue 15 → 1 → 0; only `jaber-88-everyayah` changed for the override; no other reciter changed; second and
third starts wrote nothing; 301 review logs byte-identical; ledger prefixes identical; chains intact.

Live result (identical to the rehearsal, every row and reciter):

| Ali Abdullah Jaber | ayahs |
|---|---:|
| reviewed by the owner (listening) | 497 |
| accepted automatically (policy auto-accept-v2), incl. the 14 cleared by clearance.py | 5,738 |
| **owner override, unverified (88:14)** | **1** |
| open | 0 |
| total | 6,236 |

Ledgers: `_auto-acceptance` 43,737 → 43,751; `_opening-rule` 845 (unchanged); `_owner-override` new, 1 entry
(`verified/listened/identityConfirmed/textConfirmed: false`, `releaseBlocked: true`, concerns IDENTITY_UNRESOLVED and
WEAK_TEXT, evidence `tools/quran-audio/audit-data/jaber-88-14-owner-override-evidence-2026-10-24.json`). Restarted once
more: all three ledgers byte-identical. Gebril (2 open), Rifaat (429 open) and every other reciter unchanged; 133 import
problems (unchanged). Status "completed with owner override (unverified)", no completion milestone.

The existing ledger could not represent an unverified owner decision (an `auto-accept` entry would read as a passed
policy check), so 88:14 has its own record type (`review/dashboard/owner-override.mjs`, README "Owner override").

Release gate now: on-hold, integrity and review PASS; reviewers, **overrides (88:14)**, rights, provider, attribution and
devices BLOCKED. `perAyahRelease.ts` unchanged (empty): Ali Jaber stays a development preview.
