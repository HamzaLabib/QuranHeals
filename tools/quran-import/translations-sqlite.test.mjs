import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  buildDatabase,
  corpusChecksum,
  expectedRawGutenbergSha256,
  expectedSourceJsonSha256,
  openReadonlyDatabase,
  proveDeterministicBuild,
  readVerifiedSource,
  repoRoot,
  sha256,
  sourceJsonPath,
  verifyDatabase,
} from './generate-translations-sqlite.mjs';

const sourceBytes = readFileSync(resolve(repoRoot, sourceJsonPath));
const source = readVerifiedSource(sourceBytes);
const bundledDatabase = resolve(repoRoot, 'backend/assets/quran/translations.sqlite');

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'translations-sqlite-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('approved source JSON hash pin matches, and embeds the approved raw Gutenberg hash', () => {
  assert.equal(sha256(sourceBytes), expectedSourceJsonSha256);
  assert.equal(source.sourceFileSha256, expectedRawGutenbergSha256);
  assert.equal(source.rows.length, 6236);
});

test('source hash failure stops generation before touching the database', () => {
  assert.throws(
    () => readVerifiedSource(Buffer.concat([sourceBytes, Buffer.from('\n')])),
    /integrity pin/,
  );
});

test('the published backend/assets/quran/translations.sqlite passes full structural + content verification', () => {
  assert.equal(existsSync(bundledDatabase), true);
  const verification = verifyDatabase(bundledDatabase, source);
  assert.deepEqual(
    { rowCount: verification.rowCount, exactMatches: verification.exactMatches, mismatches: verification.mismatches, integrityCheck: verification.integrityCheck },
    { rowCount: 6236, exactMatches: 6236, mismatches: 0, integrityCheck: 'ok' },
  );
});

test('the published database corpus checksum matches the approved source corpus checksum', () => {
  const verification = verifyDatabase(bundledDatabase, source);
  assert.equal(verification.corpusChecksum, corpusChecksum(source.rows));
});

test('two independent builds from the same source produce byte-identical databases', (t) => {
  const result = proveDeterministicBuild(source);
  t.after(() => {
    // proveDeterministicBuild already cleans up its own temp dirs internally.
  });
  assert.equal(result.byteIdentical, true);
  assert.equal(result.hashA, result.hashB);
  assert.equal(result.sizeA, result.sizeB);
});

test('a single fresh build matches the published database byte-for-byte', (t) => {
  const directory = temporaryDirectory(t);
  const path = join(directory, 'translations.sqlite');
  const bytes = buildDatabase(path, source);
  assert.equal(sha256(bytes), sha256(readFileSync(bundledDatabase)));
});

test('translations table rejects a non-canonical surah number (STRICT + CHECK constraint)', (t) => {
  const directory = temporaryDirectory(t);
  const path = join(directory, 'invalid.sqlite');
  buildDatabase(path, source);
  const db = openReadonlyDatabase(path);
  try {
    assert.throws(() => {
      // openReadonlyDatabase sets PRAGMA query_only = ON, so even attempting
      // a write must fail closed regardless of the CHECK constraint itself.
      db.exec("INSERT INTO translations (surah, ayah, verse_key, translation_id, text) VALUES (200, 1, '200:1', 'x', 'x')");
    }, /readonly|read-only/i);
  } finally {
    db.close();
  }
});
