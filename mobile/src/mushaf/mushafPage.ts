import { isExistingAyah } from '@/utils/ayahLink';

/**
 * One printed Mushaf page from quran-ws/quran-svg (Hafs / KFQC), as bundled
 * by tools/mushaf/import-quran-svg-page.mjs: the original page SVG plus its
 * ayah mapping. Everything here is in the page's own SVG coordinates
 * (viewBox 0 0 345 550 from page 3 on).
 */
export type MushafPageSource = {
  page: number;
  edition: 'hafs-kfqc';
  source: {
    repository: string;
    tag: string;
    svgUrl: string;
    mappingUrl: string;
    svgSha256: string;
    mappingSha256: string;
  };
  svg: string;
  mappingJson: string;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type MushafAyah = {
  verseKey: string;
  surah: number;
  ayah: number;
  /** One rectangle per printed line the ayah occupies (or a single box for pages 1–2). */
  rects: Rect[];
  /** The original polygon as SVG path data, for drawing a highlight. */
  path: string;
};

export type MushafPage = {
  page: number;
  viewBox: { x: number; y: number; width: number; height: number };
  ayahs: MushafAyah[];
};

export const MUSHAF_PAGE_COUNT = 604;

export class MushafPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MushafPageError';
  }
}

const NUMBER = /-?\d+(?:\.\d+)?/g;

function boundingRect(numbers: number[]): Rect {
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The mapping's `polygon` ships in two shapes (docs/FORMAT.md at the tag):
 * SVG path data with one subpath per printed line (pages 3+), or a bare
 * "x,y x,y …" point list (pages 1–2). Each subpath becomes its own
 * rectangle — never one box welded across lines — so a tap between two
 * ayahs' line fragments resolves to the right one.
 */
export function polygonToRects(polygon: string): Rect[] {
  const trimmed = polygon.trim();
  if (!trimmed.startsWith('M')) {
    const numbers = (trimmed.match(NUMBER) ?? []).map(Number);
    if (numbers.length < 6 || numbers.length % 2 !== 0) throw new MushafPageError('Malformed ayah polygon');
    return [boundingRect(numbers)];
  }
  const rects = trimmed.split(/(?=M)/).map((subpath) => {
    const numbers = (subpath.match(NUMBER) ?? []).map(Number);
    if (numbers.length < 6 || numbers.length % 2 !== 0) throw new MushafPageError('Malformed ayah polygon');
    return boundingRect(numbers);
  });
  return rects;
}

/** The polygon as SVG path data, either shape. */
export function polygonToPath(polygon: string): string {
  const trimmed = polygon.trim();
  if (trimmed.startsWith('M')) return trimmed;
  const numbers = (trimmed.match(NUMBER) ?? []).map(Number);
  const points: string[] = [];
  for (let index = 0; index < numbers.length; index += 2) points.push(`${numbers[index]} ${numbers[index + 1]}`);
  return `M ${points.join(' L ')} Z`;
}

function readViewBox(svg: string): MushafPage['viewBox'] {
  const match = svg.match(/<svg\b[^>]*\bviewBox="([^"]+)"/);
  const values = match ? match[1].trim().split(/[\s,]+/).map(Number) : [];
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) {
    throw new MushafPageError('Page SVG has no usable viewBox');
  }
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

/**
 * Validates and parses a bundled page. Throws for anything that could put
 * a tap on the wrong ayah: a reference that doesn't exist, a duplicate, or
 * ayahs out of reading order.
 */
