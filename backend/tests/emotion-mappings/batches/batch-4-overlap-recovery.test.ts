import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isValidVerseKey } from '../../../src/quran/referenceKeys';
import { seedAyahs } from '../../../src/seed/ayahs';
import { seedEmotions } from '../../../src/seed/emotions';

// This suite locks in the `phase5b-batch4-overlap-source-recovery` editorial
// correction: the human reviewer supplied the exact accepted overlap
// destinations for all 120 core KEEP pairs that `unrecoverableOverlapSources`
// had previously left unresolved. It re-derives the expected persisted
// overlap rows from the reviewer-supplied data using the same dedup rules the
// correction was built on, and diffs that against what is actually on disk -
// so any future edit to the overlap file that silently drops, invents, or
// re-duplicates a row fails here.

const DATA_DIR = resolve(__dirname, '../../../data/emotion-candidates');
const FIXTURES_DIR = resolve(__dirname, '../../fixtures/emotion-mappings');

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, fileName), 'utf-8')) as T;
}

function loadFixture<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, fileName), 'utf-8')) as T;
}

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

type ReviewRow = { verseKey: string; emotionKey: string; decision: 'keep' | 'reject' | 'hold' };
type HumanReviewFile = { reviews: ReviewRow[]; supplementalReviews: ReviewRow[] };
type OverlapRow = { verseKey: string; emotionKey: string; sourceEmotionKeys: string[] };

