# Unicode Mushaf — visual candidates against QCF V1 (2026-10-15)

**Goal:** a Unicode rendering as close as technically possible to the original QCF V1 (1405 AH, Uthman Taha) Mushaf.
QCF V1 stays the production default; everything here is development-only.

**Screenshots** (web, headless Chrome, 393-pt phone width, same text area for every rendering):
`Working progress/Screenshots and Logs/unicode-mushaf-candidates-2026-10-15/`
- `pNNN-side-by-side.png`: QCF V1 | A | B | C for pages 1, 2, 3, 5, 187, 254, 319, 560, 595, 604;
- `p003-`, `p005-`, `p595-closeup-*.png`: word, letter-connection and diacritic close-ups;
- `raw/`: each rendering alone (including the first prototype and Tajweed ON for C);
- `regression/`: the 35-shot check (0 overlaps, 0 outside) and 11/11 interaction checks with C.

The QCF V1 reference is drawn from the local Content Sync layout with its page fonts (scratchpad only, not in the
repository), justified as the production reader does. **These are browser renderings, not device screenshots.**

## 1. Font research (actual files, checked)

| Font | Source / version | Draws the verified Tanzil text? | Look against QCF V1 | Terms | Verdict |
|---|---|---|---|---|---|
| **DigitalKhatt Old Madina** | github.com/DigitalKhatt/oldmadinafont @ `4d8b53f5` (v0.1, 6,162 glyphs) | **Yes, all but 2 words** (U+06EA in 11:41, U+06EB in 12:11 → Amiri). Standalone pause signs must attach to their word (display rule `dk`) | **Closest by far**: drawn from the Madina Mushaf in Uthman Taha's hand; same stroke weight, contrast and proportions | **SIL OFL 1.1** (no Reserved Font Name); bundling, modifying, committing allowed | **Chosen** (B, C) |
| KFGQPC HAFS Uthmanic Script v18 | QF CDN, `UthmanicHafs1Ver18.ttf` | With the sukun display swap; 2 words → Amiri | Typographic, light strokes, wide letters for their height | KFGQPC EULA (no modification) + QF font terms | A, first prototype |
| KFGQPC HAFS v22 | Tarteel QUL CDN | Same encoding problems as v18 | Like v18 | Redistribution terms unclear | Rejected |
| KFGQPC HAFS v1.001 | quran-madina-html's WOFF2 | No tatweel glyph at all; U+06EB/U+06E3 broken | Like v18 | Unverified origin | Rejected |
| KFGQPC Uthman Taha Naskh | quran-madina-html | **No** — lacks ٱ (4,829 ayahs) and most pause signs | Madina-like | KFGQPC EULA | Rejected (would need text changes) |
| Amiri Quran / Colored | OFL | Yes | Bulaq Naskh, not Madina; "Colored" colours glyph types, not tajweed rules | OFL | Baseline only |
| me_quran | quran-madina-html | Yes | Older Naskh | "Free for non-commercial use" | Rejected (licence) |

DigitalKhatt's font also contains the calligrapher's justification: `cv01`, up to 12 graded longer forms of 493 letters
(longer letter bodies, not tatweel bars), and `cv03`, narrower forms.

## 2. The three candidates

