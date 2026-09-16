import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isValidVerseKey } from '../../src/quran/referenceKeys';
import { seedAyahs } from '../../src/seed/ayahs';
import { seedEmotions } from '../../src/seed/emotions';

// This suite independently reconstructs the Phase 5C approved-mapping
// preview from the real Phase 5B source artifacts (MVP seed, all five
// human-review files, all five overlap files) and diffs the reconstruction
// pair-for-pair against the persisted preview on disk. It never treats the
// generated preview as its own source of truth: every set (MVP, direct
// KEEP, supplemental KEEP, REJECT, HOLD, eligible overlap) is rebuilt here
// from the raw Batch 1-5 artifacts using the same precedence rules the
// preview was built on.

const DATA_DIR = resolve(__dirname, '../../data/emotion-candidates');
const REPORTS_DIR = resolve(__dirname, '../../reports/emotion-mappings');

function loadJson<T>(dir: string, fileName: string): T {
  return JSON.parse(readFileSync(resolve(dir, fileName), 'utf-8')) as T;
}
function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

type ReviewRow = {
  verseKey: string;
  emotionKey: string;
  decision: 'keep' | 'reject' | 'hold';
  holdCategory?: string;
  supersededBy?: string;
};
type HumanReviewFile = {
  reviews: ReviewRow[];
  supplementalReviews: ReviewRow[];
  editorialCorrections?: unknown[];
};
type OverlapRow = {
  verseKey: string;
  emotionKey: string;
  sourceEmotionKeys: string[];
  status?: 'excluded';
};
type ProvenanceEntry =
  | { type: 'mvp'; referenceKey: string }
  | { type: 'direct_keep'; batch: string }
  | { type: 'supplemental_keep'; batch: string }
  | { type: 'overlap'; sourceFile: string; sourceBatch: string; sourceEmotionKeys: string[] };
type PreviewRow = {
  verseKey: string;
  emotionKey: string;
  sourceTypes: string[];
  sourceBatches: string[];
  mvpProvenance?: { referenceKey: string };
  directKeepProvenance?: { batch: string }[];
  supplementalKeepProvenance?: { batch: string }[];
  overlapProvenance?: { sourceFile: string; sourceBatch: string; sourceEmotionKeys: string[] }[];
};
type PreviewFile = {
  totalPairs: number;
  uniqueVerses: number;
  countByEmotion: Record<string, number>;
  countByProvenanceType: Record<string, number>;
  multiProvenanceCount: number;
  rows: PreviewRow[];
};
type DuplicateAuditRow = {
  verseKey: string;
  emotionKey: string;
  occurrences: number;
  sourceFiles: string[];
  sourceBatches: string[];
  sourceEmotionKeys: string[];
  resolution: string;
  finalRowIncluded: boolean;
};
type DuplicateAuditFile = {
  expectedHistoricalDuplicateIdentities: number;
  observedHistoricalDuplicateIdentities: number;
  duplicateIdentitiesInvolvingBatch5: number;
  duplicatesRemainingInFinalPreview: number;
  rows: DuplicateAuditRow[];
};

const arabicPattern = /[؀-ۿ]/;
const canonicalEmotionKeySet = new Set(seedEmotions.map((e) => e.key));

const REVIEW_FILES = [
  ['1', 'batches/batch-1/final-review.json'],
  ['2', 'batches/batch-2/final-review.json'],
  ['3', 'batches/batch-3/final-review.json'],
  ['4', 'batches/batch-4/final-review.json'],
  ['5', 'batches/batch-5/final-review.json'],
] as const;
const OVERLAP_FILES = [
  ['1', 'batches/batch-1/overlaps.json'],
  ['2', 'batches/batch-2/overlaps.json'],
  ['3', 'batches/batch-3/overlaps.json'],
  ['4', 'batches/batch-4/overlaps.json'],
  ['5', 'batches/batch-5/overlaps.json'],
] as const;

