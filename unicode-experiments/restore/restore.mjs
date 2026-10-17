#!/usr/bin/env node
// Puts the archived Unicode Mushaf prototype back into the app (development builds only), without regenerating
// anything: copies the archived modules, data, fonts, tests, tools and docs to their original paths, then applies the
// reader integration patch. The archive itself is left in place.
//
//   node unicode-experiments/restore/restore.mjs [--dry-run]
//
// Then: cd mobile && npm install   (the patch adds @expo-google-fonts/amiri-quran@0.4.1 to devDependencies)
// See unicode-experiments/README.md, "Restoring".
import { cpSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const archive = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(archive, '..');
const dryRun = process.argv.includes('--dry-run');

// Archived path (relative to unicode-experiments/) → original path (relative to the repository root): the same.
const ITEMS = [
  'mobile/src/mushaf/unicode',
  'mobile/src/components/UnicodeMushafPageText.tsx',
  'mobile/tests/unicodeMushafIntegrity.test.ts',
  'mobile/tests/unicodeMushafPage.test.ts',
  'tools/unicode-mushaf',
  'docs/unicode-mushaf',
];

const clashes = ITEMS.filter((item) => existsSync(join(repo, item)));
if (clashes.length) {
  console.error(`Already present, nothing changed (remove them first if you mean to replace them):\n  ${clashes.join('\n  ')}`);
  process.exit(1);
}

const patch = join(archive, 'restore', 'reader-integration.patch');
const git = (args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
try {
  git(['apply', '--check', patch]);
} catch (error) {
  console.error('The reader integration patch no longer applies cleanly to this tree (the reader changed since 545d2d9).');
  console.error('Nothing was changed. Merge it by hand: the full files it produced are in restore/reference/.');
  console.error(String(error.stderr || error.message));
  process.exit(1);
}

for (const item of ITEMS) {
  console.log(`${dryRun ? 'would copy' : 'copy'}  unicode-experiments/${item} → ${item}`);
  if (!dryRun) cpSync(join(archive, item), join(repo, item), { recursive: true, errorOnExist: true, force: false });
}
console.log(`${dryRun ? 'would apply' : 'apply'} restore/reader-integration.patch (mushaf.tsx, mushafScreen.test.ts, mushaf-device-testing.md, package.json)`);
if (!dryRun) git(['apply', patch]);

console.log(`\n${dryRun ? 'Dry run: nothing changed.' : 'Restored.'} Next:
  cd mobile && npm install
  npx vitest run tests/unicodeMushafIntegrity.test.ts tests/unicodeMushafPage.test.ts tests/mushafScreen.test.ts
  npx tsc --noEmit -p .
  npx expo start --dev-client --clear   (Mushaf tab → QCF chip → Uni; font chip → C2·Mad)`);
