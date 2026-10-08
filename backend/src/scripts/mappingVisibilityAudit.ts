/**
 * Read-only pre-deployment check for D6 (approved-only mappings in
 * production) and D11 (no legacy `ayahs` fallback). Reads mapping, emotion
 * and legacy-ayah metadata only — never user data — and writes nothing
 * (autoIndex/autoCreate off, no write calls).
 *
 * Reports, per active emotion: mapping counts by status, and whether it would
 * be left with no ayahs once only approved mappings are served. Also reports
 * how many legacy (verse, emotion) pairs have no approved mapping — pairs a
 * user could previously only have reached through the removed fallback.
 *
 *   npm run mapping:visibility-audit                       (quranheals_dev)
 *   NODE_ENV=production MONGODB_DB_NAME=quranheals_prod \
 *     MONGODB_URI=<read-only audit user> npm run mapping:visibility-audit
 *
 * Exits non-zero when any active emotion has no approved mapping.
 */
import { connectScriptDatabase, disconnectFromDatabase } from '../config/database';
import { DatabaseConfigError } from '../config/databaseTarget';
import { describeMongoFailure } from '../config/mongoFailure';
import { AyahModel } from '../models/Ayah';
import { EmotionModel } from '../models/Emotion';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';

type StatusCount = { _id: { emotionKey: string; status: string }; count: number };

/** The operation in progress, reported if it fails (never its arguments or results). */
let step = 'connect + credential check';

async function main() {
  await connectScriptDatabase(
    { script: 'mapping:visibility-audit', writes: false, productionSupported: true },
    { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10_000 },
  );

  step = 'read emotions (find)';
  const activeEmotions = (await EmotionModel.find({ active: true }, { key: 1 }).lean<{ key: string }[]>()).map((emotion) => emotion.key).sort();
  step = 'count mappings by status (aggregate $group)';
  const statusCounts = await EmotionVerseMappingModel.aggregate<StatusCount>([
    { $group: { _id: { emotionKey: '$emotionKey', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const byEmotion = new Map<string, Record<string, number>>();
  for (const { _id, count } of statusCounts) {
    byEmotion.set(_id.emotionKey, { ...byEmotion.get(_id.emotionKey), [_id.status]: count });
  }

  step = 'read legacy ayahs (find)';
  const legacy = await AyahModel.find({}, { referenceKey: 1, emotions: 1 }).lean<{ referenceKey: string; emotions: string[] }[]>();
  step = 'read approved mappings (find)';
  const approvedPairs = new Set(
    (await EmotionVerseMappingModel.find({ status: 'approved' }, { verseReferenceKey: 1, emotionKey: 1 }).lean<{ verseReferenceKey: string; emotionKey: string }[]>())
      .map((mapping) => `${mapping.verseReferenceKey}|${mapping.emotionKey}`),
  );
  const legacyPairs = legacy.flatMap((ayah) => ayah.emotions.map((emotionKey) => `${ayah.referenceKey}|${emotionKey}`));
  const legacyPairsWithoutApproval = legacyPairs.filter((pair) => !approvedPairs.has(pair));

  const emotions = activeEmotions.map((key) => ({ key, counts: byEmotion.get(key) ?? {}, approved: byEmotion.get(key)?.approved ?? 0 }));
  const emptyInProduction = emotions.filter((emotion) => emotion.approved === 0).map((emotion) => emotion.key);

  console.log(JSON.stringify({
    activeEmotionCount: activeEmotions.length,
    approvedMappingTotal: emotions.reduce((sum, emotion) => sum + emotion.approved, 0),
    emotions,
    emotionsWithNoApprovedMapping: emptyInProduction,
    legacyAyahDocuments: legacy.length,
    legacyPairs: legacyPairs.length,
    legacyPairsWithoutApprovedMapping: legacyPairsWithoutApproval.sort(),
  }, null, 2));

  if (emptyInProduction.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    // Driver messages can name the host or user, so only our own config
    // errors are printed verbatim; driver errors are reduced to the failing
    // step, a failure kind and fixed identifiers (config/mongoFailure.ts).
    console.error(`mapping:visibility-audit ${error instanceof DatabaseConfigError ? `failed: ${error.message}` : describeMongoFailure(step, error)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectFromDatabase());