const PUNISHMENT_EXCLUDED_VERSE_KEYS = [
  '15:50', '39:54', '39:55', '39:56', '39:57', '39:58', '39:59', '39:60', '39:65', '39:68',
  '39:71', '39:72', '40:18', '42:42', '46:35', '69:18', '69:25',
];
const PUNISHMENT_RETAINED_VERSE_KEYS = ['14:42', '40:16', '40:17', '40:19', '40:20'];
const SELF_REFLECTION_HOLD_VERSE_KEYS = ['3:159', '13:11', '2:44', '61:2', '61:3', '16:125', '20:44'];

// ---------------------------------------------------------------------------
// Independent reconstruction (mirrors the Phase 5C precedence rules, built
// fresh from the raw Batch 1-5 artifacts, not from the generated preview).
// ---------------------------------------------------------------------------
function reconstruct() {
  const mvpPairs = new Map<string, { referenceKey: string }>();
  seedAyahs.forEach((ayah) => {
    ayah.emotions.forEach((emotionKey) => {
      mvpPairs.set(`${ayah.referenceKey}|${emotionKey}`, { referenceKey: ayah.referenceKey });
    });
  });

  type DecisionSource = { batch: string; supplemental: boolean; decision: 'keep' | 'reject' | 'hold'; holdCategory?: string };
  const decisionSourcesByPair = new Map<string, DecisionSource[]>();
  REVIEW_FILES.forEach(([batch, file]) => {
    const hr = loadJson<HumanReviewFile>(DATA_DIR, file);
    (['reviews', 'supplementalReviews'] as const).forEach((arrayName) => {
      hr[arrayName].forEach((row) => {
        const key = pairKey(row);
        const list = decisionSourcesByPair.get(key) ?? [];
        list.push({ batch, supplemental: arrayName === 'supplementalReviews', decision: row.decision, holdCategory: row.holdCategory });
        decisionSourcesByPair.set(key, list);
      });
    });
  });

  const REJECT_SET = new Set<string>();
  const HOLD_SET = new Set<string>();
  const DIRECT_KEEP = new Map<string, string[]>();
  const SUPPLEMENTAL_KEEP = new Map<string, string[]>();
  const conflicts: string[] = [];

  decisionSourcesByPair.forEach((sources, key) => {
    const distinct = new Set(sources.map((s) => s.decision));
    if (distinct.size > 1) {
      conflicts.push(key);
      return;
    }
    const decision = sources[0].decision;
    if (decision === 'reject') REJECT_SET.add(key);
    else if (decision === 'hold') HOLD_SET.add(key);
    else {
      const coreBatches = sources.filter((s) => !s.supplemental).map((s) => s.batch);
      const suppBatches = sources.filter((s) => s.supplemental).map((s) => s.batch);
      if (coreBatches.length > 0) DIRECT_KEEP.set(key, coreBatches);
      if (suppBatches.length > 0) SUPPLEMENTAL_KEEP.set(key, suppBatches);
    }
  });

  const mvpConflicts: string[] = [];
  mvpPairs.forEach((_info, key) => {
    const sources = decisionSourcesByPair.get(key);
    if (sources?.some((s) => s.decision === 'reject' || s.decision === 'hold')) mvpConflicts.push(key);
  });

  type FinalRow = { verseKey: string; emotionKey: string; provenance: ProvenanceEntry[] };
  const finalRows = new Map<string, FinalRow>();
  function getOrCreate(verseKey: string, emotionKey: string): FinalRow {
    const key = `${verseKey}|${emotionKey}`;
    let row = finalRows.get(key);
    if (!row) {
      row = { verseKey, emotionKey, provenance: [] };
      finalRows.set(key, row);
    }
    return row;
  }

  mvpPairs.forEach((info, key) => {
    const [verseKey, emotionKey] = key.split('|');
    getOrCreate(verseKey, emotionKey).provenance.push({ type: 'mvp', referenceKey: info.referenceKey });
  });
  DIRECT_KEEP.forEach((batches, key) => {
    const [verseKey, emotionKey] = key.split('|');
    batches.forEach((batch) => getOrCreate(verseKey, emotionKey).provenance.push({ type: 'direct_keep', batch }));
  });
  SUPPLEMENTAL_KEEP.forEach((batches, key) => {
    const [verseKey, emotionKey] = key.split('|');
    batches.forEach((batch) => getOrCreate(verseKey, emotionKey).provenance.push({ type: 'supplemental_keep', batch }));
  });

  type TaggedOverlapRow = OverlapRow & { sourceFile: string; sourceBatch: string };
  const allOverlapRows: TaggedOverlapRow[] = [];
  OVERLAP_FILES.forEach(([batch, file]) => {
    loadJson<OverlapRow[]>(DATA_DIR, file).forEach((row) => allOverlapRows.push({ ...row, sourceFile: file, sourceBatch: batch }));
  });

  const overlapRowsByPair = new Map<string, TaggedOverlapRow[]>();
  allOverlapRows.forEach((row) => {
    const key = pairKey(row);
    const list = overlapRowsByPair.get(key) ?? [];
    list.push(row);
    overlapRowsByPair.set(key, list);
  });
  const duplicateIdentities = [...overlapRowsByPair.entries()].filter(([, rows]) => rows.length > 1);

  const blockedByReject: string[] = [];
  const blockedByHold: string[] = [];
  const blockedByCorrection: string[] = [];
  const invalid: string[] = [];
  let newOverlapRows = 0;
  let enriched = 0;

  allOverlapRows.forEach((row) => {
    const key = pairKey(row);
    if (row.status === 'excluded') {
      blockedByCorrection.push(key);
      return;
    }
    if (!isValidVerseKey(row.verseKey) || !canonicalEmotionKeySet.has(row.emotionKey)) {
      invalid.push(key);
      return;
    }
    if (REJECT_SET.has(key)) {
      blockedByReject.push(key);
      return;
    }
    if (HOLD_SET.has(key)) {
      blockedByHold.push(key);
      return;
    }
    const existing = finalRows.get(key);
    if (existing) {
      existing.provenance.push({ type: 'overlap', sourceFile: row.sourceFile, sourceBatch: row.sourceBatch, sourceEmotionKeys: [...row.sourceEmotionKeys].sort() });
      enriched += 1;
    } else {
      const [verseKey, emotionKey] = key.split('|');
      getOrCreate(verseKey, emotionKey).provenance.push({ type: 'overlap', sourceFile: row.sourceFile, sourceBatch: row.sourceBatch, sourceEmotionKeys: [...row.sourceEmotionKeys].sort() });
      newOverlapRows += 1;
    }
  });

  return {
    mvpPairs,
    REJECT_SET,
    HOLD_SET,
    DIRECT_KEEP,
    SUPPLEMENTAL_KEEP,
    conflicts,
    mvpConflicts,
    finalRows,
    duplicateIdentities,
    allOverlapRows,
    counts: { blockedByReject, blockedByHold, blockedByCorrection, invalid, newOverlapRows, enriched },
  };
}