// -------------------------------------------------------------------------
// Exact reviewer-supplied data: [verseKey, sourceEmotion, destinations[]].
// This is the ground truth the correction was built from - the same 120
// entries that were listed in `unrecoverableOverlapSources.pairs` before the
// correction (verified in the "reconstructs..." test below).
// -------------------------------------------------------------------------
const REVIEWER_SUPPLIED_OVERLAPS: [string, string, string[]][] = [
  // SAD
  ['2:38', 'sad', ['afraid','anxious','hopeless','reassurance','hopeful','seeking_guidance','closer_to_allah','confused','lost','peaceful','content','strength']],
  ['2:112', 'sad', ['afraid','anxious','reassurance','hopeful','peaceful','content','closer_to_allah','seeking_guidance','strength','hopeless']],
  ['2:152', 'sad', ['lonely','grateful','reassurance','content','peaceful','closer_to_allah','hopeful','seeking_guidance','weak','hopeless']],
  ['2:255', 'sad', ['afraid','anxious','lonely','reassurance','peaceful','strength','weak','overwhelmed','closer_to_allah','hopeful','content']],
  ['3:120', 'sad', ['betrayed','wronged','rejected','angry','heartbroken','want_to_cry','patience','strength','reassurance','forgiveness_struggle']],
  ['3:139', 'sad', ['hopeless','heartbroken','weak','strength','reassurance','hopeful','patience','overwhelmed','afraid','want_to_cry']],
  ['3:186', 'sad', ['angry','betrayed','wronged','rejected','heartbroken','want_to_cry','patience','strength','forgiveness_struggle','stressed','overwhelmed','reassurance']],
  ['9:51', 'sad', ['afraid','anxious','reassurance','overwhelmed','heartbroken','want_to_cry','weak','strength','hopeful','content','peaceful','closer_to_allah','angry','lost','confused']],
  ['9:129', 'sad', ['lonely','rejected','betrayed','wronged','heartbroken','want_to_cry','hopeless','reassurance','strength','weak','afraid','anxious','closer_to_allah','hopeful','content']],
  ['10:62', 'sad', ['afraid','anxious','reassurance','peaceful','content','hopeful','hopeless','closer_to_allah','strength','weak']],
  ['12:18', 'sad', ['heartbroken','want_to_cry','betrayed','wronged','lonely','patience','strength','reassurance','overwhelmed','weak','hopeless','closer_to_allah']],
  ['14:42', 'sad', ['wronged','betrayed','rejected','angry','heartbroken','want_to_cry','hopeless','reassurance','strength','patience','closer_to_allah']],
  ['58:10', 'sad', ['betrayed','wronged','rejected','anxious','afraid','heartbroken','want_to_cry','reassurance','strength','closer_to_allah','peaceful']],
  ['65:3', 'sad', ['anxious','hopeless','overwhelmed','reassurance','hopeful','strength','weak','content','peaceful','closer_to_allah','betrayed','rejected','lost','confused']],
  ['70:5', 'sad', ['patience','heartbroken','want_to_cry','betrayed','wronged','rejected','strength','weak','overwhelmed','hopeless','reassurance','closer_to_allah']],
  ['12:86', 'sad', ['heartbroken','want_to_cry','lonely','overwhelmed','hopeless','reassurance','patience','strength','weak','closer_to_allah','hopeful','content']],
  ['12:84', 'sad', ['heartbroken','want_to_cry','lonely','overwhelmed','weak','hopeless']],
  // LONELY
  ['2:152', 'lonely', ['reassurance','closer_to_allah','grateful','content','peaceful','hopeful','sad','weak','hopeless','guilty','repentant']],
  ['2:255', 'lonely', ['reassurance','afraid','anxious','sad','overwhelmed','weak','strength','peaceful','content','hopeful','closer_to_allah']],
  ['3:186', 'lonely', ['stressed','sad','heartbroken','want_to_cry','rejected','betrayed','wronged','patience','strength','weak','overwhelmed','forgiveness_struggle','angry']],
  ['4:45', 'lonely', ['betrayed','rejected','wronged','afraid','anxious','sad','heartbroken','reassurance','strength','weak','closer_to_allah','hopeful']],
  ['9:129', 'lonely', ['rejected','betrayed','wronged','sad','heartbroken','want_to_cry','hopeless','reassurance','strength','weak','afraid','anxious','closer_to_allah','hopeful','content']],
  ['12:18', 'lonely', ['sad','heartbroken','want_to_cry','betrayed','wronged','patience','strength','weak','overwhelmed','hopeless','reassurance','closer_to_allah']],
  ['20:46', 'lonely', ['afraid','anxious','reassurance','strength','weak','overwhelmed','sad','closer_to_allah','hopeful','peaceful','seeking_guidance']],
  ['40:44', 'lonely', ['betrayed','wronged','rejected','sad','heartbroken','want_to_cry','anxious','afraid','overwhelmed','reassurance','strength','weak','closer_to_allah','seeking_guidance']],
  ['57:4', 'lonely', ['reassurance','afraid','anxious','sad','overwhelmed','weak','strength','closer_to_allah','hopeful','peaceful','content','guilty','repentant','seeking_guidance','confused']],
  ['21:89', 'lonely', ['hopeful','reassurance','sad','heartbroken','want_to_cry','weak','hopeless','closer_to_allah','seeking_guidance','patience']],
  ['12:86', 'lonely', ['sad','heartbroken','want_to_cry','overwhelmed','hopeless','reassurance','patience','strength','weak','closer_to_allah','hopeful','content']],
  // STRESSED
  ['94:1', 'stressed', ['overwhelmed','anxious','sad','heartbroken','reassurance','peaceful','strength','weak','hopeful','closer_to_allah']],
  ['94:2', 'stressed', ['overwhelmed','tired','weak','reassurance','hopeful','strength','sad','closer_to_allah']],
  ['94:3', 'stressed', ['overwhelmed','tired','weak','heartbroken']],
  ['20:25', 'stressed', ['anxious','overwhelmed','afraid','weak','strength','reassurance','seeking_guidance','closer_to_allah','confused']],
  ['20:26', 'stressed', ['anxious','overwhelmed','tired','weak','reassurance','hopeful','strength','seeking_guidance','confused','lost','closer_to_allah']],
  ['92:7', 'stressed', ['hopeful','reassurance','strength','weak','tired','overwhelmed','content','closer_to_allah','seeking_guidance']],
  ['7:42', 'stressed', ['overwhelmed','tired','weak','strength','reassurance','hopeful','hopeless','content','peaceful','patience','closer_to_allah']],
  ['23:62', 'stressed', ['overwhelmed','tired','weak','strength','reassurance','wronged','hopeful','patience','closer_to_allah']],
  ['65:4', 'stressed', ['hopeful','reassurance','closer_to_allah','seeking_guidance','content']],
  // HOPELESS
  ['3:31', 'hopeless', ['guilty','repentant','hopeful','reassurance','closer_to_allah','seeking_guidance','content','weak']],
  ['3:135', 'hopeless', ['guilty','repentant','hopeful','reassurance','closer_to_allah','seeking_guidance','weak','strength']],
  ['3:139', 'hopeless', ['sad','heartbroken','weak','strength','reassurance','hopeful','patience','want_to_cry']],
  ['4:110', 'hopeless', ['guilty','repentant','reassurance','hopeful','closer_to_allah','seeking_guidance','weak']],
  ['6:64', 'hopeless', ['overwhelmed','afraid','guilty','repentant','reassurance','closer_to_allah','seeking_guidance','stressed']],
  ['7:23', 'hopeless', ['guilty','repentant','want_to_cry','heartbroken','weak','closer_to_allah','seeking_guidance','reassurance']],
  ['7:43', 'hopeless', ['hopeful','content','peaceful','reassurance','closer_to_allah','seeking_guidance','grateful','heartbroken','angry','forgiveness_struggle']],
  ['9:104', 'hopeless', ['repentant','guilty','hopeful','reassurance','closer_to_allah','seeking_guidance','content']],
  ['9:129', 'hopeless', ['lonely','rejected','betrayed','wronged','sad','heartbroken','reassurance','strength','weak','closer_to_allah','hopeful']],
  ['11:6', 'hopeless', ['anxious','stressed','tired','reassurance','hopeful','weak','content','closer_to_allah']],
  ['11:11', 'hopeless', ['patience','hopeful','strength','guilty','repentant','reassurance','weak','content']],
  ['12:87', 'hopeless', ['hopeful','heartbroken','sad','want_to_cry','patience','strength','reassurance','closer_to_allah','seeking_guidance']],
  ['14:42', 'hopeless', ['wronged','betrayed','rejected','angry','sad','heartbroken','want_to_cry','reassurance','strength','patience']],
  ['19:60', 'hopeless', ['repentant','guilty','hopeful','reassurance','wronged','closer_to_allah','seeking_guidance','strength']],
  ['20:82', 'hopeless', ['repentant','guilty','hopeful','reassurance','seeking_guidance','closer_to_allah','strength','content']],
  ['21:47', 'hopeless', ['wronged','betrayed','rejected','reassurance','strength','closer_to_allah','seeking_guidance','content']],
  ['21:87', 'hopeless', ['guilty','repentant','overwhelmed','afraid','want_to_cry','weak','lost','closer_to_allah','seeking_guidance']],
  ['25:70', 'hopeless', ['repentant','guilty','hopeful','reassurance','closer_to_allah','seeking_guidance','strength','content']],
  ['27:62', 'hopeless', ['overwhelmed','stressed','afraid','anxious','wronged','want_to_cry','weak','reassurance','closer_to_allah']],
  ['29:60', 'hopeless', ['anxious','stressed','tired','weak','reassurance','hopeful','content','closer_to_allah']],
  ['42:25', 'hopeless', ['repentant','guilty','hopeful','reassurance','closer_to_allah','seeking_guidance','weak','content']],
  ['57:28', 'hopeless', ['lost','confused','seeking_guidance','guilty','repentant','hopeful','reassurance','closer_to_allah','weak','strength']],
  ['65:3', 'hopeless', ['anxious','stressed','tired','reassurance','hopeful','strength','weak','content','peaceful','closer_to_allah','lost','confused']],
  ['66:8', 'hopeless', ['repentant','guilty','hopeful','reassurance','closer_to_allah','seeking_guidance','want_to_cry','weak','strength','content']],
  ['70:5', 'hopeless', ['patience','sad','heartbroken','want_to_cry','weak','strength','overwhelmed','reassurance','closer_to_allah']],
  // TIRED
  ['2:45', 'tired', ['patience','weak','strength','stressed','overwhelmed','reassurance','closer_to_allah','seeking_guidance']],
  ['2:155', 'tired', ['patience','heartbroken','sad','afraid','stressed','overwhelmed','weak','strength','hopeful','reassurance','want_to_cry']],
  ['2:156', 'tired', ['patience','sad','heartbroken','want_to_cry','weak','reassurance','closer_to_allah','content']],
  ['11:6', 'tired', ['anxious','stressed','hopeless','reassurance','hopeful','weak','content','closer_to_allah']],
  ['29:60', 'tired', ['anxious','stressed','hopeless','weak','reassurance','hopeful','content','closer_to_allah']],
  ['31:17', 'tired', ['patience','strength','weak','stressed','overwhelmed','closer_to_allah','seeking_guidance']],
  ['39:10', 'tired', ['patience','hopeful','strength','weak','reassurance','content','closer_to_allah','hopeless']],
  ['70:5', 'tired', ['patience','strength','weak','sad','heartbroken','want_to_cry','hopeless','overwhelmed','reassurance']],
  ['3:146', 'tired', ['weak','strength','patience','stressed','overwhelmed','hopeful','reassurance','closer_to_allah']],
  ['20:2', 'tired', ['stressed','overwhelmed','weak','reassurance','peaceful','hopeful','closer_to_allah','seeking_guidance']],
  ['35:35', 'tired', ['hopeful','reassurance','content','peaceful','weak','hopeless','patience','closer_to_allah']],
  ['25:47', 'tired', ['peaceful','content','grateful','reassurance','stressed','weak','closer_to_allah']],
  ['28:73', 'tired', ['peaceful','content','grateful','reassurance','stressed','weak','hopeful','closer_to_allah']],
  // WANT_TO_CRY
  ['3:120', 'want_to_cry', ['betrayed','wronged','rejected','angry','sad','heartbroken','patience','strength','reassurance','forgiveness_struggle']],
  ['3:173', 'want_to_cry', ['afraid','anxious','betrayed','wronged','overwhelmed','reassurance','strength','weak','hopeful','closer_to_allah','seeking_guidance']],
  ['3:186', 'want_to_cry', ['stressed','sad','heartbroken','rejected','betrayed','wronged','patience','strength','weak','overwhelmed','forgiveness_struggle','angry']],
  ['7:23', 'want_to_cry', ['guilty','repentant','hopeless','heartbroken','weak','reassurance','closer_to_allah','seeking_guidance']],
  ['7:43', 'want_to_cry', ['hopeful','content','peaceful','grateful','reassurance','closer_to_allah','seeking_guidance','angry','forgiveness_struggle']],
  ['9:51', 'want_to_cry', ['afraid','anxious','sad','overwhelmed','heartbroken','weak','strength','reassurance','hopeful','peaceful','content','closer_to_allah','lost','confused']],
  ['9:129', 'want_to_cry', ['lonely','rejected','betrayed','wronged','sad','heartbroken','hopeless','reassurance','strength','weak','afraid','anxious','closer_to_allah','hopeful','content']],
  ['12:18', 'want_to_cry', ['sad','heartbroken','betrayed','wronged','lonely','patience','strength','reassurance','overwhelmed','weak','hopeless','closer_to_allah']],
  ['14:42', 'want_to_cry', ['wronged','betrayed','rejected','angry','sad','heartbroken','hopeless','reassurance','strength','patience','closer_to_allah']],
  ['16:126', 'want_to_cry', ['angry','wronged','betrayed','rejected','heartbroken','forgiveness_struggle','patience','strength']],
  ['17:25', 'want_to_cry', ['guilty','repentant','hopeful','reassurance','weak','closer_to_allah','seeking_guidance']],
  ['21:87', 'want_to_cry', ['guilty','repentant','hopeless','overwhelmed','afraid','weak','lost','closer_to_allah','seeking_guidance']],
  ['27:62', 'want_to_cry', ['overwhelmed','stressed','afraid','anxious','wronged','weak','hopeless','reassurance','hopeful','closer_to_allah']],
  ['39:53', 'want_to_cry', ['guilty','repentant','hopeless','hopeful','reassurance','weak','sad','closer_to_allah','seeking_guidance']],
  ['42:25', 'want_to_cry', ['guilty','repentant','hopeful','reassurance','weak','content','closer_to_allah','seeking_guidance']],
  ['42:40', 'want_to_cry', ['angry','wronged','betrayed','rejected','heartbroken','forgiveness_struggle','patience','strength']],
  ['42:43', 'want_to_cry', ['patience','forgiveness_struggle','angry','wronged','betrayed','heartbroken','strength','weak']],
  ['58:10', 'want_to_cry', ['sad','betrayed','wronged','rejected','anxious','afraid','heartbroken','reassurance','strength','peaceful','closer_to_allah']],
  ['65:3', 'want_to_cry', ['anxious','stressed','tired','hopeless','reassurance','hopeful','strength','weak','content','peaceful','closer_to_allah','lost','confused']],
  ['66:8', 'want_to_cry', ['repentant','guilty','hopeless','hopeful','reassurance','weak','strength','content','closer_to_allah','seeking_guidance']],
  ['70:5', 'want_to_cry', ['patience','sad','heartbroken','weak','strength','overwhelmed','hopeless','reassurance','closer_to_allah','betrayed','wronged','rejected']],
  ['12:86', 'want_to_cry', ['sad','heartbroken','lonely','overwhelmed','hopeless','reassurance','patience','strength','weak','hopeful','content','closer_to_allah']],
  ['12:84', 'want_to_cry', ['sad','heartbroken','lonely','overwhelmed','weak','hopeless']],
  // REJECTED
  ['3:120', 'rejected', ['betrayed','wronged','angry','sad','heartbroken','want_to_cry','patience','strength','reassurance','forgiveness_struggle']],
  ['3:160', 'rejected', ['betrayed','lonely','wronged','weak','afraid','anxious','reassurance','strength','hopeful','closer_to_allah']],
  ['3:173', 'rejected', ['afraid','anxious','betrayed','wronged','overwhelmed','reassurance','strength','weak','hopeful','closer_to_allah','seeking_guidance']],
  ['3:186', 'rejected', ['betrayed','wronged','sad','heartbroken','want_to_cry','angry','stressed','overwhelmed','patience','strength','forgiveness_struggle']],
  ['4:45', 'rejected', ['betrayed','wronged','lonely','afraid','anxious','sad','heartbroken','reassurance','strength','weak','closer_to_allah','hopeful']],
  ['4:148', 'rejected', ['wronged','betrayed','angry','heartbroken','sad','want_to_cry','forgiveness_struggle','reassurance']],
  ['8:62', 'rejected', ['betrayed','wronged','afraid','anxious','lonely','reassurance','strength','hopeful','closer_to_allah']],
  ['9:51', 'rejected', ['betrayed','wronged','sad','heartbroken','want_to_cry','afraid','anxious','overwhelmed','reassurance','strength','hopeful','peaceful','closer_to_allah']],
  ['9:129', 'rejected', ['lonely','betrayed','wronged','sad','heartbroken','want_to_cry','hopeless','reassurance','strength','weak','afraid','anxious','closer_to_allah','hopeful','content']],
  ['14:42', 'rejected', ['wronged','betrayed','angry','sad','heartbroken','want_to_cry','hopeless','reassurance','strength','patience','closer_to_allah']],
  ['16:126', 'rejected', ['angry','wronged','betrayed','heartbroken','want_to_cry','forgiveness_struggle','patience','strength']],
  ['16:127', 'rejected', ['sad','heartbroken','want_to_cry','betrayed','wronged','stressed','overwhelmed','patience','strength','reassurance','closer_to_allah']],
  ['23:96', 'rejected', ['angry','wronged','betrayed','forgiveness_struggle','patience','strength','reassurance']],
  ['25:63', 'rejected', ['angry','wronged','betrayed','forgiveness_struggle','peaceful','patience','strength','content','closer_to_allah']],
  ['28:55', 'rejected', ['angry','wronged','betrayed','forgiveness_struggle','peaceful','patience','strength','content']],
  ['40:44', 'rejected', ['lonely','betrayed','wronged','sad','heartbroken','want_to_cry','anxious','afraid','overwhelmed','reassurance','strength','weak','closer_to_allah','seeking_guidance']],
  ['42:40', 'rejected', ['wronged','betrayed','angry','heartbroken','want_to_cry','forgiveness_struggle','patience','strength']],
  ['42:41', 'rejected', ['wronged','betrayed','angry','strength','reassurance','heartbroken']],
  ['42:43', 'rejected', ['wronged','betrayed','angry','heartbroken','want_to_cry','forgiveness_struggle','patience','strength','weak']],
  ['58:10', 'rejected', ['betrayed','wronged','sad','heartbroken','want_to_cry','anxious','afraid','reassurance','strength','peaceful','closer_to_allah']],
  ['65:3', 'rejected', ['lonely','betrayed','sad','heartbroken','anxious','stressed','hopeless','overwhelmed','reassurance','hopeful','strength','weak','content','peaceful','closer_to_allah','lost','confused']],
  ['70:5', 'rejected', ['betrayed','wronged','angry','sad','heartbroken','want_to_cry','tired','hopeless','overwhelmed','weak','strength','patience','reassurance','closer_to_allah']],
];

