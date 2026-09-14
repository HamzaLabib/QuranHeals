import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTIVATION_MAPPING_VERSION,
  buildActivationCandidates,
  loadApprovedMappingsPreview,
  loadReviewDecisions,
  validateActivationSet,
} from '../../src/scripts/activationDryRun';

const SCRIPT_SOURCE_PATH = resolve(__dirname, '../../src/scripts/activationDryRun.ts');
const arabicPattern = /[؀-ۿ]/;

const preview = loadApprovedMappingsPreview();
const candidates = buildActivationCandidates(preview);
const validation = validateActivationSet(candidates);
const { rejectPairs, holdPairs } = loadReviewDecisions();

describe('Phase 6A: activation candidate counts', () => {
  it('parses exactly 1,845 approved mappings', () => {
    expect(candidates).toHaveLength(1845);
    expect(validation.counts.mappings).toBe(1845);
  });

  it('covers exactly 205 unique ayahs', () => {
    expect(validation.counts.uniqueAyahs).toBe(205);
  });

  it('covers exactly 29 emotions', () => {
    expect(validation.counts.emotions).toBe(29);
    expect(validation.taxonomy.count).toBe(29);
  });

  it('has zero duplicate (verseKey, emotionKey) logical pairs', () => {
    expect(validation.counts.duplicates).toBe(0);
    expect(validation.duplicatePairs).toEqual([]);
  });

  it('recomputes exactly 191 REJECT and 8 HOLD pairs from the review artifacts', () => {
    expect(rejectPairs.size).toBe(191);
    expect(holdPairs.size).toBe(8);
  });
});

describe('Phase 6A: REJECT/HOLD protection (fail-closed)', () => {
  it('no REJECT pair enters the activation candidate set', () => {
    expect(validation.rejectIntersection).toEqual([]);
  });

  it('no HOLD pair enters the activation candidate set', () => {
    expect(validation.holdIntersection).toEqual([]);
  });

  it('has zero review-decision conflicts across batch files', () => {
    expect(validation.reviewConflicts).toEqual([]);
  });
});

describe('Phase 6A: sentinel exclusion', () => {
  it('12:100 -> guilty is absent from the activation candidate set', () => {
    expect(validation.sentinel.absent).toBe(true);
    expect(
      candidates.some((c) => c.verseKey === '12:100' && c.emotionKey === 'guilty'),
    ).toBe(false);
  });
});

describe('Phase 6A: Quran reference validation', () => {
  it('every verseKey resolves against the verified reference-key set', () => {
    expect(validation.quran.invalidVerseKeys).toEqual([]);
    expect(validation.quran.missingQuranReferences).toEqual([]);
  });
});

describe('Phase 6A: emotion taxonomy validation', () => {
  it('has zero missing and zero unexpected emotions against the 29-key taxonomy', () => {
    expect(validation.taxonomy.missing).toEqual([]);
    expect(validation.taxonomy.unexpected).toEqual([]);
  });

  it('reports a sorted, de-duplicated list of exactly 29 emotions', () => {
    expect(validation.taxonomy.emotions).toEqual([...validation.taxonomy.emotions].sort());
    expect(new Set(validation.taxonomy.emotions).size).toBe(validation.taxonomy.emotions.length);
    expect(validation.taxonomy.emotions).toHaveLength(29);
  });
});

describe('Phase 6A: overall validation result', () => {
  it('passes every check', () => {
    expect(validation.passed).toBe(true);
  });
});

describe('Phase 6A: importer cannot include Quran Arabic', () => {
  it('no activation candidate carries Arabic script or a Quran-text field', () => {
    const serialized = JSON.stringify(candidates);
    expect(arabicPattern.test(serialized)).toBe(false);
    expect(serialized).not.toMatch(/arabicText|quranText|verseText|englishTranslation/i);
  });

  it('the script module never reads Quran/translation source files', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    expect(source).not.toMatch(/quran-uthmani|quranSource|VerseTranslation/);
  });
});

describe('Phase 6A: transformation determinism', () => {
  it('produces byte-identical output across repeated runs', () => {
    const first = buildActivationCandidates(loadApprovedMappingsPreview());
    const second = buildActivationCandidates(loadApprovedMappingsPreview());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('preserves the preview file row order (already deterministically sorted)', () => {
    expect(candidates.map((c) => `${c.verseKey}|${c.emotionKey}`)).toEqual(
      preview.rows.map((r) => `${r.verseKey}|${r.emotionKey}`),
    );
  });

  it('stamps every candidate with the Phase 6 activation mapping version and approved status', () => {
    candidates.forEach((c) => {
      expect(c.status).toBe('approved');
      expect(c.mappingVersion).toBe(ACTIVATION_MAPPING_VERSION);
    });
  });
});

describe('Phase 6A: dry-run causes zero MongoDB mutation (static proof)', () => {
  it('the script module never calls a Mongoose write method', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    const mutatingMethods = [
      '.create(',
      '.insertMany(',
      '.updateOne(',
      '.updateMany(',
      '.deleteOne(',
      '.deleteMany(',
      '.bulkWrite(',
      '.findOneAndUpdate(',
      '.findOneAndDelete(',
      '.findByIdAndUpdate(',
      '.findByIdAndDelete(',
      '.save(',
      '.remove(',
      '.drop(',
    ];
    mutatingMethods.forEach((method) => {
      expect(source.includes(method), `unexpected mutating call ${method} in activationDryRun.ts`).toBe(false);
    });
  });

  it('the only database calls are read-only countDocuments', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    expect(source).toMatch(/countDocuments/);
  });

  it('the CLI refuses --apply outright', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    expect(source).toMatch(/does not support --apply/);
  });
});
