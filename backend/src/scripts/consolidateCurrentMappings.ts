/** Raw-source current consolidation. Historical preview is a regression oracle only. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EMOTION_CATALOG } from '../emotions/emotionCatalog';
import { isValidVerseKey } from '../quran/referenceKeys';
import { seedAyahs } from '../seed/ayahs';

const DATA_DIR = resolve(__dirname, '../../data/emotion-candidates');
const BATCHES_DIR = resolve(DATA_DIR, 'batches');
const APPROVED_CURRENT_PATH = resolve(DATA_DIR, 'consolidated/approved-mappings-current.json');
const DUPLICATE_CURRENT_PATH = resolve(DATA_DIR, 'consolidated/duplicate-mappings-current.json');
const UPDATES_PATH = resolve(DATA_DIR, 'updates/editorial-corrections.json');

function pairKey(row: { verseKey: string; emotionKey: string }): string {
  return `${row.verseKey}|${row.emotionKey}`;
}

// ---------------------------------------------------------------------------
// Input loading
// ---------------------------------------------------------------------------

export type CurrentRow = {
  verseKey: string;
  emotionKey: string;
  sourceTypes: string[];
  sourceBatches: string[];
  sourceFiles: string[];
};

type FinalReviewRow = { verseKey: string; emotionKey: string; decision: 'keep' | 'reject' | 'hold' };
export type SourceRow = CurrentRow & { decision?: 'keep' | 'reject' | 'hold'; excluded?: boolean; eligible?: boolean; sourceEmotionKeys?: string[] };
type FinalReviewFile = { reviews: FinalReviewRow[]; supplementalReviews?: FinalReviewRow[] };

export type BatchFinalReviewResult = {
  batch: string;
  file: string;
  keepRows: CurrentRow[];
  sources: SourceRow[];
  rejectPairs: string[];
  holdPairs: string[];
};

/** Discover numbered review batches; candidates alone never grant approval. */
export function discoverBatches() {
  return readdirSync(BATCHES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^batch-\d+$/.test(entry.name))
    .map(entry => ({ number: Number(entry.name.slice(6)), name: entry.name, dir: resolve(BATCHES_DIR, entry.name) }))
    .sort((a, b) => a.number - b.number);
}
export function discoverLaterBatches() { return discoverBatches().filter(batch => batch.number > 5); }
export function loadLaterBatchFinalReview(batch: { number: number; name: string; dir: string }): BatchFinalReviewResult {
  const file = 'batches/' + batch.name + '/final-review.json';
  const review: FinalReviewFile = JSON.parse(readFileSync(resolve(batch.dir, 'final-review.json'), 'utf8'));
  const sources: SourceRow[] = [];
  for (const field of ['reviews', 'supplementalReviews'] as const) {
    for (const row of review[field] ?? []) {
      if (!['keep', 'reject', 'hold'].includes(row.decision)) throw new Error('Invalid decision in ' + file);
      sources.push({ verseKey: row.verseKey, emotionKey: row.emotionKey, decision: row.decision,
        sourceTypes: [field === 'reviews' ? 'direct_' + row.decision : 'supplemental_' + row.decision],
        sourceBatches: [String(batch.number)], sourceFiles: [file] });
    }
  }
  const overlapFile = 'batches/' + batch.name + '/overlaps.json';
  if (existsSync(resolve(DATA_DIR, overlapFile))) {
    const overlaps = JSON.parse(readFileSync(resolve(DATA_DIR, overlapFile), 'utf8')) as
      { verseKey: string; emotionKey: string; status?: string; sourceEmotionKeys?: string[] }[];
    for (const row of overlaps) sources.push({ verseKey: row.verseKey, emotionKey: row.emotionKey,
      sourceTypes: ['overlap'], sourceBatches: [String(batch.number)], sourceFiles: [overlapFile],
      sourceEmotionKeys: row.sourceEmotionKeys ?? [], excluded: row.status === 'excluded',
      // Phase 5C authorized eligible overlaps. Later proposals require an exact human KEEP.
      eligible: batch.number <= 5 || sources.some(s => pairKey(s) === pairKey(row) && s.decision === 'keep') });
  }
  return { batch: String(batch.number), file, sources,
    keepRows: sources.filter(row => row.decision === 'keep'),
    rejectPairs: sources.filter(row => row.decision === 'reject').map(pairKey),
    holdPairs: sources.filter(row => row.decision === 'hold').map(pairKey) };
}
export function loadHistoricalSources(): SourceRow[] {
  const foundation: SourceRow[] = seedAyahs.flatMap(ayah => ayah.emotions.map(emotionKey => ({
    verseKey: ayah.referenceKey, emotionKey, sourceTypes: ['mvp'], sourceBatches: [], sourceFiles: ['src/seed/ayahs.ts'],
  })));
  return [...foundation, ...discoverBatches().filter(batch => batch.number <= 5).flatMap(batch => loadLaterBatchFinalReview(batch).sources)];
}

