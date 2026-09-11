import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isValidVerseKey } from '../src/quran/referenceKeys';
import { seedAyahs } from '../src/seed/ayahs';
import { seedEmotions } from '../src/seed/emotions';

const DATA_DIR = resolve(__dirname, '../data/emotion-candidates');

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, fileName), 'utf-8')) as T;
}

type CandidateRow = { verseKey: string; emotionKey: string };
type ReviewRow = { verseKey: string; emotionKey: string; decision: 'keep' | 'reject' | 'hold' };
type OverlapRow = { verseKey: string; emotionKey: string; sourceEmotionKeys: string[] };

const arabicPattern = /[؀-ۿ]/;
const canonicalEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

function findDuplicatePairs(rows: { verseKey: string; emotionKey: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  rows.forEach((row) => {
    const key = pairKey(row);
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  });

  return duplicates;
}

describe('Phase 5B Batch 4 human-review artifact', () => {
  const candidates = loadJson<CandidateRow[]>('phase5b-batch4-candidates.json');
  const humanReview = loadJson<{
    artifact: string;
    candidateSource: string;
    originalCandidateCount: number;
    decisionCounts: { keep: number; reject: number; hold: number };
    reviews: ReviewRow[];
    supplementalReviews: (ReviewRow & { note?: string })[];
    unrecoverableOverlapSources: { note: string; pairs: CandidateRow[] };
  }>('phase5b-batch4-human-review.json');

  it('has exactly 130 original candidates, all reviewed exactly once', () => {
    expect(candidates).toHaveLength(130);
    expect(humanReview.originalCandidateCount).toBe(130);
    expect(humanReview.reviews).toHaveLength(130);
    expect(findDuplicatePairs(humanReview.reviews)).toEqual([]);
  });

  it('core review pair set exactly equals the Batch 4 candidate pair set', () => {
    const candidatePairs = new Set(candidates.map(pairKey));
    const reviewPairs = new Set(humanReview.reviews.map(pairKey));

    expect(reviewPairs.size).toBe(candidatePairs.size);
    candidatePairs.forEach((key) => expect(reviewPairs.has(key)).toBe(true));
    reviewPairs.forEach((key) => expect(candidatePairs.has(key)).toBe(true));
  });

  it('has exactly the expected 127/3/0 decision counts', () => {
    expect(humanReview.decisionCounts).toEqual({ keep: 127, reject: 3, hold: 0 });

    const actualCounts = humanReview.reviews.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      { keep: 0, reject: 0, hold: 0 },
    );

    expect(actualCounts).toEqual({ keep: 127, reject: 3, hold: 0 });
  });

  it('rejects exactly 3:173+sad, 3:103+lonely, and 7:200+rejected, nothing else', () => {
    const rejected = humanReview.reviews
      .filter((row) => row.decision === 'reject')
      .map(pairKey)
      .sort();

    expect(rejected).toEqual(['3:103|lonely', '3:173|sad', '7:200|rejected'].sort());
  });

  it('never leaves a Batch 4 pair on hold', () => {
    const holds = [...humanReview.reviews, ...humanReview.supplementalReviews].filter(
      (row) => row.decision === 'hold',
    );
    expect(holds).toEqual([]);
  });

  it('uses only canonical emotion keys and verified verse keys in core reviews', () => {
    const badVerseKeys = humanReview.reviews.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = humanReview.reviews.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('keeps supplemental reviews disjoint from the original 130 and free of internal duplicates', () => {
    const corePairs = new Set(candidates.map(pairKey));
    const overlapWithCore = humanReview.supplementalReviews.filter((row) => corePairs.has(pairKey(row)));

    expect(overlapWithCore).toEqual([]);
    expect(findDuplicatePairs(humanReview.supplementalReviews)).toEqual([]);
  });

  it('includes exactly the 11 explicitly approved supplemental KEEP pairs', () => {
    const pairs = humanReview.supplementalReviews.map(pairKey).sort();
    const expected = [
      '12:83|sad',
      '1:5|tired',
      '28:13|want_to_cry',
      '20:40|want_to_cry',
      '3:159|rejected',
      '13:11|rejected',
      '2:44|rejected',
      '61:2|rejected',
      '61:3|rejected',
      '16:125|rejected',
      '20:44|rejected',
    ].sort();

    expect(pairs).toEqual(expected);
    expect(humanReview.supplementalReviews.every((row) => row.decision === 'keep')).toBe(true);
  });

  it('uses only canonical emotion keys and verified verse keys in supplemental reviews', () => {
    const badVerseKeys = humanReview.supplementalReviews.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = humanReview.supplementalReviews.filter(
      (row) => !canonicalEmotionKeys.has(row.emotionKey),
    );

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('never duplicates an existing MVP (development) mapping in core or supplemental reviews', () => {
    const mvpPairs = new Set(
      seedAyahs.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`)),
    );
    const collisions = [...humanReview.reviews, ...humanReview.supplementalReviews].filter((row) =>
      mvpPairs.has(pairKey(row)),
    );

    expect(collisions).toEqual([]);
    // 2:286 -> stressed is a known existing MVP mapping and must stay that way, unduplicated.
    expect(mvpPairs.has('2:286|stressed')).toBe(true);
  });

  it('documents unrecoverable overlap sources instead of inventing them', () => {
    expect(Array.isArray(humanReview.unrecoverableOverlapSources.pairs)).toBe(true);
    expect(humanReview.unrecoverableOverlapSources.pairs.length).toBeGreaterThan(0);

    // Every listed pair must be a real core KEEP pair, and 2:186/50:16 (which
    // DO have recovered overlap sets) must not appear in this list.
    const keepPairs = new Set(
      humanReview.reviews.filter((row) => row.decision === 'keep').map(pairKey),
    );
    humanReview.unrecoverableOverlapSources.pairs.forEach((row) => {
      expect(keepPairs.has(pairKey(row))).toBe(true);
    });
    expect(humanReview.unrecoverableOverlapSources.pairs.some((row) => pairKey(row) === '2:186|lonely')).toBe(
      false,
    );
    expect(humanReview.unrecoverableOverlapSources.pairs.some((row) => pairKey(row) === '50:16|lonely')).toBe(
      false,
    );
  });

  it('never stores Quran Arabic or a full translation', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'phase5b-batch4-human-review.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);
  });
});

describe('Phase 5B Batch 4 overlap-candidate artifact', () => {
  const overlap = loadJson<OverlapRow[]>('phase5b-batch4-overlap-candidates.json');

  it('is deduped by verseKey + emotionKey', () => {
    expect(findDuplicatePairs(overlap)).toEqual([]);
  });

  it('uses only canonical emotion keys and verified verse keys', () => {
    const badVerseKeys = overlap.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = overlap.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('never proposes a pair that already has a direct Batch 1-4 human decision', () => {
    const batch1 = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(
      'phase5b-batch1-human-review.json',
    );
    const batch2 = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(
      'phase5b-batch2-human-review.json',
    );
    const batch3 = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(
      'phase5b-batch3-human-review.json',
    );
    const batch4 = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(
      'phase5b-batch4-human-review.json',
    );

    const directPairs = new Set<string>();
    [batch1, batch2, batch3, batch4].forEach((hr) => {
      hr.reviews.forEach((row) => directPairs.add(pairKey(row)));
      hr.supplementalReviews.forEach((row) => directPairs.add(pairKey(row)));
    });

    const collisions = overlap.filter((row) => directPairs.has(pairKey(row)));
    expect(collisions).toEqual([]);
  });

  it('never overlaps with an existing MVP (development) mapping', () => {
    const mvpPairs = new Set(
      seedAyahs.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`)),
    );
    const collisions = overlap.filter((row) => mvpPairs.has(pairKey(row)));

    expect(collisions).toEqual([]);
  });

  it('preserves the explicit 2:186 -> all-other-canonical-emotions decision', () => {
    const rows2_186 = overlap.filter((row) => row.verseKey === '2:186');
    const emotions = new Set(rows2_186.map((row) => row.emotionKey));

    // `lonely` is the already-decided core pair, not an overlap destination.
    expect(emotions.has('lonely')).toBe(false);

    // Every canonical emotion other than `lonely` must be either proposed
    // here, or already directly decided elsewhere (reassurance, closer_to_allah).
    const alreadyDirectlyDecided = new Set(['reassurance', 'closer_to_allah']);
    canonicalEmotionKeys.forEach((key) => {
      if (key === 'lonely') return;
      const accountedFor = emotions.has(key) || alreadyDirectlyDecided.has(key);
      expect(accountedFor, `2:186 -> ${key} missing from overlap and not already decided`).toBe(true);
    });
  });

  it('records provenance (sourceEmotionKeys) for every row and never stores Quran text', () => {
    overlap.forEach((row) => {
      expect(Array.isArray(row.sourceEmotionKeys)).toBe(true);
      expect(row.sourceEmotionKeys.length).toBeGreaterThan(0);
      expect(row).not.toHaveProperty('arabicText');
      expect(row).not.toHaveProperty('translation');
    });

    const raw = readFileSync(resolve(DATA_DIR, 'phase5b-batch4-overlap-candidates.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);
  });
});
