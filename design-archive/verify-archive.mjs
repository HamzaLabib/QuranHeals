// Verifies design-archive/: every archived file exists, matches MANIFEST.json's SHA-256 and size, and is the same Git
// object as the original at its recorded revision (so the archive is complete, identical and recoverable from both
// places). Also checks that nothing in the live app or backend imports the archive. Run from the repository root:
//   node design-archive/verify-archive.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const archive = join(root, 'design-archive');
const manifest = JSON.parse(readFileSync(join(archive, 'MANIFEST.json'), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 1 << 28 });
const problems = [];

for (const entry of manifest.files) {
  const path = join(archive, entry.archivePath);
  if (!existsSync(path)) { problems.push(`missing: ${entry.archivePath}`); continue; }
  const bytes = readFileSync(path);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== entry.sha256 || bytes.length !== entry.bytes) problems.push(`changed: ${entry.archivePath}`);
  // The archived bytes hash to the original's Git blob (with the repository's line-ending filters applied).
  const blob = git('hash-object', '--path', entry.source, path).toString().trim();
  if (blob !== entry.blob) problems.push(`not the original blob: ${entry.archivePath}`);
  // And the original is still reachable in history at its revision.
  let original;
  try { original = git('rev-parse', `${entry.revision}:${entry.source}`).toString().trim(); } catch { original = null; }
  if (original !== entry.blob) problems.push(`not recoverable from Git: ${entry.source} @ ${entry.revision}`);
}

// Files in the archive that the manifest doesn't list are documentation or archive tooling only.
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const listed = new Set(manifest.files.map((f) => f.archivePath));
const unlisted = walk(archive).map((p) => relative(archive, p).split('\\').join('/')).filter((p) => !listed.has(p));
// experiments/: design experiments built on the archive (their own sources, measurements, screenshots), not archived
// originals, so not in MANIFEST.json; the live-code reference check below still covers them.
const allowedUnlisted = /(^|\/)README\.md$|^MANIFEST\.json$|^verify-archive\.mjs$|geometry-and-calculations\/(compute-baseline\.mts|baseline-geometry\.json)$|^experiments\//;
for (const p of unlisted) if (!allowedUnlisted.test(p)) problems.push(`unlisted file in archive: ${p}`);

// Inactive: no live source imports or requires anything from the archive (comments may point to it).
const importsArchive = /(\bfrom\s*['"][^'"]*design-archive|\bimport\s*\(\s*['"][^'"]*design-archive|\brequire\s*\(\s*['"][^'"]*design-archive|^\s*import\s*['"][^'"]*design-archive)/m;
const live = ['mobile/src', 'mobile/app', 'mobile/tests', 'mobile/app.config.ts', 'mobile/metro.config.js', 'backend/src'].map((p) => join(root, p)).filter(existsSync);
for (const base of live) {
  const files = statSync(base).isDirectory() ? walk(base) : [base];
  for (const file of files) if (/\.(m?[jt]sx?)$/.test(file) && importsArchive.test(readFileSync(file, 'utf8'))) problems.push(`live code imports the archive: ${relative(root, file)}`);
}

if (problems.length) {
  console.error(`design-archive: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`design-archive: OK — ${manifest.files.length} files identical to their originals (revision ${manifest.revision.slice(0, 7)} and history), recoverable from Git, not referenced by live code.`);