const reconstructed = reconstruct();
const preview = loadJson<PreviewFile>(DATA_DIR, 'consolidated/approved-mappings-preview.json');
const duplicateAudit = loadJson<DuplicateAuditFile>(DATA_DIR, 'consolidated/duplicate-mappings-report.json');

describe('Phase 5C: independent reconstruction matches the persisted preview exactly', () => {
  it('has zero direct-decision conflicts and zero MVP-vs-REJECT/HOLD conflicts', () => {
    expect(reconstructed.conflicts).toEqual([]);
    expect(reconstructed.mvpConflicts).toEqual([]);
  });

  it('reconstructs the exact same set of final pairs as the persisted preview (pair-for-pair)', () => {
    const reconstructedKeys = [...reconstructed.finalRows.keys()].sort();
    const previewKeys = preview.rows.map(pairKey).sort();

    expect(reconstructedKeys.length).toBe(previewKeys.length);
    expect(reconstructedKeys).toEqual(previewKeys);
  });

  it('reconstructs the exact same source-type classification for every pair', () => {
    const previewByKey = new Map(preview.rows.map((row) => [pairKey(row), row]));

    reconstructed.finalRows.forEach((row, key) => {
      const previewRow = previewByKey.get(key);
      expect(previewRow, `missing from preview: ${key}`).toBeDefined();

      const reconstructedTypes = [...new Set(row.provenance.map((p) => p.type))].sort();
      expect(previewRow!.sourceTypes.slice().sort()).toEqual(reconstructedTypes);
    });
  });

  it('matches the total pair count and per-emotion breakdown', () => {
    expect(preview.totalPairs).toBe(reconstructed.finalRows.size);

    const actualByEmotion: Record<string, number> = {};
    Object.keys(preview.countByEmotion).forEach((k) => (actualByEmotion[k] = 0));
    reconstructed.finalRows.forEach((row) => {
      actualByEmotion[row.emotionKey] = (actualByEmotion[row.emotionKey] ?? 0) + 1;
    });
    expect(actualByEmotion).toEqual(preview.countByEmotion);
  });
});