export type EditorialCorrection = {
  id: string;
  recordedOn: string;
  type: 'reject' | 'hold' | 'add';
  verseKey: string;
  emotionKey: string;
  reason: string;
};

export type EditorialCorrectionsFile = { corrections: EditorialCorrection[] };

export function loadEditorialCorrections(): EditorialCorrectionsFile {
  return JSON.parse(readFileSync(UPDATES_PATH, 'utf-8')) as EditorialCorrectionsFile;
}

export type DuplicateAuditRow = {
  verseKey: string; emotionKey: string; occurrences: number; sourceFiles: string[]; sourceBatches: string[];
  sourceEmotionKeys: string[]; sourceTypes: string[]; resolution: string; finalRowIncluded: boolean;
  collapsedToOneRow: boolean; correctionId?: string; reason?: string;
};
export type ConsolidationResult = {
  rows: CurrentRow[]; rejectPairs: Set<string>; holdPairs: Set<string>;
  duplicateAuditRows: DuplicateAuditRow[]; laterBatches: BatchFinalReviewResult[];
  historicalSourceDuplicateIdentities: number; historicalOverlapDuplicateIdentities: number;
};
export function consolidate(historicalSources: SourceRow[], laterBatches: BatchFinalReviewResult[], corrections: EditorialCorrectionsFile): ConsolidationResult {
  const sources = [...historicalSources, ...laterBatches.flatMap(batch => batch.sources)];
  const rejectPairs = new Set(sources.filter(row => row.decision === 'reject').map(pairKey));
  const holdPairs = new Set(sources.filter(row => row.decision === 'hold').map(pairKey));
  const updates = new Map<string, EditorialCorrection>();
  for (const correction of corrections.corrections) {
    if (!['add', 'reject', 'hold'].includes(correction.type)) throw new Error('Invalid editorial type');
    const key = pairKey(correction);
    if (updates.has(key)) throw new Error('Ambiguous editorial updates: ' + key);
    updates.set(key, correction);
    if (correction.type === 'reject') rejectPairs.add(key);
    if (correction.type === 'hold') holdPairs.add(key);
    if (correction.type === 'add' && (rejectPairs.has(key) || holdPairs.has(key))) throw new Error('Editorial add conflicts with protection: ' + key);
    sources.push({ verseKey: correction.verseKey, emotionKey: correction.emotionKey,
      decision: correction.type === 'add' ? 'keep' : correction.type,
      sourceFiles: ['updates/editorial-corrections.json'], sourceBatches: [], sourceTypes: ['editorial_' + correction.type] });
  }
  const groups = new Map<string, SourceRow[]>();
  for (const row of sources) {
    if (!isValidVerseKey(row.verseKey) || !EMOTION_CATALOG.some(e => e.key === row.emotionKey)) throw new Error('Invalid source pair: ' + pairKey(row));
    const group = groups.get(pairKey(row)) ?? []; group.push(row); groups.set(pairKey(row), group);
  }
  const rows: CurrentRow[] = [];
  const duplicateAuditRows: DuplicateAuditRow[] = [];
  const union = (group: SourceRow[], field: 'sourceFiles' | 'sourceTypes' | 'sourceBatches' | 'sourceEmotionKeys') => [...new Set(group.flatMap(row => row[field] ?? []))].sort();
  for (const [key, group] of groups) {
    const correction = updates.get(key);
    const eligible = group.filter(row => !row.excluded && row.eligible !== false && (!row.decision || row.decision === 'keep'));
    const included = !rejectPairs.has(key) && !holdPairs.has(key) && eligible.length > 0;
    const { verseKey, emotionKey } = group[0];
    if (included) rows.push({ verseKey, emotionKey, sourceFiles: union(eligible, 'sourceFiles'), sourceBatches: union(eligible, 'sourceBatches'), sourceTypes: union(eligible, 'sourceTypes') });
    if (group.length > 1 || correction || !included) duplicateAuditRows.push({
      verseKey, emotionKey, occurrences: group.length, sourceFiles: union(group, 'sourceFiles'),
      sourceBatches: union(group, 'sourceBatches'), sourceTypes: union(group, 'sourceTypes'), sourceEmotionKeys: union(group, 'sourceEmotionKeys'),
      resolution: correction && correction.type !== 'add' ? 'blocked_by_editorial_' + correction.type :
        rejectPairs.has(key) ? 'blocked_by_reject' : holdPairs.has(key) ? 'blocked_by_hold' :
        !included ? (group.some(row => row.excluded) ? 'blocked_by_editorial_update' : 'unapproved_overlap') :
        group.some(row => row.sourceTypes.includes('overlap')) && group.some(row => row.sourceTypes.includes('direct_keep')) ? 'superseded_by_direct_keep' : 'duplicate_identity_collapsed',
      finalRowIncluded: included, collapsedToOneRow: included && group.length > 1,
      ...(correction ? { correctionId: correction.id, reason: correction.reason } : {}),
    });
  }
  const compare = (a: {verseKey: string; emotionKey: string}, b: {verseKey: string; emotionKey: string}) => {
    const [as, aa] = a.verseKey.split(':').map(Number); const [bs, ba] = b.verseKey.split(':').map(Number);
    return as - bs || aa - ba || a.emotionKey.localeCompare(b.emotionKey);
  };
  const countDuplicateIdentities = (input: SourceRow[]) => {
    const counts = new Map<string, number>();
    input.forEach(row => counts.set(pairKey(row), (counts.get(pairKey(row)) ?? 0) + 1));
    return [...counts.values()].filter(count => count > 1).length;
  };
  return { rows: rows.sort(compare), rejectPairs, holdPairs, duplicateAuditRows: duplicateAuditRows.sort(compare), laterBatches,
    historicalSourceDuplicateIdentities: countDuplicateIdentities(historicalSources),
    historicalOverlapDuplicateIdentities: countDuplicateIdentities(historicalSources.filter(row => row.sourceTypes.includes('overlap'))),
  };
}

