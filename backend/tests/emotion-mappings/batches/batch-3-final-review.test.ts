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

type CandidateRow = { verseKey: string; emotionKey: string };
type ReviewRow = {
  verseKey: string;
  emotionKey: string;
  decision: 'keep' | 'reject' | 'hold';
  priorDecision?: 'keep' | 'reject' | 'hold';
  supersededBy?: string;
};
type OverlapRow = {
  verseKey: string;
  emotionKey: string;
  sourceEmotionKeys: string[];
  status?: 'excluded';
  excludedBy?: string;
};

// Verses the punishment/warning editorial correction removed from the Phase 5B
// pool at verse level, and the five reviewed alongside them that were kept.
const PUNISHMENT_EXCLUDED_VERSE_KEYS = [
  '15:50',
  '39:54',
  '39:55',
  '39:56',
  '39:57',
  '39:58',
  '39:59',
  '39:60',
  '39:65',
  '39:68',
  '39:71',
  '39:72',
  '40:18',
  '42:42',
  '46:35',
  '69:18',
  '69:25',
];
const PUNISHMENT_RETAINED_VERSE_KEYS = ['14:42', '40:16', '40:17', '40:19', '40:20'];

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
  const candidates = loadJson<CandidateRow[]>('batches/batch-3/initial-candidates.json');
  const humanReview = loadJson<{
    artifact: string;
    candidateSource: string;
    originalCandidateCount: number;
    decisionCounts: { keep: number; reject: number; hold: number };
    reviews: ReviewRow[];
    supplementalReviews: (ReviewRow & { note?: string; source?: string })[];
    editorialCorrections: {
      id: string;
      priorDecision: string;
      newDecision: string;
      excludedVerseKeys: string[];
      retainedVerseKeys: string[];
      changedPairsInThisArtifact: { reviews: string[]; supplementalReviews: string[] };
    }[];
  }>('batches/batch-3/final-review.json');

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

  it('has exactly the expected 69/7/0 decision counts after the punishment/warning correction', () => {
    // Was 74/2/0 at first review; the `phase5b-punishment-warning-exclusion`
    // editorial correction superseded 5 core `keep` rows to `reject`.
    expect(humanReview.decisionCounts).toEqual({ keep: 69, reject: 7, hold: 0 });

    const actualCounts = humanReview.reviews.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      { keep: 0, reject: 0, hold: 0 },
    );

    expect(actualCounts).toEqual({ keep: 69, reject: 7, hold: 0 });
  });

  it('rejects exactly the 2 original rejections plus the 5 superseded punishment/warning pairs', () => {
    const rejected = humanReview.reviews
      .filter((row) => row.decision === 'reject')
      .map(pairKey)
      .sort();

    expect(rejected).toEqual(
      [
        '2:222|repentant',
        '64:14|angry',
        '46:35|angry',
        '46:35|betrayed',
        '46:35|wronged',
        '42:42|wronged',
        '39:54|guilty',
      ].sort(),
    );
  });

  it('marks every superseded core row with its prior decision and the correction id', () => {
    const superseded = humanReview.reviews.filter((row) => row.supersededBy);

    expect(superseded.map(pairKey).sort()).toEqual(
      ['46:35|angry', '46:35|betrayed', '46:35|wronged', '42:42|wronged', '39:54|guilty'].sort(),
    );
    superseded.forEach((row) => {
      expect(row.supersededBy).toBe('phase5b-punishment-warning-exclusion');
      expect(row.priorDecision).toBe('keep');
      expect(row.decision).toBe('reject');
    });

    // The two original rejections were never `keep`, so they carry no history.
    const originalRejections = humanReview.reviews.filter(
      (row) => row.decision === 'reject' && !row.supersededBy,
    );
    expect(originalRejections.map(pairKey).sort()).toEqual(['2:222|repentant', '64:14|angry'].sort());
  });

  it('leaves no punishment/warning verseKey with a KEEP row, core or supplemental', () => {
    const stillKept = [...humanReview.reviews, ...humanReview.supplementalReviews].filter(
      (row) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(row.verseKey) && row.decision !== 'reject',
    );

    expect(stillKept).toEqual([]);
  });

  it('supersedes 117 supplemental rows and leaves the rest of the supplemental set alone', () => {
    const supplementalCounts = humanReview.supplementalReviews.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      { keep: 0, reject: 0, hold: 0 },
    );

    // Was 443 keep / 6 reject; 117 punishment/warning rows moved to `reject`.
    expect(supplementalCounts).toEqual({ keep: 326, reject: 123, hold: 0 });

    const superseded = humanReview.supplementalReviews.filter((row) => row.supersededBy);
    expect(superseded).toHaveLength(117);
    superseded.forEach((row) => {
      expect(PUNISHMENT_EXCLUDED_VERSE_KEYS).toContain(row.verseKey);
      expect(row.supersededBy).toBe('phase5b-punishment-warning-exclusion');
      expect(row.priorDecision).toBe('keep');
    });
  });

  it('keeps the 5 retained Ghafir/Ibrahim verses untouched by the correction', () => {
    const retained = [...humanReview.reviews, ...humanReview.supplementalReviews].filter((row) =>
      PUNISHMENT_RETAINED_VERSE_KEYS.includes(row.verseKey),
    );

    expect(retained.length).toBeGreaterThan(0);
    retained.forEach((row) => {
      expect(row.decision).toBe('keep');
      expect(row.supersededBy).toBeUndefined();
      expect(row.priorDecision).toBeUndefined();
    });

    // The associations the editorial decision explicitly called out as kept.
    const pairs = new Set(retained.map(pairKey));
    ['betrayed', 'wronged', 'angry', 'reassurance'].forEach((emotionKey) => {
      expect(pairs.has(`40:16|${emotionKey}`), `40:16 -> ${emotionKey} must stay kept`).toBe(true);
    });
  });

  it('records the punishment/warning correction without deleting review evidence', () => {
    const correction = humanReview.editorialCorrections.find(
      (row) => row.id === 'phase5b-punishment-warning-exclusion',
    );

    expect(correction).toBeDefined();
    expect(correction!.priorDecision).toBe('keep');
    expect(correction!.newDecision).toBe('reject');
    expect(correction!.excludedVerseKeys.slice().sort()).toEqual(PUNISHMENT_EXCLUDED_VERSE_KEYS.slice().sort());
    expect(correction!.retainedVerseKeys.slice().sort()).toEqual(PUNISHMENT_RETAINED_VERSE_KEYS.slice().sort());
    expect(correction!.changedPairsInThisArtifact.reviews).toHaveLength(5);
    expect(correction!.changedPairsInThisArtifact.supplementalReviews).toHaveLength(117);

    // Every pair the correction claims to have changed is still present as a
    // real, superseded row - nothing was dropped from the artifact.
    const supersededPairs = new Set(
      [...humanReview.reviews, ...humanReview.supplementalReviews]
        .filter((row) => row.supersededBy === 'phase5b-punishment-warning-exclusion')
        .map(pairKey),
    );
    [
      ...correction!.changedPairsInThisArtifact.reviews,
      ...correction!.changedPairsInThisArtifact.supplementalReviews,
    ].forEach((key) => expect(supersededPairs.has(key)).toBe(true));
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
    const raw = readFileSync(resolve(DATA_DIR, 'batches/batch-3/final-review.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);

    [...humanReview.reviews, ...humanReview.supplementalReviews].forEach((row) => {
      expect(row).not.toHaveProperty('arabicText');
      expect(row).not.toHaveProperty('translation');
    });
  });
});

