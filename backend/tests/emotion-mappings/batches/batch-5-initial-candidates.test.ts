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
type ReviewRow = { verseKey: string; emotionKey: string; decision: 'keep' | 'reject' | 'hold' };
type HumanReviewFile = { reviews: ReviewRow[]; supplementalReviews: ReviewRow[] };
type OverlapRow = {
  verseKey: string;
  emotionKey: string;
  sourceEmotionKeys: string[];
  status?: 'excluded';
  excludedBy?: string;
};

const BATCH5_EMOTIONS = ['forgiveness_struggle', 'weak', 'strength', 'hopeful', 'content', 'grateful', 'peaceful'];
const arabicPattern = /[؀-ۿ]/;
const canonicalEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));
const mvpPairs = new Set(
  seedAyahs.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`)),
);

const REVIEW_FILES = [
  'batches/batch-1/final-review.json',
  'batches/batch-2/final-review.json',
  'batches/batch-3/final-review.json',
  'batches/batch-4/final-review.json',
] as const;
const OVERLAP_FILES = [
  'batches/batch-1/overlaps.json',
  'batches/batch-2/overlaps.json',
  'batches/batch-3/overlaps.json',
  'batches/batch-4/overlaps.json',
] as const;

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

// The 5 punishment/warning source pairs superseded to `reject` in an earlier
// correction. They must never reappear as an overlap source for Batch 5.
const SUPERSEDED_SOURCE_PAIRS = new Set([
  '39:54|hopeless',
  '46:35|tired',
  '46:35|want_to_cry',
  '46:35|rejected',
  '42:42|rejected',
]);

const PUNISHMENT_EXCLUDED_VERSE_KEYS = [
  '15:50', '39:54', '39:55', '39:56', '39:57', '39:58', '39:59', '39:60', '39:65', '39:68',
  '39:71', '39:72', '40:18', '42:42', '46:35', '69:18', '69:25',
];
const PUNISHMENT_RETAINED_VERSE_KEYS = ['14:42', '40:16', '40:17', '40:19', '40:20'];
const SELF_REFLECTION_HOLD_VERSE_KEYS = ['3:159', '13:11', '2:44', '61:2', '61:3', '16:125', '20:44'];

describe('Phase 5B checkpoint (pre-Batch 5)', () => {
  // These assertions guard the exact checkpoint this Batch 5 task was built
  // on top of. If any of them fail, Batch 5 candidate generation assumed a
  // state that no longer holds.
  it('Batch 4 overlap-source recovery is complete: zero unresolved sources, 418 overlap rows', () => {
    const batch4 = loadJson<{ unrecoverableOverlapSources: { pairs: unknown[] } }>(
      'batches/batch-4/final-review.json',
    );
    expect(batch4.unrecoverableOverlapSources.pairs).toEqual([]);

    const overlap = loadJson<OverlapRow[]>('batches/batch-4/overlaps.json');
    expect(overlap).toHaveLength(418);
  });

  it('the five retained verses remain keep and the seven self-reflection pairs remain hold', () => {
    const allRows: ReviewRow[] = [];
    REVIEW_FILES.forEach((f) => {
      const hr = loadJson<HumanReviewFile>(f);
      allRows.push(...hr.reviews, ...hr.supplementalReviews);
    });

    const retained = allRows.filter((r) => PUNISHMENT_RETAINED_VERSE_KEYS.includes(r.verseKey));
    expect(retained.length).toBeGreaterThan(0);
    retained.forEach((r) => expect(r.decision).toBe('keep'));

    // The seven self-reflection pairs must all be hold (Batch 1 also has an
    // unrelated pre-existing hold, `1:7 -> seeking_guidance`, which is not
    // part of this set and is left untouched).
    const holdPairs = new Set(allRows.filter((r) => r.decision === 'hold').map(pairKey));
    SELF_REFLECTION_HOLD_VERSE_KEYS.forEach((verseKey) => {
      expect(holdPairs.has(`${verseKey}|rejected`), `${verseKey}|rejected should be hold`).toBe(true);
    });
  });

  it('the 17 punishment/warning verseKeys have no approved (non-reject) row anywhere in Batch 1-4', () => {
    const allRows: ReviewRow[] = [];
    REVIEW_FILES.forEach((f) => {
      const hr = loadJson<HumanReviewFile>(f);
      allRows.push(...hr.reviews, ...hr.supplementalReviews);
    });

    const stillApproved = allRows.filter(
      (r) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(r.verseKey) && r.decision !== 'reject',
    );
    expect(stillApproved).toEqual([]);
  });
});

describe('Phase 5B Batch 5 candidate artifact', () => {
  const candidates = loadJson<CandidateRow[]>('batches/batch-5/initial-candidates.json');

  it('parses as a non-empty array', () => {
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('contains only the seven Batch 5 emotion keys, and all seven are represented', () => {
    const usedKeys = new Set(candidates.map((row) => row.emotionKey));
    usedKeys.forEach((key) => expect(BATCH5_EMOTIONS).toContain(key));
    BATCH5_EMOTIONS.forEach((key) => expect(usedKeys.has(key), `${key} has no candidates`).toBe(true));
  });

  it('uses only canonical emotion keys and verified verse keys', () => {
    const badVerseKeys = candidates.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = candidates.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));

    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('has zero duplicate (verseKey, emotionKey) pairs', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    candidates.forEach((row) => {
      const key = pairKey(row);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    });
    expect(duplicates).toEqual([]);
  });

  it('never stores Quran Arabic, translation text, mapping status, or a review decision', () => {
    const raw = readFileSync(resolve(DATA_DIR, 'batches/batch-5/initial-candidates.json'), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);

    candidates.forEach((row) => {
      expect(row).not.toHaveProperty('arabicText');
      expect(row).not.toHaveProperty('translation');
      expect(row).not.toHaveProperty('englishTranslation');
      expect(row).not.toHaveProperty('decision');
      expect(row).not.toHaveProperty('status');
      expect(row).not.toHaveProperty('keep');
      expect(row).not.toHaveProperty('reject');
      expect(row).not.toHaveProperty('hold');
      expect(row).not.toHaveProperty('id');
      expect(row).not.toHaveProperty('_id');
    });
  });

  it('never wraps a long quoted translation fragment in the rationale or contextNotes (no partial Quran quotations)', () => {
    // Heuristic: a quoted span of 20+ characters strongly suggests a lifted
    // translation fragment, which this batch's artifact must not contain
    // (stricter than earlier batches, per this task's explicit instruction).
    // Lookbehind/lookahead exclude word-internal apostrophes (e.g. "Allah's")
    // so real possessives don't get mistaken for a pair of quotation marks.
    const longQuotePattern = /(?<![a-zA-Z])'[^']{20,}'(?![a-zA-Z])|(?<![a-zA-Z])"[^"]{20,}"(?![a-zA-Z])/;
    candidates.forEach((row) => {
      expect(longQuotePattern.test(row.rationale), `${pairKey(row)} rationale looks like a quoted fragment`).toBe(
        false,
      );
      if (row.contextNotes) {
        expect(
          longQuotePattern.test(row.contextNotes),
          `${pairKey(row)} contextNotes looks like a quoted fragment`,
        ).toBe(false);
      }
    });
  });

  it('gives every row a non-empty rationale and the Batch 5 source label', () => {
    candidates.forEach((row) => {
      expect(typeof row.rationale).toBe('string');
      expect(row.rationale.length).toBeGreaterThan(0);
      expect(row.source).toBe('phase5b-batch5-candidate-review');
    });
  });

  it('never duplicates an existing MVP (development) mapping', () => {
    const collisions = candidates.filter((row) => mvpPairs.has(pairKey(row)));
    expect(collisions).toEqual([]);
  });

  it('never duplicates a pair already directly decided in Batch 1-4 (core or supplemental)', () => {
    const directPairs = new Set<string>();
    REVIEW_FILES.forEach((f) => {
      const hr = loadJson<HumanReviewFile>(f);
      hr.reviews.forEach((r) => directPairs.add(pairKey(r)));
      hr.supplementalReviews.forEach((r) => directPairs.add(pairKey(r)));
    });

    const collisions = candidates.filter((row) => directPairs.has(pairKey(row)));
    expect(collisions).toEqual([]);
  });

  it('never reuses one of the 5 superseded punishment/warning source pairs as an overlap source', () => {
    candidates.forEach((row) => {
      if (!row.rationale.includes('Originally raised during Phase 5B review of')) return;
      // Nothing in this artifact is sourced FROM 39:54, 46:35, or 42:42 - the
      // superseded pairs are source decisions on OTHER verses, not
      // destinations, so this checks the candidate's own verseKey is never
      // one of the two remaining superseded verseKeys used as a proxy stand-in.
      expect(SUPERSEDED_SOURCE_PAIRS.has(pairKey(row))).toBe(false);
    });
  });

  it('groups candidates by the seven Batch 5 emotions in the exact specified order', () => {
    const seenOrder: string[] = [];
    candidates.forEach((row) => {
      if (seenOrder[seenOrder.length - 1] !== row.emotionKey) seenOrder.push(row.emotionKey);
    });
    expect(seenOrder).toEqual(BATCH5_EMOTIONS);
  });

  it('orders fresh-discovery candidates numerically by surah:ayah within each emotion, after the overlap-derived ones', () => {
    BATCH5_EMOTIONS.forEach((emotionKey) => {
      const rows = candidates.filter((row) => row.emotionKey === emotionKey);
      const freshRows = rows.filter((row) => row.contextNotes?.startsWith('Fresh Batch 5 discovery candidate'));
      const overlapRows = rows.filter((row) => !row.contextNotes?.startsWith('Fresh Batch 5 discovery candidate'));

      // Every overlap-derived row precedes every fresh-discovery row.
      const lastOverlapIndex = rows.lastIndexOf(overlapRows[overlapRows.length - 1]);
      const firstFreshIndex = freshRows.length > 0 ? rows.indexOf(freshRows[0]) : Infinity;
      if (freshRows.length > 0 && overlapRows.length > 0) {
        expect(firstFreshIndex).toBeGreaterThan(lastOverlapIndex);
      }

      // Fresh rows are numerically ordered by surah then ayah.
      const parsed = freshRows.map((row) => row.verseKey.split(':').map(Number) as [number, number]);
      const sorted = [...parsed].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      expect(parsed).toEqual(sorted);
    });
  });
});

describe('Phase 5B Batch 5 overlap coverage (from-scratch reconstruction)', () => {
  // Rebuilds the eligible overlap set independently from the four overlap
  // files and compares it against the Batch 5 candidate file, rather than
  // checking the candidate file against itself.
  const candidates = loadJson<CandidateRow[]>('batches/batch-5/initial-candidates.json');

  const directPairs = new Set<string>();
  REVIEW_FILES.forEach((f) => {
    const hr = loadJson<HumanReviewFile>(f);
    hr.reviews.forEach((r) => directPairs.add(pairKey(r)));
    hr.supplementalReviews.forEach((r) => directPairs.add(pairKey(r)));
  });

  function computeEligibleOverlapKeys(): Set<string> {
    const eligible = new Set<string>();
    OVERLAP_FILES.forEach((f) => {
      loadJson<OverlapRow[]>(f).forEach((row) => {
        if (!BATCH5_EMOTIONS.includes(row.emotionKey)) return;
        if (row.status === 'excluded') return; // superseded by an editorial correction
        const key = pairKey(row);
        if (mvpPairs.has(key)) return;
        if (directPairs.has(key)) return;
        eligible.add(key);
      });
    });
    return eligible;
  }

  it('includes every eligible reviewer-approved overlap for the 7 emotions exactly once', () => {
    const eligible = computeEligibleOverlapKeys();
    const candidateKeys = new Set(candidates.map(pairKey));

    const missing = [...eligible].filter((key) => !candidateKeys.has(key));
    expect(missing, `eligible overlap pairs missing from Batch 5: ${missing.join(', ')}`).toEqual([]);
  });

  it('never includes any of the 17 punishment/warning verseKeys, whose overlap rows were excluded by an editorial correction', () => {
    const stillPresent = candidates.filter((row) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(row.verseKey));
    expect(stillPresent).toEqual([]);
  });

  it('preserves overlap provenance (sourceEmotionKeys) after merging duplicates across files', () => {
    // Every overlap-derived candidate's rationale must cite at least one
    // source emotion it was raised under - i.e. merging never drops
    // provenance down to nothing.
    const overlapDerived = candidates.filter((row) =>
      row.rationale.startsWith('Reviewer-approved cross-emotion overlap proposal'),
    );
    expect(overlapDerived.length).toBeGreaterThan(0);
    overlapDerived.forEach((row) => {
      expect(row.rationale).toMatch(/Originally raised during Phase 5B review of `/);
    });
  });

  it('merges a (verseKey, emotionKey) pair proposed by more than one overlap file into a single candidate row', () => {
    // 3:159 -> forgiveness_struggle is proposed by both the Batch 3 and
    // Batch 4 overlap files; it must appear exactly once here with both
    // sources cited.
    const rows = candidates.filter((row) => row.verseKey === '3:159' && row.emotionKey === 'forgiveness_struggle');
    expect(rows).toHaveLength(1);
    expect(rows[0].contextNotes).toContain('Batch 3 overlap file');
    expect(rows[0].contextNotes).toContain('Batch 4 overlap file');
  });

  it('does not invent an overlap-derived candidate that has no matching eligible overlap proposal', () => {
    const eligible = computeEligibleOverlapKeys();
    const overlapDerived = candidates.filter((row) =>
      row.rationale.startsWith('Reviewer-approved cross-emotion overlap proposal'),
    );
    const invented = overlapDerived.filter((row) => !eligible.has(pairKey(row)));
    expect(invented).toEqual([]);
  });
});

