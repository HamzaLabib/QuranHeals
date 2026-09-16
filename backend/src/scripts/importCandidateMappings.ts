/**
 * Phase 5A candidate-mapping import workflow.
 *
 * Reads a small file of proposed emotion -> ayah mappings and produces a
 * review-friendly report. DRY RUN BY DEFAULT: nothing is written without
 * `--apply`, and even `--apply` is insert-only (see SAFETY below).
 *
 * Input: a JSON array of rows shaped like
 *   { "verseKey": "2:153", "emotionKey": "patience",
 *     "rationale": "why this ayah fits", "contextNotes": "optional",
 *     "source": "ai:draft-2026-09 | manual:editor-name" }
 *
 * SAFETY
 *  - Quran Arabic is never read, copied or written here. Rows carrying arabic
 *    text fields are rejected.
 *  - `verseKey` is validated against the verified 6,236-verse reference set
 *    (`quran/referenceKeys.ts`), which is pinned to the same surah-counts asset
 *    the SQLite foundation uses.
 *  - `--apply` only INSERTS brand-new (verseKey, emotionKey) pairs. It never
 *    updates an existing mapping, so it cannot overwrite `reviewed`/`approved`
 *    and cannot promote a status.
 *  - Inserted rows get the lowest-trust status (`draft` — the existing enum
 *    value Phase 5A treats as "candidate"; it is NOT in the API's
 *    user-visible set). Human review promotes them later; this tool never does.
 *  - AI-sourced rows are candidates like any other. Nothing here makes an
 *    AI suggestion authoritative.
 *
 * Usage:
 *   npm run mapping:candidates -- --input=path/to/candidates.json
 *   npm run mapping:candidates -- --input=... --check-existing      (annotate with DB status, still dry run)
 *   npm run mapping:candidates -- --input=... --apply               (insert new candidates)
 *   npm run mapping:candidates -- --input=... --mapping-version=phase-5a-candidates-1
 *   npm run mapping:candidates -- --input=... --report=reports/emotion-mappings/candidate-mappings.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { connectToDatabase, disconnectFromDatabase } from '../config/database';
import { env } from '../config/env';
import { EmotionModel } from '../models/Emotion';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { isValidVerseKey } from '../quran/referenceKeys';
import { seedEmotions } from '../seed/emotions';
import { LIVE_EMOTION_KEY_PATTERN, taxonomyKeys } from '../taxonomy/emotionTaxonomy';

/** Existing enum value Phase 5A uses for "candidate" (see module header). */
const CANDIDATE_STATUS = 'draft' as const;
const DEFAULT_MAPPING_VERSION = 'phase-5a-candidates-1';
const DEFAULT_REPORT_PATH = 'reports/emotion-mappings/candidate-mappings.json';
const VERSE_KEY_PATTERN = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;
const FORBIDDEN_ROW_KEYS = ['arabicText', 'arabic', 'text', 'quranText', 'verseText', 'englishTranslation'];

// "Activatable today" means the emotion is already ACTIVE in the live app.
// Inactive Phase 5B seed rows are known keys but not yet valid mapping targets.
const activeEmotionKeys = new Set(
  seedEmotions.filter((emotion) => emotion.active).map((emotion) => emotion.key),
);
const seededEmotionKeys = new Set(seedEmotions.map((emotion) => emotion.key));
const knownEmotionKeys = new Set<string>([...seededEmotionKeys, ...taxonomyKeys]);

type RawRow = Record<string, unknown>;

export type RowIssue =
  | 'malformed_row'
  | 'missing_verse_key'
  | 'invalid_verse_key'
  | 'missing_emotion_key'
  | 'unknown_emotion_key'
  | 'missing_rationale'
  | 'missing_source'
  | 'forbidden_text_field'
  | 'duplicate_in_input';