describe('Phase 5B Batch 3 overlap-candidate artifact', () => {
  const overlap = loadJson<OverlapRow[]>('batches/batch-3/overlaps.json');

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
    const candidates = loadJson<CandidateRow[]>('batches/batch-3/initial-candidates.json');
    const candidatePairs = new Set(candidates.map(pairKey));
    const collisions = overlap.filter((row) => candidatePairs.has(pairKey(row)));

    expect(collisions).toEqual([]);
  });

  it('never overlaps with Batch 1 or Batch 2 candidates, or prior overlap artifacts', () => {
    const priorPairSets = [
      loadJson<CandidateRow[]>('batches/batch-1/initial-candidates.json'),
      loadJson<CandidateRow[]>('batches/batch-2/initial-candidates.json'),
      loadJson<CandidateRow[]>('batches/batch-1/overlaps.json'),
      loadJson<CandidateRow[]>('batches/batch-2/overlaps.json'),
    ].flat();
    const priorPairs = new Set(priorPairSets.map(pairKey));
    const collisions = overlap.filter((row) => priorPairs.has(pairKey(row)));

    expect(collisions).toEqual([]);
  });

  it('never overlaps with the Batch 3 supplemental human-review pairs', () => {
    const humanReview = loadJson<{ supplementalReviews: ReviewRow[] }>('batches/batch-3/final-review.json');
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

    const raw = readFileSync(resolve(DATA_DIR, 'batches/batch-3/overlaps.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);
  });

  it('excludes - but does not delete - every overlap row sourced from a superseded punishment/warning decision', () => {
    const punishmentRows = overlap.filter((row) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(row.verseKey));

    // Historical provenance is retained in place, never silently removed.
    expect(punishmentRows).toHaveLength(19);
    punishmentRows.forEach((row) => {
      expect(row.status).toBe('excluded');
      expect(row.excludedBy).toBe('phase5b-punishment-warning-exclusion');
      expect(Array.isArray(row.sourceEmotionKeys)).toBe(true);
      expect(row.sourceEmotionKeys.length).toBeGreaterThan(0);
    });

    // Nothing else in the artifact was excluded as collateral.
    const excluded = overlap.filter((row) => row.status === 'excluded');
    expect(excluded).toHaveLength(punishmentRows.length);
  });

  it('leaves the retained verses and the self-reflection verses active in the overlap pool', () => {
    const untouched = overlap.filter(
      (row) => PUNISHMENT_RETAINED_VERSE_KEYS.includes(row.verseKey) || row.verseKey === '3:159',
    );

    expect(untouched.length).toBeGreaterThan(0);
    untouched.forEach((row) => expect(row.status).toBeUndefined());
  });
});
