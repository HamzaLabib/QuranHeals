/**
 * The Word Meanings dataset bundled with the app: assets/word-meanings/ghareeb.json, built from King Fahd Complex's
 * «الميسر في غريب القرآن الكريم» by tools/word-meanings/import.mjs (git-ignored: run it once on a fresh clone before
 * starting Metro or `eas build`; tools/word-meanings/README.md).
 *
 * Bundled in every build, development and release (owner decision, 2026-10-24: production enabled although the
 * Complex's written terms are still unconfirmed — docs/content-datasets-release.md; no publisher authorization is on
 * file). The repository's .easignore lets EAS Build upload this git-ignored file. The switch to remove the feature is
 * WORD_MEANINGS_ENABLED (config.ts).
 */
export function bundledWordMeanings(): unknown {
  // Required only here, and only when first needed (opening المعاني): the reader's start never parses it.
  return require('../../assets/word-meanings/ghareeb.json');
}

/** Whether this build carries the dataset at all (without loading it): every build. */
export function isWordMeaningsBundled(): boolean {
  return true;
}
