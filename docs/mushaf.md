# Mushaf prototype (`/mushaf`, page 61)

An isolated prototype, not linked from the app yet. One page (61, Aal-i-Imraan 3:84–3:91) with two interchangeable renderers inside the same measured page frame:

| Renderer | Text | Source | Status |
|---|---|---|---|
| **QPC V1** (default) | 1405 AH Madani Mushaf (Uthman Taha): the reference print | QCF V1 page font + Quran Foundation layout | Needs QF credentials on the backend (below) |
| **Quran SVG** (fallback, selectable) | Newer KFQC typesetting | `quran-ws/quran-svg` v1.1.1, pinned and hash-checked | Working |

The QPC V1 text is drawn only when the font is loaded **and** the layout passes a check against the verified Tanzil text. That check covers the same 8 ayahs, each ayah's word count, and one marker per ayah. Otherwise the SVG page is shown with a note.

## Sources

The complete offline Mushaf (all 604 pages, Quran Foundation Content Sync `mushafs:2`) is described in [mushaf-offline.md](mushaf-offline.md). Below: page 61 as first built.


- **Font:** `QCF_P061` version 5.10, © King Fahd Glorious Qur'an Printing Complex (produced by Harf Information Technology).
  - From Quran Foundation's documented CDN: `https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p61.ttf`.
  - 155,996 bytes; SHA-256 `34d6a665…51fc486`. The full hash is pinned in `mobile/src/mushaf/qpcV1Fonts.ts` and tested.
  - Bundled into the app at `mobile/assets/mushaf/qpc-v1/p61.ttf`. Only page 61 is bundled.
  - **Not in git.** The repository is public, and Quran Foundation's font terms allow the font only inside the app, never as a standalone download. The `.ttf` is git-ignored and restored by `mobile/scripts/restore-mushaf-fonts.mjs` from the CDN above, only if it matches the size and SHA-256 pinned in `mobile/assets/mushaf/qpc-v1/fonts.lock.json` (tracked).
  - It runs automatically:
    - `postinstall` (only warns if offline);
    - `pretest`, `prestart`, `preandroid`, `preios`, `preweb`;
    - the CI step *Restore pinned QCF V1 font*, before `npm ci`;
    - EAS Build's `eas-build-pre-install`. EAS uploads only what git keeps (`.gitignore`), so the builder downloads the font itself.
  - By hand: `npm run fonts:restore` in `mobile/`. If Quran Foundation ever changes the file, the script refuses it: review the new font, then update `fonts.lock.json` and `qpcV1Fonts.ts` together.
- **Layout:** Quran Foundation Content API, `GET /content/api/v4/verses/by_page/61?words=true&word_fields=code_v1,line_number,page_number&mushaf=2&per_page=50`.
  - Fetched by our backend (`backend/src/mushaf/qpcV1Layout.ts`) and served to the app at `GET /api/mushaf/qpc-v1/pages/61`. Only page 61 is served.
- **Expected line breaks:** our own transcription of `Reference Design.jpg`, in `mobile/src/mushaf/referencePage061.json`. It records each line's first word as an ayah plus a word number in the verified Tanzil text, and the line each ayah marker sits on.

## Page design

