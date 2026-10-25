# Meanings and Surah Preview in release builds

Since 2026-10-24 the app bundles two third-party content datasets in **every build**, development and release, on
Android and iOS:

| Feature | Dataset (git-ignored) | Built by | Source |
|---|---|---|---|
| Meanings (المعاني) | `mobile/assets/word-meanings/ghareeb.json` | `tools/word-meanings/import.mjs` | «الميسر في غريب القرآن الكريم», King Fahd Glorious Qur'an Printing Complex |
| Surah Preview (عن السورة) | `mobile/assets/surah-preview/surah-preview.json` | `tools/surah-preview/import.mjs` | «المختصر في تفسير القرآن الكريم» (Tafsir Center, via QuranEnc) and Quranpedia's `topics` (citing the University of Sharjah's «التفسير الموضوعي لسور القرآن الكريم», and al-Fairuzabadi's «بصائر ذوي التمييز» for Surahs 42 and 44) |

## The owner's decision (2026-10-24)

The owner (Hamza) explicitly authorized enabling both features in production builds **despite the unresolved
publisher-permission records**.

This is the owner's own decision and acceptance of that risk. It is **not** a publisher authorization, and none has
been obtained:

- **Meanings:** the King Fahd Complex's terms are still unconfirmed in writing: required attribution wording,
  modification and excerpting, and redistribution inside a binary (`tools/word-meanings/README.md`, "Usage terms").
- **Surah Preview:** the written permissions of the Tafsir Center (المختصر, main purposes) and of the University of
  Sharjah (the 110 topic outlines Quranpedia cites) are still **not on file**. The topics are still `pending-review`,
  with no independent scholarly review; the owner's editorial approval of the Arabic texts is on file
  (`tools/surah-preview/PERMISSIONS.md`, `owner-approval.json`).

The open items in those records stay open. Record a publisher's authorization there when one arrives; do not mark
them done because of this decision.

## What changed in the app

- `mobile/src/wordMeanings/bundledDataset.ts` and `mobile/src/surahPreview/bundledDataset.ts` no longer check
  `__DEV__`. Each dataset is still `require`d lazily, on first opening its sheet, so the reader's start never parses it.
- The rollback switches are unchanged: `WORD_MEANINGS_ENABLED` (`wordMeanings/config.ts`) and
  `SURAH_PREVIEW_ENABLED` (`surahPreview/config.ts`). Settings → Quran → Meanings still hides the Meanings button.
- Content is unchanged: the datasets are the ones already built and validated.

## How builds get the datasets

Both files stay **git-ignored**: the repository is public and the redistribution terms are unresolved. A build
therefore needs them on disk, and EAS needs to be allowed to upload them.

- **EAS Build** uploads the project using the repository's `.easignore` instead of the `.gitignore` files. That file
  repeats every `.gitignore` rule (nested ones with their folder prefixed), except the two dataset files above. Each
  folder rule is also written without its trailing slash: EAS's copy checks a folder's own path that way, and without
  it git-ignored folders such as `backend/data/mushaf-sync/` and `backend/backups/` were uploaded whole (checked
  2026-10-24 with `eas build:inspect --stage archive`, eas-cli 16.17.3 and 25.3.0, on Windows). `mobile/tests/contentDatasetsRelease.test.ts`
  fails if `.easignore` and the `.gitignore` files drift apart. **Edit both when ignore rules change.**
- **Local production exports and builds** (`expo export`, `expo run:*`, `eas build --local`) read the files from disk.
- A build from a clean clone **without** the files fails at bundling (Metro cannot resolve the `require`). That is
  deliberate: a release must never ship without them silently.

## Restoring the datasets on a fresh checkout

From the repository root, before starting Metro or running `eas build`:

```
node tools/word-meanings/import.mjs     # downloads the pinned source (tools/word-meanings/source.lock.json) and builds ghareeb.json
node tools/surah-preview/import.mjs     # downloads the pinned pages and Quranpedia dump (source.lock.json, quranpedia.lock.json) and builds surah-preview.json
node tools/surah-preview/validate.mjs   # checks the result, including the owner's approval hashes (owner-approval.json)
```

Both importers verify the pinned SHA-256 of what they download and fail on any difference. Their READMEs describe
the options (`--verify`, `--soft`).

## Before publishing a build or OTA update

- Restore and validate both datasets (above). Run `eas build:inspect --stage archive` and check that both files are
  in the archive and that no other git-ignored file is.
- The publisher-permission items above are still open; the owner's decision covers shipping without them.
