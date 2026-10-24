# Phase 4.8.10 — Unified per-ayah severity: Mohamed Gebril and Ali Abdullah Jaber (2026-10-24)

Status: analysis, code and rehearsal done. The live dashboard is **untouched**: it was not running, it was not restarted, its ledgers were not changed and nothing was imported. The live migration waits for the owner's approval. Nothing was committed, pushed, deployed, published or built.

## Rule: `per-ayah-severity-v1` (`tools/quran-audio/per-ayah/severity.mjs`)

The same rules apply to every per-ayah reciter. They use the existing classify.mjs evidence, plus a targeted boundary check, `per-ayah/boundary_check.py`. That check uses the GPU and MMS_FA, the same model as `verify_text.py`. For each file it aligns the ayah word by word: alone, after the previous ayah's last 3 words, before the next ayah's first 3 words, after the whole previous ayah, before the whole next ayah, and with the same edges taken from a far ayah as a calibration control.

It ran on every flagged file and on both neighbours of each, plus 300 unflagged files per reciter: 1,993 Gebril files and 1,473 Jaber files, with 0 errors. The calibration found that far-ayah words that are not in the file score at most 0.276 (Gebril) and 0.264 (Jaber) at the 99th percentile. A neighbour's words count as present only at a probability of 0.35 or more.

**Very High requires corroboration, never one ASR score:**

| Code | Shown as | Evidence required |
|---|---|---|
| CUT_START / CUT_END | Cut Beginning / Cut Ending | The first or last word is squeezed into almost no audio at an edge that is still voiced, while the other words are clearly recognised. Or the neighbouring file holds those words while this file lacks them. |
| AYAH_OVERLAP | Ayah Overlap | All of these must hold. The neighbour's words are found outside this ayah's own words, in voiced audio that the scan measured separately (≥ 0.8 s). The neighbouring file also holds them complete. Those words do not occur in this ayah's own text, because shared or parallel wording is no evidence. |
| AYAH_SEQUENCE | Incorrect Ayah Sequence | The whole previous or next ayah is recited in the file, at its own position. Or both the alignment (clearly: by 0.05 or more, above the confirmation threshold) and the transcription prefer the neighbour, whose text differs. |
| WRONG_AYAH / INCORRECT_MAPPING | Wrong Ayah | The same as above for a far ayah. With a mis-named file, it is incorrect mapping. |
| MISSING_CONTENT | Missing Quran Content | Two or more consecutive words, or 30 % of the words, are squeezed inside the file. |
| EXTRA_AYAH | Other Critical Structural Error | 3 s or more of voiced audio outside the words, and an abnormal file length as well (two independent measurements). |
| WRONG_RECITER | Wrong Reciter / Riwayah | The file's tags name another reciter. |

**Unresolved exceptions** (blocked, never accepted automatically):

- the file is missing or unreadable;
- the text is not confirmed, because it scores below the median wrong-text control;
- the alignment and transcription disagree, or their preference is unclear;
- 3 s or more of extra audio where the file length fits the ayah, so the two measurements disagree;
- the reciter's identity is not established (an isolated file of another performance);
- the boundary check is missing.

A run of 3 or more files of another encoding (Gebril 4:60–87) is one identity question: 4:60 is the exception, and the other 27 files wait for a person to confirm that voice before automatic acceptance.

**Not Very High on their own:** weak text or transcription scores, a correct ayah only slightly ahead of a neighbour, near-identical neighbour texts (94:5/94:6, 78:4/78:5, 31:5 = 2:5), pauses, silences, clipping, another encoding, abnormal length, an internal silence, a broken MP3 stream, or metadata. These stay high, medium or check.

## Results (dashboard starts; rehearsal on a restored copy of the live data)

| Risk category | Gebril | Ali Jaber |
|---|---:|---:|
| Total Quran ayahs | 6,236 | 6,236 |
| Routine | 5,375 | 5,491 |
| Check | 123 | 112 |
| Medium | 44 | 0 |
| High | 675 | 629 |
| Very High (open / reviewed by Hamza) | 19 / 0 | 2 / 2 |
| Unresolved exceptions | 67 (+27 waiting for the 4:60 voice check) | 36 |
| Automatically accepted | 6,123 | 5,905 |
| Reviewed by a person | 0 | 293 (kept) |
| **Remaining manual reviews** | **86** (19 + 67; the 27 are released by the 4:60 check) | **38** (2 + 36) |

