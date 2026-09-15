// Reports what a MongoDB Arabic-cleanup migration would do (dry-run by
// default) and, given both --destructive and --confirm-irreversible, removes
// Verse.arabicText, Verse.checksum, and Ayah.arabicText from the configured
// development database — already executed once for the current dev
// database's foundation-seed data (see backend/backups/data-cleanup/ for the
// pre-mutation backup and backend/reports/cleanup/cleanup-dry-run.json
// for the report). Re-running this script against the same data is a safe
// no-op: the fields are already gone and `runValidators` no longer requires
// them (see src/models/Verse.ts, src/models/Ayah.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import mongoose from 'mongoose';

import { env } from '../config/env';
import { isValidVerseKey } from '../quran/referenceKeys';
import { ARABIC_CLEANUP_BACKUPS_DIR } from '../utils/backupPaths';
import { writeVerifiedJsonBackup } from '../utils/backupFile';
import { recordsRoundTripObjectIds, unwrapBackupEnvelope, wrapBackupEnvelope } from '../utils/objectId';

export type QuranTextRecord = {
  _id?: unknown;
  referenceKey?: unknown;
  surahNumber?: unknown;
  ayahNumber?: unknown;
  arabicText?: unknown;
};

export type UnresolvedReference = { id: string; referenceKey: string | null };
export type ConflictingReference = { id: string; referenceKey: string | null; numericKey: string | null };

export type CollectionCleanupReport = {
  collection: string;
  total: number;
  withArabic: number;
  validVerseKey: number;
  unresolved: UnresolvedReference[];
  conflicting: ConflictingReference[];
  fieldsToRemove: string[];
  recordsRemaining: number;
};

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function numericKey(record: QuranTextRecord): string | null {
  const { surahNumber, ayahNumber } = record;

  return typeof surahNumber === 'number' &&
    Number.isInteger(surahNumber) &&
    typeof ayahNumber === 'number' &&
    Number.isInteger(ayahNumber)
    ? `${surahNumber}:${ayahNumber}`
    : null;
}

function safeReferenceKey(record: QuranTextRecord): string | null {
  return typeof record.referenceKey === 'string' ? record.referenceKey : null;
}

/**
 * Pure report builder: no I/O. Analyzes a raw collection of Quran-text-bearing
 * documents (Verse or legacy Ayah shape) against the local reference-key set.
 */
export function analyzeQuranTextCollection(
  collection: string,
  records: QuranTextRecord[],
  fieldsToRemove: string[],
): CollectionCleanupReport {
  const unresolved: UnresolvedReference[] = [];
  const conflicting: ConflictingReference[] = [];
  let withArabic = 0;
  let validVerseKey = 0;

  records.forEach((record) => {
    const id = String(record._id ?? '');
    const referenceKey = safeReferenceKey(record);
    const numeric = numericKey(record);

    if (hasText(record.arabicText)) {
      withArabic += 1;
    }

    if (referenceKey && isValidVerseKey(referenceKey)) {
      validVerseKey += 1;
    } else {
      unresolved.push({ id, referenceKey });
    }

    if (referenceKey !== numeric) {
      conflicting.push({ id, referenceKey, numericKey: numeric });
    }
  });

  return {
    collection,
    total: records.length,
    withArabic,
    validVerseKey,
    unresolved,
    conflicting,
    fieldsToRemove,
    recordsRemaining: records.length,
  };
}

/** Collections whose documents are untouched by this migration, reported for completeness. */
export function unaffectedCollectionReport(collection: string, total: number): CollectionCleanupReport {
  return {
    collection,
    total,
    withArabic: 0,
    validVerseKey: total,
    unresolved: [],
    conflicting: [],
    fieldsToRemove: [],
    recordsRemaining: total,
  };
}

export function hasBlockingIssues(reports: CollectionCleanupReport[]): boolean {
  return reports.some((report) => report.unresolved.length > 0);
}

async function main() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required.');
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Arabic cleanup preparation is disabled when NODE_ENV=production.');
  }

  const destructive = process.argv.includes('--destructive');
  const confirmed = process.argv.includes('--confirm-irreversible');

  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });

  const db = mongoose.connection.db!;

  if (!/^(test|.*(?:[_-]dev|[_-]development|[_-]local))$/i.test(db.databaseName)) {
    throw new Error('Database is not recognizably local/development; refusing to proceed.');
  }

  const [verses, ayahs, translations, mappings, emotions] = await Promise.all([
    db.collection<QuranTextRecord>('verses').find({}).toArray(),
    db.collection<QuranTextRecord>('ayahs').find({}).toArray(),
    db.collection('versetranslations').countDocuments(),
    db.collection('emotionversemappings').countDocuments(),
    db.collection('emotions').countDocuments(),
  ]);

  const reports = [
    analyzeQuranTextCollection('verses', verses, ['arabicText', 'checksum']),
    analyzeQuranTextCollection('ayahs', ayahs, ['arabicText']),
    unaffectedCollectionReport('versetranslations', translations),
    unaffectedCollectionReport('emotionversemappings', mappings),
    unaffectedCollectionReport('emotions', emotions),
  ];

  const blocked = hasBlockingIssues(reports);
  const report = {
    generatedAt: new Date().toISOString(),
    database: db.databaseName,
    mode: destructive && confirmed ? 'destructive' : 'dry-run',
    blocked,
    collections: reports,
    rollbackStrategy:
      'This migration only unsets fields (no deletes, no ObjectId changes, no invented data). ' +
      'Revert by restoring the removed fields from the pre-mutation JSON backup via bulkWrite, ' +
      'matching each record by its original _id. seed.ts and migrateFoundation.ts no longer ' +
      'write arabicText/checksum at all (see stripAyahArabicText/stripVerseArabicFields), so ' +
      're-running either is not a rollback path.',
  };

  mkdirSync('reports/cleanup', { recursive: true });
  writeFileSync('reports/cleanup/cleanup-dry-run.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (blocked) {
    console.error('Unresolved Quran references exist; refusing to proceed with any destructive step.');
    process.exitCode = 1;
    return;
  }

  if (!destructive) {
    console.log('Dry run only; no fields were changed. Pass --destructive --confirm-irreversible to execute the cleanup.');
    return;
  }

  if (!confirmed) {
    throw new Error('--destructive requires --confirm-irreversible.');
  }

  await runDestructiveCleanup(reports);
  console.log(`Arabic cleanup transaction completed. Backup written to ${ARABIC_CLEANUP_BACKUPS_DIR}; updated report written to reports/cleanup/.`);
}

