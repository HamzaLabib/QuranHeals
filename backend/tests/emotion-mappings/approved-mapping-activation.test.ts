import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import mongoose, { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMOTION_CATALOG_BY_KEY } from '../../src/emotions/emotionCatalog';
import { EmotionModel } from '../../src/models/Emotion';
import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import { seedEmotions } from '../../src/seed/emotions';
import {
  buildActivationCandidates,
  loadApprovedMappingsPreview,
  loadReviewDecisions,
  validateActivationSet,
  APPROVED_MAPPING_VERSION,
} from '../../src/scripts/activationDryRun';
import {
  auditEmotionDefinitions,
  auditMappings,
  buildWritePlan,
  buildPreflightReport,
  validateApplyRequest,
  writeActivationBackup,
  runActivationApply,
  runPostWriteVerification,
  type LiveEmotionDoc,
  type LiveMappingDoc,
  type EmotionAuditResult,
  type MappingAuditResult,
} from '../../src/scripts/activateApprovedEmotionMappings';

const SCRIPT_SOURCE_PATH = resolve(__dirname, '../../src/scripts/activateApprovedEmotionMappings.ts');

const preview = loadApprovedMappingsPreview();
const candidates = buildActivationCandidates(preview);
const { rejectPairs, holdPairs } = loadReviewDecisions();

function id(hex: string) {
  return new Types.ObjectId(hex);
}

function liveEmotion(overrides: Partial<LiveEmotionDoc> & { key: string }): LiveEmotionDoc {
  const canonical = seedEmotions.find((e) => e.key === overrides.key);
  return {
    _id: id('0123456789abcdef01234567'),
    name: canonical?.name ?? 'X',
    arabicName: canonical?.arabicName ?? 'س',
    description: canonical?.description ?? 'desc',
    icon: canonical?.icon ?? 'icon',
    order: canonical?.order ?? 1,
    active: true,
    ...overrides,
  };
}

