import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMOTION_CATALOG } from '../../src/emotions/emotionCatalog';
import * as catalog from '../../src/emotions/emotionCatalog';
import { AyahModel } from '../../src/models/Ayah';
import { EmotionModel } from '../../src/models/Emotion';
import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import * as arabicSource from '../../src/quran/quranSource';
import * as translationSource from '../../src/quran/translationSource';
import { loadApprovedMappingsPreview, loadReviewDecisions } from '../../src/scripts/activationDryRun';
import {
  applyActivation,
  assertDevelopmentTarget,
  loadBatch,
  mappingDocument,
  planActivation,
  targetDefinition,
  validateBatch,
  TARGET,
  VERSION,
  type Snapshot,
} from '../../src/scripts/activateFaithShaken';

const dataDir = resolve(__dirname, '../../data/emotion-candidates/batches/batch-6-faith-shaken');
const candidates: Parameters<typeof validateBatch>[0] = JSON.parse(readFileSync(resolve(dataDir, 'initial-candidates.json'), 'utf8'));
const review: Parameters<typeof validateBatch>[1] = JSON.parse(readFileSync(resolve(dataDir, 'final-review.json'), 'utf8'));
const batch = loadBatch();
const preview = loadApprovedMappingsPreview();

function historicalSnapshot(): Snapshot {
  const historicalKeys = new Set(preview.rows.map(row => row.emotionKey));
  return {
    emotions: EMOTION_CATALOG.filter(row => historicalKeys.has(row.key)).map(row => ({
      ...row, _id: new Types.ObjectId(), active: true,
    })),
    mappings: preview.rows.map(row => ({
      _id: new Types.ObjectId(), verseReferenceKey: row.verseKey, emotionKey: row.emotionKey,
      status: 'approved', mappingVersion: 'approved-emotion-mappings-v1',
    })),
    legacyTargetReferences: [],
  };
}

function withTarget(before: Snapshot, active = false, count = batch.keep.length): Snapshot {
  return {
    emotions: [...before.emotions, { _id: new Types.ObjectId(), ...targetDefinition(), active }],
    mappings: [...before.mappings, ...batch.keep.slice(0, count).map(row => ({ _id: new Types.ObjectId(), ...mappingDocument(row) }))],
    legacyTargetReferences: [...before.legacyTargetReferences],
  };
}

// This completed migration retains its original order-30 contract. The UI
// reorder changes presentation only; never rewrite or rerun activation here.
const currentGetCanonicalEmotion = catalog.getCanonicalEmotion;
beforeEach(() => {
  vi.spyOn(catalog, 'getCanonicalEmotion').mockImplementation(key => {
    const entry = currentGetCanonicalEmotion(key);
    return key === TARGET && entry ? { ...entry, order: 30 } : entry;
  });
});
afterEach(() => vi.restoreAllMocks());

describe('faith_shaken activation: authoritative review validation', () => {
  it('derives exactly 169 KEEP and 27 REJECT, with no HOLD or duplicated approved verse', () => {
    expect(candidates).toHaveLength(196);
    expect(review.reviews).toHaveLength(196);
    expect(review.decisionCounts).toEqual({ keep: 169, reject: 27, hold: 0 });
    const result = validateBatch(candidates, review);
    expect(result.keep).toHaveLength(169);
    expect(result.reject).toHaveLength(27);
    expect(new Set(result.keep.map(row => row.verseKey)).size).toBe(169);
    expect(result.keep.map(row => row.verseKey)).toEqual(expect.arrayContaining(['51:56', '47:15']));
    expect(result.keep.some(row => result.reject.includes(row.verseKey))).toBe(false);
  });

  it('refuses a changed candidate count', () => {
    expect(() => validateBatch(candidates.slice(1), review)).toThrow(/196/);
  });

  it.each(['reject', 'hold'])('refuses changing a KEEP to %s even when ledger counts agree', decision => {
    const changed = structuredClone(review);
    changed.reviews.find(row => row.decision === 'keep')!.decision = decision;
    changed.decisionCounts.keep--;
    changed.decisionCounts[decision as 'reject' | 'hold']++;
    expect(() => validateBatch(candidates, changed)).toThrow();
  });

  it('refuses duplicate candidate pairs', () => {
    const changed = structuredClone(candidates);
    changed[1] = { ...changed[0] };
    expect(() => validateBatch(changed, review)).toThrow(/Invalid candidate/);
  });

  it.each(['missing', 'extra', 'duplicate', 'unknown', 'supplemental'])('refuses a %s review decision', kind => {
    const changed = structuredClone(review);
    if (kind === 'missing') changed.reviews.pop();
    if (kind === 'extra') changed.reviews.push({ ...changed.reviews[0] });
    if (kind === 'duplicate') changed.reviews[1] = { ...changed.reviews[0] };
    if (kind === 'unknown') changed.reviews[0].decision = 'approve';
    if (kind === 'supplemental') changed.supplementalReviews.push({ ...changed.reviews[0] });
    expect(() => validateBatch(candidates, changed)).toThrow();
  });

  it('refuses a nonexistent Quran reference even when the decision names that same reference', () => {
    const changed = structuredClone(candidates);
    const changedReview = structuredClone(review);
    changedReview.reviews.find(row => row.verseKey === changed[0].verseKey)!.verseKey = '114:7';
    changed[0].verseKey = '114:7';
    expect(() => validateBatch(changed, changedReview)).toThrow(/Invalid candidate/);
  });

  it('also checks rejected verses against verified Quran Arabic', () => {
    const readArabic = arabicSource.getVerifiedArabicByVerseKey;
    vi.spyOn(arabicSource, 'getVerifiedArabicByVerseKey').mockImplementation(key => key === batch.reject[0] ? '' : readArabic(key));
    expect(() => validateBatch(candidates, review)).toThrow();
  });

  it('requires every reviewed reference to resolve through the verified translation source', () => {
    const readTranslation = translationSource.getVerifiedTranslationByVerseKey;
    vi.spyOn(translationSource, 'getVerifiedTranslationByVerseKey').mockImplementation(key => key === batch.reject[0] ? '' : readTranslation(key));
    expect(() => validateBatch(candidates, review)).toThrow();
  });
});

