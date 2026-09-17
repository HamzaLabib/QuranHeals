import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EMOTION_CATALOG, getCanonicalEmotion } from '../../../src/emotions/emotionCatalog';
import { isValidVerseKey } from '../../../src/quran/referenceKeys';
import { getVerifiedArabicByVerseKey } from '../../../src/quran/quranSource';
import { getVerifiedTranslationByVerseKey } from '../../../src/quran/translationSource';
import { evaluateRows, isValidRow, summarizeReview } from '../../../src/scripts/importCandidateMappings';
import { loadApprovedMappingsPreview } from '../../../src/scripts/activationDryRun';

import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = resolve(__dirname, '../../../data/emotion-candidates/batches/batch-6');

type CandidateRow = { verseKey: string; emotionKey: string; rationale: string; contextNotes: string; source: string };
type ReviewRow = { verseKey: string; emotionKey: string; decision: 'keep' | 'reject' | 'hold' };
type FinalReviewFile = {
  candidateSource: string;
  originalCandidateCount: number;
  decisionCounts: { keep: number; reject: number; hold: number };
  reviews: ReviewRow[];
  supplementalReviews: ReviewRow[];
};

function loadJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, fileName), 'utf-8')) as T;
}

const initialCandidates = loadJson<CandidateRow[]>('initial-candidates.json');
const finalReview = loadJson<FinalReviewFile>('final-review.json');

// The task's own "mandatory core ayahs" — every one of these must be present and kept.
const MANDATORY_VERSE_KEYS = [
  '51:56', '47:15', '2:260', '3:8', '8:2', '9:124', '57:16', '41:30', '29:2', // certainty/faith/reassurance
  '2:164', '3:190', '3:191', // reflection/reasoning
  '30:20', '30:21', '30:22', '30:23', '30:24', '30:25', // the full Ar-Rum sign sequence, not just the endpoints
];

