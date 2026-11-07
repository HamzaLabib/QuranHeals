# Qibla Direction: real-device diagnostics

Development builds only. The diagnostics panel (`mobile/src/qibla/diagnostics/`, route `mobile/src/app/qibla-diagnostics.tsx`)
is left out of release bundles: the route loads it only inside `__DEV__ ? require(...) : null`, and a release build's
`/qibla-diagnostics` only redirects to Home. Checked by `tests/qiblaDiagnosticsExclusion.test.ts` and, on a real production
export, by `node scripts/verify-qibla-diagnostics-excluded.mjs`.

The panel never shows, logs, stores or sends a coordinate, or the distance to the Kaaba (with the bearing it would locate
you). It shows whether a fix is held, its accuracy radius and its age. **Copy report** puts the same rows on the clipboard
so you can paste them into a note or a message yourself.

## Opening it

1. Install the development build (see "Builds" below) and open it once so it connects to Metro
   (`npx expo start --dev-client --clear` in `mobile/`, phone and computer on the same Wi-Fi).
2. With the app open and showing Home:
   - **iPhone:** in Safari, type `quranheals://qibla-diagnostics` and confirm "Open in Quran Heals".
   - **Android:** `adb shell am start -W -a android.intent.action.VIEW -d "quranheals://qibla-diagnostics" com.quranheals.app`
     (USB debugging on), or open the same link from a note.
3. The panel asks for nothing by itself: tap **Request permission** the first time (it shows the system dialog).

## What to record (Copy report after each)

Use the same two places for both phones: one outdoors away from cars and buildings, one indoors at your usual prayer spot.
Look up the magnetic declination for your city (NOAA's calculator; type the city name, do not paste coordinates
anywhere) and a reference Qibla bearing (the app's own bearing is checked against published values in the tests).

| # | Test | iPhone | Android | Look at |
|---|------|--------|---------|---------|
| 1 | First permission: Allow While Using | | | `permission granted`, `location located`, fix accuracy and age |
| 2 | Hold flat, wait 10 s, don't move | | | Is `True heading (raw)` valid? iOS: never −1? Android: `true north seen` yes? |
| 3 | True − magnetic | | | Equals your city's declination (±1°)? If it is 0 on Android, the declination field is missing. |
| 4 | Reported accuracy over 1 minute, still and moving | | | Which levels appear; on Android, does it ever drop below 3 (if it stays 3 even near a magnet, it is likely the accelerometer's) |
| 5 | Figure-8 calibration | | | Does accuracy improve? |
| 6 | Magnet test: phone on a laptop, a magnetic case clasp, a steel desk | | | Heading jumps? Accuracy drops? Any `Last error`? Does the state stay out of `READY`? |
| 7 | Lay the phone still for 30 s | | | `Time since last event` grows; condition `quiet`; state not `READY`; one small movement brings events back |
| 8 | Point at a known reference (a street with a known bearing, or a separate compass corrected for declination) | | | `True heading (used)` within ±5–10° of the reference |
| 9 | Turn slowly until the arrow points up | | | `Turn` hint direction is right; arrow follows smoothly across north (no spin) |
| 10 | Android: Location permission "Approximate" only (Settings → Apps → Quran Heals → Location) | — | | Still a true heading? Fix accuracy (km)? |
| 11 | iPhone: Precise Location off (Settings → Quran Heals → Location) | | — | Still a true heading? |
| 12 | Background the app 10 s, come back | | | Stream restarts; no errors |
| 13 | Location services off | | | `location servicesOff`, no crash |
| 14 | Permission denied, then "Don't ask again" / "Never" | | | `denied` then `blocked`; no system dialog appears again |
| 15 | Use test city (London) | | | `Position in use manual`; state never above `APPROXIMATE` |
| 16 | iPad / tablet if available: portrait and landscape | | | iPad: state capped (`orientationUnverified`); does the heading shift by 90° in landscape? Android tablet: `Heading supported here: no` |

Send the copied reports (they contain no location) and the answers to rows 2–8 and 10–11; they decide whether any native
change is needed (none is planned).
