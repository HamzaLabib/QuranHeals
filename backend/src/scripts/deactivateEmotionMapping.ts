/** Exact-pair deactivation, dry-run by default. Never deletes Quran or mapping documents. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { writeVerifiedJsonBackup } from '../utils/backupFile';
import { consolidate, discoverLaterBatches, loadLaterBatchFinalReview, loadHistoricalSources,
  loadEditorialCorrections, validateConsolidation, validateHistoricalReconstruction } from './consolidateCurrentMappings';

type Target = { verseKey: string; emotionKey: string };
type Stored = { verseReferenceKey: string; emotionKey: string; status: string };
export function authorizeRemoval(target: Target) {
  const historical = loadHistoricalSources();
  validateHistoricalReconstruction(historical);
  const result = consolidate(historical, discoverLaterBatches().map(loadLaterBatchFinalReview), loadEditorialCorrections());
  assert.deepEqual(validateConsolidation(result), []);
  const key = `${target.verseKey}|${target.emotionKey}`;
  assert.ok(result.rejectPairs.has(key) || result.holdPairs.has(key), 'Removal requires an explicit REJECT/HOLD authority');
  assert.ok(!result.rows.some(row => row.verseKey === target.verseKey && row.emotionKey === target.emotionKey), 'Pair is still approved');
}
export function planRemoval(target: Target, documents: Stored[]) {
  assert.ok(documents.every(row => row.verseReferenceKey === target.verseKey && row.emotionKey === target.emotionKey), 'Unrelated mapping supplied');
  assert.ok(documents.length <= 1, 'Duplicate database identity; manual review required');
  const before = documents[0]?.status ?? null;
  assert.ok(before === null || ['approved', 'reviewed', 'development', 'draft', 'rejected'].includes(before), 'Unknown mapping status');
  return { ...target, before, after: before === null ? null : 'rejected', changed: before !== null && before !== 'rejected' };
}
export function parseRemovalArgs(args: string[]) {
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply') { assert.ok(!apply, 'Repeated --apply'); apply = true; }
    else if (['--verse', '--emotion', '--confirm', '--backup'].includes(flag)) {
      assert.ok(!values.has(flag) && args[i + 1] && !args[i + 1].startsWith('--'), 'Missing/repeated argument');
      values.set(flag, args[++i]);
    } else throw new Error('Unknown argument: ' + flag);
  }
  const target = { verseKey: values.get('--verse') ?? '', emotionKey: values.get('--emotion') ?? '' };
  assert.ok(target.verseKey && target.emotionKey, '--verse and --emotion required');
  if (apply) {
    assert.equal(values.get('--confirm'), `deactivate:${target.verseKey}:${target.emotionKey}`, 'Exact confirmation required');
    assert.ok(values.get('--backup'), '--backup required for write mode');
  }
  return { target, apply, backup: values.get('--backup') };
}
export async function runRemoval(args: string[]) {
  const { target, apply, backup } = parseRemovalArgs(args);
  authorizeRemoval(target);
  assert.ok(env.MONGODB_URI, 'MONGODB_URI required');
  await mongoose.connect(env.MONGODB_URI, { autoIndex: false });
  try {
    const filter = { verseReferenceKey: target.verseKey, emotionKey: target.emotionKey };
    if (!apply) {
      const plan = planRemoval(target, await EmotionVerseMappingModel.find(filter).lean());
      return { mode: 'dry-run', ...plan, changed: false, wouldChange: plan.changed };
    }
    const session = await mongoose.startSession();
    try {
      let report: unknown;
      await session.withTransaction(async () => {
        authorizeRemoval(target);
        const documents = await EmotionVerseMappingModel.find(filter).session(session).lean();
        const plan = planRemoval(target, documents);
        if (plan.changed) {
          const contents = { target, documents, plan };
          writeVerifiedJsonBackup(resolve(backup!), contents, parsed => JSON.stringify(parsed) === JSON.stringify(contents));
          const update = await EmotionVerseMappingModel.updateOne({ ...filter, _id: documents[0]._id, status: plan.before },
            { $set: { status: 'rejected' } }, { session, runValidators: true });
          assert.equal(update.matchedCount, 1); assert.equal(update.modifiedCount, 1);
          const after = await EmotionVerseMappingModel.find(filter).session(session).lean();
          assert.equal(after.length, 1); assert.equal(after[0].status, 'rejected');
        }
        report = { mode: 'apply', ...plan, backup: plan.changed ? resolve(backup!) : null };
      });
      return report;
    } finally { await session.endSession(); }
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) runRemoval(process.argv.slice(2)).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
  console.error(error instanceof Error ? error.message : 'Mapping deactivation failed'); process.exitCode = 1;
});
