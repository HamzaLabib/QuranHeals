// Reports what a MongoDB translation-cleanup migration would do (dry-run by
// default) and, given both --destructive and --confirm-irreversible:
//   1. deletes all VerseTranslation documents by their exact backed-up _id
//      set (never deleteMany({}) — see analyzeTranslationCollections), and
//   2. $unsets Ayah.englishTranslation/translationSource on the exact
//      backed-up _id set of legacy Ayah documents that currently carry them.
// Modeled closely on prepareArabicCleanup.ts (Phase 4C) — same dry-run
// report shape, same backup-then-transaction structure, same reconnect
// workaround for this deployment's transaction behavior. Runs only after
// Phase 6A.8B proved translation runtime independence from MongoDB: see
// backend/src/quran/translationSource.ts and
// backend/tests/quran-data/mongo-translation-independence.test.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import mongoose from 'mongoose';

import { env } from '../config/env';
import { AyahModel } from '../models/Ayah';
import { VerseTranslationModel } from '../models/VerseTranslation';
import { getVerifiedTranslationByVerseKey } from '../quran/translationSource';
import { TRANSLATION_CLEANUP_BACKUPS_DIR, TRANSLATION_CLEANUP_DRY_RUN_REPORT_PATH } from '../utils/backupPaths';
import { writeVerifiedJsonBackup } from '../utils/backupFile';
import { recordsRoundTripObjectIds, unwrapBackupEnvelope, wrapBackupEnvelope } from '../utils/objectId';

export type VerseTranslationRecord = {
  _id?: unknown;
  verseReferenceKey?: unknown;
  language?: unknown;
  translator?: unknown;
  text?: unknown;
  source?: unknown;
  sourceVersion?: unknown;
  license?: unknown;
  checksum?: unknown;
};

export type AyahTranslationRecord = {
  _id?: unknown;
  referenceKey?: unknown;
  englishTranslation?: unknown;
  translationSource?: unknown;
};

export type TranslationCleanupReport = {
  verseTranslations: {
    total: number;
    uniqueVerseReferenceKeys: number;
    languages: string[];
    translators: string[];
    duplicateVerseReferenceKeys: string[];
    targetedIds: string[];
    unexpectedRows: { id: string; reason: string }[];
  };
  ayahs: {
    total: number;
    withEnglishTranslation: number;
    withTranslationSource: number;
    targetedIds: string[];
  };
  blocked: boolean;
  blockingReasons: string[];
};

/**
 * Pure report builder: no I/O. `versetranslations` scope is "every document"
 * (this collection exists solely for translation storage) so there is no
 * filtering to do beyond detecting duplicates/unexpected shapes; the exact
 * `_id` set is still what gets deleted, never a filterless deleteMany. Ayah
 * scope is exactly the documents that currently carry either translation
 * field — a document with neither is left completely alone.
 */
export function analyzeTranslationCollections(
  translations: VerseTranslationRecord[],
  ayahs: AyahTranslationRecord[],
): TranslationCleanupReport {
  const keyCounts = new Map<string, number>();
  const unexpectedRows: { id: string; reason: string }[] = [];

  translations.forEach((doc) => {
    const id = String(doc._id ?? '');
    const key = typeof doc.verseReferenceKey === 'string' ? doc.verseReferenceKey : null;

    if (!key) {
      unexpectedRows.push({ id, reason: 'missing/invalid verseReferenceKey' });
    } else {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }

    if (doc.language !== 'en') {
      unexpectedRows.push({ id, reason: `unexpected language "${String(doc.language)}"` });
    }
    if (doc.translator !== 'Marmaduke Pickthall') {
      unexpectedRows.push({ id, reason: `unexpected translator "${String(doc.translator)}"` });
    }
  });

  const duplicateVerseReferenceKeys = [...keyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);

  const targetedAyahs = ayahs.filter(
    (doc) => Object.prototype.hasOwnProperty.call(doc, 'englishTranslation') ||
      Object.prototype.hasOwnProperty.call(doc, 'translationSource'),
  );

  const blockingReasons: string[] = [];
  if (unexpectedRows.length) blockingReasons.push(`${unexpectedRows.length} VerseTranslation row(s) have unexpected shape/values.`);
  if (duplicateVerseReferenceKeys.length) blockingReasons.push(`${duplicateVerseReferenceKeys.length} duplicate verseReferenceKey(s) in VerseTranslation.`);

  return {
    verseTranslations: {
      total: translations.length,
      uniqueVerseReferenceKeys: keyCounts.size,
      languages: [...new Set(translations.map((doc) => String(doc.language)))],
      translators: [...new Set(translations.map((doc) => String(doc.translator)))],
      duplicateVerseReferenceKeys,
      targetedIds: translations.map((doc) => String(doc._id ?? '')),
      unexpectedRows,
    },
    ayahs: {
      total: ayahs.length,
      withEnglishTranslation: ayahs.filter((doc) => Object.prototype.hasOwnProperty.call(doc, 'englishTranslation')).length,
      withTranslationSource: ayahs.filter((doc) => Object.prototype.hasOwnProperty.call(doc, 'translationSource')).length,
      targetedIds: targetedAyahs.map((doc) => String(doc._id ?? '')),
    },
    blocked: blockingReasons.length > 0,
    blockingReasons,
  };
}

