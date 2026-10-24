# Manual ayah timing (Phase 4.6A)

> **Phase 4.8:** the unified dashboard (`review/dashboard`, http://127.0.0.1:8765/) now serves these sessions, together
> with every other pending review, and is the recommended way to review. It reuses the Rifaat database below in place;
> while either server runs, it locks the data folder, so the other refuses to start on it. Phase 4.8 also added a sixth
> whole-recording check (**playback**: seeking to each agreed start plays that ayah from its first sound).
>
> **Phase 4.8.1:** starts can be submitted in batches (event `submit-ayahs`), corrected with a reason (`revise`), and
> compared per start as soon as both reviewers have submitted it; `submit` remains the final, whole review. Logs written
> before 4.8.1 replay unchanged. See `review/dashboard/README.md`, "Reviewing in batches".

**What it is:** a local tool for timing recordings that no aligner can read: Muhammad Rifaat. A person places every ayah start by listening, and a second person does the same independently.
- **Never automatic:** the tool never places, moves or approves a marker.
- **Evidence only:** Phase 4.5's brackets, pauses and evidence windows are shown read-only, as places to listen.

Report: `docs/audio/rifaat-manual-timing-phase-4-6-2026-10-18.md`.

## Launch

The review workspace for the 18 eligible Rifaat recordings is already prepared, outside the repository:

```
Working progress/Screenshots and Logs/rifaat-manual-review-2026-10-18/
  sessions/   one session per recording (read-only input) + queue.json
  audio/      the unmodified MP3Quran files, at their audited size (local copies for review only; never published)
  data/       the reviews: one append-only log per recording (empty until someone reviews)
```

From `QuranHeals/tools/quran-audio`:

```bash
W="../../../Working progress/Screenshots and Logs/rifaat-manual-review-2026-10-18"
node review/manual/server.mjs --sessions "$W/sessions" --audio "$W/audio" --data "$W/data"
# then open http://127.0.0.1:8765/   (Chrome or Edge; the server listens on this computer only)
```

**Back up `data/` regularly:** it is the only copy of the reviews. Stop the server with Ctrl+C. Nothing is lost: every save is written to disk at once.

**Preparing another recording** (aligner venv Python, with numpy and miniaudio):

```bash
python -I review/manual/prepare.py ../.. rifaat 98 "$W/audio/rifaat_98.mp3" "$W/sessions/rifaat-98.json" \
  --phase45 audit-data/rifaat-phase-4-5-2026-10-18
```

`prepare.py` checks:
- **Size:** it refuses a file whose size differs from the audit.
- **Identity:** it records the file's SHA-256.
- **Rights:** it records the ID3 copyright frame.
- **Text:** it takes the text verbatim from `tools/quran-verification/input/quran-uthmani.txt`.

**Synthetic practice data:** `node review/manual/synthetic.mjs <sessions> <audio>` makes tone bursts laid out on Surah 98.
- It shows under a red SYNTHETIC banner.
- `apply-review.mjs` refuses it.
- Use a separate `--data` folder for it.

## Reviewing

**1. Reviewer 1:**
- Type your name, choose the recording, and press **Start as Reviewer 1**.
- Listen from the beginning to the end.
- For each ayah, select it in the list, put the playhead at the onset of its first sound, and press **M** (or double-click the waveform).
  - Refine with **[ ]** (10 ms) and **Shift+[ ]** (100 ms).
  - Check with **R**, which replays around the marker; set the seconds before and after in the toolbar.
  - Judge it **1** confirmed, **2** uncertain or **3** rejected.
- Place the **recitation end** with **E**.
- Answer the whole-recording checks.
- Add flags for repetitions, missing passages, noise and non-Quran interruptions:
  - **Shift-drag** selects a time range;
  - **Use selected range** fills in a flag's times.
- Press **Submit**. Your placements are now frozen.

**2. Reviewer 2:**
- A different person, under their own name.
- Does the same without seeing Reviewer 1's work. The server withholds it until both have submitted.

**3. Both:**
- After both submissions, the **comparison** shows every boundary. It is **agreed** when both reviewers confirmed it and their placements are no more than 250 ms apart.
- For each **disputed** boundary, listen again. One reviewer **proposes** a time, and the other **accepts** it, each with a note on what was heard. Otherwise mark it **cannot be placed**.

**Phase 4.8.4 / 4.8.4.1 (the review workstation):**
- Confirming is the reviewer's judgement. No playback is required or recorded: Phase 4.8.4.1 removed the 0.4 s listening gate.
- **Accept proposed boundary** and the bulk actions (Accept All Proposed, Reject All Proposed, Accept All Edited) are audited. A bulk action is one `bulk` event, which the server checks start by start.
- The automatic checks (text, recording identity, timings, submission, audit chain) are shown beside the human questions and never answer them.
- A final **Submit** is refused if any submitted start differs from its saved time.
- See `../dashboard/README.md`, "The review workstation".

**Changes after submission** are **amendments**: each needs a reason, and the previous placements stay in the log.

**Placement rule:** a start goes at the onset of the ayah's first sound, not in the middle of the silence before it. Seeking to the ayah must begin its recitation promptly.

**Repetitions.** The app has one start per ayah.
- **Within one ayah** (the same ayah recited again in place): highlighting stays truthful, and this is accepted if the repeat lies inside that ayah's agreed span.
- **Returns to earlier ayahs:** the app would highlight the wrong ayah during the repeat. The recording becomes **unresolved**, and no timing is exported.

**Status of a recording:**

| Status | Meaning |
|---|---|
| `awaiting-review` | A reviewer has not submitted |
| `invalid` | A reviewer heard another surah, an omission or another voice |
| `unresolved` | A repetition the model cannot represent, a missing passage, a check not answered "yes", or a boundary nobody can place |
| `disputed` | Some boundary is neither agreed nor resolved |
| `blocked-by-permissions` | Verified by two reviewers, but rights not cleared (every Rifaat file today: «Reserved For KFGQPC») |
| `approved-for-development-consideration` | Verified, and the rights cleared by the owner. This is still not active: the owner applies it. |

**Export (JSON):**
- Before both reviewers have submitted, the export holds only your own work.
- Afterwards it holds everything: both reviews, the comparison, resolutions, amendments and the log's head hash.
- For a verified recording, it also holds the `package` and `review` that `development/apply-review.mjs` reads (source `manual`).

## Applying (owner only, development only)

`node development/apply-review.mjs package.json review.json`. Write the export's `package` and `review` to two files first.

It refuses unless:
- two different reviewers verified every ayah;
- the package is not synthetic;
- the package is not blocked (rights).

It writes development timing only, never production.

## Limits

- **Reviewer names are not authenticated.** Independence relies on the server's blind view, its refusal of one name in both roles, and honest use. Someone reading `data/` files directly could see the other review early.
- **Timeline:** the waveform and the times are on the decoded audio. For Rifaat 98, Chrome's duration differs from the decoded one by 8 ms. A placement may differ from the app's seek position by up to one MP3 frame (26 ms).
- **Playback rate:** never changed. The recording is heard and timed exactly as published.
