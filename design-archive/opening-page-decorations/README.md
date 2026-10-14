# Pages 1–2 opening decorations

From revision `529a724`. **The approved rich green-and-gold circular illumination (`OpeningPageOrnamentRich.tsx`) is
live and unchanged; nothing in the 2026-10-14 redesign touches pages 1–2's ornament, text arrangement or geometry.**

| Design | File | Status |
|---|---|---|
| Rich illumination (approved 2026-10-14) | `original-source/mobile/src/components/OpeningPageOrnamentRich.tsx` | Active default |
| Original circle ornament | `original-source/mobile/src/components/OpeningPageOrnament.tsx` | Kept in the app as the rollback (`OPENING_PAGES_DECORATION = 'original'`) |

Git history: the original ornament was introduced in `45af335` (2026-10-12) with the same content as at `529a724`
(identical blob), so no separate earlier version exists to archive. Both draw in the frame's own coordinates
(`width`/`height` props), so they scale with the page; the text block is centred on the ornament by `QpcV1PageText`
(see `../mushaf-page-layout-v1/`).

Test: `tests/mobile/tests/openingPages.test.ts`. **Restore** the original: `OPENING_PAGES_DECORATION = 'original'` in
`mobile/src/mushaf/decorations.ts`.
