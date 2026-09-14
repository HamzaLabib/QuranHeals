import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isValidVerseKey } from '../../../src/quran/referenceKeys';
import { seedAyahs } from '../../../src/seed/ayahs';
import { seedEmotions } from '../../../src/seed/emotions';

// This suite locks in the Batch 5 human-review outcome (the final Phase 5B
// candidate batch: `forgiveness_struggle`, `weak`, `strength`, `hopeful`,
// `content`, `grateful`, `peaceful`). The REJECTED_CORE_PAIRS and
// SUPPLEMENTAL_KEEP_PAIRS tables below are transcribed directly from the
// human reviewer's decisions (not read back from the generated artifact), so
// this is a from-scratch reconstruction, not a self-comparison: it rebuilds
// the expected review rows from the 334-row candidate file plus these two
// tables, then diffs that reconstruction against
// batches/batch-5/final-review.json on disk.

const DATA_DIR = resolve(__dirname, '../../../data/emotion-candidates');

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, fileName), 'utf-8')) as T;
}

type CandidateRow = { verseKey: string; emotionKey: string };
type ReviewRow = {
  verseKey: string;
  emotionKey: string;
  decision: 'keep' | 'reject' | 'hold';
  supplemental?: boolean;
  freshDiscovery?: boolean;
};
type HumanReviewFile = {
  artifact: string;
  candidateSource: string;
  originalCandidateCount: number;
  decisionCounts: { keep: number; reject: number; hold: number };
  reviews: ReviewRow[];
  supplementalReviews: ReviewRow[];
};

