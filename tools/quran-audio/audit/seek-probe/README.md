# Seek probe: the real Android MP3 extractor, on a desktop (Phase 4.3)

`SeekProbe.java` runs **androidx.media3 1.9.0**'s own `Mp3Extractor` on an MP3 file — the extractor expo-audio 57 uses
on Android (`ProgressiveMediaSource`, default flags) — and prints, for each target time, the label and byte position of
the frame where it resumes after a seek. `audit/mp3frames.py` gives each frame's true time, so the difference is where
audio really starts. It exercises the extractor only: decoder, audio sink and device timing are not covered (that part
stays "pending device verification"), and iOS (AVPlayer) not at all.

`android/util/Pair.java` is a minimal JVM stand-in for the one framework class the MLLT seeker calls; every other
framework class comes from the SDK's `android.jar` stubs (never called on these code paths).

```bash
G=~/.gradle/caches   # media3 jars as resolved by the app's Android build
CP="$G/.../media3-extractor-1.9.0/jars/classes.jar;$G/.../media3-common-1.9.0/jars/classes.jar;$G/.../media3-container-1.9.0/jars/classes.jar;<guava-31.0.1-jre.jar>;<annotation-1.3.0.jar>"
javac -cp "$CP;$ANDROID_SDK/platforms/android-36/android.jar" -d out SeekProbe.java android/util/Pair.java
java -cp "$CP;out;$ANDROID_SDK/platforms/android-36/android.jar" SeekProbe file.mp3 10000 100000
# -> seeker MlltSeeker seekable true durationUs 313469000
#    10000 10005000 268372 268271      (target ms, label us, frame start byte, seek-point byte)
```

Options: `-Dmp3flags=N` passes Mp3Extractor flags; a source `virtual:<prefix>|<original>|<original tag length>` serves an in-memory prefix (a rebuilt ID3 tag) and then the unmodified original bytes, as a native DataSource would (Phase 4.4).

Results of 2026-10-18 are in `audit-data/vbr-recovery-2026-10-18.json` (docs/audio/vbr-recovery-phase-4-3-2026-10-18.md) and `audit-data/vbr-cross-platform-2026-10-18.json` (Phase 4.4).