// ---------------------------------------------------------------------------
// Validation (fails loudly rather than writing a silently-wrong artifact)
// ---------------------------------------------------------------------------

export function validateConsolidation(result: ConsolidationResult): string[] {
  const problems: string[] = [];
  const canonicalEmotionKeys = new Set(EMOTION_CATALOG.map((emotion) => emotion.key));
  const seen = new Set<string>();

  result.rows.forEach((row) => {
    const key = pairKey(row);
    if (seen.has(key)) problems.push(`Duplicate final pair: ${key}`);
    seen.add(key);

    if (!isValidVerseKey(row.verseKey)) problems.push(`Invalid verseKey: ${row.verseKey}`);
    if (!canonicalEmotionKeys.has(row.emotionKey)) problems.push(`Unknown emotionKey: ${row.emotionKey}`);
    if (result.rejectPairs.has(key)) problems.push(`REJECTed pair present in current output: ${key}`);
    if (result.holdPairs.has(key)) problems.push(`HELD pair present in current output: ${key}`);
  });

  const emotionsWithMappings = new Set(result.rows.map((row) => row.emotionKey));
  canonicalEmotionKeys.forEach((key) => {
    if (!emotionsWithMappings.has(key)) problems.push(`Active emotion with zero approved mappings: ${key}`);
  });

  return problems;
}

// ---------------------------------------------------------------------------
// Output assembly
// ---------------------------------------------------------------------------

function countByEmotion(rows: CurrentRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  EMOTION_CATALOG.forEach((emotion) => {
    counts[emotion.key] = 0;
  });
  rows.forEach((row) => {
    counts[row.emotionKey] = (counts[row.emotionKey] ?? 0) + 1;
  });
  return counts;
}

export function buildApprovedMappingsCurrent(result: ConsolidationResult) {
  const counts = countByEmotion(result.rows);
  return {
    artifact: 'approved-mappings-current',
    description:
      'The permanent, continuously-updated approved (verseKey, emotionKey) mapping set — raw MVP foundation and batch 1-5 reviews/overlaps + every batches/batch-N final-review.json KEEP for N >= 6 + updates/editorial-corrections.json, applied last. Never a phase-specific snapshot: Batch 7, Batch 8, etc. regenerate this same file in place. NOT production/runtime data by itself — see docs/emotion-mappings for how this feeds activation.',
    totalPairs: result.rows.length,
    uniqueVerses: new Set(result.rows.map((row) => row.verseKey)).size,
    emotionCount: Object.keys(counts).length,
    countByEmotion: counts,
    rows: result.rows,
  };
}