describe('faith_shaken activation: incremental write plan', () => {
  it('inserts only the 169 KEEP pairs and leaves all 29 historical emotions / 1,845 pairs untouched', () => {
    const snapshot = historicalSnapshot();
    const before = JSON.stringify(snapshot);
    const plan = planActivation(batch, snapshot);
    expect(plan).toMatchObject({
      passed: true, targetEmotion: TARGET, catalogRecordFound: true,
      currentEmotionExists: false, currentActive: null, keep: 169, reject: 27,
      keepRowsPresent: 0, keepRowsMissing: 169, unexpectedMappings: 0, duplicateMappings: 0,
      historicalMappingsChanging: 0, otherEmotionsChanging: 0,
      mappingInserts: 169, mappingUpdates: 0, emotionInserts: 1, emotionUpdates: 1,
    });
    expect(new Set(plan.insertVerseKeys)).toEqual(new Set(batch.keep.map(row => row.verseKey)));
    for (const rejected of batch.reject) expect(plan.insertVerseKeys).not.toContain(rejected);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(snapshot.emotions).toHaveLength(29);
    expect(snapshot.mappings).toHaveLength(1845);
  });

  it('treats an existing matching KEEP pair as a no-op rather than duplicating it', () => {
    const plan = planActivation(batch, withTarget(historicalSnapshot(), false, 1));
    expect(plan).toMatchObject({ passed: true, mappingInserts: 168, mappingUpdates: 0, emotionInserts: 0, emotionUpdates: 1 });
    expect(plan.insertVerseKeys).not.toContain(batch.keep[0].verseKey);
  });

  it('has zero writes after complete activation, preserving the 2,014 approved pair total', () => {
    const complete = withTarget(historicalSnapshot(), true);
    const plan = planActivation(batch, complete);
    expect(plan).toMatchObject({ passed: true, currentActive: true, mappingInserts: 0, mappingUpdates: 0, emotionInserts: 0, emotionUpdates: 0 });
    expect(complete.emotions).toHaveLength(30);
    expect(complete.mappings).toHaveLength(2014);
    expect(complete.mappings.filter(row => row.emotionKey === TARGET)).toHaveLength(169);
    expect(complete.mappings.filter(row => row.emotionKey === TARGET && batch.reject.includes(row.verseReferenceKey))).toEqual([]);
  });

  it.each(['draft', 'development', 'reviewed', 'rejected'] as const)('blocks an existing %s target mapping rather than silently promoting it', status => {
    const snapshot = withTarget(historicalSnapshot(), false, 1);
    snapshot.mappings[snapshot.mappings.length - 1].status = status;
    const plan = planActivation(batch, snapshot);
    expect(plan.passed).toBe(false);
    expect(plan.blockingReasons.join(' ')).toMatch(/Conflicting mapping .*status/);
    expect(plan.mappingUpdates).toBe(0);
  });

  it('blocks conflicting approved metadata', () => {
    const snapshot = withTarget(historicalSnapshot(), false, 1);
    snapshot.mappings[snapshot.mappings.length - 1].mappingVersion = 'unreviewed-version';
    expect(planActivation(batch, snapshot).blockingReasons.join(' ')).toMatch(/Conflicting mapping .*mappingVersion/);
  });

  it('blocks duplicate target mapping pairs', () => {
    const snapshot = withTarget(historicalSnapshot(), false, 1);
    snapshot.mappings.push({ ...snapshot.mappings[snapshot.mappings.length - 1], _id: new Types.ObjectId() });
    expect(planActivation(batch, snapshot)).toMatchObject({ passed: false, duplicateMappings: 1 });
  });

  it.each(batch.reject)('blocks authoritative REJECT %s if it appears in target mapping storage', verseReferenceKey => {
    const snapshot = historicalSnapshot();
    snapshot.mappings.push({ _id: new Types.ObjectId(), verseReferenceKey, emotionKey: TARGET, status: 'approved', mappingVersion: VERSION });
    expect(planActivation(batch, snapshot)).toMatchObject({ passed: false, unexpectedMappings: 1 });
  });

  it('blocks an unreviewed target verse outside the 196 candidates', () => {
    const unreviewed = '1:1';
    expect(candidates.some(row => row.verseKey === unreviewed)).toBe(false);
    const snapshot = historicalSnapshot();
    snapshot.mappings.push({ _id: new Types.ObjectId(), verseReferenceKey: unreviewed, emotionKey: TARGET, status: 'approved', mappingVersion: VERSION });
    expect(planActivation(batch, snapshot)).toMatchObject({ passed: false, unexpectedMappings: 1 });
  });

  it('blocks legacy target ayah tags that could bypass the approved mapping set', () => {
    const snapshot = historicalSnapshot();
    snapshot.legacyTargetReferences = [batch.reject[0]];
    expect(planActivation(batch, snapshot).blockingReasons.join(' ')).toMatch(/Legacy target ayah tags/);
  });

  it('blocks duplicate target emotion documents and conflicting localized names', () => {
    const snapshot = withTarget(historicalSnapshot());
    const target = snapshot.emotions[snapshot.emotions.length - 1];
    target.names = { ...targetDefinition().names, en: 'Unexpected title' };
    snapshot.emotions.push({ ...target, _id: new Types.ObjectId() });
    const plan = planActivation(batch, snapshot);
    expect(plan.passed).toBe(false);
    expect(plan.blockingReasons).toContain('Duplicate target emotion.');
    expect(plan.blockingReasons).toContain('Conflicting target emotion field: names');
  });

  it('blocks an already visible target that is missing approved mappings', () => {
    expect(planActivation(batch, withTarget(historicalSnapshot(), true, 168)).blockingReasons)
      .toContain('Target is already visible with incomplete mappings.');
  });

  it.each(['missing-emotion', 'inactive-emotion', 'missing-mapping', 'duplicate-mapping', 'unapproved-mapping'])('blocks a changed historical baseline: %s', kind => {
    const snapshot = historicalSnapshot();
    if (kind === 'missing-emotion') snapshot.emotions.pop();
    if (kind === 'inactive-emotion') snapshot.emotions[0].active = false;
    if (kind === 'missing-mapping') snapshot.mappings.pop();
    if (kind === 'duplicate-mapping') snapshot.mappings[1] = { ...snapshot.mappings[0], _id: new Types.ObjectId() };
    if (kind === 'unapproved-mapping') snapshot.mappings[0].status = 'development';
    const plan = planActivation(batch, snapshot);
    expect(plan.passed).toBe(false);
    expect(plan.blockingReasons.join(' ')).toMatch(/Historical/);
  });

  it.each(['rejectPairs', 'holdPairs'] as const)('retains all historical %s protections', protection => {
    const decisions = loadReviewDecisions();
    expect(decisions.rejectPairs.size).toBe(191);
    expect(decisions.holdPairs.size).toBe(8);
    const snapshot = historicalSnapshot();
    const [verseReferenceKey, emotionKey] = [...decisions[protection]][0].split('|');
    snapshot.mappings[0] = { ...snapshot.mappings[0], verseReferenceKey, emotionKey };
    expect(planActivation(batch, snapshot).blockingReasons).toContain('Historical REJECT/HOLD pair present in mapping storage.');
  });
});

