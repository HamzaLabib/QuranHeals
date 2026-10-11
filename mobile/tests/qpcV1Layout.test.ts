/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { syntheticQpcPage61, TANZIL_WORD_COUNTS_3_84_TO_91 } from './helpers/syntheticQpcPage61';

/** QPC V1 page layout on the device: validation, ≤ 7-day caching, Tanzil check, reference line breaks, taps. */

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
  },
}));

const {
  ayahAtLineX,
  checkAgainstTanzil,
  describeLineBreaks,
  highlightSpan,
  loadQpcV1PageLayout,
  parseQpcV1PageLayout,
  QPC_V1_MAX_KEEP_MS,
  qpcV1CacheKey,
  QpcV1LayoutError,
  REFERENCE_PAGE_61,
  tanzilWordCount,
} = await import('@/mushaf/qpcV1Layout');

const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
afterAll(() => db.close());
const tanzil = Object.fromEntries(Object.keys(TANZIL_WORD_COUNTS_3_84_TO_91).map((key) => [key, (db.prepare('SELECT arabic_text AS t FROM verses WHERE verse_key = ?').get(key) as { t: string }).t]));
const PAGE_61 = Object.keys(TANZIL_WORD_COUNTS_3_84_TO_91);

const jsonResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

beforeEach(() => storage.clear());

describe('the reference page 61 (our transcription of Reference Design.jpg)', () => {
  it('has 15 lines whose first words are real Tanzil words, in reading order', () => {
    const tokens = (key: string) => tanzil[key].split(' ').filter((token) => !/^[ۖ-ۜ۞۩]+$/.test(token));
    expect(REFERENCE_PAGE_61.lineStarts).toHaveLength(15);
    const firstWords = REFERENCE_PAGE_61.lineStarts.map(([key, word]) => tokens(key)[word - 1]);
    // Exact strings from the verified database (combining-mark order matters).
    expect(firstWords).toEqual([
      'قُلْ', 'وَإِسْمَـٰعِيلَ', 'مُوسَىٰ', 'مِّنْهُمْ', 'دِينًا', 'كَيْفَ', 'أَنَّ', 'ٱلظَّـٰلِمِينَ',
      'وَٱلْمَلَـٰٓئِكَةِ', 'عَنْهُمُ', 'بَعْدِ', 'كَفَرُوا۟', 'وَأُو۟لَـٰٓئِكَ', 'كُفَّارٌ', 'ٱفْتَدَىٰ',
    ]);
  });

  it('Tanzil word counts for 3:84–3:91 (pause marks are not words)', () => {
    for (const [key, count] of Object.entries(TANZIL_WORD_COUNTS_3_84_TO_91)) expect(tanzilWordCount(tanzil[key]), key).toBe(count);
  });
});

describe('verification before rendering', () => {
  it('a layout with the reference line breaks and Tanzil word counts passes; its breaks match the reference exactly', () => {
    const layout = syntheticQpcPage61();
    expect(checkAgainstTanzil(layout, PAGE_61, tanzil)).toEqual({ ok: true, problems: [] });
    const breaks = describeLineBreaks(layout);
    expect(breaks.lineCount).toBe(15);
    expect(breaks.lineStarts).toEqual(REFERENCE_PAGE_61.lineStarts.map(([key, word]) => [key, word]));
    expect(breaks.markerLines).toEqual(REFERENCE_PAGE_61.markerLines);
  });

  it('a missing word, a missing ayah or a misplaced marker is caught', () => {
    expect(checkAgainstTanzil(syntheticQpcPage61({ dropWord: '3:88' }), PAGE_61, tanzil).problems).toEqual(['3:88: 8 words, Tanzil has 9']);
    const layout = syntheticQpcPage61();
    expect(checkAgainstTanzil(layout, [...PAGE_61, '3:92'], tanzil).ok).toBe(false);
    const misplaced = syntheticQpcPage61();
    const line4 = misplaced.lines[3].words;
    const marker = line4.findIndex((word) => word.kind === 'end');
    [line4[marker - 1], line4[marker]] = [line4[marker], line4[marker - 1]];
    expect(checkAgainstTanzil(misplaced, PAGE_61, tanzil).problems.join()).toMatch(/3:84: ayah marker/);
  });
});

