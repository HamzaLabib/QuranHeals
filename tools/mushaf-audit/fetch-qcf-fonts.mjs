// Downloads the 604 QCF V1 page fonts from Quran Foundation's public CDN, for the glyph audits only.
// They go to a folder OUTSIDE the repository (default: the system temp folder) and are never committed.
// Usage: node tools/mushaf-audit/fetch-qcf-fonts.mjs [outDir]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const dir = resolve(process.argv[2] ?? join(tmpdir(), 'qcf-v1-fonts'));
if (!relative(repo, dir).startsWith('..')) throw new Error(`Refusing to write fonts inside the repository (${dir}).`);
mkdirSync(dir, { recursive: true });
const pages = Array.from({ length: 604 }, (_, i) => i + 1).filter((p) => !existsSync(join(dir, `p${p}.ttf`)));
let done = 0;
async function worker() {
  while (pages.length) {
    const p = pages.shift();
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(`https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p${p}.ttf`);
        if (!r.ok) throw new Error(String(r.status));
        writeFileSync(join(dir, `p${p}.ttf`), Buffer.from(await r.arrayBuffer()));
        done++;
        break;
      } catch (error) {
        if (attempt === 3) console.log('failed', p, String(error));
      }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`downloaded ${done}; fonts in ${dir}`);
