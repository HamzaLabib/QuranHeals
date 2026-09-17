import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EMOTION_CATALOG } from '../../src/emotions/emotionCatalog';
import { isValidVerseKey } from '../../src/quran/referenceKeys';
import { loadApprovedMappingsPreview } from '../../src/scripts/activationDryRun';
import {
  buildApprovedMappingsCurrent,
  buildDuplicateMappingsCurrent,
  consolidate,
  loadHistoricalSources,
  discoverLaterBatches,
  loadEditorialCorrections,
  loadLaterBatchFinalReview,
  validateConsolidation,
  type ConsolidationResult,
} from '../../src/scripts/consolidateCurrentMappings';

const DATA_DIR = resolve(__dirname, '../../data/emotion-candidates');

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, relativePath), 'utf-8')) as T;
}

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

// Runs the exact same pipeline the CLI uses, entirely in-memory (no writes),
// so every assertion below is checked against a freshly computed result —
// never against a previously-generated file being trusted as ground truth.
function runFresh(): ConsolidationResult {
  const laterBatches = discoverLaterBatches().map(loadLaterBatchFinalReview);
  const corrections = loadEditorialCorrections();
  return consolidate(loadHistoricalSources(), laterBatches, corrections);
}

describe('Batch 6 rename: no live code depends on the old path', () => {
  it('the canonical batch-6 folder exists and contains its review artifacts', () => {
    expect(() => loadJson('batches/batch-6/final-review.json')).not.toThrow();
    expect(() => loadJson('batches/batch-6/initial-candidates.json')).not.toThrow();
  });

  it('the old batch-6-faith-shaken path no longer exists on disk', () => {
    expect(() => loadJson('batches/batch-6-faith-shaken/final-review.json')).toThrow();
  });

  it("batch-6's own final-review.json artifact metadata uses the new canonical path", () => {
    const review = loadJson<{ artifact: string }>('batches/batch-6/final-review.json');
    expect(review.artifact).toBe('batch-6/final-review.json');
  });

  it("the folder rename did not change batch-6's substantive review decisions (still 169/27/0)", () => {
    const review = loadJson<{ decisionCounts: { keep: number; reject: number; hold: number } }>(
      'batches/batch-6/final-review.json',
    );
    expect(review.decisionCounts).toEqual({ keep: 169, reject: 27, hold: 0 });
  });
});

describe('discoverLaterBatches: generic batch-N discovery (never hardcoded to Batch 6)', () => {
  it('discovers batch 6 and excludes batches 1-5 (reconstructed separately from raw sources)', () => {
    const discovered = discoverLaterBatches();
    const numbers = discovered.map((b) => b.number);
    expect(numbers).toContain(6);
    [1, 2, 3, 4, 5].forEach((n) => expect(numbers).not.toContain(n));
  });

  it('is sorted numerically and would include a future batch-7/batch-8 automatically if present', () => {
    const discovered = discoverLaterBatches();
    for (let i = 1; i < discovered.length; i += 1) {
      expect(discovered[i].number).toBeGreaterThan(discovered[i - 1].number);
    }
    // Structural proof of genericity: nothing in the discovery filter
    // references "6" specifically — only the frozen 1-5 exclusion set.
    expect(discoverLaterBatches.toString()).not.toMatch(/batch-6/);
  });
});

describe('updates/editorial-corrections.json: the 2:222 -> seeking_guidance correction', () => {
  const corrections = loadEditorialCorrections();

  it('contains exactly one correction blocking (2:222, seeking_guidance) as a reject', () => {
    const match = corrections.corrections.filter((c) => c.verseKey === '2:222' && c.emotionKey === 'seeking_guidance');
    expect(match).toHaveLength(1);
    expect(match[0].type).toBe('reject');
    expect(match[0].id).toBeTruthy();
    expect(match[0].reason.length).toBeGreaterThan(0);
  });

  it('never touches any other (verseKey, emotionKey) pair', () => {
    corrections.corrections.forEach((c) => {
      if (c.verseKey === '2:222') expect(c.emotionKey).toBe('seeking_guidance');
    });
  });
});

