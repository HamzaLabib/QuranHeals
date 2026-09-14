import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isValidVerseKey } from '../../../src/quran/referenceKeys';
import { seedAyahs } from '../../../src/seed/ayahs';
import { seedEmotions } from '../../../src/seed/emotions';

// This suite locks in batches/batch-5/overlaps.json: the
// reviewer-approved cross-emotion overlap destinations raised during the
// Batch 5 human review. REVIEWER_APPROVED_OVERLAPS below is transcribed
// directly from the human reviewer's decisions (task sections 5, 7, 10, 11,
// and the `weak` additionalApprovedOverlaps), not read back from the
// generated artifact - this test re-derives the expected overlap set with
// the same dedup rules the artifact was built on (skip an existing MVP
// mapping, skip a pair already directly decided anywhere in Batch 1-5, skip
// a pair already tracked in an earlier Phase 5B overlap file, otherwise
// create/merge a row) and diffs that reconstruction against disk.

const DATA_DIR = resolve(__dirname, '../../../data/emotion-candidates');

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, fileName), 'utf-8')) as T;
}

type ReviewRow = { verseKey: string; emotionKey: string; decision: 'keep' | 'reject' | 'hold' };
type HumanReviewFile = { reviews: ReviewRow[]; supplementalReviews: ReviewRow[] };
type OverlapRow = { verseKey: string; emotionKey: string; sourceEmotionKeys: string[]; status?: 'excluded' };

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
  'batches/batch-5/final-review.json',
] as const;
const OVERLAP_FILES = [
  'batches/batch-1/overlaps.json',
  'batches/batch-2/overlaps.json',
  'batches/batch-3/overlaps.json',
  'batches/batch-4/overlaps.json',
] as const;
const BATCH5_OVERLAP_FILE = 'batches/batch-5/overlaps.json';

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

