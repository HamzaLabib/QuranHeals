# Muhammad Rifaat: manual timing and verified integration (Phase 4.6A–D, 2026-10-18)

## Completion state

| Stage | State | What remains, and who must do it |
|---|---|---|
| **4.6A** Manual review tool | **Built and tested** (synthetic data; 19 automated tests, 26 browser checks) | Nothing for the tool. Reviewer names are not authenticated (see Limits). |
| **4.6B** Surah 98 pilot | **Prepared; human review pending.** The real session is ready and checked (display, text, audio, timeline). **No person has listened to or timed it.** | **Two different people** must time it in the tool (Reviewer 1, then an independent Reviewer 2), resolve any disputes, and export. Then the pilot pass criteria (below) are checked against their review. |
| **4.6C** Remaining candidates | **Queued (17 more sessions prepared); human review pending** | The same two-reviewer process for each, in the queue order. Repeated-passage recordings will most likely end **unresolved** (below). |
| **4.6D** Development integration | **Not started: stop condition met** | No recording has passed human review. All 18 files are tagged «Reserved For KFGQPC», so even a verified recording stays blocked until the **owner** settles rights. Device checks (iOS, Android) need a person and devices. |

**Status terms are kept apart:**

| Term | Count | Meaning |
|---|---|---|
| Tool built | 1 | `tools/quran-audio/review/manual/` |
| Recordings analysed | 31 (Phase 4.5) | |
| Sessions prepared | 18 | |
| Human review pending | 18 | |
| Human review completed | **0** | |
| Independently verified | **0** | |
| Rights cleared | **0** | |
| Development activated | **0** | |
| Device tested | **0** | |

## 4.6A: the manual review tool

**What it is:** a local server and a single page.
- **Server:** `server.mjs`, listening on 127.0.0.1 only.
- **Page:** `index.html`, with no external dependencies.
- **Instructions:** `tools/quran-audio/review/manual/README.md` (launch, operation, keyboard).

| Requirement | How it is met |
|---|---|
| 1. Waveform, zoom, navigation | A whole-recording overview strip and a zoomable main view (wheel, + / −, bracket zoom, Shift+wheel scroll). Peaks every 5 ms come from the unmodified audio (`prepare.py`). |
| 2. Play, pause, seek, rewind, replay | Space, ← → (2 s / Shift 10 s), click to seek, overview click to jump, play from a marker. The playback rate is never changed. |
| 3. Pause candidates | Every quiet region (the Phase 4.5 `worklist.py` rule), shaded. The selected ayah's Phase 4.5 pause candidates are highlighted. |
| 4. Canonical text in order | Verbatim from `tools/quran-verification/input/quran-uthmani.txt`; the Basmala is shown apart from ayah 1, as `make-packages.mjs` does. The ayah count comes from `quran-data.xml`. |
| 5. Phase 4.5 brackets, single pauses, conflicts, unbracketed | Per ayah: a tag (kind and bracket) and a shaded bracket. The teacher-forced windows show as a lane, confirmed or not, with their ayahs. |
| 6. Place and adjust markers | Double-click, or **M** at the playhead; drag a marker; type m:ss.mmm. |
| 7. Precise times, fine adjustment | Millisecond display; **[ ]** ±10 ms, **Shift+[ ]** ±100 ms. |
| 8. Replay around a boundary | **R**, with seconds before and after set in the toolbar. |
| 9. Keyboard shortcuts | Listed under "Shortcuts"; disabled while typing in a field. |
| 10. Confirmed / uncertain / rejected | Per marker (keys 1, 2, 3). **Moving a marker resets it to "uncertain"**, so it must be heard again. |
| 11. Comments and flags | Flags for repetition, missing passage, background noise, non-Quran interruption and other, each with a time range and ayahs. A **repetition must state its timing implication**. There is a general comments field. |
| 12. Incremental save and restore | Autosave about 1 s after a change. Each save is an event appended to the recording's `events.jsonl` and flushed to disk at once. State is rebuilt by replaying the log. A local browser copy is offered back if the server never received it. Tested by restarting the server and reloading the page. |
| 13. Machine-readable export | `manual-ayah-timing-review` JSON: both reviews, the comparison, resolutions, amendments, the log's head hash and the status. For verified timing it also holds the `ayah-timing-review-package` and `ayah-timing-review` (v3, source `manual`) that `development/apply-review.mjs` reads. |