The High row includes the exceptions and waiting starts, which the dashboard shows at their tier, blocked.

Very High changes:

- **Gebril:** 777 → **19**. Of the 777 ungraded flags: 632 are now high, 45 medium, 10 check, 66 exceptions and 18 stay Very High. One start that was low before (58:15) is now Very High: an overlap with 58:14.
- **Jaber:** 57 → **4**. Two of these (1:1 and 2:1) were already reviewed by Hamza; the 2 open ones are the 10:70/10:71 overlap. 55 starts were reclassified: 36 to exceptions and 19 to high. One start that was low before (10:71) is now Very High.

Serious problems found (all of them are listed in the next table):

| Problem | Gebril | Jaber |
|---|---|---|
| Cut start | 0 | 0 |
| Cut end | 2 | 0 |
| Overlap | 3 (the pair 58:14/15, and 61:11 with 61:10) | 2 (the pair 10:70/71) |
| Extra recitation | 14 | 0 |
| Sequence or repetition (corroborated) | 0 | 0 |

Ten text ties were not resolved and stay exceptions: Gebril 8, Jaber 1.

### Detected structural problems (Very High)

| Reciter | Surah | Ayah | Reason | Before | Evidence |
|---|---:|---:|---|---|---|
| Gebril | 15 | 37 | EXTRA_AYAH | very high | text 0.502; 3.7 s voiced before the words; abnormal length |
| Gebril | 15 | 58 | EXTRA_AYAH | very high | text 0.525; 6.0 s before; abnormal length |
| Gebril | 15 | 92 | EXTRA_AYAH | very high | text 0.53; 4.8 s before; abnormal length |
| Gebril | 18 | 23 | EXTRA_AYAH | very high | text 0.382; 8.1 s after the words; abnormal length (perhaps 18:24 joined) |
| Gebril | 20 | 33 | EXTRA_AYAH | very high | text 0.61; 3.4 s before; abnormal length |
| Gebril | 20 | 124 | EXTRA_AYAH | very high | text 0.494; 13.7 s before; abnormal length |
| Gebril | 34 | 36 | EXTRA_AYAH | very high | text 0.47; 12.8 s before; abnormal length |
| Gebril | 42 | 30 | EXTRA_AYAH | very high | text 0.468; 11.9 s before; abnormal length |
| Gebril | 56 | 60 | EXTRA_AYAH | very high | text 0.536; 7.4 s before; abnormal length |
| Gebril | 58 | 14 | AYAH_OVERLAP | very high | ends with 58:15's first words (0.40), 3.3 s voiced after its own |
| Gebril | 58 | 15 | AYAH_OVERLAP | low | its first words are also at the end of 58:14 |
| Gebril | 61 | 2 | EXTRA_AYAH | very high | text 0.27; 8.7 s before; abnormal length |
| Gebril | 61 | 10 | EXTRA_AYAH | very high | text 0.48; 9.8 s after; abnormal length |
| Gebril | 61 | 11 | AYAH_OVERLAP | very high | begins with 61:10's last words (0.459), 4.5 s voiced before its own |
| Gebril | 66 | 12 | CUT_END | very high | the last 3 words are squeezed at a voiced file end; text 0.466 |
| Gebril | 83 | 4 | EXTRA_AYAH | very high | text 0.405; 6.6 s before; abnormal length |
| Gebril | 95 | 5 | EXTRA_AYAH | very high | text 0.556; 4.8 s before; abnormal length |
| Gebril | 107 | 4 | EXTRA_AYAH | very high | text 0.535; 3.2 s before; abnormal length |
| Gebril | 114 | 2 | CUT_END | very high | the last word is squeezed at a voiced file end; text 0.245 (weak) |
| Jaber | 10 | 70 | AYAH_OVERLAP | very high | ends with 10:71's first words (0.428), 6.7 s voiced after its own |
| Jaber | 10 | 71 | AYAH_OVERLAP | low | its first words are also at the end of 10:70 |

Every Very High finding is automated evidence (forced alignment plus scan measurements). None is a listening judgement.

### Unresolved exceptions

**Gebril, 67:**

- **TEXT_UNCONFIRMED, 37.** These include a cluster in At-Tawbah, 9:58–9:121, about 29 files: the model does not find the text there. Either the files are another performance or source, or they are a weakness of the recognizer on that passage.
- **EXTRA_UNRESOLVED, 21.**
- **TEXT_CONFLICT, 8.** This includes 44:1, whose audio is almost identical to 68:27.
- **IDENTITY_UNRESOLVED, 1:** 4:60, which stands for the 4:60–87 run of another encoding (11 kHz mono).

