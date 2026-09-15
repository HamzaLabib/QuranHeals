// Rollback for activateApprovedEmotionMappings.ts. Defaults to --dry-run;
// requires an explicit --apply plus --backup <path> pointing at one specific
// verified backup written by that script's apply path, and
// --confirm-database=<actual database name>.
//
// Bounded to the activation's own footprint (recorded in the backup's own
// `activationFootprint`), never a blind restore-everything:
//   1. every Emotion document present in the backup's `emotions` snapshot is
//      restored exactly (covers both "activated" and untouched emotions —
//      restoring the original `active` flag naturally reverts activation);
//   2. every EmotionVerseMapping document present in the backup's `mappings`
//      snapshot is restored exactly by its original `_id` (covers promoted
//      pairs — restoring `status`/`mappingVersion` reverts the promotion);
//   3. Emotion documents whose key is in `activationFootprint.emotionsToBeCreated`
//      are deleted, but ONLY if they currently exist and their live `_id` is
//      NOT present anywhere in the backup (proving they are new, not a
//      pre-existing document the backup already knows about);
//   4. EmotionVerseMapping documents whose pair is in
//      `activationFootprint.mappingsToBeInserted` are deleted under the same
//      "current live `_id` absent from the backup" proof.
// Any record that does not match this bounded, provable shape is left alone
// and reported as drift — never guessed at, never force-overwritten.
import { readFileSync } from 'node:fs';

import mongoose from 'mongoose';

import { env } from '../config/env';
import { EmotionModel } from '../models/Emotion';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { APPROVED_MAPPING_VERSION } from './activationDryRun';
import type { ActivationBackupPayload, LiveEmotionDoc, LiveMappingDoc } from './activateApprovedEmotionMappings';
import { recordsRoundTripObjectIds, unwrapBackupEnvelope } from '../utils/objectId';

function livePairKey(mapping: { verseReferenceKey: string; emotionKey: string }): string {
  return `${mapping.verseReferenceKey}|${mapping.emotionKey}`;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const backupFlagIndex = argv.indexOf('--backup');
  const backupPath = backupFlagIndex !== -1 ? argv[backupFlagIndex + 1] : undefined;
  const confirmDatabaseArg = argv.find((arg) => arg.startsWith('--confirm-database='));
  const confirmDatabase = confirmDatabaseArg ? confirmDatabaseArg.slice('--confirm-database='.length) : undefined;
  return { apply, backupPath, confirmDatabase };
}

export type RollbackPlan = {
  databaseMatches: boolean;
  backupDatabaseName: string;
  liveDatabaseName: string;
  emotionsRestorable: string[];
  emotionsRestorableIdMismatch: string[];
  mappingsRestorable: string[];
  mappingsRestorableIdMismatch: string[];
  emotionsDeletable: string[];
  emotionsDeletableBlockedByDrift: string[];
  mappingsDeletable: string[];
  mappingsDeletableBlockedByDrift: string[];
  blocked: boolean;
  blockingReasons: string[];
};

/**
 * Pure planning: compares the backup's recorded state/footprint against
 * currently-live documents and decides exactly what is safely restorable or
 * deletable, and what looks like drift that must block rollback instead of
 * being guessed at. No I/O, no writes.
 */
export function buildRollbackPlan(
  backup: ActivationBackupPayload,
  liveDatabaseName: string,
  liveEmotions: LiveEmotionDoc[],
  liveMappings: LiveMappingDoc[],
): RollbackPlan {
  const blockingReasons: string[] = [];
  const databaseMatches = backup.databaseName === liveDatabaseName;
  if (!databaseMatches) {
    blockingReasons.push(`Backup database "${backup.databaseName}" does not match live database "${liveDatabaseName}".`);
  }

  const backupEmotionIds = new Set(backup.emotions.map((e) => String(e._id)));
  const backupMappingIds = new Set(backup.mappings.map((m) => String(m._id)));

  const liveEmotionById = new Map(liveEmotions.map((e) => [String(e._id), e]));
  const liveMappingById = new Map(liveMappings.map((m) => [String(m._id), m]));
  const liveEmotionByKey = new Map(liveEmotions.map((e) => [e.key, e]));
  const liveMappingByPair = new Map(liveMappings.map((m) => [livePairKey(m), m]));

  // 1. Emotions restorable exactly: every backed-up emotion whose _id still exists live.
  const emotionsRestorable: string[] = [];
  const emotionsRestorableIdMismatch: string[] = [];
  backup.emotions.forEach((snapshot) => {
    const id = String(snapshot._id);
    if (liveEmotionById.has(id)) emotionsRestorable.push(snapshot.key);
    else emotionsRestorableIdMismatch.push(snapshot.key);
  });

  // 2. Mappings restorable exactly: every backed-up mapping whose _id still exists live.
  const mappingsRestorable: string[] = [];
  const mappingsRestorableIdMismatch: string[] = [];
  backup.mappings.forEach((snapshot) => {
    const id = String(snapshot._id);
    const key = livePairKey(snapshot);
    if (liveMappingById.has(id)) mappingsRestorable.push(key);
    else mappingsRestorableIdMismatch.push(key);
  });

  // 3. Emotions deletable: footprint says "created by activation" — only if a
  //    live doc for that key exists now AND its _id is not in the backup
  //    (proving it did not exist before activation).
  const emotionsDeletable: string[] = [];
  const emotionsDeletableBlockedByDrift: string[] = [];
  backup.activationFootprint.emotionsToBeCreated.forEach((key) => {
    const live = liveEmotionByKey.get(key);
    if (!live) return; // already gone / never created / already rolled back — no-op
    if (backupEmotionIds.has(String(live._id))) {
      emotionsDeletableBlockedByDrift.push(key);
      blockingReasons.push(`Emotion "${key}" was expected to be activation-created but its live _id already exists in the backup — refusing to guess.`);
    } else {
      emotionsDeletable.push(key);
    }
  });

  // 4. Mappings deletable: footprint says "inserted by activation" — only if a
  //    live doc for that pair exists now AND its _id is not in the backup,
  //    AND it still looks untouched since activation (status/mappingVersion match).
  const mappingsDeletable: string[] = [];
  const mappingsDeletableBlockedByDrift: string[] = [];
  backup.activationFootprint.mappingsToBeInserted.forEach((key) => {
    const live = liveMappingByPair.get(key);
    if (!live) return; // already gone / never inserted / already rolled back — no-op
    const idIsNew = !backupMappingIds.has(String(live._id));
    const looksUntouched = live.status === 'approved' && live.mappingVersion === APPROVED_MAPPING_VERSION;
    if (idIsNew && looksUntouched) {
      mappingsDeletable.push(key);
    } else {
      mappingsDeletableBlockedByDrift.push(key);
      blockingReasons.push(
        `Mapping "${key}" was expected to be a clean activation insert but ${
          idIsNew ? 'its status/mappingVersion has changed since activation' : 'its live _id already exists in the backup'
        } — refusing to delete it.`,
      );
    }
  });

  if (emotionsRestorableIdMismatch.length > 0) {
    blockingReasons.push(
      `${emotionsRestorableIdMismatch.length} backed-up Emotion document(s) no longer exist live by _id — cannot restore a document that isn't there.`,
    );
  }
  if (mappingsRestorableIdMismatch.length > 0) {
    blockingReasons.push(
      `${mappingsRestorableIdMismatch.length} backed-up EmotionVerseMapping document(s) no longer exist live by _id — cannot restore a document that isn't there.`,
    );
  }

  return {
    databaseMatches,
    backupDatabaseName: backup.databaseName,
    liveDatabaseName,
    emotionsRestorable,
    emotionsRestorableIdMismatch,
    mappingsRestorable,
    mappingsRestorableIdMismatch,
    emotionsDeletable,
    emotionsDeletableBlockedByDrift,
    mappingsDeletable,
    mappingsDeletableBlockedByDrift,
    blocked: blockingReasons.length > 0,
    blockingReasons,
  };
}

