# Unicode Mushaf prototype tools

Generators and audits for the development-only Unicode Mushaf prototype
(`mobile/src/mushaf/unicode/`, report: `docs/unicode-mushaf/feasibility-report.md`).
Downloads go to a cache directory **outside the repository**, pinned by SHA-256.

| Script | What it does | Output |
|---|---|---|
| `compare-layouts.mjs <cache> [report.json]` | Madina05 (quran-madina-html) against the verified Tanzil text, letter by letter, and against the QCF V1 layout (local Content Sync snapshot, if present), word by word, on all 604 pages | console; optional JSON (page/line numbers and verse keys only) |
| `generate-layout.mjs <cache> [--check]` | Builds the page/line table: Madina05 placement, verified Tanzil tokens, two documented corrections (13:37), per-page text checksums | `mobile/src/mushaf/unicode/generated/madina05Layout.ts` |
| `measure-widths.py <font> <out> --name N [--display kfgqpc\|dk] [--elongation N] [--fallback <font> --fallback-chars …]` | HarfBuzz widths, kashida points and (QH Old Madina) calligraphic elongation levels of every word group; audits that every in-word mark is a GDEF mark glyph (fails otherwise) | `generated/hafsWordWidths.ts`, `amiriWordWidths.ts`, `madinaWordWidths.ts` |
| `build-madina-font.py <oldmadina.ttf> <out.ttf>` | QH Old Madina: DigitalKhatt Old Madina (OFL, pinned SHA-256) plus a rule turning a letter + n tatweels into its n-th calligraphic form (tatweels invisible) and narrow forms as ss13; reproducible | `mobile/src/mushaf/unicode/fonts/QHOldMadina.ttf` |
| `generate-tajweed.mjs <cache> [--check]` | Carries cpfair/quran-tajweed's 60,057 annotations onto the verified text (exact alignment, same letters), widened to whole letters | `generated/tajweedRules.ts` |

`madina05.mjs` (shared) and `madina05.lock.json` (pinned commit and hashes) support the first two.

## Regenerating

From `QuranHeals/` (Node 24; Python 3.12 with `uharfbuzz` 0.56 and `fontTools` 4.67 in a virtual environment):

```sh
CACHE=../unicode-mushaf-cache    # anywhere outside the repository
node tools/unicode-mushaf/generate-layout.mjs $CACHE
node tools/unicode-mushaf/generate-tajweed.mjs $CACHE
# KFGQPC HAFS Uthmanic Script v18 from Quran Foundation's CDN (SHA-256 a0636e68…cec3a, 242,368 bytes):
curl -o $CACHE/UthmanicHafs1Ver18.ttf https://verses.quran.foundation/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.ttf
AMIRI=mobile/node_modules/@expo-google-fonts/amiri-quran/400Regular/AmiriQuran_400Regular.ttf
python tools/unicode-mushaf/measure-widths.py $CACHE/UthmanicHafs1Ver18.ttf mobile/src/mushaf/unicode/generated/hafsWordWidths.ts \
  --name HAFS --display kfgqpc --fallback $AMIRI --fallback-chars 06EB,06E3
python tools/unicode-mushaf/measure-widths.py $AMIRI mobile/src/mushaf/unicode/generated/amiriWordWidths.ts --name AMIRI
# DigitalKhatt Old Madina @ 4d8b53f5 (SHA-256 de2a8de4…0656) → QH Old Madina:
curl -o $CACHE/oldmadina.ttf https://raw.githubusercontent.com/DigitalKhatt/oldmadinafont/4d8b53f530513d59074b5b0e8ab40cb7445ea1e0/fonts/oldmadina.ttf
python tools/unicode-mushaf/build-madina-font.py $CACHE/oldmadina.ttf mobile/src/mushaf/unicode/fonts/QHOldMadina.ttf
python tools/unicode-mushaf/measure-widths.py mobile/src/mushaf/unicode/fonts/QHOldMadina.ttf mobile/src/mushaf/unicode/generated/madinaWordWidths.ts \n  --name MADINA --display dk --elongation 12 --fallback $AMIRI --fallback-chars 06EA,06EB
```

On Windows, set `PYTHONUTF8=1`. All four outputs were checked to regenerate byte for byte (2026-10-15).
The width tables must be regenerated whenever a font file changes; the reader's font loader refuses any
file whose SHA-256 differs from the one measured.

## Licences of the inputs

- quran-madina-html (Madina05 layout): "Waqf" General Public License 2.0 — the derived layout carries the
  licence, the attribution and the list of modifications in its header.
- cpfair/quran-tajweed: CC BY 4.0 — attribution in `tajweedRules.ts`; must also appear in the app's credits if shipped.
- KFGQPC HAFS Uthmanic Script v18: KFGQPC's licence (no modification) and Quran Foundation's font terms; never committed.
- Amiri Quran: SIL Open Font License 1.1.
- DigitalKhatt Old Madina / QH Old Madina: SIL Open Font License 1.1 (modified version, renamed; may be committed).
