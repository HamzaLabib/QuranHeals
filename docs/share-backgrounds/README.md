# Share Studio backgrounds: Colors and Scenery

Share Studio (`ShareAyahSheet`) offers two background categories:

- **Colors / الألوان**: the existing Sage, Cream and Dark themes, unchanged.
- **Scenery / المناظر الطبيعية**: 38 bundled nature photographs: 20 original, plus 18 seasonal additions on 2026-10-17 (#21–26 spring/autumn, then #27–32 sakura/autumn and #33–38 winter) under a cream readability overlay, with a **New Background / خلفية جديدة** button.

## Files

| Path | What |
|---|---|
| `mobile/assets/share-backgrounds/scenery/*.jpg` | The photographs, 1080 × 1920 baseline JPEG, quality 82 |
| `mobile/src/constants/shareCardScenery.ts` | Catalogue: ids, per-photo overlay strength, Scenery inks, `pickScenery` |
| `mobile/src/constants/shareCardSceneryImages.ts` | `require()` map of the image files (mocked in tests) |
| `mobile/src/components/ShareAyahCard.tsx` | Draws the photo (cover, centred) and the SVG cream gradient beneath the live text |
| `mobile/src/components/ShareAyahSheet.tsx` | Category control, session photo, New Background, export gating |
| `tools/share-backgrounds/scenery-sources.json` | The chosen Unsplash photos (ids, photographers, descriptions) |
| `tools/share-backgrounds/build_scenery.py` | Downloads, crops, encodes, computes overlay strengths, writes the manifest and contact sheet |
| `docs/share-backgrounds/scenery-manifest.json` | Generated record: source, licence, sizes, bytes, overlay per photo |
| `docs/share-backgrounds/scenery-contact-sheet.jpg` | Numbered contact sheet of all the photos, for review |
| `docs/share-backgrounds/android-emulator-exports.jpg` | Real PNG exports and sheet screenshots from the Android emulator |
| `docs/share-backgrounds/android-emulator-exports-additions.jpg` | Real Story exports of photos 21–26 from the Android emulator |
| `docs/share-backgrounds/android-emulator-exports-27-38.jpg` | Real Story exports of photos 27–38 from the Android emulator |

To replace a photo, edit `scenery-sources.json` (keep the existing entries and their order; append new ones at the end), run
`python -P build_scenery.py <cache-dir>` from `tools/share-backgrounds/` (needs Pillow and numpy),
then copy the new `overlayOpacity` values into `shareCardScenery.ts` and update the id lists and
`require` paths. The count is not fixed anywhere: the app picks from `SHARE_CARD_SCENERY`, and the tests
derive the count from the registry, manifest and asset folder. The rebuild leaves existing JPEGs byte-identical. `tests/shareCardScenery.test.ts` fails until the code, files and manifest agree.

## Behaviour

- Selecting Scenery for the first time in a session picks a random photo (`Math.random`, in the tap handler only, never during render).
- New Background picks uniformly from all the other photos, so the same photo never repeats twice in a row. It can be tapped any number of times.
- The photo is kept through re-renders, format changes, the translation toggle, switching to Colors and back, and export. A new session (the sheet reopening, or a different ayah) starts again from Colors.
- Every card of a long ayah uses the same photo. Share/Save stay disabled until every off-screen export card has reported `onLoad` for the current photo. A load failure shows "This background couldn't be loaded…" and keeps export blocked until New Background is tapped.
- Category and New Background are locked while cards are being exported, like the other options.
- Text is never baked into the photos. The card renders the same live text in the Scenery inks (`#1F2A24` for the Arabic and translation, `#2D3826` for the reference and branding).

## Readability overlay

The overlay is a cream (`#F7F2EA`) vertical gradient drawn with `react-native-svg`, which was already a dependency. It is at full strength over the whole text area plus 60 design units, and fades to `max(0.30, strength − 0.30)` at the top and bottom edges.

Full strength is computed per photo by the build script. Over the text area of all three formats (after a 4 px box blur that stands in for a letter stroke), the 1st-percentile pixel must give:

- Arabic and translation ink at least 7:1 (WCAG AAA), the same standard the Colors themes are tested against;
- reference and branding ink at least 4.5:1.

Values are rounded up to 0.01 and never go below 0.45. The results range from 0.45 (soft clouds, sakura sky) to 0.73; the snowy forest path (#33) needs only 0.49.

## Seasonal coverage

| Group | Photos |
|---|---|
| Mountains / valleys | 1–4, 34 |
| Forests / greenery | 5–8 |
| Water / coast | 9–12 |
| Desert / sky | 13–16 |
| Flowers / gardens | 17–20, 23 |
| Sakura / pink blossoms | 21, 22, 27, 28, 29 |
| Autumn / fall | 24, 25, 26, 30, 31, 32 |
| Winter / snow | 33–38 |

Rejected while sourcing 27–38:
- a sakura-lake photo with a high-rise behind the blossoms;
- a maple path with a stone torii (shrine gate);
- sakura paths with people, streets or buildings;
- dark night-time snowfall shots.

## Licence

All photos are from Unsplash and each photo page shows "Free to use under the Unsplash License". Each page was checked on 2026-10-17, including all 18 later additions; none is Unsplash+. The [Unsplash License](https://unsplash.com/license) grants an irrevocable, worldwide right to copy, modify and distribute the photos, including commercially, without permission or attribution. It excludes:

- selling unmodified copies;
- compiling photos to build a similar or competing service.

Bundling them as share-card backgrounds is neither. Attribution is optional; the photographers are credited in the table below.

## Asset manifest

Total assets: **13.75 MB (14,415,083 bytes)** for 38 files. Photos 21–26 are 2.73 MB and 27–38 are 4.94 MB. Source data, docs and tools are excluded.

| # | File | Description | Photographer | Source | Original | Optimized | Size | Overlay |
|---|---|---|---|---|---|---|---|---|
| 1 | `01-misty-valley-sunrise.jpg` | Misty forested valley and rolling hills at sunrise | [Monody Le](https://unsplash.com/@monodyle) | [SQplbKFxpgE](https://unsplash.com/photos/SQplbKFxpgE) | 4160×6240 | 1080×1920 | 213 KB | 0.69 |
| 2 | `02-alpine-lake.jpg` | Alpine lake between forested mountains, Tirol, Austria | [Alexandra Smielova](https://unsplash.com/@sashasmelova) | [XpsOJAy7qV8](https://unsplash.com/photos/XpsOJAy7qV8) | 3192×4788 | 1080×1920 | 342 KB | 0.69 |
| 3 | `03-foggy-rolling-hills.jpg` | Rolling green hills with low morning fog, Sunol, California | [Spencer DeMera](https://unsplash.com/@spencer_demera) | [s2k6k5CI3Hs](https://unsplash.com/photos/s2k6k5CI3Hs) | 4000×6000 | 1080×1920 | 248 KB | 0.70 |
| 4 | `04-golden-mountain-sunset.jpg` | Layered mountain ridges in soft golden sunset light, Colorado | [Calvin Weibel](https://unsplash.com/@calvinweibel) | [II9_1d-10yM](https://unsplash.com/photos/II9_1d-10yM) | 3632×4412 | 1080×1920 | 96 KB | 0.68 |
| 5 | `05-forest-sunbeams.jpg` | Sunbeams through a lush green forest | [Michael Krahn](https://unsplash.com/@michael_g_krahn) | [PF-WNwnX4CA](https://unsplash.com/photos/PF-WNwnX4CA) | 2486×3728 | 1080×1920 | 564 KB | 0.70 |
| 6 | `06-mossy-forest-path.jpg` | Winding path through mossy, sunlit woodland | [Oksana Demenko](https://unsplash.com/@_kseniademenko) | [zm2RyZ_8NTU](https://unsplash.com/photos/zm2RyZ_8NTU) | 2075×3130 | 1080×1920 | 617 KB | 0.72 |
| 7 | `07-morning-meadow.jpg` | Wide green meadow in soft low sunlight | [Michał Bielejewski](https://unsplash.com/@bielej) | [3EZLqCIakbo](https://unsplash.com/photos/3EZLqCIakbo) | 3182×5657 | 1080×1920 | 179 KB | 0.72 |
| 8 | `08-olive-grove.jpg` | Olive grove with hills behind, Nyons, France | [Marie P](https://unsplash.com/@mpartt) | [M6jXE5-WLKA](https://unsplash.com/photos/M6jXE5-WLKA) | 4896×3672 | 1080×1920 | 444 KB | 0.71 |
| 9 | `09-ocean-horizon.jpg` | Calm sea horizon with a low sun (photographed at sunset) | [Ivan Torres](https://unsplash.com/@iavnt) | [AXz346Rhs6A](https://unsplash.com/photos/AXz346Rhs6A) | 1844×3175 | 1080×1920 | 217 KB | 0.61 |
| 10 | `10-turquoise-shoreline.jpg` | Aerial view of turquoise water and gentle waves meeting sand | [Joel Vodell](https://unsplash.com/@joelvodell) | [8Ogfqvw15Rg](https://unsplash.com/photos/8Ogfqvw15Rg) | 2893×3857 | 1080×1920 | 326 KB | 0.65 |
| 11 | `11-mountain-lake-reflection.jpg` | Still lake mirroring a mountain in morning light | [Hans Ott](https://unsplash.com/@hansott) | [i5y_J3NgWAA](https://unsplash.com/photos/i5y_J3NgWAA) | 4002×6003 | 1080×1920 | 148 KB | 0.73 |
| 12 | `12-fern-waterfall.jpg` | Gentle waterfall framed by ferns, Hilo, Hawaii | [Sterling Lanier](https://unsplash.com/@sterlinglanier) | [Ex8rghEAi3c](https://unsplash.com/photos/Ex8rghEAi3c) | 2302×3000 | 1080×1920 | 524 KB | 0.73 |
| 13 | `13-golden-dunes.jpg` | Rippled sand dune in warm dusk light, Imperial Sand Dunes | [Gregory Gomez](https://unsplash.com/@gregorygomezj) | [zqYXt1Qu7ug](https://unsplash.com/photos/zqYXt1Qu7ug) | 3024×4032 | 1080×1920 | 208 KB | 0.60 |
| 14 | `14-pastel-desert-sky.jpg` | Pastel sky and setting moon over the Gobi Desert | [miram Oh](https://unsplash.com/@talking_dolphin) | [FcxJycxSfyU](https://unsplash.com/photos/FcxJycxSfyU) | 2251×3002 | 1080×1920 | 275 KB | 0.70 |
| 15 | `15-soft-clouds.jpg` | Soft white clouds in a pale blue sky | [Sonny Mauricio](https://unsplash.com/@northernstatemedia) | [kIr8e-01eAw](https://unsplash.com/photos/kIr8e-01eAw) | 4160×6240 | 1080×1920 | 122 KB | 0.45 |
| 16 | `16-earth-tone-horizon.jpg` | Open earth-toned field under a wide, quiet sky | [Matt Richmond](https://unsplash.com/@mattrichmo) | [Dh5Ssu2488A](https://unsplash.com/photos/Dh5Ssu2488A) | 2992×4489 | 1080×1920 | 369 KB | 0.69 |
| 17 | `17-wildflower-meadow.jpg` | Wildflowers and cornflowers at golden hour | [Alexandr Popadin](https://unsplash.com/@irrabagon) | [Sz2BjLkacLU](https://unsplash.com/photos/Sz2BjLkacLU) | 4000×6000 | 1080×1920 | 157 KB | 0.72 |
| 18 | `18-white-blossoms.jpg` | Delicate white spring blossoms on a pale background | [Paulina Herpel](https://unsplash.com/@paulinaherpel) | [wQMcRq4QVyA](https://unsplash.com/photos/wQMcRq4QVyA) | 2784×3712 | 1080×1920 | 148 KB | 0.64 |
| 19 | `19-lavender-field.jpg` | Lavender rows under a soft sky, Valensole, France (daytime) | [Thomas Despeyroux](https://unsplash.com/@thomasdes) | [2aGaN2oDPQI](https://unsplash.com/photos/2aGaN2oDPQI) | 3991×5986 | 1080×1920 | 477 KB | 0.65 |
| 20 | `20-garden-path.jpg` | Brick path through a green botanical garden | [Khrystyna Khristianova](https://unsplash.com/@kkhrysty) | [0Cq6MaJ3bQw](https://unsplash.com/photos/0Cq6MaJ3bQw) | 4480×6720 | 1080×1920 | 551 KB | 0.71 |
| 21 | `21-pink-sakura.jpg` | Avenue of cherry trees in pastel pink bloom, petals on the ground, China | [Amelia Cui](https://unsplash.com/@ameliacui) | [cs5rrvMgqdQ](https://unsplash.com/photos/cs5rrvMgqdQ) | 6000×4000 | 1080×1920 | 810 KB | 0.70 |
| 22 | `22-sakura-sky.jpg` | Soft pink cherry blossoms hanging against a pale blue sky | [MAK](https://unsplash.com/@mak_jp) | [RlxP6WGmfP0](https://unsplash.com/photos/RlxP6WGmfP0) | 3541×5311 | 1080×1920 | 132 KB | 0.45 |
| 23 | `23-pink-roses.jpg` | Pale pink garden roses in soft light, Kuskovo Estate garden, Moscow | [85GB photo](https://unsplash.com/@85gb_photo) | [uewOPMIDOPs](https://unsplash.com/photos/uewOPMIDOPs) | 5400×7200 | 1080×1920 | 179 KB | 0.71 |
| 24 | `24-autumn-forest-path.jpg` | Woodland path under orange and golden autumn trees, Dorset, UK | [Nick Fewings](https://unsplash.com/@jannerboy62) | [v4g7g-nIHVU](https://unsplash.com/photos/v4g7g-nIHVU) | 2021×3032 | 1080×1920 | 744 KB | 0.71 |
| 25 | `25-autumn-lake.jpg` | Golden and orange autumn trees mirrored in a still, misty lake | [Antonio Groß](https://unsplash.com/@angro) | [EsuRXeY9Wno](https://unsplash.com/photos/EsuRXeY9Wno) | 3648×5472 | 1080×1920 | 376 KB | 0.70 |
| 26 | `26-golden-autumn-valley.jpg` | Golden autumn larches in a mountain valley, Dolomites, Italy | [Vincent Etter](https://unsplash.com/@wookai) | [gEIZua_IzV0](https://unsplash.com/photos/gEIZua_IzV0) | 5464×8192 | 1080×1920 | 556 KB | 0.72 |
| 27 | `27-sakura-pathway.jpg` | Woodland path carpeted with pink petals under blossoming trees, Washington, USA | [Emi Mo](https://unsplash.com/@emilyart_mixedmedia) | [lWpi_9hlS6Y](https://unsplash.com/photos/lWpi_9hlS6Y) | 3264×4928 | 1080×1920 | 586 KB | 0.70 |
| 28 | `28-sakura-canopy.jpg` | Canopy of pink cherry blossoms filling the frame under a bright sky, Stockholm | [Sahesh A](https://unsplash.com/@sahesh) | [rl3F_IdqpOc](https://unsplash.com/photos/rl3F_IdqpOc) | 5152×7728 | 1080×1920 | 471 KB | 0.72 |
| 29 | `29-sakura-lake.jpg` | Pink cherry blossom branches over calm blue lake water, Yuyuantan Park, Beijing | [ran liwen](https://unsplash.com/@nikol_royce) | [eFl_xB9I4N4](https://unsplash.com/photos/eFl_xB9I4N4) | 4016×5472 | 1080×1920 | 330 KB | 0.64 |
| 30 | `30-maple-path.jpg` | Winding leaf-covered garden path under red Japanese maples, Kyoto | [Hat Trick](https://unsplash.com/@hattrick1996) | [aLpbkf8Jkn0](https://unsplash.com/photos/aLpbkf8Jkn0) | 6336×9504 | 1080×1920 | 728 KB | 0.72 |
| 31 | `31-golden-riverbank.jpg` | Golden autumn trees reflected in a calm river, Altay, Xinjiang | [Chenyue Huang](https://unsplash.com/@lassssso) | [SdmYhFkIUw4](https://unsplash.com/photos/SdmYhFkIUw4) | 5304×7952 | 1080×1920 | 441 KB | 0.68 |
| 32 | `32-autumn-mountains.jpg` | Golden autumn larches and a green lake below a snowy peak, Austria | [Daniel J. Schwarz](https://unsplash.com/@danieljschwarz) | [1kO2SK998k0](https://unsplash.com/photos/1kO2SK998k0) | 4160×6240 | 1080×1920 | 452 KB | 0.73 |
| 33 | `33-snowy-forest-path.jpg` | Snow-covered forest track between frosted trees, Primorsky Krai, Russia | [Oleg Moroz (Олег Мороз)](https://unsplash.com/@tengyart) | [Z5TmoonjUzI](https://unsplash.com/photos/Z5TmoonjUzI) | 4480×6720 | 1080×1920 | 437 KB | 0.49 |
| 34 | `34-snowy-mountain-valley.jpg` | Snowy alpine valley with larches below a mountain peak | [Chloé Mg](https://unsplash.com/@lumivisuals) | [TZV6rBW3rqE](https://unsplash.com/photos/TZV6rBW3rqE) | 3537×5306 | 1080×1920 | 290 KB | 0.68 |
| 35 | `35-winter-lake.jpg` | Snow-capped rocks in a partly frozen, still lake, Sweden | [Raed Kasrwani](https://unsplash.com/@raedkasrawani) | [NKyv4fkM6j4](https://unsplash.com/photos/NKyv4fkM6j4) | 3810×4762 | 1080×1920 | 250 KB | 0.71 |
| 36 | `36-snowy-pines.jpg` | Snow-covered evergreen trees in soft white light | [Sarah Janes](https://unsplash.com/@sjanesphotos) | [CnpN4TVqOx0](https://unsplash.com/photos/CnpN4TVqOx0) | 4480×6720 | 1080×1920 | 349 KB | 0.68 |
| 37 | `37-fresh-snowfall.jpg` | Freshly snow-laden forest slope after snowfall | [Fabien Maurin](https://unsplash.com/@fabienmaurin) | [5JfHJ7NYOIU](https://unsplash.com/photos/5JfHJ7NYOIU) | 4000×6000 | 1080×1920 | 570 KB | 0.69 |
| 38 | `38-winter-dawn.jpg` | Pastel winter dawn sky over a snowy field and distant firs, Saint-Brais, Switzerland | [Artiom Vallat](https://unsplash.com/@virussinside) | [BS1LgiJnpmE](https://unsplash.com/photos/BS1LgiJnpmE) | 4000×6000 | 1080×1920 | 151 KB | 0.71 |
