#!/usr/bin/env node
/**
 * Maintainer tool: pins the 604 QCF V1 page fonts the app bundles. Downloads
 * each from Quran Foundation's documented CDN, checks it is a TrueType font
 * named exactly for its page (QCF_P001 … QCF_P604) with 2048 units per em,
 * and writes:
 *   - the fonts themselves into assets/mushaf/qpc-v1/ (git-ignored),
 *   - assets/mushaf/qpc-v1/fonts.lock.json: size, SHA-256 and the CDN's ETag
 *     per font (restore-mushaf-fonts.mjs restores only these exact bytes),
 *   - src/mushaf/generated/qpcV1PageFonts.ts: the app's asset map and pins.
 * Run it only to adopt a reviewed upstream change; normal checkouts and
 * builds use restore-mushaf-fonts.mjs. Node built-ins only.
 *
 *   node scripts/pin-mushaf-fonts.mjs
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = resolve(mobileDir, 'assets/mushaf/qpc-v1');
const lockPath = resolve(fontsDir, 'fonts.lock.json');
const modulePath = resolve(mobileDir, 'src/mushaf/generated/qpcV1PageFonts.ts');
const PAGES = 604;
const CONCURRENCY = 8;

const family = (page) => `QCF_P${String(page).padStart(3, '0')}`;
const urlFor = (page) => `https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p${page}.ttf`;

/** A problem with the font as this page's (as fontFile.ts checks it: the page's family among names 1, 4 and 6), or null. */
function check(bytes, page) {
  if (bytes.length < 12 || bytes.readUInt32BE(0) !== 0x00010000) return 'not a TrueType font';
  const tables = new Map();
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    tables.set(bytes.toString('ascii', at, at + 4), { offset: bytes.readUInt32BE(at + 8), length: bytes.readUInt32BE(at + 12) });
  }
  for (const { offset, length } of tables.values()) if (offset + length > bytes.length) return 'a table runs past the end of the file';
  const head = tables.get('head');
  if (!head || bytes.readUInt32BE(head.offset + 12) !== 0x5f0f3cf5) return 'bad head table';
  if (bytes.readUInt16BE(head.offset + 18) !== 2048) return 'units per em is not 2048';
  const name = tables.get('name');
  if (!name) return 'no name table';
  const strings = name.offset + bytes.readUInt16BE(name.offset + 4);
  const names = [];
  for (let i = 0; i < bytes.readUInt16BE(name.offset + 2); i++) {
    const at = name.offset + 6 + i * 12;
    const id = bytes.readUInt16BE(at + 6);
    if (bytes.readUInt16BE(at) !== 3 || ![1, 4, 6].includes(id)) continue;
    const start = strings + bytes.readUInt16BE(at + 10);
    names.push(Buffer.from(bytes.subarray(start, start + bytes.readUInt16BE(at + 8))).swap16().toString('utf16le'));
  }
  return names.includes(family(page)) ? null : `named ${[...new Set(names)].join(', ') || 'nothing'}, not ${family(page)}`;
}

async function fetchFont(page) {
  let problem;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(urlFor(page), { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const length = Number(response.headers.get('content-length'));
      if (length > 0 && !response.headers.get('content-encoding') && length !== bytes.length) throw new Error('incomplete download');
      problem = check(bytes, page);
      if (problem) throw new Error(problem);
      return { bytes, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') };
    } catch (error) {
      problem = error.message;
    }
  }
  throw new Error(`p${page}.ttf: ${problem}`);
}

const fonts = new Array(PAGES);
let next = 1;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next <= PAGES) {
    const page = next++;
    const { bytes, etag, lastModified } = await fetchFont(page);
    const file = `p${page}.ttf`;
    writeFileSync(resolve(fontsDir, `${file}.partial`), bytes);
    renameSync(resolve(fontsDir, `${file}.partial`), resolve(fontsDir, file));
    fonts[page - 1] = { page, file, family: family(page), url: urlFor(page), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), etag, lastModified };
  }
}));

const lock = {
  description: "QCF V1 page fonts the app bundles (all 604), restored (not committed) by mobile/scripts/restore-mushaf-fonts.mjs from Quran Foundation's documented public CDN, and pinned by mobile/scripts/pin-mushaf-fonts.mjs. Quran Foundation's Mushaf font terms allow them only as an integrated part of the app, never as a standalone download, so the .ttf files are git-ignored. Each must match its size and SHA-256 or nothing is written. etag/lastModified: the CDN's validators for these exact bytes (the app's update check asks whether a font changed since). © King Fahd Glorious Qur'an Printing Complex.",
  fonts,
};
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

const rows = fonts.map((f) => `  ${f.page}: { asset: require('../../../assets/mushaf/qpc-v1/${f.file}'), sha256: '${f.sha256}', etag: ${JSON.stringify(f.etag)}, lastModified: ${JSON.stringify(f.lastModified)} },`);
mkdirSync(dirname(modulePath), { recursive: true });
writeFileSync(modulePath, `// Generated by scripts/pin-mushaf-fonts.mjs from assets/mushaf/qpc-v1/fonts.lock.json. Do not edit by hand.
/**
 * The 604 QCF V1 page fonts bundled with the app (assets/mushaf/qpc-v1/p{N}.ttf, restored and hash-checked by
 * scripts/restore-mushaf-fonts.mjs before every build): each page's asset, the SHA-256 of its exact bytes, and the
 * CDN's ETag / Last-Modified for those bytes (the offline Mushaf's monthly update check, offline/fonts.ts).
 */
export type BundledPageFont = { asset: number; sha256: string; etag: string | null; lastModified: string | null };

export const QPC_V1_PAGE_FONTS: Readonly<Record<number, BundledPageFont>> = {
${rows.join('\n')}
};
`);

const total = fonts.reduce((sum, f) => sum + f.bytes, 0);
console.log(`pinned ${fonts.length} fonts, ${total} bytes (${(total / 1048576).toFixed(1)} MiB)`);