export function buildDuplicateMappingsCurrent(result: ConsolidationResult) {
  const remaining = result.rows.length - new Set(result.rows.map(pairKey)).size;
  return {
    artifact: 'current-duplicate-audit',
    description:
      'Audits the CURRENT complete mapping workflow (raw MVP foundation, batch reviews and overlaps + updates/editorial-corrections.json) for duplicate (verseKey, emotionKey) identities and for pairs blocked by a later editorial REJECT/HOLD correction. The same verse mapped to different emotions is never treated as a duplicate. Source batch/update files are never modified by this audit.',
    historicalSourceDuplicateIdentities: result.historicalSourceDuplicateIdentities,
    historicalOverlapDuplicateIdentities: result.historicalOverlapDuplicateIdentities,
    duplicateIdentitiesFound: result.duplicateAuditRows.filter((row) => row.occurrences > 1).length,
    editorialBlocksApplied: result.duplicateAuditRows.filter((row) => row.resolution.startsWith('blocked_by_editorial')).length,
    duplicatesRemainingInCurrentApprovedMappings: remaining,
    rows: result.duplicateAuditRows,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Regression oracle only: no preview row ever enters consolidation. */
export function validateHistoricalReconstruction(sources = loadHistoricalSources()) {
  const actual = consolidate(sources, [], { corrections: [] }).rows.map(pairKey).sort();
  const preview = JSON.parse(readFileSync(resolve(DATA_DIR, 'consolidated/approved-mappings-preview.json'), 'utf8')) as {totalPairs: number; rows: CurrentRow[]};
  const expected = preview.rows.map(pairKey).sort();
  const missing = expected.filter(key => !actual.includes(key));
  const extra = actual.filter(key => !expected.includes(key));
  if (actual.length !== preview.totalPairs || expected.length !== preview.totalPairs || new Set(expected).size !== expected.length || missing.length || extra.length)
    throw new Error('Historical reconstruction diverged: ' + JSON.stringify({ missing, extra, actual: actual.length, expected: preview.totalPairs }));
  return { totalPairs: actual.length, missing, extra };
}
export function runConsolidation() {
  const historicalSources = loadHistoricalSources();
  validateHistoricalReconstruction(historicalSources);
  const laterBatches = discoverLaterBatches().map(loadLaterBatchFinalReview);
  const corrections = loadEditorialCorrections();

  const result = consolidate(historicalSources, laterBatches, corrections);
  const problems = validateConsolidation(result);

  if (problems.length > 0) {
    throw new Error(`Consolidation failed validation:\n${problems.join('\n')}`);
  }

  const approvedCurrent = buildApprovedMappingsCurrent(result);
  const duplicateCurrent = buildDuplicateMappingsCurrent(result);

  writeFileSync(APPROVED_CURRENT_PATH, `${JSON.stringify(approvedCurrent, null, 2)}\n`);
  writeFileSync(DUPLICATE_CURRENT_PATH, `${JSON.stringify(duplicateCurrent, null, 2)}\n`);

  return { approvedCurrent, duplicateCurrent, laterBatches: laterBatches.map((b) => b.batch) };
}

if (require.main === module) {
  try {
    const { approvedCurrent, duplicateCurrent, laterBatches } = runConsolidation();
    console.log(
      JSON.stringify(
        {
          approvedCurrentPath: APPROVED_CURRENT_PATH,
          duplicateCurrentPath: DUPLICATE_CURRENT_PATH,
          laterBatchesProcessed: laterBatches,
          totalPairs: approvedCurrent.totalPairs,
          uniqueVerses: approvedCurrent.uniqueVerses,
          emotionCount: approvedCurrent.emotionCount,
          seekingGuidanceCount: approvedCurrent.countByEmotion.seeking_guidance,
          faithShakenCount: approvedCurrent.countByEmotion.faith_shaken,
          duplicatesRemainingInCurrentApprovedMappings: duplicateCurrent.duplicatesRemainingInCurrentApprovedMappings,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`Current mapping consolidation failed: ${error instanceof Error ? error.message : 'Unknown error.'}`);
    process.exitCode = 1;
  }
}
