// Downloads one EveryAyah per-ayah recording (https://everyayah.com/data/<folder>/) into a local cache OUTSIDE the
// repository and OneDrive, for the automated per-ayah scan (scan.py) and the review dashboard. Nothing is written to Git.
//
// For every file it records what the host answered (status, any redirect, content type, length, byte ranges) and checks
// it against the folder listing's size and the folder's own 000_checksum.md5. A file is only kept when its size is the
// listed one; a redirect is never followed (it would be another file).
//
//   node tools/quran-audio/per-ayah/everyayah-fetch.mjs --folder Muhammad_Jibreel_128kbps [--out <dir>] [--concurrency 8]
//
// Default --out: %LOCALAPPDATA%/QuranHeals/per-ayah-cache/<folder>. Re-running only fetches what is missing or wrong.
// Output: <out>/files/SSSAAA.mp3 and <out>/fetch-manifest.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
const folder = args.folder;
if (!folder || !/^[A-Za-z0-9_.-]+$/.test(folder)) throw new Error('--folder <EveryAyah folder name> is required');
const base = `https://everyayah.com/data/${folder}/`;
const out = args.out ?? join(process.env.LOCALAPPDATA ?? '.', 'QuranHeals', 'per-ayah-cache', folder);
const concurrency = Number(args.concurrency ?? 8);
mkdirSync(join(out, 'files'), { recursive: true });

async function getText(url) {
  const r = await fetch(url, { redirect: 'manual' });
  if (r.status !== 200) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

/** The folder listing: every entry's name, listed size and modification time. */
export function parseListing(html) {
  const re = /<span class="name">([^<]+)<\/span>[\s\S]*?<td data-order="(-?\d+)">[\s\S]*?datetime="([^"]+)"/g;
  const rows = [];
  for (let m; (m = re.exec(html));) rows.push({ name: m[1], bytes: Number(m[2]), modified: m[3] });
  return rows;
}

export function parseChecksums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    // "md5 *name" (binary mode) or "md5  name" (text mode, two spaces): both appear on EveryAyah.
    const m = /^([0-9a-f]{32})\s+\*?(\S+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

const listingHtml = await getText(base);
const listing = parseListing(listingHtml);
const checksumText = await getText(`${base}000_checksum.md5`).catch(() => '');
const md5s = parseChecksums(checksumText);
writeFileSync(join(out, 'listing.json'), JSON.stringify(listing, null, 1));
// mistakes/: earlier copies EveryAyah replaced (the ayahs concerned were corrected once). Listed, with their checksums.
const mistakes = [];
if (listing.some((r) => r.name === 'mistakes' && r.bytes < 0)) {
  for (const r of parseListing(await getText(`${base}mistakes/`)).filter((x) => /\.mp3$/i.test(x.name))) {
    const buf = Buffer.from(await (await fetch(`${base}mistakes/${r.name}`, { redirect: 'manual' })).arrayBuffer());
    mistakes.push({ ...r, md5: createHash('md5').update(buf).digest('hex'), fetchedBytes: buf.length });
  }
}
writeFileSync(join(out, '000_checksum.md5'), checksumText);
const mp3 = listing.filter((r) => /^\d{6}\.mp3$/.test(r.name));
console.log(`${folder}: ${listing.length} entries, ${mp3.length} SSSAAA.mp3, ${md5s.size} checksums`);

const previous = existsSync(join(out, 'fetch-manifest.json')) ? JSON.parse(readFileSync(join(out, 'fetch-manifest.json'), 'utf8')) : { files: {} };
const results = {};
let done = 0;
let failed = 0;

async function fetchOne(row) {
  const path = join(out, 'files', row.name);
  const old = previous.files[row.name];
  if (old?.ok && existsSync(path)) {
    const buf = readFileSync(path);
    if (buf.length === row.bytes) {
      // Kept, but compared again with the current checksum list (the file's MD5 recomputed, not trusted).
      const md5 = createHash('md5').update(buf).digest('hex');
      const listedMd5 = md5s.get(row.name) ?? null;
      results[row.name] = { ...old, md5, listedMd5, md5Match: listedMd5 === null ? null : listedMd5 === md5 };
      return;
    }
  }
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(base + row.name, { redirect: 'manual' });
      const head = {
        status: r.status,
        location: r.headers.get('location'),
        contentType: r.headers.get('content-type'),
        contentLength: r.headers.get('content-length') === null ? null : Number(r.headers.get('content-length')),
        acceptRanges: r.headers.get('accept-ranges'),
        lastModified: r.headers.get('last-modified'),
      };
      if (r.status !== 200) {
        last = { ok: false, ...head, error: `HTTP ${r.status}` };
        if (r.status >= 300 && r.status < 500) break;
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const md5 = createHash('md5').update(buf).digest('hex');
      const sha256 = createHash('sha256').update(buf).digest('hex');
      const listedMd5 = md5s.get(row.name) ?? null;
      const entry = { ok: buf.length === row.bytes, ...head, bytes: buf.length, listedBytes: row.bytes, modified: row.modified, md5, sha256, listedMd5, md5Match: listedMd5 === null ? null : listedMd5 === md5 };
      if (!entry.ok) {
        last = { ...entry, error: 'size differs from the listing' };
        continue;
      }
      writeFileSync(`${path}.part`, buf);
      renameSync(`${path}.part`, path);
      results[row.name] = entry;
      return;
    } catch (error) {
      last = { ok: false, error: String(error?.message ?? error) };
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  results[row.name] = last;
  failed++;
}

const queue = [...mp3];
const save = () => writeFileSync(join(out, 'fetch-manifest.json'), JSON.stringify({ folder, base, fetchedOn: new Date().toISOString(), listingEntries: listing.length, checksums: md5s.size, mistakes: mistakes.map((m) => ({ ...m, listedMd5: md5s.get(m.name) ?? null })), files: results }, null, 1));
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    await fetchOne(queue.shift());
    if (++done % 250 === 0) {
      console.log(`${done}/${mp3.length} (${failed} failed)`);
      save();
    }
  }
}));
save();
const ok = Object.values(results).filter((r) => r?.ok).length;
const md5Bad = Object.entries(results).filter(([, r]) => r?.ok && r.md5Match === false).map(([n]) => n);
console.log(`done: ${ok}/${mp3.length} ok, ${failed} failed, md5 mismatches: ${md5Bad.length} ${md5Bad.slice(0, 20).join(' ')}`);