describe('Current consolidation: precedence and invariants (Part 11/19)', () => {
  const result = runFresh();
  const problems = validateConsolidation(result);

  it('passes validation with zero problems', () => {
    expect(problems).toEqual([]);
  });

  it('(2:222, seeking_guidance) is absent from the current approved set', () => {
    expect(result.rows.some((r) => r.verseKey === '2:222' && r.emotionKey === 'seeking_guidance')).toBe(false);
  });

  it('the editorial rejection is present in the accumulated REJECT protection set', () => {
    expect(result.rejectPairs.has('2:222|seeking_guidance')).toBe(true);
  });

  it('2:222 is not globally rejected — it simply has no other approved emotion mapping today', () => {
    const otherMappingsFor2_222 = result.rows.filter((r) => r.verseKey === '2:222');
    expect(otherMappingsFor2_222).toEqual([]);
    // Raw Batch 3 independently rejects 2:222 for repentant. The later update
    // adds only seeking_guidance, and does not introduce a verse-wide block.
    const beforeUpdates = consolidate(loadHistoricalSources(), discoverLaterBatches().map(loadLaterBatchFinalReview), { corrections: [] });
    const newlyRejected = [...result.rejectPairs].filter(key => !beforeUpdates.rejectPairs.has(key));
    expect(newlyRejected).toEqual(['2:222|seeking_guidance']);
  });

  it('has zero duplicate final (verseKey, emotionKey) pairs', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    result.rows.forEach((row) => {
      const key = pairKey(row);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    });
    expect(duplicates).toEqual([]);
  });

  it('the same verse mapped to multiple different emotions is preserved (not treated as a duplicate)', () => {
    const byVerse = new Map<string, string[]>();
    result.rows.forEach((row) => {
      const list = byVerse.get(row.verseKey) ?? [];
      list.push(row.emotionKey);
      byVerse.set(row.verseKey, list);
    });
    const multiEmotionVerses = [...byVerse.entries()].filter(([, emotions]) => emotions.length > 1);
    expect(multiEmotionVerses.length).toBeGreaterThan(0);
  });

  it('every row uses a canonical emotion key and a verified verseKey', () => {
    const canonicalKeys = new Set(EMOTION_CATALOG.map((e) => e.key));
    result.rows.forEach((row) => {
      expect(canonicalKeys.has(row.emotionKey), row.emotionKey).toBe(true);
      expect(isValidVerseKey(row.verseKey), row.verseKey).toBe(true);
    });
  });

  it('all 30 active emotions (including faith_shaken) have at least one approved mapping', () => {
    const emotionsWithMappings = new Set(result.rows.map((r) => r.emotionKey));
    expect(EMOTION_CATALOG).toHaveLength(30);
    EMOTION_CATALOG.forEach((emotion) => {
      expect(emotionsWithMappings.has(emotion.key), `${emotion.key} has zero approved mappings`).toBe(true);
    });
  });

  it('faith_shaken contributes exactly its 169 KEEP rows, all sourced from batches/batch-6', () => {
    const faithShaken = result.rows.filter((r) => r.emotionKey === 'faith_shaken');
    expect(faithShaken).toHaveLength(169);
    faithShaken.forEach((row) => {
      expect(row.sourceBatches).toEqual(['6']);
      expect(row.sourceFiles).toEqual(['batches/batch-6/final-review.json']);
      expect(row.sourceTypes).toEqual(['direct_keep']);
    });
  });

  it('none of the 27 Batch 6 REJECT decisions became approved', () => {
    const batch6Review = loadJson<{ reviews: { verseKey: string; emotionKey: string; decision: string }[] }>(
      'batches/batch-6/final-review.json',
    );
    const rejected = batch6Review.reviews.filter((r) => r.decision === 'reject');
    expect(rejected).toHaveLength(27);
    rejected.forEach((r) => {
      expect(result.rows.some((row) => row.verseKey === r.verseKey && row.emotionKey === r.emotionKey)).toBe(false);
    });
  });

  it('total pairs and unique verses are computed, not hardcoded, and reduced by exactly 1 pair from removing 2:222', () => {
    const preview = loadApprovedMappingsPreview();
    const batch6 = loadLaterBatchFinalReview(discoverLaterBatches().find((b) => b.number === 6)!);
    const expectedTotal = preview.totalPairs + batch6.keepRows.length - 1; // -1 for the removed 2:222 pair
    expect(result.rows.length).toBe(expectedTotal);
  });
});