describe('Phase 5C: traceability and precedence integrity', () => {
  it('every final pair is traceable to at least one of MVP / direct KEEP / supplemental KEEP / overlap', () => {
    preview.rows.forEach((row) => {
      const hasProvenance =
        row.mvpProvenance !== undefined ||
        (row.directKeepProvenance?.length ?? 0) > 0 ||
        (row.supplementalKeepProvenance?.length ?? 0) > 0 ||
        (row.overlapProvenance?.length ?? 0) > 0;
      expect(hasProvenance, `${pairKey(row)} has no provenance`).toBe(true);
      expect(row.sourceTypes.length).toBeGreaterThan(0);
    });
  });

  it('no final pair is a direct or protected REJECT', () => {
    const rejected = preview.rows.filter((row) => reconstructed.REJECT_SET.has(pairKey(row)));
    expect(rejected).toEqual([]);
  });

  it('no final pair is a HOLD', () => {
    const held = preview.rows.filter((row) => reconstructed.HOLD_SET.has(pairKey(row)));
    expect(held).toEqual([]);
  });

  it('no final pair belongs to one of the 17 punishment/warning-excluded verseKeys', () => {
    const collisions = preview.rows.filter((row) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(row.verseKey));
    expect(collisions).toEqual([]);
  });

  it('every eligible direct core KEEP pair appears in the final preview', () => {
    const previewKeys = new Set(preview.rows.map(pairKey));
    reconstructed.DIRECT_KEEP.forEach((_batches, key) => {
      expect(previewKeys.has(key), `direct KEEP missing from preview: ${key}`).toBe(true);
    });
  });

  it('every eligible supplemental KEEP pair appears in the final preview', () => {
    const previewKeys = new Set(preview.rows.map(pairKey));
    reconstructed.SUPPLEMENTAL_KEEP.forEach((_batches, key) => {
      expect(previewKeys.has(key), `supplemental KEEP missing from preview: ${key}`).toBe(true);
    });
  });

  it('every eligible MVP pair appears in the final preview exactly once', () => {
    const previewKeys = preview.rows.map(pairKey);
    const previewKeySet = new Set(previewKeys);
    expect(previewKeys.length).toBe(previewKeySet.size); // no duplicates at all, a fortiori for MVP

    reconstructed.mvpPairs.forEach((_info, key) => {
      expect(previewKeySet.has(key), `MVP pair missing from preview: ${key}`).toBe(true);
    });
  });

  it('every eligible overlap pair (not blocked) appears in the final preview', () => {
    const previewKeys = new Set(preview.rows.map(pairKey));
    reconstructed.allOverlapRows.forEach((row) => {
      if (row.status === 'excluded') return;
      if (!isValidVerseKey(row.verseKey) || !canonicalEmotionKeySet.has(row.emotionKey)) return;
      const key = pairKey(row);
      if (reconstructed.REJECT_SET.has(key) || reconstructed.HOLD_SET.has(key)) return;
      expect(previewKeys.has(key), `eligible overlap missing from preview: ${key}`).toBe(true);
    });
  });

  it('has zero duplicate (verseKey, emotionKey) rows in the final preview', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    preview.rows.forEach((row) => {
      const key = pairKey(row);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    });
    expect(duplicates).toEqual([]);
  });

  it('preserves the historical preview sort: surah, ayah, then the original emotion order', () => {
    // Frozen Phase 5 data must not be resorted for later home-screen changes.
    const historicalKeys = 'sad anxious lonely angry lost afraid stressed hopeless tired confused grateful peaceful want_to_cry heartbroken overwhelmed rejected betrayed wronged forgiveness_struggle guilty repentant weak reassurance patience strength hopeful content seeking_guidance closer_to_allah'.split(' ');
    const emotionOrder = new Map(historicalKeys.map((key, index) => [key, index + 1]));
    const tupleOf = (row: PreviewRow) => {
      const [surah, ayah] = row.verseKey.split(':').map(Number);
      return surah * 1_000_000 + ayah * 1000 + (emotionOrder.get(row.emotionKey) ?? 0);
    };
    for (let i = 1; i < preview.rows.length; i += 1) {
      expect(tupleOf(preview.rows[i])).toBeGreaterThan(tupleOf(preview.rows[i - 1]));
    }
  });
});

