import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isValidVerseKey } from '../../../src/quran/referenceKeys';
import { seedAyahs } from '../../../src/seed/ayahs';
import { seedEmotions } from '../../../src/seed/emotions';

const DATA_DIR = resolve(__dirname, '../../../data/emotion-candidates');

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, fileName), 'utf-8')) as T;
}

type CandidateRow = {
  verseKey: string;
  emotionKey: string;
  rationale: string;
  contextNotes?: string;
  source: string;
};

type ReviewRow = { verseKey: string; emotionKey: string };
type HumanReviewFile = { reviews: ReviewRow[]; supplementalReviews: ReviewRow[] };

const BATCH4_EMOTIONS = ['sad', 'lonely', 'stressed', 'hopeless', 'tired', 'want_to_cry', 'rejected'];
const arabicPattern = /[؀-ۿ]/;
const canonicalEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

describe('Phase 5B Batch 4 candidate artifact', () => {
  const candidates = loadJson<CandidateRow[]>('batches/batch-4/initial-candidates.json');

  it('parses as a non-empty array', () => {
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('contains only the seven Batch 4 emotion keys', () => {
    const usedKeys = new Set(candidates.map((row) => row.emotionKey));
    usedKeys.forEach((key) => expect(BATCH4_EMOTIONS).toContain(key));
  });

  it('uses only canonical emotion keys and verified verse keys', () => {
    const badVerseKeys = candidates.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = candidates.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('has 0 duplicate verseKey + emotionKey pairs', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    candidates.forEach((row) => {
      const key = pairKey(row);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    });

    expect(duplicates).toEqual([]);
  });

  it('excludes every pair that already received a direct human decision (Batch 1-3 core + supplemental)', () => {
    const batch1 = loadJson<HumanReviewFile>('batches/batch-1/final-review.json');
    const batch2 = loadJson<HumanReviewFile>('batches/batch-2/final-review.json');
    const batch3 = loadJson<HumanReviewFile>('batches/batch-3/final-review.json');

    const directlyReviewedPairs = new Set<string>();
    [batch1, batch2, batch3].forEach((hr) => {
      hr.reviews.forEach((row) => directlyReviewedPairs.add(pairKey(row)));
      hr.supplementalReviews.forEach((row) => directlyReviewedPairs.add(pairKey(row)));
    });

    const collisions = candidates.filter((row) => directlyReviewedPairs.has(pairKey(row)));
    expect(collisions).toEqual([]);
  });

  it('excludes every pair that is already an existing MVP (development) mapping', () => {
    const mvpPairs = new Set(
      seedAyahs.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`)),
    );
    const collisions = candidates.filter((row) => mvpPairs.has(pairKey(row)));

    expect(collisions).toEqual([]);
  });

  it('never stores Quran Arabic or a full translation, and carries no review/status field', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'batches/batch-4/initial-candidates.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);

    candidates.forEach((row) => {
      expect(row).not.toHaveProperty('arabicText');
      expect(row).not.toHaveProperty('translation');
      expect(row).not.toHaveProperty('decision');
      expect(row).not.toHaveProperty('status');
      expect(row).not.toHaveProperty('keep');
      expect(row).not.toHaveProperty('reject');
      expect(row).not.toHaveProperty('hold');
    });
  });

  it('gives every row a non-empty rationale and source label', () => {
    candidates.forEach((row) => {
      expect(typeof row.rationale).toBe('string');
      expect(row.rationale.length).toBeGreaterThan(0);
      expect(row.source).toBe('phase5b-batch4-candidate-review');
    });
  });

  it('has deterministic candidate counts by emotion', () => {
    const counts = candidates.reduce<Record<string, number>>((acc, row) => {
      acc[row.emotionKey] = (acc[row.emotionKey] ?? 0) + 1;
      return acc;
    }, {});

    // Locks the counts produced by candidate generation so a future edit to
    // this file must consciously update this test rather than silently
    // drift. Not a claim about review outcomes - these are all unreviewed.
    expect(counts).toEqual({
      sad: 18,
      lonely: 14,
      stressed: 9,
      hopeless: 26,
      tired: 14,
      want_to_cry: 24,
      rejected: 25,
    });
    expect(candidates.length).toBe(130);
  });
});