// The 5 punishment/warning source pairs that were removed from the original
// 125 unrecoverable pairs before this correction ran (they must NOT be
// re-added as overlap sources - their core decision is `reject`).
const SUPERSEDED_SOURCE_PAIRS = new Set([
  '39:54|hopeless',
  '46:35|tired',
  '46:35|want_to_cry',
  '42:42|rejected',
  '46:35|rejected',
]);

const OVERLAP_FILES = [
  'batches/batch-1/overlaps.json',
  'batches/batch-2/overlaps.json',
  'batches/batch-3/overlaps.json',
  'batches/batch-4/overlaps.json',
] as const;
const BATCH4_OVERLAP_FILE = 'batches/batch-4/overlaps.json';

/**
 * Reproduces the exact dedup/merge algorithm the overlap-source-recovery
 * correction was built on (see the scratchpad `resolve-overlaps.js` that
 * generated the persisted files): a pair already represented by a direct
 * Batch 1-4 decision or an MVP mapping is skipped; a pair already tracked by
 * an overlap row is merged into that row wherever it lives (batch4's own
 * pre-existing rows take priority when a pair is tracked in more than one
 * overlap file, because batch4 is the file this correction owns and edits);
 * otherwise a brand-new row is created. The "pre-existing" batch4 rows are
 * read from a frozen fixture snapshot (taken before this correction ran),
 * not from the live file, so this stays a true regression check even after
 * the corrected artifact is committed - re-reading the live file here would
 * make the test compare the corrected output against itself.
 */
