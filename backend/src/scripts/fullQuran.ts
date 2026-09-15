import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose, { type ClientSession } from 'mongoose';
import { env } from '../config/env';
import { compareExisting, loadCorpus, validateCorpus, validateMappings, type Snapshot } from '../import/fullQuran';
import { seedAyahs } from '../seed/ayahs';
import { seedEmotions } from '../seed/emotions';
import { buildFoundationSeedData } from '../seed/foundation';
import { validateCanonicalVerseBatch } from '../import/quranImporter';
import { QURAN_DATA_BACKUPS_DIR } from '../utils/backupPaths';
import { writeVerifiedJsonBackup } from '../utils/backupFile';
import { recordsRoundTripObjectIds, unwrapBackupEnvelope, wrapBackupEnvelope } from '../utils/objectId';

export async function readSnapshot(session?: ClientSession): Promise<Snapshot> {
  const db = mongoose.connection.db!;
  // Raw collection reads avoid schema coercion concealing invalid stored fields.
  const verses = await db.collection('verses').find({}, { session }).toArray();
  const versetranslations = await db.collection('versetranslations').find({}, { session }).toArray();
  const emotionversemappings = await db.collection('emotionversemappings').find({}, { session }).toArray();
  const emotions = await db.collection('emotions').find({}, { session }).toArray();
  return { verses, versetranslations, emotionversemappings, emotions } as unknown as Snapshot;
}

