# Qibla Direction (اتجاه القبلة)

Home → **Qibla Direction** (directly under "A Message from the Quran") → `/qibla`: a live compass with a needle toward the
Qibla, the bearing from true north, permission and location handling, calibration help and an offline city fallback.
Owner-approved specification, 2026-11-06.

## Architecture (`mobile/src/qibla/`)

| File | Role |
|---|---|
| `qiblaMath.ts` | Kaaba 21.4225 N 39.8262 E; great-circle bearing; distance; special places (at the Kaaba, antipode, poles); position-accuracy → bearing uncertainty; angle unwrapping; circular smoothing. |
| `headingNormalize.ts` | expo-location heading events → TRUE heading only (iOS: negative = none; Android: −1 = none until the first other value, after which every value is real). Never the magnetic heading. |
| `compassReliability.ts` | One assessment: **unavailable / calibrate / approximate / ready**, with reasons. A steady or silent heading never adds confidence. |
| `qiblaCompassController.ts` | The lifecycle without React: permission (asked only from a tap), one cached or balanced fix (reused 10 min, never watched), the heading stream (only while focused and the app is active), retries (2, 4, 8, 8, 8 s), one re-assessment timer instead of polling. Its snapshot carries the bearing only. |
| `useQiblaCompass.ts` | Focus + AppState → controller. |
| `locationSource.native.ts` / `.ts` | The only expo-location importer (native); web/tests: no location. |
| `qiblaPresentation.ts` | Snapshot → what the screen shows (wording, tone, actions, accessibility). |
| `QiblaCompassDial.tsx`, `qiblaDialGeometry.ts` | SVG card turned by Reanimated (Reduce Motion: no easing); fixed left-to-right; needle at the bearing; fixed top marker. |
| `cities.ts`, `QiblaCityPicker.tsx`, `manualCityStorage.ts` | Offline city fallback; only the city's ID is stored, on the device. |
| (texts) | In the central `localization/messages.ts`, section `qibla` (`EN_QIBLA`, `AR_QIBLA`; ar-EG = ar), Western digits. |
| `diagnostics/` + `app/qibla-diagnostics.tsx` | **Development builds only** (see below). |

## Reliability rules

- **ready** needs: a true heading; iOS calibration at its best re-reported across 2 s; a reading within the last 10 s; the
  position's bearing uncertainty ≤ 3°; a phone in portrait; a device position (not a chosen city); no error in the last 5 s.
  Only then "Lined up with the Qibla bearing" / «متّجه نحو القبلة» (enter ±5°, leave ±8°). These thresholds compare the
  reading with the bearing; they are not a guarantee of the compass's own accuracy (iOS's best level allows up to 20°).
- **Android** is capped at approximate: stock expo-location reports the accelerometer's OR the magnetometer's accuracy.
  Android tablets show the bearing only until verified on a device.
- **Silence** after a valid heading (Android sends nothing while still) → "Move your phone slightly to refresh"; it never
  says the sensor is bad, and ready must be earned again from fresh readings.
- **Chosen city**: bearing only without location access; with it, a live compass capped at approximate.

## Privacy

Location is used on the device only, while the screen is open: never logged, stored, sent or synchronised; no background
location (`app.json`: every background/motion/foreground-service option off). Neither the snapshot nor the diagnostics
carry coordinates or the distance to the Kaaba (with the bearing it would locate the user). Enforced by
`tests/qiblaPrivacy.test.ts`. Policy text: `docs/legal/privacy-policy.{en,ar}.md` section 2.

## City data

`mobile/assets/qibla/cities.json` (≈3,100 places ≥ 100,000 people plus capitals, 205 KB) from Natural Earth 1:10m
(public domain), pinned in `tools/qibla/cities.lock.json`. Rebuild: `node tools/qibla/build-cities.mjs`; verify:
`node tools/qibla/build-cities.mjs --check`.

## Device diagnostics (development builds only)

`quranheals://qibla-diagnostics` opens the raw panel in a development build; release bundles drop it (`__DEV__ ?
require(...) : null`) and the route redirects to Home. Check on a real export:
`node mobile/scripts/verify-qibla-diagnostics-excluded.mjs`. Checklist: `docs/qibla-device-diagnostics.md`.

## Release notes

`expo-location` is a native module: new store builds are required (no OTA). Open items: the device checklist results;
the merged Android manifest's unused `LocationTaskService` (owner decides at build time); the first TestFlight upload's
purpose-string check (ITMS-90683); publishing the updated privacy policy on the legal site.