function computeExpectedBatch4Overlap(
  directPairs: Set<string>,
  mvpPairs: Set<string>,
): { expected: Map<string, Set<string>>; overlapIndex: Map<string, string> } {
  const overlapIndex = new Map<string, string>(); // pairKey -> file, for the skip-check ONLY

  // Earlier batches' overlap files only inform "already tracked elsewhere"
  // (the skip check) - their rows do NOT belong in `expected`, because
  // `expected` models the batch4 overlap file specifically, and `actual`
  // (below) reads only that one file too.
  const EARLIER_OVERLAP_FILES = [
    'batches/batch-1/overlaps.json',
    'batches/batch-2/overlaps.json',
    'batches/batch-3/overlaps.json',
  ] as const;
  EARLIER_OVERLAP_FILES.forEach((f) => {
    loadJson<OverlapRow[]>(f).forEach((row) => overlapIndex.set(pairKey(row), f));
  });

  // Batch4's PRE-correction rows (frozen fixture) both seed `expected` and
  // take priority in `overlapIndex`, exactly matching the write script's
  // file-processing order (batch4 processed last, so its entry wins).
  const expected = new Map<string, Set<string>>();
  loadFixture<OverlapRow[]>('batch-4-overlaps-pre-recovery.json').forEach((row) => {
    const key = pairKey(row);
    overlapIndex.set(key, BATCH4_OVERLAP_FILE);
    expected.set(key, new Set(row.sourceEmotionKeys));
  });

  REVIEWER_SUPPLIED_OVERLAPS.forEach(([verseKey, sourceEmotion, destinations]) => {
    destinations.forEach((destEmotion) => {
      const key = `${verseKey}|${destEmotion}`;
      if (directPairs.has(key)) return; // already a direct decision - not an overlap
      if (mvpPairs.has(key)) return; // already an existing MVP mapping
      const existingFile = overlapIndex.get(key);
      if (existingFile && existingFile !== BATCH4_OVERLAP_FILE) return; // tracked in another file - not duplicated
      // Either a batch4 row already exists for this pair (merge into it) or
      // it's brand new (create it) - both cases just add to the same map.
      const set = expected.get(key) ?? new Set<string>();
      set.add(sourceEmotion);
      expected.set(key, set);
      if (!existingFile) overlapIndex.set(key, BATCH4_OVERLAP_FILE);
    });
  });

  return { expected, overlapIndex };
}

