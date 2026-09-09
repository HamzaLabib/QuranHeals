// Copies already-verified Quran assets into a backend-owned location so the
// backend can read them without depending on any file inside the mobile
// project directory or the tools directory (required for an independent
// backend deployment). These are verified byte-for-byte copies, not a
// second parse of the canonical Tanzil source: the source files themselves
// never move, and nothing about the Arabic text is touched. Re-run any time
// to re-sync; it refuses to silently overwrite a backend copy that doesn't
// already match the expected hash, and no-ops if the backend copy already
// matches.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');
const backendDir = resolve(repoRoot, 'backend/assets/quran');

const expectedSqliteHash = 'c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b';
const expectedSurahCountsHash = '179e93716075f94bd0c7770351eb034b39bfa0e05802f8b41c2706cfc494b74f';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function syncVerifiedFile(sourcePath, targetPath, expectedHash, label) {
  const sourceHash = sha256(sourcePath);
  if (sourceHash !== expectedHash) {
    throw new Error(`${label} hash is ${sourceHash}, expected ${expectedHash}. Refusing to copy an unverified source.`);
  }

  if (existsSync(targetPath)) {
    const existingHash = sha256(targetPath);
    if (existingHash === expectedHash) {
      console.log(`${label} already matches the pinned hash at its backend location. No-op.`);
      return;
    }
    throw new Error(
      `Backend copy of ${label} exists with unexpected hash ${existingHash}. Refusing to overwrite; remove it manually after review if a resync is intended.`,
    );
  }

  mkdirSync(backendDir, { recursive: true });
  copyFileSync(sourcePath, targetPath);

  const writtenHash = sha256(targetPath);
  if (writtenHash !== expectedHash) {
    throw new Error(`Copied ${label} hash does not match the source; the copy is corrupt.`);
  }

  console.log(`Copied and verified backend copy of ${label} (sha256 ${writtenHash}).`);
}

function main() {
  const mobileDir = resolve(repoRoot, 'mobile/assets/quran');
  const sourceSqlite = resolve(mobileDir, 'quran.sqlite');
  const sourceNotice = resolve(mobileDir, 'TANZIL-NOTICE.txt');
  const sourceSurahCounts = resolve(repoRoot, 'tools/quran-verification/surah-counts.json');

  syncVerifiedFile(sourceSqlite, resolve(backendDir, 'quran.sqlite'), expectedSqliteHash, 'quran.sqlite');

  // TANZIL-NOTICE.txt carries no hash pin of its own elsewhere in the repo;
  // its faithfulness is proven by exact text equality with the source
  // instead, matching how the sqlite/surah-counts copies are hash-verified.
  const targetNotice = resolve(backendDir, 'TANZIL-NOTICE.txt');
  if (!existsSync(targetNotice) || readFileSync(targetNotice, 'utf-8') !== readFileSync(sourceNotice, 'utf-8')) {
    mkdirSync(backendDir, { recursive: true });
    copyFileSync(sourceNotice, targetNotice);
    if (readFileSync(targetNotice, 'utf-8') !== readFileSync(sourceNotice, 'utf-8')) {
      throw new Error('Copied TANZIL-NOTICE.txt does not match the source byte-for-byte; the copy is corrupt.');
    }
    console.log('Copied and verified backend copy of TANZIL-NOTICE.txt.');
  } else {
    console.log('TANZIL-NOTICE.txt already matches the source at its backend location. No-op.');
  }

  syncVerifiedFile(
    sourceSurahCounts,
    resolve(backendDir, 'surah-counts.json'),
    expectedSurahCountsHash,
    'surah-counts.json',
  );

  writeFileSync(
    resolve(backendDir, '.gitattributes'),
    '*.sqlite -text -diff\nTANZIL-NOTICE.txt -text -whitespace\nsurah-counts.json text eol=lf\n',
  );
}

main();
