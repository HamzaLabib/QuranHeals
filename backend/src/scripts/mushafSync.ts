/**
 * Runs one Content Sync of Quran Foundation's mushafs:2 (QCF V1) now and
 * prints a summary (never credentials or tokens).
 *
 *   npm run mushaf:sync            sync (bootstrap the first time, then changes only)
 *   npm run mushaf:sync -- --report   also print the validation report of the current version
 */
import 'dotenv/config';

import { compileDataset } from '../mushaf/offline/dataset';
import { canonicalQuran, createDefaultMushafSync, resolveMushafSyncDir } from '../mushaf/offline/setup';
import { createMushafSyncStore } from '../mushaf/offline/store';
import { QfUnavailableError, readQfCredentials } from '../quranFoundation/qfContentClient';

async function main() {
  const { credentials, problems } = readQfCredentials(process.env);
  if (!credentials) throw new Error(`Quran Foundation credentials are not configured. ${problems.join(' ')}`);
  const dir = resolveMushafSyncDir(process.env);
  console.log(`Offline Mushaf sync (${credentials.environment}) into ${dir}`);
  const started = Date.now();
  const outcome = await createDefaultMushafSync(credentials, dir).runSync();
  console.log(`Result: ${JSON.stringify(outcome)} in ${Math.round((Date.now() - started) / 1000)} s`);

  if (process.argv.includes('--report')) {
    const store = createMushafSyncStore(dir);
    const state = await store.readState();
    const records = state ? await store.readRecords(state) : null;
    const manifest = await store.currentManifest();
    if (!state || !records || !manifest) throw new Error('No current version to report on.');
    const { report } = compileDataset(records, canonicalQuran());
    const emptyPages = Object.keys(report.emptyLines).length;
    console.log(JSON.stringify({
      version: manifest.version,
      source: manifest.source,
      syncedAt: manifest.syncedAt,
      pages: report.pages, verses: report.verses, words: report.words, wordTypes: report.wordTypes,
      basmalaPrefixes: report.basmalaPrefixes, joinedWords: report.joinedWords,
      chunks: manifest.chunks.length, totalBytes: manifest.totalBytes,
      pagesWithEmptyLines: emptyPages,
    }, null, 1));
  }
}

main().catch((error) => {
  console.error('Offline Mushaf sync failed:', error instanceof QfUnavailableError ? error.describe() : `${error?.name}: ${error?.message}`);
  process.exit(1);
});
