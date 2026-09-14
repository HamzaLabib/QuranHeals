import { describe, expect, it } from 'vitest';

import {
  buildCanonicalVerseDocuments,
  QuranImportValidationError,
  validateCanonicalVerseBatch,
  type CanonicalVerseImportInput,
} from '../../src/import/quranImporter';
import { seedAyahs } from '../../src/seed/ayahs';
import { FOUNDATION_SCRIPT_TYPE, FOUNDATION_SOURCE_VERSION } from '../../src/seed/foundation';
import { sha256Utf8 } from '../../src/utils/checksum';

function toImportRow(seedAyah: (typeof seedAyahs)[number]): CanonicalVerseImportInput {
  return {
    referenceKey: seedAyah.referenceKey,
    surahNumber: seedAyah.surahNumber,
    surahNameArabic: seedAyah.surahNameArabic,
    surahNameEnglish: seedAyah.surahNameEnglish,
    ayahNumber: seedAyah.ayahNumber,
    arabicText: seedAyah.arabicText,
    scriptType: FOUNDATION_SCRIPT_TYPE,
    quranTextSource: seedAyah.quranTextSource,
    sourceVersion: FOUNDATION_SOURCE_VERSION,
  };
}

describe('Quran canonical import framework', () => {
  const controlledBatch = seedAyahs.slice(0, 3).map(toImportRow);

  it('validates a small controlled canonical batch and computes checksums', () => {
    const report = validateCanonicalVerseBatch(controlledBatch, {
      expectedTotalRecords: controlledBatch.length,
      expectedSourceVersion: FOUNDATION_SOURCE_VERSION,
    });
    const documents = buildCanonicalVerseDocuments(controlledBatch, {
      expectedTotalRecords: controlledBatch.length,
      expectedSourceVersion: FOUNDATION_SOURCE_VERSION,
    });

    expect(report).toEqual({
      totalRecords: controlledBatch.length,
      expectedTotalRecords: controlledBatch.length,
      errors: [],
      valid: true,
    });
    expect(documents).toHaveLength(controlledBatch.length);
    expect(documents[0].checksum).toBe(sha256Utf8(controlledBatch[0].arabicText));
  });

  it('fails safely when expected record counts do not match', () => {
    const report = validateCanonicalVerseBatch(controlledBatch, {
      expectedTotalRecords: controlledBatch.length + 1,
    });

    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.includes('Expected'))).toBe(true);
  });

  it('fails safely for duplicate Quran references', () => {
    const duplicate = { ...controlledBatch[0] };
    const report = validateCanonicalVerseBatch([...controlledBatch, duplicate]);

    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.includes('duplicate referenceKey'))).toBe(true);
  });

  it('fails safely for malformed rows', () => {
    const malformed = {
      ...controlledBatch[0],
      referenceKey: 'bad-ref',
      ayahNumber: 0,
      checksum: 'not-a-checksum',
    };
    const report = validateCanonicalVerseBatch([malformed]);

    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThanOrEqual(3);
    expect(() => buildCanonicalVerseDocuments([malformed])).toThrow(QuranImportValidationError);
  });

  it('reports invalid text shape without hashing unsafe values', () => {
    const malformed = {
      ...controlledBatch[0],
      arabicText: undefined,
      checksum: sha256Utf8(controlledBatch[0].arabicText),
    } as unknown as CanonicalVerseImportInput;
    const report = validateCanonicalVerseBatch([malformed]);

    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.includes('arabicText'))).toBe(true);
  });

  it('allows canonical verse imports without emotion mappings', () => {
    const [document] = buildCanonicalVerseDocuments([controlledBatch[0]], {
      expectedTotalRecords: 1,
    });

    expect(Object.prototype.hasOwnProperty.call(controlledBatch[0], 'emotions')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(document, 'emotions')).toBe(false);
  });

  it('rejects emotion mappings embedded in a canonical verse batch', () => {
    const rowWithMappings = {
      ...controlledBatch[0],
      emotions: ['sad'],
    } as CanonicalVerseImportInput;
    const report = validateCanonicalVerseBatch([rowWithMappings]);

    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.includes('must not include emotion'))).toBe(true);
  });
});
