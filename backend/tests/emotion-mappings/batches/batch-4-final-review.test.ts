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
  holdCategory?: string;
  supersededBy?: string;
};
type OverlapRow = {
  verseKey: string;
  emotionKey: string;
  sourceEmotionKeys: string[];
  status?: 'excluded';
  excludedBy?: string;
};

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
const SELF_REFLECTION_HOLD_VERSE_KEYS = ['3:159', '13:11', '2:44', '61:2', '61:3', '16:125', '20:44'];
const HOLD_CATEGORY = 'self-reflection / advice-style / personal-change review deferred';

const arabicPattern = /[؀-ۿ]/;
// This test validates a HISTORICAL Batch 4 review snapshot against the
// canonical emotion set as it existed at that review's time (the original
// 29 keys) — it must not silently absorb a later, unrelated catalog
// addition such as `faith_shaken` (added in its own separate review round;
// see batch-6/), which Batch 4 never reviewed 2:186 against.
const canonicalEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key).filter((key) => key !== 'faith_shaken'));

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
  const candidates = loadJson<CandidateRow[]>('batches/batch-4/initial-candidates.json');
  const humanReview = loadJson<{
    artifact: string;
    candidateSource: string;
    originalCandidateCount: number;
    decisionCounts: { keep: number; reject: number; hold: number };
    reviews: ReviewRow[];
    supplementalReviews: (ReviewRow & { note?: string })[];
    unrecoverableOverlapSources: {
      note: string;
      pairs: CandidateRow[];
      supersededPairs: { note: string; pairs: CandidateRow[] };
    };
    editorialCorrections: {
      id: string;
      priorDecision?: string;
      newDecision?: string;
      reason: string;
      verseKeys?: string[];
      excludedVerseKeys?: string[];
      retainedVerseKeys?: string[];
      changedPairsInThisArtifact?: { reviews: string[]; supplementalReviews: string[] };
      resolvedSourcePairCount?: number;
      finalOverlapRowCount?: number;
    }[];
  }>('batches/batch-4/final-review.json');

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

  it('has exactly the expected 122/8/0 decision counts after the punishment/warning correction', () => {
    // Was 127/3/0 at first review; the `phase5b-punishment-warning-exclusion`
    // editorial correction superseded 5 core `keep` rows to `reject`.
    expect(humanReview.decisionCounts).toEqual({ keep: 122, reject: 8, hold: 0 });

    const actualCounts = humanReview.reviews.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      { keep: 0, reject: 0, hold: 0 },
    );

    expect(actualCounts).toEqual({ keep: 122, reject: 8, hold: 0 });
  });

  it('rejects the 3 original rejections plus the 5 superseded punishment/warning pairs, nothing else', () => {
    const rejected = humanReview.reviews
      .filter((row) => row.decision === 'reject')
      .map(pairKey)
      .sort();

    expect(rejected).toEqual(
      [
        '3:103|lonely',
        '3:173|sad',
        '7:200|rejected',
        '39:54|hopeless',
        '46:35|tired',
        '46:35|want_to_cry',
        '42:42|rejected',
        '46:35|rejected',
      ].sort(),
    );
  });

  it('keeps the 3 original Batch 4 rejections recorded as original, not superseded', () => {
    const original = humanReview.reviews.filter((row) => row.decision === 'reject' && !row.supersededBy);
    expect(original.map(pairKey).sort()).toEqual(['3:103|lonely', '3:173|sad', '7:200|rejected'].sort());

    const superseded = humanReview.reviews.filter((row) => row.supersededBy);
    expect(superseded.map(pairKey).sort()).toEqual(
      ['39:54|hopeless', '46:35|tired', '46:35|want_to_cry', '42:42|rejected', '46:35|rejected'].sort(),
    );
    superseded.forEach((row) => {
      expect(row.supersededBy).toBe('phase5b-punishment-warning-exclusion');
      expect(row.priorDecision).toBe('keep');
    });
  });

  it('leaves no punishment/warning verseKey with a KEEP row, core or supplemental', () => {
    const stillKept = [...humanReview.reviews, ...humanReview.supplementalReviews].filter(
      (row) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(row.verseKey) && row.decision !== 'reject',
    );

    expect(stillKept).toEqual([]);
  });

  it('keeps the 5 retained verses untouched by the correction', () => {
    const retained = [...humanReview.reviews, ...humanReview.supplementalReviews].filter((row) =>
      PUNISHMENT_RETAINED_VERSE_KEYS.includes(row.verseKey),
    );

    expect(retained.length).toBeGreaterThan(0);
    retained.forEach((row) => {
      expect(row.decision).toBe('keep');
      expect(row.supersededBy).toBeUndefined();
    });
  });

  it('holds exactly the 7 self-reflection `rejected` supplementals, and nothing else', () => {
    const holds = [...humanReview.reviews, ...humanReview.supplementalReviews].filter(
      (row) => row.decision === 'hold',
    );

    expect(holds.map(pairKey).sort()).toEqual(
      SELF_REFLECTION_HOLD_VERSE_KEYS.map((verseKey) => `${verseKey}|rejected`).sort(),
    );
    holds.forEach((row) => {
      expect(row.priorDecision).toBe('keep');
      expect(row.holdCategory).toBe(HOLD_CATEGORY);
      expect(row.supersededBy).toBe('phase5b-rejected-self-reflection-hold');
      // HOLD is a deferral, never a rejection.
      expect(row.decision).not.toBe('reject');
    });
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

  it('includes exactly the 11 supplemental pairs: 4 KEEP and the 7 self-reflection HOLDs', () => {
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

    const counts = humanReview.supplementalReviews.reduce(
      (acc, row) => {
        acc[row.decision] += 1;
        return acc;
      },
      { keep: 0, reject: 0, hold: 0 },
    );
    expect(counts).toEqual({ keep: 4, reject: 0, hold: 7 });

    const stillKept = humanReview.supplementalReviews
      .filter((row) => row.decision === 'keep')
      .map(pairKey)
      .sort();
    expect(stillKept).toEqual(['12:83|sad', '1:5|tired', '28:13|want_to_cry', '20:40|want_to_cry'].sort());
  });

  it('records all three editorial corrections with their changed pairs intact', () => {
    const ids = humanReview.editorialCorrections.map((row) => row.id);
    expect(ids).toEqual([
      'phase5b-punishment-warning-exclusion',
      'phase5b-rejected-self-reflection-hold',
      'phase5b-batch4-overlap-source-recovery',
    ]);

    const punishment = humanReview.editorialCorrections[0];
    expect(punishment.priorDecision).toBe('keep');
    expect(punishment.newDecision).toBe('reject');
    expect(punishment.excludedVerseKeys!.slice().sort()).toEqual(PUNISHMENT_EXCLUDED_VERSE_KEYS.slice().sort());
    expect(punishment.retainedVerseKeys!.slice().sort()).toEqual(PUNISHMENT_RETAINED_VERSE_KEYS.slice().sort());
    expect(punishment.changedPairsInThisArtifact!.reviews).toHaveLength(5);
    expect(punishment.changedPairsInThisArtifact!.supplementalReviews).toHaveLength(0);

    const hold = humanReview.editorialCorrections[1];
    expect(hold.priorDecision).toBe('keep');
    expect(hold.newDecision).toBe('hold');
    expect(hold.reason).toBe(HOLD_CATEGORY);
    expect(hold.verseKeys!.slice().sort()).toEqual(SELF_REFLECTION_HOLD_VERSE_KEYS.slice().sort());
    expect(hold.changedPairsInThisArtifact!.supplementalReviews.slice().sort()).toEqual(
      SELF_REFLECTION_HOLD_VERSE_KEYS.map((verseKey) => `${verseKey}|rejected`).sort(),
    );

    const recovery = humanReview.editorialCorrections[2];
    expect(recovery.resolvedSourcePairCount).toBe(120);
    expect(recovery.finalOverlapRowCount).toBe(418);

    // Every pair either of the first two corrections claims to have changed
    // still exists as a row (the recovery correction has no review-array pairs).
    const allPairs = new Set([...humanReview.reviews, ...humanReview.supplementalReviews].map(pairKey));
    [punishment, hold].forEach((correction) => {
      [
        ...correction.changedPairsInThisArtifact!.reviews,
        ...correction.changedPairsInThisArtifact!.supplementalReviews,
      ].forEach((key) => expect(allPairs.has(key)).toBe(true));
    });
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

  it('has zero unresolved unrecoverableOverlapSources - all 120 were recovered and resolved', () => {
    // Field is kept per repository convention (not deleted), but is now empty:
    // the reviewer supplied every destination list, so nothing is unrecoverable.
    expect(Array.isArray(humanReview.unrecoverableOverlapSources.pairs)).toBe(true);
    expect(humanReview.unrecoverableOverlapSources.pairs).toEqual([]);
  });

  it('preserves the 5 superseded pairs in supersededPairs as historical audit provenance', () => {
    const { supersededPairs } = humanReview.unrecoverableOverlapSources;

    expect(supersededPairs.pairs.map(pairKey).sort()).toEqual(
      ['39:54|hopeless', '46:35|tired', '46:35|want_to_cry', '42:42|rejected', '46:35|rejected'].sort(),
    );

    // Each preserved pair is a real, now-rejected review row - evidence retained.
    const rejectedPairs = new Set(
      humanReview.reviews.filter((row) => row.decision === 'reject').map(pairKey),
    );
    supersededPairs.pairs.forEach((row) => expect(rejectedPairs.has(pairKey(row))).toBe(true));
  });

  it('never stores Quran Arabic or a full translation', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'batches/batch-4/final-review.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);
  });
});

describe('Phase 5B Batch 4 overlap-candidate artifact', () => {
  const overlap = loadJson<OverlapRow[]>('batches/batch-4/overlaps.json');

  it('is deduped by verseKey + emotionKey', () => {
    expect(findDuplicatePairs(overlap)).toEqual([]);
  });

  it('has exactly 418 rows after the overlap-source recovery correction (was 147)', () => {
    expect(overlap).toHaveLength(418);
  });

  it('uses only canonical emotion keys and verified verse keys', () => {
    const badVerseKeys = overlap.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = overlap.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('never proposes a pair that already has a direct Batch 1-4 human decision', () => {
    const batch1 = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(
      'batches/batch-1/final-review.json',
    );
    const batch2 = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(
      'batches/batch-2/final-review.json',
    );
    const batch3 = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(
      'batches/batch-3/final-review.json',
    );
    const batch4 = loadJson<{ reviews: ReviewRow[]; supplementalReviews: ReviewRow[] }>(
      'batches/batch-4/final-review.json',
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

    const raw = readFileSync(resolve(DATA_DIR, 'batches/batch-4/overlaps.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);
  });
});