| | Font | Size (measure) | Justification |
|---|---|---|---|
| **A — Enhanced KFGQPC** | KFGQPC v18 (sukun swap) | 19.5 em (larger than the first prototype's 21) | wider gaps, lighter kashida (≤ 2 per word, 5 on sparse lines) |
| **B — Alternative authentic font** | **QH Old Madina** | 18.5 em | spaces only, narrower forms for lines too wide |
| **C — Advanced traditional justification** | **QH Old Madina** | 18 em | **calligraphic**: one connection per word takes its own longer letter form; on about one word in three, longer words first, never two neighbours, at most 4 levels each at first (6 is the most most letters have); gaps 0.2 em; narrower forms, then at most a slightly smaller line, for lines too wide |

**QH Old Madina** is DigitalKhatt Old Madina with one addition (`tools/unicode-mushaf/build-madina-font.py`, OFL
derivative, renamed): a letter followed by *n* tatweels takes its *n*-th `cv01` form and the tatweels draw nothing.
React Native can only select OpenType features for a whole word, and a whole-word feature would stretch every letter
of the word (tested: unnatural). With this rule the reader picks the one connection, as kashida always did (the same
legal points, `words.ts`), and the text it draws stays the verified text plus inserted tatweels — removed again for
every check and never copied. Default shaping is unchanged (3,000/3,000 words identical to the original font).

## 3. Evaluation against QCF V1 (visual quality first)

| Criterion | A — KFGQPC enhanced | B — QH Old Madina | C — QH Old Madina calligraphic |
|---|---|---|---|
| 1. Quranic calligraphic authenticity | Low: a typeface | **High**: Uthman Taha's letterforms | **High**, plus calligraphic elongation |
| 2. Similarity to QCF V1 | Low | High (shapes), but gappy lines | **Highest**: same hand, similar density and rhythm (see p005/p595/p254 side by side) |
| 3. Letter thickness, readability | Thin, smaller | Heavy, large | Heavy, large (letters ~10% larger than the first prototype) |
| 4. Natural justification | Wide gaps + kashida bars | Uneven: widest gap 2.7 em | **Natural**: median gap 0.31 em, 99th percentile 0.68 em; widest 1.7 em on a few 4–5-word lines |
| 5. Diacritic accuracy | Correct (needs sukun swap) | **Correct as encoded**: Madina sukun, round zero, pause signs over words | same as B |
| 6. Page geometry | 604 pages, exact line breaks | same | same (checked on pages 1, 2, 254 incl. the 13:37 line) |
| 7. iOS / Android | KFGQPC metrics identical sets (baseline predicted 0) | OFL TTF, standard GSUB/GPOS; typo line gap 200 ≠ hhea 0 → iOS may place it ~0.2 em higher (to confirm on device) | same as B; the elongation rule is a standard contextual substitution (needs device confirmation, as everything) |
| 8. Performance / size | 243 KB font, 593 KB widths | **2.59 MB font** (OFL; can be subset), 953 KB widths | same as B |

Layout statistics, all 604 pages (340-pt text area): A — 102 lines drawn slightly smaller (≥ ×0.90), widest gap
1.25 em; B — 49 lines (≥ ×0.92), widest gap 2.69 em; **C — 76 lines (≥ ×0.91), 44,509 words elongated (≤ level 6),
widest gap 1.68 em, median 0.31 em**.

## 4. Recommendation

**Candidate C (QH Old Madina, calligraphic justification).** It is the only Unicode rendering that reads like the
Madina Mushaf rather than like typography: the same hand as QCF V1, heavy strokes, compact proportions, and lines
filled by the calligrapher's own elongations. It also removes the KFGQPC font from the licensing path (OFL font).

## 5. Remaining differences from the printed Mushaf (and QCF V1)

- **Not the same glyph drawings.** QCF V1 is the print's own calligraphy, page by page; C is a faithful font in the same
  hand. Individual words differ in detail (ligature choices, mark placement, the exact curve of a swash).
- **Elongation choice** is algorithmic (one connection per word, longer words first); the calligrapher chose by eye and
  sometimes elongated a final letter or two connections. C never elongates final letters (no swash nūn), by design.
- **Density:** QCF V1 sets words almost touching; C keeps a 0.2-em space and so draws a few lines slightly smaller
  (76 of 8,807, ≥ ×0.91).
- **Sparse lines** (4–5 short words, e.g. 114:5 on page 604): every word is at its longest form and gaps still reach
  1–1.7 em, where the print uses swashes.
- **Tanzil's encoding** does not distinguish the print's stacked and staggered tanween; two words per font use a
  fallback font (C: 11:41, 12:11).
- **Text size:** at the same page width C's letters are close to, but slightly smaller than, QCF V1's.
- Surah headings centred (not ink-placed); medallion numbers from the production artwork.

## 6. Integrity

All five renderings pass the full check on all 604 pages (every drawn word, inserted tatweels removed, is the verified
word; nothing missing, repeated or reordered; one correct number per ayah; Basmala = 1:1). The `dk` display rule only
leaves undrawn the space before a standalone pause sign (tested over all 6,236 ayahs: > 4,000 spaces, nothing else).
Copy returns exactly the verified text (web, clipboard read back). Tajweed ON never moves a word (component and web
checks).

## C2 — natural fitting (review of C, 2026-10-15)

**Why:** in C, some words were stretched far too long to fill the line (58% of words elongated, median 0.55 em, up to
1.17 em, the worst nearly tripling a word). Next to QCF V1 and a handwritten Mushaf this read as mechanical
justification. New rule: a line slightly short of the edges is better than an obviously stretched word.

**What changed** (`madinaNatural`, chip **C2·Mad**, now the prototype default; C stays selectable for comparison):

| | C (before) | C2 (after) |
|---|---|---|
| Letter size | 340 / 18 em | **+6.4%**: measure 17.25 em, and the text reaches 1% into the paper margin each side (`widthShare` 1.02); frame unchanged |
| Elongated words | 44,509 (57.6%), median 0.55 em, max 1.17 em, up to 188% of a word | ≈23,200 (30%), median 0.39 em, **max 0.42 em and 35% of the word**, at most 3 levels, words ≥ 1 em only, never two neighbours |
| Gaps (justified lines) | median 0.21, widest 1.68 em | median 0.27, p90 0.45, p99 0.71, widest 1.69 em (page 604, the same line QCF V1 also spaces widely) |
| Lines left short | none | ≈2,100 of 8,780 (24%), median 1.1 em, at most 2 em, **centred** |
| Lines drawn smaller | 76 (≥ ×0.909) | 249 (≥ ×0.871): the larger letters make more long lines overflow |

Order of fitting a short line (`layout.ts` `fitNatural`): gaps to 0.25 em → mild elongations shared among several
words → gaps to 0.45 em → the line may end up to 2 em short → only the rest goes to the gaps.

**Before/after screenshots** (C, C2, QCF V1 side by side, same text area): `Working progress/Screenshots and Logs/
unicode-mushaf-c2-2026-10-15/pNNN-before-after-qcf.png` for pages 1, 2, 3, 5, 187, 254, 319, 560, 595, 604, plus
sparse pages 44 (most elongation in C), 69 (most short lines in C2) and 193 (widest C2 gaps after 604); Tajweed ON for
pages 3 and 595 in `raw/`.

**Assessment (web rendering, Chrome; no device):**
- Stretched words are gone; words keep their natural calligraphic shapes; dense pages (595, 3) look close to QCF V1.
- The trade-off is visible elsewhere: on ordinary pages (5) gaps are still wider than QCF V1's (its glyphs are larger and
  its words nearly touch), and on pages like 69 most lines end a little short at both edges, so the text block looks
  slightly narrower and its edges uneven.
- QCF V1 fills those lines with its own wider letterforms and swash elongations. No Unicode font reproduces those
  shapes, so a 604-page Unicode rendering must choose between longer stretches (C) and looser or shorter lines (C2).
  C2 is the more natural of the two, but it is **not** visually equivalent to QCF V1.
