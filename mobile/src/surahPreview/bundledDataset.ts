/**
 * The Surah Preview dataset bundled with the app: assets/surah-preview/surah-preview.json, built from the Tafsir
 * Center's «المختصر في تفسير القرآن الكريم» and Quranpedia by tools/surah-preview/import.mjs (git-ignored: run it once
 * on a fresh clone before starting Metro or `eas build`; tools/surah-preview/README.md).
 *
 * Bundled in every build, development and release (owner decision, 2026-10-24: production enabled although the
 * publishers' written permissions in tools/surah-preview/PERMISSIONS.md are still not on file —
 * docs/content-datasets-release.md). The repository's .easignore lets EAS Build upload this git-ignored file. The
 * switch to remove the feature is SURAH_PREVIEW_ENABLED (config.ts).
 */
export function bundledSurahPreview(): unknown {
  // Required only here, and only when first needed (opening Surah Preview): the reader's start never parses it.
  return require('../../assets/surah-preview/surah-preview.json');
}

/** Whether this build carries the dataset at all (without loading it): every build. */
export function isSurahPreviewBundled(): boolean {
  return true;
}