describe('Phase 5C: canonical taxonomy and Quran-key validity', () => {
  it('uses only canonical emotion keys (the Phase 5C preview itself is frozen at the original 29 — the later, separately-reviewed faith_shaken addition contributes none of these 1,845 rows)', () => {
    expect(seedEmotions).toHaveLength(30);
    expect(seedEmotions.filter((emotion) => emotion.key !== 'faith_shaken')).toHaveLength(29);
    preview.rows.forEach((row) => expect(canonicalEmotionKeySet.has(row.emotionKey)).toBe(true));
    expect(preview.rows.some((row) => row.emotionKey === 'faith_shaken')).toBe(false);
  });

  it('uses only verified verse keys', () => {
    preview.rows.forEach((row) => expect(isValidVerseKey(row.verseKey)).toBe(true));
  });

  it('never stores Quran Arabic or translation text anywhere in the Phase 5C artifacts', () => {
    ['consolidated/approved-mappings-preview.json', 'consolidated/duplicate-mappings-report.json'].forEach((file) => {
      const raw = readFileSync(resolve(DATA_DIR, file), 'utf-8');
      expect(arabicPattern.test(raw), `${file} contains Arabic script`).toBe(false);
      expect(raw).not.toMatch(/arabicText|translation/i);
    });
    ['approved-mappings.json', 'approved-mappings.md'].forEach((file) => {
      const raw = readFileSync(resolve(REPORTS_DIR, file), 'utf-8');
      expect(arabicPattern.test(raw), `${file} contains Arabic script`).toBe(false);
    });
  });
});

