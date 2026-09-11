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

describe('Phase 5B Batch 3 human-review artifact', () => {
  const candidates = loadJson<CandidateRow[]>('phase5b-batch3-candidates.json');
  const humanReview = loadJson<{
    artifact: string;
    candidateSource: string;
    originalCandidateCount: number;
    decisionCounts: { keep: number; reject: number; hold: number };
    reviews: ReviewRow[];
    supplementalReviews: (ReviewRow & { note?: string; source?: string })[];
  }>('phase5b-batch3-human-review.json');

  it('has exactly 76 original candidates, all reviewed exactly once', () => {
    expect(candidates).toHaveLength(76);
    expect(humanReview.originalCandidateCount).toBe(76);
    expect(humanReview.reviews).toHaveLength(76);
    expect(findDuplicatePairs(humanReview.reviews)).toEqual([]);
  });

  it('core review pair set exactly equals the Batch 3 candidate pair set', () => {
    const candidatePairs = new Set(candidates.map(pairKey));
    const reviewPairs = new Set(humanReview.reviews.map(pairKey));

    expect(reviewPairs.size).toBe(candidatePairs.size);
    candidatePairs.forEach((key) => expect(reviewPairs.has(key)).toBe(true));
    reviewPairs.forEach((key) => expect(candidatePairs.has(key)).toBe(true));
  });

  it('has exactly the expected 74/2/0 decision counts', () => {
    expect(humanReview.decisionCounts).toEqual({ keep: 74, reject: 2, hold: 0 });

    const actualCounts = humanReview.reviews.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      { keep: 0, reject: 0, hold: 0 },
    );

    expect(actualCounts).toEqual({ keep: 74, reject: 2, hold: 0 });
  });

  it('rejects exactly 64:14+angry and 2:222+repentant, nothing else', () => {
    const rejected = humanReview.reviews
      .filter((row) => row.decision === 'reject')
      .map(pairKey)
      .sort();

    expect(rejected).toEqual(['2:222|repentant', '64:14|angry'].sort());
  });

  it('uses only canonical emotion keys and verified verse keys in core reviews', () => {
    const badVerseKeys = humanReview.reviews.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = humanReview.reviews.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('keeps supplemental reviews disjoint from the original 76 and free of internal duplicates', () => {
    const corePairs = new Set(candidates.map(pairKey));
    const overlapWithCore = humanReview.supplementalReviews.filter((row) => corePairs.has(pairKey(row)));

    expect(overlapWithCore).toEqual([]);
    expect(findDuplicatePairs(humanReview.supplementalReviews)).toEqual([]);
  });

  it('uses only canonical emotion keys and verified verse keys in supplemental reviews', () => {
    const badVerseKeys = humanReview.supplementalReviews.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = humanReview.supplementalReviews.filter(
      (row) => !canonicalEmotionKeys.has(row.emotionKey),
    );

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('gives 39:64 a supplemental reject for every emotion it was considered under, and never a keep', () => {
    const rows39_64 = humanReview.supplementalReviews.filter((row) => row.verseKey === '39:64');
    expect(rows39_64.every((row) => row.decision === 'reject')).toBe(true);
    expect(rows39_64.map((row) => row.emotionKey).sort()).toEqual(
      ['afraid', 'closer_to_allah', 'guilty', 'repentant', 'seeking_guidance', 'strength'].sort(),
    );
  });

  it('never adds 39:75 to supplemental reviews (discussed but not accepted)', () => {
    expect(humanReview.supplementalReviews.some((row) => row.verseKey === '39:75')).toBe(false);
  });

  it('gives 39:67 a supplemental keep for every current canonical emotion key, and no key is skipped', () => {
    const rows39_67 = humanReview.supplementalReviews.filter((row) => row.verseKey === '39:67');
    expect(rows39_67).toHaveLength(canonicalEmotionKeys.size);
    expect(rows39_67.every((row) => row.decision === 'keep')).toBe(true);
    expect(new Set(rows39_67.map((row) => row.emotionKey))).toEqual(canonicalEmotionKeys);
  });

  it('never stores Quran Arabic or the literal candidate/rationale text fields', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'phase5b-batch3-human-review.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);

    [...humanReview.reviews, ...humanReview.supplementalReviews].forEach((row) => {
      expect(row).not.toHaveProperty('arabicText');
      expect(row).not.toHaveProperty('translation');
    });
  });
});

describe('Phase 5B Batch 3 overlap-candidate artifact', () => {
  const overlap = loadJson<OverlapRow[]>('phase5b-batch3-overlap-candidates.json');

  it('is deduped by verseKey + emotionKey', () => {
    expect(findDuplicatePairs(overlap)).toEqual([]);
  });

  it('uses only canonical emotion keys and verified verse keys', () => {
    const badVerseKeys = overlap.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = overlap.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('never overlaps with the 76 Batch 3 candidates it was derived from', () => {
    const candidates = loadJson<CandidateRow[]>('phase5b-batch3-candidates.json');
    const candidatePairs = new Set(candidates.map(pairKey));
    const collisions = overlap.filter((row) => candidatePairs.has(pairKey(row)));

    expect(collisions).toEqual([]);
  });

  it('never overlaps with Batch 1 or Batch 2 candidates, or prior overlap artifacts', () => {
    const priorPairSets = [
      loadJson<CandidateRow[]>('phase5b-batch1-candidates.json'),
      loadJson<CandidateRow[]>('phase5b-batch2-candidates.json'),
      loadJson<CandidateRow[]>('phase5b-overlap-candidates.json'),
      loadJson<CandidateRow[]>('phase5b-batch2-overlap-candidates.json'),
    ].flat();
    const priorPairs = new Set(priorPairSets.map(pairKey));
    const collisions = overlap.filter((row) => priorPairs.has(pairKey(row)));

    expect(collisions).toEqual([]);
  });

  it('never overlaps with the Batch 3 supplemental human-review pairs', () => {
    const humanReview = loadJson<{ supplementalReviews: ReviewRow[] }>('phase5b-batch3-human-review.json');
    const supplementalPairs = new Set(humanReview.supplementalReviews.map(pairKey));
    const collisions = overlap.filter((row) => supplementalPairs.has(pairKey(row)));

    expect(collisions).toEqual([]);
  });

  it('never overlaps with an existing MVP (development) mapping', () => {
    const mvpPairs = new Set(
      seedAyahs.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`)),
    );
    const collisions = overlap.filter((row) => mvpPairs.has(pairKey(row)));

    expect(collisions).toEqual([]);
  });

  it('records provenance (sourceEmotionKeys) for every row and never stores Quran text', () => {
    overlap.forEach((row) => {
      expect(Array.isArray(row.sourceEmotionKeys)).toBe(true);
      expect(row).not.toHaveProperty('arabicText');
      expect(row).not.toHaveProperty('translation');
    });

    const raw = readFileSync(resolve(DATA_DIR, 'phase5b-batch3-overlap-candidates.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);
  });
});
