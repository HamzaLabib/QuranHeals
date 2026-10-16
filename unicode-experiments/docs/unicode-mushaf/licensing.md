# Unicode Mushaf — licensing and redistribution assessment

**Date:** 2026-10-15. **Status:** assessment only. No external party was contacted and no separate licence was requested
(as instructed for this phase). This is not legal advice; items marked **BLOCKER** must be resolved before a production
release that ships the Unicode Mushaf. Hosting on GitHub does not by itself grant any right to redistribute.

Each row was checked against the actual licence text (font `name` tables, licence files, project READMEs and terms
pages, read 2026-10-15).

| Asset | Source | Terms (as read) | What the prototype does | In the repository? | Production status |
|---|---|---|---|---|---|
| **Quran text** | Tanzil Uthmani 1.1 (`mobile/assets/quran/quran.sqlite`) | CC BY 3.0 with Tanzil's terms: verbatim copies allowed, **"CHANGING IT IS NOT ALLOWED"**, credit Tanzil and link tanzil.net; notice to be reproduced in files derived from the text | Stored and copied unchanged. Two display-only measures are applied to the drawn glyphs: kashida (tatweel) for justification, and KFGQPC's encoding of the two sukun signs. Both are reversible and tested byte for byte. Generated tables carry the Tanzil notice | yes (existing) | OK, already credited. **Note:** confirm internally that display-only justification and encoding do not count as "changing" the text (the stored, copied and shared text is never changed) |
| **KFGQPC HAFS Uthmanic Script v18** | Quran Foundation's documented CDN (`verses.quran.foundation/.../UthmanicHafs1Ver18.ttf`) | KFGQPC EULA (in the font): use, copy and distribute free of cost; **may not be sold, modified, altered, translated, reverse-engineered or reproduced** without written approval. QF font terms: may be cached or bundled **only as an integrated part of the app**, never "offered separately … through … asset package, or standalone download"; credit QF; keep an active Developer Console account | Downloaded at runtime, verified by SHA-256, cached on the device; never modified (the display encoding acts on the text, not the font) | **no** (git-ignored path planned; the repository is public) | **BLOCKER (shared with QCF V1):** KFGQPC's written confirmation, the same open item as the QCF V1 fonts. Bundle only through the git-ignored restore pipeline (as `p61.ttf`), never commit |
| **QH Old Madina** (candidate C, recommended) | Derived from DigitalKhatt Old Madina, github.com/DigitalKhatt/oldmadinafont @ `4d8b53f5` (© 2023–2026 DigitalKhatt contributors) | **SIL OFL 1.1**, no Reserved Font Name declared: use, modify, bundle and redistribute (not sell alone); modified versions keep the OFL | `tools/unicode-mushaf/build-madina-font.py` adds one contextual rule (a letter + n tatweels → its n-th `cv01` form) and exposes `cv03` as `ss13`; renamed "QH Old Madina", modification recorded in the font's name table (ID 10) | **yes** (`mobile/src/mushaf/unicode/fonts/QHOldMadina.ttf`, 2.59 MB) | **OK** with credit ("DigitalKhatt Old Madina, OFL, modified") and the OFL text in the credits. Removes the KFGQPC font blocker if adopted |
| **Madina05 layout** | quran-madina-html (Tarek Eldeeb), commit `bed882fc` | `LICENSE.md`: "Waqf" General Public License 2.0, which allows use and redistribution; **modified works may be redistributed only under Waqf**, naming the original and the nature of the modification. **Inconsistency:** the library's `package.json` and README badge say ISC | Derived table (`generated/madina05Layout.ts`): placement only, text replaced by references, 2 corrections, all listed in its header with the Waqf notice | yes (generated) | **BLOCKER (legal review):** (1) the ISC/Waqf inconsistency; (2) whether a Waqf-licensed data file can ship inside the app without imposing Waqf on the rest of it (Waqf has no explicit combined-work clause) |
| **OCR data behind Madina05** | `AyahInfo_1024.db`, downloaded by the library from murtraja/quran-android-images-helper (**no licence**); made by quran.com's image generator (quran.com-images: code GPL, but "the actual fonts and pages … belong to the King Fahd Quran Complex") from KFGQPC's old Madani fonts | Unlicensed redistribution of glyph-box data derived from KFGQPC's page images; quran_android says its data is "licensed under the various licenses of the data's authors, typically CC BY-NC-ND" | Only the page/line of each word was used, through Madina05; the database itself is not in the repository | no | **BLOCKER:** the line placement ultimately reflects KFGQPC's page composition (the same as QCF V1's, which Quran Foundation's terms do not let us prepackage). Needs KFGQPC's (or another authoritative layout owner's) permission, or a layout source with clear terms |
| **Tajweed annotations** | cpfair/quran-tajweed, commit `496f71cd` | Data file: **CC BY 4.0**. The repository states no licence for its classifier code (only run locally, never shipped) | Offsets carried onto our text and widened to whole letters (modification noted in the header) | yes (generated) | OK with attribution: add "Tajweed rules: cpfair/quran-tajweed (CC BY 4.0), adapted" to Quran Sources & Credits before release |
| **Amiri Quran** | `@expo-google-fonts/amiri-quran@0.4.1` (TTF from Google Fonts, © The Amiri Quran Project Authors) | **SIL OFL 1.1** (no Reserved Font Name declared); package code MIT | Bundled in development builds; fallback for 2 words and selectable font | via npm (devDependency) | OK: may be bundled and committed; include the OFL notice in credits |
| **Medallion artwork** | quran-ws/quran-svg v1.1.1 (already in production) | As already documented for the production reader | Reused unchanged | yes (existing) | unchanged |
| **Library renderer code** | quran-madina-html JS/CSS | Waqf/ISC (as above) | **Not used** (reimplemented natively) | no | n/a |

## Rules followed in this phase

- No restricted file was committed: KFGQPC v18 is downloaded and verified at runtime; the OCR database and the library's
  JSON stay in a cache outside the repository (pinned by SHA-256).
- Every generated file names its sources, licences and modifications in its header.
- Nothing was published or distributed (no commit, push, build or release).

## What must happen before a production release

1. KFGQPC: written confirmation for the page/line layout (and for the HAFS Uthmanic Script font only if candidate A or
   the KFGQPC fallback is kept; the recommended candidate C uses the OFL-licensed QH Old Madina instead).
2. Legal review of the Madina05 licence (Waqf vs ISC) and of shipping a Waqf-licensed data file in the app; or replace
   it with a layout from a source with clear terms (for example, an official KFGQPC layout, if licensed).
3. Credits: Quran Foundation (font CDN, already credited), DigitalKhatt Old Madina (OFL, modified as QH Old Madina),
   cpfair/quran-tajweed (CC BY 4.0, adapted), Amiri Quran (OFL),
   quran-madina-html (Waqf, modified), Tanzil (already credited).
4. Keep Quran Foundation's Developer Console account active while QF-sourced fonts are bundled.
