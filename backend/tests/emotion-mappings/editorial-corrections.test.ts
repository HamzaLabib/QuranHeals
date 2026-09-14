import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isValidVerseKey } from '../../src/quran/referenceKeys';
import { seedAyahs } from '../../src/seed/ayahs';
import { seedEmotions } from '../../src/seed/emotions';

// This suite verifies the latest human editorial correction to the Phase 5B
// review artifacts, cutting across all four batches and every overlap file.
// It never touches the candidates.json files (unreviewed proposals), the
// verified Quran corpus, or anything with production/runtime effect - it
// only reads the human-review and overlap-candidate JSON, plus the seed
// mappings/emotions, to confirm review-data integrity.

const DATA_DIR = resolve(__dirname, '../../data/emotion-candidates');

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, fileName), 'utf-8')) as T;
}

type ReviewRow = {
  verseKey: string;
  emotionKey: string;
  decision: 'keep' | 'reject' | 'hold';
  priorDecision?: 'keep' | 'reject' | 'hold';
  holdCategory?: string;
  supersededBy?: string;
  note?: string;
};
type OverlapRow = {
  verseKey: string;
  emotionKey: string;
  sourceEmotionKeys: string[];
  status?: 'excluded';
  excludedBy?: string;
};
type HumanReviewFile = {
  reviews: ReviewRow[];
  supplementalReviews: ReviewRow[];
  editorialCorrections?: { id: string }[];
};

const HUMAN_REVIEW_FILES = [
  'batches/batch-1/final-review.json',
  'batches/batch-2/final-review.json',
  'batches/batch-3/final-review.json',
  'batches/batch-4/final-review.json',
];

const OVERLAP_FILES = [
  'batches/batch-1/overlaps.json',
  'batches/batch-2/overlaps.json',
  'batches/batch-3/overlaps.json',
  'batches/batch-4/overlaps.json',
];

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

const canonicalEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));
const mvpPairs = new Set(
  seedAyahs.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`)),
);

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

function loadAllReviews(): { file: string; array: 'reviews' | 'supplementalReviews'; row: ReviewRow }[] {
  const all: { file: string; array: 'reviews' | 'supplementalReviews'; row: ReviewRow }[] = [];
  HUMAN_REVIEW_FILES.forEach((file) => {
    const hr = loadJson<HumanReviewFile>(file);
    hr.reviews.forEach((row) => all.push({ file, array: 'reviews', row }));
    hr.supplementalReviews.forEach((row) => all.push({ file, array: 'supplementalReviews', row }));
  });
  return all;
}

describe('Phase 5B editorial correction: punishment/warning verse-level exclusion', () => {
  const allReviews = loadAllReviews();

  it('leaves none of the 17 excluded verseKeys with an approved (non-reject) Phase 5B review row', () => {
    const stillApproved = allReviews.filter(
      (entry) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(entry.row.verseKey) && entry.row.decision !== 'reject',
    );

    expect(stillApproved).toEqual([]);
  });

  it('changes exactly 128 (verseKey, emotionKey) pairs from keep to reject, across 17 unique verseKeys', () => {
    const superseded = allReviews.filter((entry) => entry.row.supersededBy === 'phase5b-punishment-warning-exclusion');

    expect(superseded).toHaveLength(128);
    expect(new Set(superseded.map((entry) => entry.row.verseKey)).size).toBe(17);
    superseded.forEach((entry) => {
      expect(entry.row.priorDecision).toBe('keep');
      expect(entry.row.decision).toBe('reject');
      expect(PUNISHMENT_EXCLUDED_VERSE_KEYS).toContain(entry.row.verseKey);
    });

    // Verse-level rule: every one of the 17 verseKeys shows up in the superseded set.
    const supersededVerseKeys = new Set(superseded.map((entry) => entry.row.verseKey));
    PUNISHMENT_EXCLUDED_VERSE_KEYS.forEach((verseKey) => expect(supersededVerseKeys.has(verseKey)).toBe(true));
  });

  it('keeps the 5 retained verseKeys exactly as previously reviewed, including their overlaps', () => {
    const retained = allReviews.filter((entry) => PUNISHMENT_RETAINED_VERSE_KEYS.includes(entry.row.verseKey));

    expect(retained.length).toBeGreaterThan(0);
    retained.forEach((entry) => {
      expect(entry.row.decision).toBe('keep');
      expect(entry.row.supersededBy).toBeUndefined();
      expect(entry.row.priorDecision).toBeUndefined();
    });

    // Specific associations called out as required to survive.
    const pairs = new Set(retained.map((entry) => pairKey(entry.row)));
    expect(pairs.has('40:16|betrayed')).toBe(true);
    expect(pairs.has('40:16|wronged')).toBe(true);
    expect(pairs.has('40:16|angry')).toBe(true);
    expect(pairs.has('40:16|reassurance')).toBe(true);

    // Every one of the overlap rows for the 5 retained verses must remain active.
    OVERLAP_FILES.forEach((file) => {
      const overlap = loadJson<OverlapRow[]>(file);
      overlap
        .filter((row) => PUNISHMENT_RETAINED_VERSE_KEYS.includes(row.verseKey))
        .forEach((row) => expect(row.status).toBeUndefined());
    });
  });

  it('excludes, without deleting, every overlap row sourced from one of the 17 excluded verseKeys', () => {
    let totalExcluded = 0;
    OVERLAP_FILES.forEach((file) => {
      const overlap = loadJson<OverlapRow[]>(file);
      const rows = overlap.filter((row) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(row.verseKey));
      rows.forEach((row) => {
        expect(row.status).toBe('excluded');
        expect(row.excludedBy).toBe('phase5b-punishment-warning-exclusion');
        // Provenance kept, not stripped.
        expect(Array.isArray(row.sourceEmotionKeys)).toBe(true);
        expect(row.sourceEmotionKeys.length).toBeGreaterThan(0);
      });
      totalExcluded += rows.length;
    });

    expect(totalExcluded).toBeGreaterThan(0);
  });
});

describe('Phase 5B editorial correction: rejected self-reflection HOLD', () => {
  const allReviews = loadAllReviews();

  it('changes exactly the 7 direct `verseKey -> rejected` pairs from keep to hold', () => {
    const held = allReviews.filter((entry) => entry.row.supersededBy === 'phase5b-rejected-self-reflection-hold');

    expect(held).toHaveLength(7);
    expect(held.map((entry) => pairKey(entry.row)).sort()).toEqual(
      SELF_REFLECTION_HOLD_VERSE_KEYS.map((verseKey) => `${verseKey}|rejected`).sort(),
    );
    held.forEach((entry) => {
      expect(entry.row.priorDecision).toBe('keep');
      expect(entry.row.decision).toBe('hold');
      expect(entry.row.decision).not.toBe('reject');
    });
  });

  it('never holds or rejects any other overlap of the 7 self-reflection verses', () => {
    // Any review row for these verseKeys under an emotion other than `rejected`
    // must be completely untouched by this correction.
    const otherRows = allReviews.filter(
      (entry) =>
        SELF_REFLECTION_HOLD_VERSE_KEYS.includes(entry.row.verseKey) && entry.row.emotionKey !== 'rejected',
    );

    otherRows.forEach((entry) => {
      expect(entry.row.supersededBy).toBeUndefined();
      expect(entry.row.priorDecision).toBeUndefined();
    });

    // Specifically, 3:159 -> angry (approved in Batch 3 core review) survives as keep.
    const angryRow = allReviews.find(
      (entry) => entry.row.verseKey === '3:159' && entry.row.emotionKey === 'angry',
    );
    expect(angryRow).toBeDefined();
    expect(angryRow!.row.decision).toBe('keep');

    // No overlap-candidate row for these verseKeys was excluded by this correction.
    OVERLAP_FILES.forEach((file) => {
      const overlap = loadJson<OverlapRow[]>(file);
      overlap
        .filter((row) => SELF_REFLECTION_HOLD_VERSE_KEYS.includes(row.verseKey))
        .forEach((row) => expect(row.excludedBy).not.toBe('phase5b-rejected-self-reflection-hold'));
    });
  });
});

describe('Phase 5B editorial correction: integrity across all artifacts', () => {
  it('has no duplicate (verseKey, emotionKey) human decision within any single review array', () => {
    HUMAN_REVIEW_FILES.forEach((file) => {
      const hr = loadJson<HumanReviewFile>(file);
      [hr.reviews, hr.supplementalReviews].forEach((rows) => {
        const seen = new Set<string>();
        rows.forEach((row) => {
          const key = pairKey(row);
          expect(seen.has(key), `${file}: duplicate ${key}`).toBe(false);
          seen.add(key);
        });
      });
    });
  });

  it('has no orphan review rows: every row uses a canonical emotion key and a verified verseKey', () => {
    const allRows = loadAllReviews();
    allRows.forEach((entry) => {
      expect(isValidVerseKey(entry.row.verseKey), `${entry.file}: bad verseKey ${entry.row.verseKey}`).toBe(true);
      expect(
        canonicalEmotionKeys.has(entry.row.emotionKey),
        `${entry.file}: bad emotionKey ${entry.row.emotionKey}`,
      ).toBe(true);
    });

    OVERLAP_FILES.forEach((file) => {
      const overlap = loadJson<OverlapRow[]>(file);
      overlap.forEach((row) => {
        expect(isValidVerseKey(row.verseKey), `${file}: bad verseKey ${row.verseKey}`).toBe(true);
        expect(canonicalEmotionKeys.has(row.emotionKey), `${file}: bad emotionKey ${row.emotionKey}`).toBe(true);
      });
    });
  });

  it('never lets a superseded/held review row collide with an existing MVP (development) mapping', () => {
    const allRows = loadAllReviews();
    const touched = allRows.filter((entry) => entry.row.supersededBy);
    touched.forEach((entry) => {
      expect(mvpPairs.has(pairKey(entry.row))).toBe(false);
    });
  });

  it('never stores Quran Arabic text in any Phase 5B review or overlap artifact', () => {
    const arabicPattern = /[؀-ۿ]/;
    [...HUMAN_REVIEW_FILES, ...OVERLAP_FILES].forEach((file) => {
      const raw = readFileSync(resolve(DATA_DIR, file), 'utf-8');
      expect(arabicPattern.test(raw), `${file} contains Arabic text`).toBe(false);
    });
  });

  it('is purely review-metadata: decision/status fields never overlap with production mapping status vocabulary', () => {
    // `decision` values are the review-disposition vocabulary only; the
    // production mapping lifecycle uses a disjoint set of status strings
    // (draft/reviewed/approved/development). This guards against a future
    // edit accidentally writing a production status into review data.
    const productionStatuses = new Set(['draft', 'reviewed', 'approved', 'development']);
    const allRows = loadAllReviews();
    allRows.forEach((entry) => {
      expect(productionStatuses.has(entry.row.decision)).toBe(false);
    });
  });
});