**Timing rules enforced (server-side, by `manual-lib.mjs`):**
- **What is refused:** ayah numbers outside 1–n, times outside the audio, a start not after the previous ayah's start, and an end not after the last start. A refused change never enters the log.
- **What the tool never does:** no marker is created, moved or confirmed by the tool. Silence is shown only as a place to listen.
- **Inputs are read-only:**
  - the sessions;
  - the Phase 4.5 evidence;
  - the audio, served as is with HTTP Range.
- **Proposals and registries are separate.** Reviews live in the workspace's `data/` folder, outside the repository. Development timing changes only when the owner runs `apply-review.mjs`.

**Repeated passages.** Each one is flagged with its ayahs and implication:
- **Within one ayah** (the same ayah recited again in place) is accepted only if the repeat lies inside that ayah's agreed span.
- **Returns to earlier ayahs**, or **unsure**, make the recording **unresolved**, and no timing is exported.
- The one-start-per-ayah architecture is unchanged.

**Two reviewers:**
- **Blind second review:** before both have submitted, the server returns neither reviewer's markers, flags, checks or comments to the other. This was tested through the API and in the browser.
- **No self-confirmation:**
  - The same name, in any letter case, cannot hold both roles.
  - Reviewer 2 cannot join before Reviewer 1.
  - A disputed boundary is resolved only when one reviewer proposes a time and **the other** accepts it, each with a note of what they heard.
- **Agreement:** both confirmed, and no more than 250 ms apart. The agreed time is Reviewer 1's placement, confirmed by Reviewer 2.
- **Auditability:**
  - **After submission:** placements are frozen. Changes are **amendments**: each needs a reason, keeps the previous placements, and withdraws any resolution it touches.
  - **The log:** it is append-only and hash-chained. Editing it outside the tool is detected (tested), and the tool then refuses to load it.
- **Summary:** agreed, resolved, disputed and unresolved counts, with the reason for each dispute.