function baselineFailures(snapshot: Snapshot, expectedCount: number) {
  const expected = buildFoundationSeedData(seedAyahs);
  const failures: string[] = [];
  if (![expected.verses.length, expectedCount].includes(snapshot.verses.length)) failures.push('Unexpected starting verse count.');
  if (![expected.translations.length, expectedCount].includes(snapshot.versetranslations.length)) failures.push('Unexpected starting translation count.');
  const mappingKeys = (rows: Snapshot['emotionversemappings']) => rows.map(m => `${m.verseReferenceKey}|${m.emotionKey}|${m.status}`).sort();
  if (JSON.stringify(mappingKeys(snapshot.emotionversemappings)) !== JSON.stringify(mappingKeys(expected.mappings))) failures.push('Mapping references, emotions, or statuses differ from Phase 2.');
  // Seeded definitions may include inactive Phase 5B taxonomy rows; only the
  // active seed emotions must be present AND active, and exactly 12 in total.
  const activeSeedEmotions = seedEmotions.filter(e => e.active);
  if (
    snapshot.emotions.length !== seedEmotions.length ||
    activeSeedEmotions.some(e => !snapshot.emotions.some(actual => actual.key === e.key && actual.active)) ||
    snapshot.emotions.filter(e => e.active).length !== activeSeedEmotions.length
  ) failures.push('Expected the seeded emotion set with exactly 12 active.');
  if (!validateMappings(snapshot).valid) failures.push('Mapping integrity failed.');
  if (!validateCanonicalVerseBatch(snapshot.verses).valid) failures.push('Existing canonical records are structurally invalid.');
  const translationIdentities = snapshot.versetranslations.map(t => `${t.verseReferenceKey}|${t.language}|${t.translator}`);
  if (new Set(translationIdentities).size !== translationIdentities.length || snapshot.versetranslations.some(t => t.language !== 'en' || t.translator !== 'Marmaduke Pickthall')) failures.push('Unexpected or duplicate translation identities.');
  return failures;
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'import') {
    console.error('MongoDB full-corpus import is retired. The pinned Tanzil source generates the immutable SQLite foundation; King Fahd is verification-only. Runtime migration is pending. See tools/quran-import/README.md.');
    process.exitCode = 1;
    return;
  }
  if (!['source', 'validate', 'import'].includes(mode)) throw new Error('Use source, validate, or import.');
  const corpus = loadCorpus();
  mkdirSync('reports/quran-verification', { recursive: true });
  const sourceReport = validateCorpus(corpus, corpus);
  writeFileSync('reports/quran-verification/source-validation.json', JSON.stringify(sourceReport, null, 2) + '\n');
  if (mode === 'source') { console.log(JSON.stringify(sourceReport, null, 2)); return; }
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  if (env.NODE_ENV === 'production') throw new Error('Phase 3 commands are disabled in production.');
  const uri = new URL(env.MONGODB_URI);
  if (/prod/i.test(uri.hostname + uri.pathname)) throw new Error('Production-like database target; stopped.');
  await mongoose.connect(env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;
  const snapshot = await readSnapshot();
  const validation = validateCorpus({ verses: snapshot.verses, translations: snapshot.versetranslations }, corpus);
  const mappings = validateMappings(snapshot);
  const baseline = baselineFailures(snapshot, corpus.verses.length);
  const report = { database: db.databaseName, nodeEnv: env.NODE_ENV, corpus: validation, mappings, baselineFailures: baseline };
  writeFileSync('reports/quran-verification/database-validation.json', JSON.stringify(report, null, 2) + '\n');
  if (mode === 'validate') {
    console.log(JSON.stringify(report, null, 2));
    if (!validation.valid || !mappings.valid || baseline.length) process.exitCode = 1;
    return;
  }
  const comparison = compareExisting(snapshot, corpus);
  const safetyFailures = [...baseline];
  if (!/^(test|.*(?:[_-]dev|[_-]development|[_-]local))$/i.test(db.databaseName)) safetyFailures.push('Database is not recognizably local/development.');
  if (!comparison.safe) safetyFailures.push('Existing source text/checksum conflicts; no text overwrite is permitted.');
  const preflight = { source: sourceReport, database: report, comparison, safetyFailures, safeToImport: safetyFailures.length === 0 };
  writeFileSync('reports/quran-verification/preflight.json', JSON.stringify(preflight, null, 2) + '\n');
  console.log(JSON.stringify({ safeToImport: preflight.safeToImport, safetyFailures, preflightReport: 'reports/quran-verification/preflight.json' }, null, 2));
  if (safetyFailures.length) { process.exitCode = 1; return; }
  if (!process.argv.includes('--write')) { console.log('Preflight only. Use --write to import after a clean preflight.'); return; }

  // Require existing unique indexes; do not make preflight itself mutate schemas.
  const verseIndexes = await db.collection('verses').indexes();
  const translationIndexes = await db.collection('versetranslations').indexes();
  const hasUnique = (indexes: typeof verseIndexes, keys: string[]) => indexes.some(i => i.unique && JSON.stringify(Object.keys(i.key)) === JSON.stringify(keys));
  if (!hasUnique(verseIndexes, ['referenceKey']) || !hasUnique(verseIndexes, ['surahNumber', 'ayahNumber']) || !hasUnique(translationIndexes, ['verseReferenceKey', 'language', 'translator', 'sourceVersion'])) throw new Error('Required unique indexes are missing.');
  // Never placed under backend/reports/: this is a pre-mutation safety
  // backup, not a reproducible report, and backend/backups/ is git-ignored.
  // Wrapped in the versioned ObjectId-backup envelope (see ../utils/objectId)
  // so restoration can reconstruct the exact original `_id` of every record,
  // not merely confirm one was present.
  const backupPath = join(QURAN_DATA_BACKUPS_DIR, `before-write-${Date.now()}.json`);
  const backup = writeVerifiedJsonBackup(backupPath, wrapBackupEnvelope(snapshot), (parsed) => {
    let candidate: Partial<Snapshot>;
    try {
      candidate = unwrapBackupEnvelope<Partial<Snapshot>>(parsed);
    } catch {
      return false;
    }
    if (
      !Array.isArray(candidate.verses) ||
      !Array.isArray(candidate.versetranslations) ||
      !Array.isArray(candidate.emotionversemappings) ||
      !Array.isArray(candidate.emotions)
    ) {
      return false;
    }
    return (
      recordsRoundTripObjectIds(snapshot.verses, candidate.verses) &&
      recordsRoundTripObjectIds(snapshot.versetranslations, candidate.versetranslations) &&
      recordsRoundTripObjectIds(snapshot.emotionversemappings, candidate.emotionversemappings) &&
      recordsRoundTripObjectIds(snapshot.emotions, candidate.emotions)
    );
  });
  console.log(`Pre-write backup verified: ${backup.path} (sha256 ${backup.sha256}, ${backup.byteLength} bytes).`);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await readSnapshot(session);
      if (JSON.stringify(current) !== JSON.stringify(snapshot) || !compareExisting(current, corpus).safe) throw new Error('Database changed after preflight; stopped.');
      // Batch round-trips keep the full import within ordinary transaction lifetimes.
      await db.collection('verses').bulkWrite(corpus.verses.map(verse => ({ updateOne: {
        filter: { referenceKey: verse.referenceKey }, update: { $set: verse }, upsert: true,
      } })), { session, ordered: true });
      await db.collection('versetranslations').bulkWrite(corpus.translations.map(translation => ({ updateOne: {
        filter: { verseReferenceKey: translation.verseReferenceKey, language: translation.language, translator: translation.translator },
        update: { $set: translation }, upsert: true,
      } })), { session, ordered: true });
      const after = await readSnapshot(session);
      if (!validateCorpus({ verses: after.verses, translations: after.versetranslations }, corpus).valid || JSON.stringify(after.emotionversemappings) !== JSON.stringify(snapshot.emotionversemappings) || JSON.stringify(after.emotions) !== JSON.stringify(snapshot.emotions)) throw new Error('Post-import integrity failed; transaction aborted.');
    });
  } finally { await session.endSession(); }
  console.log('Full corpus transaction completed; run npm run validate:quran.');
}

if (require.main === module) {
  main().catch(() => {
    // Never print driver errors, which may contain connection details.
    console.error('Quran command failed. No success claimed; check local source/preflight reports and database connectivity. Connection details suppressed.');
    process.exitCode = 1;
  }).finally(async () => { await mongoose.disconnect(); });
}