**Jaber, 36:**

- **IDENTITY_UNRESOLVED, 28.** These are isolated files not found in MP3Quran's Hafs reference, including the run 74:41–56. Also counted here are 1:1 and 2:1, which stand for the other performance of Al-Fatiha and Al-Baqarah and are already reviewed by Hamza.
- **TEXT_UNCONFIRMED, 6.**
- **EXTRA_UNRESOLVED, 3.**
- **TEXT_CONFLICT, 1.**

Full lists with evidence are in `tools/quran-audio/audit-data/{gebril,jaber}-per-ayah-severity-2026-10-24.json` (the `severity` block of each item).

No file is missing or undecodable: all 6,348 files of each reciter are playable.

## Dashboard changes

These are on the existing dashboard and use the existing Very High category; no new dashboard was built.

- **Very High reasons.** Each Very High start names its exact problem (Cut Ending, Ayah Overlap, …) with the evidence and the adjacent ayah. An exception is labelled EXCEPTION with its reason.
- **Waveform.** The suspected location is drawn in red on the zoomed waveform ("suspected problem").
- **New button.** **Play previous · this · next** plays across the boundaries.
- **Per-ayah card.** It shows separate rows for Gebril and Jaber: total analyzed, accepted automatically, Very High (open), reviewed by a person, unresolved exceptions, and remaining manual reviews.
- **Default queue.** It already showed only Very High, disputed starts and exceptions; every exception now says why it was not accepted.
- **Withdrawals.** An acceptance that no longer applies gets an explicit, chained `auto-accept-withdrawn` record that names it. The acceptance itself is never touched, and the record is written once.

## Rehearsal (restored copy of snapshot `pre-severity-20261024T001201Z`, merged code)

- The snapshot was verified: 1,271 files, chains intact. The restore check passed.
- The regenerated packages for all 228 surahs have **byte-identical review audio** (SHA-256) and **unchanged timing fingerprints**. Surahs with a review log (jaber-1, jaber-2) keep their package byte for byte.
- First start: 684 acceptances (Gebril 584 high, 44 medium, 37 check; Jaber 19 high) and 3 withdrawals (gebril-58:15, jaber-10:71, jaber-95:2). Second start: 0 and 0, so the migration is idempotent.
- **All 256 review logs are byte-identical.**
  - The acceptance ledger's 36,796 historic entries are unchanged and 687 were added; the chain is intact.
  - The opening ledger is unchanged (731 entries).
- **0 decisions changed outside Gebril and Jaber.** Rifaat still has 144 Very High starts and 285 exceptions. Human-reviewed starts: 7,358 before and 7,358 after.
- The browser test on the rehearsal passed 19/19.

## Tests

- New: `mobile/tests/audioPerAyahSeverity.test.ts`, 24 tests.
  - It covers each serious-risk case, each case that is not serious, the exceptions, the policy and the withdrawals.
  - It also covers the negative cases for shared wording, missing outside audio and noise-level ties.
- Full suite on the merged copy (the current tree plus these changes): 190 of 193 files pass. The 4 failing tests need `.git`/`.github` (absent in a copy) or are the known load timeouts; those pass when run alone. `tsc` and `expo lint` are clean.

## Live migration (needs the owner's approval)

1. Confirm the other session (Ahmed Mohamed Salama work) has finished with the shared files, then run `apply-severity.py` as a dry run. It refuses to write if any anchor has changed.
2. Take a verified snapshot.
3. Apply the code: 7 anchored edits and the new files.
4. Regenerate both reciters' packages in place. Keep the packages of every surah that has a review log at that moment, and check that every review copy's SHA-256 is unchanged.
5. Start the dashboard. It imports and runs the passes, after its own backup.
6. Verify against the snapshot: logs byte-identical, ledger prefix kept, counts as rehearsed (allowing for any new reviews).
7. Restart once to confirm idempotence.

## Limits

- Automated checks cannot prove that every word is recited. "Low" or "accepted" is never "verified".
- Only flagged files and their neighbours had the word-level boundary check. A problem between two unflagged files would be missed.
- Gebril has no full-surah reference recording, so the reciter is not confirmed for any file.
- The riwayah is inferred for both reciters and not confirmed by ear.
