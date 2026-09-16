/**
 * Approved emotion mapping activation.
 *
 * Default behavior is a READ-ONLY PREFLIGHT: it loads the 1,845-row approved
 * candidate set (via activationDryRun.ts's loaders/validators, reused rather
 * than duplicated), reads the live `Emotion`/`EmotionVerseMapping`
 * collections read-only, classifies every candidate and every live document,
 * computes the exact write plan a future activation would perform, verifies
 * the required unique indexes and transaction support, and writes a report.
 * It never writes to MongoDB.
 *
 * A real activation additionally requires --apply plus explicit, exact
 * confirmation flags (see parseArgs/main below) and is refused outright when
 * NODE_ENV=production. This script's --apply path is implemented and
 * exercised by tests against mocked Mongoose models — it is not invoked
 * against a live database by anything in this repository yet.
 *
 * SAFETY
 *  - Never touches Verse, VerseTranslation, Ayah, Quran Arabic, Quran
 *    translation text, favorites, recent history, or any collection other
 *    than Emotion/EmotionVerseMapping.
 *  - Never deletes or silently reassigns the status of a legacy mapping that
 *    is not part of the 1,845 approved candidate set.
 *  - Never promotes a live mapping whose status is "rejected" — that blocks
 *    the whole preflight instead.
 *  - Every write (once authorized) happens inside a single MongoDB
 *    transaction (`mongoose.startSession()` + `session.withTransaction`);
 *    there is no non-transactional fallback path.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import mongoose, { Types } from 'mongoose';

import { env } from '../config/env';
import {
  APP_LOCALES,
  EMOTION_CATALOG_BY_KEY,
  hasAllRequiredLocales,
  type LocalizedText,
} from '../emotions/emotionCatalog';
import { EmotionModel } from '../models/Emotion';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { isValidVerseKey } from '../quran/referenceKeys';
import type { EmotionMappingStatus } from '../types/domain';
import { writeVerifiedJsonBackup } from '../utils/backupFile';
import { EMOTION_MAPPING_ACTIVATION_BACKUPS_DIR } from '../utils/backupPaths';
import { recordsRoundTripObjectIds, wrapBackupEnvelope } from '../utils/objectId';
import {
  APPROVED_MAPPING_VERSION,
  buildActivationCandidates,
  loadApprovedMappingsPreview,
  loadReviewDecisions,
  validateActivationSet,
  type ActivationCandidate,
} from './activationDryRun';

export { APPROVED_MAPPING_VERSION };

const DEFAULT_PREFLIGHT_REPORT_PATH = 'reports/emotion-mappings/activation-preflight.json';

// This migration owns the frozen Phase 5 preview, not every emotion subsequently
// added to the catalog. New emotions require their own reviewed activation path.
const historicalPreview = loadApprovedMappingsPreview();
export const HISTORICAL_APPROVED_EMOTION_KEYS: readonly string[] = Object.freeze(
  [...new Set(historicalPreview.rows.map((row) => row.emotionKey))].sort(),
);
if (
  historicalPreview.rows.length !== 1845 ||
  HISTORICAL_APPROVED_EMOTION_KEYS.length !== 29 ||
  HISTORICAL_APPROVED_EMOTION_KEYS.some((key) => !EMOTION_CATALOG_BY_KEY.has(key))
) {
  throw new Error('Historical activation requires the frozen 1,845-mapping / 29-emotion preview.');
}

function candidatePairKey(candidate: Pick<ActivationCandidate, 'verseKey' | 'emotionKey'>): string {
  return `${candidate.verseKey}|${candidate.emotionKey}`;
}

function livePairKey(mapping: { verseReferenceKey: string; emotionKey: string }): string {
  return `${mapping.verseReferenceKey}|${mapping.emotionKey}`;
}

// ---------------------------------------------------------------------------
// Live document shapes (lean, read-only)
// ---------------------------------------------------------------------------

export type LiveEmotionDoc = {
  _id: Types.ObjectId;
  key: string;
  /** @deprecated legacy flat field — see backend/src/emotions/emotionCatalog.ts */
  name?: string;
  /** @deprecated legacy flat field */
  arabicName?: string;
  /** @deprecated legacy flat field */
  description?: string;
  names?: LocalizedText;
  descriptions?: LocalizedText;
  icon: string;
  order: number;
  active: boolean;
  [key: string]: unknown;
};