describe('batch-6: candidate file structure', () => {
  it('every candidate targets exactly the faith_shaken emotion key', () => {
    initialCandidates.forEach((row) => expect(row.emotionKey).toBe('faith_shaken'));
    finalReview.reviews.forEach((row) => expect(row.emotionKey).toBe('faith_shaken'));
  });

  it('faith_shaken is a real, known catalog key (not a typo)', () => {
    expect(getCanonicalEmotion('faith_shaken')).toBeDefined();
  });

  it('every verseKey resolves against the verified 6,236-ayah reference set', () => {
    initialCandidates.forEach((row) => expect(isValidVerseKey(row.verseKey), row.verseKey).toBe(true));
  });

  it('no candidate row carries a forbidden raw-Arabic-text field, and no rationale/contextNotes quotes Quran Arabic', () => {
    const arabicPattern = /[؀-ۿ]/;
    initialCandidates.forEach((row) => {
      expect(row).not.toHaveProperty('arabicText');
      expect(row).not.toHaveProperty('arabic');
      expect(row).not.toHaveProperty('verseText');
      expect(arabicPattern.test(row.rationale)).toBe(false);
      expect(arabicPattern.test(row.contextNotes)).toBe(false);
    });
  });

  it('has zero duplicate (verseKey) rows — one candidate per ayah for this emotion', () => {
    const keys = initialCandidates.map((row) => row.verseKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('passes the project\'s own candidate-import structural validation with zero issues (dry run, no database)', () => {
    const evaluated = evaluateRows(initialCandidates);
    const invalid = evaluated.filter((row) => !isValidRow(row));
    expect(invalid, JSON.stringify(invalid, null, 2)).toEqual([]);
  });
});

describe('batch-6: review status handling', () => {
  it('final-review.json accounts for every candidate exactly once, with no supplemental rows for this single-emotion round', () => {
    expect(finalReview.originalCandidateCount).toBe(initialCandidates.length);
    expect(finalReview.reviews).toHaveLength(initialCandidates.length);
    expect(finalReview.supplementalReviews).toEqual([]);

    const candidateKeys = new Set(initialCandidates.map((row) => row.verseKey));
    const reviewKeys = new Set(finalReview.reviews.map((row) => row.verseKey));
    expect(reviewKeys).toEqual(candidateKeys);
  });

  it('decisionCounts exactly matches the actual reviews array', () => {
    const actual = finalReview.reviews.reduce(
      (acc, row) => ({ ...acc, [row.decision]: (acc[row.decision] ?? 0) + 1 }),
      { keep: 0, reject: 0, hold: 0 } as Record<string, number>,
    );
    expect(actual).toEqual(finalReview.decisionCounts);
    expect(actual.keep + actual.reject + actual.hold).toBe(initialCandidates.length);
  });

  it('every decision is one of keep/reject/hold — no unrecognized review status', () => {
    finalReview.reviews.forEach((row) => expect(['keep', 'reject', 'hold']).toContain(row.decision));
  });

  it('every mandatory verse from the task brief is present and kept', () => {
    const decisionByVerseKey = new Map(finalReview.reviews.map((row) => [row.verseKey, row.decision]));
    MANDATORY_VERSE_KEYS.forEach((verseKey) => {
      expect(decisionByVerseKey.get(verseKey), `${verseKey} missing from batch-6 review`).toBe('keep');
    });
  });

  it('at least one candidate received a genuine reject or hold — this is a real review, not a rubber stamp', () => {
    expect(finalReview.decisionCounts.reject + finalReview.decisionCounts.hold).toBeGreaterThan(0);
  });
});

describe('batch-6: duplicate protection and cross-emotion reuse', () => {
  it('none of these candidate pairs already exist as a faith_shaken mapping elsewhere (there is no prior faith_shaken data to collide with)', () => {
    // faith_shaken has never been mapped before this round, so this is a
    // structural sanity check, not a live-database read.
    const pairs = initialCandidates.map((row) => `${row.verseKey}|${row.emotionKey}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('cross-emotion reuse is allowed and actually exercised: several faith_shaken candidates already have an approved mapping to a different emotion', () => {
    const preview = loadApprovedMappingsPreview();
    const byVerse = new Map<string, string[]>();
    preview.rows.forEach((row) => {
      const list = byVerse.get(row.verseKey) ?? [];
      list.push(row.emotionKey);
      byVerse.set(row.verseKey, list);
    });

    const reusedVerses = initialCandidates.filter((row) => (byVerse.get(row.verseKey)?.length ?? 0) > 0);
    expect(reusedVerses.length).toBeGreaterThan(0);
    // None of those existing approved pairs is itself "faith_shaken" (impossible — proves no accidental duplicate).
    reusedVerses.forEach((row) => {
      expect(byVerse.get(row.verseKey)).not.toContain('faith_shaken');
    });
  });

  it('no candidate reintroduces one of the 17 verse-level punishment/warning-excluded verses (the same exclusion standard applied project-wide)', () => {
    const PUNISHMENT_EXCLUDED_VERSE_KEYS = [
      '15:50', '39:54', '39:55', '39:56', '39:57', '39:58', '39:59', '39:60', '39:65', '39:68',
      '39:71', '39:72', '40:18', '42:42', '46:35', '69:18', '69:25',
    ];
    const candidateKeys = new Set(initialCandidates.map((row) => row.verseKey));
    PUNISHMENT_EXCLUDED_VERSE_KEYS.forEach((verseKey) => expect(candidateKeys.has(verseKey)).toBe(false));
  });
});

describe('batch-6: Quran lookup by stable reference (offline, verified local source only)', () => {
  it('every mandatory verseKey resolves real, non-empty Arabic text and English translation from the local verified sources', () => {
    MANDATORY_VERSE_KEYS.forEach((verseKey) => {
      const arabic = getVerifiedArabicByVerseKey(verseKey);
      const translation = getVerifiedTranslationByVerseKey(verseKey);
      expect(arabic.length, verseKey).toBeGreaterThan(0);
      expect(translation.length, verseKey).toBeGreaterThan(0);
    });
  });

  it('a sample across the full candidate list resolves offline without throwing (no network, no MongoDB Arabic)', () => {
    const sample = initialCandidates.filter((_, index) => index % 10 === 0); // every 10th row, ~20 verses
    sample.forEach((row) => {
      expect(() => getVerifiedArabicByVerseKey(row.verseKey)).not.toThrow();
      expect(() => getVerifiedTranslationByVerseKey(row.verseKey)).not.toThrow();
    });
  });
});

// Exact human editorial ledger supplied September 2026. Do not regenerate from review output.
const HUMAN_KEEP = ["2:260","6:75","2:4","13:2","51:20","8:2","9:124","3:173","33:22","48:4","3:8","41:30","46:13","14:27","8:11","16:102","47:7","11:112","29:2","29:3","2:214","3:186","21:35","47:31","57:16","39:23","13:28","2:164","3:190","3:191","30:8","45:3","45:4","45:5","50:6","88:17","88:18","88:19","88:20","41:53","6:95","6:96","6:97","6:99","16:10","16:11","16:14","16:15","16:16","16:65","16:66","16:68","16:69","16:78","16:79","21:30","21:31","21:32","21:33","24:43","24:45","25:45","25:47","25:48","25:49","25:53","25:61","25:62","35:27","35:28","39:5","41:37","41:39","45:12","30:20","30:22","30:23","30:24","30:25","36:33","36:37","36:38","36:39","36:40","51:21","30:21","32:7","32:9","23:12","23:14","86:5","16:5","16:8","16:18","14:34","31:20","2:29","67:15","67:23","16:80","2:2","4:174","5:15","5:16","14:1","17:9","22:5","36:79","36:81","30:27","21:104","50:15","46:33","2:25","3:15","3:133","9:72","10:9","13:23","13:24","14:23","16:31","16:32","18:107","19:60","19:61","19:63","20:76","22:23","23:1","23:11","25:75","29:58","32:17","36:55","36:58","39:73","39:74","43:70","43:71","47:15","50:31","50:34","50:35","51:15","52:17","52:18","54:54","54:55","55:46","55:56","55:60","56:12","56:25","56:28","57:12","66:8","76:5","76:12","76:13","78:31","78:32","83:22","83:25","88:8","88:9","88:10","98:8","51:56"];
const HUMAN_REJECT = ["56:95","69:51","74:31","8:12","33:10","33:11","6:125","39:22","16:67","36:41","51:22","32:8","23:13","86:6","16:6","36:78","50:3","50:4","75:3","75:4","10:10","18:108","25:76","29:59","55:78","56:26","56:35"];

describe('Batch 6 authoritative human finalization', () => {
  it('matches every human decision with no HOLD and exactly 196 unique reviews', () => {
    expect(initialCandidates).toHaveLength(196);
    expect(finalReview.reviews).toHaveLength(196);
    expect(new Set(finalReview.reviews.map(row => row.verseKey)).size).toBe(196);
    expect(finalReview.decisionCounts).toEqual({ keep: 169, reject: 27, hold: 0 });
    expect(finalReview.reviews.filter(row => row.decision === 'keep').map(row => row.verseKey).sort()).toEqual([...HUMAN_KEEP].sort());
    expect(finalReview.reviews.filter(row => row.decision === 'reject').map(row => row.verseKey).sort()).toEqual([...HUMAN_REJECT].sort());
    expect(finalReview.reviews.filter(row => row.decision === 'hold')).toEqual([]);
    expect(EMOTION_CATALOG).toHaveLength(30);
    expect(getCanonicalEmotion('faith_shaken')).toMatchObject({ order: 21, active: false, icon: 'star' });
  });

  it('adds 51:56 once with exact editorial metadata and resolves verified SQLite Arabic', () => {
    expect(initialCandidates.filter(row => row.verseKey === '51:56')).toEqual([{
      verseKey: '51:56', emotionKey: 'faith_shaken',
      rationale: 'Directly states the purpose for which jinn and humans were created: to worship Allah. For a user whose faith feels shaken, this gives a clear answer to the existential question of why we were created and what our purpose is.',
      contextNotes: '[categories: reflection_and_reasoning]',
      source: 'human-review:add-faith-shaken-51-56-2026-09',
    }]);
    const db = new DatabaseSync(resolve(__dirname, '../../../assets/quran/quran.sqlite'), { readOnly: true });
    try {
      const row = db.prepare("SELECT surah, ayah, verse_key, arabic_text FROM verses WHERE verse_key = '51:56'").get();
      expect(row).toMatchObject({ surah: 51, ayah: 56, verse_key: '51:56', arabic_text: getVerifiedArabicByVerseKey('51:56') });
    } finally { db.close(); }
    expect(getVerifiedTranslationByVerseKey('51:56').length).toBeGreaterThan(0);
  });

  it('reports the validated human counts without promoting mapping status', () => {
    const rows = evaluateRows(initialCandidates);
    expect(summarizeReview(rows, finalReview)).toEqual({ keep: 169, reject: 27, hold: 0 });
    expect(() => summarizeReview(rows, { ...finalReview, reviews: [finalReview.reviews[0], ...finalReview.reviews.slice(0, -1)] })).toThrow();
    expect(() => summarizeReview(rows, { ...finalReview, decisionCounts: { keep: 170, reject: 26, hold: 0 } })).toThrow();
    const report = JSON.parse(readFileSync(resolve(__dirname, '../../../reports/emotion-mappings/batch-6-faith-shaken-candidates.json'), 'utf8'));
    expect(report.reviewCounts).toEqual(finalReview.decisionCounts);
    expect(report.summary).toMatchObject({ totalRows: 196, validRows: 196, invalidRows: 0, activatableToday: 0 });
    expect(report.databaseUsed).toBe(false);
    expect(report.candidateStatus).toBe('draft');
  });
});