/** Re-proves translation runtime independence: every canonical verseKey the targeted Ayah docs use must resolve from translations.sqlite alone. */
export function reProveRuntimeIndependence(ayahs: AyahTranslationRecord[]): string[] {
  const failures: string[] = [];
  for (const doc of ayahs) {
    const key = typeof doc.referenceKey === 'string' ? doc.referenceKey : null;
    if (!key) continue;
    try {
      const text = getVerifiedTranslationByVerseKey(key);
      if (!text) failures.push(`${key}: empty verified translation`);
    } catch {
      failures.push(`${key}: verified translation threw`);
    }
  }
  return failures;
}

async function main() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required.');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Translation cleanup preparation is disabled when NODE_ENV=production.');
  }

  const destructive = process.argv.includes('--destructive');
  const confirmed = process.argv.includes('--confirm-irreversible');

  await mongoose.connect(env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  if (!/^(test|.*(?:[_-]dev|[_-]development|[_-]local))$/i.test(db.databaseName)) {
    throw new Error('Database is not recognizably local/development; refusing to proceed.');
  }

  const [translations, ayahs] = await Promise.all([
    db.collection<VerseTranslationRecord>('versetranslations').find({}).toArray(),
    db.collection<AyahTranslationRecord>('ayahs').find({}).toArray(),
  ]);

  const report = analyzeTranslationCollections(translations, ayahs);
  const independenceFailures = reProveRuntimeIndependence(ayahs);

  const output = {
    generatedAt: new Date().toISOString(),
    database: db.databaseName,
    mode: destructive && confirmed ? 'destructive' : 'dry-run',
    blocked: report.blocked || independenceFailures.length > 0,
    report,
    runtimeIndependenceFailures: independenceFailures,
    rollbackStrategy:
      'VerseTranslation documents are deleted by exact _id (never deleteMany({})); Ayah translation fields are $unset by exact _id. ' +
      'Revert via backend/src/scripts/rollbackTranslationCleanup.ts --apply, which restores from the verified pre-mutation JSON backup, ' +
      'matching each record by its original _id. Do not re-run seed.ts/migrateFoundation.ts expecting a rollback (Phase 6A.8D): ' +
      'both now strip englishTranslation/translationSource (stripLegacyTranslationFields in seed.ts) and never write VerseTranslation ' +
      '(migrateFoundation.ts) — re-running either is a safe no-op for translation, not a rollback path.',
  };

  mkdirSync('reports/cleanup', { recursive: true });
  writeFileSync(TRANSLATION_CLEANUP_DRY_RUN_REPORT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));

  if (output.blocked) {
    console.error('Blocked: unexpected data or failed runtime-independence re-proof. Refusing to proceed with any destructive step.');
    process.exitCode = 1;
    return;
  }

  if (!destructive) {
    console.log('Dry run only; no documents were changed. Pass --destructive --confirm-irreversible to execute the cleanup.');
    return;
  }

  if (!confirmed) {
    throw new Error('--destructive requires --confirm-irreversible.');
  }

  await runDestructiveCleanup(report);
  console.log(`Translation cleanup transaction completed. Backup written to ${TRANSLATION_CLEANUP_BACKUPS_DIR}; updated report written to ${TRANSLATION_CLEANUP_DRY_RUN_REPORT_PATH}.`);
}

/**
 * Deletes the exact backed-up VerseTranslation _id set and $unsets the exact
 * backed-up Ayah translation fields. Never called by this script's own CLI
 * usage unless both --destructive and --confirm-irreversible are passed.
 */