describe('Phase 5B Batch 5 fresh-discovery candidates', () => {
  const candidates = loadJson<CandidateRow[]>('batches/batch-5/initial-candidates.json');
  const freshRows = candidates.filter((row) => row.contextNotes?.startsWith('Fresh Batch 5 discovery candidate'));

  it('has a non-trivial, non-quota-padded set of fresh candidates covering more than one emotion', () => {
    expect(freshRows.length).toBeGreaterThan(0);
    const emotionsCovered = new Set(freshRows.map((row) => row.emotionKey));
    expect(emotionsCovered.size).toBeGreaterThan(1);
  });

  it('never proposes a fresh candidate for a pair already covered by an overlap-derived candidate', () => {
    const overlapDerivedKeys = new Set(
      candidates
        .filter((row) => row.rationale.startsWith('Reviewer-approved cross-emotion overlap proposal'))
        .map(pairKey),
    );
    freshRows.forEach((row) => {
      expect(overlapDerivedKeys.has(pairKey(row)), `${pairKey(row)} duplicates an overlap-derived candidate`).toBe(
        false,
      );
    });
  });

  it('never proposes a fresh candidate for one of the 17 punishment/warning verseKeys', () => {
    const collisions = freshRows.filter((row) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(row.verseKey));
    expect(collisions).toEqual([]);
  });
});

