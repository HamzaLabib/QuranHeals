import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, 'mobile/dist/runtime-check');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = readFileSync(resolve(root, 'mobile/assets/quran/quran.sqlite'));
const notice = readFileSync(resolve(root, 'mobile/assets/quran/TANZIL-NOTICE.txt'));
const expectedHash = 'c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b';
assert.equal(hash(original), expectedHash);
const metadata = JSON.parse(readFileSync(resolve(directory, 'metadata.json'), 'utf8'));
const platforms = {};
for (const platform of ['ios', 'android']) {
  const assets = metadata.fileMetadata[platform].assets;
  const databases = assets.filter(asset => asset.ext === 'sqlite');
  assert.equal(databases.length, 1, `${platform} database asset missing/duplicated`);
  assert.ok(readFileSync(resolve(directory, databases[0].path)).equals(original));
  assert.ok(assets.some(asset => asset.ext === 'txt' && readFileSync(resolve(directory, asset.path)).equals(notice)));
  platforms[platform] = { bundle: metadata.fileMetadata[platform].bundle, databaseExact: true, noticeExact: true };
}
const files = readdirSync(resolve(directory, 'assets/assets/quran'));
const webDatabase = files.filter(file => file.endsWith('.sqlite'));
assert.equal(webDatabase.length, 1);
assert.ok(readFileSync(resolve(directory, 'assets/assets/quran', webDatabase[0])).equals(original));
assert.ok(files.some(file => file.startsWith('TANZIL-NOTICE.') && readFileSync(resolve(directory, 'assets/assets/quran', file)).equals(notice)));
platforms.web = { databaseExact: true, noticeExact: true };
const report = { sqliteSha256: expectedHash, platforms, limitation: 'Exported bundles and asset bytes verified; native device execution was not available.' };
const outputPath = resolve(root, 'backend/reports/quran-verification/runtime/export-validation.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Report: ${outputPath}`);
console.log(JSON.stringify(report, null, 2));
