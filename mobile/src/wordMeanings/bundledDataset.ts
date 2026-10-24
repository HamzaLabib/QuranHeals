/**
 * The Word Meanings dataset bundled with the app: assets/word-meanings/ghareeb.json, built from King Fahd Complex's
 * «الميسر في غريب القرآن الكريم» by tools/word-meanings/import.mjs (git-ignored: run it once on a fresh clone before
 * starting Metro; tools/word-meanings/README.md).
 *
 * Development builds only. The source's redistribution terms are unresolved, so release bundles must not contain it:
 * Metro replaces `__DEV__` with false there and drops the whole branch, require included, before collecting
 * dependencies, so the file is neither needed nor bundled. Allowing release builds is a deliberate change of this
 * function, once the terms are confirmed.
 */
export function bundledWordMeanings(): unknown {
  if (__DEV__) {
    // Required only here, and only when first needed (opening المعاني): the reader's start never parses it.
    return require('../../assets/word-meanings/ghareeb.json');
  }
  return null;
}

/** Whether this build carries the dataset at all (without loading it): development builds. */
export function isWordMeaningsBundled(): boolean {
  return __DEV__;
}
