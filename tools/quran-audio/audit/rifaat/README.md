# Muhammad Rifaat recordings: provenance, content and timing worklists (Phase 4.5)

Diagnostic tools for the 31 MP3Quran Rifaat recordings, which the MMS aligner cannot read. Every result is evidence
for a listener; nothing here writes timing, catalogues or packages. Report:
`docs/audio/muhammad-rifaat-recovery-phase-4-5-2026-10-18.md`. Results: `audit-data/rifaat-phase-4-5-2026-10-18/`.

| Script | What it does |
|---|---|
| `mapfiles.py` | Locates 20 s pieces (every 40 s) of each MP3Quran file in the labelled recordings of archive.org item `way2llh22_20180630_1733` (`audit/features.py` fingerprints). The labels give surah, ayah range and source. |
| `segments.py` | Turns those piece matches into provenance segments: runs of three or more strong matches (≥ 0.8) at a consistent position in one recording. It tolerates tape-speed drift of up to 6 %. |
| `transcribe.py`, `asr_order.py` | Free Whisper transcription, then which ayahs are recognisable and in what order. On Rifaat this hallucinates (for example «موسيقى», «اشتركوا في القناة»); it is weak evidence only. |
| `tf_verify.py` | **Teacher-forced check.** For each 30 s window, Whisper large-v3-turbo scores every run of 1–2 consecutive ayahs of the expected surah and of a control surah. The scores are relative (PMI) to the same reciter reciting other surahs. The margin over the control is the evidence. Nothing is decoded freely, so nothing is hallucinated. |
| `tf_summary.py` | Per file: the confirmed windows (margin ≥ threshold), the ayahs they cover, backward steps and repetitions. |
| `worklist.py` | **Human-assisted timing worklist.** For each ayah start: the time bracket the confirmed windows allow, and the pauses inside it. It places no boundary. |
| `extract.py` | Cuts a stretch to 16 kHz WAV and reports digital silence and the energy in the 2–3 kHz and 3–4 kHz bands. This was used to align alternative transfers of the same performance. |
| `run_tf.sh`, `run_cal.sh` | The Phase 4.5 runs (set `PYTHON` and `QURAN`; run from a folder holding `audio/rifaat_<s>.mp3`, `model-turbo/`, `tf/`). |

**Calibration of the teacher-forced check** (`run_cal.sh`): Rifaat audio scored against the *wrong* surah.
- Wrong text: margin median −0.01; 4 % of 101 windows reach 0.3, none reach 0.5 (maximum 0.45).
- Expected text (18 files, 741 windows): median 0.80; 63 % reach 0.5.
- Positive control (Banna 98, clean): margins 1.5–3.5, every window in order.
- **The threshold used is 0.5.**

**Limits:**
- Window-level only: a confirmed window says which ayahs a 30 s stretch holds, not where a boundary is.
- Identical ayahs (the refrain of Ar-Raḥmān) and near-identical ones (Al-Qiyāmah 12 and 30) cannot be told apart.
- Requirements:
  - `tf_verify.py`: a CUDA GPU (or `TF_DEVICE=cpu`, slow), the aligner venv (transformers 4.46.3, torch, miniaudio) and `openai/whisper-large-v3-turbo` in a local folder (MIT).
  - `mapfiles.py`: `audit/features.py`.
