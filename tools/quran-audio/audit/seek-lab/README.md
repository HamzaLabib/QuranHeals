# Seek lab: measuring where the app's player really starts (Phase 4.4)

An isolated experiment harness, run on 2026-10-18 on the Android emulator with the local debug dev client
(expo-audio 57.0.5 / androidx.media3 1.9.0). It measures the **decoded audio** the player outputs after a seek, rather
than the position the player reports. The app's audio code is not changed by it.

| File | Role |
|---|---|
| `seek-lab.tsx.txt` | The temporary screen. Copy it to `mobile/src/app/seek-lab.tsx` only for a run, and delete it afterwards: it is kept as `.txt` so it is never part of the app. It fetches `plan.json` from the host and, for each test, creates an expo-audio player, then for each target calls `seekTo(t, 0, 0)` (as `mobile/src/audio/expoOutput.ts`), plays 2.4 s and pauses. It logs play and pause to the host and posts the player-reported positions. |
| `server.mjs` | Host server on :8099, reached by the emulator at 10.0.2.2. It serves `plan.json`, local candidate copies with HTTP Range (`/files/{orig,mllt,cbr}/…`) and HLS playlists (`/files/hls/…`). It records `/log` lines with host time and saves `/result/<id>`. Local only. |
| `record.py` | Records the PC's audio output (WASAPI loopback; it needs `soundcard`, numpy, and the NumPy 2 shim inside) with host time per block. |
| `analyze_local.py` | Clock-free analysis. For each burst it finds where the pause cut the captured audio, matches a short slice before the cut to the decoded source, and compares that source position with the player's reported position at the pause. It then subtracts the run's unseeked first burst, the emulator's constant position-vs-output latency. Capture drop-outs do not affect it. |

**Resolution:** about ±20–40 ms. Seconds-scale seek errors are measured exactly; frame-scale accuracy rests on
`audit/seek-probe/` (the real extractor). **Results:** `audit-data/vbr-cross-platform-2026-10-18.json`.
