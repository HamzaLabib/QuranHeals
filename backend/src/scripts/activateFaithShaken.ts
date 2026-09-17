/** Incremental Batch 6 activation. Dry-run by default; never replays Phase 5. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mongoose, { type ClientSession } from 'mongoose';
import { env } from '../config/env';
import { getCanonicalEmotion } from '../emotions/emotionCatalog';
import { EmotionModel } from '../models/Emotion';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { AyahModel } from '../models/Ayah';
import { isValidVerseKey } from '../quran/referenceKeys';
import { getVerifiedArabicByVerseKey } from '../quran/quranSource';
import { getVerifiedTranslationByVerseKey } from '../quran/translationSource';
import { loadApprovedMappingsPreview, loadReviewDecisions } from './activationDryRun';
import { evaluateRows, isValidRow, summarizeReview } from './importCandidateMappings';
import { verifyLiveIndexes, verifyTransactionSupport, writeActivationBackup,
  type LiveEmotionDoc, type LiveMappingDoc } from './activateApprovedEmotionMappings';
import { EMOTION_MAPPING_ACTIVATION_BACKUPS_DIR } from '../utils/backupPaths';

export const TARGET = 'faith_shaken';
export const VERSION = 'faith-shaken-human-review-v1';
const DATA = resolve(__dirname, '../../data/emotion-candidates/batches/batch-6');
type Candidate = { verseKey: string; emotionKey: string; rationale: string; contextNotes: string; source: string };
type Review = Parameters<typeof summarizeReview>[1];
export type Batch = { keep: Candidate[]; reject: string[] };
export type Snapshot = { emotions: LiveEmotionDoc[]; mappings: LiveMappingDoc[]; legacyTargetReferences: string[] };

export function validateBatch(candidates: Candidate[], review: Review): Batch {
  assert.equal(candidates.length, 196, 'Expected 196 candidates');
  assert.ok(evaluateRows(candidates).every(isValidRow), 'Invalid candidate');
  assert.ok(candidates.every(row => row.emotionKey === TARGET), 'Wrong emotion');
  assert.deepEqual(summarizeReview(evaluateRows(candidates), review), { keep: 169, reject: 27, hold: 0 });
  for (const row of candidates) {
    assert.ok(isValidVerseKey(row.verseKey), 'Invalid Quran reference');
    assert.ok(getVerifiedArabicByVerseKey(row.verseKey).length > 0);
    assert.ok(getVerifiedTranslationByVerseKey(row.verseKey).length > 0);
  }
  const decisions = new Map(review.reviews.map(row => [row.verseKey, row.decision]));
  for (const key of ['51:56', '47:15']) assert.equal(decisions.get(key), 'keep');
  return {
    keep: candidates.filter(row => decisions.get(row.verseKey) === 'keep'),
    reject: candidates.filter(row => decisions.get(row.verseKey) === 'reject').map(row => row.verseKey),
  };
}

export function loadBatch(): Batch {
  return validateBatch(JSON.parse(readFileSync(resolve(DATA, 'initial-candidates.json'), 'utf8')),
    JSON.parse(readFileSync(resolve(DATA, 'final-review.json'), 'utf8')));
}

export function targetDefinition() {
  const record = getCanonicalEmotion(TARGET);
  assert.ok(record);
  assert.equal(record.order, 30);
  assert.equal(record.icon, 'star');
  // Catalog active is a safe seed default. MongoDB owns runtime activation.
  return { key: TARGET, names: record.names, descriptions: record.descriptions, icon: record.icon, order: record.order };
}

export function mappingDocument(row: Candidate) {
  return { verseReferenceKey: row.verseKey, emotionKey: TARGET, status: 'approved' as const,
    mappingVersion: VERSION, rationale: row.rationale, contextNotes: row.contextNotes,
    reviewedBy: 'human:batch-6-final-review', tafsirReferences: [] };
}

function pair(row: LiveMappingDoc) { return `${row.verseReferenceKey}|${row.emotionKey}`; }

export function planActivation(batch: Batch, snapshot: Snapshot) {
  assert.equal(batch.keep.length, 169);
  assert.equal(batch.reject.length, 27);
  assert.equal(new Set([...batch.keep.map(row => row.verseKey), ...batch.reject]).size, 196);
  assert.ok(batch.keep.every(row => row.emotionKey === TARGET && isValidVerseKey(row.verseKey)));
  assert.ok(batch.reject.every(isValidVerseKey));
  const historical = loadApprovedMappingsPreview();
  const historicalKeys = new Set(historical.rows.map(row => row.emotionKey));
  const protections = loadReviewDecisions();
  const reasons: string[] = [];
  assert.equal(historical.rows.length, 1845);
  assert.equal(historicalKeys.size, 29);
  assert.equal(protections.rejectPairs.size, 191);
  assert.equal(protections.holdPairs.size, 8);
  assert.deepEqual(protections.conflicts, []);
  const originalEmotions = snapshot.emotions.filter(row => row.key !== TARGET);
  if (originalEmotions.length !== 29 || new Set(originalEmotions.map(row => row.key)).size !== 29 ||
      originalEmotions.some(row => !historicalKeys.has(row.key) || !row.active)) reasons.push('Historical 29 active emotions differ.');
  const originalMappings = snapshot.mappings.filter(row => row.emotionKey !== TARGET);
  const historicalPairs = new Set(historical.rows.map(row => `${row.verseKey}|${row.emotionKey}`));
  if (originalMappings.length !== 1845 || new Set(originalMappings.map(pair)).size !== 1845 ||
      originalMappings.some(row => row.status !== 'approved' || !historicalPairs.has(pair(row)))) reasons.push('Historical 1,845 approved pairs differ.');
  if (snapshot.mappings.some(row => protections.rejectPairs.has(pair(row)) || protections.holdPairs.has(pair(row)))) {
    reasons.push('Historical REJECT/HOLD pair present in mapping storage.');
  }
  const targetEmotions = snapshot.emotions.filter(row => row.key === TARGET);
  if (targetEmotions.length > 1) reasons.push('Duplicate target emotion.');
  const emotion = targetEmotions[0];
  if (emotion) {
    for (const [key, value] of Object.entries(targetDefinition())) {
      try { assert.deepEqual(emotion[key], value); } catch { reasons.push(`Conflicting target emotion field: ${key}`); }
    }
    for (const [key, value] of Object.entries({ name: targetDefinition().names.en, arabicName: targetDefinition().names.ar,
      description: targetDefinition().descriptions.en })) {
      if (emotion[key] !== undefined && emotion[key] !== value) reasons.push(`Conflicting legacy target field: ${key}`);
    }
  }
  const targets = snapshot.mappings.filter(row => row.emotionKey === TARGET);
  const keepKeys = new Set(batch.keep.map(row => row.verseKey));
  const duplicates = targets.length - new Set(targets.map(pair)).size;
  const unexpected = targets.filter(row => !keepKeys.has(row.verseReferenceKey));
  if (duplicates) reasons.push('Duplicate target mapping pairs.');
  if (unexpected.length) reasons.push('Unexpected or REJECT target mappings exist; manual inspection required.');
  if (snapshot.legacyTargetReferences.length) reasons.push('Legacy target ayah tags exist; manual inspection required.');
  const desired = new Map(batch.keep.map(row => [row.verseKey, mappingDocument(row)]));
  for (const row of targets.filter(row => keepKeys.has(row.verseReferenceKey))) {
    for (const [key, value] of Object.entries(desired.get(row.verseReferenceKey)!)) {
      try { assert.deepEqual(row[key], value); } catch { reasons.push(`Conflicting mapping ${row.verseReferenceKey}: ${key}`); }
    }
  }
  const present = new Set(targets.map(row => row.verseReferenceKey));
  const inserts = batch.keep.filter(row => !present.has(row.verseKey));
  if (emotion?.active && inserts.length) reasons.push('Target is already visible with incomplete mappings.');
  return { targetEmotion: TARGET, catalogRecordFound: true, currentEmotionExists: !!emotion,
    currentActive: emotion?.active ?? null, keep: batch.keep.length, reject: batch.reject.length,
    keepRowsPresent: batch.keep.length - inserts.length, keepRowsMissing: inserts.length,
    unexpectedMappings: unexpected.length, duplicateMappings: duplicates,
    historicalMappingsChanging: 0, otherEmotionsChanging: 0, mappingInserts: inserts.length, mappingUpdates: 0,
    emotionInserts: emotion ? 0 : 1, emotionUpdates: emotion?.active ? 0 : 1,
    insertVerseKeys: inserts.map(row => row.verseKey), blockingReasons: reasons, passed: reasons.length === 0 };
}

export function assertDevelopmentTarget(environment: string, databaseName: string, confirmedDatabase: string) {
  assert.ok(environment === 'development' || environment === 'test', 'Only development/test environments are allowed');
  assert.match(databaseName, /^(test|quran[-_]heals[-_](dev|test))$/, 'Database is not an explicitly development-safe name');
  assert.equal(confirmedDatabase, databaseName, 'Explicit database confirmation must match the connected target');
}

export async function readSnapshot(session?: ClientSession): Promise<Snapshot> {
  // Sequential session reads: parallel operations are unsupported inside transactions.
  const emotions = await EmotionModel.find({}).session(session ?? null).lean<LiveEmotionDoc[]>();
  const mappings = await EmotionVerseMappingModel.find({}).session(session ?? null).lean<LiveMappingDoc[]>();
  const legacy = await AyahModel.find({ emotions: TARGET }).select({ referenceKey: 1 }).session(session ?? null).lean<{ referenceKey: string }[]>();
  return { emotions, mappings, legacyTargetReferences: legacy.map(row => row.referenceKey).sort() };
}

function fingerprint(snapshot: Snapshot, historicalOnly = false) {
  const emotions = snapshot.emotions.filter(row => !historicalOnly || row.key !== TARGET).sort((a, b) => a.key.localeCompare(b.key));
  const mappings = snapshot.mappings.filter(row => !historicalOnly || row.emotionKey !== TARGET).sort((a, b) => pair(a).localeCompare(pair(b)));
  return createHash('sha256').update(JSON.stringify({ emotions, mappings, legacyTargetReferences: snapshot.legacyTargetReferences })).digest('hex');
}

export async function applyActivation(batch: Batch, before: Snapshot) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await readSnapshot(session);
      assert.equal(fingerprint(current), fingerprint(before), 'Database changed since preflight; rerun dry-run');
      const plan = planActivation(batch, current);
      assert.ok(plan.passed, plan.blockingReasons.join(' '));
      // The schema requires a parent emotion; create it hidden in this same transaction.
      if (plan.emotionInserts) await EmotionModel.create([{ ...targetDefinition(), active: false }], { session });
      const keys = new Set(plan.insertVerseKeys);
      if (keys.size) await EmotionVerseMappingModel.insertMany(batch.keep.filter(row => keys.has(row.verseKey)).map(mappingDocument), { session, ordered: true });
      const ready = await readSnapshot(session);
      const readiness = planActivation(batch, ready);
      assert.ok(readiness.passed && readiness.mappingInserts === 0, 'Mappings not ready; activation aborted');
      if (plan.emotionInserts || plan.emotionUpdates) {
        const result = await EmotionModel.updateOne({ key: TARGET, active: false }, { $set: { active: true } }, { session, runValidators: true });
        assert.equal(result.modifiedCount, 1);
      }
      const after = await readSnapshot(session);
      const final = planActivation(batch, after);
      assert.ok(final.passed && final.currentActive && final.mappingInserts === 0 && final.emotionInserts === 0 && final.emotionUpdates === 0);
      assert.equal(fingerprint(after, true), fingerprint(before, true), 'Unrelated documents changed');
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } finally { await session.endSession(); }
}

function counts(snapshot: Snapshot) {
  return { emotions: snapshot.emotions.length, activeEmotions: snapshot.emotions.filter(row => row.active).length,
    mappings: snapshot.mappings.length, approved: snapshot.mappings.filter(row => row.status === 'approved').length,
    historicalMappings: snapshot.mappings.filter(row => row.emotionKey !== TARGET).length,
    targetMappings: snapshot.mappings.filter(row => row.emotionKey === TARGET).length };
}

async function main() {
  const args = new Map(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.length ? value.join('=') : 'true']; }));
  const allowed = new Set(['apply', 'confirm-database', 'confirm-keep-count', 'confirm-activation', 'report']);
  for (const key of args.keys()) assert.ok(allowed.has(key), `Unknown argument: ${key}`);
  if (args.has('apply')) assert.equal(args.get('apply'), 'true', 'Use --apply without a value');
  const batch = loadBatch();
  assert.ok(env.MONGODB_URI, 'MONGODB_URI required');
  assert.notEqual(env.NODE_ENV, 'production', 'Production is forbidden');
  await mongoose.connect(env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const database = mongoose.connection.db!.databaseName;
  assertDevelopmentTarget(env.NODE_ENV, database, args.get('confirm-database') ?? '');
  const before = await readSnapshot();
  const plan = planActivation(batch, before);
  const indexes = await verifyLiveIndexes();
  const transactions = await verifyTransactionSupport();
  assert.ok(indexes.emotionUniqueKeyIndexPresent && indexes.mappingUniquePairIndexPresent, 'Required unique indexes absent');
  assert.ok(transactions.supported, 'Transactions unavailable');
  const report = { mode: args.has('apply') ? 'apply' : 'dry-run', database, environment: env.NODE_ENV,
    collections: [EmotionModel.collection.name, EmotionVerseMappingModel.collection.name], before: counts(before), plan,
    writes: { mappingInserts: 0, mappingUpdates: 0, emotionInserts: 0, emotionUpdates: 0 },
    backup: undefined as ReturnType<typeof writeActivationBackup> | undefined,
    after: counts(before), postPlan: plan, historicalDocumentsUnchanged: true };
  console.log(JSON.stringify(report, null, 2)); // reviewable dry-run precedes any writes
  const destination = resolve(args.get('report') ?? 'reports/emotion-mappings/faith-shaken-activation-dry-run.json');
  const save = () => { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, JSON.stringify(report, null, 2) + '\n'); };
  save();
  assert.ok(plan.passed, plan.blockingReasons.join(' '));
  if (args.has('apply')) {
    assert.equal(args.get('confirm-keep-count'), '169');
    assert.equal(args.get('confirm-activation'), TARGET);
    report.backup = writeActivationBackup(resolve(EMOTION_MAPPING_ACTIVATION_BACKUPS_DIR, `faith-shaken-${Date.now()}.json`), before.emotions, before.mappings, database,
      { emotionsToBeCreated: plan.emotionInserts ? [TARGET] : [], emotionsToBeActivated: plan.emotionUpdates ? [TARGET] : [], emotionsToBeLocalized: [],
        mappingsToBeInserted: plan.insertVerseKeys.map(key => `${key}|${TARGET}`), mappingsToBePromoted: [] });
    await applyActivation(batch, before);
    const after = await readSnapshot();
    report.after = counts(after);
    report.postPlan = planActivation(batch, after);
    report.historicalDocumentsUnchanged = fingerprint(before, true) === fingerprint(after, true);
    report.writes = { mappingInserts: plan.mappingInserts, mappingUpdates: 0, emotionInserts: plan.emotionInserts,
      emotionUpdates: plan.emotionUpdates };
    save();
    assert.ok(report.postPlan.passed && report.postPlan.currentActive && report.postPlan.mappingInserts === 0 && report.historicalDocumentsUnchanged);
    console.log(JSON.stringify({ after: report.after, writes: report.writes, historicalDocumentsUnchanged: report.historicalDocumentsUnchanged }));
  }
}

if (require.main === module) {
  main().catch(error => {
    // Driver errors can contain connection details; only expose local assertion messages.
    console.error(error instanceof assert.AssertionError ? error.message : `Activation failed (${error?.name ?? 'Error'}); no connection details logged.`);
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}