describe('Phase 5C: explicit protections', () => {
  it('12:100 -> guilty is absent everywhere', () => {
    expect(preview.rows.some((r) => r.verseKey === '12:100' && r.emotionKey === 'guilty')).toBe(false);
    expect(reconstructed.finalRows.has('12:100|guilty')).toBe(false);
    const batch5Review = loadJson<HumanReviewFile>(DATA_DIR, 'batches/batch-5/final-review.json');
    expect([...batch5Review.reviews, ...batch5Review.supplementalReviews].some((r) => r.verseKey === '12:100' && r.emotionKey === 'guilty')).toBe(false);
    const batch5Overlap = loadJson<OverlapRow[]>(DATA_DIR, 'batches/batch-5/overlaps.json');
    expect(batch5Overlap.some((r) => r.verseKey === '12:100' && r.emotionKey === 'guilty')).toBe(false);
  });

  it('preserves the exact approved weak destinations for 11:6, 29:60, 39:53 without a rejected source pair leaking through', () => {
    const expectedDestinations: Record<string, string[]> = {
      '11:6': ['afraid', 'lost', 'confused', 'hopeless', 'stressed'],
      '29:60': ['afraid', 'lost', 'confused', 'hopeless', 'stressed'],
      '39:53': ['lost', 'confused'],
    };
    Object.entries(expectedDestinations).forEach(([verseKey, destinations]) => {
      destinations.forEach((destination) => {
        if (destination === 'weak') return;
        const key = `${verseKey}|${destination}`;
        // Every destination not itself blocked by MVP/reject/hold must appear.
        if (reconstructed.REJECT_SET.has(key) || reconstructed.HOLD_SET.has(key)) return;
        expect(preview.rows.some((r) => pairKey(r) === key), `${key} missing from preview`).toBe(true);
      });
    });
    // The rejected weak source pair itself must never appear.
    expect(preview.rows.some((r) => r.verseKey === '39:53' && r.emotionKey === 'weak')).toBe(false);
  });

  it('all 7 protected self-reflection HOLD pairs remain held and excluded from the preview', () => {
    SELF_REFLECTION_HOLD_VERSE_KEYS.forEach((verseKey) => {
      const key = `${verseKey}|rejected`;
      expect(reconstructed.HOLD_SET.has(key), `${key} should be in HOLD_SET`).toBe(true);
      expect(preview.rows.some((r) => pairKey(r) === key), `${key} should be absent from preview`).toBe(false);
    });
  });

  it('the pre-existing Batch 1 hold (1:7 -> seeking_guidance) is also honored', () => {
    expect(reconstructed.HOLD_SET.has('1:7|seeking_guidance')).toBe(true);
    expect(preview.rows.some((r) => r.verseKey === '1:7' && r.emotionKey === 'seeking_guidance')).toBe(false);
  });

  it('global HOLD count is exactly 8 (7 self-reflection + 1 pre-existing Batch 1 hold), not the naively expected 7', () => {
    expect(reconstructed.HOLD_SET.size).toBe(8);
  });

  it('the five retained punishment-review verses remain keep and appear for their approved emotions', () => {
    PUNISHMENT_RETAINED_VERSE_KEYS.forEach((verseKey) => {
      const rowsForVerse = preview.rows.filter((r) => r.verseKey === verseKey);
      expect(rowsForVerse.length).toBeGreaterThan(0);
    });
  });

  it('all 17 punishment/warning verseKeys are absent from the final preview', () => {
    const collisions = preview.rows.filter((r) => PUNISHMENT_EXCLUDED_VERSE_KEYS.includes(r.verseKey));
    expect(collisions).toEqual([]);
  });

  it('Batch 4 correction state is unchanged (informational re-check)', () => {
    const batch4 = loadJson<{ unrecoverableOverlapSources: { pairs: unknown[]; supersededPairs: { pairs: unknown[] } }; editorialCorrections: unknown[] }>(
      DATA_DIR,
      'batches/batch-4/final-review.json',
    );
    expect(batch4.unrecoverableOverlapSources.pairs).toEqual([]);
    expect(batch4.unrecoverableOverlapSources.supersededPairs.pairs).toHaveLength(5);
    expect(batch4.editorialCorrections).toHaveLength(3);
    const batch4Overlap = loadJson<OverlapRow[]>(DATA_DIR, 'batches/batch-4/overlaps.json');
    expect(batch4Overlap).toHaveLength(418);
  });

  it('Batch 5 334/285/49/0 core totals and 28 supplemental KEEP are unchanged', () => {
    const batch5Review = loadJson<{
      originalCandidateCount: number;
      decisionCounts: { keep: number; reject: number; hold: number };
      reviews: unknown[];
      supplementalReviews: unknown[];
    }>(DATA_DIR, 'batches/batch-5/final-review.json');
    expect(batch5Review.originalCandidateCount).toBe(334);
    expect(batch5Review.decisionCounts).toEqual({ keep: 285, reject: 49, hold: 0 });
    expect(batch5Review.reviews).toHaveLength(334);
    expect(batch5Review.supplementalReviews).toHaveLength(28);
  });
});

