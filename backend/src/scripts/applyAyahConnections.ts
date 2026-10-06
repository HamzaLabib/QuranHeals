/**
 * Applies backend/data/ayah-connections/reviewed-connections.json to the
 * matching emotion–verse mappings' `connection` field ("How this ayah
 * connects"). DRY-RUN BY DEFAULT.
 *
 *   npm run connections:apply                 # validate + plan, no writes
 *   npm run connections:apply -- --apply      # backup, then write
 *
 * Safety:
 * - The file is fully validated before any database connection; any problem
 *   stops everything (reviewedConnections.ts).
 * - Connects through connectScriptDatabase: the target environment/database
 *   is printed first, MongoDB's default `test` and cross-environment
 *   targets are refused, and a production write additionally requires
 *   QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod.
 * - Only existing, APPROVED mappings may receive text.
 * - --apply writes a verified backup of every affected mapping's current
 *   `connection` (backend/backups/ayah-connections/, git-ignored) before
 *   writing, then updates ONLY connection.en / connection.ar in one
 *   transaction (a single bulkWrite, so even ~2,000 updates fit well inside
 *   MongoDB's transaction time limit), each update matched on _id +
 *   emotionKey + verseKey + status 'approved', then re-read and verified.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import mongoose from 'mongoose';

import { connectScriptDatabase, disconnectFromDatabase } from '../config/database';
import {
  connectionUpdate,
  ConnectionValidationError,
  parseReviewedConnections,
  planConnectionChanges,
  REVIEWED_CONNECTIONS_PATH,
  type StoredMapping,
} from '../connections/reviewedConnections';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { writeVerifiedJsonBackup } from '../utils/backupFile';

export const AYAH_CONNECTION_BACKUPS_DIR = resolve(__dirname, '../../backups/ayah-connections');

export type ApplyConnectionsOptions = {
  apply: boolean;
  filePath?: string;
  backupDir?: string;
  now?: () => Date;
  log?: (line: string) => void;
};

export type ApplyConnectionsResult = {
  mode: 'dry-run' | 'apply';
  database: string;
  environment: string;
  entries: number;
  unchanged: number;
  changes: { emotionKey: string; verseKey: string; before: unknown; after: unknown }[];
  backup: string | null;
};

export function parseApplyArgs(args: string[]): { apply: boolean; filePath?: string } {
  let apply = false;
  let filePath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--file' && args[i + 1] && !args[i + 1].startsWith('--')) filePath = resolve(args[++i]);
    else throw new Error(`Unknown argument: ${args[i]} (use --apply and/or --file <path>)`);
  }
  return { apply, filePath };
}

export async function runApplyConnections(options: ApplyConnectionsOptions): Promise<ApplyConnectionsResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const filePath = options.filePath ?? REVIEWED_CONNECTIONS_PATH;

  // 1. Validate the file completely before touching any database.
  const entries = parseReviewedConnections(readFileSync(filePath, 'utf8'));

  // 2. Guarded connection (prints the target before connecting).
  const target = await connectScriptDatabase(
    { script: 'connections:apply', writes: options.apply, productionSupported: true },
    { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 },
  );

  try {
    // 3. Check every entry against the target's mappings (approved only).
    const pairs = entries.map((entry) => ({ emotionKey: entry.emotionKey, verseReferenceKey: entry.verseKey }));
    const stored = pairs.length === 0 ? [] : await EmotionVerseMappingModel.find({ $or: pairs }).lean<StoredMapping[]>();
    const { changes, unchanged } = planConnectionChanges(entries, stored);

    const summary = {
      mode: options.apply ? ('apply' as const) : ('dry-run' as const),
      database: target.databaseName,
      environment: target.environment,
      entries: entries.length,
      unchanged,
      changes: changes.map(({ emotionKey, verseKey, before, after }) => ({ emotionKey, verseKey, before, after })),
    };
    log(`[connections:apply] ${summary.mode} — ${target.environment}/${target.databaseName}: ${entries.length} reviewed entries, ${changes.length} to update, ${unchanged} already current`);
    for (const change of summary.changes) log(`  ${change.emotionKey} ${change.verseKey}`);

    if (!options.apply || changes.length === 0) {
      if (!options.apply) log('Dry run only; nothing was written. Re-run with --apply to write.');
      return { ...summary, backup: null };
    }

    // 4. Verified backup of the affected mappings' current connection fields.
    const now = (options.now ?? (() => new Date()))();
    const backupPath = resolve(options.backupDir ?? AYAH_CONNECTION_BACKUPS_DIR, `connections-before-${now.toISOString().replace(/[:.]/g, '-')}.json`);
    const records = changes.map((change) => ({ mappingId: String(change.mappingId), emotionKey: change.emotionKey, verseKey: change.verseKey, connection: change.before }));
    const backup = writeVerifiedJsonBackup(
      backupPath,
      { kind: 'ayah-connections-before-apply', database: target.databaseName, environment: target.environment, createdAt: now.toISOString(), records },
      (parsed) => (parsed as { records?: unknown[] }).records?.length === records.length,
    );
    log(`Backup written: ${backup.path}`);

    // 5. Update only connection.en / connection.ar, all-or-nothing.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Values were fully validated (trimmed, non-blank, ≤ 2,000 chars) before connecting.
        const result = await EmotionVerseMappingModel.bulkWrite(
          changes.map((change) => ({
            updateOne: {
              filter: { _id: change.mappingId, emotionKey: change.emotionKey, verseReferenceKey: change.verseKey, status: 'approved' },
              update: connectionUpdate(change.after),
            },
          })) as never,
          { session, ordered: true },
        );
        // _id is unique, so every filter matches at most one document.
        if (result.matchedCount !== changes.length) {
          throw new Error(`Only ${result.matchedCount} of ${changes.length} mappings matched (a mapping changed during apply); rolled back.`);
        }
        const after = await EmotionVerseMappingModel.find({ _id: { $in: changes.map((change) => change.mappingId) } }).session(session).lean<StoredMapping[]>();
        const afterById = new Map(after.map((mapping) => [String(mapping._id), mapping]));
        for (const change of changes) {
          const doc = afterById.get(String(change.mappingId));
          if (!doc || doc.status !== 'approved' || (doc.connection?.en ?? undefined) !== change.after.en || (doc.connection?.ar ?? undefined) !== change.after.ar) {
            throw new Error(`${change.emotionKey} ${change.verseKey}: post-write verification failed; rolled back.`);
          }
        }
      });
    } finally {
      await session.endSession();
    }
    log(`Applied ${changes.length} connection update(s).`);
    return { ...summary, backup: backup.path };
  } finally {
    await disconnectFromDatabase();
  }
}

if (require.main === module) {
  runApplyConnections(parseApplyArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof ConnectionValidationError ? error.message : `connections:apply failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