describe('faith_shaken activation: development target confirmation', () => {
  it.each(['test', 'quran_heals_dev', 'quran-heals-test'])('accepts explicitly named safe target %s with exact confirmation', database => {
    expect(() => assertDevelopmentTarget('development', database, database)).not.toThrow();
  });

  it.each([
    ['production', 'test', 'test'],
    ['staging', 'test', 'test'],
    ['development', 'quran_heals', 'quran_heals'],
    ['development', 'quran_heals_prod', 'quran_heals_prod'],
    ['development', 'test', ''],
    ['development', 'test', 'quran_heals_dev'],
  ])('rejects environment %s, database %s, confirmation %s', (environment, database, confirmation) => {
    expect(() => assertDevelopmentTarget(environment, database, confirmation)).toThrow();
  });
});

function mockTransaction(snapshots: Snapshot[]) {
  const operations: string[] = [];
  let readIndex = -1;
  const session = {
    withTransaction: vi.fn(async (callback: () => Promise<void>) => callback()),
    endSession: vi.fn(async () => {}),
  };
  vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
  vi.spyOn(EmotionModel, 'find').mockImplementation((() => {
    readIndex++;
    operations.push(`read:${readIndex}`);
    return { session: () => ({ lean: async () => snapshots[readIndex].emotions }) };
  }) as never);
  vi.spyOn(EmotionVerseMappingModel, 'find').mockImplementation((() => ({
    session: () => ({ lean: async () => snapshots[readIndex].mappings }),
  })) as never);
  vi.spyOn(AyahModel, 'find').mockImplementation((() => ({
    select: () => ({ session: () => ({ lean: async () => snapshots[readIndex].legacyTargetReferences.map(referenceKey => ({ referenceKey })) }) }),
  })) as never);
  const create = vi.spyOn(EmotionModel, 'create').mockImplementation((async () => { operations.push('create-hidden'); return []; }) as never);
  const insert = vi.spyOn(EmotionVerseMappingModel, 'insertMany').mockImplementation((async () => { operations.push('insert-mappings'); return []; }) as never);
  const activate = vi.spyOn(EmotionModel, 'updateOne').mockImplementation((async () => { operations.push('activate'); return { modifiedCount: 1 }; }) as never);
  return { operations, session, create, insert, activate };
}

