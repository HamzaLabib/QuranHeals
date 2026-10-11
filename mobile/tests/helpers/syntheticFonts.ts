import { FontSourceError, type FontFiles, type FontSource } from '@/mushaf/offline/fonts';
import { qcfFamily } from '@/mushaf/offline/fontFile';

/**
 * SYNTHETIC QCF V1-shaped fonts for tests: a minimal TrueType file per page
 * with that page's family name (QCF_P001 …) and a character map covering
 * U+E000–U+EFFF (the made-up glyph codes of syntheticOfflineMushaf.ts). Not
 * real fonts: just enough structure for the checks in fontFile.ts.
 */
export function syntheticFont(page: number, options: { family?: string; coverUpTo?: number } = {}): Uint8Array {
  const family = options.family ?? qcfFamily(page);
  const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

  const head = new Array(54).fill(0);
  head.splice(12, 4, ...be32(0x5f0f3cf5));
  head.splice(18, 2, ...be16(2048));

  const utf16 = [...family].flatMap((c) => be16(c.charCodeAt(0)));
  const name = [...be16(0), ...be16(2), ...be16(6 + 2 * 12),
    ...be16(3), ...be16(1), ...be16(0x409), ...be16(1), ...be16(utf16.length), ...be16(0),
    ...be16(3), ...be16(1), ...be16(0x409), ...be16(4), ...be16(utf16.length), ...be16(0),
    ...utf16];

  // Format 4: one segment U+E000…end mapped to glyph 1, plus the closing 0xFFFF segment.
  const end = options.coverUpTo ?? 0xefff;
  const delta = (1 - 0xe000) & 0xffff;
  const sub = [...be16(4), ...be16(32), ...be16(0), ...be16(4), ...be16(4), ...be16(1), ...be16(0),
    ...be16(end), ...be16(0xffff), ...be16(0),
    ...be16(0xe000), ...be16(0xffff),
    ...be16(delta), ...be16(1),
    ...be16(0), ...be16(0)];
  const cmap = [...be16(0), ...be16(1), ...be16(3), ...be16(1), ...be32(12), ...sub];

  const tables: [string, number[]][] = [
    ['cmap', cmap], ['glyf', [0, 0, 0, 0]], ['head', head], ['hhea', new Array(36).fill(0)],
    ['hmtx', [0, 0, 0, 0]], ['loca', [0, 0, 0, 0]], ['maxp', [0, 0, 0x50, 0, 0, 2]], ['name', name],
  ];
  const headerSize = 12 + tables.length * 16;
  const out: number[] = [...be32(0x00010000), ...be16(tables.length), 0, 0, 0, 0, 0, 0];
  let offset = headerSize;
  const bodies: number[] = [];
  for (const [tag, data] of tables) {
    out.push(...[...tag].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...be32(offset), ...be32(data.length));
    const padded = [...data, ...new Array((4 - (data.length % 4)) % 4).fill(0)];
    bodies.push(...padded);
    offset += padded.length;
  }
  return new Uint8Array([...out, ...bodies]);
}

/** A CDN serving synthetic fonts, with ETags and hooks to break it. */
export function fakeFontCdn() {
  const state = {
    online: true,
    calls: [] as number[],
    dropAfter: Infinity,
    etag: new Map<number, string>(),
    /** Pages served as another page's font. */
    wrongFont: new Set<number>(),
    /** Pages whose body arrives truncated. */
    truncated: new Set<number>(),
    /** A newer font for these pages (a different byte, a new ETag). */
    updated: new Set<number>(),
  };
  const fontFor = (page: number) => {
    const bytes = syntheticFont(state.wrongFont.has(page) ? page + 1 : page);
    if (state.updated.has(page)) bytes[bytes.length - 1] = 0x7f;
    return bytes;
  };
  const source: FontSource = {
    async fetch(page, conditional) {
      if (!state.online || state.calls.length >= state.dropAfter) throw new FontSourceError('offline', 'offline');
      state.calls.push(page);
      const etag = state.updated.has(page) ? `"v2-${page}"` : `"v1-${page}"`;
      if (conditional?.etag && conditional.etag === etag) return { status: 'not-modified' };
      const bytes = fontFor(page);
      return { status: 'ok', bytes: state.truncated.has(page) ? bytes.slice(0, 40) : bytes, etag, lastModified: null, contentLength: bytes.length };
    },
  };
  return { source, state };
}

/** Fonts on "disk": an in-memory map, kept across instances like a real documents directory. */
export function memoryFontFiles(): FontFiles & { stored: Map<number, Uint8Array> } {
  const stored = new Map<number, Uint8Array>();
  return {
    stored,
    async read(page) { return stored.get(page) ?? null; },
    size(page) { return stored.get(page)?.length ?? null; },
    async write(page, bytes) { stored.set(page, bytes.slice()); },
    async remove(page) { stored.delete(page); },
    async removeAll() { stored.clear(); },
    async cleanup() { /* no temporary files in memory */ },
    uri: (page) => `file:///fonts/p${page}.ttf`,
  };
}
