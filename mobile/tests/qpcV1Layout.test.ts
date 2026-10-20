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
  lineAtY,
  loadQpcV1PageLayout,
  parseQpcV1PageLayout,
  QPC_V1_MAX_KEEP_MS,
  qpcV1CacheKey,
  QpcV1LayoutError,
  REFERENCE_PAGE_61,
  selectionSpan,
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

  // These two tests run on their own clock, so they pin when the layout was fetched.
  const FETCHED_AT = '2026-10-11T08:00:00.000Z';

  it('fetches from our backend (never Quran Foundation directly) and caches until keepUntil', async () => {
    const now = Date.parse('2026-10-11T09:00:00Z');
    const fetchImpl = vi.fn(async (_url: string) => jsonResponse(200, { success: true, data: syntheticQpcPage61({ fetchedAt: FETCHED_AT }) }));
    const first = await loadQpcV1PageLayout(61, { now: () => now, fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/api\/mushaf\/qpc-v1\/pages\/61$/);
    expect(String(fetchImpl.mock.calls[0][0])).not.toMatch(/quran\.foundation/);
    expect(first.lines).toHaveLength(15);
    expect(storage.has(qpcV1CacheKey(61))).toBe(true);
    await loadQpcV1PageLayout(61, { now: () => now + 3600_000, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('an expired cached copy is deleted and never shown; a failed fetch then fails cleanly', async () => {
    storage.set(qpcV1CacheKey(61), JSON.stringify(syntheticQpcPage61({ fetchedAt: FETCHED_AT })));
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

  // Word gaps 30, 20, 10, 20: half the mean gap is 10 (the padding at a line's edge).
  it('the highlight spans the ayah`s words and gaps, halfway into the gap to the next ayah, half a word gap at the line edges', () => {
    expect(selectionSpan(boxes, '3:84')).toEqual({ x: 210, width: 130 }); // 210 = halfway between 3:85 (200) and the marker (220); line edge: no room
    expect(selectionSpan(boxes, '3:84', 16)).toEqual({ x: 210, width: 140 }); // + half a word gap past the line's edge
    expect(selectionSpan(boxes, '3:85', 16)).toEqual({ x: 50, width: 160 });
    expect(selectionSpan(boxes, '3:86')).toBeNull();
  });

  it('the span covers its end words` ink, but never reaches into a neighbouring ayah`s word', () => {
    const inked = boxes.map((box) => (box.x === 220 ? { ...box, inkLeft: 15 } : box.x === 300 ? { ...box, inkRight: 25 } : box));
    expect(selectionSpan(inked, '3:84', 16)).toEqual({ x: 205, width: 151 }); // medallion ink to 205 (past the midpoint); 300+40+16 at most
    const far = boxes.map((box) => (box.x === 220 ? { ...box, inkLeft: 40 } : box));
    expect(selectionSpan(far, '3:84')!.x).toBe(200); // stops at 3:85's word
    const neighbour = boxes.map((box) => (box.x === 150 ? { ...box, inkRight: 30 } : box));
    expect(selectionSpan(neighbour, '3:85')!.x + selectionSpan(neighbour, '3:85')!.width).toBe(220); // its own ink, up to the marker
  });

  it('a tap belongs to the line drawn nearest it (rows of 40, drawn 12 lower)', () => {
    const centre = (line: number) => (line - 1) * 40 + 20 + 12;
    expect(lineAtY(2, 40 + 2, [1, 2, 3], centre)).toBe(1); // top of row 2: line 1's words are drawn there
    expect(lineAtY(2, 40 + 30, [1, 2, 3], centre)).toBe(2);
    expect(lineAtY(2, 40 + 2, [2, 3], centre)).toBe(2); // no line 1 (a heading row above)
    expect(lineAtY(5, 0, [1, 2, 3, 4, 5], centre)).toBe(4); // only the neighbouring lines
  });
});

describe('Surah openings pass the Tanzil check (Tanzil puts the Basmala in ayah 1; the Mushaf prints it on its own line)', () => {
  const text = (key: string) => (db.prepare('SELECT arabic_text AS t FROM verses WHERE verse_key = ?').get(key) as { t: string }).t;
  const basmala = text('1:1');
  const layoutFor = (verseKey: string, words: number) => ({
    page: 2, edition: 'qpc-v1' as const, fontFamily: 'QCF_P002', fetchedAt: '', keepUntil: '',
    verseKeys: [verseKey],
    lines: [{ line: 10, words: [...Array.from({ length: words }, (_, i) => ({ verseKey, position: i + 1, kind: 'word' as const, glyph: 'x' })), { verseKey, position: words + 1, kind: 'end' as const, glyph: 'e' }] }],
  });

  it('2:1 (الٓمٓ): one word in the Mushaf, five in Tanzil with its Basmala — accepted with the Basmala rule, refused without it', () => {
    expect(tanzilWordCount(text('2:1'))).toBe(5);
    expect(checkAgainstTanzil(layoutFor('2:1', 1), ['2:1'], { '2:1': text('2:1') }, basmala)).toEqual({ ok: true, problems: [] });
    expect(checkAgainstTanzil(layoutFor('2:1', 1), ['2:1'], { '2:1': text('2:1') }).ok).toBe(false); // the old count (pages with an opening failed on devices)
  });

  it('the Basmala is not subtracted where it is not a prefix: 1:1 itself and Surah 9 keep their own count', () => {
    expect(checkAgainstTanzil(layoutFor('1:1', 4), ['1:1'], { '1:1': basmala }, basmala).ok).toBe(true);
    const words91 = tanzilWordCount(text('9:1'));
    expect(checkAgainstTanzil(layoutFor('9:1', words91), ['9:1'], { '9:1': text('9:1') }, basmala).ok).toBe(true);
  });

  it('a wrong word count is still refused on an opening', () => {
    expect(checkAgainstTanzil(layoutFor('2:1', 2), ['2:1'], { '2:1': text('2:1') }, basmala).ok).toBe(false);
  });
});