export type LiveMappingDoc = {
  _id: Types.ObjectId;
  verseReferenceKey: string;
  emotionKey: string;
  status: EmotionMappingStatus;
  mappingVersion: string;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// A. Emotion definition audit
// ---------------------------------------------------------------------------

export type EmotionDefinitionConflict = {
  key: string;
  field: 'icon' | 'order';
  live: unknown;
  canonical: unknown;
};

export type EmotionLocalizationConflict = {
  key: string;
  locale: string;
  field: 'names' | 'descriptions';
  live: string;
  canonical: string;
};

export type EmotionAuditResult = {
  approvedEmotionKeys: string[];
  existingApprovedEmotionDefinitions: string[];
  missingApprovedEmotionDefinitions: string[];
  existingInactiveApprovedEmotions: string[];
  existingActiveApprovedEmotions: string[];
  unexpectedEmotionDefinitions: string[];
  conflictingEmotionDefinitions: EmotionDefinitionConflict[];
  /** Existing live documents whose `names`/`descriptions` already exactly match the canonical catalog — nothing to write. */
  emotionsWithLocalizationNoOp: string[];
  /** Existing live documents missing `names`/`descriptions` (or missing a required locale within them) — safe to $set from the catalog. */
  emotionsNeedingLocalizationUpdate: string[];
  /** Existing live documents whose `names`/`descriptions` are present but diverge from the canonical catalog — BLOCKS activation; never silently overwritten. */
  emotionsWithLocalizationConflict: string[];
  localizationConflictDetails: EmotionLocalizationConflict[];
};

const CANONICAL_EMOTION_FIELDS = ['icon', 'order'] as const;

function findLocalizationConflicts(
  key: string,
  field: 'names' | 'descriptions',
  live: LocalizedText,
  canonical: LocalizedText,
): EmotionLocalizationConflict[] {
  const conflicts: EmotionLocalizationConflict[] = [];
  APP_LOCALES.forEach((locale) => {
    if (live[locale] !== canonical[locale]) {
      conflicts.push({ key, locale, field, live: live[locale], canonical: canonical[locale] });
    }
  });
  return conflicts;
}

/**
 * Pure classification: live Emotion documents vs. the 29 historical preview
 * keys, using their canonical catalog definitions, covering both
 * existence/active-state (as before) and localization state (new):
 *   - a document with no `names`/`descriptions` (or missing a required
 *     locale within either) needs a localization update ($set only, legacy
 *     flat fields untouched);
 *   - a document whose `names`/`descriptions` already exactly match the
 *     catalog is a no-op;
 *   - a document whose `names`/`descriptions` are present but differ from
 *     the catalog is a conflict — blocks activation rather than being
 *     silently overwritten (see buildWritePlan).
 * No I/O.
 */
export function auditEmotionDefinitions(liveEmotions: LiveEmotionDoc[]): EmotionAuditResult {
  const approvedEmotionKeys = [...HISTORICAL_APPROVED_EMOTION_KEYS];
  const approvedSet = new Set(approvedEmotionKeys);
  const liveByKey = new Map(liveEmotions.map((emotion) => [emotion.key, emotion]));

  const existingApprovedEmotionDefinitions: string[] = [];
  const missingApprovedEmotionDefinitions: string[] = [];
  const existingInactiveApprovedEmotions: string[] = [];
  const existingActiveApprovedEmotions: string[] = [];
  const conflictingEmotionDefinitions: EmotionDefinitionConflict[] = [];
  const emotionsWithLocalizationNoOp: string[] = [];
  const emotionsNeedingLocalizationUpdate: string[] = [];
  const emotionsWithLocalizationConflict: string[] = [];
  const localizationConflictDetails: EmotionLocalizationConflict[] = [];

  approvedEmotionKeys.forEach((key) => {
    const live = liveByKey.get(key);

    if (!live) {
      missingApprovedEmotionDefinitions.push(key);
      return;
    }

    existingApprovedEmotionDefinitions.push(key);
    if (live.active) existingActiveApprovedEmotions.push(key);
    else existingInactiveApprovedEmotions.push(key);

    const canonical = EMOTION_CATALOG_BY_KEY.get(key)!;
    CANONICAL_EMOTION_FIELDS.forEach((field) => {
      if (live[field] !== canonical[field]) {
        conflictingEmotionDefinitions.push({ key, field, live: live[field], canonical: canonical[field] });
      }
    });

    const namesPresent = hasAllRequiredLocales(live.names);
    const descriptionsPresent = hasAllRequiredLocales(live.descriptions);

    if (!namesPresent || !descriptionsPresent) {
      emotionsNeedingLocalizationUpdate.push(key);
      return;
    }

    const nameConflicts = findLocalizationConflicts(key, 'names', live.names as LocalizedText, canonical.names);
    const descriptionConflicts = findLocalizationConflicts(
      key,
      'descriptions',
      live.descriptions as LocalizedText,
      canonical.descriptions,
    );
    const conflicts = [...nameConflicts, ...descriptionConflicts];

    if (conflicts.length > 0) {
      emotionsWithLocalizationConflict.push(key);
      localizationConflictDetails.push(...conflicts);
    } else {
      emotionsWithLocalizationNoOp.push(key);
    }
  });

  const unexpectedEmotionDefinitions = [...liveByKey.keys()].filter((key) => !approvedSet.has(key)).sort();

  return {
    approvedEmotionKeys,
    existingApprovedEmotionDefinitions,
    missingApprovedEmotionDefinitions,
    existingInactiveApprovedEmotions,
    existingActiveApprovedEmotions,
    unexpectedEmotionDefinitions,
    conflictingEmotionDefinitions,
    emotionsWithLocalizationNoOp,
    emotionsNeedingLocalizationUpdate,
    emotionsWithLocalizationConflict,
    localizationConflictDetails,
  };
}

// ---------------------------------------------------------------------------
// B/C/D. Mapping audit
// ---------------------------------------------------------------------------

export type MappingAuditResult = {
  candidatePairs: number;
  candidatePairsAlreadyExisting: string[];
  candidatePairsMissing: string[];
  candidatePairsAlreadyApproved: string[];
  candidatePairsWithDevelopmentStatus: string[];
  candidatePairsWithDraftStatus: string[];
  candidatePairsWithReviewedStatus: string[];
  candidatePairsWithRejectedStatus: string[];
  candidatePairsWithUnexpectedStatus: string[];
  livePairsOutsideApprovedSet: string[];
  livePairsOutsideApprovedSetByStatus: Partial<Record<EmotionMappingStatus, string[]>>;
  liveRejectIntersection: string[];
  liveHoldIntersection: string[];
  duplicateLogicalPairs: string[];
  invalidVerseKeysInLiveMappings: string[];
  unknownEmotionKeysInLiveMappings: string[];
};

/** Pure classification: live EmotionVerseMapping documents vs. the 1,845 approved candidates. No I/O. */
export function auditMappings(
  liveMappings: LiveMappingDoc[],
  candidates: ActivationCandidate[],
  rejectPairs: Set<string>,
  holdPairs: Set<string>,
  knownEmotionKeys: Set<string>,
): MappingAuditResult {
  const candidateKeySet = new Set(candidates.map(candidatePairKey));
  const liveByKey = new Map<string, LiveMappingDoc[]>();

  liveMappings.forEach((mapping) => {
    const key = livePairKey(mapping);
    const existing = liveByKey.get(key) ?? [];
    existing.push(mapping);
    liveByKey.set(key, existing);
  });

  const duplicateLogicalPairs = [...liveByKey.entries()]
    .filter(([, docs]) => docs.length > 1)
    .map(([key]) => key)
    .sort();

  const candidatePairsAlreadyExisting: string[] = [];
  const candidatePairsMissing: string[] = [];
  const candidatePairsAlreadyApproved: string[] = [];
  const candidatePairsWithDevelopmentStatus: string[] = [];
  const candidatePairsWithDraftStatus: string[] = [];
  const candidatePairsWithReviewedStatus: string[] = [];
  const candidatePairsWithRejectedStatus: string[] = [];
  const candidatePairsWithUnexpectedStatus: string[] = [];

  candidates.forEach((candidate) => {
    const key = candidatePairKey(candidate);
    const liveDocs = liveByKey.get(key);

    if (!liveDocs || liveDocs.length === 0) {
      candidatePairsMissing.push(key);
      return;
    }

    candidatePairsAlreadyExisting.push(key);
    const status = liveDocs[0].status;

    switch (status) {
      case 'approved':
        candidatePairsAlreadyApproved.push(key);
        break;
      case 'development':
        candidatePairsWithDevelopmentStatus.push(key);
        break;
      case 'draft':
        candidatePairsWithDraftStatus.push(key);
        break;
      case 'reviewed':
        candidatePairsWithReviewedStatus.push(key);
        break;
      case 'rejected':
        candidatePairsWithRejectedStatus.push(key);
        break;
      default:
        candidatePairsWithUnexpectedStatus.push(key);
    }
  });

  const livePairsOutsideApprovedSet: string[] = [];
  const livePairsOutsideApprovedSetByStatus: Partial<Record<EmotionMappingStatus, string[]>> = {};
  const liveRejectIntersection: string[] = [];
  const liveHoldIntersection: string[] = [];

  [...liveByKey.entries()].forEach(([key, docs]) => {
    if (!candidateKeySet.has(key)) {
      livePairsOutsideApprovedSet.push(key);
      docs.forEach((doc) => {
        const bucket = livePairsOutsideApprovedSetByStatus[doc.status] ?? [];
        bucket.push(key);
        livePairsOutsideApprovedSetByStatus[doc.status] = bucket;
      });
    }
    if (rejectPairs.has(key)) liveRejectIntersection.push(key);
    if (holdPairs.has(key)) liveHoldIntersection.push(key);
  });

  const invalidVerseKeysInLiveMappings = [
    ...new Set(liveMappings.filter((m) => !isValidVerseKey(m.verseReferenceKey)).map((m) => m.verseReferenceKey)),
  ].sort();
  const unknownEmotionKeysInLiveMappings = [
    ...new Set(liveMappings.filter((m) => !knownEmotionKeys.has(m.emotionKey)).map((m) => m.emotionKey)),
  ].sort();

  return {
    candidatePairs: candidates.length,
    candidatePairsAlreadyExisting: candidatePairsAlreadyExisting.sort(),
    candidatePairsMissing: candidatePairsMissing.sort(),
    candidatePairsAlreadyApproved: candidatePairsAlreadyApproved.sort(),
    candidatePairsWithDevelopmentStatus: candidatePairsWithDevelopmentStatus.sort(),
    candidatePairsWithDraftStatus: candidatePairsWithDraftStatus.sort(),
    candidatePairsWithReviewedStatus: candidatePairsWithReviewedStatus.sort(),
    candidatePairsWithRejectedStatus: candidatePairsWithRejectedStatus.sort(),
    candidatePairsWithUnexpectedStatus: candidatePairsWithUnexpectedStatus.sort(),
    livePairsOutsideApprovedSet: livePairsOutsideApprovedSet.sort(),
    livePairsOutsideApprovedSetByStatus,
    liveRejectIntersection: liveRejectIntersection.sort(),
    liveHoldIntersection: liveHoldIntersection.sort(),
    duplicateLogicalPairs,
    invalidVerseKeysInLiveMappings,
    unknownEmotionKeysInLiveMappings,
  };
}

// ---------------------------------------------------------------------------
// Write plan (exact reconciliation, Step 15)
// ---------------------------------------------------------------------------

export type WritePlan = {
  emotionsToCreate: string[];
  emotionsToActivate: string[];
  /** Existing live Emotion documents to $set names/descriptions on (localization only — no other field changes). */
  emotionsToLocalize: string[];
  /** Existing live Emotion documents whose localization already matches the catalog exactly — no write needed. */
  emotionsLocalizationNoOp: string[];
  mappingsToInsert: string[];
  mappingsToPromote: string[];
  mappingsAlreadyApproved: string[];
  reconciliation: {
    insert: number;
    promote: number;
    alreadyApproved: number;
    total: number;
    expectedApprovedCandidates: number;
    matches: boolean;
  };
  predictedFinalActiveEmotions: number;
  blocked: boolean;
  blockingReasons: string[];
};

/** Pure: derives the exact future write plan from the two audits, including the mandatory 1,845 reconciliation. No I/O. */
export function buildWritePlan(emotionAudit: EmotionAuditResult, mappingAudit: MappingAuditResult): WritePlan {
  const blockingReasons: string[] = [];

  if (emotionAudit.conflictingEmotionDefinitions.length > 0) {
    blockingReasons.push(
      `${emotionAudit.conflictingEmotionDefinitions.length} live Emotion document(s) conflict with the canonical seed definition.`,
    );
  }
  if (emotionAudit.emotionsWithLocalizationConflict.length > 0) {
    blockingReasons.push(
      `${emotionAudit.emotionsWithLocalizationConflict.length} live Emotion document(s) have existing names/descriptions that conflict with the canonical catalog — refusing to overwrite: ${emotionAudit.emotionsWithLocalizationConflict.join(', ')}.`,
    );
  }
  if (mappingAudit.candidatePairsWithRejectedStatus.length > 0) {
    blockingReasons.push(
      `${mappingAudit.candidatePairsWithRejectedStatus.length} approved candidate pair(s) already exist live with status "rejected" — refusing to re-approve.`,
    );
  }
  if (mappingAudit.candidatePairsWithUnexpectedStatus.length > 0) {
    blockingReasons.push(
      `${mappingAudit.candidatePairsWithUnexpectedStatus.length} approved candidate pair(s) have an unrecognized live status.`,
    );
  }
  if (mappingAudit.liveRejectIntersection.length > 0) {
    blockingReasons.push(`${mappingAudit.liveRejectIntersection.length} live mapping(s) intersect a REJECT decision.`);
  }
  if (mappingAudit.liveHoldIntersection.length > 0) {
    blockingReasons.push(`${mappingAudit.liveHoldIntersection.length} live mapping(s) intersect a HOLD decision.`);
  }
  if (mappingAudit.duplicateLogicalPairs.length > 0) {
    blockingReasons.push(`${mappingAudit.duplicateLogicalPairs.length} duplicate logical (verseReferenceKey, emotionKey) pair(s) exist live.`);
  }
  if (mappingAudit.invalidVerseKeysInLiveMappings.length > 0) {
    blockingReasons.push(`${mappingAudit.invalidVerseKeysInLiveMappings.length} live mapping(s) reference an invalid verseKey.`);
  }
  if (mappingAudit.unknownEmotionKeysInLiveMappings.length > 0) {
    blockingReasons.push(`${mappingAudit.unknownEmotionKeysInLiveMappings.length} live mapping(s) reference an unknown emotionKey.`);
  }

  const emotionsToCreate = emotionAudit.missingApprovedEmotionDefinitions;
  const emotionsToActivate = emotionAudit.existingInactiveApprovedEmotions;
  const emotionsToLocalize = emotionAudit.emotionsNeedingLocalizationUpdate;
  const emotionsLocalizationNoOp = emotionAudit.emotionsWithLocalizationNoOp;
  const mappingsToInsert = mappingAudit.candidatePairsMissing;
  const mappingsToPromote = [
    ...mappingAudit.candidatePairsWithDevelopmentStatus,
    ...mappingAudit.candidatePairsWithDraftStatus,
    ...mappingAudit.candidatePairsWithReviewedStatus,
  ].sort();
  const mappingsAlreadyApproved = mappingAudit.candidatePairsAlreadyApproved;

  const insert = mappingsToInsert.length;
  const promote = mappingsToPromote.length;
  const alreadyApproved = mappingsAlreadyApproved.length;
  const total = insert + promote + alreadyApproved;
  const expectedApprovedCandidates = mappingAudit.candidatePairs;
  const matches = total === expectedApprovedCandidates;

  if (!matches) {
    blockingReasons.push(
      `Write plan does not reconcile: ${insert} insert + ${promote} promote + ${alreadyApproved} already-approved = ${total}, expected ${expectedApprovedCandidates}.`,
    );
  }

  const predictedFinalActiveEmotions =
    emotionAudit.existingActiveApprovedEmotions.length + emotionsToActivate.length + emotionsToCreate.length;

  if (predictedFinalActiveEmotions !== emotionAudit.approvedEmotionKeys.length) {
    blockingReasons.push(
      `Predicted final active emotion count is ${predictedFinalActiveEmotions}, expected ${emotionAudit.approvedEmotionKeys.length}.`,
    );
  }

  return {
    emotionsToCreate,
    emotionsToActivate,
    emotionsToLocalize,
    emotionsLocalizationNoOp,
    mappingsToInsert,
    mappingsToPromote,
    mappingsAlreadyApproved,
    reconciliation: { insert, promote, alreadyApproved, total, expectedApprovedCandidates, matches },
    predictedFinalActiveEmotions,
    blocked: blockingReasons.length > 0,
    blockingReasons,
  };
}

// ---------------------------------------------------------------------------
// Read-only live database access
// ---------------------------------------------------------------------------

function assertNonProductionConnectable() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required.');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Activation preflight/apply refuses to run when NODE_ENV=production.');
  }
}