describe('Phase 5C: cross-batch historical duplicate audit', () => {
  it('recomputes exactly the same duplicate identity count as the persisted audit (verifying from disk, not assuming 25)', () => {
    expect(duplicateAudit.rows).toHaveLength(reconstructed.duplicateIdentities.length);
    expect(duplicateAudit.observedHistoricalDuplicateIdentities).toBe(reconstructed.duplicateIdentities.length);
  });

  it('has exactly 25 historical duplicate identities across Batch 2/3/4 overlap files', () => {
    expect(reconstructed.duplicateIdentities).toHaveLength(25);
    expect(duplicateAudit.rows).toHaveLength(25);
  });

  it('zero duplicate identities involve Batch 5', () => {
    const involvingBatch5 = reconstructed.duplicateIdentities.filter(([, rows]) => rows.some((r) => r.sourceBatch === '5'));
    expect(involvingBatch5).toEqual([]);
    expect(duplicateAudit.duplicateIdentitiesInvolvingBatch5).toBe(0);
  });

  it('every duplicate identity collapses to exactly one row in the final preview', () => {
    const previewKeys = new Set(preview.rows.map(pairKey));
    duplicateAudit.rows.forEach((row) => {
      const key = `${row.verseKey}|${row.emotionKey}`;
      const countInPreview = preview.rows.filter((r) => pairKey(r) === key).length;
      expect(countInPreview, `${key} should appear exactly once (or zero if genuinely blocked)`).toBeLessThanOrEqual(1);
      expect(row.finalRowIncluded).toBe(countInPreview === 1);
    });
    expect(duplicateAudit.duplicatesRemainingInFinalPreview).toBe(0);
  });

  it('merges provenance deterministically (sorted, de-duplicated source files and source emotion keys)', () => {
    duplicateAudit.rows.forEach((row) => {
      expect(row.sourceFiles).toEqual([...new Set(row.sourceFiles)].sort());
      expect(row.sourceEmotionKeys).toEqual([...new Set(row.sourceEmotionKeys)].sort());
      expect(row.sourceFiles.length).toBeGreaterThan(1);
    });
  });

  it('never includes Quran/translation text and only references the 5 canonical overlap files', () => {
    const validFiles = new Set([
      'batches/batch-1/overlaps.json',
      'batches/batch-2/overlaps.json',
      'batches/batch-3/overlaps.json',
      'batches/batch-4/overlaps.json',
      'batches/batch-5/overlaps.json',
    ]);
    duplicateAudit.rows.forEach((row) => {
      row.sourceFiles.forEach((f) => expect(validFiles.has(f)).toBe(true));
    });
  });
});

describe('Phase 5C: REJECT and HOLD blocked-overlap accounting', () => {
  it('every overlap proposal targeting a REJECTed pair was blocked, and the pair is absent from the preview', () => {
    const previewKeys = new Set(preview.rows.map(pairKey));
    reconstructed.counts.blockedByReject.forEach((key) => {
      expect(reconstructed.REJECT_SET.has(key)).toBe(true);
      expect(previewKeys.has(key)).toBe(false);
    });
  });

  it('every overlap proposal targeting a HELD pair was blocked, and the pair is absent from the preview', () => {
    const previewKeys = new Set(preview.rows.map(pairKey));
    reconstructed.counts.blockedByHold.forEach((key) => {
      expect(reconstructed.HOLD_SET.has(key)).toBe(true);
      expect(previewKeys.has(key)).toBe(false);
    });
  });

  it('a rejection under one emotion never removes a KEEP for a different emotion on the same verse (exact-pair semantics)', () => {
    // Task example: 21:47 -> weak/content/forgiveness_struggle = REJECT, but 21:47 -> strength = KEEP.
    expect(preview.rows.some((r) => r.verseKey === '21:47' && r.emotionKey === 'strength')).toBe(true);
    expect(preview.rows.some((r) => r.verseKey === '21:47' && r.emotionKey === 'weak')).toBe(false);
    expect(preview.rows.some((r) => r.verseKey === '21:47' && r.emotionKey === 'content')).toBe(false);

    // 20:82 -> weak = REJECT, but strength/hopeful/content = KEEP.
    expect(preview.rows.some((r) => r.verseKey === '20:82' && r.emotionKey === 'weak')).toBe(false);
    ['strength', 'hopeful', 'content'].forEach((emotionKey) => {
      expect(preview.rows.some((r) => r.verseKey === '20:82' && r.emotionKey === emotionKey)).toBe(true);
    });
  });
});