const arabicPattern = /[؀-ۿ]/;
const canonicalEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));
const mvpPairs = new Set(
  seedAyahs.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`)),
);

const BATCH5_EMOTIONS = ['forgiveness_struggle', 'weak', 'strength', 'hopeful', 'content', 'grateful', 'peaceful'];

const REVIEW_FILES = [
  'batches/batch-1/final-review.json',
  'batches/batch-2/final-review.json',
  'batches/batch-3/final-review.json',
  'batches/batch-4/final-review.json',
] as const;

const PUNISHMENT_EXCLUDED_VERSE_KEYS = [
  '15:50', '39:54', '39:55', '39:56', '39:57', '39:58', '39:59', '39:60', '39:65', '39:68',
  '39:71', '39:72', '40:18', '42:42', '46:35', '69:18', '69:25',
];
const PUNISHMENT_RETAINED_VERSE_KEYS = ['14:42', '40:16', '40:17', '40:19', '40:20'];
const SELF_REFLECTION_HOLD_VERSE_KEYS = ['3:159', '13:11', '2:44', '61:2', '61:3', '16:125', '20:44'];

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

// ---------------------------------------------------------------------------
// Ground truth, transcribed directly from the human reviewer's decisions
// (task sections 5-11). Everything in the 334-row candidate file that is NOT
// listed here as a reject is a keep; there are zero Batch 5 core holds.
// ---------------------------------------------------------------------------
const REJECTED_CORE_PAIRS = [
  // forgiveness_struggle (7)
  '7:200|forgiveness_struggle',
  '64:14|forgiveness_struggle',
  '12:18|forgiveness_struggle',
  '3:120|forgiveness_struggle',
  '22:60|forgiveness_struggle',
  '21:47|forgiveness_struggle',
  '4:148|forgiveness_struggle',
  // weak (25)
  '7:43|weak',
  '25:63|weak',
  '8:62|weak',
  '4:45|weak',
  '4:148|weak',
  '21:47|weak',
  '8:29|weak',
  '57:28|weak',
  '3:31|weak',
  '39:53|weak',
  '4:110|weak',
  '3:135|weak',
  '20:82|weak',
  '42:25|weak',
  '66:8|weak',
  '9:104|weak',
  '25:70|weak',
  '17:25|weak',
  '19:60|weak',
  '12:84|weak',
  '94:3|weak',
  '3:146|weak',
  '25:47|weak',
  '92:7|weak',
  '94:2|weak',
  // strength (3)
  '57:28|strength',
  '3:31|strength',
  '92:7|strength',
  // hopeful (2)
  '13:11|hopeful',
  '65:4|hopeful',
  // content (12)
  '3:31|content',
  '9:104|content',
  '25:70|content',
  '50:33|content',
  '12:83|content',
  '12:86|content',
  '21:47|content',
  '42:25|content',
  '66:8|content',
  '20:40|content',
  '65:4|content',
  '39:10|content',
  // grateful (0), peaceful (0)
];

const SUPPLEMENTAL_KEEP_PAIRS = [
  // forgiveness_struggle (2)
  '12:92|forgiveness_struggle',
  '12:100|forgiveness_struggle',
  // strength (2)
  '20:72|strength',
  '7:126|strength',
  // grateful (12)
  '16:18|grateful',
  '16:53|grateful',
  '16:78|grateful',
  '16:81|grateful',
  '93:11|grateful',
  '27:15|grateful',
  '55:13|grateful',
  '8:26|grateful',
  '45:12|grateful',
  '45:13|grateful',
  '34:15|grateful',
  '39:74|grateful',
  // peaceful (12)
  '30:21|peaceful',
  '6:96|peaceful',
  '10:67|peaceful',
  '27:86|peaceful',
  '16:80|peaceful',
  '42:28|peaceful',
  '48:18|peaceful',
  '25:48|peaceful',
  '50:9|peaceful',
  '55:50|peaceful',
  '55:54|peaceful',
  '55:76|peaceful',
];

describe('Phase 5B Batch 5 human-review artifact', () => {
  const candidates = loadJson<CandidateRow[]>('batches/batch-5/initial-candidates.json');
  const humanReview = loadJson<HumanReviewFile>('batches/batch-5/final-review.json');

  it('has exactly 334 original candidates, all reviewed exactly once, 0 hold', () => {
    expect(candidates).toHaveLength(334);
    expect(humanReview.originalCandidateCount).toBe(334);
    expect(humanReview.reviews).toHaveLength(334);

    const seen = new Set<string>();
    const duplicates: string[] = [];
    humanReview.reviews.forEach((row) => {
      const key = pairKey(row);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    });
    expect(duplicates).toEqual([]);
  });

  it('core review pair set exactly equals the Batch 5 candidate pair set', () => {
    const candidatePairs = new Set(candidates.map(pairKey));
    const reviewPairs = new Set(humanReview.reviews.map(pairKey));

    expect(reviewPairs.size).toBe(candidatePairs.size);
    candidatePairs.forEach((key) => expect(reviewPairs.has(key)).toBe(true));
    reviewPairs.forEach((key) => expect(candidatePairs.has(key)).toBe(true));
  });

  it('has the exact 285/49/0 decision counts', () => {
    expect(humanReview.decisionCounts).toEqual({ keep: 285, reject: 49, hold: 0 });

    const actualCounts = humanReview.reviews.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      { keep: 0, reject: 0, hold: 0 },
    );
    expect(actualCounts).toEqual({ keep: 285, reject: 49, hold: 0 });
  });

  it('has the exact per-emotion reviewed/keep/reject/hold breakdown', () => {
    const EXPECTED: Record<string, { reviewed: number; keep: number; reject: number; hold: number }> = {
      forgiveness_struggle: { reviewed: 24, keep: 17, reject: 7, hold: 0 },
      weak: { reviewed: 74, keep: 49, reject: 25, hold: 0 },
      strength: { reviewed: 82, keep: 79, reject: 3, hold: 0 },
      hopeful: { reviewed: 67, keep: 65, reject: 2, hold: 0 },
      content: { reviewed: 40, keep: 28, reject: 12, hold: 0 },
      grateful: { reviewed: 12, keep: 12, reject: 0, hold: 0 },
      peaceful: { reviewed: 35, keep: 35, reject: 0, hold: 0 },
    };

    const actual: Record<string, { reviewed: number; keep: number; reject: number; hold: number }> = {};
    BATCH5_EMOTIONS.forEach((key) => (actual[key] = { reviewed: 0, keep: 0, reject: 0, hold: 0 }));
    humanReview.reviews.forEach((row) => {
      actual[row.emotionKey].reviewed += 1;
      actual[row.emotionKey][row.decision] += 1;
    });

    expect(actual).toEqual(EXPECTED);
  });

  it('rejects exactly the 49 specified core pairs, nothing else', () => {
    const rejected = humanReview.reviews
      .filter((row) => row.decision === 'reject')
      .map(pairKey)
      .sort();

    expect(REJECTED_CORE_PAIRS).toHaveLength(49);
    expect(rejected).toEqual([...REJECTED_CORE_PAIRS].sort());
  });

  it('never produces a Batch 5 core hold', () => {
    const holds = humanReview.reviews.filter((row) => row.decision === 'hold');
    expect(holds).toEqual([]);
  });

  it('uses only canonical emotion keys and verified verse keys in core reviews', () => {
    const badVerseKeys = humanReview.reviews.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = humanReview.reviews.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
    humanReview.reviews.forEach((row) => expect(BATCH5_EMOTIONS).toContain(row.emotionKey));
  });

  it('never duplicates an existing MVP (development) mapping in core or supplemental reviews', () => {
    const collisions = [...humanReview.reviews, ...humanReview.supplementalReviews].filter((row) =>
      mvpPairs.has(pairKey(row)),
    );
    expect(collisions).toEqual([]);
  });

  it('never re-decides a pair already directly decided anywhere in Batch 1-4', () => {
    const priorDirectPairs = new Set<string>();
    REVIEW_FILES.forEach((f) => {
      const hr = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(f);
      hr.reviews.forEach((r) => priorDirectPairs.add(pairKey(r)));
      hr.supplementalReviews.forEach((r) => priorDirectPairs.add(pairKey(r)));
    });

    const collisions = [...humanReview.reviews, ...humanReview.supplementalReviews].filter((row) =>
      priorDirectPairs.has(pairKey(row)),
    );
    expect(collisions).toEqual([]);
  });

  it('never stores Quran Arabic text', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'batches/batch-5/final-review.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);
  });

  it('never stores production mapping-status vocabulary as a review decision', () => {
    const productionStatuses = new Set(['draft', 'reviewed', 'approved', 'development']);
    [...humanReview.reviews, ...humanReview.supplementalReviews].forEach((row) => {
      expect(productionStatuses.has(row.decision)).toBe(false);
    });
  });

  it('leaves the Batch 1-4 protected editorial state untouched (retained verses, self-reflection holds, punishment exclusions)', () => {
    const allPriorRows: ReviewRow[] = [];
    REVIEW_FILES.forEach((f) => {
      const hr = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(f);
      allPriorRows.push(...hr.reviews, ...hr.supplementalReviews);
    });

    const retained = allPriorRows.filter((r) => PUNISHMENT_RETAINED_VERSE_KEYS.includes(r.verseKey));
    expect(retained.length).toBeGreaterThan(0);
    retained.forEach((r) => expect(r.decision).toBe('keep'));

    const stillApproved = allPriorRows.filter(
      (r) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(r.verseKey) && r.decision !== 'reject',
    );
    expect(stillApproved).toEqual([]);

    const holdPairs = new Set(allPriorRows.filter((r) => r.decision === 'hold').map(pairKey));
    SELF_REFLECTION_HOLD_VERSE_KEYS.forEach((verseKey) => {
      expect(holdPairs.has(`${verseKey}|rejected`)).toBe(true);
    });

    // None of the 17 punishment/warning verseKeys appear anywhere in Batch 5.
    const batch5Rows = [...humanReview.reviews, ...humanReview.supplementalReviews];
    const batch5PunishmentCollisions = batch5Rows.filter((r) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(r.verseKey));
    expect(batch5PunishmentCollisions).toEqual([]);
  });

  it('has no editorialCorrections of its own (Batch 5 required none)', () => {
    expect((humanReview as unknown as { editorialCorrections?: unknown[] }).editorialCorrections).toBeUndefined();
  });
});

describe('Phase 5B Batch 5 supplemental reviews', () => {
  const candidates = loadJson<CandidateRow[]>('batches/batch-5/initial-candidates.json');
  const humanReview = loadJson<HumanReviewFile>('batches/batch-5/final-review.json');

  it('has exactly the 28 specified supplemental KEEP pairs, all disjoint from the 334 core candidates', () => {
    expect(SUPPLEMENTAL_KEEP_PAIRS).toHaveLength(28);

    const actualPairs = humanReview.supplementalReviews.map(pairKey).sort();
    expect(actualPairs).toEqual([...SUPPLEMENTAL_KEEP_PAIRS].sort());

    const counts = humanReview.supplementalReviews.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      { keep: 0, reject: 0, hold: 0 },
    );
    expect(counts).toEqual({ keep: 28, reject: 0, hold: 0 });

    const candidatePairs = new Set(candidates.map(pairKey));
    humanReview.supplementalReviews.forEach((row) => {
      expect(candidatePairs.has(pairKey(row)), `${pairKey(row)} should not be one of the 334 core candidates`).toBe(
        false,
      );
    });
  });

  it('marks every supplemental row as supplemental', () => {
    humanReview.supplementalReviews.forEach((row) => {
      expect(row.supplemental).toBe(true);
    });
  });

  it('never includes 12:100 -> guilty anywhere in the artifact', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'batches/batch-5/final-review.json'), 'utf-8');
    const parsed = JSON.parse(raw) as HumanReviewFile;
    const collision = [...parsed.reviews, ...parsed.supplementalReviews].find(
      (row) => row.verseKey === '12:100' && row.emotionKey === 'guilty',
    );
    expect(collision).toBeUndefined();
  });

  it('uses only canonical emotion keys and verified verse keys in supplemental reviews', () => {
    const badVerseKeys = humanReview.supplementalReviews.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = humanReview.supplementalReviews.filter(
      (row) => !canonicalEmotionKeys.has(row.emotionKey),
    );
    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });
});

describe('Phase 5B Batch 5 review: from-scratch reconstruction', () => {
  // Rebuilds the entire expected review set from the 334-row candidate file
  // plus the two hardcoded ground-truth tables above (transcribed from the
  // human reviewer's decisions, not read back from the artifact under test),
  // then diffs that reconstruction against disk pair-for-pair.
  const candidates = loadJson<CandidateRow[]>('batches/batch-5/initial-candidates.json');
  const humanReview = loadJson<HumanReviewFile>('batches/batch-5/final-review.json');

  it('reconstructs the exact 334 core decisions (reject list drives everything else to keep)', () => {
    const rejectedSet = new Set(REJECTED_CORE_PAIRS);
    const expected = new Map<string, 'keep' | 'reject'>();
    candidates.forEach((row) => {
      const key = pairKey(row);
      expected.set(key, rejectedSet.has(key) ? 'reject' : 'keep');
    });

    expect(expected.size).toBe(334);

    const actual = new Map<string, string>();
    humanReview.reviews.forEach((row) => actual.set(pairKey(row), row.decision));

    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    expected.forEach((decision, key) => {
      expect(actual.get(key), `mismatch at ${key}`).toBe(decision);
    });
  });

  it('reconstructs the exact 28 supplemental decisions', () => {
    const expected = new Set(SUPPLEMENTAL_KEEP_PAIRS);
    const actual = new Set(humanReview.supplementalReviews.map(pairKey));

    expect(actual.size).toBe(expected.size);
    expect([...actual].sort()).toEqual([...expected].sort());
    humanReview.supplementalReviews.forEach((row) => expect(row.decision).toBe('keep'));
  });
});