/**
 * Removes the reported fields from `verses` and `ayahs`. Never called by this
 * phase's own CLI usage (see main(): reaching here requires deliberately
 * passing both --destructive and --confirm-irreversible), kept only so a
 * future, separately authorized run has real migration code to execute
 * instead of having to write it under time pressure later.
 */
async function runDestructiveCleanup(reports: CollectionCleanupReport[]) {
  let db = mongoose.connection.db!;
  const [verses, ayahs] = await Promise.all([
    db.collection('verses').find({}).toArray(),
    db.collection('ayahs').find({}).toArray(),
  ]);

  // Unconditional backup before any mutation, verified by read-back before
  // any $unset runs. Never placed under backend/reports/: this is a
  // pre-mutation safety backup, not a reproducible report, and
  // backend/backups/ is git-ignored. Wrapped in the versioned ObjectId-backup
  // envelope (see ../utils/objectId): verification below proves each
  // restored `_id` decodes back into the exact original ObjectId, not merely
  // that a `_id` field survived.
  const backupPath = join(ARABIC_CLEANUP_BACKUPS_DIR, `mongodb-arabic-before-cleanup-${Date.now()}.json`);
  const backup = writeVerifiedJsonBackup(backupPath, wrapBackupEnvelope({ verses, ayahs }), (parsed) => {
    let candidate: { verses?: unknown; ayahs?: unknown };
    try {
      candidate = unwrapBackupEnvelope<{ verses?: unknown; ayahs?: unknown }>(parsed);
    } catch {
      return false;
    }
    if (!Array.isArray(candidate.verses) || !Array.isArray(candidate.ayahs)) return false;
    return recordsRoundTripObjectIds(verses, candidate.verses) && recordsRoundTripObjectIds(ayahs, candidate.ayahs);
  });
  console.log(`Pre-cleanup backup verified: ${backup.path} (sha256 ${backup.sha256}, ${backup.byteLength} bytes).`);

  const versesReport = reports.find((report) => report.collection === 'verses')!;
  const ayahsReport = reports.find((report) => report.collection === 'ayahs')!;

  // Reconnect immediately before starting the transaction. Empirically
  // confirmed against this deployment: a transaction whose body reads/writes
  // two different collections fails deterministically with "Only servers in
  // a sharded cluster can start a new transaction at the active transaction
  // number" once the same connection has already run non-transactional reads
  // against multiple collections (as main() and the lines above do for the
  // dry-run report and backup). A freshly reconnected client removes that
  // pre-existing state without changing any read, write, commit, or rollback
  // behavior of the transaction itself.
  await mongoose.disconnect();
  await mongoose.connect(env.MONGODB_URI!, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  db = mongoose.connection.db!;

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const [currentVerses, currentAyahs] = await Promise.all([
        db.collection<QuranTextRecord>('verses').find({}, { session }).toArray(),
        db.collection<QuranTextRecord>('ayahs').find({}, { session }).toArray(),
      ]);
      const currentVersesReport = analyzeQuranTextCollection('verses', currentVerses, versesReport.fieldsToRemove);
      const currentAyahsReport = analyzeQuranTextCollection('ayahs', currentAyahs, ayahsReport.fieldsToRemove);

      if (hasBlockingIssues([currentVersesReport, currentAyahsReport])) {
        throw new Error('Database changed since the dry run; unresolved references now exist. Aborted.');
      }

      const unsetFields = (fields: string[]) =>
        Object.fromEntries(fields.map((field) => [field, '']));

      await db.collection('verses').updateMany(
        {},
        { $unset: unsetFields(versesReport.fieldsToRemove) },
        { session },
      );
      await db.collection('ayahs').updateMany(
        {},
        { $unset: unsetFields(ayahsReport.fieldsToRemove) },
        { session },
      );

      const [afterVerses, afterAyahs] = await Promise.all([
        db.collection<QuranTextRecord>('verses').find({}, { session }).toArray(),
        db.collection<QuranTextRecord>('ayahs').find({}, { session }).toArray(),
      ]);

      const stillHasRemovedFields = [...afterVerses, ...afterAyahs].some((record) =>
        [...versesReport.fieldsToRemove, ...ayahsReport.fieldsToRemove].some(
          (field) => (record as Record<string, unknown>)[field] !== undefined,
        ),
      );

      if (stillHasRemovedFields || afterVerses.length !== currentVerses.length || afterAyahs.length !== currentAyahs.length) {
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
      console.error(`Arabic cleanup preparation failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