/** Opens a read-only-safe connection (autoIndex/autoCreate disabled) and returns the live database name. Caller must disconnect. */
async function connectReadOnly(): Promise<string> {
  assertNonProductionConnectable();
  await mongoose.connect(env.MONGODB_URI!, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  return mongoose.connection.db!.databaseName;
}

export async function readLivePreflightData(): Promise<{ emotions: LiveEmotionDoc[]; mappings: LiveMappingDoc[] }> {
  const [emotions, mappings] = await Promise.all([
    EmotionModel.find({}).lean<LiveEmotionDoc[]>(),
    EmotionVerseMappingModel.find({}).lean<LiveMappingDoc[]>(),
  ]);
  return { emotions, mappings };
}

export type IndexVerification = {
  emotionUniqueKeyIndexPresent: boolean;
  mappingUniquePairIndexPresent: boolean;
  emotionIndexes: unknown[];
  mappingIndexes: unknown[];
};

/** Read-only: inspects live indexes via `collection.indexes()`. Never creates or modifies an index. */
export async function verifyLiveIndexes(): Promise<IndexVerification> {
  const [emotionIndexes, mappingIndexes] = await Promise.all([
    EmotionModel.collection.indexes(),
    EmotionVerseMappingModel.collection.indexes(),
  ]);

  const emotionUniqueKeyIndexPresent = emotionIndexes.some(
    (index) => index.unique === true && index.key && Object.keys(index.key).length === 1 && index.key.key === 1,
  );
  const mappingUniquePairIndexPresent = mappingIndexes.some(
    (index) =>
      index.unique === true &&
      index.key &&
      Object.keys(index.key).length === 2 &&
      index.key.verseReferenceKey === 1 &&
      index.key.emotionKey === 1,
  );

  return { emotionUniqueKeyIndexPresent, mappingUniquePairIndexPresent, emotionIndexes, mappingIndexes };
}

export type TransactionSupportResult = { supported: boolean; error?: string };

/** Read-only: starts a session/transaction, runs a read-only query, and aborts — never commits, never writes. */
export async function verifyTransactionSupport(): Promise<TransactionSupportResult> {
  const session = await mongoose.startSession();
  try {
    let supported = false;
    let abortError: unknown;

    try {
      await session.withTransaction(async () => {
        await EmotionModel.findOne({}).session(session).lean();
        supported = true;
        // Deliberately abort: this proves transaction support without ever
        // committing a transaction, even one containing no writes.
        throw new Error('__preflight_transaction_probe_abort__');
      });
    } catch (error) {
      abortError = error;
    }

    if (supported) return { supported: true };

    const message = abortError instanceof Error ? abortError.message : 'Unknown transaction error.';
    return { supported: false, error: message };
  } finally {
    await session.endSession();
  }
}

// ---------------------------------------------------------------------------
// Preflight report assembly
// ---------------------------------------------------------------------------

export type PreflightReport = {
  generatedAt: string;
  mode: 'READ-ONLY PREFLIGHT';
  databaseName: string;
  approvedMappingVersion: string;
  inputCounts: { approved: number; reject: number; hold: number };
  liveCountsBefore: { emotionCount: number; mappingCount: number };
  liveCountsAfter: { emotionCount: number; mappingCount: number };
  emotionAudit: EmotionAuditResult;
  mappingAudit: MappingAuditResult;
  writePlan: WritePlan;
  indexVerification: { emotionUniqueKeyIndexPresent: boolean; mappingUniquePairIndexPresent: boolean };
  transactionSupport: TransactionSupportResult;
  candidateValidationPassed: boolean;
  overallDecision: 'PASS' | 'BLOCKED';
  blockingReasons: string[];
};

export function buildPreflightReport(params: {
  databaseName: string;
  candidates: ActivationCandidate[];
  candidateValidationPassed: boolean;
  candidateValidationBlockingReasons: string[];
  inputCounts: { approved: number; reject: number; hold: number };
  liveCountsBefore: { emotionCount: number; mappingCount: number };
  liveCountsAfter: { emotionCount: number; mappingCount: number };
  emotionAudit: EmotionAuditResult;
  mappingAudit: MappingAuditResult;
  writePlan: WritePlan;
  indexVerification: IndexVerification;
  transactionSupport: TransactionSupportResult;
}): PreflightReport {
  const blockingReasons: string[] = [...params.candidateValidationBlockingReasons, ...params.writePlan.blockingReasons];

  if (!params.indexVerification.emotionUniqueKeyIndexPresent) {
    blockingReasons.push('Required unique index on Emotion.key is not present live.');
  }
  if (!params.indexVerification.mappingUniquePairIndexPresent) {
    blockingReasons.push('Required unique index on EmotionVerseMapping.(verseReferenceKey, emotionKey) is not present live.');
  }
  if (!params.transactionSupport.supported) {
    blockingReasons.push(`Live database does not support transactions: ${params.transactionSupport.error ?? 'unknown reason'}.`);
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'READ-ONLY PREFLIGHT',
    databaseName: params.databaseName,
    approvedMappingVersion: APPROVED_MAPPING_VERSION,
    inputCounts: params.inputCounts,
    liveCountsBefore: params.liveCountsBefore,
    liveCountsAfter: params.liveCountsAfter,
    emotionAudit: params.emotionAudit,
    mappingAudit: params.mappingAudit,
    writePlan: params.writePlan,
    indexVerification: {
      emotionUniqueKeyIndexPresent: params.indexVerification.emotionUniqueKeyIndexPresent,
      mappingUniquePairIndexPresent: params.indexVerification.mappingUniquePairIndexPresent,
    },
    transactionSupport: params.transactionSupport,
    candidateValidationPassed: params.candidateValidationPassed,
    overallDecision: blockingReasons.length === 0 ? 'PASS' : 'BLOCKED',
    blockingReasons,
  };
}

function toPreflightMarkdown(report: PreflightReport): string {
  const lines: string[] = [];
  lines.push('# Approved Emotion Mapping Activation — Preflight');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Mode: ${report.mode} — no database writes`);
  lines.push(`- Database: ${report.databaseName}`);
  lines.push(`- Approved mapping version: \`${report.approvedMappingVersion}\``);
  lines.push('');
  lines.push('## Input counts');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('| --- | --- |');
  lines.push(`| APPROVED | ${report.inputCounts.approved} |`);
  lines.push(`| REJECT | ${report.inputCounts.reject} |`);
  lines.push(`| HOLD | ${report.inputCounts.hold} |`);
  lines.push('');
  lines.push('## Live database (unchanged by this preflight)');
  lines.push('');
  lines.push(`- Emotion before: ${report.liveCountsBefore.emotionCount}, after: ${report.liveCountsAfter.emotionCount}`);
  lines.push(`- EmotionVerseMapping before: ${report.liveCountsBefore.mappingCount}, after: ${report.liveCountsAfter.mappingCount}`);
  lines.push('');
  lines.push('## Emotion definitions');
  lines.push('');
  lines.push(`- Existing (approved-key) definitions: ${report.emotionAudit.existingApprovedEmotionDefinitions.length}`);
  lines.push(`- Missing (to be created): ${report.emotionAudit.missingApprovedEmotionDefinitions.length}`);
  lines.push(`- Existing inactive (to be activated): ${report.emotionAudit.existingInactiveApprovedEmotions.length}`);
  lines.push(`- Existing active: ${report.emotionAudit.existingActiveApprovedEmotions.length}`);
  lines.push(`- Unexpected (non-canonical) live definitions: ${report.emotionAudit.unexpectedEmotionDefinitions.length}`);
  lines.push(`- Conflicting definitions (icon/order): ${report.emotionAudit.conflictingEmotionDefinitions.length}`);
  lines.push('');
  lines.push('## Emotion localization (names/descriptions vs. the canonical catalog)');
  lines.push('');
  lines.push(`- Live emotions with localization already matching the catalog (no-op): ${report.emotionAudit.emotionsWithLocalizationNoOp.length}`);
  lines.push(`- Live emotions missing localization (to be updated): ${report.emotionAudit.emotionsNeedingLocalizationUpdate.length}`);
  lines.push(`- Live emotions with conflicting localization (BLOCKS): ${report.emotionAudit.emotionsWithLocalizationConflict.length}`);
  lines.push(`- Future creates (all include full en/ar/ar-EG names + descriptions from the catalog): ${report.writePlan.emotionsToCreate.length}`);
  if (report.emotionAudit.localizationConflictDetails.length > 0) {
    lines.push('');
    lines.push('Localization conflict detail:');
    report.emotionAudit.localizationConflictDetails.forEach((conflict) => {
      lines.push(`- ${conflict.key}.${conflict.field}.${conflict.locale}: live "${conflict.live}" vs. canonical "${conflict.canonical}"`);
    });
  }
  lines.push('');
  lines.push('## Mapping overlap');
  lines.push('');
  lines.push(`- Approved candidate pairs: ${report.mappingAudit.candidatePairs}`);
  lines.push(`- Already existing live: ${report.mappingAudit.candidatePairsAlreadyExisting.length}`);
  lines.push(`  - already approved (no-op): ${report.mappingAudit.candidatePairsAlreadyApproved.length}`);
  lines.push(`  - development (to promote): ${report.mappingAudit.candidatePairsWithDevelopmentStatus.length}`);
  lines.push(`  - draft (to promote): ${report.mappingAudit.candidatePairsWithDraftStatus.length}`);
  lines.push(`  - reviewed (to promote): ${report.mappingAudit.candidatePairsWithReviewedStatus.length}`);
  lines.push(`  - rejected (BLOCKS): ${report.mappingAudit.candidatePairsWithRejectedStatus.length}`);
  lines.push(`  - unexpected status (BLOCKS): ${report.mappingAudit.candidatePairsWithUnexpectedStatus.length}`);
  lines.push(`- Missing live (to insert): ${report.mappingAudit.candidatePairsMissing.length}`);
  lines.push(`- Live pairs outside approved set (legacy, untouched): ${report.mappingAudit.livePairsOutsideApprovedSet.length}`);
  lines.push(`- Live REJECT intersection: ${report.mappingAudit.liveRejectIntersection.length}`);
  lines.push(`- Live HOLD intersection: ${report.mappingAudit.liveHoldIntersection.length}`);
  lines.push(`- Duplicate logical pairs: ${report.mappingAudit.duplicateLogicalPairs.length}`);
  lines.push('');
  lines.push('## Write plan');
  lines.push('');
  lines.push(`- Emotions to create: ${report.writePlan.emotionsToCreate.length}`);
  lines.push(`- Emotions to activate: ${report.writePlan.emotionsToActivate.length}`);
  lines.push(`- Emotions to localize: ${report.writePlan.emotionsToLocalize.length}`);
  lines.push(`- Emotions with localization already correct (no-op): ${report.writePlan.emotionsLocalizationNoOp.length}`);
  lines.push(`- Mappings to insert: ${report.writePlan.mappingsToInsert.length}`);
  lines.push(`- Mappings to promote: ${report.writePlan.mappingsToPromote.length}`);
  lines.push(`- Mappings already approved: ${report.writePlan.mappingsAlreadyApproved.length}`);
  lines.push(
    `- Reconciliation: ${report.writePlan.reconciliation.insert} insert + ${report.writePlan.reconciliation.promote} promote + ${report.writePlan.reconciliation.alreadyApproved} already-approved = ${report.writePlan.reconciliation.total} (expected ${report.writePlan.reconciliation.expectedApprovedCandidates}) — ${report.writePlan.reconciliation.matches ? 'MATCHES' : 'MISMATCH'}`,
  );
  lines.push(`- Predicted final active emotions: ${report.writePlan.predictedFinalActiveEmotions}`);
  lines.push('');
  lines.push('## Index / transaction safety');
  lines.push('');
  lines.push(`- Emotion.key unique index present: ${report.indexVerification.emotionUniqueKeyIndexPresent}`);
  lines.push(
    `- EmotionVerseMapping.(verseReferenceKey, emotionKey) unique index present: ${report.indexVerification.mappingUniquePairIndexPresent}`,
  );
  lines.push(`- Transaction support verified: ${report.transactionSupport.supported}`);
  lines.push('');
  lines.push('## Backup plan');
  lines.push('');
  lines.push(
    `- Before any future apply, a verified point-in-time backup of every live Emotion and EmotionVerseMapping document is written under \`${EMOTION_MAPPING_ACTIVATION_BACKUPS_DIR}\` (git-ignored) — see writeActivationBackup / rollbackEmotionMappingActivation.ts.`,
  );
  lines.push('');
  lines.push(`**Overall decision: ${report.overallDecision}**`);
  if (report.blockingReasons.length > 0) {
    lines.push('');
    lines.push('Blocking reasons:');
    report.blockingReasons.forEach((reason) => lines.push(`- ${reason}`));
  }
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Backup (write path implemented; not invoked for real by this task)
// ---------------------------------------------------------------------------

export type ActivationBackupPayload = {
  generatedAt: string;
  databaseName: string;
  emotions: LiveEmotionDoc[];
  mappings: LiveMappingDoc[];
  activationFootprint: {
    emotionsToBeCreated: string[];
    emotionsToBeActivated: string[];
    /** Existing emotions whose names/descriptions this activation will $set from the catalog. Restoring the full pre-activation snapshot (below) already reverts this — recorded here for footprint/reporting completeness, per the localization rollback requirement. */
    emotionsToBeLocalized: string[];
    mappingsToBeInserted: string[];
    mappingsToBePromoted: string[];
  };
};

/**
 * Writes a verified, point-in-time backup of every live Emotion/
 * EmotionVerseMapping document, wrapped in the standard ObjectId-round-trip
 * envelope (same format as prepareArabicCleanup.ts/prepareTranslationCleanup.ts).
 * Only the two collections this activation can touch are backed up — never
 * Verse/VerseTranslation/Ayah. Throws (via writeVerifiedJsonBackup) if the
 * write, read-back, parse, or shape/round-trip verification fails.
 */
export function writeActivationBackup(
  destinationPath: string,
  emotions: LiveEmotionDoc[],
  mappings: LiveMappingDoc[],
  databaseName: string,
  activationFootprint: ActivationBackupPayload['activationFootprint'],
): { path: string; sha256: string; byteLength: number } {
  const payload: ActivationBackupPayload = {
    generatedAt: new Date().toISOString(),
    databaseName,
    emotions,
    mappings,
    activationFootprint,
  };

  return writeVerifiedJsonBackup(destinationPath, wrapBackupEnvelope(payload), (parsed) => {
    let candidate: { records?: Partial<ActivationBackupPayload> };
    try {
      candidate = parsed as { records?: Partial<ActivationBackupPayload> };
    } catch {
      return false;
    }
    const records = candidate.records;
    if (!records || !Array.isArray(records.emotions) || !Array.isArray(records.mappings)) return false;
    if (records.databaseName !== databaseName) return false;
    if (records.emotions.length !== emotions.length || records.mappings.length !== mappings.length) return false;
    return (
      recordsRoundTripObjectIds(emotions, records.emotions) && recordsRoundTripObjectIds(mappings, records.mappings)
    );
  });
}

// ---------------------------------------------------------------------------
// Apply (implemented; never invoked by this task — requires --apply + confirmations)
// ---------------------------------------------------------------------------

export type ApplyResult = {
  emotionsCreated: string[];
  emotionsActivated: string[];
  emotionsLocalized: string[];
  mappingsInserted: string[];
  mappingsPromoted: string[];
  backupPath: string;
  backupSha256: string;
};

/**
 * Runs the single atomic activation transaction. Only called from `main()`
 * after every preflight/confirmation gate has passed. Inside one
 * `session.withTransaction`, it: (1) creates missing approved emotion
 * definitions with their full localized names/descriptions, (2) activates
 * existing-but-inactive approved emotions, (3) $sets names/descriptions on
 * existing emotions that need localization — legacy flat fields
 * (name/arabicName/description) are never touched or removed, (4) inserts
 * approved candidate mappings that do not exist, (5) promotes existing
 * candidate mappings that safely qualify (development/draft/reviewed ->
 * approved), preserving every other field. Never touches a "rejected"
 * candidate or any legacy mapping outside the approved set.
 */
export async function runActivationApply(params: {
  candidates: ActivationCandidate[];
  emotionAudit: EmotionAuditResult;
  writePlan: WritePlan;
}): Promise<ApplyResult> {
  if (params.writePlan.blocked) {
    throw new Error(`Refusing to apply: write plan is blocked (${params.writePlan.blockingReasons.join('; ')}).`);
  }

  const candidateByKey = new Map(params.candidates.map((candidate) => [candidatePairKey(candidate), candidate]));

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (params.writePlan.emotionsToCreate.length > 0) {
        // insertMany (one bulk write) instead of one create() per document:
        // with hundreds of approved candidates this keeps the transaction's
        // total round-trip count low enough to finish inside MongoDB's
        // default 60s transaction lifetime limit. Validation still runs
        // per-document, in order, before the bulk write is sent.
        const docs = params.writePlan.emotionsToCreate.map((key) => {
          const canonical = EMOTION_CATALOG_BY_KEY.get(key)!;
          return {
            key: canonical.key,
            names: canonical.names,
            descriptions: canonical.descriptions,
            icon: canonical.icon,
            order: canonical.order,
            active: true,
          };
        });
        await EmotionModel.insertMany(docs, { session, ordered: true });
      }

      for (const key of params.writePlan.emotionsToActivate) {
        await EmotionModel.updateOne({ key }, { $set: { active: true } }, { session, runValidators: true });
      }

      for (const key of params.writePlan.emotionsToLocalize) {
        const canonical = EMOTION_CATALOG_BY_KEY.get(key)!;
        await EmotionModel.updateOne(
          { key },
          { $set: { names: canonical.names, descriptions: canonical.descriptions } },
          { session, runValidators: true },
        );
      }

      if (params.writePlan.mappingsToInsert.length > 0) {
        // Same insertMany batching as emotionsToCreate above, and for the
        // same reason: up to ~1,800 individual create() calls (each its own
        // network round trip, on top of the emotionKey existence-check
        // validator) cannot reliably finish inside one transaction's time
        // budget. The emotionKey validator caches confirmed keys per
        // session (see EmotionVerseMapping.ts), so this stays a handful of
        // round trips total rather than two per document.
        const docs = params.writePlan.mappingsToInsert.map((pairKeyValue) => {
          const candidate = candidateByKey.get(pairKeyValue)!;
          return {
            verseReferenceKey: candidate.verseKey,
            emotionKey: candidate.emotionKey,
            status: 'approved' as const,
            mappingVersion: APPROVED_MAPPING_VERSION,
            contextNotes: candidate.contextNotes,
            tafsirReferences: [],
          };
        });
        await EmotionVerseMappingModel.insertMany(docs, { session, ordered: true });
      }

      for (const pairKeyValue of params.writePlan.mappingsToPromote) {
        const [verseReferenceKey, emotionKey] = pairKeyValue.split('|');
        await EmotionVerseMappingModel.updateOne(
          { verseReferenceKey, emotionKey },
          { $set: { status: 'approved', mappingVersion: APPROVED_MAPPING_VERSION } },
          { session, runValidators: true },
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return {
    emotionsCreated: params.writePlan.emotionsToCreate,
    emotionsActivated: params.writePlan.emotionsToActivate,
    emotionsLocalized: params.writePlan.emotionsToLocalize,
    mappingsInserted: params.writePlan.mappingsToInsert,
    mappingsPromoted: params.writePlan.mappingsToPromote,
    backupPath: '',
    backupSha256: '',
  };
}

// ---------------------------------------------------------------------------
// Post-write verification (implemented; never invoked live by this task)
// ---------------------------------------------------------------------------

export type PostWriteVerificationResult = {
  passed: boolean;
  failures: string[];
  activeEmotionCount: number;
  approvedMappingCount: number;
};

/** Re-reads live state after a (hypothetical) commit and re-proves every Step 16 property. Never writes. */
export async function runPostWriteVerification(candidates: ActivationCandidate[]): Promise<PostWriteVerificationResult> {
  const failures: string[] = [];
  // The historical outcome remains 29 / 1,845 even after newer emotions are
  // activated independently. Verify only the same scope this migration owns.
  const historicalEmotionFilter = { $in: [...HISTORICAL_APPROVED_EMOTION_KEYS] };

  const [activeEmotionCount, approvedMappings] = await Promise.all([
    EmotionModel.countDocuments({ active: true, key: historicalEmotionFilter }),
    EmotionVerseMappingModel.find({ status: 'approved', emotionKey: historicalEmotionFilter }).lean<LiveMappingDoc[]>(),
  ]);

  if (activeEmotionCount !== 29) failures.push(`Active emotion count is ${activeEmotionCount}, expected 29.`);

  const approvedKeySet = new Set(approvedMappings.map(livePairKey));
  const candidateKeys = candidates.map(candidatePairKey);
  const missingApproved = candidateKeys.filter((key) => !approvedKeySet.has(key));
  if (missingApproved.length > 0) {
    failures.push(`${missingApproved.length} approved candidate(s) are missing an approved live document.`);
  }

  const duplicates = candidateKeys.length !== new Set(candidateKeys).size;
  if (duplicates) failures.push('Duplicate logical pairs detected among approved candidates.');

  const { rejectPairs, holdPairs } = loadReviewDecisions();
  const rejectIntersection = candidateKeys.filter((key) => rejectPairs.has(key));
  const holdIntersection = candidateKeys.filter((key) => holdPairs.has(key));
  if (rejectIntersection.length > 0) failures.push(`${rejectIntersection.length} approved pair(s) intersect REJECT.`);
  if (holdIntersection.length > 0) failures.push(`${holdIntersection.length} approved pair(s) intersect HOLD.`);

  const emotionsWithApproved = new Set(approvedMappings.map((m) => m.emotionKey));
  const activeEmotions = await EmotionModel.find({ active: true, key: historicalEmotionFilter }).lean<LiveEmotionDoc[]>();
  const emotionsWithoutApproved = activeEmotions.filter((e) => !emotionsWithApproved.has(e.key));
  if (emotionsWithoutApproved.length > 0) {
    failures.push(`${emotionsWithoutApproved.length} active emotion(s) have zero approved mappings.`);
  }

  return {
    passed: failures.length === 0,
    failures,
    activeEmotionCount,
    approvedMappingCount: approvedMappings.length,
  };
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

async function runPreflight(reportPath: string) {
  const preview = loadApprovedMappingsPreview();
  const candidates = buildActivationCandidates(preview);
  const candidateValidation = validateActivationSet(candidates);
  const { rejectPairs, holdPairs } = loadReviewDecisions();

  const databaseName = await connectReadOnly();
  try {
    const before = await readLivePreflightData();
    const knownEmotionKeys = new Set(before.emotions.map((e) => e.key));
    const emotionAudit = auditEmotionDefinitions(before.emotions);
    const mappingAudit = auditMappings(before.mappings, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    const writePlan = buildWritePlan(emotionAudit, mappingAudit);
    const indexVerification = await verifyLiveIndexes();
    const transactionSupport = await verifyTransactionSupport();

    // Independent proof, not assumption, that the preflight itself never mutated the database.
    const after = await readLivePreflightData();

    const report = buildPreflightReport({
      databaseName,
      candidates,
      candidateValidationPassed: candidateValidation.passed,
      candidateValidationBlockingReasons: candidateValidation.passed
        ? []
        : ['Base activation candidate validation (see mapping:activation-dry-run) did not pass.'],
      inputCounts: { approved: candidates.length, reject: rejectPairs.size, hold: holdPairs.size },
      liveCountsBefore: { emotionCount: before.emotions.length, mappingCount: before.mappings.length },
      liveCountsAfter: { emotionCount: after.emotions.length, mappingCount: after.mappings.length },
      emotionAudit,
      mappingAudit,
      writePlan,
      indexVerification,
      transactionSupport,
    });

    const absoluteReport = resolve(process.cwd(), reportPath);
    mkdirSync(dirname(absoluteReport), { recursive: true });
    writeFileSync(absoluteReport, `${JSON.stringify(report, null, 2)}\n`);
    const markdownPath = absoluteReport.replace(/\.json$/, '.md');
    writeFileSync(markdownPath, toPreflightMarkdown(report));

    console.log(
      JSON.stringify(
        {
          reportPath,
          markdownPath,
          databaseName,
          overallDecision: report.overallDecision,
          insert: writePlan.reconciliation.insert,
          promote: writePlan.reconciliation.promote,
          alreadyApproved: writePlan.reconciliation.alreadyApproved,
          emotionCreates: writePlan.emotionsToCreate.length,
          emotionActivations: writePlan.emotionsToActivate.length,
          emotionLocalizationUpdates: writePlan.emotionsToLocalize.length,
          emotionLocalizationNoOps: writePlan.emotionsLocalizationNoOp.length,
          predictedFinalActiveEmotions: writePlan.predictedFinalActiveEmotions,
        },
        null,
        2,
      ),
    );

    return { report, candidates, writePlan, emotionAudit, before, databaseName };
  } finally {
    await mongoose.disconnect();
  }
}

export type ApplyRequestArgs = {
  apply: boolean;
  nodeEnv: string;
  confirmDatabase?: string;
  confirmApprovedCount?: string;
  confirmActivation?: string;
};

export type ApplyRequestValidation = { ok: boolean; reason?: string };

/**
 * Pure: validates the exact confirmation flags a real `--apply` invocation
 * must supply, before anything connects to MongoDB. Used by both `main()`
 * and by tests, so the guard behavior is provable without any I/O.
 */
export function validateApplyRequest(args: ApplyRequestArgs): ApplyRequestValidation {
  if (!args.apply) return { ok: true }; // preflight-only path; nothing to validate here.

  if (args.nodeEnv === 'production') {
    return { ok: false, reason: 'Activation preflight/apply refuses to run when NODE_ENV=production.' };
  }
  if (typeof args.confirmDatabase !== 'string' || !args.confirmDatabase) {
    return { ok: false, reason: '--apply requires --confirm-database=<actual database name>.' };
  }
  if (args.confirmApprovedCount !== '1845') {
    return { ok: false, reason: '--apply requires --confirm-approved-count=1845.' };
  }
  if (args.confirmActivation !== 'approved-emotion-mappings') {
    return { ok: false, reason: '--apply requires --confirm-activation=approved-emotion-mappings.' };
  }

  return { ok: true };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.get('apply') === true;
  const reportPath = typeof args.get('report') === 'string' ? (args.get('report') as string) : DEFAULT_PREFLIGHT_REPORT_PATH;

  const confirmDatabase = args.get('confirm-database');
  const confirmApprovedCount = args.get('confirm-approved-count');
  const confirmActivation = args.get('confirm-activation');

  const applyValidation = validateApplyRequest({
    apply,
    nodeEnv: env.NODE_ENV,
    confirmDatabase: typeof confirmDatabase === 'string' ? confirmDatabase : undefined,
    confirmApprovedCount: typeof confirmApprovedCount === 'string' ? confirmApprovedCount : undefined,
    confirmActivation: typeof confirmActivation === 'string' ? confirmActivation : undefined,
  });

  if (!applyValidation.ok) {
    throw new Error(applyValidation.reason);
  }

  if (!apply) {
    await runPreflight(reportPath);
    return;
  }

  const { report, candidates, writePlan, emotionAudit, before, databaseName } = await runPreflight(reportPath);

  if (confirmDatabase !== databaseName) {
    throw new Error(`--confirm-database="${confirmDatabase as string}" does not match the actual connected database "${databaseName}".`);
  }
  if (report.overallDecision !== 'PASS') {
    throw new Error(`Refusing to apply: preflight decision is ${report.overallDecision} (${report.blockingReasons.join('; ')}).`);
  }

  const databaseName2 = await connectReadOnly();
  try {
    const backupPath = resolve(
      EMOTION_MAPPING_ACTIVATION_BACKUPS_DIR,
      `emotion-mappings-before-activation-${Date.now()}.json`,
    );
    const backup = writeActivationBackup(backupPath, before.emotions, before.mappings, databaseName2, {
      emotionsToBeCreated: writePlan.emotionsToCreate,
      emotionsToBeActivated: writePlan.emotionsToActivate,
      emotionsToBeLocalized: writePlan.emotionsToLocalize,
      mappingsToBeInserted: writePlan.mappingsToInsert,
      mappingsToBePromoted: writePlan.mappingsToPromote,
    });
    console.log(`Backup verified: ${backup.path} (sha256 ${backup.sha256}, ${backup.byteLength} bytes).`);

    const applyResult = await runActivationApply({ candidates, emotionAudit, writePlan });
    console.log(JSON.stringify({ ...applyResult, backupPath: backup.path, backupSha256: backup.sha256 }, null, 2));

    const verification = await runPostWriteVerification(candidates);
    console.log(JSON.stringify(verification, null, 2));

    if (!verification.passed) {
      console.error('Post-write verification failed. Do not treat activation as successful — investigate or roll back.');
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown activation error.';
    console.error(`Approved emotion mapping activation failed: ${message}`);
    process.exitCode = 1;
  });
}