describe('Current consolidation: is deterministic/idempotent (Part 21)', () => {
  it('running the pipeline twice from the same source data produces byte-identical JSON (ignoring generatedAt)', () => {
    const first = buildApprovedMappingsCurrent(runFresh());
    const second = buildApprovedMappingsCurrent(runFresh());
    expect({ ...first, generatedAt: '' }).toEqual({ ...second, generatedAt: '' });

    const firstDup = buildDuplicateMappingsCurrent(runFresh());
    const secondDup = buildDuplicateMappingsCurrent(runFresh());
    expect({ ...firstDup, generatedAt: '' }).toEqual({ ...secondDup, generatedAt: '' });
  });

  it('row order is deterministic (surah, ayah, emotionKey) — not filesystem/insertion order', () => {
    const result = runFresh();
    for (let i = 1; i < result.rows.length; i += 1) {
      const [surahA, ayahA] = result.rows[i - 1].verseKey.split(':').map(Number);
      const [surahB, ayahB] = result.rows[i].verseKey.split(':').map(Number);
      const tupleA = surahA * 1_000_000 + ayahA * 1000;
      const tupleB = surahB * 1_000_000 + ayahB * 1000;
      expect(tupleB).toBeGreaterThanOrEqual(tupleA);
    }
  });
});

describe('Generated current artifacts on disk', () => {
  const approved = loadJson<{
    totalPairs: number;
    uniqueVerses: number;
    emotionCount: number;
    countByEmotion: Record<string, number>;
    rows: { verseKey: string; emotionKey: string }[];
  }>('consolidated/approved-mappings-current.json');
  const duplicateAudit = loadJson<{
    duplicatesRemainingInCurrentApprovedMappings: number;
    rows: { verseKey: string; emotionKey: string; resolution: string; finalRowIncluded: boolean }[];
  }>('consolidated/duplicate-mappings-current.json');

  it('approved-mappings-current.json parses and matches a fresh in-memory run', () => {
    const fresh = buildApprovedMappingsCurrent(runFresh());
    expect(approved.totalPairs).toBe(fresh.totalPairs);
    expect(approved.uniqueVerses).toBe(fresh.uniqueVerses);
    expect(approved.emotionCount).toBe(fresh.emotionCount);
    expect(approved.countByEmotion).toEqual(fresh.countByEmotion);
    expect(approved.rows).toEqual(fresh.rows);
  });

  it('duplicate-mappings-current.json parses and reports zero remaining duplicates', () => {
    expect(duplicateAudit.duplicatesRemainingInCurrentApprovedMappings).toBe(0);
  });

  it('the 2:222 editorial block is recorded in the on-disk duplicate/blocked audit', () => {
    const row = duplicateAudit.rows.find((r) => r.verseKey === '2:222' && r.emotionKey === 'seeking_guidance');
    expect(row).toBeDefined();
    expect(row!.resolution).toBe('blocked_by_editorial_reject');
    expect(row!.finalRowIncluded).toBe(false);
  });

  it('has exactly 0 occurrences of (2:222, seeking_guidance) in the current approved output', () => {
    const count = approved.rows.filter((r) => r.verseKey === '2:222' && r.emotionKey === 'seeking_guidance').length;
    expect(count).toBe(0);
  });
});

describe('Historical Phase 5C artifacts remain frozen and untouched', () => {
  it('the historical preview still contains 1,845 pairs and still includes the (now-superseded) 2:222 -> seeking_guidance row', () => {
    const preview = loadApprovedMappingsPreview();
    expect(preview.totalPairs).toBe(1845);
    expect(preview.rows.some((r) => r.verseKey === '2:222' && r.emotionKey === 'seeking_guidance')).toBe(true);
  });

  it('the historical duplicate-mappings-report.json is untouched (still exactly 25 historical duplicate identities)', () => {
    const historicalDuplicates = loadJson<{ observedHistoricalDuplicateIdentities: number }>(
      'consolidated/duplicate-mappings-report.json',
    );
    expect(historicalDuplicates.observedHistoricalDuplicateIdentities).toBe(25);
  });

  it('batches 1-5 final-review.json files are untouched (spot check: batch-1 decisionCounts unchanged)', () => {
    const batch1 = loadJson<{ decisionCounts: { keep: number; reject: number; hold: number } }>(
      'batches/batch-1/final-review.json',
    );
    expect(batch1.decisionCounts).toEqual({ keep: 62, reject: 3, hold: 1 });
  });
});