// ---------------------------------------------------------------------------
// Ground truth: [verseKey, sourceEmotion, approvedDestinations[], excludedDestinations[]]
// Transcribed directly from the human reviewer's approvedOverlaps decisions.
// ---------------------------------------------------------------------------
const REVIEWER_APPROVED_OVERLAPS: [string, string, string[], string[]?][] = [
  // forgiveness_struggle core (24 rows, keep AND reject - a rejected core
  // pair still preserves its approved overlaps for other emotions)
  ['7:43', 'forgiveness_struggle', ['peaceful', 'content', 'grateful', 'hopeful', 'reassurance', 'closer_to_allah', 'repentant', 'guilty']],
  ['3:186', 'forgiveness_struggle', ['patience', 'strength', 'angry', 'betrayed', 'wronged', 'rejected', 'overwhelmed', 'reassurance']],
  ['3:159', 'forgiveness_struggle', ['angry', 'rejected', 'betrayed', 'wronged', 'patience', 'strength', 'peaceful', 'reassurance', 'closer_to_allah', 'seeking_guidance']],
  ['42:40', 'forgiveness_struggle', ['angry', 'wronged', 'betrayed', 'patience', 'strength', 'peaceful', 'reassurance', 'hopeful', 'heartbroken', 'rejected']],
  ['42:43', 'forgiveness_struggle', ['patience', 'strength', 'weak', 'angry', 'wronged', 'betrayed', 'rejected', 'heartbroken', 'reassurance', 'peaceful']],
  ['16:126', 'forgiveness_struggle', ['angry', 'wronged', 'betrayed', 'patience', 'strength', 'weak', 'heartbroken', 'rejected', 'reassurance']],
  ['41:35', 'forgiveness_struggle', ['patience', 'strength', 'hopeful', 'reassurance']],
  ['7:200', 'forgiveness_struggle', ['angry', 'weak', 'strength', 'anxious', 'stressed', 'closer_to_allah', 'reassurance']],
  ['25:63', 'forgiveness_struggle', ['angry', 'peaceful', 'content', 'patience', 'strength', 'rejected']],
  ['28:55', 'forgiveness_struggle', ['angry', 'peaceful', 'content', 'strength', 'rejected', 'wronged']],
  ['23:96', 'forgiveness_struggle', ['angry', 'wronged', 'betrayed', 'strength', 'peaceful', 'patience', 'reassurance']],
  ['64:14', 'forgiveness_struggle', ['angry', 'betrayed', 'wronged', 'heartbroken', 'patience', 'reassurance']],
  ['12:18', 'forgiveness_struggle', ['betrayed', 'heartbroken', 'sad', 'patience', 'strength', 'reassurance', 'weak', 'want_to_cry']],
  ['3:120', 'forgiveness_struggle', ['betrayed', 'wronged', 'angry', 'patience', 'strength', 'reassurance']],
  ['22:60', 'forgiveness_struggle', ['wronged', 'betrayed', 'reassurance', 'strength', 'hopeful']],
  ['21:47', 'forgiveness_struggle', ['wronged', 'betrayed', 'reassurance', 'hopeful', 'strength']],
  ['2:186', 'forgiveness_struggle', ['lonely', 'hopeful', 'reassurance', 'closer_to_allah', 'seeking_guidance', 'anxious', 'peaceful']],
  ['16:125', 'forgiveness_struggle', ['angry', 'rejected', 'peaceful', 'strength', 'seeking_guidance']],
  ['20:44', 'forgiveness_struggle', ['angry', 'rejected', 'peaceful', 'strength', 'seeking_guidance']],
  ['4:148', 'forgiveness_struggle', ['wronged', 'betrayed', 'rejected', 'heartbroken', 'reassurance']],
  ['3:134', 'forgiveness_struggle', ['angry', 'patience', 'strength', 'peaceful', 'content', 'grateful']],
  ['24:22', 'forgiveness_struggle', ['angry', 'betrayed', 'wronged', 'heartbroken', 'hopeful', 'repentant', 'guilty', 'closer_to_allah']],
  ['41:34', 'forgiveness_struggle', ['angry', 'wronged', 'betrayed', 'rejected', 'peaceful', 'strength', 'patience', 'hopeful']],
  ['42:37', 'forgiveness_struggle', ['angry', 'patience', 'strength', 'peaceful', 'content', 'reassurance']],
  // forgiveness_struggle supplemental (2)
  ['12:92', 'forgiveness_struggle', ['betrayed', 'wronged', 'guilty', 'repentant', 'heartbroken', 'reassurance', 'hopeful', 'peaceful', 'closer_to_allah', 'content']],
  ['12:100', 'forgiveness_struggle', ['betrayed', 'wronged', 'heartbroken', 'lonely', 'hopeful', 'grateful', 'content', 'peaceful', 'reassurance', 'closer_to_allah'], ['guilty']],
  // strength supplemental (2)
  ['20:72', 'strength', ['afraid', 'hopeful', 'reassurance', 'repentant', 'closer_to_allah', 'peaceful']],
  ['7:126', 'strength', ['afraid', 'stressed', 'hopeful', 'reassurance', 'repentant', 'closer_to_allah', 'seeking_guidance', 'peaceful']],
  // grateful supplemental (12)
  ['16:18', 'grateful', ['content', 'peaceful', 'hopeful', 'reassurance', 'closer_to_allah']],
  ['16:53', 'grateful', ['weak', 'afraid', 'stressed', 'reassurance', 'closer_to_allah', 'peaceful']],
  ['16:78', 'grateful', ['content', 'hopeful', 'closer_to_allah', 'peaceful']],
  ['16:81', 'grateful', ['content', 'peaceful', 'reassurance', 'closer_to_allah']],
  ['93:11', 'grateful', ['content', 'hopeful', 'reassurance', 'closer_to_allah']],
  ['27:15', 'grateful', ['content', 'strength', 'hopeful', 'closer_to_allah', 'peaceful']],
  ['55:13', 'grateful', ['content', 'peaceful', 'closer_to_allah', 'reassurance']],
  ['8:26', 'grateful', ['afraid', 'weak', 'strength', 'hopeful', 'reassurance', 'peaceful']],
  ['45:12', 'grateful', ['content', 'hopeful', 'peaceful', 'closer_to_allah']],
  ['45:13', 'grateful', ['content', 'peaceful', 'closer_to_allah', 'seeking_guidance']],
  ['34:15', 'grateful', ['content', 'peaceful', 'hopeful', 'reassurance', 'closer_to_allah']],
  ['39:74', 'grateful', ['hopeful', 'content', 'peaceful', 'reassurance', 'closer_to_allah']],
  // peaceful supplemental (12)
  ['30:21', 'peaceful', ['content', 'lonely', 'heartbroken', 'grateful', 'reassurance']],
  ['6:96', 'peaceful', ['tired', 'content', 'grateful', 'reassurance']],
  ['10:67', 'peaceful', ['tired', 'content', 'grateful', 'reassurance']],
  ['27:86', 'peaceful', ['tired', 'content', 'grateful', 'reassurance', 'closer_to_allah']],
  ['16:80', 'peaceful', ['content', 'grateful', 'reassurance', 'tired']],
  ['42:28', 'peaceful', ['hopeless', 'sad', 'stressed', 'hopeful', 'reassurance', 'grateful']],
  ['48:18', 'peaceful', ['afraid', 'stressed', 'hopeful', 'reassurance', 'strength', 'closer_to_allah']],
  ['25:48', 'peaceful', ['hopeful', 'reassurance', 'grateful', 'content']],
  ['50:9', 'peaceful', ['grateful', 'content', 'hopeful', 'reassurance']],
  ['55:50', 'peaceful', ['content', 'hopeful', 'grateful', 'reassurance']],
  ['55:54', 'peaceful', ['content', 'hopeful', 'grateful', 'reassurance', 'tired']],
  ['55:76', 'peaceful', ['content', 'grateful', 'reassurance', 'hopeful', 'tired']],
  // weak bulk additionalApprovedOverlaps (3)
  ['11:6', 'weak', ['afraid', 'lost', 'confused', 'hopeless', 'stressed']],
  ['29:60', 'weak', ['afraid', 'lost', 'confused', 'hopeless', 'stressed']],
  ['39:53', 'weak', ['lost', 'confused']],
];

