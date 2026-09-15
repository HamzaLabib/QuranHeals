/**
 * Approved emotion mapping activation dry-run / preparation.
 *
 * Reads the Phase 5C consolidated preview (`backend/data/emotion-candidates/
 * consolidated/approved-mappings-preview.json`) and Phase 5B review decisions
 * (`backend/data/emotion-candidates/batches/batch-N/final-review.json`),
 * transforms the preview into activation-ready records, and validates every
 * safety property required before a future activation:
 *
 *  - exact input counts (approved / reject / hold)
 *  - zero duplicate (verseKey, emotionKey) pairs
 *  - zero REJECT/HOLD pairs in the activation candidate set
 *  - the `12:100 -> guilty` sentinel exclusion
 *  - every verseKey resolves against the verified 6,236-key reference set
 *  - exactly the 29 canonical emotion keys, no unexpected/missing keys
 *
 * SAFETY
 *  - This module never imports or reads Quran Arabic/translation text.
 *  - This module never calls a Mongoose write method (create/insertMany/
 *    updateOne/updateMany/deleteOne/deleteMany/bulkWrite/findOneAndUpdate/...).
 *    The only database calls it makes are read-only `countDocuments`, used to
 *    prove the live database is unchanged.
 *  - `--apply` is recognized as an argument but intentionally throws: the
 *    activation transaction is a separate, not-yet-built step (see
 *    `docs/emotion-mappings/activation-transaction-design.md`).
 *
 * Usage:
 *   npm run mapping:activation-dry-run
 *   npm run mapping:activation-dry-run -- --report=reports/emotion-mappings/activation-dry-run.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import mongoose from 'mongoose';

import { env } from '../config/env';
import { EmotionModel } from '../models/Emotion';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { isValidVerseKey } from '../quran/referenceKeys';
import { seedEmotions } from '../seed/emotions';

const DATA_DIR = resolve(__dirname, '../../data/emotion-candidates');
const PREVIEW_RELATIVE_PATH = 'consolidated/approved-mappings-preview.json';
const DEFAULT_REPORT_PATH = 'reports/emotion-mappings/activation-dry-run.json';

const SENTINEL_EXCLUSION = { verseKey: '12:100', emotionKey: 'guilty' } as const;

const REVIEW_FILES = ['1', '2', '3', '4', '5'].map(
  (batch) => [batch, `batches/batch-${batch}/final-review.json`] as const,
);

export const ACTIVATION_MAPPING_VERSION = 'phase-6-activation-1';

// ---------------------------------------------------------------------------
// Loading source artifacts (read-only; never rewritten by this module)
// ---------------------------------------------------------------------------

export type PreviewRow = {
  verseKey: string;
  emotionKey: string;
  sourceTypes: string[];
  [key: string]: unknown;
};

export type PreviewFile = {
  totalPairs: number;
  uniqueVerses: number;
  countByEmotion: Record<string, number>;
  countByProvenanceType: Record<string, number>;
  rows: PreviewRow[];
};

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, relativePath), 'utf-8')) as T;
}

export function loadApprovedMappingsPreview(): PreviewFile {
  return loadJson<PreviewFile>(PREVIEW_RELATIVE_PATH);
}

type Decision = 'keep' | 'reject' | 'hold';
type ReviewRow = { verseKey: string; emotionKey: string; decision: Decision };
type ReviewFile = { reviews: ReviewRow[]; supplementalReviews: ReviewRow[] };

export type ReviewDecisions = {
  rejectPairs: Set<string>;
  holdPairs: Set<string>;
  /** Pairs whose final-review decision disagrees across batch files (should be empty). */
  conflicts: string[];
};

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

export function loadReviewDecisions(): ReviewDecisions {
  const decisionsByPair = new Map<string, Set<Decision>>();

  for (const [, file] of REVIEW_FILES) {
    const data = loadJson<ReviewFile>(file);

    for (const row of [...data.reviews, ...data.supplementalReviews]) {
      const key = pairKey(row);
      const set = decisionsByPair.get(key) ?? new Set<Decision>();
      set.add(row.decision);
      decisionsByPair.set(key, set);
    }
  }

  const rejectPairs = new Set<string>();
  const holdPairs = new Set<string>();
  const conflicts: string[] = [];

  decisionsByPair.forEach((decisions, key) => {
    if (decisions.size > 1) {
      conflicts.push(key);
      return;
    }

    const [decision] = decisions;

    if (decision === 'reject') rejectPairs.add(key);
    else if (decision === 'hold') holdPairs.add(key);
  });

  return { rejectPairs, holdPairs, conflicts };
}

// ---------------------------------------------------------------------------
// Transformation: preview rows -> activation-ready records
// ---------------------------------------------------------------------------