export type EvaluatedRow = {
  index: number;
  verseKey: string | null;
  emotionKey: string | null;
  rationale: string | null;
  contextNotes: string | null;
  source: string | null;
  issues: RowIssue[];
  /** Valid AND targets a key that can be persisted today (shipped + live key pattern). */
  activatableToday: boolean;
  /** Populated only with --check-existing or --apply. */
  existingStatus?: string | null;
  outcome?: 'inserted' | 'skipped_existing' | 'skipped_emotion_inactive' | 'skipped_invalid' | 'dry_run';
};

type ParsedArgs = Map<string, string | boolean>;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = new Map();

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument "${arg}". Use --name or --name=value.`);
    }

    const separator = arg.indexOf('=');

    if (separator === -1) {
      args.set(arg.slice(2), true);
    } else {
      args.set(arg.slice(2, separator), arg.slice(separator + 1));
    }
  }

  return args;
}

function requireString(args: ParsedArgs, key: string): string {
  const value = args.get(key);

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required argument --${key}=<value>.`);
  }

  return value;
}

function optionalString(args: ParsedArgs, key: string, fallback: string): string {
  const value = args.get(key);
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function readRows(inputPath: string): RawRow[] {
  const absolute = resolve(process.cwd(), inputPath);
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(absolute, 'utf-8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unreadable';
    throw new Error(`Could not read/parse ${inputPath} as JSON: ${detail}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Input must be a JSON array of candidate mapping rows.');
  }

  return parsed as RawRow[];
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function evaluateRows(rows: RawRow[]): EvaluatedRow[] {
  const evaluated: EvaluatedRow[] = rows.map((row, index) => {
    const issues: RowIssue[] = [];

    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return {
        index,
        verseKey: null,
        emotionKey: null,
        rationale: null,
        contextNotes: null,
        source: null,
        issues: ['malformed_row'],
        activatableToday: false,
      };
    }

    const verseKey = asTrimmedString(row.verseKey);
    const emotionKey = asTrimmedString(row.emotionKey);
    const rationale = asTrimmedString(row.rationale);
    const contextNotes = asTrimmedString(row.contextNotes);
    const source = asTrimmedString(row.source);

    if (FORBIDDEN_ROW_KEYS.some((key) => key in row)) {
      issues.push('forbidden_text_field');
    }

    if (!verseKey) {
      issues.push('missing_verse_key');
    } else if (!VERSE_KEY_PATTERN.test(verseKey) || !isValidVerseKey(verseKey)) {
      issues.push('invalid_verse_key');
    }

    if (!emotionKey) {
      issues.push('missing_emotion_key');
    } else if (!knownEmotionKeys.has(emotionKey)) {
      issues.push('unknown_emotion_key');
    }

    if (!rationale) {
      issues.push('missing_rationale');
    }

    if (!source) {
      issues.push('missing_source');
    }

    const activatableToday =
      issues.length === 0 &&
      emotionKey !== null &&
      activeEmotionKeys.has(emotionKey) &&
      LIVE_EMOTION_KEY_PATTERN.test(emotionKey);

    return {
      index,
      verseKey,
      emotionKey,
      rationale,
      contextNotes,
      source,
      issues,
      activatableToday,
    };
  });

  const seen = new Map<string, number>();

  for (const row of evaluated) {
    if (row.issues.length > 0 || !row.verseKey || !row.emotionKey) {
      continue;
    }

    const pairKey = `${row.verseKey}|${row.emotionKey}`;
    const firstIndex = seen.get(pairKey);

    if (firstIndex === undefined) {
      seen.set(pairKey, row.index);
    } else {
      row.issues.push('duplicate_in_input');
      row.activatableToday = false;
    }
  }

  return evaluated;
}

export function isValidRow(row: EvaluatedRow): boolean {
  return row.issues.length === 0;
}

async function annotateExisting(rows: EvaluatedRow[]): Promise<void> {
  for (const row of rows) {
    if (!isValidRow(row) || !row.verseKey || !row.emotionKey) {
      continue;
    }

    const existing = await EmotionVerseMappingModel.findOne({
      verseReferenceKey: row.verseKey,
      emotionKey: row.emotionKey,
    })
      .select({ status: 1 })
      .lean<{ status?: string }>();

    row.existingStatus = existing ? (existing.status ?? 'unknown') : null;
  }
}

async function applyInserts(rows: EvaluatedRow[], mappingVersion: string): Promise<void> {
  for (const row of rows) {
    if (!isValidRow(row) || !row.verseKey || !row.emotionKey) {
      row.outcome = 'skipped_invalid';
      continue;
    }

    if (row.existingStatus !== null && row.existingStatus !== undefined) {
      // Insert-only: a mapping already exists, so we never touch it.
      row.outcome = 'skipped_existing';
      continue;
    }

    const emotionActive = await EmotionModel.exists({ key: row.emotionKey, active: true });

    if (!emotionActive) {
      row.outcome = 'skipped_emotion_inactive';
      continue;
    }

    const provenance = `[source: ${row.source}]`;
    const contextNotes = row.contextNotes ? `${provenance} ${row.contextNotes}` : provenance;

    await EmotionVerseMappingModel.create({
      verseReferenceKey: row.verseKey,
      emotionKey: row.emotionKey,
      status: CANDIDATE_STATUS,
      rationale: row.rationale ?? undefined,
      mappingVersion,
      contextNotes,
      tafsirReferences: [],
    });

    row.outcome = 'inserted';
  }
}

export function summarize(rows: EvaluatedRow[]) {
  const issueCounts: Record<string, number> = {};

  for (const row of rows) {
    for (const issue of row.issues) {
      issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    }
  }

  const outcomeCounts: Record<string, number> = {};

  for (const row of rows) {
    if (row.outcome) {
      outcomeCounts[row.outcome] = (outcomeCounts[row.outcome] ?? 0) + 1;
    }
  }

  return {
    totalRows: rows.length,
    validRows: rows.filter(isValidRow).length,
    invalidRows: rows.filter((row) => !isValidRow(row)).length,
    activatableToday: rows.filter((row) => row.activatableToday).length,
    needsEmotionActivation: rows.filter((row) => isValidRow(row) && !row.activatableToday).length,
    issueCounts,
    outcomeCounts,
  };
}

export function summarizeReview(rows: EvaluatedRow[], review: {
  originalCandidateCount: number;
  decisionCounts: { keep: number; reject: number; hold: number };
  reviews: { verseKey: string; emotionKey: string; decision: string }[];
  supplementalReviews: unknown[];
}) {
  const pairs = new Set(rows.map((row) => `${row.emotionKey}|${row.verseKey}`));
  const seen = new Set<string>();
  const counts = { keep: 0, reject: 0, hold: 0 };
  if (pairs.size !== rows.length || review.originalCandidateCount !== rows.length ||
      review.reviews.length !== rows.length || review.supplementalReviews.length !== 0) {
    throw new Error('Review must cover each candidate exactly once, without supplemental rows.');
  }
  for (const row of review.reviews) {
    const pair = `${row.emotionKey}|${row.verseKey}`;
    if (!pairs.has(pair) || seen.has(pair) || !['keep', 'reject', 'hold'].includes(row.decision)) {
      throw new Error(`Invalid or duplicate review decision: ${pair}`);
    }
    seen.add(pair);
    counts[row.decision as keyof typeof counts]++;
  }
  if (Object.keys(counts).some((key) => counts[key as keyof typeof counts] !== review.decisionCounts[key as keyof typeof counts])) {
    throw new Error('Review decisionCounts does not match the review decisions.');
  }
  return counts;
}

function toMarkdown(report: Record<string, unknown>, rows: EvaluatedRow[]): string {
  const summary = report.summary as ReturnType<typeof summarize>;
  const lines: string[] = [];

  lines.push('# Phase 5A candidate-mapping report');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt as string}`);
  lines.push(`- Input: \`${report.input as string}\``);
  lines.push(`- Mode: ${report.mode as string}`);
  lines.push(`- Mapping version: \`${report.mappingVersion as string}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total rows | ${summary.totalRows} |`);
  lines.push(`| Valid rows | ${summary.validRows} |`);
  lines.push(`| Invalid rows | ${summary.invalidRows} |`);
  lines.push(`| Activatable today (shipped emotion) | ${summary.activatableToday} |`);
  lines.push(`| Valid but emotion not yet active | ${summary.needsEmotionActivation} |`);
  if (report.reviewCounts) {
    const counts = report.reviewCounts as ReturnType<typeof summarizeReview>;
    lines.push(`| Human review KEEP | ${counts.keep} |`);
    lines.push(`| Human review REJECT | ${counts.reject} |`);
    lines.push(`| Human review HOLD | ${counts.hold} |`);
  }
  lines.push('');

  if (Object.keys(summary.issueCounts).length > 0) {
    lines.push('## Issues');
    lines.push('');
    for (const [issue, count] of Object.entries(summary.issueCounts)) {
      lines.push(`- \`${issue}\`: ${count}`);
    }
    lines.push('');
  }

  lines.push('## Rows');
  lines.push('');
  lines.push('| # | verseKey | emotionKey | valid | existing status | outcome | issues |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  for (const row of rows) {
    lines.push(
      `| ${row.index} | ${row.verseKey ?? '—'} | ${row.emotionKey ?? '—'} | ${
        isValidRow(row) ? 'yes' : 'no'
      } | ${row.existingStatus === undefined ? 'not checked' : row.existingStatus ?? 'none'} | ${
        row.outcome ?? 'dry_run'
      } | ${row.issues.join(', ') || '—'} |`,
    );
  }

  lines.push('');
  lines.push(
    report.reviewCounts
      ? '> Human editorial decisions are recorded separately from mapping lifecycle status. No mappings are promoted or activated by this report.'
      : '> Candidates are not reviewed or approved. A human must promote each mapping through the lifecycle in `docs/emotion-mappings/taxonomy.md`.',
  );
  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = requireString(args, 'input');
  const mappingVersion = optionalString(args, 'mapping-version', DEFAULT_MAPPING_VERSION);
  const reportPath = optionalString(args, 'report', DEFAULT_REPORT_PATH);
  const apply = args.get('apply') === true;
  const checkExisting = apply || args.get('check-existing') === true;

  const rows = evaluateRows(readRows(inputPath));
  // Optional audit-only review ledger; validate before any database operation.
  const reviewPath = optionalString(args, 'review', '');
  const reviewCounts = reviewPath
    ? summarizeReview(rows, JSON.parse(readFileSync(resolve(process.cwd(), reviewPath), 'utf8')))
    : undefined;

  let mode = 'dry-run (no database, no writes)';
  let databaseUsed = false;

  if (checkExisting) {
    if (!env.MONGODB_URI) {
      throw new Error('--check-existing / --apply need MONGODB_URI.');
    }

    if (env.NODE_ENV === 'production') {
      throw new Error('This tool is disabled when NODE_ENV=production.');
    }

    await connectToDatabase(env.MONGODB_URI);
    databaseUsed = true;
    await annotateExisting(rows);
    mode = apply ? 'apply (insert-only)' : 'dry-run with existing-mapping check';

    if (apply) {
      await applyInserts(rows, mappingVersion);
    }
  }

  const summary = summarize(rows);
  const report = {
    generatedAt: new Date().toISOString(),
    input: inputPath,
    mode,
    mappingVersion,
    candidateStatus: CANDIDATE_STATUS,
    databaseUsed,
    ...(reviewCounts ? { reviewSource: reviewPath, reviewCounts } : {}),
    summary,
    rows,
  };

  const absoluteReport = resolve(process.cwd(), reportPath);
  mkdirSync(dirname(absoluteReport), { recursive: true });
  writeFileSync(absoluteReport, `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = absoluteReport.replace(/\.json$/, '.md');
  writeFileSync(markdownPath, toMarkdown(report, rows));

  console.log(
    JSON.stringify(
      { mode, reportPath, markdownPath: markdownPath, ...summary },
      null,
      2,
    ),
  );

  if (summary.invalidRows > 0) {
    // Fail safely: a malformed or unresolvable row means the batch needs work.
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown candidate-import error.';
      console.error(`Candidate mapping import failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectFromDatabase();
    });
}
