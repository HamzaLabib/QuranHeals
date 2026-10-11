import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiBaseUrl } from '@/services/apiBase';
import { fetchWithTimeout } from '@/services/fetchWithTimeout';
import { isExistingAyah } from '@/utils/ayahLink';
import referencePage061 from './referencePage061.json';

/**
 * QPC V1 (1405 AH Madani Mushaf) page layout, as served by our backend
 * (backend/src/mushaf/qpcV1Layout.ts) from the Quran Foundation Content
 * API: which QCF V1 glyph is each word, on which line, in which ayah.
 *
 * Quran Foundation content: kept on the device only until the server's
 * `keepUntil` (never more than 7 days after it was fetched), then deleted.
 * Glyph codes are rendered with the matching page font only.
 */

export type QpcV1Word = { verseKey: string; position: number; kind: 'word' | 'end' | 'mark'; glyph: string };
export type QpcV1Line = { line: number; words: QpcV1Word[] };
export type QpcV1PageLayout = {
  page: number;
  edition: 'qpc-v1';
  fontFamily: string;
  lines: QpcV1Line[];
  verseKeys: string[];
  fetchedAt: string;
  keepUntil: string;
};

export const QPC_V1_MAX_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const qpcV1CacheKey = (page: number) => `quran-heals:mushaf-qpc-v1-layout:v1:page-${page}`;

export class QpcV1LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QpcV1LayoutError';
  }
}

const KINDS = new Set(['word', 'end', 'mark']);

/** Re-validates a layout on the device; throws rather than render anything doubtful. */
export function parseQpcV1PageLayout(raw: unknown, page: number): QpcV1PageLayout {
  const layout = raw as Partial<QpcV1PageLayout> | null;
  if (!layout || layout.page !== page || layout.edition !== 'qpc-v1' || layout.fontFamily !== `QCF_P${String(page).padStart(3, '0')}`) {
    throw new QpcV1LayoutError('Not the requested QPC V1 page');
  }
  const fetchedAt = Date.parse(String(layout.fetchedAt));
  const keepUntil = Date.parse(String(layout.keepUntil));
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(keepUntil) || keepUntil <= fetchedAt || keepUntil - fetchedAt > QPC_V1_MAX_KEEP_MS) {
    throw new QpcV1LayoutError('Invalid retention window');
  }
  if (!Array.isArray(layout.lines) || layout.lines.length === 0 || !Array.isArray(layout.verseKeys)) throw new QpcV1LayoutError('No lines');
  let previousLine = 0;
  const seen: string[] = [];
  for (const line of layout.lines) {
    if (!Number.isInteger(line?.line) || line.line <= previousLine || line.line > 15 || !Array.isArray(line.words) || line.words.length === 0) {
      throw new QpcV1LayoutError('Invalid line');
    }
    previousLine = line.line;
    for (const word of line.words) {
      const [surah, ayah] = String(word?.verseKey).split(':').map(Number);
      if (!isExistingAyah(surah, ayah) || !KINDS.has(word.kind) || typeof word.glyph !== 'string' || word.glyph.length === 0 || !Number.isInteger(word.position)) {
        throw new QpcV1LayoutError('Invalid word');
      }
      if (seen[seen.length - 1] !== word.verseKey) seen.push(word.verseKey);
    }
  }
  if (seen.join() !== layout.verseKeys.join()) throw new QpcV1LayoutError('Verse list does not match the words');
  return layout as QpcV1PageLayout;
}

/**
 * Cached copy if still within its retention window, otherwise a fresh one
 * from our backend. An expired copy is deleted, never shown.
 */
export async function loadQpcV1PageLayout(page: number, options: { now?: () => number; fetchImpl?: typeof fetchWithTimeout } = {}): Promise<QpcV1PageLayout> {
  const now = options.now ?? Date.now;
  const key = qpcV1CacheKey(page);
  let stored = false;
  let cached: QpcV1PageLayout | null = null;
  try {
    const raw = await AsyncStorage.getItem(key);
    stored = raw !== null;
    if (raw) cached = parseQpcV1PageLayout(JSON.parse(raw), page);
  } catch {
    cached = null;
  }
  if (cached && Date.parse(cached.keepUntil) > now()) return cached;
  // Expired or unreadable: deleted, never shown.
  if (stored) await AsyncStorage.removeItem(key).catch(() => undefined);

  const response = await (options.fetchImpl ?? fetchWithTimeout)(`${apiBaseUrl}/api/mushaf/qpc-v1/pages/${page}`, { headers: { Accept: 'application/json' } }, 10_000);
  if (!response.ok) throw new QpcV1LayoutError(`Layout unavailable (${response.status})`);
  const body = (await response.json()) as { success?: boolean; data?: unknown };
  const layout = parseQpcV1PageLayout(body?.data, page);
  if (Date.parse(layout.keepUntil) <= now()) throw new QpcV1LayoutError('Layout already expired');
  await AsyncStorage.setItem(key, JSON.stringify(layout)).catch(() => undefined);
  return layout;
}