**Recording status** (`recordingStatus`):
- `awaiting-review`
- `invalid` (wrong surah, an omission, another voice)
- `unresolved` (an unrepresentable repetition, a missing passage, a check not answered "yes", or a boundary declared unplaceable)
- `disputed`
- `blocked-by-permissions` (verified, but rights not cleared)
- `approved-for-development-consideration` (verified, and rights cleared by an owner decision file that names the file's SHA-256)

The tool never clears rights.

## 4.6B: the Surah 98 pilot

**Done (software side):**

| Check | Result |
|---|---|
| Original recording loads | Yes: `rifaat_98.mp3` at the audited 5,726,818 bytes, SHA-256 `f6b51488f399…`. It plays from a seek in Chrome. |
| All eight ayahs shown correctly | Yes: verbatim text, the Basmala apart from 98:1, and 8 rows plus the recitation end. |
| Waveform, pause markers, brackets | Yes: 19 quiet regions; per-ayah Phase 4.5 kinds (1 unbracketed, 7 bracketed or single-pause); 35 evidence windows. |
| Timeline agreement | Chrome's duration is 357.363 s against the decoded 357.355 s (8 ms). |
| Rights | The file's ID3 frame reads «Reserved For KFGQPC حقوق التسجيل محفوظة لمجمع الملك فهد…». The session records rights as **not cleared**. |
| Save, reload, export, two-reviewer flow | Passed on **synthetic** data: tone bursts laid out on Surah 98's text, with the reviewers "SYNTHETIC-R1" and "SYNTHETIC-R2". These were a test harness, not people. |

**Not done (needs people):**
- Reviewer 1's placements of the 8 starts.
- Reviewer 2's independent placements.
- Comparison and dispute resolution.
- The end-to-end content check.
- The pilot pass criteria, which can only be judged on a real review:
  - every start verified;
  - each seek begins the right recitation;
  - playback runs on naturally;
  - nothing is skipped.

**Surah 98 is awaiting listening review.** No approval record exists, and none was created. The workspace's `data/` folder is empty.

## 4.6C: the review queue and what to expect

**Workspace:** `Working progress/Screenshots and Logs/rifaat-manual-review-2026-10-18/` (outside the repository).
- `sessions/` holds the 18 sessions and `queue.json`.
- `audio/` holds the unmodified MP3Quran files (225 MB, review copies only).
- `data/` is empty.

Every file matches its audited size, and **every one carries the KFGQPC copyright frame.**

**Can one start per ayah represent the recording?** This is a forecast from the Phase 4.5 evidence. Only listening decides.

| Order | Surah | Group | Repetition evidence (Phase 4.5) | Forecast under one start per ayah | Status now |
|---|---|---|---|---|---|
| 1 | 98 Al-Bayyinah | pilot | none | representable | awaiting review |
| 2 | 73 Al-Muzzammil | in order | one possible one-ayah return (8) | probably representable | awaiting review |
| 3 | 72 Al-Jinn | in order | 19–22 replayed near 20:00 | unresolved if confirmed as a multi-ayah return | awaiting review |
| 4 | 78 An-Nabaʾ | in order | 37–39 occupy about 8 min | unknown; listen to 11:00–20:00 first | awaiting review |
| 5 | 79 An-Nāziʿāt | in order | none | probably representable (if 26–36 and 43–46 are present) | awaiting review |
| 6 | 76 Al-Insān | in order | one-ayah returns to 9 and 17 | representable if each repeat is in place ("within one ayah") | awaiting review |
| 7 | 75 Al-Qiyāmah | in order | 36–38 returns near the end; 12/30 look-alike text | unresolved if confirmed | awaiting review |
| 8 | 55 Ar-Raḥmān | in order | refrain (31 identical ayahs, each its own ayah: not a repetition) | representable; each refrain numbered by its order | awaiting review |
| 9–15 | 1, 83, 87, 88, 89, 96, 100 | repeated passages | multi-ayah returns in every one (6–7; 2–5, 18–21, 22–28; 2–5 three times; 1–5, 8–11, 17–20; 23–26; 2–8; 1–4 and 6–8) | **expected unresolved**: a return to earlier ayahs would highlight the wrong ayah | awaiting review |
| 16–18 | 82, 85, 86 | weak evidence | — | identity and completeness first (reviewers' whole-recording checks) | awaiting review |

**Excerpts:** 10, 11, 12, 17, 18, 19, 20, 48, 54, 56, 69, 77 and 81 are not queued. They stay **unavailable**, with no partial-surah or untimed playback. Their replacement needs a complete recording that no known source has (Phase 4.5); no new source search was run.

**Realistic yield:** at most about 8 recordings could be verified, most likely fewer, and all are blocked by permissions today.

## 4.6D: conditional development integration (not started)

**Per-recording gates, all required:**

| Gate | Current state |
|---|---|
| 1. Listening review complete | Not met (0 / 18) |
| 2. Independent second review documented | Not met |
| 3. Ayah starts validated | Not met |
| 4. Whole surah present | Not met (reviewers' checks) |
| 5. Repeated passages acceptable | Not met |
| 6. Source and provenance established | MP3Quran `muhammad-refaat/r1`, with size and SHA-256 recorded. Provenance per Phase 4.5. |
| 7. Permissions support streaming in the app | **Not met:** every file is «Reserved For KFGQPC»; MP3Quran's grant may not cover it (Phase 4.6 discovery, section 6) |
| 8. Owner authorised this recording's activation | Not met |

**The plan, once a recording meets gates 1–7:**
1. The owner writes an **owner rights decision** (`prepare.py --owner-rights-decision`). It must name the file's SHA-256, the basis, the decider and the date. The owner then re-prepares that session. The reviews stay valid: they are on the same file.
2. Export from the tool. `package` and `review` go to two files.
3. **The owner authorises activation (gate 8),** then runs `node development/apply-review.mjs package.json review.json`.
   - It refuses synthetic data, a single reviewer, mismatched reviewers, any undecided ayah and blocked packages.
   - It writes `development/development-timing.json` only. Production timing is never touched.
4. `node generate-catalog.mjs`. This regenerates the development-only registry, which development builds read and releases never do.
5. **Playback validation** in a development build: full-surah playback, every ayah seek, highlighting throughout, Repeat Ayah, pause and resume, the repetition transitions (if any), the end of the surah, network interruption and recovery, **iOS**, and **Android**.
   - Any check not performed on a device blocks final approval.
   - Unit tests are not device verification.

**Rollback:**
- `development-timing.json` holds one entry per surah, so removing `reciters.rifaat.surahs["<s>"]` and its `evidence` and regenerating undoes it.
- The original URL is kept; nothing is mirrored, bundled or rehosted.

## Blockers

| Kind | Blocker | Who |
|---|---|---|
| **Permissions** | All 18 files reserve the recording rights to the King Fahd Complex (ID3 TCOP). Ask MP3Quran in writing whether its grant covers them, and the King Fahd Complex directly (drafts in the Phase 4.6 discovery report). Egyptian radio / Sono Cairo may hold the underlying rights (Phase 4.5). | Owner |
| **Listening** | Two independent reviewers per recording, ideally people who know Rifaat's recitation and tajwīd | Owner, to recruit |
| **Product** | Repeated passages: the current architecture has one start per ayah, so those recordings stay unresolved unless the owner commissions a change | Owner |
| **Devices** | iOS playback is untested and postponed by the owner. Android checks need a development build on a device or the emulator. | Owner / tester |

## Tests

| Check | Result |
|---|---|
| `tests/manualTimingReview.test.ts` (new) | **19 / 19 pass**. Covers: validation (ayah numbers, duration, order, end, repetitions); the blind second review; no self-confirmation; agreement and resolution by the other reviewer; unplaceable boundaries; amendments; a forged log detected; status rules (invalid, unresolved, in-place repeat, permissions); server save and refusal; restart and restore; HTTP Range; the partial and full export; `apply-review` compatibility (refuses unclear rights, synthetic data, one reviewer, wrong reviewers, v2 reviews and disputed timing; writes verified timing to a temporary file only). |
| Browser test (headless Chrome, `scratchpad/p46/ui-test.mjs`) | **26 / 26 pass**. Synthetic Surah 98, two synthetic reviewers:<ul><li>placement by keyboard, with the order enforced;</li><li>±10 / ±100 ms nudges;</li><li>autosave, then reload and restore;</li><li>the submission freeze;</li><li>the same name refused as Reviewer 2;</li><li>Reviewer 2 blind (page and API);</li><li>the comparison (7 agreed, 2 disputed);</li><li>the export.</li></ul>Real Rifaat 98: display, rights banner, evidence, timeline (8 ms) and playback from a seek; **no event written**. |
| Owner rights-decision gate | A decision naming the wrong SHA-256 is refused; a matching one is accepted. Scratch copy only, deleted. |
| Audio tests (13 files) | **245 / 245** (226 before, plus 19) |
| Full suite | 3147 passed, **37 failed: the known QPC baseline** in `mushafScreen.test.ts`, unrelated, unchanged |
| `tsc --noEmit`, `expo lint` | Clean |
| Python tool tests | Pass (flag_boundaries 3, vbr_recover 5) |

## Changed files (uncommitted; nothing staged)

**New:**
- `tools/quran-audio/review/manual/`: `manual-lib.mjs`, `server.mjs`, `export.mjs`, `index.html`, `prepare.py`, `synthetic.mjs`, `README.md`;
- `mobile/tests/manualTimingReview.test.ts`;
- this report.

**Modified:**
- `tools/quran-audio/development/apply-review.mjs`: the `manual` source, with its two-reviewer and synthetic refusals. The existing paths are unchanged, and their tests pass.
- `tools/quran-audio/README.md`: one row.

**Outside the repository:** the review workspace (18 sessions, the queue, audio copies, an empty `data/`).

**Untouched** (no file newer than this phase began):
- production and development timing;
- catalogues and generated registries;
- audit results and backend data;
- the Phase 4.5 evidence;
- review packages;
- other sessions' Phase 4.6 and 4.7 outputs.

**Parallel work:** another session's transcription job (Phase 4.7) was running; it was not touched.

## Limits

- **Reviewer identity is a typed name**, not an account. Independence relies on:
  - the server's blind view;
  - its refusal of one name in both roles;
  - honest use. A person with access to `data/` could read the other review early.
- **Timeline accuracy:** a placement is on the decoded timeline. The app's seek on the same CBR file can differ by up to one MP3 frame (26 ms); within the 250 ms agreement tolerance, this is negligible.
- **Waveform precision:** the waveform is 5 ms per column at full zoom. The markers themselves are kept to 1 ms.
