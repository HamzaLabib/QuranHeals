# Surah headings

From revision `529a724`; the approved design is still live and unchanged by the 2026-10-14 redesign.

| Design | File | Status |
|---|---|---|
| Original emerald cartouche | `original-source/mobile/src/components/SurahHeaderOrnament.tsx` | Kept in the app as the rollback (`SURAH_HEADING_DECORATION = 'original'`) |
| Earlier version of that cartouche | `history/2cc7e75/mobile/src/components/SurahHeaderOrnament.tsx` | From commit `2cc7e75` (2026-10-12), before `45af335` |
| Traditional olive-and-gold band (approved 2026-10-14) | `original-source/mobile/src/components/SurahHeadingTraditional.tsx` | Active default |

Both live designs take their colours from props, so Light and Dark are the same component (the reader passes the
page's furniture colours). Placement maths: `mushaf/surahHeadingPlacement.ts` (the heading row and its name's room) and
`generated/surahHeadingNeighbours.ts` (clearance to the neighbouring lines' ink). The switch: `mushaf/decorations.ts`.

Tests: `surahHeaderOrnament`, `surahHeadingClearance`, `surahOpenings`, `mushafDecorations` (`tests/`).
Reference: `references/docs/mushaf-decorations.md` (the one-line rollback).

**Restore** the original cartouche: set `SURAH_HEADING_DECORATION = 'original'` in `mobile/src/mushaf/decorations.ts`
(no files to copy). The `2cc7e75` version: copy it over `mobile/src/components/SurahHeaderOrnament.tsx`.
