import type { QuranScriptType, VerseEntity } from '../types/domain';
import { sha256Utf8 } from '../utils/checksum';

const checksumPattern = /^[a-f0-9]{64}$/;
const referenceKeyPattern = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;

export type CanonicalVerseImportInput = {
  referenceKey: string;
  surahNumber: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahNumber: number;
  arabicText: string;
  scriptType: QuranScriptType;
  quranTextSource: string;
  sourceVersion: string;
  checksum?: string;
};

export type CanonicalVerseImportDocument = Omit<VerseEntity, 'createdAt' | 'updatedAt'>;

export type QuranImportValidationOptions = {
  expectedTotalRecords?: number;
  expectedSourceVersion?: string;
};

export type QuranImportValidationReport = {
  totalRecords: number;
  expectedTotalRecords?: number;
  errors: string[];
  valid: boolean;
};

export class QuranImportValidationError extends Error {
  constructor(readonly report: QuranImportValidationReport) {
    super(`Quran import validation failed with ${report.errors.length} error(s).`);
    this.name = 'QuranImportValidationError';
  }
}

function hasRequiredText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rowLabel(row: CanonicalVerseImportInput, index: number) {
  return row.referenceKey || `row ${index + 1}`;
}

export function validateCanonicalVerseBatch(
  rows: CanonicalVerseImportInput[],
  options: QuranImportValidationOptions = {},
): QuranImportValidationReport {
  const errors: string[] = [];
  const seenReferenceKeys = new Set<string>();
  const seenSurahAyahKeys = new Set<string>();

  if (options.expectedTotalRecords !== undefined && rows.length !== options.expectedTotalRecords) {
    errors.push(
      `Expected ${options.expectedTotalRecords} canonical verse record(s), received ${rows.length}.`,
    );
  }

  rows.forEach((row, index) => {
    const label = rowLabel(row, index);
    const maybeRow = row as unknown as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(maybeRow, 'emotions')) {
      errors.push(`Canonical verse import "${label}" must not include emotion mappings.`);
    }

    const requiredTextFields = [
      'referenceKey',
      'surahNameArabic',
      'surahNameEnglish',
      'arabicText',
      'quranTextSource',
      'sourceVersion',
    ] as const;

    requiredTextFields.forEach((field) => {
      if (!hasRequiredText(row[field])) {
        errors.push(`Canonical verse import "${label}" is missing required field "${field}".`);
      }
    });

    if (!Number.isInteger(row.surahNumber) || row.surahNumber < 1 || row.surahNumber > 114) {
      errors.push(`Canonical verse import "${label}" has an invalid surahNumber.`);
    }

    if (!Number.isInteger(row.ayahNumber) || row.ayahNumber < 1) {
      errors.push(`Canonical verse import "${label}" has an invalid ayahNumber.`);
    }

    if (row.scriptType !== 'uthmani') {
      errors.push(`Canonical verse import "${label}" has unsupported scriptType "${row.scriptType}".`);
    }

    if (typeof row.referenceKey === 'string' && !referenceKeyPattern.test(row.referenceKey)) {
      errors.push(`Canonical verse import "${label}" has malformed referenceKey.`);
    }

    if (
      typeof row.referenceKey === 'string' &&
      Number.isInteger(row.surahNumber) &&
      Number.isInteger(row.ayahNumber) &&
      row.referenceKey !== `${row.surahNumber}:${row.ayahNumber}`
    ) {
      errors.push(
        `Canonical verse import "${label}" referenceKey must match surahNumber and ayahNumber.`,
      );
    }

    if (typeof row.referenceKey === 'string') {
      if (seenReferenceKeys.has(row.referenceKey)) {
        errors.push(`Canonical verse import contains duplicate referenceKey "${row.referenceKey}".`);
      }

      seenReferenceKeys.add(row.referenceKey);
    }

    if (Number.isInteger(row.surahNumber) && Number.isInteger(row.ayahNumber)) {
      const surahAyahKey = `${row.surahNumber}:${row.ayahNumber}`;

      if (seenSurahAyahKeys.has(surahAyahKey)) {
        errors.push(`Canonical verse import contains duplicate surah/ayah "${surahAyahKey}".`);
      }

      seenSurahAyahKeys.add(surahAyahKey);
    }

    if (
      options.expectedSourceVersion !== undefined &&
      row.sourceVersion !== options.expectedSourceVersion
    ) {
      errors.push(
        `Canonical verse import "${label}" sourceVersion must be "${options.expectedSourceVersion}".`,
      );
    }

    if (row.checksum !== undefined) {
      if (!checksumPattern.test(row.checksum)) {
        errors.push(`Canonical verse import "${label}" has malformed checksum.`);
      } else if (typeof row.arabicText === 'string' && row.checksum !== sha256Utf8(row.arabicText)) {
        errors.push(`Canonical verse import "${label}" checksum does not match arabicText.`);
      }
    }
  });

  return {
    totalRecords: rows.length,
    expectedTotalRecords: options.expectedTotalRecords,
    errors,
    valid: errors.length === 0,
  };
}

export function buildCanonicalVerseDocuments(
  rows: CanonicalVerseImportInput[],
  options: QuranImportValidationOptions = {},
): CanonicalVerseImportDocument[] {
  const report = validateCanonicalVerseBatch(rows, options);

  if (!report.valid) {
    throw new QuranImportValidationError(report);
  }

  return rows.map((row) => ({
    referenceKey: row.referenceKey,
    surahNumber: row.surahNumber,
    surahNameArabic: row.surahNameArabic,
    surahNameEnglish: row.surahNameEnglish,
    ayahNumber: row.ayahNumber,
    arabicText: row.arabicText,
    scriptType: row.scriptType,
    quranTextSource: row.quranTextSource,
    sourceVersion: row.sourceVersion,
    checksum: row.checksum ?? sha256Utf8(row.arabicText),
  }));
}
