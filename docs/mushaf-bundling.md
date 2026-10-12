# Pre-installed Mushaf: packaging plan (not started)

**Decision (2026-10-12):** the App Store and Google Play builds include all 604 Mushaf pages: page layouts, page fonts, ayah separators, Basmalas and approved decorative assets. A user installs once and reads the whole Quran immediately and offline, with no download, Content Sync button, progress screen or connection to Render or Quran Foundation.

**Status:** investigation only. Bundling starts after the page design is final: the 604-page rollout, headings, pages 1–2 and دعاء ختم القرآن.

## Measured sizes

| Content | Raw | Compressed (deflate -9) | Notes |
|---|---|---|---|
| 604 QCF V1 page fonts (TTF) | 94.9 MB | 54.2 MB | About 157 KB each; page 1 is 27 KB. |
| Layouts, all 604 pages (83,665 glyph records) | 2.0 MB (compact JSON) | 0.35 MB | As a SQLite table it would be a few MB. |
| Quran text database (already bundled) | 1.7 MB | (unchanged) | `assets/quran/quran.sqlite` |
| Heading font (Amiri Bold, already bundled) | (unchanged) | (unchanged) | |
| Border, medallions, page furniture | 0 | 0 | Drawn in code (SVG paths), no image files. |
| Approved ornamental artwork | none yet | none yet | No verified heading frame or pages 1–2 illumination exists yet (docs/mushaf.md). |

Measured on 2026-10-12 from the 604 fonts on Quran Foundation's CDN and the local Content Sync snapshot. These are estimates; the real store sizes come from a build.

## Estimated store impact

- **Download size:** about +55 MB. Both stores compress the package, and TTF compresses to about 57%.
- **Installed size, iOS:** about +97 MB. Apps are installed unpacked, so the fonts take their raw size.
- **Installed size, Android:** about +55 MB to +97 MB. Assets stay inside the APK and are read in place. Whether .ttf assets are stored compressed or uncompressed depends on the build's `noCompress` settings; check in the first test build.
- **First launch:** no copying or unpacking is needed if fonts are native assets and the layouts are a read-only bundled database, opened as `quran.sqlite` is today. Expected well under 1 s. The 604 fonts must not be copied to the documents folder at first launch, which would add 95 MB and several seconds.

## Recommended approach (for the packaging phase)

1. **Fonts:** ship the 604 TTFs as native assets (an `expo-font` config-plugin list or a local module), registered on demand per page as now (`ensurePageFont`), but from the bundle instead of the CDN. Registering up to 604 fonts at startup is unnecessary; register the page being read and its neighbours.
2. **Layouts:** generate one read-only SQLite file (page, line, verse, position, kind, glyph) at build time from the verified Content Sync snapshot. Run the reader's Tanzil check over all 604 pages at build time, so a bad file can never ship. Keep the same `QpcV1PageLayout` shape, so the renderer doesn't change.
3. **Reading path:** bundled first; the offline store and network stay only as an optional update path. No reading path needs the network.
4. **Not recommended now: font subsetting.** Keeping only each page's used glyphs would save about 29 MB raw (9 MB compressed). But in a trial, 9 of 88,443 glyphs came out with different outlines or advances, and fontTools dropped the fonts' Apple layout tables (`morx`, `feat`, `just`). Revisit only with a zero-difference check on every glyph.
5. **No images instead of text:** pages stay live, selectable, accessible text in the original fonts.

## Must be settled before bundling (approval needed)

- **Quran Foundation's terms:** our current integration keeps downloaded layouts for a limited time and re-checks at least daily, following Quran Foundation's developer terms (`keepUntil`; docs/mushaf.md, "Storage"). A permanently pre-installed copy needs written confirmation that bundling the QPC V1 layout data in the app binary is allowed, or a licence that allows it.
- **King Fahd Complex fonts:** the QCF V1 fonts are © the King Fahd Glorious Qur’an Printing Complex, "All rights reserved". Confirm that redistributing all 604 fonts inside the app is covered: through Quran Foundation's terms, or by the Complex directly.
- **Updates:** once text and layouts are bundled, any correction ships as an app update. If the terms allow it, the existing Content Sync path could remain as an optional updater.

## Compatibility of the current code

- The renderer takes a `QpcV1PageLayout` and a font family name: where the layout and font come from is already separate (`mushaf.tsx` page loading, `mushaf/offline`). A bundled source is one more provider, ahead of the offline store.
- The 604-page rollout added no network dependency: Taller, headings, Basmalas, pages 1–2 and the du'a screen are all computed or drawn locally.
- The Basmala glyphs come from page 1's font (`BASMALA_FONT_PAGE`), which will be bundled like the others.