describe('faith_shaken activation: transaction ordering (mocked, no database)', () => {
  it('creates a hidden emotion, inserts all KEEP mappings, verifies readiness, then activates', async () => {
    const before = historicalSnapshot();
    const ready = withTarget(before, false);
    const after = { ...ready, emotions: ready.emotions.map(row => row.key === TARGET ? { ...row, active: true } : row) };
    const mocked = mockTransaction([before, ready, after]);
    await applyActivation(batch, before);
    expect(mocked.operations).toEqual(['read:0', 'create-hidden', 'insert-mappings', 'read:1', 'activate', 'read:2']);
    expect(mocked.create).toHaveBeenCalledWith([{ ...targetDefinition(), active: false }], { session: mocked.session });
    expect(mocked.insert).toHaveBeenCalledWith(batch.keep.map(mappingDocument), { session: mocked.session, ordered: true });
    expect(mocked.activate).toHaveBeenCalledWith({ key: TARGET, active: false }, { $set: { active: true } }, { session: mocked.session, runValidators: true });
    expect(mocked.session.withTransaction).toHaveBeenCalledWith(expect.any(Function), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    expect(mocked.session.endSession).toHaveBeenCalledOnce();
  });

  it('aborts before active=true if even one approved mapping is missing after insertion', async () => {
    const before = historicalSnapshot();
    const mocked = mockTransaction([before, withTarget(before, false, 168)]);
    await expect(applyActivation(batch, before)).rejects.toThrow(/Mappings not ready/);
    expect(mocked.activate).not.toHaveBeenCalled();
    expect(mocked.session.endSession).toHaveBeenCalledOnce();
  });

  it('performs no writes on a repeated activation of a fully compatible target', async () => {
    const complete = withTarget(historicalSnapshot(), true);
    const mocked = mockTransaction([complete, complete, complete]);
    await applyActivation(batch, complete);
    expect(mocked.create).not.toHaveBeenCalled();
    expect(mocked.insert).not.toHaveBeenCalled();
    expect(mocked.activate).not.toHaveBeenCalled();
    expect(mocked.operations).toEqual(['read:0', 'read:1', 'read:2']);
  });

  it('refuses any writes if the database changed since dry-run', async () => {
    const before = historicalSnapshot();
    const changed = { ...before, mappings: before.mappings.map((row, index) => index === 0 ? { ...row, rationale: 'Concurrent edit' } : row) };
    const mocked = mockTransaction([changed]);
    await expect(applyActivation(batch, before)).rejects.toThrow(/Database changed since preflight/);
    expect(mocked.create).not.toHaveBeenCalled();
    expect(mocked.insert).not.toHaveBeenCalled();
    expect(mocked.activate).not.toHaveBeenCalled();
  });

  it('fails the transaction if unrelated historical document contents change, even when counts still match', async () => {
    const before = historicalSnapshot();
    const ready = withTarget(before, false);
    const after = {
      ...ready,
      emotions: ready.emotions.map(row => row.key === TARGET ? { ...row, active: true } : row),
      mappings: ready.mappings.map((row, index) => index === 0 ? { ...row, rationale: 'Unexpected historical edit' } : row),
    };
    const mocked = mockTransaction([before, ready, after]);
    await expect(applyActivation(batch, before)).rejects.toThrow(/Unrelated documents changed/);
    expect(mocked.session.endSession).toHaveBeenCalledOnce();
  });
});
