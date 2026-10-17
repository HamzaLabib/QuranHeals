#!/usr/bin/env node
// Verifies files restored from a private archive (repository audit C1 / C2) against a manifest of SHA-256 hashes.
// Read-only: it never writes, copies or deletes anything.
//
// usage (from the repository root):
//   node tools/quran-verification/verify-private-archive.mjs <manifest.json> [--root <dir>]
//
// <manifest.json> is either a tracked summary (archived-outputs.json, archived-images.json: { files: [...] }) or the
// private archive's MANIFEST.json ({ groups: [{ files: [...] }] }). Each file entry has "path", "bytes", "sha256" (the
// committed object). A text file checked out on Windows with CRLF line endings (core.autocrlf) is accepted when its
// LF-normalised bytes match, and reported as such. Exit code 0 = every listed file present and matching.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = resolve(rootFlag >= 0 ? args[rootFlag + 1] : process.cwd());
const manifestPath = args.find((arg, i) => !arg.startsWith('--') && (rootFlag < 0 || i !== rootFlag + 1));
if (!manifestPath) {
  console.error('usage: node tools/quran-verification/verify-private-archive.mjs <manifest.json> [--root <dir>]');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const files = manifest.groups ? manifest.groups.flatMap((group) => group.files) : manifest.files;
if (!Array.isArray(files) || files.length === 0) {
  console.error(`no file entries in ${manifestPath}`);
  process.exit(2);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
let failures = 0;
for (const entry of files) {
  const path = resolve(root, entry.path);
  let status;
  if (!existsSync(path)) {
    status = 'MISSING';
  } else {
    const bytes = readFileSync(path);
    if (bytes.length === entry.bytes && sha256(bytes) === entry.sha256) {
      status = 'OK';
    } else {
      const lf = Buffer.from(bytes.toString('latin1').split('\r\n').join('\n'), 'latin1');
      status = lf.length === entry.bytes && sha256(lf) === entry.sha256 ? 'OK (CRLF checkout copy)' : 'MISMATCH';
    }
  }
  if (!status.startsWith('OK')) failures++;
  console.log(`${status.padEnd(23)} ${entry.path}`);
}
console.log(`\n${files.length - failures}/${files.length} verified${failures ? `; ${failures} failed` : ''}`);
process.exitCode = failures ? 1 : 0;
