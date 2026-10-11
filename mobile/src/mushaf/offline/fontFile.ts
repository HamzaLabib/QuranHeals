/**
 * Checks that bytes are the QCF V1 page font for one page, before it is
 * stored or used: a well-formed TrueType file (table directory within the
 * file, `head` magic, 2048 units per em), whose family name is exactly that
 * page's (`QCF_P061` for page 61, in the `name` table), and whose character
 * map has a glyph for every code the page's verified layout uses. A font
 * for another page, a truncated download, or an error page served instead
 * all fail. Pure: no I/O.
 */

export const QCF_V1_UNITS_PER_EM = 2048;
export const qcfFamily = (page: number) => `QCF_P${String(page).padStart(3, '0')}`;

type Tables = Map<string, { offset: number; length: number }>;

function readTables(view: DataView): Tables | string {
  if (view.byteLength < 12) return 'too short';
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565 /* 'true' */) return 'not a TrueType font';
  const count = view.getUint16(4);
  if (count === 0 || count > 64 || 12 + count * 16 > view.byteLength) return 'bad table directory';
  const tables: Tables = new Map();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > view.byteLength) return `table ${tag} runs past the end of the file`;
    tables.set(tag, { offset, length });
  }
  for (const required of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'glyf', 'loca']) {
    if (!tables.has(required)) return `no ${required} table`;
  }
  return tables;
}

function familyNames(view: DataView, table: { offset: number; length: number }): string[] {
  const base = table.offset;
  const count = view.getUint16(base + 2);
  const storage = base + view.getUint16(base + 4);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = base + 6 + i * 12;
    if (at + 12 > base + table.length) break;
    const platform = view.getUint16(at);
    const nameId = view.getUint16(at + 6);
    const length = view.getUint16(at + 8);
    const offset = storage + view.getUint16(at + 10);
    if (nameId !== 1 && nameId !== 4 && nameId !== 6) continue;
    if (offset + length > view.byteLength) continue;
    let text = '';
    if (platform === 0 || platform === 3) {
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(view.getUint16(offset + j));
    } else if (platform === 1) {
      for (let j = 0; j < length; j++) text += String.fromCharCode(view.getUint8(offset + j));
    }
    names.push(text);
  }
  return names;
}

/** A lookup for a format 4 (BMP) Unicode subtable: code → glyph id (0 = missing). */
function cmapLookup(view: DataView, table: { offset: number; length: number }): ((code: number) => number) | null {
  const base = table.offset;
  const count = view.getUint16(base + 2);
  let subtable = -1;
  for (let i = 0; i < count; i++) {
    const at = base + 4 + i * 8;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);
    const offset = base + view.getUint32(at + 4);
    if (offset + 4 > view.byteLength || view.getUint16(offset) !== 4) continue;
    if ((platform === 3 && encoding === 1) || (platform === 0 && subtable < 0)) subtable = offset;
  }
  if (subtable < 0) return null;
  const segX2 = view.getUint16(subtable + 6);
  const ends = subtable + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  if (ranges + segX2 > view.byteLength) return null;
  return (code: number) => {
    for (let i = 0; i < segX2; i += 2) {
      const end = view.getUint16(ends + i);
      if (code > end) continue;
      const start = view.getUint16(starts + i);
      if (code < start) return 0;
      const delta = view.getInt16(deltas + i);
      const rangeOffset = view.getUint16(ranges + i);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const at = ranges + i + rangeOffset + (code - start) * 2;
      if (at + 2 > view.byteLength) return 0;
      const glyph = view.getUint16(at);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

/** Problems with `bytes` as page `page`'s font (empty when it is valid). `glyphs`: the page's glyph codes. */
export function checkPageFont(bytes: Uint8Array, page: number, glyphs: readonly string[]): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let tables: Tables | string;
  try {
    tables = readTables(view);
  } catch {
    return ['unreadable font'];
  }
  if (typeof tables === 'string') return [tables];
  const problems: string[] = [];
  try {
    const head = tables.get('head')!;
    if (view.getUint32(head.offset + 12) !== 0x5f0f3cf5) problems.push('bad head magic');
    if (view.getUint16(head.offset + 18) !== QCF_V1_UNITS_PER_EM) problems.push(`units per em ${view.getUint16(head.offset + 18)}`);
    const family = qcfFamily(page);
    const names = familyNames(view, tables.get('name')!);
    if (!names.includes(family)) problems.push(`not ${family} (names: ${[...new Set(names)].join(', ') || 'none'})`);
    const lookup = cmapLookup(view, tables.get('cmap')!);
    if (!lookup) problems.push('no Unicode character map');
    else {
      const missing = [...new Set(glyphs.flatMap((glyph) => [...glyph]))].filter((char) => lookup(char.codePointAt(0)!) === 0);
      if (missing.length > 0) problems.push(`${missing.length} of the page's glyph codes have no glyph`);
    }
  } catch {
    problems.push('unreadable font tables');
  }
  return problems;
}
