import mongoose, { type ConnectOptions } from 'mongoose';

import {
  assertScriptMayUseTarget,
  DatabaseConfigError,
  describeTarget,
  resolveDatabaseTarget,
  type DatabaseTarget,
  type ScriptAccess,
} from './databaseTarget';
import { env } from './env';

/** The validated database for this process (see config/databaseTarget.ts). Throws DatabaseConfigError. */
export function getDatabaseTarget(): DatabaseTarget {
  return resolveDatabaseTarget({ nodeEnv: env.NODE_ENV, uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
}

async function connectTo(target: DatabaseTarget, options: ConnectOptions): Promise<DatabaseTarget> {
  mongoose.set('strictQuery', true);
  // dbName is always explicit, so MongoDB's implicit `test` default can never apply.
  await mongoose.connect(env.MONGODB_URI!, { ...options, dbName: target.databaseName });
  const connected = mongoose.connection.db?.databaseName;
  if (connected !== target.databaseName) {
    await mongoose.disconnect();
    throw new DatabaseConfigError(`Connected to database "${connected}" instead of "${target.databaseName}".`);
  }
  return target;
}

/** Server startup: validates the target before connecting, then confirms the connected database. */
export async function connectToDatabase(options: ConnectOptions = {}): Promise<DatabaseTarget> {
  return connectTo(getDatabaseTarget(), options);
}

/**
 * Seed/migration/mapping scripts: same validation, plus production is
 * refused unless the script supports it (and a production write is
 * explicitly confirmed). Prints the target before connecting.
 */
export async function connectScriptDatabase(access: ScriptAccess, options: ConnectOptions = {}): Promise<DatabaseTarget> {
  const target = getDatabaseTarget();
  assertScriptMayUseTarget(target, access, process.env);
  console.error(describeTarget(target, access));
  return connectTo(target, options);
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect();
}

const DATABASE_PING_TIMEOUT_MS = 2000;

/** True only when the Mongoose connection is open and answers a ping within 2s. Never throws. */
export async function pingDatabase(): Promise<boolean> {
  const db = mongoose.connection.readyState === 1 ? mongoose.connection.db : undefined;
  if (!db) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), DATABASE_PING_TIMEOUT_MS);
    });
    return await Promise.race([db.admin().ping().then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
