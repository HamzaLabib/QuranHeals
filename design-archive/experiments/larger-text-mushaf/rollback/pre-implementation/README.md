# Before candidate C was implemented (rollback copy)

Byte-exact copies of the files the candidate C implementation changed, taken from the working tree on 2026-10-14 just
before the change (uncommitted at the time; base revision `529a7241d9d79717df9ead4ac85e814be00cb3b1` plus the
uncommitted navigation redesign). `SHA256SUMS` lists each file's hash.

These are working-tree snapshots, so they are not verifiable from Git as `design-archive/MANIFEST.json`'s originals
are. The printed page geometry itself is unchanged since `529a724` and is archived and Git-verified in
`design-archive/mushaf-page-layout-v1/` (`node design-archive/verify-archive.mjs`).

| File | What candidate C changed in it |
|---|---|
| `mobile/src/mushaf/pageGeometry.ts` | `textInsetX` (the plain side margin) narrowed for `QURAN_TEXT_SCALE` = 1.05; added `PRINTED_TEXT_INSET_X`, `PRINTED_TEXT_WIDTH_SHARE`, `QURAN_TEXT_SCALE` and `MIN_TILES_DOWN` |
| `mobile/src/app/(tabs)/mushaf.tsx` | `fitMushafPage`: the 64-pt band reclaimed, Taller in both modes (at least `MIN_TILES_DOWN`), full screen at Normal Mode's width, the page-selector room kept in Normal Mode |
| `mobile/src/components/QpcV1PageText.tsx` | Pages 1–2's letter size taken on the printed text width (`openingPageSize`), so it does not grow |
| `mobile/src/components/MushafPageSelector.tsx` | Exports `PAGE_SELECTOR_CARD_HEIGHT` and `PAGE_SELECTOR_BOTTOM_MARGIN` (no visual change) |
| `mobile/src/components/MushafPageView.tsx`, `MushafStopNameField.tsx`, `MushafWirdSelector.tsx` | Unchanged (copied as context) |
| `mobile/tests/mushafScreen.test.ts` | Expectations of the fit (other tests changed too: see the review README) |

## Restoring

The quickest exact rollback of the text size alone: set `QURAN_TEXT_SCALE = 1` in `pageGeometry.ts` (the printed
proportions return; `MIN_TILES_DOWN` becomes 29). To restore the whole previous fit (the reserved band, Normal Mode always
29 tiles), copy the files back to the same paths:

```sh
cp "design-archive/experiments/larger-text-mushaf/rollback/pre-implementation/mobile/src/mushaf/pageGeometry.ts" mobile/src/mushaf/
cp "design-archive/experiments/larger-text-mushaf/rollback/pre-implementation/mobile/src/app/(tabs)/mushaf.tsx" "mobile/src/app/(tabs)/"
cp "design-archive/experiments/larger-text-mushaf/rollback/pre-implementation/mobile/src/components/QpcV1PageText.tsx" mobile/src/components/
cp "design-archive/experiments/larger-text-mushaf/rollback/pre-implementation/mobile/src/components/MushafPageSelector.tsx" mobile/src/components/
```

Then restore the tests' expectations the same way (or from Git once committed) and run `npm run typecheck && npm test`
in `mobile/`. This `mushaf.tsx` already contains the Keep Screen Awake hook (it was taken after that change); any edit
made to these files after 2026-10-14 needs merging, not overwriting.
