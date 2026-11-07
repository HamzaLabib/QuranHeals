# Tafsir reader data (التفسير)

The Mushaf ayah menu's **Tafsir / «تفسير الآية»**, right after Listen, opens `mobile/src/app/tafsir.tsx`. That screen
shows the whole Surah: each ayah's verified Arabic (Tanzil, from the device), then the chosen edition's commentary. It
offers four editions, in this order:

| Edition | Delivery | Status |
|---|---|---|
| التفسير الميسر | bundled; works offline on a fresh install; the default | **Ready**: QuranEnc.com `arabic_moyassar` v1.0.0 |
| تفسير السعدي | optional download | Blocked (rights) |
| تفسير الجلالين | optional download | Blocked (rights) |
| في ظلال القرآن | optional download | Blocked (no licensed source) |

RIGHTS.md has the sources, the rights evidence, the conditions the app follows and what unblocks each edition. The
menu entry appears only while at least one edition is ready (`isTafsirReaderAvailable`, mobile/src/tafsir/editions.ts).

## Restoring the bundled file on a fresh checkout

`mobile/assets/tafsir/muyassar.json` is git-ignored, like the Meanings and Surah Preview datasets
(docs/content-datasets-release.md). Every bundle needs it while الميسر is ready, so a fresh clone runs this from the
repository root before Metro or `eas build`:

```
node tools/tafsir/build.mjs              # downloads the pinned QuranEnc artifact, checks both SHA-256 pins, rebuilds
node tools/tafsir/build.mjs --verify     # the generated modules and app file must equal a fresh build
node tools/tafsir/build.mjs --check-upstream   # before every release: fails if QuranEnc has a newer version
```

## How an edition gets into the app

1. In `editions.json`, pin the exact source: URL, file, the publisher's checksums (MD5 + SHA-1 as King Fahd publishes
   them) or our SHA-256 of a download made directly from the distributor, the adapter, the distributor's version, and
   the title, author and publisher as published.
2. Record the redistribution evidence in RIGHTS.md and set `rights.status` to `verified`. Never set it on silence or
   on an "apps may use" statement alone.
3. Run `node tools/tafsir/build.mjs` (from the repository root). It:
   - restores the original into `tools/tafsir/source/<id>/` (git-ignored), checking every pin;
   - converts it with `adapters/<adapter>.mjs`;
   - validates it: every Surah covered in order by Tanzil's counts, no gaps, no overlaps, no empty text;
   - writes the app file: `mobile/assets/tafsir/muyassar.json` (bundled), or
     `backend/data/tafsir/<id>/<sha256>.json` (served by the backend's `/api/tafsir/v1/editions/<id>/<sha256>.json`).
     Both are git-ignored, because the repository is public.
   - regenerates `mobile/src/tafsir/generated/tafsirRelease.ts` (status, SHA-256, size and counts; no text) and
     `bundledTafsir.ts` (the lazy `require` of the bundled file exists only while الميسر is ready).
4. `node tools/tafsir/build.mjs --verify` checks that the generated modules and app files match a fresh build;
   `mobile/tests/tafsirTools.test.ts` runs it where the original is on disk.

### Releasing an edition: what each kind needs

- **The bundled edition (الميسر), new or updated:** a new app build. The text is inside the binary.
- **An optional download (السعدي, الجلالين, في ظلال القرآن), new or updated:** BOTH
  1. **an app update.** The app trusts a downloaded file only if it matches the SHA-256, size and counts compiled
     into it (`generated/tafsirRelease.ts`). An app without the new pin lists the edition as unavailable, or rejects
     the new file. A backend deploy alone can never add or change an edition. An OTA update could carry the new pin,
     since it is JavaScript, but OTA publishing is the owner's decision; and
  2. **hosting the file** at `/api/tafsir/v1/editions/<id>/<sha256>.json`: copy
     `backend/data/tafsir/<id>/<sha256>.json` to the backend's data directory (git-ignored, so it does not arrive with
     a git deploy) and deploy the route.

## App file format

```
{ "format": "quran-heals-tafsir", "version": 1, "edition": "<id>", "language": "ar",
  "source": { "title", "author"?, "publisher", "distributor"?, "version"?, "url", "retrieved", "sha256" },
  "surahs": [ [ [from, to, "commentary"], … ], … 114 ] }
```

An entry is one ayah (from = to) or a passage the source comments on as a whole. The reader shows a passage's ayahs,
then its commentary **once**, under «تفسير الآيات from–to». An ayah inside a passage links down to that commentary.
Passages come only from the source, never from the app. For QuranEnc's edition, a passage is a run of consecutive
ayahs to which the source gives byte-identical text (RIGHTS.md).

The app accepts a file only when it parses with the same rules (`mobile/src/tafsir/dataset.ts`) and its entry and
range counts match the pin. A downloaded file must also match the pinned size and SHA-256 before it is kept
(`mobile/src/tafsir/storage.ts`). An interrupted or altered download is deleted, and the edition being read is never
touched.

## Adapters

- `quranenc-sqlite.mjs`: a QuranEnc.com edition's SQLite download (used for الميسر). It takes the text byte for byte
  and merges only consecutive identical texts into passages.
- `kfgqpc-mouaser.mjs`: King Fahd's developer package v3.0 of «التفسير الميسر». Not used, because that package could
  not be downloaded and verified (RIGHTS.md).
- `rows-json.mjs`: a generic JSON array of ayah-keyed rows, with an optional passage end.