async function runDestructiveCleanup(report: TranslationCleanupReport) {
  let db = mongoose.connection.db!;
  const [translations, ayahs] = await Promise.all([
    db.collection('versetranslations').find({}).toArray(),
    db.collection('ayahs').find({}).toArray(),
  ]);

  const targetedAyahs = ayahs.filter((doc) => report.ayahs.targetedIds.includes(String(doc._id)));

  const backupPath = join(TRANSLATION_CLEANUP_BACKUPS_DIR, `mongodb-translation-before-cleanup-${Date.now()}.json`);
  const backup = writeVerifiedJsonBackup(
    backupPath,
    wrapBackupEnvelope({ versetranslations: translations, ayahs: targetedAyahs }),
    (parsed) => {
      let candidate: { versetranslations?: unknown; ayahs?: unknown };
      try {
        candidate = unwrapBackupEnvelope<{ versetranslations?: unknown; ayahs?: unknown }>(parsed);
      } catch {
        return false;
      }
      if (!Array.isArray(candidate.versetranslations) || !Array.isArray(candidate.ayahs)) return false;
      return (
        recordsRoundTripObjectIds(translations, candidate.versetranslations) &&
        recordsRoundTripObjectIds(targetedAyahs, candidate.ayahs)
      );
    },
  );
  console.log(`Pre-cleanup backup verified: ${backup.path} (sha256 ${backup.sha256}, ${backup.byteLength} bytes).`);

  // Same empirically-required reconnect as prepareArabicCleanup.ts: a
  // transaction spanning two collections fails deterministically if the same
  // connection already ran non-transactional multi-collection reads.
  await mongoose.disconnect();
  await mongoose.connect(env.MONGODB_URI!, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  db = mongoose.connection.db!;

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const [currentTranslations, currentAyahs] = await Promise.all([
        db.collection('versetranslations').find({}, { session }).toArray(),
        db.collection('ayahs').find({}, { session }).toArray(),
      ]);
      const currentReport = analyzeTranslationCollections(currentTranslations, currentAyahs);

      if (
        currentReport.blocked ||
        currentReport.verseTranslations.total !== report.verseTranslations.total ||
        JSON.stringify([...currentReport.verseTranslations.targetedIds].sort()) !==
          JSON.stringify([...report.verseTranslations.targetedIds].sort()) ||
        JSON.stringify([...currentReport.ayahs.targetedIds].sort()) !== JSON.stringify([...report.ayahs.targetedIds].sort())
      ) {
        throw new Error('Database changed since the dry run; targeted identities no longer match. Aborted.');
      }

      const translationIds = report.verseTranslations.targetedIds.map((id) => new mongoose.Types.ObjectId(id));
      const ayahIds = report.ayahs.targetedIds.map((id) => new mongoose.Types.ObjectId(id));

      const deleteResult = await db
        .collection('versetranslations')
        .deleteMany({ _id: { $in: translationIds } }, { session });

      const unsetResult = await db
        .collection('ayahs')
        .updateMany({ _id: { $in: ayahIds } }, { $unset: { englishTranslation: '', translationSource: '' } }, { session });

      if (deleteResult.deletedCount !== translationIds.length) {
        throw new Error(`Expected to delete ${translationIds.length} VerseTranslation docs, deleted ${deleteResult.deletedCount}.`);
      }
      if (unsetResult.matchedCount !== ayahIds.length || unsetResult.modifiedCount !== ayahIds.length) {
        throw new Error(
          `Expected to match/modify ${ayahIds.length} Ayah docs, matched ${unsetResult.matchedCount} modified ${unsetResult.modifiedCount}.`,
        );
      }

      const [afterTranslations, afterAyahs] = await Promise.all([
        db.collection('versetranslations').countDocuments({}, { session }),
        db.collection('ayahs').find({}, { session }).toArray(),
      ]);

      const stillHasTargetedTranslations = afterTranslations !== currentTranslations.length - translationIds.length;
      const stillHasFields = afterAyahs.some(
        (doc) =>
          ayahIds.some((id) => id.equals(doc._id)) &&
          (Object.prototype.hasOwnProperty.call(doc, 'englishTranslation') ||
            Object.prototype.hasOwnProperty.call(doc, 'translationSource')),
      );
      if (stillHasTargetedTranslations || stillHasFields || afterAyahs.length !== currentAyahs.length) {
        throw new Error('Post-cleanup verification failed; transaction aborted.');
      }
    });
  } finally {
    await session.endSession();
  }
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown cleanup preparation error.';
      console.error(`Translation cleanup preparation failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