function computeExpectedOverlap(): Map<string, Set<string>> {
  const priorDirectPairs = new Set<string>();
  REVIEW_FILES.forEach((f) => {
    const hr = loadJson<HumanReviewFile>(f);
    hr.reviews.forEach((r) => priorDirectPairs.add(pairKey(r)));
    hr.supplementalReviews.forEach((r) => priorDirectPairs.add(pairKey(r)));
  });

  const priorOverlapKeys = new Set<string>();
  OVERLAP_FILES.forEach((f) => {
    loadJson<OverlapRow[]>(f).forEach((row) => priorOverlapKeys.add(pairKey(row)));
  });

  const expected = new Map<string, Set<string>>();
  REVIEWER_APPROVED_OVERLAPS.forEach(([verseKey, sourceEmotion, destinations, excluded]) => {
    const excludedSet = new Set(excluded ?? []);
    destinations.forEach((destination) => {
      if (excludedSet.has(destination)) return;
      if (destination === sourceEmotion) return;
      const key = `${verseKey}|${destination}`;
      if (mvpPairs.has(key)) return; // existing MVP mapping
      if (priorDirectPairs.has(key)) return; // already a direct decision somewhere in Batch 1-5
      if (priorOverlapKeys.has(key)) return; // already tracked in an earlier Phase 5B overlap file
      const set = expected.get(key) ?? new Set<string>();
      set.add(sourceEmotion);
      expected.set(key, set);
    });
  });

  return expected;
}