- **Border:** `mobile/src/mushaf/borderPattern.ts`, drawn by `MushafBorder`. Traced from `Reference Design.jpg` by rectifying the scan's frame and averaging its 90 edge tiles.
  - 20 × 29 square tiles between the double brown rule (≈ 4 px each at the scan's scale).
  - A split brown rhombus with ochre-cream centres on every tile boundary. Four mint-edged green leaves around each rhombus, at 40°, forming an X at each tile centre. Corners have three leaves, as printed.
  - Output is one vector path per ink (six in all) in a 20 × 29 viewBox: no tile seams, sharp at any size. It is built once (about 90 KB of path data).
  - The border sits under the text and takes no touches; screen readers skip it.
- **Running heads and page number:** Amiri Bold (SIL Open Font License 1.1, `@expo-google-fonts/amiri`, one weight bundled, ~400 KB). It is loaded separately from the QPC V1 font, so if it fails only the heads fall back to the system font. Never used for Quran text.
  - The print's own calligraphic heads are artwork. Glyph fonts for surah and juz' names exist (distributed by Tarteel QUL), but they are not on Quran Foundation's documented CDN, so their licence would need checking separately before use.
- **Ayah markers:** see *Appearance presets* below. By default, the QCF V1 font's own marker glyph, tinted green: a ringed circle, not the print's medallion.

## Appearance presets (reversible)

Everything switchable is in `mobile/src/mushaf/appearance.ts`. One object picks what `/mushaf` shows.

**Approved design (phase 2A, default):** QPC V1 text, traditional medallions, Warm Cream, original ink, the phase-1C border and headings.

```ts
export const MUSHAF_APPEARANCE_APPROVED = { background: 'warm', markers: 'traditional', ink: 'original' };
export const MUSHAF_APPEARANCE_PHASE_1C = { background: 'original', markers: 'qpc-glyph', ink: 'original' };
export const MUSHAF_APPEARANCE_DEFAULT = MUSHAF_APPEARANCE_APPROVED;
```

**Dark Mode (phase 2C, Warm Midnight Olive):** the page follows the app's **Appearance** setting (System, Light, Dark; Light by default).

```ts
export const MUSHAF_APPEARANCE_DARK = { background: 'midnight', markers: 'traditional', ink: 'midnight', border: 'original' };
```

| | Light (approved) | Dark (approved) |
|---|---|---|
| Paper | `#F9EFD2` Warm Cream | `#222820` Warm Midnight Olive |
| Quran ink | `#231F20` | `#F1E9D6` (colour only; glyphs, positions and line breaks identical) |
| Heads and page number | `#2B2A26` | `#F1E9D6` |
| Selection highlight | `#5B8F6A` at 18 % | `#8EA68A` at 30 % |
| Border | the approved border | **the same border, same colours** (`border: 'original'`) |
| Medallions | traditional | traditional (dark number `#231F20` on cream) |

- **Light Mode is pixel-identical to the approved phase 1D page.**
- **Alternative border:** gold `#A99A70` and sage `#8EA68A` (`MUSHAF_BORDER_STYLES.midnight`) is a separate, reversible option, **not adopted**. Compare it in `mushaf-2c-screenshots/10-…png`; adopt it with `border: 'midnight'` in `MUSHAF_APPEARANCE_DARK`.
- **Quran SVG fallback in Dark Mode:** its ink fill is recoloured (`tintSvgInk`); every path is unchanged.
- **Preview:** `?scheme=dark` (or `light`) previews either mode without changing the setting.

How to restore an earlier design:

| To get | Do |
|---|---|
| The phase-1C page (pixel-identical: verified at 320, 390 and 820 pt and the SVG fallback) | Set `MUSHAF_APPEARANCE_DEFAULT = MUSHAF_APPEARANCE_PHASE_1C`. |
| Original Cream with the new medallions | Set it to `{ background: 'original', markers: 'traditional', ink: 'original' }`. |
| The Quran SVG renderer | Use the *Script* switch on the screen. It is also used automatically whenever QPC V1 can't be shown. |

Never edit a preset's values: a new look is a new preset.

For side-by-side previews, the route takes the same names as URL parameters, e.g. `/mushaf?background=original&markers=qpc-glyph`. Unknown values are ignored. There are no on-page controls.

Screenshots: `mushaf-1c-screenshots/` (phase 1C) and `mushaf-1d-screenshots/` (the approved comparison), next to the repository.

### Backgrounds

The page background is one opaque fill on the page view (`MushafPageView`). There is no gradient, texture, transparency or overlay; the text area and the border's interior are transparent over it.

| Preset | Constant | Paper | CIELAB |
|---|---|---|---|
| Original Cream | `MUSHAF_BACKGROUND_ORIGINAL` | `#F9F5DA` (= `REFERENCE_COLORS.paper`), opaque | L 96.2, a −3.1, b 13.5 |
| Warm Cream (approved, default) | `MUSHAF_BACKGROUND_WARM` | `#F9EFD2`, opaque | L 94.6, a −1.3, b 15.4 |

The reference scan's paper measures L 95.9 / b 14.6 inside its frame and L 94.2 / b 16.3 outside it; Warm Cream sits between the two. The border's own cream (`#FCF9E0`), the medallions and the text are the same under both. `mushafAppearance.test.ts` pins Original Cream's exact value.

### Ayah-end medallions (QPC V1 renderer)

| Preset | Look |
|---|---|
| `qpc-glyph` | The QCF V1 marker glyph tinted `#3E7D57` (phase 1C). |
| `quran-svg` | The Quran SVG page's medallion and number artwork, coloured as on that page: ornament `#3E7D57`, number `#231F20`. |
| `traditional` (approved, default) | The same artwork in the print's colours. Caps (top and bottom): outline `#3F3723`, fill `#857850`. Sides: outline `#4E8160`, mint crescents `#9EC498`. Centre: `#FBF7E4`. Number: `#231F20`. Flat bands, no gradients. |

How a medallion replaces the glyph without touching Quran text:

1. `tools/mushaf/extract-ayah-markers.mjs` copies the ornament path and each ayah's number path **verbatim** from the bundled, hash-pinned Quran SVG page, with their original transforms. It writes `mobile/src/mushaf/generated/ayahMarkers061.ts`.
   - Each marker is assigned to the ayah whose clickable polygon contains it. The script fails unless there is exactly one per ayah, in reading order.
2. In `QpcV1PageText`, the marker glyph stays in its line, unchanged: same character, font and size. So word positions, justification and taps are still the font's. It is only painted `transparent`.
3. `AyahMarkerOrnament` draws that ayah's medallion over the glyph's ink box:
   - Centred on the ink, which is known from the font: `QCF_V1_METRICS` in `mushaf/ayahMarkers.ts`.
   - 1.1 × the ink's height, which is 0.82 of the line pitch, like the print.
   - Inside the glyph's advance, so it never reaches neighbouring words.
   - It takes no touches; a tap on it selects its ayah through the line, as before.
4. Baseline: iOS and Android report it with `onTextLayout`. The web uses the CSS rule; Chrome measured 19 px for the computed 19.25.
5. An ayah without artwork keeps its glyph. Only page 61 has artwork so far.

The artwork is the King Fahd Complex's: the same artwork the app already bundles and credits as its Quran SVG page.

### Quran ink

`MUSHAF_INKS.original` (`#231F20`) is the only ink. Measured against the scan at the same scale:
- The darkest text pixels match (11.0 vs 11.7 of 255).
- The print covers about 5% more area with ink once its filled medallions are excluded (12.0% vs 10.6% before excluding them).

That extra weight comes from ink spread in printing and the scan's softness, not from a lighter ink. A darker colour would not thicken the strokes, and the glyphs themselves are never emboldened, stroked or layered.
- **Taps on the web:** Pressable's `onPress` gets the DOM click there, with `offsetX/Y` rather than `locationX/Y`; `mushaf/pressLocation.ts` reads either.

## Authorization and terms

- **Fonts** ([Mushaf fonts and images](https://api-docs.quran.foundation/legal/mushaf-fonts-and-images/)): caching or bundling is allowed while the developer maintains an active Developer Console account, with visible credit to Quran Foundation. Fonts may be distributed only inside the app.
  - The account is active (Quran Heals, server client, content scope).
  - The prototype credits Quran Foundation and King Fahd Complex under the page.
- **Layout data** ([developer terms](https://api-docs.quran.foundation/legal/developer-terms/)): this is Quran Foundation content.
  - It may not be stored longer than one week unless obtained through Content Sync, and Content Sync does not cover verse or word layout (only translations, tafsirs, recitations and articles).
  - So the backend caches a page in memory for 24 hours, and the app keeps its copy until the server's `keepUntil` (≤ 7 days), then deletes it. Nothing is written to MongoDB, and no QF data is committed to this repository; tests use synthetic layouts.
- **King Fahd Complex:** the font's copyright is the Complex's ("All rights reserved"). Quran Foundation's terms don't address it.
  - The Complex's published digital-copy terms allow use in apps and software, but that statement is attached to its 1441 AH digital copy.
  - Written confirmation for the QCF V1 fonts is **still outstanding** and recommended before a public release.

## Configuring the backend (local development only)

Add the Quran Foundation **server** credentials to `backend/.env`, which is gitignored:

```text
QF_ENV=prelive            # or production — never mix the two sets
QF_CLIENT_ID=<from the Quran Foundation Developer Console>
QF_CLIENT_SECRET=<from the Quran Foundation Developer Console>
```

Then run `npm run dev` in `backend/`, open `/mushaf` in a development build pointing at that backend, and run:

```sh
node tools/mushaf/verify-qpc-v1-page.mjs http://localhost:4000
```

It reports PASS or each difference against the 15 reference line breaks, the 8 marker lines, and Tanzil word counts. It stores nothing.

Rules for these credentials:

- The secret stays on the backend: never in `mobile/`, `EXPO_PUBLIC_*`, logs or tests.
- Render's production environment is not changed in this phase.
- Without credentials, the endpoint answers 503 and the app shows the SVG page.

## Troubleshooting a 503

The app always gets the same generic 503. The backend logs the reason on one line, without credentials, tokens, query strings or response bodies:

```text
QPC V1 layout for page 61 unavailable: category=<…> stage=<token|content> env=<prelive|production> status=<HTTP> path=<…>
```

| category | Meaning |
|---|---|
| `not_configured` | No `QF_CLIENT_ID`/`QF_CLIENT_SECRET`. |
| `auth` | Token refused (`stage=token`), or content refused even with a fresh token. Check that the credentials belong to `QF_ENV`; pre-live and production clients differ. |
| `upstream` | Quran Foundation answered with an error (`status`). |
| `network` / `timeout` | No answer (`code` = system error such as `ENOTFOUND`). |
| `malformed` | An answer we couldn't use. |
| `validation` | The layout failed our checks; nothing is shown rather than a doubtful page. |

**Known issue (observed 2026-10-11): Pre-live returns 404 for this route.**

- The current Pre-live credentials get a valid `content` token. Pre-live answers routes **without** a path parameter: `/content/api/v4/chapters`, `/juzs`, `/resources/languages` and `/verses/random` all return 200.
- It answers **every** route with a path parameter with 404 "The requested resource could not be found". That includes `/chapters/3`, `/verses/by_key/3:84` and the documented `/verses/by_page/61`, with or without query parameters.
- The request matches the [Page Layout guide](https://api-docs.quran.foundation/docs/tutorials/fonts/page-layout/): mushaf 2 = QCF V1, `words=true`, `code_v1`, `line_number`.
- These credentials are Pre-live only (the production token endpoint answers `invalid_client`).
- `/quran/verses/code_v1?page_number=61` works on Pre-live but has no line numbers, so the page's line layout can't be built from it without guessing.
- To proceed: use production credentials locally (`QF_ENV=production`), or ask Quran Foundation about the Pre-live 404s.

## Storage and the full reader (later)

- About 150 KB per page as TTF, roughly 90 MB for 604 pages: download on demand per page, cache, never bundle all.
- Layout per page: a few KB, re-fetched at least weekly under Quran Foundation's terms.
- Keep page assets separate from the Quran SQLite database.