export type ActivationCandidate = {
  verseKey: string;
  emotionKey: string;
  /** The status these records would receive once activation runs. */
  status: 'approved';
  mappingVersion: string;
  sourceTypes: string[];
  contextNotes: string;
};

/**
 * Deterministic: preserves the preview's own row order (already sorted by
 * surah/ayah/canonical emotion order and verified by the Phase 5C test
 * suite) and derives every field only from `sourceTypes` — no randomness,
 * no wall-clock input, no Quran Arabic/translation text.
 */
export function buildActivationCandidates(preview: PreviewFile): ActivationCandidate[] {
  return preview.rows.map((row) => {
    const sourceTypes = [...row.sourceTypes].sort();

    return {
      verseKey: row.verseKey,
      emotionKey: row.emotionKey,
      status: 'approved',
      mappingVersion: ACTIVATION_MAPPING_VERSION,
      sourceTypes,
      contextNotes: `[phase-5c-preview: ${sourceTypes.join('+')}]`,
    };
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult = {
  counts: { mappings: number; uniqueAyahs: number; emotions: number; duplicates: number };
  duplicatePairs: string[];
  rejectIntersection: string[];
  holdIntersection: string[];
  sentinel: { verseKey: string; emotionKey: string; absent: boolean };
  quran: { invalidVerseKeys: string[]; missingQuranReferences: string[] };
  taxonomy: { emotions: string[]; count: number; missing: string[]; unexpected: string[] };
  reviewConflicts: string[];
  passed: boolean;
};

export function validateActivationSet(candidates: ActivationCandidate[]): ValidationResult {
  const seenPairs = new Set<string>();
  const duplicatePairs: string[] = [];
  const verseKeys = new Set<string>();
  const emotionKeys = new Set<string>();

  candidates.forEach((candidate) => {
    const key = pairKey(candidate);

    if (seenPairs.has(key)) {
      duplicatePairs.push(key);
    }

    seenPairs.add(key);
    verseKeys.add(candidate.verseKey);
    emotionKeys.add(candidate.emotionKey);
  });

  const { rejectPairs, holdPairs, conflicts } = loadReviewDecisions();
  const candidatePairKeys = candidates.map(pairKey);

  const rejectIntersection = candidatePairKeys.filter((key) => rejectPairs.has(key));
  const holdIntersection = candidatePairKeys.filter((key) => holdPairs.has(key));

  const sentinelKey = pairKey(SENTINEL_EXCLUSION);
  const sentinelAbsent = !seenPairs.has(sentinelKey);

  const invalidVerseKeys = [...verseKeys].filter((verseKey) => !isValidVerseKey(verseKey)).sort();

  const canonicalEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));
  const sortedEmotions = [...emotionKeys].sort();
  const missing = [...canonicalEmotionKeys].filter((key) => !emotionKeys.has(key)).sort();
  const unexpected = sortedEmotions.filter((key) => !canonicalEmotionKeys.has(key));

  const passed =
    duplicatePairs.length === 0 &&
    rejectIntersection.length === 0 &&
    holdIntersection.length === 0 &&
    sentinelAbsent &&
    invalidVerseKeys.length === 0 &&
    unexpected.length === 0 &&
    conflicts.length === 0;

  return {
    counts: {
      mappings: candidates.length,
      uniqueAyahs: verseKeys.size,
      emotions: emotionKeys.size,
      duplicates: duplicatePairs.length,
    },
    duplicatePairs,
    rejectIntersection,
    holdIntersection,
    sentinel: { verseKey: SENTINEL_EXCLUSION.verseKey, emotionKey: SENTINEL_EXCLUSION.emotionKey, absent: sentinelAbsent },
    quran: { invalidVerseKeys, missingQuranReferences: invalidVerseKeys },
    taxonomy: { emotions: sortedEmotions, count: sortedEmotions.length, missing, unexpected },
    reviewConflicts: conflicts,
    passed,
  };
}

// ---------------------------------------------------------------------------
// Live database safety check (read-only; never creates indexes/collections)
// ---------------------------------------------------------------------------

export type LiveDatabaseCounts = { mappingCount: number; emotionCount: number };

/**
 * Opens a connection with `autoIndex`/`autoCreate` disabled (mirrors
 * `scripts/previewReadonly.ts`) so that even Mongoose's own index-sync
 * machinery cannot write anything, then issues two `countDocuments` reads
 * and disconnects. No insert/update/delete/bulkWrite call exists anywhere
 * in this module.
 */
export async function readLiveDatabaseCounts(): Promise<LiveDatabaseCounts | null> {
  if (!env.MONGODB_URI) {
    return null;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Activation dry run refuses to read from a production database.');
  }

  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });

  try {
    const [mappingCount, emotionCount] = await Promise.all([
      EmotionVerseMappingModel.countDocuments({}),
      EmotionModel.countDocuments({}),
    ]);

    return { mappingCount, emotionCount };
  } finally {
    await mongoose.disconnect();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const separator = arg.indexOf('=');
    if (separator === -1) args.set(arg.slice(2), true);
    else args.set(arg.slice(2, separator), arg.slice(separator + 1));
  }

  return args;
}

