// Rollback for prepareTranslationCleanup.ts (Phase 6A.8C). Defaults to
// --dry-run; requires an explicit --apply plus a --backup <path> pointing at
// one specific verified backup file written by the cleanup script. Restores:
//   1. every VerseTranslation document in the backup, with its original _id
//   2. the englishTranslation/translationSource fields on every backed-up
//      Ayah document, with its original _id, via $set (never touching a
//      document not present in the backup)
// Never guesses a backup path, never touches unrelated collections, never
// deletes anything.
import { readFileSync } from 'node:fs';

import mongoose from 'mongoose';

import { env } from '../config/env';
import { recordsRoundTripObjectIds, unwrapBackupEnvelope } from '../utils/objectId';
import type { AyahTranslationRecord, VerseTranslationRecord } from './prepareTranslationCleanup';

type Backup = { versetranslations: VerseTranslationRecord[]; ayahs: AyahTranslationRecord[] };

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const backupFlagIndex = argv.indexOf('--backup');
  const backupPath = backupFlagIndex !== -1 ? argv[backupFlagIndex + 1] : undefined;
  return { apply, backupPath };
}

async function main() {
  const { apply, backupPath } = parseArgs(process.argv.slice(2));

  if (!backupPath) {
    throw new Error('Usage: rollbackTranslationCleanup.ts --backup <path-to-backup.json> [--apply]');
  }
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required.');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Rollback is disabled when NODE_ENV=production.');
  }

  const raw = readFileSync(backupPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const backup = unwrapBackupEnvelope<Backup>(parsed);

  if (!Array.isArray(backup.versetranslations) || !Array.isArray(backup.ayahs)) {
    throw new Error('Backup file does not contain the expected versetranslations/ayahs arrays.');
  }

  await mongoose.connect(env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  if (!/^(test|.*(?:[_-]dev|[_-]development|[_-]local))$/i.test(db.databaseName)) {
    throw new Error('Database is not recognizably local/development; refusing to proceed.');
  }

  const [currentTranslationIds, currentAyahIds] = await Promise.all([
    db.collection('versetranslations').find({}, { projection: { _id: 1 } }).map((doc) => String(doc._id)).toArray(),
    db.collection('ayahs').find({}, { projection: { _id: 1 } }).map((doc) => String(doc._id)).toArray(),
  ]);

  const plan = {
    generatedAt: new Date().toISOString(),
    database: db.databaseName,
    mode: apply ? 'apply' : 'dry-run',
    backupPath,
    versetranslationsToRestore: backup.versetranslations.length,
    ayahsToRestoreFieldsOn: backup.ayahs.length,
    alreadyPresentVerseTranslationIds: backup.versetranslations
      .map((doc) => String((doc as { _id?: unknown })._id))
      .filter((id) => currentTranslationIds.includes(id)),
    missingAyahIds: backup.ayahs
      .map((doc) => String((doc as { _id?: unknown })._id))
      .filter((id) => !currentAyahIds.includes(id)),
  };

  console.log(JSON.stringify(plan, null, 2));

  if (plan.alreadyPresentVerseTranslationIds.length) {
    throw new Error(
      `${plan.alreadyPresentVerseTranslationIds.length} backed-up VerseTranslation _id(s) already exist in the live collection — refusing to restore to avoid duplicates.`,
    );
  }
  if (plan.missingAyahIds.length) {
    throw new Error(
      `${plan.missingAyahIds.length} backed-up Ayah _id(s) no longer exist in the live collection — cannot restore fields onto a document that isn't there.`,
    );
  }

  if (!apply) {
    console.log('Dry run only; no documents were changed. Pass --apply to execute the restore.');
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (backup.versetranslations.length) {
        await db.collection('versetranslations').insertMany(
          backup.versetranslations.map((doc) => ({ ...doc, _id: new mongoose.Types.ObjectId(String((doc as { _id?: unknown })._id)) })),
          { session },
        );
      }

      for (const doc of backup.ayahs) {
        const id = new mongoose.Types.ObjectId(String((doc as { _id?: unknown })._id));
        const update: Record<string, unknown> = {};
        if (Object.prototype.hasOwnProperty.call(doc, 'englishTranslation')) update.englishTranslation = doc.englishTranslation;
        if (Object.prototype.hasOwnProperty.call(doc, 'translationSource')) update.translationSource = doc.translationSource;
        await db.collection('ayahs').updateOne({ _id: id }, { $set: update }, { session });
      }

      const [restoredTranslations, restoredAyahs] = await Promise.all([
        db.collection('versetranslations').find({}, { session }).toArray(),
        db.collection('ayahs').find({}, { session }).toArray(),
      ]);

      if (!recordsRoundTripObjectIds(backup.versetranslations, restoredTranslations.filter((doc) =>
        backup.versetranslations.some((b) => String((b as { _id?: unknown })._id) === String(doc._id)),
      ))) {
        throw new Error('Restored VerseTranslation _ids do not round-trip against the backup; transaction aborted.');
      }

      const restoredTargeted = restoredAyahs.filter((doc) => backup.ayahs.some((b) => String((b as { _id?: unknown })._id) === String(doc._id)));
      const allFieldsRestored = restoredTargeted.every((doc) => {
        const backedUp = backup.ayahs.find((b) => String((b as { _id?: unknown })._id) === String(doc._id))!;
        return doc.englishTranslation === backedUp.englishTranslation && doc.translationSource === backedUp.translationSource;
      });
      if (!allFieldsRestored) {
        throw new Error('Restored Ayah translation fields do not match the backup; transaction aborted.');
      }
    });
  } finally {
    await session.endSession();
  }

  console.log('Rollback applied successfully.');
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown rollback error.';
      console.error(`Translation cleanup rollback failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
