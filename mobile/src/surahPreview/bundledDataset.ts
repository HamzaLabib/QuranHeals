/**
 * The Surah Preview dataset bundled with the app: assets/surah-preview/surah-preview.json, built from the Tafsir
 * Center's «المختصر في تفسير القرآن الكريم» by tools/surah-preview/import.mjs (tools/surah-preview/README.md).
 *
 * Development builds only, until the source's redistribution terms are confirmed in writing: Metro replaces `__DEV__`
 * with false in release bundles and drops the whole branch, require included, so the file is neither needed nor
 * bundled there. Allowing release builds is a deliberate change of this function.
 */
export function bundledSurahPreview(): unknown {
  if (__DEV__) {
    // Required only here, and only when first needed (opening Surah Preview): the reader's start never parses it.
    return require('../../assets/surah-preview/surah-preview.json');
  }
  return null;
}

/** Whether this build carries the dataset at all (without loading it): development builds. */
export function isSurahPreviewBundled(): boolean {
  return __DEV__;
}