describe('Phase 5B Batch 4 overlap-source recovery (unrecoverableOverlapSources resolution)', () => {
  const humanReview = loadJson<HumanReviewFile & { unrecoverableOverlapSources: { pairs: unknown[] } }>(
    'batches/batch-4/final-review.json',
  );
  const overlap = loadJson<OverlapRow[]>('batches/batch-4/overlaps.json');

  const mvpPairs = new Set(
    seedAyahs.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`)),
  );
  const canonicalEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));

  const batch1 = loadJson<HumanReviewFile>('batches/batch-1/final-review.json');
  const batch2 = loadJson<HumanReviewFile>('batches/batch-2/final-review.json');
  const batch3 = loadJson<HumanReviewFile>('batches/batch-3/final-review.json');
  const directPairs = new Set<string>();
  [batch1, batch2, batch3, humanReview].forEach((hr) => {
    hr.reviews.forEach((r) => directPairs.add(pairKey(r)));
    hr.supplementalReviews.forEach((r) => directPairs.add(pairKey(r)));
  });

  it('has exactly 120 reviewer-supplied source pairs, none of which are the 5 superseded ones', () => {
    expect(REVIEWER_SUPPLIED_OVERLAPS).toHaveLength(120);
    REVIEWER_SUPPLIED_OVERLAPS.forEach(([verseKey, sourceEmotion]) => {
      expect(SUPERSEDED_SOURCE_PAIRS.has(`${verseKey}|${sourceEmotion}`)).toBe(false);
    });
  });

  it('every reviewer-supplied source pair is an actual core KEEP row in Batch 4', () => {
    const keepPairs = new Set(
      humanReview.reviews.filter((row) => row.decision === 'keep').map(pairKey),
    );
    REVIEWER_SUPPLIED_OVERLAPS.forEach(([verseKey, sourceEmotion]) => {
      expect(keepPairs.has(`${verseKey}|${sourceEmotion}`), `${verseKey}|${sourceEmotion} must be a core KEEP`).toBe(
        true,
      );
    });
  });

  it('every reviewer-supplied destination is a canonical emotion key', () => {
    const badDestinations = REVIEWER_SUPPLIED_OVERLAPS.flatMap(([, , destinations]) =>
      destinations.filter((d) => !canonicalEmotionKeys.has(d)),
    );
    expect(badDestinations).toEqual([]);
  });

  it('leaves unrecoverableOverlapSources.pairs empty - all 120 sources were processed', () => {
    expect(humanReview.unrecoverableOverlapSources.pairs).toEqual([]);
  });

  it('re-derives the exact persisted overlap set from reviewer data and matches disk exactly (no invention, no loss)', () => {
    const { expected } = computeExpectedBatch4Overlap(directPairs, mvpPairs);

    const actual = new Map<string, Set<string>>();
    overlap.forEach((row) => actual.set(pairKey(row), new Set(row.sourceEmotionKeys)));

    // Every expected pair must exist on disk with exactly the expected sources.
    expected.forEach((sources, key) => {
      expect(actual.has(key), `expected overlap row missing from disk: ${key}`).toBe(true);
      expect([...actual.get(key)!].sort(), `sourceEmotionKeys mismatch for ${key}`).toEqual([...sources].sort());
    });

    // Disk must not have any pair the re-derivation doesn't also produce
    // (no invention) and must not be missing any (no loss) - so the sets of
    // keys, not just their sizes, must match exactly.
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  });

  it('never invents an overlap destination outside the reviewer-supplied lists for the 120 sources', () => {
    // Any (verseKey, emotionKey) pair that exists on disk but is NOT produced
    // by the re-derivation (which is seeded from every pre-existing overlap
    // row plus only the reviewer-supplied destinations) would be an invented
    // pair. The previous test already proves set equality; this test asserts
    // the same property from the "nothing extra on disk" direction directly,
    // so a regression here fails with a clearer, single-purpose message.
    const { expected } = computeExpectedBatch4Overlap(directPairs, mvpPairs);
    const invented = overlap.filter((row) => !expected.has(pairKey(row)));
    expect(invented).toEqual([]);
  });

  it('has no duplicate (verseKey, emotionKey) rows and no unknown emotion/verse keys', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    overlap.forEach((row) => {
      const key = pairKey(row);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    });
    expect(duplicates).toEqual([]);

    overlap.forEach((row) => {
      expect(isValidVerseKey(row.verseKey), `bad verseKey ${row.verseKey}`).toBe(true);
      expect(canonicalEmotionKeys.has(row.emotionKey), `bad emotionKey ${row.emotionKey}`).toBe(true);
    });
  });

  it('never duplicates an already-tracked pair from an existing MVP mapping or a direct Batch 1-4 decision', () => {
    const batch1 = loadJson<HumanReviewFile>('batches/batch-1/final-review.json');
    const batch2 = loadJson<HumanReviewFile>('batches/batch-2/final-review.json');
    const batch3 = loadJson<HumanReviewFile>('batches/batch-3/final-review.json');
    const directPairs = new Set<string>();
    [batch1, batch2, batch3, humanReview].forEach((hr) => {
      hr.reviews.forEach((r) => directPairs.add(pairKey(r)));
      hr.supplementalReviews.forEach((r) => directPairs.add(pairKey(r)));
    });

    overlap.forEach((row) => {
      expect(mvpPairs.has(pairKey(row)), `${pairKey(row)} collides with an MVP mapping`).toBe(false);
      expect(directPairs.has(pairKey(row)), `${pairKey(row)} collides with a direct human decision`).toBe(false);
    });
  });

  it('never adds a reviewer-supplied source emotion to a pair that is tracked by an earlier overlap file only', () => {
    // If a (verseKey, destination) pair is tracked by an earlier batch's
    // overlap file and was NOT already present in batch4's own file (per the
    // frozen pre-correction fixture), the recovery must skip it rather than
    // create a brand-new duplicate row in batch4. (When batch4 already
    // independently carried that pair too - a pre-existing fact captured in
    // the fixture - enriching batch4's own row is correct, and is exactly
    // what `computeExpectedBatch4Overlap` reproduces and the two tests above
    // already verify.)
    const earlierFiles = [
      'batches/batch-1/overlaps.json',
      'batches/batch-2/overlaps.json',
      'batches/batch-3/overlaps.json',
    ] as const;
    const trackedByEarlierFileOnly = new Set<string>();
    earlierFiles.forEach((f) => {
      loadJson<OverlapRow[]>(f).forEach((row) => trackedByEarlierFileOnly.add(pairKey(row)));
    });
    const preExistingBatch4Keys = new Set(
      loadFixture<OverlapRow[]>('batch-4-overlaps-pre-recovery.json').map(pairKey),
    );

    const wronglyDuplicated = overlap.filter(
      (row) => trackedByEarlierFileOnly.has(pairKey(row)) && !preExistingBatch4Keys.has(pairKey(row)),
    );
    expect(wronglyDuplicated).toEqual([]);
  });

  it('the pre-recovery fixture matches the documented pre-correction row count (147)', () => {
    const fixtureRows = loadFixture<OverlapRow[]>('batch-4-overlaps-pre-recovery.json');
    expect(fixtureRows).toHaveLength(147);
  });
});