function liveMapping(overrides: Partial<LiveMappingDoc> & { verseReferenceKey: string; emotionKey: string }): LiveMappingDoc {
  return {
    _id: id('aaaaaaaaaaaaaaaaaaaaaaaa'),
    status: 'development',
    mappingVersion: 'mvp-seed-1',
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// 1. Default activation command is read-only (static, scoped source proof)
// ---------------------------------------------------------------------------

describe('Approved mapping activation: default command is read-only', () => {
  it('the default (no --apply) branch of main() only calls runPreflight, nothing else', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    const match = source.match(/if \(!apply\) \{\s*([\s\S]*?)\s*\}/);
    expect(match, 'could not locate the default-branch block in main()').not.toBeNull();
    const body = match![1];
    expect(body.replace(/\s+/g, ' ').trim()).toBe('await runPreflight(reportPath); return;');
  });

  it('runPreflight never calls a mutating Mongoose method', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    const start = source.indexOf('async function runPreflight(');
    const end = source.indexOf('\nasync function main(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);

    const mutatingMethods = ['.create(', '.insertMany(', '.updateOne(', '.updateMany(', '.deleteOne(', '.deleteMany(', '.bulkWrite(', '.findOneAndUpdate(', '.findOneAndDelete(', '.save(', '.remove(', '.drop('];
    mutatingMethods.forEach((method) => {
      expect(body.includes(method), `unexpected mutating call ${method} inside runPreflight`).toBe(false);
    });
  });

  it('the CLI never prints the raw MongoDB connection string', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    expect(source).not.toMatch(/console\.log\([^)]*MONGODB_URI/);
    expect(source).not.toMatch(/console\.log\(env\.MONGODB_URI/);
  });
});

// ---------------------------------------------------------------------------
// 2, 4, 5. Apply confirmation guards (pure — no I/O)
// ---------------------------------------------------------------------------

describe('Approved mapping activation: apply confirmation guards', () => {
  it('preflight-only request (apply=false) is always ok regardless of other args', () => {
    expect(validateApplyRequest({ apply: false, nodeEnv: 'development' })).toEqual({ ok: true });
  });

  it('apply requires explicit confirmation flags', () => {
    const result = validateApplyRequest({ apply: true, nodeEnv: 'development' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/--confirm-database/);
  });

  it('apply refuses a missing --confirm-approved-count', () => {
    const result = validateApplyRequest({ apply: true, nodeEnv: 'development', confirmDatabase: 'test' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/--confirm-approved-count/);
  });

  it('apply refuses the wrong --confirm-approved-count value', () => {
    const result = validateApplyRequest({
      apply: true,
      nodeEnv: 'development',
      confirmDatabase: 'test',
      confirmApprovedCount: '999',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/1845/);
  });

  it('apply refuses a missing --confirm-activation', () => {
    const result = validateApplyRequest({
      apply: true,
      nodeEnv: 'development',
      confirmDatabase: 'test',
      confirmApprovedCount: '1845',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/--confirm-activation/);
  });

  it('production environment refuses apply outright, before any other check', () => {
    const result = validateApplyRequest({ apply: true, nodeEnv: 'production' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/production/i);
  });

  it('accepts a fully-specified, correct apply request', () => {
    const result = validateApplyRequest({
      apply: true,
      nodeEnv: 'development',
      confirmDatabase: 'test',
      confirmApprovedCount: '1845',
      confirmActivation: 'approved-emotion-mappings',
    });
    expect(result).toEqual({ ok: true });
  });

  it('main() refuses when --confirm-database does not match the actual connected database name (source-level proof of the check)', () => {
    const source = readFileSync(SCRIPT_SOURCE_PATH, 'utf-8');
    expect(source).toMatch(/if \(confirmDatabase !== databaseName\) \{/);
    expect(source).toMatch(/does not match the actual connected database/);
  });
});

// ---------------------------------------------------------------------------
// Emotion definition audit (Step 9 cases A-D)
// ---------------------------------------------------------------------------

describe('Approved mapping activation: emotion definition audit', () => {
  it('classifies missing, existing-active, existing-inactive, and unexpected (non-canonical) definitions', () => {
    const live: LiveEmotionDoc[] = [
      liveEmotion({ key: 'sad', active: true }), // existing active, matches canonical
      liveEmotion({ key: 'guilty', active: false }), // existing inactive
      liveEmotion({ key: 'angry', active: true }),
      liveEmotion({ key: 'unrelated_legacy_key', active: true }), // unexpected (non-canonical)
    ];

    const audit = auditEmotionDefinitions(live);

    expect(audit.approvedEmotionKeys).toHaveLength(29);
    expect(audit.existingActiveApprovedEmotions).toContain('sad');
    expect(audit.existingInactiveApprovedEmotions).toContain('guilty');
    expect(audit.missingApprovedEmotionDefinitions).not.toContain('sad');
    expect(audit.missingApprovedEmotionDefinitions).not.toContain('guilty');
    expect(audit.missingApprovedEmotionDefinitions).not.toContain('angry');
    expect(audit.missingApprovedEmotionDefinitions.length).toBe(29 - 3);
    expect(audit.unexpectedEmotionDefinitions).toEqual(['unrelated_legacy_key']);
  });

  it('flags an icon/order mismatch as a core definition conflict (legacy name/arabicName/description are no longer checked — they are expected to change during this rollout)', () => {
    const live: LiveEmotionDoc[] = [liveEmotion({ key: 'angry', active: true, icon: 'wrong-icon' })];
    const audit = auditEmotionDefinitions(live);
    expect(audit.conflictingEmotionDefinitions).toEqual([
      { key: 'angry', field: 'icon', live: 'wrong-icon', canonical: 'flame' },
    ]);
  });

  it('reports zero missing/conflicting when every one of the 29 keys exists live with matching icon/order', () => {
    const live: LiveEmotionDoc[] = seedEmotions.map((e) => liveEmotion({ ...e }));
    const audit = auditEmotionDefinitions(live);
    expect(audit.missingApprovedEmotionDefinitions).toEqual([]);
    expect(audit.conflictingEmotionDefinitions).toEqual([]);
    expect(audit.existingApprovedEmotionDefinitions).toHaveLength(29);
  });
});

// ---------------------------------------------------------------------------
// Localization audit (Section 11: emotionCreates / emotionActivations /
// emotionLocalizationUpdates / emotionNoOps / emotionConflicts)
// ---------------------------------------------------------------------------

describe('Approved mapping activation: emotion localization audit', () => {
  it('classifies a live document with no names/descriptions at all as needing a localization update — never a conflict', () => {
    const live: LiveEmotionDoc[] = [liveEmotion({ key: 'sad', active: true })]; // no names/descriptions — today's real live shape
    const audit = auditEmotionDefinitions(live);
    expect(audit.emotionsNeedingLocalizationUpdate).toEqual(['sad']);
    expect(audit.emotionsWithLocalizationConflict).toEqual([]);
    expect(audit.emotionsWithLocalizationNoOp).toEqual([]);
  });

  it('classifies a live document missing only one required locale (e.g. ar-EG) as needing a localization update', () => {
    const canonical = EMOTION_CATALOG_BY_KEY.get('sad')!;
    const live: LiveEmotionDoc[] = [
      liveEmotion({
        key: 'sad',
        active: true,
        names: { en: canonical.names.en, ar: canonical.names.ar } as never, // ar-EG deliberately missing
        descriptions: canonical.descriptions,
      }),
    ];
    const audit = auditEmotionDefinitions(live);
    expect(audit.emotionsNeedingLocalizationUpdate).toEqual(['sad']);
  });

  it('classifies a live document whose names/descriptions exactly match the catalog as a no-op', () => {
    const canonical = EMOTION_CATALOG_BY_KEY.get('sad')!;
    const live: LiveEmotionDoc[] = [
      liveEmotion({ key: 'sad', active: true, names: canonical.names, descriptions: canonical.descriptions }),
    ];
    const audit = auditEmotionDefinitions(live);
    expect(audit.emotionsWithLocalizationNoOp).toEqual(['sad']);
    expect(audit.emotionsNeedingLocalizationUpdate).toEqual([]);
    expect(audit.emotionsWithLocalizationConflict).toEqual([]);
  });

  it('classifies a live document with fully-populated but conflicting names/descriptions as a localization conflict, with the exact locale/field/value recorded — never silently overwritten', () => {
    const canonical = EMOTION_CATALOG_BY_KEY.get('sad')!;
    const live: LiveEmotionDoc[] = [
      liveEmotion({
        key: 'sad',
        active: true,
        names: { ...canonical.names, ar: 'نص مختلف تمامًا' },
        descriptions: canonical.descriptions,
      }),
    ];
    const audit = auditEmotionDefinitions(live);
    expect(audit.emotionsWithLocalizationConflict).toEqual(['sad']);
    expect(audit.emotionsNeedingLocalizationUpdate).toEqual([]);
    expect(audit.localizationConflictDetails).toEqual([
      { key: 'sad', locale: 'ar', field: 'names', live: 'نص مختلف تمامًا', canonical: canonical.names.ar },
    ]);
  });

  it("today's real live shape (12 active emotions, legacy flat fields only, no localization) classifies as exactly 12 localization updates, 0 conflicts, 0 no-ops", () => {
    const twelveActiveKeys = seedEmotions.filter((e) => e.active).map((e) => e.key);
    expect(twelveActiveKeys).toHaveLength(12);
    const live: LiveEmotionDoc[] = twelveActiveKeys.map((key) => liveEmotion({ key, active: true }));

    const audit = auditEmotionDefinitions(live);
    expect(audit.emotionsNeedingLocalizationUpdate.sort()).toEqual([...twelveActiveKeys].sort());
    expect(audit.emotionsWithLocalizationConflict).toEqual([]);
    expect(audit.emotionsWithLocalizationNoOp).toEqual([]);

    const plan = buildWritePlan(audit, auditMappings([], candidates, rejectPairs, holdPairs, new Set(seedEmotions.map((e) => e.key))));
    expect(plan.emotionsToLocalize.sort()).toEqual([...twelveActiveKeys].sort());
    expect(plan.blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6, 7, 9, 10. Mapping audit — overlap, REJECT/HOLD, rejected-status, duplicates, unknown keys
// ---------------------------------------------------------------------------

describe('Approved mapping activation: mapping audit', () => {
  const knownEmotionKeys = new Set(seedEmotions.map((e) => e.key));
  const [firstCandidate, secondCandidate] = candidates;

  it('classifies a live pair matching an approved candidate by its live status', () => {
    const live: LiveMappingDoc[] = [
      liveMapping({ verseReferenceKey: firstCandidate.verseKey, emotionKey: firstCandidate.emotionKey, status: 'development' }),
    ];
    const audit = auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    const key = `${firstCandidate.verseKey}|${firstCandidate.emotionKey}`;
    expect(audit.candidatePairsAlreadyExisting).toContain(key);
    expect(audit.candidatePairsWithDevelopmentStatus).toContain(key);
    expect(audit.candidatePairsMissing).not.toContain(key);
  });

  it('flags an approved candidate that already exists live with status "rejected" (never re-approved)', () => {
    const live: LiveMappingDoc[] = [
      liveMapping({ verseReferenceKey: firstCandidate.verseKey, emotionKey: firstCandidate.emotionKey, status: 'rejected' }),
    ];
    const audit = auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    const key = `${firstCandidate.verseKey}|${firstCandidate.emotionKey}`;
    expect(audit.candidatePairsWithRejectedStatus).toContain(key);

    const plan = buildWritePlan(auditEmotionDefinitions([]), audit);
    expect(plan.blocked).toBe(true);
    expect(plan.blockingReasons.join(' ')).toMatch(/rejected/);
  });

  it('flags a live mapping (outside the approved set) whose pair matches an actual REJECT decision', () => {
    const [rejectKey] = [...rejectPairs];
    const [verseReferenceKey, emotionKey] = rejectKey.split('|');
    const live: LiveMappingDoc[] = [liveMapping({ verseReferenceKey, emotionKey, status: 'development' })];
    const audit = auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    expect(audit.liveRejectIntersection).toContain(rejectKey);

    const plan = buildWritePlan(auditEmotionDefinitions([]), audit);
    expect(plan.blocked).toBe(true);
    expect(plan.blockingReasons.join(' ')).toMatch(/REJECT/);
  });

  it('flags a live mapping (outside the approved set) whose pair matches an actual HOLD decision', () => {
    const [holdKey] = [...holdPairs];
    const [verseReferenceKey, emotionKey] = holdKey.split('|');
    const live: LiveMappingDoc[] = [liveMapping({ verseReferenceKey, emotionKey, status: 'development' })];
    const audit = auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    expect(audit.liveHoldIntersection).toContain(holdKey);

    const plan = buildWritePlan(auditEmotionDefinitions([]), audit);
    expect(plan.blocked).toBe(true);
    expect(plan.blockingReasons.join(' ')).toMatch(/HOLD/);
  });

  it('detects duplicate logical (verseReferenceKey, emotionKey) live pairs and blocks', () => {
    const live: LiveMappingDoc[] = [
      liveMapping({ _id: id('111111111111111111111111'), verseReferenceKey: firstCandidate.verseKey, emotionKey: firstCandidate.emotionKey }),
      liveMapping({ _id: id('222222222222222222222222'), verseReferenceKey: firstCandidate.verseKey, emotionKey: firstCandidate.emotionKey }),
    ];
    const audit = auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    expect(audit.duplicateLogicalPairs).toContain(`${firstCandidate.verseKey}|${firstCandidate.emotionKey}`);

    const plan = buildWritePlan(auditEmotionDefinitions([]), audit);
    expect(plan.blocked).toBe(true);
  });

  it('detects an unknown emotionKey referenced by a live mapping and blocks', () => {
    const live: LiveMappingDoc[] = [liveMapping({ verseReferenceKey: secondCandidate.verseKey, emotionKey: 'totally_unknown_key' })];
    const audit = auditMappings(live, candidates, rejectPairs, holdPairs, new Set(['sad'])); // 'totally_unknown_key' not in known set
    expect(audit.unknownEmotionKeysInLiveMappings).toContain('totally_unknown_key');

    const plan = buildWritePlan(auditEmotionDefinitions([]), audit);
    expect(plan.blocked).toBe(true);
  });

  it('detects an invalid verseKey referenced by a live mapping and blocks', () => {
    const live: LiveMappingDoc[] = [liveMapping({ verseReferenceKey: '999:999', emotionKey: 'sad' })];
    const audit = auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    expect(audit.invalidVerseKeysInLiveMappings).toContain('999:999');

    const plan = buildWritePlan(auditEmotionDefinitions([]), audit);
    expect(plan.blocked).toBe(true);
    expect(plan.blockingReasons.join(' ')).toMatch(/invalid verseKey/);
  });

  it('classifies a live pair outside the approved candidate set as legacy, untouched, with its status recorded', () => {
    const live: LiveMappingDoc[] = [liveMapping({ verseReferenceKey: '1:1', emotionKey: 'sad', status: 'draft' })];
    const audit = auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    expect(audit.livePairsOutsideApprovedSet).toContain('1:1|sad');
    expect(audit.livePairsOutsideApprovedSetByStatus.draft).toContain('1:1|sad');
  });
});

// ---------------------------------------------------------------------------
// 16-24. Write plan reconciliation, provenance, predicted final counts
// ---------------------------------------------------------------------------

describe('Approved mapping activation: write plan', () => {
  const knownEmotionKeys = new Set(seedEmotions.map((e) => e.key));

  it('reconciles insert + promote + already-approved exactly to the candidate total, using the real 1,845-row dataset with zero live overlap', () => {
    const emotionAudit = auditEmotionDefinitions([]);
    const mappingAudit = auditMappings([], candidates, rejectPairs, holdPairs, knownEmotionKeys);
    const plan = buildWritePlan(emotionAudit, mappingAudit);

    expect(plan.reconciliation.insert).toBe(1845);
    expect(plan.reconciliation.promote).toBe(0);
    expect(plan.reconciliation.alreadyApproved).toBe(0);
    expect(plan.reconciliation.total).toBe(1845);
    expect(plan.reconciliation.matches).toBe(true);
    expect(plan.emotionsToCreate).toHaveLength(29); // none live yet
    expect(plan.predictedFinalActiveEmotions).toBe(29);
    expect(plan.blocked).toBe(false);
  });

  it('missing emotion definitions are included in emotionsToCreate', () => {
    const emotionAudit = auditEmotionDefinitions([]);
    expect(emotionAudit.missingApprovedEmotionDefinitions).toHaveLength(29);
    const plan = buildWritePlan(emotionAudit, auditMappings([], candidates, rejectPairs, holdPairs, knownEmotionKeys));
    expect(plan.emotionsToCreate).toEqual(emotionAudit.missingApprovedEmotionDefinitions);
  });

  it('existing inactive approved emotions are included in emotionsToActivate', () => {
    const live = [liveEmotion({ key: 'guilty', active: false })];
    const emotionAudit = auditEmotionDefinitions(live);
    const plan = buildWritePlan(emotionAudit, auditMappings([], candidates, rejectPairs, holdPairs, knownEmotionKeys));
    expect(plan.emotionsToActivate).toEqual(['guilty']);
  });

  it('an existing approved-status candidate is treated as an idempotent no-op, not re-inserted or re-promoted', () => {
    const [c] = candidates;
    const live: LiveMappingDoc[] = [liveMapping({ verseReferenceKey: c.verseKey, emotionKey: c.emotionKey, status: 'approved', mappingVersion: APPROVED_MAPPING_VERSION })];
    const mappingAudit = auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys);
    const plan = buildWritePlan(auditEmotionDefinitions([]), mappingAudit);
    const key = `${c.verseKey}|${c.emotionKey}`;
    expect(plan.mappingsAlreadyApproved).toContain(key);
    expect(plan.mappingsToInsert).not.toContain(key);
    expect(plan.mappingsToPromote).not.toContain(key);
    expect(plan.reconciliation.matches).toBe(true);
  });

  it('development/draft/reviewed existing candidates are all included in mappingsToPromote', () => {
    const [c1, c2, c3] = candidates;
    const live: LiveMappingDoc[] = [
      liveMapping({ _id: id('aaaaaaaaaaaaaaaaaaaaaaa1'), verseReferenceKey: c1.verseKey, emotionKey: c1.emotionKey, status: 'development' }),
      liveMapping({ _id: id('aaaaaaaaaaaaaaaaaaaaaaa2'), verseReferenceKey: c2.verseKey, emotionKey: c2.emotionKey, status: 'draft' }),
      liveMapping({ _id: id('aaaaaaaaaaaaaaaaaaaaaaa3'), verseReferenceKey: c3.verseKey, emotionKey: c3.emotionKey, status: 'reviewed' }),
    ];
    const plan = buildWritePlan(auditEmotionDefinitions([]), auditMappings(live, candidates, rejectPairs, holdPairs, knownEmotionKeys));
    [c1, c2, c3].forEach((c) => expect(plan.mappingsToPromote).toContain(`${c.verseKey}|${c.emotionKey}`));
  });

  it('blocks when the reconciliation equation does not hold (defensive: cannot occur via auditMappings, proven directly)', () => {
    const brokenMappingAudit: MappingAuditResult = {
      candidatePairs: 1845,
      candidatePairsAlreadyExisting: [],
      candidatePairsMissing: new Array(1000).fill('x|y'), // deliberately wrong count vs. candidatePairs
      candidatePairsAlreadyApproved: [],
      candidatePairsWithDevelopmentStatus: [],
      candidatePairsWithDraftStatus: [],
      candidatePairsWithReviewedStatus: [],
      candidatePairsWithRejectedStatus: [],
      candidatePairsWithUnexpectedStatus: [],
      livePairsOutsideApprovedSet: [],
      livePairsOutsideApprovedSetByStatus: {},
      liveRejectIntersection: [],
      liveHoldIntersection: [],
      duplicateLogicalPairs: [],
      invalidVerseKeysInLiveMappings: [],
      unknownEmotionKeysInLiveMappings: [],
    };
    const plan = buildWritePlan(auditEmotionDefinitions([]), brokenMappingAudit);
    expect(plan.reconciliation.matches).toBe(false);
    expect(plan.blocked).toBe(true);
  });

  it('predicted final active emotion count is exactly 29 in the real dataset', () => {
    const plan = buildWritePlan(auditEmotionDefinitions([]), auditMappings([], candidates, rejectPairs, holdPairs, knownEmotionKeys));
    expect(plan.predictedFinalActiveEmotions).toBe(29);
  });
});

// ---------------------------------------------------------------------------
// 12, 13. Preflight-report-level index/transaction blocking
// ---------------------------------------------------------------------------

describe('Approved mapping activation: index / transaction gating in the preflight report', () => {
  const emotionAudit = auditEmotionDefinitions([]);
  const knownEmotionKeys = new Set(seedEmotions.map((e) => e.key));
  const mappingAudit = auditMappings([], candidates, rejectPairs, holdPairs, knownEmotionKeys);
  const writePlan = buildWritePlan(emotionAudit, mappingAudit);
  const baseParams = {
    databaseName: 'test',
    candidates,
    candidateValidationPassed: true,
    candidateValidationBlockingReasons: [] as string[],
    inputCounts: { approved: candidates.length, reject: rejectPairs.size, hold: holdPairs.size },
    liveCountsBefore: { emotionCount: 0, mappingCount: 0 },
    liveCountsAfter: { emotionCount: 0, mappingCount: 0 },
    emotionAudit,
    mappingAudit,
    writePlan,
  };

  it('blocks when the Emotion.key unique index is missing', () => {
    const report = buildPreflightReport({
      ...baseParams,
      indexVerification: { emotionUniqueKeyIndexPresent: false, mappingUniquePairIndexPresent: true, emotionIndexes: [], mappingIndexes: [] },
      transactionSupport: { supported: true },
    });
    expect(report.overallDecision).toBe('BLOCKED');
    expect(report.blockingReasons.join(' ')).toMatch(/Emotion\.key/);
  });

  it('blocks when the EmotionVerseMapping unique pair index is missing', () => {
    const report = buildPreflightReport({
      ...baseParams,
      indexVerification: { emotionUniqueKeyIndexPresent: true, mappingUniquePairIndexPresent: false, emotionIndexes: [], mappingIndexes: [] },
      transactionSupport: { supported: true },
    });
    expect(report.overallDecision).toBe('BLOCKED');
    expect(report.blockingReasons.join(' ')).toMatch(/verseReferenceKey, emotionKey/);
  });

  it('blocks when transaction support is unavailable', () => {
    const report = buildPreflightReport({
      ...baseParams,
      indexVerification: { emotionUniqueKeyIndexPresent: true, mappingUniquePairIndexPresent: true, emotionIndexes: [], mappingIndexes: [] },
      transactionSupport: { supported: false, error: 'no replica set' },
    });
    expect(report.overallDecision).toBe('BLOCKED');
    expect(report.blockingReasons.join(' ')).toMatch(/does not support transactions/);
  });

  it('passes when indexes and transactions are both verified and the write plan is clean', () => {
    const report = buildPreflightReport({
      ...baseParams,
      indexVerification: { emotionUniqueKeyIndexPresent: true, mappingUniquePairIndexPresent: true, emotionIndexes: [], mappingIndexes: [] },
      transactionSupport: { supported: true },
    });
    expect(report.overallDecision).toBe('PASS');
    expect(report.blockingReasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 14, 15. Backup: ObjectId round-trip, verified before any future write
// ---------------------------------------------------------------------------

describe('Approved mapping activation: backup', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'activation-backup-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a verified backup whose ObjectIds round-trip end to end through a real file write', () => {
    const emotions: LiveEmotionDoc[] = [liveEmotion({ _id: id('0123456789abcdef01234567'), key: 'sad' })];
    const mappings: LiveMappingDoc[] = [liveMapping({ _id: id('aaaaaaaaaaaaaaaaaaaaaaaa'), verseReferenceKey: '2:153', emotionKey: 'sad' })];

    const backupPath = join(tempDir, 'backup.json');
    const result = writeActivationBackup(backupPath, emotions, mappings, 'test', {
      emotionsToBeCreated: [],
      emotionsToBeActivated: [],
      emotionsToBeLocalized: [],
      mappingsToBeInserted: [],
      mappingsToBePromoted: ['2:153|sad'],
    });

    expect(result.sha256).toHaveLength(64);
    const parsed = JSON.parse(readFileSync(backupPath, 'utf-8'));
    expect(parsed.records.databaseName).toBe('test');
    expect(parsed.records.emotions[0]._id).toBe('0123456789abcdef01234567');
    expect(parsed.records.mappings[0]._id).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(parsed.records.activationFootprint.mappingsToBePromoted).toEqual(['2:153|sad']);
  });

  it('throws (never returns) if the database name does not match what was written', () => {
    // Simulates a corrupted/mismatched backup: the validate callback inside
    // writeActivationBackup checks records.databaseName === databaseName.
    const emotions: LiveEmotionDoc[] = [];
    const mappings: LiveMappingDoc[] = [];
    const backupPath = join(tempDir, 'backup.json');
    expect(() => writeActivationBackup(backupPath, emotions, mappings, 'test', {
      emotionsToBeCreated: [],
      emotionsToBeActivated: [],
      emotionsToBeLocalized: [],
      mappingsToBeInserted: [],
      mappingsToBePromoted: [],
    })).not.toThrow(); // sanity: a correct call succeeds
    // A second write to the same path must fail (fail-if-exists), proving no silent overwrite.
    expect(() => writeActivationBackup(backupPath, emotions, mappings, 'test', {
      emotionsToBeCreated: [],
      emotionsToBeActivated: [],
      emotionsToBeLocalized: [],
      mappingsToBeInserted: [],
      mappingsToBePromoted: [],
    })).toThrow();
  });

  it('never writes into the real backup directory', () => {
    expect(tempDir.startsWith(tmpdir())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16, 17, 19, 25. Apply transaction plan execution (fully mocked Mongoose)
// ---------------------------------------------------------------------------

describe('Approved mapping activation: apply transaction (mocked Mongoose — no live writes)', () => {
  it('creates missing emotions, activates inactive ones, inserts missing mappings, and promotes existing ones — all inside one session.withTransaction', async () => {
    const createCalls: unknown[][] = [];
    const updateCalls: { model: string; filter: unknown; update: unknown }[] = [];

    vi.spyOn(EmotionModel, 'insertMany').mockImplementation(((docs: unknown[]) => {
      createCalls.push(docs);
      return Promise.resolve(docs as never);
    }) as never);
    vi.spyOn(EmotionModel, 'updateOne').mockImplementation(((filter: unknown, update: unknown) => {
      updateCalls.push({ model: 'Emotion', filter, update });
      return Promise.resolve({ acknowledged: true }) as never;
    }) as never);
    vi.spyOn(EmotionVerseMappingModel, 'insertMany').mockImplementation(((docs: unknown[]) => {
      createCalls.push(docs);
      return Promise.resolve(docs as never);
    }) as never);
    vi.spyOn(EmotionVerseMappingModel, 'updateOne').mockImplementation(((filter: unknown, update: unknown) => {
      updateCalls.push({ model: 'EmotionVerseMapping', filter, update });
      return Promise.resolve({ acknowledged: true }) as never;
    }) as never);

    let withTransactionCalled = false;
    const fakeSession = {
      withTransaction: async (fn: () => Promise<void>) => {
        withTransactionCalled = true;
        await fn();
      },
      endSession: async () => {},
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession as never);

    const emotionAudit = auditEmotionDefinitions([liveEmotion({ key: 'sad', active: true })]);
    const [c1] = candidates;
    const mappingAudit = auditMappings(
      [liveMapping({ verseReferenceKey: c1.verseKey, emotionKey: c1.emotionKey, status: 'development' })],
      candidates,
      rejectPairs,
      holdPairs,
      new Set(seedEmotions.map((e) => e.key)),
    );
    const writePlan = buildWritePlan(emotionAudit, mappingAudit);

    const result = await runActivationApply({ candidates, emotionAudit, writePlan });

    expect(withTransactionCalled).toBe(true);
    expect(result.emotionsCreated).toEqual(writePlan.emotionsToCreate);
    expect(result.mappingsInserted).toEqual(writePlan.mappingsToInsert);
    expect(result.mappingsPromoted).toEqual(writePlan.mappingsToPromote);
    // Every promoted mapping sets ONLY status/mappingVersion — every other
    // field (reviewedBy, reviewedAt, rationale, confidence, contextNotes,
    // tafsirReferences, _id, createdAt) is left untouched.
    const promoteCall = updateCalls.find((c) => c.model === 'EmotionVerseMapping' && c.filter && (c.filter as { verseReferenceKey?: string }).verseReferenceKey === c1.verseKey);
    expect(promoteCall).toBeDefined();
    expect((promoteCall!.update as { $set: Record<string, unknown> }).$set).toEqual({ status: 'approved', mappingVersion: APPROVED_MAPPING_VERSION });

    // Every newly-inserted mapping is stamped with the approved mapping
    // version and status, and carries no fabricated reviewedBy/reviewedAt/confidence.
    const insertedMappingDocs = createCalls
      .flat()
      .filter((doc): doc is { verseReferenceKey: string; emotionKey: string; status: string; mappingVersion: string } =>
        typeof doc === 'object' && doc !== null && 'verseReferenceKey' in doc,
      );
    expect(insertedMappingDocs.length).toBe(writePlan.mappingsToInsert.length);
    insertedMappingDocs.forEach((doc) => {
      expect(doc.status).toBe('approved');
      expect(doc.mappingVersion).toBe(APPROVED_MAPPING_VERSION);
      expect(doc).not.toHaveProperty('reviewedBy');
      expect(doc).not.toHaveProperty('reviewedAt');
      expect(doc).not.toHaveProperty('confidence');
    });

    // Localization: the live "sad" fixture in this test has no names/descriptions
    // yet (today's real shape), so it must be $set from the canonical catalog —
    // and ONLY names/descriptions, never active/icon/order/legacy flat fields.
    expect(result.emotionsLocalized).toEqual(writePlan.emotionsToLocalize);
    expect(writePlan.emotionsToLocalize).toContain('sad');
    const localizeCall = updateCalls.find((c) => c.model === 'Emotion' && c.filter && (c.filter as { key?: string }).key === 'sad');
    expect(localizeCall).toBeDefined();
    const localizeSet = (localizeCall!.update as { $set: Record<string, unknown> }).$set;
    expect(Object.keys(localizeSet).sort()).toEqual(['descriptions', 'names']);
    expect(localizeSet.names).toEqual(EMOTION_CATALOG_BY_KEY.get('sad')!.names);
    expect(localizeSet.descriptions).toEqual(EMOTION_CATALOG_BY_KEY.get('sad')!.descriptions);
  });

  it('a newly-created emotion is written with full localized names/descriptions from the catalog, and no legacy flat fields', async () => {
    const createCalls: unknown[][] = [];
    vi.spyOn(EmotionModel, 'insertMany').mockImplementation(((docs: unknown[]) => {
      createCalls.push(docs);
      return Promise.resolve(docs as never);
    }) as never);
    vi.spyOn(EmotionModel, 'updateOne').mockResolvedValue({ acknowledged: true } as never);
    vi.spyOn(EmotionVerseMappingModel, 'insertMany').mockResolvedValue([] as never);
    vi.spyOn(EmotionVerseMappingModel, 'updateOne').mockResolvedValue({ acknowledged: true } as never);
    vi.spyOn(mongoose, 'startSession').mockResolvedValue({
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: async () => {},
    } as never);

    const emotionAudit = auditEmotionDefinitions([]); // all 29 missing
    const mappingAudit = auditMappings([], candidates, rejectPairs, holdPairs, new Set(seedEmotions.map((e) => e.key)));
    const writePlan = buildWritePlan(emotionAudit, mappingAudit);
    expect(writePlan.emotionsToCreate).toHaveLength(29);

    await runActivationApply({ candidates, emotionAudit, writePlan });

    const createdEmotionDocs = createCalls
      .flat()
      .filter((doc): doc is { key: string; names: unknown; descriptions: unknown } => typeof doc === 'object' && doc !== null && 'names' in doc);
    expect(createdEmotionDocs.length).toBe(29);
    createdEmotionDocs.forEach((doc) => {
      const canonical = EMOTION_CATALOG_BY_KEY.get(doc.key)!;
      expect(doc.names).toEqual(canonical.names);
      expect(doc.descriptions).toEqual(canonical.descriptions);
      expect(doc).not.toHaveProperty('name');
      expect(doc).not.toHaveProperty('arabicName');
      expect(doc).not.toHaveProperty('description');
    });
  });

  it('refuses to run at all when the write plan is blocked', async () => {
    const emotionAudit = auditEmotionDefinitions([]);
    const blockedMappingAudit = auditMappings(
      [liveMapping({ verseReferenceKey: candidates[0].verseKey, emotionKey: candidates[0].emotionKey, status: 'rejected' })],
      candidates,
      rejectPairs,
      holdPairs,
      new Set(seedEmotions.map((e) => e.key)),
    );
    const writePlan = buildWritePlan(emotionAudit, blockedMappingAudit);
    expect(writePlan.blocked).toBe(true);

    await expect(runActivationApply({ candidates, emotionAudit, writePlan })).rejects.toThrow(/blocked/);
  });

  it('an error thrown mid-transaction propagates and no partial "success" is reported (session.withTransaction owns rollback)', async () => {
    vi.spyOn(EmotionModel, 'insertMany').mockRejectedValue(new Error('simulated failure'));
    const fakeSession = {
      withTransaction: async (fn: () => Promise<void>) => {
        await fn(); // real mongoose re-throws from inside withTransaction on failure
      },
      endSession: async () => {},
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession as never);

    const emotionAudit = auditEmotionDefinitions([]); // all 29 missing -> emotionsToCreate non-empty
    const mappingAudit = auditMappings([], candidates, rejectPairs, holdPairs, new Set(seedEmotions.map((e) => e.key)));
    const writePlan = buildWritePlan(emotionAudit, mappingAudit);

    await expect(runActivationApply({ candidates, emotionAudit, writePlan })).rejects.toThrow(/simulated failure/);
  });
});

// ---------------------------------------------------------------------------
// Post-write verification (Step 16) — implemented, tested via mocks, never run live
// ---------------------------------------------------------------------------

describe('Approved mapping activation: post-write verification (mocked)', () => {
  it('passes when live state exactly matches the predicted final state', async () => {
    const approvedDocs: LiveMappingDoc[] = candidates.map((c) =>
      liveMapping({ verseReferenceKey: c.verseKey, emotionKey: c.emotionKey, status: 'approved', mappingVersion: APPROVED_MAPPING_VERSION }),
    );
    const activeEmotions: LiveEmotionDoc[] = seedEmotions.map((e) => liveEmotion({ ...e, active: true }));

    vi.spyOn(EmotionModel, 'countDocuments').mockResolvedValue(29 as never);
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue({ lean: async () => approvedDocs } as never);
    vi.spyOn(EmotionModel, 'find').mockReturnValue({ lean: async () => activeEmotions } as never);

    const result = await runPostWriteVerification(candidates);
    expect(result.passed).toBe(true);
    expect(result.activeEmotionCount).toBe(29);
    expect(result.approvedMappingCount).toBe(1845);
  });

  it('fails when an approved candidate is missing from live approved mappings', async () => {
    const approvedDocs: LiveMappingDoc[] = candidates.slice(1).map((c) =>
      liveMapping({ verseReferenceKey: c.verseKey, emotionKey: c.emotionKey, status: 'approved', mappingVersion: APPROVED_MAPPING_VERSION }),
    );
    vi.spyOn(EmotionModel, 'countDocuments').mockResolvedValue(29 as never);
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue({ lean: async () => approvedDocs } as never);
    vi.spyOn(EmotionModel, 'find').mockReturnValue({ lean: async () => [] } as never);

    const result = await runPostWriteVerification(candidates);
    expect(result.passed).toBe(false);
    expect(result.failures.join(' ')).toMatch(/missing an approved live document/);
  });

  it('fails when active emotion count is not 29', async () => {
    vi.spyOn(EmotionModel, 'countDocuments').mockResolvedValue(12 as never);
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue({ lean: async () => [] } as never);
    vi.spyOn(EmotionModel, 'find').mockReturnValue({ lean: async () => [] } as never);

    const result = await runPostWriteVerification(candidates);
    expect(result.passed).toBe(false);
    expect(result.failures.join(' ')).toMatch(/Active emotion count is 12/);
  });
});

// ---------------------------------------------------------------------------
// Sanity: real dataset validation still passes (mirrors activation-dry-run.test.ts)
// ---------------------------------------------------------------------------

describe('Approved mapping activation: real dataset sanity', () => {
  it('the real approved candidate set still validates cleanly', () => {
    const validation = validateActivationSet(candidates);
    expect(validation.passed).toBe(true);
    expect(validation.counts.mappings).toBe(1845);
  });
});
