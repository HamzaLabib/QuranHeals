# Third-party notices for the archived Unicode Mushaf experiments

| Item in this archive | Source | Licence | Notes |
|---|---|---|---|
| `third-party-fonts/DigitalKhatt-OldMadina-4d8b53f5.ttf` (SHA-256 `de2a8de4…0656`) | github.com/DigitalKhatt/oldmadinafont @ `4d8b53f5`, © 2023–2026 DigitalKhatt contributors | SIL OFL 1.1 (`OFL-DigitalKhatt-OldMadina.txt`), no Reserved Font Name | Unmodified source of QH Old Madina |
| `mobile/src/mushaf/unicode/fonts/QHOldMadina.ttf` (SHA-256 `87413c86…ad12`) | Built from the font above by `tools/unicode-mushaf/build-madina-font.py` | SIL OFL 1.1 (modified version; the modification is recorded in its name table, ID 10) | Renamed "QH Old Madina" |
| `third-party-fonts/AmiriQuran_400Regular.ttf` | `@expo-google-fonts/amiri-quran@0.4.1`, © The Amiri Quran Project Authors | SIL OFL 1.1 (`OFL-AmiriQuran.txt`); the npm package's code is MIT | Fallback font; also restorable from npm |
| `mobile/src/mushaf/unicode/generated/amiriWordWidths.ts`, `madinaWordWidths.ts` | Advance widths of the verified Tanzil Uthmani 1.1 text (`mobile/assets/quran/quran.sqlite`, unchanged), measured in Amiri Quran and QH Old Madina (both above) | Tanzil terms (CC BY 3.0, no changes to the text); the fonts' OFL 1.1 | Each file carries the Tanzil notice; they hold widths and positions, the text is read from SQLite |
| `generated/hafsWordWidths.ts` | Advance widths of the same Tanzil text measured in **KFGQPC HAFS Uthmanic Script v18** (SHA-256 `a0636e68…cec3a`), downloaded from Quran Foundation's CDN | KFGQPC EULA (no modification or reverse engineering without written approval) and Quran Foundation's terms (the font only inside the app); Tanzil terms for the text | **Kept local, git-ignored, not published**: numbers only (no glyphs or outlines), but derived from a font whose terms restrict it. Regenerate with `tools/unicode-mushaf/measure-widths.py` (`tools/unicode-mushaf/README.md`) |
| `generated/madina05Layout.ts` | quran-madina-html (Tarek Eldeeb) @ `bed882fc` | "Waqf" GPL 2.0 per its LICENSE.md (its package.json says ISC) | **Open licensing question** (see `docs/unicode-mushaf/licensing.md`): **kept local, git-ignored, not published**; its upstream OCR data (AyahInfo_1024.db) is unlicensed and is **not** archived |
| `generated/tajweedRules.ts` | cpfair/quran-tajweed @ `496f71cd` | CC BY 4.0 | Adapted (offsets moved to our text, widened to whole letters) |

**Not archived, on purpose** (redistribution not permitted, or not ours to republish):
- KFGQPC HAFS Uthmanic Script v18 (candidates A and the first prototype): the app downloads it at runtime from Quran
  Foundation's CDN and checks its SHA-256 (`mobile/src/mushaf/unicode/font.ts`). KFGQPC's EULA forbids modification and
  Quran Foundation's terms forbid offering it separately.
- QCF V1 page fonts and the Content Sync snapshot used for comparisons (Quran Foundation content).
- The Madina05 OCR database and the library's raw JSON (re-fetched at the pinned commit by `tools/unicode-mushaf/madina05.mjs`).