export function parseMushafPage(source: MushafPageSource): MushafPage {
  if (!Number.isInteger(source.page) || source.page < 1 || source.page > MUSHAF_PAGE_COUNT) {
    throw new MushafPageError('Invalid page number');
  }
  const raw: unknown = JSON.parse(source.mappingJson);
  if (!Array.isArray(raw) || raw.length === 0) throw new MushafPageError('Page has no ayahs');
  const seen = new Set<string>();
  let previous: { surah: number; ayah: number } | null = null;
  const ayahs = raw.map((entry: { surahNumber?: unknown; ayahNumber?: unknown; polygon?: unknown }) => {
    const { surahNumber: surah, ayahNumber: ayah, polygon } = entry ?? {};
    if (typeof surah !== 'number' || typeof ayah !== 'number' || typeof polygon !== 'string' || !isExistingAyah(surah, ayah)) {
      throw new MushafPageError('Page maps an ayah that does not exist');
    }
    const verseKey = `${surah}:${ayah}`;
    if (seen.has(verseKey)) throw new MushafPageError('Page maps an ayah twice');
    if (previous && (surah < previous.surah || (surah === previous.surah && ayah <= previous.ayah))) {
      throw new MushafPageError('Page ayahs are out of reading order');
    }
    seen.add(verseKey);
    previous = { surah, ayah };
    return { verseKey, surah, ayah, rects: polygonToRects(polygon), path: polygonToPath(polygon) };
  });
  return { page: source.page, viewBox: readViewBox(source.svg), ayahs };
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * The ayah at a point in page coordinates, or null (margins, outside the
 * text block). Where two ayahs' line fragments share an edge, the earlier
 * ayah in reading order wins, so a tap is never ambiguous.
 */
export function ayahAtPoint(page: MushafPage, x: number, y: number): MushafAyah | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return page.ayahs.find((ayah) => ayah.rects.some((rect) => contains(rect, x, y))) ?? null;
}

/** A tap on the rendered page (points, from its top-left) → page coordinates. */
export function toPageCoordinates(page: MushafPage, renderedWidth: number, renderedHeight: number, tapX: number, tapY: number) {
  return {
    x: page.viewBox.x + (tapX / renderedWidth) * page.viewBox.width,
    y: page.viewBox.y + (tapY / renderedHeight) * page.viewBox.height,
  };
}

/**
 * Tints only the ayah-number medallions (`ayah-mark-ornament` groups) —
 * the reference print shows them in green. The Quran text and the ayah
 * numbers keep their original paths and ink.
 */
export function tintAyahMarkers(svg: string, color: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new MushafPageError('Invalid marker colour');
  return svg.replace(/(<g class="ayah-mark-ornament"[^>]*>\s*<path\b[^>]*?\bfill=")#231f20(")/g, `$1${color}$2`);
}

/**
 * Recolours the page's ink (every remaining `fill="#231f20"`: the words and
 * the ayah numbers) for a dark page. Run after tintAyahMarkers, so the
 * medallions keep their own colour. Only the fill value changes; every
 * path, and so every glyph shape, is untouched.
 */
export function tintSvgInk(svg: string, color: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new MushafPageError('Invalid ink colour');
  return svg.replace(/fill="#231f20"/g, `fill="${color}"`);
}

// Juz' starts from Tanzil quran-data.xml (tools/quran-verification/input),
// the verified source the app's other reference data comes from.
const JUZ_STARTS: readonly (readonly [number, number])[] = [
  [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111], [7, 88], [8, 41],
  [9, 93], [11, 6], [12, 53], [15, 1], [17, 1], [18, 75], [21, 1], [23, 1], [25, 21], [27, 56],
  [29, 46], [33, 31], [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1], [67, 1], [78, 1],
];

export function juzOfAyah(surah: number, ayah: number): number {
  let juz = 1;
  JUZ_STARTS.forEach(([startSurah, startAyah], index) => {
    if (surah > startSurah || (surah === startSurah && ayah >= startAyah)) juz = index + 1;
  });
  return juz;
}

/** As printed in a Mushaf header: الجزء الأول … الجزء الثلاثون. */
const JUZ_ORDINALS = [
  'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
  'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون',
  'الحادي والعشرون', 'الثاني والعشرون', 'الثالث والعشرون', 'الرابع والعشرون', 'الخامس والعشرون',
  'السادس والعشرون', 'السابع والعشرون', 'الثامن والعشرون', 'التاسع والعشرون', 'الثلاثون',
] as const;

export function juzTitle(juz: number): string {
  if (!Number.isInteger(juz) || juz < 1 || juz > 30) throw new MushafPageError('Invalid juz');
  return `الجزء ${JUZ_ORDINALS[juz - 1]}`;
}

/** Page numbers are printed in Arabic-Indic digits (٦١). */
export function toArabicIndicDigits(value: number): string {
  return String(value).replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
}
