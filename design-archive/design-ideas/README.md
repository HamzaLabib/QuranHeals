# Design ideas (considered, not implemented)

Ideas raised during the 2026-10-14 Mushaf redesign that were deliberately left out, with the reason, so they can be
picked up later without re-deriving the analysis.

- **Ayah-precise ورد positions.** Wirds store a page (`ReadingStop.page`); the separator's "Apply to … Wird" saves the
  ayah's page. Storing the ayah too needs a new synced field: the backend validates reading records strictly
  (`backend/src/validators/readingSyncValidators.ts` refuses unknown fields), so it means a backend schema change,
  a deploy before the app, and older apps ignoring the field. An earlier on-device field (`verseKey`, "phase 1") was
  deliberately dropped (`readingStops.ts`).
- **Page grows into the retired bar's space.** Removing the 64 pt reserved for the old bar would enlarge the page on
  height-limited phones (iPhone SE, 13 mini, small Android: see `../mushaf-page-layout-v1/geometry-and-calculations/`),
  changing the Quran's scale there without visual verification. Kept unchanged.
- **Quran text enlargement (2–4 %) and extra bottom breathing room (8–12 pt).** Not applied: the existing frame-clearance
  audit already finds the last line's descenders reaching the frame's inner rule on some pages at today's size
  (`docs/mushaf.md`, `docs/mushaf-device-testing.md` R28). Needs native-device screenshots of the worst pages first.
- **Background downloads** of the offline Mushaf (iOS background `URLSession`, Android WorkManager): deferred by decision.
