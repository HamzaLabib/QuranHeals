# Unicode Mushaf experiments (archived 2026-10-15)

**Status: paused.** QCF V1 is the only renderer in the app. Nothing in this folder is imported, bundled or tested by
the app: it sits outside `mobile/`, so Metro, TypeScript, ESLint and Vitest never see it, and the experiment's only npm
dependency (`@expo-google-fonts/amiri-quran`) was removed from `mobile/package.json`. Everything needed to bring it back
is here, including the generated data, so restoring needs no regeneration (see [Restoring](#restoring)).

## What was built

A development-only renderer that draws the 604-page, 15-line 1405 AH Madina Mushaf from **Unicode text** instead of
QCF V1's per-page glyph fonts, inside the unchanged production page (frame, beige paper, headings, medallions,
navigation, popups, ورد gold medallion, Khatma, favorites, reflections):

- **Text:** always the verified Tanzil Uthmani 1.1 text from `mobile/assets/quran/quran.sqlite`, read unchanged. Two
  display-only measures act on the drawn glyphs, never on the stored or copied text: inserted tatweels (justification)
  and a font-specific encoding of the two sukun signs. Both are reversible and tested on all 6,236 ayahs.
- **Layout:** line breaks from quran-madina-html's Madina05 table (`generated/madina05Layout.ts`): every page boundary
  of QCF V1 and every line break on pages 3–604 after one documented correction (13:37).
- **Widths:** each word's advance pre-measured with HarfBuzz (`tools/unicode-mushaf/measure-widths.py`), so a page
  lays out deterministically in pure TypeScript (`layout.ts`), the same in tests and on every platform.
- **Integrity:** per-page checksums of the verified text; a page that does not draw exactly its text is refused.
- **Tajweed Colors** (EN "Tajweed Colors", AR "ألوان التجويد", OFF by default): cpfair/quran-tajweed rules aligned to our
  text, coloured by whole letters; turning it on or off never moves a word.
- **Dev controls** in the reader's top bar (development builds only): QCF / Uni, font chip, ✓ rendering check,
  Tajweed Colors. The release bundle never contained any of it (`__DEV__`-gated `require`).

## Candidates

| Chip | Id | Font | Fitting | Result (604 pages, 340-px text area; web, Chrome) |
|---|---|---|---|---|
| KF | `hafs` | KFGQPC HAFS Uthmanic Script v18 (runtime download) | 21-em measure, kashida | First prototype. Thin, typographic next to QCF V1 |
| A·KF+ | `hafsPlus` | KFGQPC v18 | 19.5 em (≈8% larger), wider gaps, lighter kashida | Still thin. 102 lines drawn smaller (≥ ×0.900), widest gap 1.25 em |
| B·Mad | `madina` | QH Old Madina | 18.5 em, spaces only (narrow forms for long lines) | Authentic letterforms, uneven gaps (up to 2.69 em). 49 lines smaller (≥ ×0.923) |
| C·Mad✦ | `madinaCalligraphic` | QH Old Madina | 18 em; one letter per word takes the font's own longer form (up to 12 levels) | Closest to QCF V1 density, but **too many long stretched words**: 57.6% of words elongated, up to 1.17 em (judged artificial) |
| **C2·Mad** | `madinaNatural` | QH Old Madina | **Latest.** 17.25 em + 1% into the paper margin each side (+6.4% letters); elongation ≤ 0.42 em and ≤ 35% of a word, at most 3 levels, never two neighbours; gaps ≤ 0.45 em; a line may end up to 2 em short (centred) | No stretched words; dense pages close to QCF V1. Trade-off: 2,127 of ≈8,780 lines (24%) end slightly short, gaps still wider than QCF V1 on ordinary pages, 249 lines drawn smaller (≥ ×0.871) |
| Am | `amiri` | Amiri Quran 1.0 (OFL) | as KF | Naskh baseline for comparison |

**QH Old Madina** = DigitalKhatt Old Madina (OFL 1.1, modelled on the Madina Mushaf in Uthman Taha's hand) plus one
contextual rule: a letter followed by *n* tatweels takes its *n*-th calligraphic `cv01` form and the tatweels draw
nothing; `cv03` narrow forms exposed as `ss13`. Built reproducibly by `tools/unicode-mushaf/build-madina-font.py`.

**Conclusion at the pause:** C2 is the most natural Unicode rendering reached, but it is **not** visually equivalent to
QCF V1. QCF V1 fills lines with its own wider letterforms and swash elongations; with the 604-page/15-line structure
fixed, a Unicode font must choose between longer stretches (C) and looser or shorter lines (C2). Full write-up:
`docs/unicode-mushaf/visual-candidates.md` (C2 section at the end).

## Known issues

**Rendering**
- **No physical-device testing was done.** Everything was checked by unit tests and headless Chrome only. The device
  checklist is `docs/unicode-mushaf/device-testing-checklist.md`.
- iOS: QH Old Madina is moved 0.2 em down on iOS only. That value comes from the TextKit metrics rule (the one that
  explained QCF V1's 0.376 em iPhone offset), not from a device measurement.
- Android: React Native draws each Tajweed colour run as its own span; letters joining across colour boundaries is
  unverified on devices.
- Two words QH Old Madina cannot draw are drawn in Amiri Quran: 11:41 (page 226) and 12:11 (page 236).
- KFGQPC v18/v22 use KFGQPC's sukun encoding: Tanzil text must be drawn with U+0652→U+06E1 and U+06DF→U+0652
  (`encoding.ts`), otherwise every sukun renders as the silent-letter circle.
- QH Old Madina is 2.59 MB, not subsetted.

**Licensing** (`docs/unicode-mushaf/licensing.md`, `licenses/NOTICES.md`). No external party was contacted.
- Madina05 layout: "Waqf" GPL 2.0 in LICENSE.md vs ISC in package.json. Shipping a Waqf-licensed data file inside the
  app needs legal review. **Blocker.**
- Its upstream OCR data (AyahInfo_1024.db) has no licence and derives from KFGQPC's page composition. **Blocker**: needs
  KFGQPC's permission or another layout source with clear terms.
- KFGQPC v18 font (KF, A only): needs KFGQPC's written confirmation; never commit it. C/C2 avoid it (QH Old Madina is OFL).
- Tajweed data CC BY 4.0 and Tanzil credits are required in Quran Sources & Credits if this ships.

## What is where

| Path | Contents |
|---|---|
| `mobile/src/mushaf/unicode/` | The prototype: `layout.ts` (layout engine, natural fitting), `data.ts` (candidates), `encoding.ts`, `font.ts`, `index.ts` (the reader's entry), `integrity.ts`, `tajweed.ts`, `words.ts`, `marker.ts`, `diagnostics.ts` (✓ mode), `settings.ts`, `fonts/QHOldMadina.ttf`, `generated/` (layout, widths for KFGQPC, QH Old Madina and Amiri, Tajweed rules) |
| `mobile/src/components/UnicodeMushafPageText.tsx` | The page renderer (words, medallions, headings, highlight, Tajweed, check mode) |
| `mobile/tests/unicodeMushaf*.test.ts` | 604-page integrity, layout quality per candidate, C2 rules, Tajweed, component tests |
| `tools/unicode-mushaf/` | Generators: Madina05 fetch (pinned), layout and Tajweed generators, HarfBuzz width measurement, font build, layout comparison; own README |
| `docs/unicode-mushaf/` | Feasibility report, visual candidates, licensing, migration plan, device checklist |
| `restore/` | `restore.mjs`, `reader-integration.patch` (the reader, screen test, package.json and docs changes against commit `545d2d9`), `reference/` (the full patched files) |
| `third-party-fonts/`, `licenses/` | Unmodified OFL source fonts (DigitalKhatt Old Madina, Amiri Quran) and their licences, `NOTICES.md` |
| `research-scripts/` | The ad-hoc scripts behind the screenshots and parameter sweeps (Puppeteer capture, QCF V1 reference harness, layout sweeps, font analysis). Paths resolve from each script's own location (repository root = `../../../`); the layout sweeps import the prototype from `mobile/src/mushaf/unicode/`, so run them after `restore/restore.mjs`. `qcf-reference/make-qcf.mjs` writes its QCF V1 pages to the current folder and `screenshots-tool/cand*.mjs` read them from `QCF_REFERENCE_DIR` (default `./qcf`): keep that folder outside the repository (QF content) |
| `screenshots/` | **Local only (git-ignored)**: copies of the four comparison folders (see below) |

**Screenshots** (originals in `Working progress/Screenshots and Logs/`, copied into `screenshots/`):
`unicode-mushaf-prototype-2026-10-15` (first prototype), `unicode-mushaf-readiness-2026-10-15` (Android hardening, Tajweed),
`unicode-mushaf-candidates-2026-10-15` (A/B/C vs QCF V1, close-ups, 35 regression shots),
`unicode-mushaf-c2-2026-10-15` (C vs C2 vs QCF V1 for pages 1, 2, 3, 5, 44, 69, 187, 193, 254, 319, 560, 595, 604).

## Restoring

Tested on 2026-10-15 in a clean worktree of commit `545d2d9`: restore, then 276/276 tests and `tsc` passed, and the
restored reader file was identical to `restore/reference/`.

```sh
# from the repository root
node unicode-experiments/restore/restore.mjs --dry-run   # shows what it will copy; refuses if anything is already there
node unicode-experiments/restore/restore.mjs             # copies everything back and applies the reader patch
cd mobile && npm install                                  # adds @expo-google-fonts/amiri-quran@0.4.1 (devDependency)
npx vitest run tests/unicodeMushafIntegrity.test.ts tests/unicodeMushafPage.test.ts tests/mushafScreen.test.ts
npx tsc --noEmit -p .
npx expo start --dev-client --clear                       # Mushaf tab → QCF chip → Uni; font chip → C2·Mad
```

- The archive stays in place after restoring; delete `unicode-experiments/mobile` etc. only once the restored copy is
  committed.
- If the reader (`mobile/src/app/(tabs)/mushaf.tsx`) has changed since `545d2d9`, the script stops before changing
  anything. Merge `restore/reader-integration.patch` by hand (`restore/reference/` has the full files it produced).
- The existing development build runs it from Metro (no native module). The KFGQPC font (KF, A) downloads on first
  use and needs internet once; C, C2, B and Amiri are bundled.
- Deep link: `quranheals://mushaf?page=5&renderer=unicode`.

**Local-only files a full restore needs** (git-ignored, not in a fresh clone):
- `mobile/src/mushaf/unicode/generated/madina05Layout.ts`: the Madina05 page/line table, kept out of the public
  repository while its redistribution rights are unresolved (see Licensing). Every candidate imports it (`data.ts`).
  On this machine it is in the archive and `restore.mjs` copies it; in a fresh clone, restore first, then regenerate it
  in place from the repository root: `node tools/unicode-mushaf/generate-layout.mjs <cache outside the repo>` (needs
  internet; pinned by `madina05.lock.json`; the script only runs from the restored location).
- `mobile/src/mushaf/unicode/generated/hafsWordWidths.ts`: the KF/A width table, measured from KFGQPC HAFS Uthmanic
  Script v18 and kept out of the public repository because that font's terms restrict it (`licenses/NOTICES.md`).
  `data.ts` imports it. On this machine it is in the archive and `restore.mjs` copies it; in a fresh clone, regenerate
  it with `tools/unicode-mushaf/measure-widths.py` from the downloaded font (`tools/unicode-mushaf/README.md`).
- `screenshots/`: evidence only, not needed to run anything.

**Related, outside this archive:** the 17 comparison images of the earlier larger-text experiment,
`design-archive/experiments/larger-text-mushaf/comparisons/*.png` (14 side-by-side panels and 3 sets of 1:1 crops of
pages 4 and 604), are QCF V1 page renders. Since 2026-10-17 they are local only: they remain on disk on this machine
(with a verified copy in the private audit archive; `comparisons/ARCHIVED.md` there lists their hashes) but are excluded
from public Git tracking (root `.gitignore`), because the rights to redistribute QCF V1 renderings
(Quran Foundation content) have not been confirmed. Since the 2026-10-17 history rewrite, no commit contains them. They are not needed to restore
or run anything here.

**Regenerating data (only if inputs change; not needed to restore):** Python 3 with `uharfbuzz==0.56.3` and
`fontTools` for `measure-widths.py` and `build-madina-font.py`; Node 22+ for the `.mjs` tools; the KFGQPC v18 font
(downloaded, SHA-256 `a0636e68…`) for the KF/A width tables; `third-party-fonts/DigitalKhatt-OldMadina-4d8b53f5.ttf` for
QH Old Madina. Steps and commands: `tools/unicode-mushaf/README.md`.