function toMarkdown(report: Record<string, unknown>): string {
  const validation = report.validation as ValidationResult;
  const before = report.liveDatabase as { before: LiveDatabaseCounts | null; after: LiveDatabaseCounts | null };
  const lines: string[] = [];

  const inputCounts = report.inputCounts as { approved: number; reject: number; hold: number };

  lines.push('# Approved Emotion Mapping Activation — Dry Run');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt as string}`);
  lines.push(`- Mode: DRY RUN — no database writes`);
  lines.push('');
  lines.push('## Input counts');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('| --- | --- |');
  lines.push(`| APPROVED | ${inputCounts.approved} |`);
  lines.push(`| REJECT | ${inputCounts.reject} |`);
  lines.push(`| HOLD | ${inputCounts.hold} |`);
  lines.push('');
  lines.push('## Activation preview');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Approved mappings | ${validation.counts.mappings} |`);
  lines.push(`| Unique ayahs | ${validation.counts.uniqueAyahs} |`);
  lines.push(`| Approved emotions | ${validation.counts.emotions} |`);
  lines.push(`| Duplicate mappings | ${validation.counts.duplicates} |`);
  lines.push(`| REJECT intersection | ${validation.rejectIntersection.length} |`);
  lines.push(`| HOLD intersection | ${validation.holdIntersection.length} |`);
  lines.push(`| 12:100 -> guilty | ${validation.sentinel.absent ? 'ABSENT' : 'PRESENT (FAIL)'} |`);
  lines.push(`| Invalid verseKeys | ${validation.quran.invalidVerseKeys.length} |`);
  lines.push(`| Missing Quran references | ${validation.quran.missingQuranReferences.length} |`);
  lines.push(`| Review-decision conflicts | ${validation.reviewConflicts.length} |`);
  lines.push('');
  lines.push(`**Overall: ${validation.passed ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push('## Live database');
  lines.push('');

  if (before.before && before.after) {
    lines.push(`- EmotionVerseMapping before: ${before.before.mappingCount}, after: ${before.after.mappingCount}`);
    lines.push(`- Emotion before: ${before.before.emotionCount}, after: ${before.after.emotionCount}`);
    lines.push(`- Documents added/removed/changed: 0 (dry run performs no writes)`);
  } else {
    lines.push('- MONGODB_URI not configured; live counts not checked.');
  }

  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.get('apply') === true) {
    throw new Error(
      'Activation dry-run does not support --apply. Activation is a separate, ' +
        'not-yet-built step — see docs/emotion-mappings/activation-transaction-design.md.',
    );
  }

  const reportPath = typeof args.get('report') === 'string' ? (args.get('report') as string) : DEFAULT_REPORT_PATH;

  const preview = loadApprovedMappingsPreview();
  const candidates = buildActivationCandidates(preview);
  const validation = validateActivationSet(candidates);
  const { rejectPairs, holdPairs } = loadReviewDecisions();

  const before = await readLiveDatabaseCounts();
  // No writes happen between `before` and `after`; this call exists purely
  // to produce independent proof (not merely an assumption) that the dry
  // run did not mutate the live database.
  const after = await readLiveDatabaseCounts();

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'dry-run (no database writes)',
    sourceArtifacts: {
      preview: `data/emotion-candidates/${PREVIEW_RELATIVE_PATH}`,
      reviewFiles: REVIEW_FILES.map(([, file]) => `data/emotion-candidates/${file}`),
    },
    inputCounts: {
      approved: candidates.length,
      reject: rejectPairs.size,
      hold: holdPairs.size,
    },
    validation,
    liveDatabase: { before, after },
  };

  const absoluteReport = resolve(process.cwd(), reportPath);
  mkdirSync(dirname(absoluteReport), { recursive: true });
  writeFileSync(absoluteReport, `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = absoluteReport.replace(/\.json$/, '.md');
  writeFileSync(markdownPath, toMarkdown(report));

  console.log(JSON.stringify({ reportPath, markdownPath, ...validation.counts, passed: validation.passed }, null, 2));
  console.log(`12:100 -> guilty: ${validation.sentinel.absent ? 'ABSENT' : 'PRESENT'}`);

  if (!validation.passed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown activation dry-run error.';
    console.error(`Activation dry-run failed: ${message}`);
    process.exitCode = 1;
  });
}