// ---------------------------------------------------------------------------
// Verification against the app's verified Tanzil text

/** Standalone pause marks are separate tokens in Tanzil but not words. */
const PAUSE_MARK = /^[ۖ-ۜ۞۩]+$/;

export function tanzilWordCount(arabicText: string): number {
  return arabicText.trim().split(/\s+/).filter((token) => !PAUSE_MARK.test(token)).length;
}

export type TanzilCheck = { ok: boolean; problems: string[] };

/**
 * Before rendering: the page must hold exactly the expected ayahs, and each
 * ayah exactly as many words as the verified Tanzil text, plus its marker.
 */
export function checkAgainstTanzil(layout: QpcV1PageLayout, expectedVerseKeys: readonly string[], tanzilText: Readonly<Record<string, string>>): TanzilCheck {
  const problems: string[] = [];
  if (layout.verseKeys.join() !== expectedVerseKeys.join()) problems.push(`Ayahs ${layout.verseKeys.join(', ')} ≠ expected ${expectedVerseKeys.join(', ')}`);
  const words = layout.lines.flatMap((line) => line.words);
  for (const verseKey of expectedVerseKeys) {
    const own = words.filter((word) => word.verseKey === verseKey);
    const wordCount = own.filter((word) => word.kind === 'word').length;
    const expected = tanzilText[verseKey] === undefined ? Number.NaN : tanzilWordCount(tanzilText[verseKey]);
    if (wordCount !== expected) problems.push(`${verseKey}: ${wordCount} words, Tanzil has ${expected}`);
    if (own.filter((word) => word.kind === 'end').length !== 1 || own[own.length - 1]?.kind !== 'end') problems.push(`${verseKey}: ayah marker missing or misplaced`);
  }
  return { ok: problems.length === 0, problems };
}

/** Page 61 as printed in Reference Design.jpg — see referencePage061.json (shared with tools/mushaf/verify-qpc-v1-page.mjs). */
export const REFERENCE_PAGE_61 = {
  lineStarts: referencePage061.lineStarts as [string, number][],
  markerLines: referencePage061.markerLines as Record<string, number>,
};

/** Where each line starts and each marker sits, in the same (ayah, Tanzil word number) terms. */
export function describeLineBreaks(layout: QpcV1PageLayout) {
  const counters: Record<string, number> = {};
  const lineStarts: [string, number][] = [];
  const markerLines: Record<string, number> = {};
  for (const line of layout.lines) {
    let started = false;
    for (const word of line.words) {
      if (word.kind === 'word') {
        counters[word.verseKey] = (counters[word.verseKey] ?? 0) + 1;
        if (!started) lineStarts.push([word.verseKey, counters[word.verseKey]]);
        started = true;
      } else if (word.kind === 'end') {
        markerLines[word.verseKey] = line.line;
        if (!started) lineStarts.push([word.verseKey, (counters[word.verseKey] ?? 0) + 1]);
        started = true;
      }
    }
  }
  return { lineCount: layout.lines.length, lineStarts, markerLines };
}

// ---------------------------------------------------------------------------
// Interaction

export type WordBox = { x: number; width: number; verseKey: string };

/**
 * The ayah under a tap at `x` on one line (boxes from the rendered words).
 * On a word: its ayah. In the gap between two words: their ayah if they
 * share it, otherwise the nearer word's. Outside the line's words (the
 * margins): nothing.
 */
export function ayahAtLineX(boxes: readonly WordBox[], x: number): string | null {
  if (boxes.length === 0 || !Number.isFinite(x)) return null;
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  const left = sorted[0].x;
  const right = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
  if (x < left || x > right) return null;
  for (let index = 0; index < sorted.length; index += 1) {
    const box = sorted[index];
    if (x >= box.x && x <= box.x + box.width) return box.verseKey;
    const next = sorted[index + 1];
    if (next && x > box.x + box.width && x < next.x) {
      if (box.verseKey === next.verseKey) return box.verseKey;
      return x - (box.x + box.width) <= next.x - x ? box.verseKey : next.verseKey;
    }
  }
  return null;
}

/** One highlight span per line covering the selected ayah's words on it, gaps between them included. */
export function highlightSpan(boxes: readonly WordBox[], verseKey: string): { x: number; width: number } | null {
  const own = boxes.filter((box) => box.verseKey === verseKey);
  if (own.length === 0) return null;
  const x = Math.min(...own.map((box) => box.x));
  const end = Math.max(...own.map((box) => box.x + box.width));
  return { x, width: end - x };
}