describe('Phase 5B Batch 5 overlap-candidate artifact', () => {
  const overlap = loadJson<OverlapRow[]>(BATCH5_OVERLAP_FILE);

  it('is deduped by verseKey + emotionKey', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    overlap.forEach((row) => {
      const key = pairKey(row);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    });
    expect(duplicates).toEqual([]);
  });

  it('uses only canonical emotion keys and verified verse keys', () => {
    const badVerseKeys = overlap.filter((row) => !isValidVerseKey(row.verseKey));
    const badEmotionKeys = overlap.filter((row) => !canonicalEmotionKeys.has(row.emotionKey));
    expect(badVerseKeys).toEqual([]);
    expect(badEmotionKeys).toEqual([]);
  });

  it('never overlaps with an existing MVP (development) mapping', () => {
    const collisions = overlap.filter((row) => mvpPairs.has(pairKey(row)));
    expect(collisions).toEqual([]);
  });

  it('never proposes a pair that already has a direct decision anywhere in Batch 1-5', () => {
    const directPairs = new Set<string>();
    REVIEW_FILES.forEach((f) => {
      const hr = loadJson<HumanReviewFile>(f);
      hr.reviews.forEach((r) => directPairs.add(pairKey(r)));
      hr.supplementalReviews.forEach((r) => directPairs.add(pairKey(r)));
    });

    const collisions = overlap.filter((row) => directPairs.has(pairKey(row)));
    expect(collisions).toEqual([]);
  });

  it('never duplicates a pair already tracked in an earlier Phase 5B overlap file', () => {
    const priorKeys = new Set<string>();
    OVERLAP_FILES.forEach((f) => {
      loadJson<OverlapRow[]>(f).forEach((row) => priorKeys.add(pairKey(row)));
    });

    const collisions = overlap.filter((row) => priorKeys.has(pairKey(row)));
    expect(collisions).toEqual([]);
  });

  it('never includes 12:100 -> guilty (explicitly excluded by the reviewer)', () => {
    const collision = overlap.find((row) => row.verseKey === '12:100' && row.emotionKey === 'guilty');
    expect(collision).toBeUndefined();
  });

  it('records provenance (sourceEmotionKeys) for every row and never stores Quran text', () => {
    overlap.forEach((row) => {
      expect(Array.isArray(row.sourceEmotionKeys)).toBe(true);
      expect(row.sourceEmotionKeys.length).toBeGreaterThan(0);
      row.sourceEmotionKeys.forEach((key) => expect(canonicalEmotionKeys.has(key)).toBe(true));
      expect(row).not.toHaveProperty('arabicText');
      expect(row).not.toHaveProperty('translation');
    });

    const raw = readFileSync(resolve(DATA_DIR, BATCH5_OVERLAP_FILE), 'utf-8');
    expect(arabicPattern.test(raw)).toBe(false);
  });

  it('never proposes an overlap destination equal to its own source emotion', () => {
    overlap.forEach((row) => {
      expect(row.sourceEmotionKeys).not.toContain(row.emotionKey);
    });
  });
});

describe('Phase 5B Batch 5 overlap: from-scratch reconstruction', () => {
  // Re-derives the expected overlap set from REVIEWER_APPROVED_OVERLAPS (the
  // ground-truth table above) using the same dedup rules the artifact was
  // built on, and diffs it against disk - rather than validating the
  // artifact against itself.
  const overlap = loadJson<OverlapRow[]>(BATCH5_OVERLAP_FILE);

  it('has exactly 55 reviewer-approved source rows feeding the reconstruction', () => {
    expect(REVIEWER_APPROVED_OVERLAPS).toHaveLength(55);
  });

  it('every reviewer-approved destination is a canonical emotion key', () => {
    const bad = REVIEWER_APPROVED_OVERLAPS.flatMap(([, , destinations]) =>
      destinations.filter((d) => !canonicalEmotionKeys.has(d)),
    );
    expect(bad).toEqual([]);
  });

  it('re-derives the exact persisted overlap set and matches disk exactly (no invention, no loss)', () => {
    const expected = computeExpectedOverlap();

    const actual = new Map<string, Set<string>>();
    overlap.forEach((row) => actual.set(pairKey(row), new Set(row.sourceEmotionKeys)));

    expected.forEach((sources, key) => {
      expect(actual.has(key), `expected overlap row missing from disk: ${key}`).toBe(true);
      expect([...actual.get(key)!].sort(), `sourceEmotionKeys mismatch for ${key}`).toEqual([...sources].sort());
    });

    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  });

  it('never invents an overlap destination outside the reviewer-approved lists', () => {
    const expected = computeExpectedOverlap();
    const invented = overlap.filter((row) => !expected.has(pairKey(row)));
    expect(invented).toEqual([]);
  });
});