describe('device validation and retention', () => {
  it('accepts the server layout and rejects anything doubtful', () => {
    expect(parseQpcV1PageLayout(syntheticQpcPage61(), 61).page).toBe(61);
    expect(() => parseQpcV1PageLayout(syntheticQpcPage61(), 62)).toThrow(QpcV1LayoutError);
    expect(() => parseQpcV1PageLayout({ ...syntheticQpcPage61(), fontFamily: 'Arial' }, 61)).toThrow(QpcV1LayoutError);
    expect(() => parseQpcV1PageLayout(syntheticQpcPage61({ keepDays: 8 }), 61)).toThrow(QpcV1LayoutError); // > 7 days
    const badWord = syntheticQpcPage61();
    badWord.lines[0].words[0].verseKey = '3:201';
    expect(() => parseQpcV1PageLayout(badWord, 61)).toThrow(QpcV1LayoutError);
    expect(QPC_V1_MAX_KEEP_MS).toBe(7 * 24 * 3600 * 1000);
  });

  it('fetches from our backend (never Quran Foundation directly) and caches until keepUntil', async () => {
    const now = Date.parse('2026-10-11T09:00:00Z');
    const fetchImpl = vi.fn(async (_url: string) => jsonResponse(200, { success: true, data: syntheticQpcPage61() }));
    const first = await loadQpcV1PageLayout(61, { now: () => now, fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/api\/mushaf\/qpc-v1\/pages\/61$/);
    expect(String(fetchImpl.mock.calls[0][0])).not.toMatch(/quran\.foundation/);
    expect(first.lines).toHaveLength(15);
    expect(storage.has(qpcV1CacheKey(61))).toBe(true);
    await loadQpcV1PageLayout(61, { now: () => now + 3600_000, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('an expired cached copy is deleted and never shown; a failed fetch then fails cleanly', async () => {
    storage.set(qpcV1CacheKey(61), JSON.stringify(syntheticQpcPage61()));
    const after = Date.parse('2026-10-18T08:00:01Z');
    const failing = vi.fn(async () => jsonResponse(503, { success: false }));
    await expect(loadQpcV1PageLayout(61, { now: () => after, fetchImpl: failing })).rejects.toThrow(QpcV1LayoutError);
    expect(storage.has(qpcV1CacheKey(61))).toBe(false);
  });
});

describe('taps and highlights on a line', () => {
  // A line read right to left: 3:84's last words on the right, then its marker, then 3:85.
  const boxes = [
    { x: 300, width: 40, verseKey: '3:84' },
    { x: 250, width: 30, verseKey: '3:84' },
    { x: 220, width: 20, verseKey: '3:84' }, // marker
    { x: 150, width: 50, verseKey: '3:85' },
    { x: 60, width: 60, verseKey: '3:85' },
  ];

  it('a word, or the gap inside one ayah, selects that ayah; the gap between ayahs goes to the nearer word', () => {
    expect(ayahAtLineX(boxes, 320)).toBe('3:84');
    expect(ayahAtLineX(boxes, 290)).toBe('3:84'); // gap within 3:84
    expect(ayahAtLineX(boxes, 230)).toBe('3:84'); // the marker belongs to its ayah
    expect(ayahAtLineX(boxes, 215)).toBe('3:84'); // gap between ayahs (200–220), nearer 3:84
    expect(ayahAtLineX(boxes, 205)).toBe('3:85'); // same gap, nearer 3:85
    expect(ayahAtLineX(boxes, 130)).toBe('3:85');
  });

  it('beyond the first and last word (the margins) selects nothing', () => {
    expect(ayahAtLineX(boxes, 30)).toBeNull();
    expect(ayahAtLineX(boxes, 360)).toBeNull();
    expect(ayahAtLineX([], 100)).toBeNull();
  });

  it('the highlight spans the selected ayah`s words on the line, gaps between them included', () => {
    expect(highlightSpan(boxes, '3:84')).toEqual({ x: 220, width: 120 });
    expect(highlightSpan(boxes, '3:85')).toEqual({ x: 60, width: 140 });
    expect(highlightSpan(boxes, '3:86')).toBeNull();
  });
});