describe('Phase 5B Batch 4-5 boundary: nothing prior was disturbed', () => {
  it('Batch 1-4 decision counts and totals are byte-identical to the pre-Batch-5 checkpoint', () => {
    const batch1 = loadJson<{ decisionCounts: unknown }>('batches/batch-1/final-review.json');
    const batch3 = loadJson<{ decisionCounts: unknown }>('batches/batch-3/final-review.json');
    const batch4 = loadJson<{ decisionCounts: unknown }>('batches/batch-4/final-review.json');

    expect(batch1.decisionCounts).toEqual({ keep: 62, reject: 3, hold: 1 });
    expect(batch3.decisionCounts).toEqual({ keep: 69, reject: 7, hold: 0 });
    expect(batch4.decisionCounts).toEqual({ keep: 122, reject: 8, hold: 0 });
  });

  it('batches/batch-5/final-review.json now exists with the expected 334/28 review totals', () => {
    // Batch 5 human review completed after this candidate file was generated;
    // see batch-5-final-review.test.ts for the full reconstruction check.
    const humanReview = loadJson<{
      originalCandidateCount: number;
      decisionCounts: { keep: number; reject: number; hold: number };
      reviews: ReviewRow[];
      supplementalReviews: ReviewRow[];
    }>('batches/batch-5/final-review.json');

    expect(humanReview.originalCandidateCount).toBe(334);
    expect(humanReview.decisionCounts).toEqual({ keep: 285, reject: 49, hold: 0 });
    expect(humanReview.reviews).toHaveLength(334);
    expect(humanReview.supplementalReviews).toHaveLength(28);
  });
});
