# Mushaf decorations: current designs and rollback

Two decorations of the Mushaf have a current design and an earlier one. Both designs of each are kept in the
repository, unchanged and working in Light and Dark; switching is one line, and the two choices are independent.

| Decoration | Current (default, approved 2026-10-14) | Earlier (kept for rollback) |
|---|---|---|
| Pages 1–2 ornament | `mobile/src/components/OpeningPageOrnamentRich.tsx` — the richer green-and-gold illumination | `mobile/src/components/OpeningPageOrnament.tsx` — the original circle ornament |
| Surah headings (every page except 1–2) | `mobile/src/components/SurahHeadingTraditional.tsx` — the traditional olive-and-gold band | `mobile/src/components/SurahHeaderOrnament.tsx` — the original emerald cartouche |

Pages 1–2 always keep their own compact title cartouche (`SurahHeaderOrnament` with `compact`), whichever heading is
chosen. Both opening ornaments draw the same circle (`openingCircleGeometry`), so the Quran text never moves; both
headings fit the same heading row and leave every Surah name the same clearance.

## Where the choice is made

`mobile/src/mushaf/decorations.ts`:

```ts
export const OPENING_PAGES_DECORATION: OpeningDecoration = 'rich';           // or 'original'
export const SURAH_HEADING_DECORATION: HeadingDecoration = 'traditional';    // or 'original'
```

## Restore the original Surah heading

In `mobile/src/mushaf/decorations.ts`, change one line:

```ts
export const SURAH_HEADING_DECORATION: HeadingDecoration = 'original';
```

## Reactivate the traditional Surah heading

```ts
export const SURAH_HEADING_DECORATION: HeadingDecoration = 'traditional';
```

## Restore / reactivate the pages 1–2 ornament

```ts
export const OPENING_PAGES_DECORATION: OpeningDecoration = 'original'; // the original circle ornament
export const OPENING_PAGES_DECORATION: OpeningDecoration = 'rich';     // the current illumination
```

No files need restoring and no commits need reverting. `mobile/tests/mushafDecorations.test.ts` checks both designs
of each decoration still render.

## Previewing without editing (development builds only)

`/mushaf?page=440&heading=original`, `/mushaf?page=1&opening=original` (or `=traditional`, `=rich`). Release builds
ignore these parameters and always use the constants.

## History

Chosen on 2026-10-14 from a side-by-side comparison of real renders. The comparison screenshots, the exact baseline
copies and the experiment's notes are outside the repository in
`My App/Mushaf Decoration Experiment 2026-10-14/`.
