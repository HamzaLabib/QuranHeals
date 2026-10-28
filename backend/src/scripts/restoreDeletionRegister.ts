/**
 * Keeps deleted accounts deleted across a backup restore (docs/database-restore.md).
 *
 *   export   Read the LIVE deletion register (read-only) and write its entries — internal account ids and dates
 *            only — to a JSON file outside the repository and outside OneDrive. Run immediately before a restore.
 *            Uses the normal guarded connection (prod-read.env for production).
 *
 *   reapply  On a RESTORED copy, delete every account in the export (and in the copy's own register) again, with the
 *            same transaction as in-app deletion. Optionally end every session, so restored sign-ins that had
 *            already ended stay ended. Dry run by default; --apply writes.
 *            Only ever connects to a local mongod (--uri mongodb://127.0.0.1:<port>/ or localhost): it refuses any
 *            other host, so it can never touch Atlas. A restore into Atlas is a separate, owner-approved procedure.
 *
 * Apple: deletions in the register already revoked Apple's authorization when they happened, so reapply never calls
 * Apple. Nothing here prints an email, token or content: ids are counted, not listed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import mongoose from 'mongoose';

import { connectScriptDatabase, disconnectFromDatabase } from '../config/database';
import { AccountDeletionModel } from '../models/AccountDeletion';
import { SessionModel } from '../models/Session';
import { UserModel } from '../models/User';
import { MongooseAccountDeletionService } from '../services/MongooseAccountDeletionService';
import { isObjectIdHex } from '../utils/objectId';

export type RegisterExport = { kind: 'quran-heals-deletion-register'; exportedAt: string; database: string; entries: { userId: string; deletedAt: string }[] };

const REPO_ROOT = resolve(__dirname, '../../..');

/** Export files hold internal account ids: never inside the repository or a OneDrive folder. */
export function assertExportPathAllowed(path: string): void {
  const full = resolve(path);
  if (full.toLowerCase().startsWith(REPO_ROOT.toLowerCase() + sep)) throw new Error('Refusing to write the export inside the QuranHeals repository.');
  if (/[\\/]onedrive[^\\/]*[\\/]/i.test(full)) throw new Error('Refusing to write the export inside OneDrive (its version history would keep it).');
}

/** Only a mongod on this computer: loopback host, explicit port, no credentials needed. */
export function assertLocalRestoreUri(uri: string): void {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error('--uri must be a mongodb:// URL.');
  }
  if (url.protocol !== 'mongodb:') throw new Error('--uri must be mongodb:// (never mongodb+srv:// — that is Atlas).');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`Refusing ${url.hostname}: reapply only runs against a local restored copy (127.0.0.1).`);
}

export function parseExport(text: string): RegisterExport {
  const parsed = JSON.parse(text) as RegisterExport;
  if (parsed?.kind !== 'quran-heals-deletion-register' || !Array.isArray(parsed.entries)) throw new Error('Not a deletion-register export.');
  for (const entry of parsed.entries) {
    if (!isObjectIdHex(entry.userId) || Number.isNaN(Date.parse(entry.deletedAt))) throw new Error('The export has a malformed entry.');
  }
  return parsed;
}

/** The ids to delete again: the export's plus the restored copy's own register, each once. */
export function idsToReapply(exported: RegisterExport, restoredRegister: { userId: string }[]): string[] {
  return [...new Set([...exported.entries.map((entry) => entry.userId), ...restoredRegister.map((entry) => entry.userId)])].sort();
}

async function exportRegister(out: string) {
  assertExportPathAllowed(out);
  if (existsSync(out)) throw new Error('The export file already exists; choose a new name.');
  const target = await connectScriptDatabase({ script: 'restore:export-deletions', writes: false, productionSupported: true }, { autoIndex: false, autoCreate: false });
  try {
    const docs = await AccountDeletionModel.find({}).select('userId deletedAt').lean<{ userId: string; deletedAt: Date }[]>();
    const data: RegisterExport = {
      kind: 'quran-heals-deletion-register',
      exportedAt: new Date().toISOString(),
      database: target.databaseName,
      entries: docs.map((doc) => ({ userId: doc.userId, deletedAt: doc.deletedAt.toISOString() })),
    };
    writeFileSync(out, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
    console.log(`Exported ${data.entries.length} register entries from ${target.environment}/${target.databaseName}.`);
  } finally {
    await disconnectFromDatabase();
  }
}

async function reapply(options: { uri: string; dbName: string; file: string; apply: boolean; endSessions: boolean }) {
  assertLocalRestoreUri(options.uri);
  const exported = parseExport(readFileSync(options.file, 'utf8'));
  await mongoose.connect(options.uri, { dbName: options.dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  try {
    const own = await AccountDeletionModel.find({}).select('userId').lean<{ userId: string }[]>();
    const ids = idsToReapply(exported, own);
    const present = await UserModel.countDocuments({ _id: { $in: ids } });
    const sessions = await SessionModel.countDocuments({});
    console.log(`[restore:reapply-deletions] local/${options.dbName} mode=${options.apply ? 'WRITE' : 'dry-run'}`);
    console.log(`  register ids: ${ids.length} (export ${exported.entries.length}, restored copy ${own.length}); accounts present again: ${present}; sessions: ${sessions}`);
    if (!options.apply) {
      console.log('Dry run only; nothing was written. Re-run with --apply.');
      return;
    }
    const service = new MongooseAccountDeletionService();
    // A downloaded snapshot started with plain `mongod` is standalone (no transactions); a replica set gets the
    // normal transactional path.
    const hello = (await mongoose.connection.db!.admin().command({ hello: 1 })) as { setName?: string };
    for (const id of ids) {
      if (hello.setName) await service.deleteAccount(id);
      else await service.deleteAccountOnStandaloneRestore(id);
    }
    if (options.endSessions) await SessionModel.deleteMany({});
    const after = await UserModel.countDocuments({ _id: { $in: ids } });
    console.log(`Deleted again: ${present - after}. Accounts from the register still present: ${after}.${options.endSessions ? ' All sessions ended.' : ''}`);
    if (after !== 0) process.exitCode = 4;
  } finally {
    await mongoose.disconnect();
  }
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  const run = command === 'export'
    ? exportRegister(argValue(args, '--out') ?? '')
    : command === 'reapply'
      ? reapply({
          uri: argValue(args, '--uri') ?? '',
          dbName: argValue(args, '--db') ?? 'quranheals_prod',
          file: argValue(args, '--file') ?? '',
          apply: args.includes('--apply'),
          endSessions: args.includes('--end-all-sessions'),
        })
      : Promise.reject(new Error('Usage: export --out <file> | reapply --uri mongodb://127.0.0.1:<port>/ --file <export> [--db <name>] [--end-all-sessions] [--apply]'));
  run.catch((error) => {
    console.error(`restore:deletions failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