export function loadBackup(backupPath: string): ActivationBackupPayload {
  const raw = readFileSync(backupPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const backup = unwrapBackupEnvelope<ActivationBackupPayload>(parsed);

  if (
    !backup ||
    !Array.isArray(backup.emotions) ||
    !Array.isArray(backup.mappings) ||
    typeof backup.databaseName !== 'string' ||
    !backup.activationFootprint
  ) {
    throw new Error('Backup file does not contain the expected emotions/mappings/activationFootprint shape.');
  }

  return backup;
}

async function main() {
  const { apply, backupPath, confirmDatabase } = parseArgs(process.argv.slice(2));

  if (!backupPath) {
    throw new Error(
      'Usage: rollbackEmotionMappingActivation.ts --backup <path-to-backup.json> --confirm-database=<name> [--apply]',
    );
  }
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required.');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Rollback is disabled when NODE_ENV=production.');
  }
  if (apply && !confirmDatabase) {
    throw new Error('--apply requires --confirm-database=<actual database name>.');
  }

  const backup = loadBackup(backupPath);

  await mongoose.connect(env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });

  try {
    const liveDatabaseName = mongoose.connection.db!.databaseName;
    const [liveEmotions, liveMappings] = await Promise.all([
      EmotionModel.find({}).lean<LiveEmotionDoc[]>(),
      EmotionVerseMappingModel.find({}).lean<LiveMappingDoc[]>(),
    ]);

    const plan = buildRollbackPlan(backup, liveDatabaseName, liveEmotions, liveMappings);

    const objectIdRoundTrip =
      recordsRoundTripObjectIds(backup.emotions, backup.emotions) && recordsRoundTripObjectIds(backup.mappings, backup.mappings);

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          backupPath,
          liveDatabaseName,
          objectIdRoundTrip,
          plan,
        },
        null,
        2,
      ),
    );

    if (!objectIdRoundTrip) {
      throw new Error('Backup ObjectIds do not round-trip; refusing to proceed.');
    }
    if (plan.blocked) {
      throw new Error(`Rollback plan is blocked: ${plan.blockingReasons.join('; ')}`);
    }
    if (apply && confirmDatabase !== liveDatabaseName) {
      throw new Error(`--confirm-database="${confirmDatabase}" does not match the actual connected database "${liveDatabaseName}".`);
    }

    if (!apply) {
      console.log('Dry run only; no documents were changed. Pass --apply (with --confirm-database) to execute the restore.');
      return;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const snapshot of backup.emotions) {
          const { _id, ...fields } = snapshot;
          await EmotionModel.updateOne({ _id }, { $set: fields }, { session, runValidators: true });
        }

        for (const snapshot of backup.mappings) {
          const { _id, ...fields } = snapshot;
          await EmotionVerseMappingModel.updateOne({ _id }, { $set: fields }, { session, runValidators: true });
        }

        for (const key of plan.emotionsDeletable) {
          await EmotionModel.deleteOne({ key }, { session });
        }

        for (const key of plan.mappingsDeletable) {
          const [verseReferenceKey, emotionKey] = key.split('|');
          await EmotionVerseMappingModel.deleteOne({ verseReferenceKey, emotionKey }, { session });
        }
      });
    } finally {
      await session.endSession();
    }

    console.log('Rollback applied successfully.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown rollback error.';
      console.error(`Emotion mapping activation rollback failed: ${message}`);
      process.exitCode = 1;
    });
}
