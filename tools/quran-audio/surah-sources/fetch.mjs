// Downloads a whole-surah recording (one file per surah) from a candidate source into a local cache OUTSIDE the
// repository and OneDrive, for the source comparison and the alignment. Nothing is written to Git.
//
// For every surah it records what the host answered (status, redirect, type, length, byte ranges, ETag,
// Last-Modified) and the file's size and SHA-256. Redirects are never followed (another file). Resumable: a file already
// cached with the size the host announces is kept (re-hashed, not re-downloaded). Concurrency is small (default 3).
//
//   node tools/quran-audio/surah-sources/fetch.mjs --recording ahmed-salama --source way2quran [--concurrency 3]
//
// Sources and URL patterns: sources.mjs. Output: %LOCALAPPDATA%/QuranHeals/surah-cache/<recording>/<source>/NNN.mp3 and
// manifest.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SURAH_SOURCES } from './sources.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []));
const rec = SURAH_SOURCES[args.recording];
const src = rec?.sources?.[args.source];
if (!src) throw new Error(`unknown --recording/--source (${Object.keys(SURAH_SOURCES).join(', ')})`);
const out = join(process.env.LOCALAPPDATA ?? '.', 'QuranHeals', 'surah-cache', args.recording, args.source);
mkdirSync(out, { recursive: true });
const UA = { 'User-Agent': 'Mozilla/5.0 (QuranHeals audio audit)' };
const urls = await src.urls();
const prevFile = join(out, 'manifest.json');
const prev = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')).files ?? {} : {};
const files = {};

async function one(surah) {
  const url = urls[surah];
  if (!url) { files[surah] = { ok: false, error: 'no URL listed for this surah' }; return; }
  const path = join(out, `${String(surah).padStart(3, '0')}.mp3`);
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const head = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: UA });
      const h = { status: head.status, location: head.headers.get('location'), contentType: head.headers.get('content-type'), contentLength: Number(head.headers.get('content-length') ?? NaN), acceptRanges: head.headers.get('accept-ranges'), etag: head.headers.get('etag'), lastModified: head.headers.get('last-modified') };
      if (h.status !== 200) { last = { ok: false, url, ...h, error: `HTTP ${h.status}` }; if (h.status < 500) break; continue; }
      if (existsSync(path) && statSync(path).size === h.contentLength && prev[surah]?.sha256) {
        files[surah] = { ...prev[surah], ...h, ok: true, url, reused: true };
        return;
      }
      const r = await fetch(url, { redirect: 'manual', headers: UA });
      if (r.status !== 200) { last = { ok: false, url, ...h, error: `GET HTTP ${r.status}` }; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (Number.isFinite(h.contentLength) && buf.length !== h.contentLength) { last = { ok: false, url, ...h, error: `got ${buf.length} bytes, announced ${h.contentLength}` }; continue; }
      writeFileSync(`${path}.part`, buf);
      renameSync(`${path}.part`, path);
      files[surah] = { ok: true, url, ...h, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
      return;
    } catch (e) {
      last = { ok: false, url, error: String(e?.message ?? e) };
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
  files[surah] = last;
}

const queue = Array.from({ length: 114 }, (_, i) => i + 1);
const save = () => writeFileSync(prevFile, JSON.stringify({ recording: args.recording, source: args.source, fetchedOn: new Date().toISOString(), files: { ...prev, ...files } }, null, 1));
let done = 0;
await Promise.all(Array.from({ length: Number(args.concurrency ?? 3) }, async () => {
  while (queue.length) {
    await one(queue.shift());
    if (++done % 10 === 0) { save(); console.log(`${done}/114`); }
  }
}));
save();
const ok = Object.values(files).filter((f) => f?.ok).length;
console.log(`${args.recording}/${args.source}: ${ok}/114 ok; failed: ${Object.entries(files).filter(([, f]) => !f?.ok).map(([s, f]) => `${s} (${f?.error})`).join(', ') || 'none'}`);
